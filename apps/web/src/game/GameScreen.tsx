// new (1-web-b): shared game screen — extracted from SandboxGame so the local hot-seat
// wrapper and the networked (Socket.IO) wrapper drive the identical UI.
// new (UI-8): blocking decisions live on a shared overlay layer — full-screen faction/power
// takeover (setup), centered combat overlay, bottom decision dock — instead of the rail.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  waitingOn, isLegalStart, joinWarTroops, maneuverDecision, startTurnDecision, endTurnDecision, hasFactionPower,
  neighborsOf, territoryIds,
  type GameState, type Action, type GameEvent,
} from "@risk/rules";
import { manifest, territoryById } from "@risk/map";
import { contentPack, factionDefinitionById } from "@risk/content";
import GameTable from "./GameTable.tsx";
import SidePanel from "./SidePanel.tsx";
import Ledger from "./Ledger.tsx";
import SetupTakeover from "./SetupTakeover.tsx";
import AdvancedDraftTakeover from "./AdvancedDraftTakeover.tsx";
import SetupDecisionBanner from "./SetupDecisionBanner.tsx";
import CombatOverlay from "./CombatOverlay.tsx";
import TurnDecisionDock from "./TurnDecisionDock.tsx";
import HandStrip from "./HandStrip.tsx"; // new (UI-9)
import ActionBar from "./ActionBar.tsx"; // new (UI-2)
import VictoryFlow from "./VictoryFlow.tsx"; // new (UI-12)
import Inspector from "./Inspector.tsx"; // new (UI-3)
import { DecisionChip } from "./overlays.tsx";
import { continentName, factionById, powerName, scarById, scarName, territoryName } from "./labels.ts";
import { Btn, CenterOverlay } from "./overlays.tsx";
import ScarCard from "./cards/ScarCard.tsx";
import { isManeuverSource, maneuverDestinations } from "./maneuverUi.ts";
import FactionEmblem from "./FactionEmblem.tsx";
import { deriveInteractionModel } from "./interaction/deriveInteractionModel.ts";
import type { TerritoryIntent } from "./interaction/InteractionPolicy.ts";
import type { TransitionSource } from "./presentation/types.ts";

type Highlight = "selected" | "highlight-attack" | "highlight-move" | "highlight-start" | "highlight-recruit" | "pulse-continent" | "dimmed";

const PHASES: { id: GameState["phase"]; label: string }[] = [
  { id: "setup", label: "SETUP" },
  { id: "start_turn", label: "START" },
  { id: "join_or_recruit", label: "RECRUIT" },
  { id: "expand_attack", label: "ATTACK" },
  { id: "maneuver", label: "MANEUVER" },
  { id: "end_turn", label: "END" },
];

function phaseLabel(phase: GameState["phase"]) {
  if (phase === "game_over") return "Game over";
  return PHASES.find((p) => p.id === phase)?.label ?? phase.replace(/_/g, " ");
}

type ImportantMoment = {
  key: number;
  title: string;
  detail: string;
  playerId?: string;
  tone: "signal" | "danger";
};

export interface UiState {
  selected?: string;
  pickedFaction?: string;
  pickedPower?: string; // new (9): first-play starting-power pick
  powerTear?: { chosenPowerId: string; destroyedPowerId: string };
  placeCount: number;
  moveCount: number;
  expandCount: number;
  selectedCards: string[];
  maneuverMode?: boolean;
  pulseContinent?: string;
  /** new (UI-12): a chosen end-game reward whose target selection dropped to the board. */
  rewardTarget?: {
    kind: "name_continent" | "found_major_city" | "cancel_scar" | "change_continent_bonus" | "fortify_city" | "found_minor_city";
    playerId: string;
    territoryId?: string;
    continentId?: string;
    delta: 1 | -1;
  };
  /** A held scar being played — the next legal board click selects a territory without an HQ or scar. */
  scarDialog?: { playerId: string; instanceId: string; scarId: string };
  scarTarget?: { playerId: string; instanceId: string; scarId: string; territoryId?: string };
  worldCapitalTarget?: { hostPlayerId: string; founderPlayerId: string; territoryId?: string };
  missionDialog?: boolean;
  privateMissionDialog?: boolean;
  alienIslandDialog?: boolean;
  /** new (UI-3): last-clicked territory — drives the rail inspector. */
  inspected?: string;
}

// new (UI-5): responsive breakpoint — desktop keeps board + rail; below it the layout is
// board-first with the rail's content in a bottom "table" drawer.
function useDesktop() {
  const [is, setIs] = useState(() => window.matchMedia("(min-width: 1024px)").matches);
  useEffect(() => {
    const m = window.matchMedia("(min-width: 1024px)");
    const fn = () => setIs(m.matches);
    m.addEventListener?.("change", fn);
    window.addEventListener("resize", fn); // some embedded webviews skip mediaquery change events
    return () => { m.removeEventListener?.("change", fn); window.removeEventListener("resize", fn); };
  }, []);
  return is;
}

export interface RewindControls {
  canReset: boolean;
  canBack: boolean;
  reason?: string;
  onReset: () => void;
  onBack: () => void;
}

export default function GameScreen({ gs, dispatch, onExit, error, viewer, rewind, canManageContent, presentationSource }: {
  gs: GameState;
  dispatch: (a: Action) => void;
  onExit: () => void;
  error: string | null;
  /** When set (networked), only this player's controls are live; hot-seat passes undefined. */
  viewer?: string;
  rewind?: RewindControls;
  canManageContent?: boolean;
  presentationSource?: TransitionSource;
}) {
  const [ui, setUi] = useState<UiState>({ placeCount: 1, moveCount: 1, expandCount: 1, selectedCards: [] });
  const [localError, setLocalError] = useState<string | null>(null);
  const [autoDefend, setAutoDefend] = useState<Record<string, boolean>>({}); // new (UI-8): per-player toggle, off by default
  const desktop = useDesktop(); // new (UI-5)
  const [drawerOpen, setDrawerOpen] = useState(false); // new (UI-5): mobile table drawer
  const [moments, setMoments] = useState<ImportantMoment[]>([]);
  const [autoAdvanceNotice, setAutoAdvanceNotice] = useState<string | null>(null);
  const pulseTimer = useRef<number | undefined>(undefined);
  const lastMomentEvent = useRef(gs.eventSeq);

  const actor = waitingOn(gs); // whoever the game waits on
  const actorPlayer = actor ? gs.players[actor] : undefined;
  const draftedFactionId = actor && gs.advancedDraft?.completed ? gs.advancedDraft.picks[actor]?.factionId : undefined;
  const setupFactionId = draftedFactionId ?? ui.pickedFaction;
  const canActFor = (pid?: string) => !!pid && (!viewer || pid === viewer); // networked: view-only unless it's your decision
  const canAct = !viewer || actor === viewer;
  const contentManager = canManageContent ?? !viewer;
  const privateMissionPoolCount = (gs.legacyCards as typeof gs.legacyCards & { privateMissionPoolCount?: number }).privateMissionPoolCount
    ?? gs.legacyCards.privateMissionPool.length;
  const privateMissionEligible = Object.values(gs.players).filter((player) =>
    player.factionId && !gs.capturedPrivateMissions[player.factionId]);
  const privateMissionActivatable = Object.values(gs.players).filter((player) =>
    gs.phase === "end_turn" && player.id === actor && player.factionId
    && gs.capturedPrivateMissions[player.factionId] && !gs.privateMissionsUsed.includes(player.factionId));
  const builtInPrivateMissionEligible = Object.values(gs.players).filter((player) =>
    gs.phase === "end_turn" && player.id === actor && (player.factionId === "mutants" || player.factionId === "aliens")
    && !gs.privateMissionsUsed.includes(player.factionId));
  const shownError = error ?? localError;

  const playerFaction = (pid?: string) => factionById(pid ? gs.players[pid]?.factionId : undefined)?.color;

  const doDispatch = (a: Action) => {
    dispatch(a);
    setUi((u) => ({ ...u, selectedCards: [] })); // card selections never survive an action
  };

  // Control passing: stale picks/selections never leak to the next decision-maker.
  const prevActor = useRef(actor);
  useEffect(() => {
    if (prevActor.current !== actor) {
      prevActor.current = actor;
      setUi((u) => ({
        ...u,
        pickedFaction: undefined,
        pickedPower: undefined,
        powerTear: undefined,
        selected: undefined,
        rewardTarget: undefined,
        scarDialog: undefined,
        scarTarget: undefined,
        worldCapitalTarget: undefined,
        maneuverMode: undefined,
      }));
    }
  }, [actor]);

  useEffect(() => () => window.clearTimeout(pulseTimer.current), []);

  useEffect(() => {
    const fresh = gs.log.filter((event) => event.seq > lastMomentEvent.current);
    lastMomentEvent.current = gs.eventSeq;
    const next = fresh.flatMap((event) => momentForEvent(gs, event));
    if (next.length > 0) setMoments((current) => [...current, ...next]);
  }, [gs]);

  useEffect(() => {
    if (!moments[0]) return;
    const id = window.setTimeout(() => setMoments((current) => current.slice(1)), 3200);
    return () => window.clearTimeout(id);
  }, [moments]);

  const pulseContinent = (continentId: string) => {
    window.clearTimeout(pulseTimer.current);
    setUi((u) => ({ ...u, pulseContinent: continentId }));
    pulseTimer.current = window.setTimeout(() => {
      setUi((u) => u.pulseContinent === continentId ? { ...u, pulseContinent: undefined } : u);
    }, 1700);
  };

  // new (UI-8): auto-defend with max dice — dispatches the defender dice choice when enabled.
  useEffect(() => {
    const c = gs.combat;
    if (!c || c.natural || c.awaitingMoveIn || c.attackerDice === undefined || c.defenderDice !== undefined) return;
    if (!autoDefend[c.defender] || !canActFor(c.defender)) return;
    doDispatch({ type: "attack.defenderDice", playerId: c.defender, count: Math.min(2, gs.territories[c.to].troops) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gs, autoDefend]);

  // Obvious no-choice phases resolve after a short explanatory beat. Deliberate
  // choices (finishing deployment and ending attacks) remain prominent CTAs.
  useEffect(() => {
    if (!actor || !canAct || gs.combat || gs.comebackChoice || gs.missilePowerChoice || gs.missionChoice
      || gs.phase === "game_over" || gs.phase === "setup") return;
    let action: Action | undefined;
    let notice: string | undefined;
    if (gs.phase === "start_turn" && startTurnDecision(gs, actor).autoAdvance) {
      action = { type: "start.done", playerId: actor };
      notice = "No Red Star purchase available. Moving to recruitment…";
    } else if (gs.phase === "maneuver") {
      const decision = maneuverDecision(gs, actor);
      if (decision.used || !decision.hasLegalMove) {
        action = { type: "phase.endManeuver", playerId: actor };
        notice = decision.used ? "Maneuver complete. Moving to end of turn…" : "No legal maneuver available. Moving on…";
      }
    } else if (gs.phase === "end_turn" && !gs.legacyCards.activeMission
      && privateMissionActivatable.length === 0
      && !(privateMissionPoolCount > 0 && privateMissionEligible.length > 0)
      && !endTurnDecision(gs, actor).drawAvailable) {
      action = { type: "end.turn", playerId: actor };
      notice = "No Resource draw decision. Ending turn…";
    }
    if (!action || !notice) return;
    setAutoAdvanceNotice(notice);
    const id = window.setTimeout(() => {
      setAutoAdvanceNotice(null);
      dispatch(action!);
    }, 850);
    return () => window.clearTimeout(id);
  }, [actor, canAct, dispatch, gs]);

  // Setup readiness: faction picked + power resolved (stored permanent choice or first-play pick).
  const setupReady = gs.phase === "setup"
    && (!gs.advancedDraft || gs.advancedDraft.completed)
    && !!setupFactionId
    && (!!(gs.factionPowers[setupFactionId] ?? ui.pickedPower)
      || factionDefinitionById(setupFactionId, gs.unlockedModules)?.startingPowers.length === 0)
    && !ui.powerTear;

  // new (UI-9): the bottom strip renders YOUR hand — the viewer when networked, the actor hot-seat.
  const stripPlayer = viewer ? (gs.players[viewer] ? viewer : undefined) : actor;
  const stripSelectable = !!actor && canAct && actor === stripPlayer &&
    (gs.phase === "start_turn" || (gs.phase === "join_or_recruit" && !!gs.recruit));

  // new (UI-12): board-eligibility predicate for a reward target kind
  const rewardEligible = (kind: NonNullable<UiState["rewardTarget"]>["kind"], tid: string): boolean => {
    const t = gs.territories[tid];
    switch (kind) {
      case "found_major_city": return !t.city;
      case "found_minor_city": return t.controller === ui.rewardTarget?.playerId && !t.city;
      case "cancel_scar": return t.scars.length > 0;
      case "fortify_city": return !!t.city;
      case "name_continent": return !gs.continents[territoryById(tid).continent]?.name;
      case "change_continent_bonus": return gs.continents[territoryById(tid).continent]?.bonusMark === undefined;
    }
  };

  // Phase-aware board highlights
  const highlights = useMemo<Record<string, Highlight>>(() => {
    const h: Record<string, Highlight> = {};
    if (ui.worldCapitalTarget) {
      for (const territory of manifest.territories) if (!gs.territories[territory.id].city) h[territory.id] = "highlight-start";
      if (ui.worldCapitalTarget.territoryId) h[ui.worldCapitalTarget.territoryId] = "selected";
      return h;
    }
    // new (UI-12): active targeting modes glow their legal targets and override phase highlights
    if (ui.scarTarget && canActFor(ui.scarTarget.playerId)) {
      for (const t of manifest.territories) {
        const territory = gs.territories[t.id];
        if (!territory.hqFaction && territory.scars.length === 0) h[t.id] = "highlight-start";
      }
      if (ui.scarTarget.territoryId) h[ui.scarTarget.territoryId] = "selected";
      return h;
    }
    if (gs.phase === "game_over" && ui.rewardTarget && canActFor(ui.rewardTarget.playerId)) {
      for (const t of manifest.territories) if (rewardEligible(ui.rewardTarget.kind, t.id)) h[t.id] = "highlight-start";
      if (ui.rewardTarget.territoryId) h[ui.rewardTarget.territoryId] = "selected";
      return h;
    }
    if (!actor || !canAct) {
      if (gs.combat) { h[gs.combat.from] = "selected"; h[gs.combat.to] = "highlight-attack"; }
      return h;
    }
    if (gs.phase === "setup" && setupFactionId) {
      for (const t of manifest.territories) if (isLegalStart(gs, t.id, true, setupFactionId, actor)) h[t.id] = "highlight-start";
    }
    if (gs.phase === "join_or_recruit") {
      const owned = Object.values(gs.territories).some((t) => t.controller === actor);
      if (!owned) {
        const fid = gs.players[actor].factionId;
        for (const t of manifest.territories) if (isLegalStart(gs, t.id, false, fid, actor)) h[t.id] = "highlight-start";
      } else if (gs.recruit && gs.recruit.remaining > 0) {
        for (const tid of territoryIds(gs)) if (gs.territories[tid].controller === actor) h[tid] = "highlight-recruit";
        if (hasFactionPower(gs, actor, "stealthy")) {
          for (const tid of territoryIds(gs)) {
            const territory = gs.territories[tid];
            const sameTarget = !gs.stealthRecruitTerritory || gs.stealthRecruitTerritory === tid;
            if (!territory.controller && territory.troops === 0 && !territory.city && !territory.fortification
                && territory.scars.length === 0 && sameTarget) h[tid] = "highlight-recruit";
          }
        }
      }
    }
    if (gs.phase === "expand_attack" && !gs.combat && ui.selected) {
      const from = gs.territories[ui.selected];
      if (from?.controller === actor) {
        h[ui.selected] = "selected";
        for (const n of neighborsOf(gs, ui.selected)) {
          const t = gs.territories[n];
          if (!t.controller && t.troops === 0) h[n] = "highlight-start";
          else if (t.controller && t.controller !== actor) h[n] = "highlight-attack";
        }
      }
    }
    if (gs.combat) {
      h[gs.combat.from] = "selected";
      h[gs.combat.to] = "highlight-attack";
    }
    const maneuver = actor ? maneuverDecision(gs, actor) : undefined;
    if ((gs.phase === "maneuver" || ui.maneuverMode) && maneuver?.available) {
      if (!ui.selected) {
        for (const tid of territoryIds(gs)) if (isManeuverSource(gs, actor, tid)) h[tid] = "highlight-move";
      } else {
        const from = gs.territories[ui.selected];
        if (from?.controller === actor && from.troops >= 2) {
          h[ui.selected] = "selected";
          for (const tid of maneuverDestinations(gs, actor, ui.selected)) h[tid] = "highlight-move";
        }
      }
    }
    if (ui.pulseContinent) {
      for (const t of manifest.territories) {
        if (t.continent === ui.pulseContinent && !h[t.id]) h[t.id] = "pulse-continent";
      }
    }
    return h;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gs, ui.selected, ui.pickedFaction, ui.rewardTarget, ui.scarTarget, ui.worldCapitalTarget, ui.pulseContinent, actor, canAct]);

  const tableInteraction = useMemo(() => {
    const base = deriveInteractionModel({
      state: gs,
      actorId: actor,
      viewerId: viewer,
      selectedTerritoryId: ui.selected,
      setupFactionId,
      setupPowerId: setupFactionId ? gs.factionPowers[setupFactionId] ?? ui.pickedPower : undefined,
      placeCount: ui.placeCount,
      moveCount: ui.moveCount,
      expandCount: ui.expandCount,
      overrideMode: ui.scarTarget ? "scar" : ui.rewardTarget || ui.worldCapitalTarget ? "reward" : undefined,
    });
    const intents = { ...base.territories } as Record<string, TerritoryIntent>;
    const mapping: Partial<Record<Highlight, TerritoryIntent>> = {
      selected: "selected",
      "highlight-attack": "attack",
      "highlight-move": "maneuver",
      "highlight-start": "start",
      "highlight-recruit": "recruit",
      "pulse-continent": "inspect",
      dimmed: "illegal",
    };
    for (const [territoryId, highlight] of Object.entries(highlights)) {
      const intent = mapping[highlight];
      if (intent) intents[territoryId] = intent;
    }
    return { ...base, territories: intents, selectedTerritoryId: ui.selected ?? base.selectedTerritoryId };
  }, [actor, gs, highlights, setupFactionId, ui.expandCount, ui.moveCount, ui.pickedPower, ui.placeCount, ui.rewardTarget, ui.scarTarget, ui.selected, ui.worldCapitalTarget, viewer]);

  const onTerritoryClick = (tid: string) => {
    setUi((u) => ({ ...u, inspected: tid })); // new (UI-3): every board click updates the inspector
    if (ui.worldCapitalTarget) {
      if (!manifest.territories.some((territory) => territory.id === tid)) return;
      if (gs.territories[tid].city) return;
      setUi((current) => ({ ...current, worldCapitalTarget: { ...current.worldCapitalTarget!, territoryId: tid } }));
      return;
    }
    // new (UI-12): scar play targeting — the holder acts on anyone's turn at a stable boundary
    if (ui.scarTarget) {
      const st = ui.scarTarget;
      if (!canActFor(st.playerId) || gs.territories[tid].hqFaction || gs.territories[tid].scars.length > 0) return;
      setUi((u) => ({ ...u, scarTarget: { ...st, territoryId: tid } }));
      return;
    }
    // new (UI-12): end-game reward targeting dropped to the board
    if (gs.phase === "game_over" && ui.rewardTarget) {
      if (!manifest.territories.some((territory) => territory.id === tid)) return;
      const rt = ui.rewardTarget;
      if (!canActFor(rt.playerId) || !rewardEligible(rt.kind, tid)) return;
      if (rt.kind === "cancel_scar" || rt.kind === "fortify_city") {
        doDispatch({ type: "reward.choose", playerId: rt.playerId, reward: { kind: rt.kind, territoryId: tid } });
        setUi((u) => ({ ...u, rewardTarget: undefined }));
        return;
      }
      if (rt.kind === "change_continent_bonus") {
        doDispatch({ type: "reward.choose", playerId: rt.playerId, reward: { kind: rt.kind, continentId: territoryById(tid).continent, delta: rt.delta } });
        setUi((u) => ({ ...u, rewardTarget: undefined }));
        return;
      }
      // name-carrying rewards: remember the target, the banner collects the name + confirm
      setUi((u) => ({
        ...u,
        rewardTarget: { ...rt, territoryId: tid, continentId: territoryById(tid).continent },
      }));
      return;
    }
    if (!actor || !canAct) return;
    const t = gs.territories[tid];

    const maneuverClick = () => {
      if (t.controller === actor && !ui.selected) {
        if (!isManeuverSource(gs, actor, tid)) {
          setLocalError("Maneuver sources need 2+ troops and a legal destination");
          return;
        }
        setLocalError(null);
        setUi((current) => ({ ...current, selected: tid }));
        return;
      }
      if (t.controller === actor && ui.selected === tid) {
        setUi((current) => ({ ...current, selected: undefined }));
        return;
      }
      if (ui.selected && highlights[tid] === "highlight-move") {
        const sourceTroops = gs.territories[ui.selected].troops;
        const count = clampCount(ui.moveCount, 1, sourceTroops - 1);
        doDispatch({ type: "maneuver.move", playerId: actor, from: ui.selected, to: tid, count });
        setUi((current) => ({ ...current, selected: undefined, maneuverMode: undefined }));
        return;
      }
      if (t.controller === actor) {
        if (!isManeuverSource(gs, actor, tid)) {
          setLocalError("Maneuver sources need 2+ troops and a legal destination");
          return;
        }
        setLocalError(null);
        setUi((current) => ({ ...current, selected: tid }));
      }
    };

    if (ui.maneuverMode) {
      maneuverClick();
      return;
    }
    switch (gs.phase) {
      case "setup": {
        if (!setupFactionId) { setLocalError("Pick a faction first"); return; }
        const stored = gs.factionPowers[setupFactionId];
        const needsPower = (factionDefinitionById(setupFactionId, gs.unlockedModules)?.startingPowers.length ?? 0) > 0;
        if (needsPower && !stored && !ui.pickedPower) { setLocalError("Pick a starting power first"); return; }
        // new (UI-3): illegal starts never dispatch — the inspector explains why instead
        if (!isLegalStart(gs, tid, true, setupFactionId, actor)) {
          setLocalError("Not a legal start — see the territory panel");
          return;
        }
        setLocalError(null);
        doDispatch({ type: "setup.choose", playerId: actor, factionId: setupFactionId, territoryId: tid, powerId: stored ? undefined : ui.pickedPower });
        return;
      }
      case "join_or_recruit": {
        const owned = Object.values(gs.territories).some((x) => x.controller === actor);
        if (!owned) return doDispatch({ type: "join.enter", playerId: actor, territoryId: tid });
        if (gs.recruit && (t.controller === actor || highlights[tid] === "highlight-recruit")) {
          const count = Math.min(ui.placeCount, gs.recruit.remaining);
          if (count > 0) doDispatch({ type: "recruit.place", playerId: actor, territoryId: tid, count });
        }
        return;
      }
      case "expand_attack": {
        if (gs.combat) return;
        if (t.controller === actor) return setUi((u) => ({ ...u, selected: tid }));
        if (ui.selected && neighborsOf(gs, ui.selected).includes(tid)) {
          if (!t.controller && t.troops === 0) {
            const sourceTroops = gs.territories[ui.selected].troops;
            const troops = clampCount(ui.expandCount, 1, sourceTroops - 1);
            return doDispatch({ type: "attack.expand", playerId: actor, from: ui.selected, to: tid, troops });
          }
          if (t.controller && t.controller !== actor) {
            return doDispatch({ type: "attack.declare", playerId: actor, from: ui.selected, to: tid });
          }
        }
        return;
      }
      case "maneuver": {
        maneuverClick();
        return;
      }
    }
  };

  return (
    <div className="relative h-full w-full min-w-0 grid grid-rows-[auto_1fr] overflow-hidden">
      {/* Command strip — signature element: ops-board phase track.
          new (UI-5): wraps to its own scrollable row below lg so nothing clips at 390px. */}
      <header className="relative z-[70] w-full max-w-full min-w-0 overflow-hidden border-b border-line bg-panel px-3 lg:px-6 py-2 lg:py-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <button onClick={onExit} className="font-mono text-xs text-muted hover:text-text">← HUB</button>
        {rewind && (
          <div className="hidden sm:flex items-center gap-1.5" title={rewind.reason}>
            <button type="button" onClick={rewind.onReset} disabled={!rewind.canReset}
              className="font-mono text-[10px] border border-line rounded-sm px-2 py-1 text-muted hover:text-text hover:border-signal disabled:opacity-30">
              RESET PHASE
            </button>
            <button type="button" onClick={rewind.onBack} disabled={!rewind.canBack}
              className="font-mono text-[10px] border border-line rounded-sm px-2 py-1 text-muted hover:text-text hover:border-signal disabled:opacity-30">
              ← BACK A PHASE
            </button>
          </div>
        )}
        <div className="ml-auto order-2 font-mono text-xs text-right">
          {gs.phase === "game_over" ? (
            <span className="text-signal">GAME OVER</span>
          ) : actorPlayer ? (
            <>
              <span className="text-muted">{canAct ? "ACTING: " : "WAITING ON: "}</span>
              <span className="inline-flex items-center gap-2" style={{ color: playerFaction(actor) ?? "var(--color-signal)" }}>
                <FactionEmblem factionId={actorPlayer.factionId} size="xs" />
                {actorPlayer.name}
              </span>
              <span className="text-muted"> · T{gs.turnNumber}</span>
            </>
          ) : null}
        </div>
        <nav className="order-3 w-full lg:order-1 lg:w-auto lg:flex-1 flex items-center gap-1 justify-start lg:justify-center overflow-x-auto" aria-label="Turn phases">
          {PHASES.map((p, i) => {
            const active = gs.phase === p.id || (gs.phase === "game_over" && p.id === "end_turn");
            return (
              <span key={p.id} className="flex items-center gap-1 shrink-0">
                {i > 0 && <span className="text-line">—</span>}
                <span className={`font-display font-bold tracking-widest text-xs lg:text-sm px-1.5 lg:px-2 py-0.5 rounded-sm whitespace-nowrap ${
                  active ? "bg-signal text-ink" : "text-muted"}`}>{p.label}</span>
              </span>
            );
          })}
        </nav>
      </header>

      <div className={`grid w-full max-w-full min-h-0 min-w-0 overflow-hidden ${desktop ? "grid-cols-[minmax(0,1fr)_clamp(400px,30vw,480px)]" : "grid-cols-1"}`}>{/* new (UI-5) */}
        <div className="grid w-full max-w-full grid-rows-[1fr_auto_auto] min-h-0 min-w-0 overflow-hidden">
          <div className="relative min-h-0 min-w-0 p-4 overflow-auto">
            {gs.phase === "setup" && actor && canAct && setupReady && setupFactionId && (
              <div className="sticky top-0 z-30 mb-3">
                <SetupDecisionBanner
                  actorName={actorPlayer!.name}
                  actorColor={factionById(setupFactionId)?.color}
                  you={!!viewer}
                  action="Click a highlighted territory to place your HQ"
                  factionId={setupFactionId}
                  factionName={factionById(setupFactionId)?.name}
                  powerName={powerName(gs.factionPowers[setupFactionId] ?? ui.pickedPower!)}
                  onChange={draftedFactionId ? undefined : () => setUi((u) => ({
                    ...u,
                    pickedFaction: undefined,
                    pickedPower: undefined,
                    powerTear: undefined,
                  }))}
                />
              </div>
            )}
            <div className="relative w-full max-h-full aspect-[749.819/519.068]">
              <GameTable authoritativeState={gs} viewerId={viewer} interaction={tableInteraction}
                onTerritoryActivate={onTerritoryClick} source={presentationSource ?? (viewer ? "network" : "local")} />
              <PhaseNotice gs={gs} actor={actor} actorPlayer={actorPlayer} canAct={canAct} />
              <PhaseProceed gs={gs} actor={actor} canAct={canAct} dispatch={doDispatch} />
              {shownError && (
                <div role="alert" className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-panel border border-danger text-danger font-mono text-xs px-4 py-2 rounded-sm">
                  {shownError}
                </div>
              )}
            </div>
            {/* new (UI-8): HQ placement hint once the takeover hands off to the board */}
            {ui.pickedFaction ? false && (
              <div className="absolute top-6 left-1/2 -translate-x-1/2 z-30 bg-panel border border-signal rounded-sm px-4 py-2 flex items-center gap-3">
                <DecisionChip name={actorPlayer!.name} color={factionById(ui.pickedFaction!)?.color}
                  factionId={ui.pickedFaction} you={!!viewer} />
                <span className="text-sm">
                  {factionById(ui.pickedFaction!)?.name} — {powerName(gs.factionPowers[ui.pickedFaction!] ?? ui.pickedPower!)}:
                  {" "}click a highlighted territory to place your HQ.
                </span>
                <button onClick={() => setUi((u) => ({ ...u, pickedFaction: undefined, pickedPower: undefined }))}
                  className="font-mono text-xs text-muted hover:text-text">CHANGE</button>
              </div>
            ) : null}
            {/* new (UI-12): scar-play targeting banner */}
            {ui.scarTarget && (
              <ScarTargetBanner gs={gs} ui={ui} setUi={setUi} dispatch={doDispatch} />
            )}
            {!ui.scarTarget && !gs.combat && (gs.phase === "start_turn" || gs.phase === "end_turn") && (
              <MissileInterruptBar gs={gs} dispatch={doDispatch} canActFor={canActFor} />
            )}
            {/* new (UI-12): reward targeting banner — glow → click → (name) → sticker on */}
            {gs.phase === "game_over" && ui.rewardTarget && (
              <RewardTargetBanner gs={gs} ui={ui} setUi={setUi} dispatch={doDispatch} />
            )}
            {contentManager && actor && gs.phase !== "setup" && gs.phase !== "game_over"
              && gs.unlockedModules.includes("pack_3_homelands_missions")
              && ((gs.phase === "end_turn" && gs.legacyCards.activeMission?.id.endsWith(":the-world-is-ready"))
                || (!gs.legacyCards.activeMission?.id.endsWith(":the-world-is-ready")
                  && gs.hostContent["pack_3_homelands_missions.missions"] !== undefined))
              && !gs.worldCapitalTerritoryId && !ui.worldCapitalTarget && gs.contentRequired.length === 0 && (
                <button type="button" onClick={() => setUi((current) => ({
                  ...current,
                  worldCapitalTarget: { hostPlayerId: viewer ?? actor, founderPlayerId: actor },
                }))}
                  className="absolute top-6 right-6 z-30 bg-panel border border-signal rounded-sm px-4 py-2 font-display font-bold tracking-widest text-xs text-signal shadow-xl">
                  HOST: WORLD CAPITAL MISSION
                </button>
              )}
            {contentManager && actor && gs.phase !== "setup" && gs.phase !== "game_over"
              && gs.unlockedModules.includes("pocket_2_alien_landing") && !gs.alienIsland
              && gs.contentRequired.length === 0 && !ui.alienIslandDialog && (
                <button type="button" onClick={() => setUi((current) => ({ ...current, alienIslandDialog: true }))}
                  className="absolute top-16 right-6 z-30 bg-panel border border-signal rounded-sm px-4 py-2 font-display font-bold tracking-widest text-xs text-signal shadow-xl">
                  HOST: PLACE ALIEN ISLAND
                </button>
              )}
            {contentManager && actor && gs.phase === "end_turn" && gs.legacyCards.activeMission
              && !gs.legacyCards.activeMission.id.endsWith(":the-world-is-ready")
              && !gs.legacyCards.pendingEvent && !ui.missionDialog && (
                <button type="button" onClick={() => setUi((current) => ({ ...current, missionDialog: true }))}
                  className="absolute top-6 left-6 z-30 bg-panel border border-signal rounded-sm px-4 py-2 font-display font-bold tracking-widest text-xs text-signal shadow-xl">
                  HOST: COMPLETE MISSION
                </button>
              )}
            {contentManager && actor && gs.phase !== "setup" && gs.phase !== "game_over"
              && gs.contentRequired.length === 0 && !ui.privateMissionDialog
              && ((gs.unlockedModules.includes("pack_4_lead_faction_private_missions")
                && ((privateMissionPoolCount > 0 && privateMissionEligible.length > 0) || privateMissionActivatable.length > 0))
                || builtInPrivateMissionEligible.length > 0) && (
                <button type="button" onClick={() => setUi((current) => ({ ...current, privateMissionDialog: true }))}
                  className="absolute top-16 left-6 z-30 bg-panel border border-signal rounded-sm px-4 py-2 font-display font-bold tracking-widest text-xs text-signal shadow-xl">
                  HOST: PRIVATE MISSIONS
                </button>
              )}
            {ui.worldCapitalTarget && (
              <WorldCapitalTargetBanner ui={ui} setUi={setUi} dispatch={doDispatch} />
            )}
          </div>
          {/* new (UI-8/UI-9): blocking card decisions dock above the hand strip */}
          {(gs.phase === "start_turn" || gs.phase === "end_turn") && actor && canAct ? (
            <TurnDecisionDock gs={gs} ui={ui} dispatch={doDispatch} actor={actor} />
          ) : <span />}
          <HandStrip gs={gs} player={stripPlayer} ui={ui} setUi={setUi} selectable={stripSelectable}
            scarPlayable={gs.phase !== "game_over" && !!stripPlayer && canActFor(stripPlayer)
              && !(gs.combat && (gs.combat.natural || gs.combat.awaitingMoveIn))} // new (UI-12): stable boundary only
            actions={actor && canAct ? ( // new (UI-2): non-blocking phase controls beside the hand/HUD
              <ActionBar gs={gs} ui={ui} setUi={setUi} dispatch={doDispatch} actor={actor} />
            ) : undefined} />
        </div>
        {desktop && (
          <aside className="border-l border-line bg-panel min-h-0 grid grid-rows-[1fr_auto]">
            <div className="overflow-y-auto">
              {ui.inspected && ( // new (UI-3): selected-territory inspector tops the rail
                <Inspector gs={gs} tid={ui.inspected} actor={actor} canAct={canAct} ui={ui} />
              )}
              <SidePanel gs={gs} actor={actor} playerFaction={playerFaction} />
            </div>
            <Ledger gs={gs} />{/* new (UI-2): collapsible BATTLE LOG tab */}
          </aside>
        )}
      </div>

      {/* new (UI-5): below the desktop breakpoint the table lives in a bottom drawer */}
      {!desktop && (
        <>
          <button onClick={() => setDrawerOpen((o) => !o)}
            className="absolute top-28 right-3 z-30 bg-panel border border-line rounded-sm px-3 py-1.5 font-mono text-xs text-muted hover:text-text shadow-lg">
            TABLE
          </button>
          {drawerOpen && (
            <div role="dialog" aria-label="Table" className="absolute inset-x-0 bottom-0 z-40 max-h-[70%] bg-panel border-t border-line grid grid-rows-[auto_1fr]">
              <div className="flex justify-end border-b border-line px-4 py-1.5">
                <button onClick={() => setDrawerOpen(false)} className="font-mono text-xs text-muted hover:text-text">CLOSE ▾</button>
              </div>
              <div className="overflow-y-auto">
                {ui.inspected && <Inspector gs={gs} tid={ui.inspected} actor={actor} canAct={canAct} ui={ui} />}
                <SidePanel gs={gs} actor={actor} playerFaction={playerFaction} />
                <Ledger gs={gs} />
              </div>
            </div>
          )}
        </>
      )}

      {/* new (UI-8): shared overlay layer — blocking decisions */}
      {gs.contentRequired?.length > 0 && (
        <ModuleContentPause key={`${gs.contentRequired[0].moduleId}.${gs.contentRequired[0].items[0]}`}
          gs={gs} dispatch={doDispatch} canManage={contentManager} actorId={viewer ?? gs.turnOrder[0]} />
      )}
      {gs.contentRequired?.length === 0 && gs.legacyCards.pendingEvent && (
        <EventResolutionModal gs={gs} dispatch={doDispatch} canManage={contentManager}
          actorId={viewer ?? gs.turnOrder[gs.activeIdx]} />
      )}
      {gs.contentRequired?.length === 0 && !gs.legacyCards.pendingEvent && gs.comebackChoice && (
        <ComebackPowerModal gs={gs} dispatch={doDispatch} canAct={canActFor(gs.comebackChoice.playerId)} />
      )}
      {gs.contentRequired?.length === 0 && !gs.legacyCards.pendingEvent && !gs.comebackChoice && gs.missilePowerChoice && (
        <MissilePowerModal gs={gs} dispatch={doDispatch} canAct={canActFor(gs.missilePowerChoice.playerId)} />
      )}
      {gs.contentRequired?.length === 0 && !gs.legacyCards.pendingEvent && !gs.comebackChoice && !gs.missilePowerChoice && gs.missionChoice && (
        <LeadMissionModal gs={gs} dispatch={doDispatch} canAct={canActFor(gs.missionChoice.playerId)} />
      )}
      {gs.contentRequired?.length === 0 && !gs.legacyCards.pendingEvent && ui.missionDialog && gs.legacyCards.activeMission && (
        <MissionCompletionModal gs={gs} dispatch={doDispatch} setUi={setUi}
          canManage={contentManager} actorId={viewer ?? gs.turnOrder[gs.activeIdx]} />
      )}
      {gs.contentRequired?.length === 0 && !gs.legacyCards.pendingEvent && !gs.comebackChoice && ui.privateMissionDialog && (
        <PrivateMissionModal gs={gs} dispatch={doDispatch} setUi={setUi}
          canManage={contentManager} actorId={viewer ?? gs.turnOrder[gs.activeIdx]} />
      )}
      {gs.contentRequired?.length === 0 && !gs.legacyCards.pendingEvent && !gs.comebackChoice && ui.alienIslandDialog && (
        <AlienIslandModal dispatch={doDispatch} setUi={setUi}
          canManage={contentManager} actorId={viewer ?? gs.turnOrder[gs.activeIdx]} />
      )}
      {gs.contentRequired?.length === 0 && !gs.legacyCards.pendingEvent && gs.phase === "setup" && actor && canAct
        && gs.advancedDraft && !gs.advancedDraft.completed && (
        <AdvancedDraftTakeover gs={gs} actor={actor} dispatch={doDispatch} you={!!viewer} />
      )}
      {gs.contentRequired?.length === 0 && !gs.legacyCards.pendingEvent && gs.phase === "setup" && actor && canAct
        && (!gs.advancedDraft || gs.advancedDraft.completed) && !setupReady && (
        <SetupTakeover gs={gs} ui={ui} setUi={setUi} actor={actor} you={!!viewer} />
      )}
      {gs.contentRequired?.length === 0 && !gs.legacyCards.pendingEvent && gs.combat && (
        <CombatOverlay gs={gs} dispatch={doDispatch} canActFor={canActFor} autoDefend={autoDefend}
          onAutoDefend={(pid, on) => setAutoDefend((m) => ({ ...m, [pid]: on }))} />
      )}
      {gs.contentRequired?.length === 0 && !gs.legacyCards.pendingEvent && ui.scarDialog && (
        <ScarPlayModal gs={gs} ui={ui} setUi={setUi} canActFor={canActFor} dispatch={doDispatch} />
      )}
      {gs.contentRequired?.length === 0 && gs.phase === "game_over" && gs.winner && ( // new (UI-12): victory → signing → rewards → aftermath
        !gs.comebackChoice && <VictoryFlow gs={gs} dispatch={doDispatch} canActFor={canActFor} ui={ui} setUi={setUi} />
      )}
      {autoAdvanceNotice && (
        <div role="status" className="fixed left-1/2 bottom-8 -translate-x-1/2 z-[75] bg-panel border border-signal rounded-sm px-5 py-3 shadow-2xl font-display font-bold tracking-wide text-signal">
          {autoAdvanceNotice}
        </div>
      )}
      {moments[0] && (
        <button type="button" aria-label="Dismiss game announcement" onClick={() => setMoments((current) => current.slice(1))}
          className="fixed inset-0 z-[90] flex items-center justify-center bg-ink/65 p-5 cursor-pointer">
          <div className={`w-full max-w-xl bg-panel border-2 rounded-sm px-8 py-7 text-center shadow-2xl ${
            moments[0].tone === "danger" ? "border-danger" : "border-signal"
          }`}>
            {moments[0].playerId && (
              <FactionEmblem factionId={gs.players[moments[0].playerId!]?.factionId} size="lg" className="mx-auto mb-4" />
            )}
            <div className={`font-display font-black tracking-[0.14em] text-4xl ${moments[0].tone === "danger" ? "text-danger" : "text-signal"}`}>
              {moments[0].title}
            </div>
            <p className="mt-3 text-lg text-text leading-snug">{moments[0].detail}</p>
            <div className="mt-4 font-mono text-[10px] uppercase tracking-widest text-muted">Click anywhere to continue</div>
          </div>
        </button>
      )}
    </div>
  );
}

// new (UI-12): board-target banner for a chosen reward — instruction, optional name entry, confirm.
function ModuleContentPause({ gs, dispatch, canManage, actorId }: {
  gs: GameState;
  dispatch: (action: Action) => void;
  canManage: boolean;
  actorId: string;
}) {
  const requirement = gs.contentRequired[0];
  const item = requirement.items[0];
  const [content, setContent] = useState("");
  const moduleName = contentPack.unlockModules.find((module) => module.id === requirement.moduleId)?.name ?? requirement.moduleId;
  return (
    <CenterOverlay label="Sealed content required">
      <div className="space-y-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-danger">Play is paused</p>
          <h2 className="font-display font-bold tracking-widest text-xl text-signal mt-1">{moduleName}</h2>
        </div>
        <p className="text-sm text-muted">
          Open the physical package and enter the <strong className="text-text">{item}</strong> content exactly as printed.
          The pending game state will resume only after every required item is supplied.
        </p>
        <textarea aria-label={`Sealed content: ${requirement.moduleId}.${item}`}
          value={content} onChange={(event) => setContent(event.target.value)} disabled={!canManage}
          placeholder={canManage ? "Enter the physical card or sticker text" : "Waiting for the campaign host"}
          className="w-full min-h-36 bg-ink border border-line rounded-sm p-3 text-sm" />
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[10px] text-muted">{requirement.items.length} item(s) remain in this package</span>
          <Btn tone="primary" disabled={!canManage || !content.trim()} onClick={() => dispatch({
            type: "module.supplyContent",
            playerId: actorId,
            moduleId: requirement.moduleId,
            item,
            content,
          })}>SAVE &amp; RESUME</Btn>
        </div>
      </div>
    </CenterOverlay>
  );
}

function AlienIslandModal({ dispatch, setUi, canManage, actorId }: {
  dispatch: (action: Action) => void;
  setUi: (fn: (ui: UiState) => UiState) => void;
  canManage: boolean;
  actorId: string;
}) {
  const [name, setName] = useState("Alien Island");
  const [first, setFirst] = useState(manifest.territories[0].id);
  const [second, setSecond] = useState(manifest.territories[1].id);
  return (
    <CenterOverlay label="Place Alien Island">
      <div className="space-y-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-danger">Pocket 2 topology change</p>
          <h2 className="font-display font-bold tracking-widest text-xl text-signal mt-1">PLACE ALIEN ISLAND</h2>
        </div>
        <p className="text-sm text-muted">Choose the two coastal territories specified or approved by the physical component. These permanent sea lines become bidirectional attack and maneuver routes.</p>
        <input aria-label="Alien Island name" value={name} onChange={(event) => setName(event.target.value)} disabled={!canManage}
          className="w-full bg-ink border border-line rounded-sm px-3 py-2 text-sm" />
        <div className="grid grid-cols-2 gap-3">
          {[{ label: "First sea line", value: first, set: setFirst }, { label: "Second sea line", value: second, set: setSecond }].map((field) => (
            <label key={field.label} className="font-mono text-xs text-muted">{field.label}
              <select aria-label={field.label} value={field.value} onChange={(event) => field.set(event.target.value)} disabled={!canManage}
                className="block w-full mt-1 bg-ink border border-line rounded-sm px-3 py-2 text-sm text-text">
                {manifest.territories.map((territory) => <option key={territory.id} value={territory.id}>{territory.name}</option>)}
              </select>
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Btn onClick={() => setUi((current) => ({ ...current, alienIslandDialog: false }))}>CANCEL</Btn>
          <Btn tone="primary" disabled={!canManage || !name.trim() || first === second} onClick={() => {
            dispatch({ type: "alien.placeIsland", playerId: actorId, name, connections: [first, second] });
            setUi((current) => ({ ...current, alienIslandDialog: false }));
          }}>PLACE ISLAND</Btn>
        </div>
      </div>
    </CenterOverlay>
  );
}

function PrivateMissionModal({ gs, dispatch, setUi, canManage, actorId }: {
  gs: GameState;
  dispatch: (action: Action) => void;
  setUi: (fn: (ui: UiState) => UiState) => void;
  canManage: boolean;
  actorId: string;
}) {
  const eligible = Object.values(gs.players).filter((player) =>
    player.factionId && !gs.capturedPrivateMissions[player.factionId]);
  const activatable = Object.values(gs.players).filter((player) =>
    gs.phase === "end_turn" && player.id === gs.turnOrder[gs.activeIdx] && player.factionId
    && gs.capturedPrivateMissions[player.factionId] && !gs.privateMissionsUsed.includes(player.factionId));
  const builtIn = Object.values(gs.players).filter((player) =>
    gs.phase === "end_turn" && player.id === gs.turnOrder[gs.activeIdx]
    && (player.factionId === "mutants" || player.factionId === "aliens") && !gs.privateMissionsUsed.includes(player.factionId));
  const [claimantPlayerId, setClaimantPlayerId] = useState(eligible[0]?.id ?? "");
  const [missionTitle, setMissionTitle] = useState("");
  return (
    <CenterOverlay label="Private missions">
      <div className="space-y-5">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Pack 4 host adjudication</p>
          <h2 className="font-display font-bold tracking-widest text-xl text-signal mt-1">PRIVATE MISSIONS</h2>
        </div>
        {eligible.length > 0 && ((gs.legacyCards as typeof gs.legacyCards & { privateMissionPoolCount?: number }).privateMissionPoolCount
          ?? gs.legacyCards.privateMissionPool.length) > 0 && (
          <section className="space-y-2 border border-line rounded-sm p-3">
            <h3 className="font-display font-bold tracking-widest text-sm">CAPTURE A PHYSICAL CARD</h3>
            <select aria-label="Private Mission claimant" value={claimantPlayerId}
              onChange={(event) => setClaimantPlayerId(event.target.value)} disabled={!canManage}
              className="w-full bg-ink border border-line rounded-sm px-3 py-2 text-sm">
              {eligible.map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}
            </select>
            <input aria-label="Private Mission title" value={missionTitle}
              onChange={(event) => setMissionTitle(event.target.value)} disabled={!canManage}
              placeholder="Enter the exact physical card title" list="private-mission-titles"
              className="w-full bg-ink border border-line rounded-sm px-3 py-2 text-sm" />
            <datalist id="private-mission-titles">
              {gs.legacyCards.privateMissionPool.map((mission) => <option key={mission.id} value={mission.title} />)}
            </datalist>
            <Btn tone="primary" disabled={!canManage || !claimantPlayerId || !missionTitle.trim()} onClick={() => {
              dispatch({ type: "privateMission.capture", playerId: actorId, claimantPlayerId, missionTitle });
              setUi((current) => ({ ...current, privateMissionDialog: false }));
            }}>CAPTURE MISSION</Btn>
          </section>
        )}
        {activatable.length > 0 && (
          <section className="space-y-2 border border-line rounded-sm p-3">
            <h3 className="font-display font-bold tracking-widest text-sm">ACTIVATE ONCE THIS GAME</h3>
            {activatable.map((player) => (
              <button key={player.id} type="button" disabled={!canManage}
                onClick={() => {
                  dispatch({ type: "privateMission.activate", playerId: actorId, claimantPlayerId: player.id });
                  setUi((current) => ({ ...current, privateMissionDialog: false }));
                }} className="w-full text-left border border-line rounded-sm px-3 py-2 hover:border-signal disabled:opacity-40">
                <span className="font-display font-bold text-sm">{player.name}</span>
                <span className="block text-xs text-muted mt-1">{gs.capturedPrivateMissions[player.factionId!].title}</span>
                <span className="block text-xs text-muted">{gs.capturedPrivateMissions[player.factionId!].text}</span>
              </button>
            ))}
          </section>
        )}
        {builtIn.length > 0 && (
          <section className="space-y-2 border border-line rounded-sm p-3">
            <h3 className="font-display font-bold tracking-widest text-sm">FACTION PRIVATE MISSION</h3>
            {builtIn.map((player) => (
              <button key={player.id} type="button" disabled={!canManage}
                onClick={() => {
                  dispatch({ type: "faction.claimPrivateMission", playerId: actorId, claimantPlayerId: player.id });
                  setUi((current) => ({ ...current, privateMissionDialog: false }));
                }} className="w-full text-left border border-line rounded-sm px-3 py-2 hover:border-signal disabled:opacity-40">
                <span className="font-display font-bold text-sm">{player.name} · {factionById(player.factionId)?.name}</span>
                <span className="block text-xs text-muted">
                  {player.factionId === "mutants" ? "Control every Biohazard and Fallout territory." : "Control every city on the board."}
                </span>
              </button>
            ))}
          </section>
        )}
        <div className="flex justify-end"><Btn onClick={() => setUi((current) => ({ ...current, privateMissionDialog: false }))}>CLOSE</Btn></div>
      </div>
    </CenterOverlay>
  );
}

function ComebackPowerModal({ gs, dispatch, canAct }: {
  gs: GameState;
  dispatch: (action: Action) => void;
  canAct: boolean;
}) {
  const choice = gs.comebackChoice!;
  const player = gs.players[choice.playerId];
  return (
    <CenterOverlay label="Choose a comeback power">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <FactionEmblem factionId={choice.factionId} size="md" />
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-danger">Faction eliminated</p>
            <h2 className="font-display font-bold tracking-widest text-xl text-signal">{player.name}: choose one permanent power</h2>
          </div>
        </div>
        <p className="text-sm text-muted">This power attaches to the faction and remains available in future games.</p>
        <div className="grid gap-2">
          {choice.options.map((option) => (
            <button key={option.id} type="button" disabled={!canAct}
              onClick={() => dispatch({ type: "comeback.choose", playerId: choice.playerId, optionId: option.id })}
              className="text-left border border-line rounded-sm p-3 hover:border-signal disabled:opacity-40">
              <span className="block font-display font-bold tracking-widest text-sm text-signal">{option.title}</span>
              <span className="block text-xs text-muted mt-1 whitespace-pre-wrap">{option.text}</span>
            </button>
          ))}
        </div>
        {!canAct && <p className="font-mono text-xs text-muted text-right">Waiting for {player.name}</p>}
      </div>
    </CenterOverlay>
  );
}

function LeadMissionModal({ gs, dispatch, canAct }: {
  gs: GameState;
  dispatch: (action: Action) => void;
  canAct: boolean;
}) {
  const choice = gs.missionChoice!;
  const player = gs.players[choice.playerId];
  return (
    <CenterOverlay label="Lead Faction chooses the Mission">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <FactionEmblem factionId={player.factionId} size="md" />
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Lead Faction privilege</p>
            <h2 className="font-display font-bold tracking-widest text-xl">{player.name}: choose the face-up Mission</h2>
          </div>
        </div>
        <p className="text-sm text-muted">
          {choice.reason === "world_capital"
            ? "The World Capital packet has joined the war. Choose the next Mission, then the remaining deck is reshuffled."
            : "Choose the opening Mission for this game. The remaining deck will be reshuffled."}
        </p>
        {canAct ? (
          <div className="grid gap-2 max-h-[55vh] overflow-y-auto pr-1">
            {gs.legacyCards.missionDeck.map((mission) => (
              <button key={mission.id} type="button"
                onClick={() => dispatch({ type: "mission.choose", playerId: choice.playerId, missionId: mission.id })}
                className="text-left border border-line rounded-sm p-3 hover:border-signal">
                <span className="block font-display font-bold tracking-widest text-sm text-signal">{mission.title}</span>
                <span className="block text-xs text-muted mt-1">{mission.text}</span>
                {mission.reward && <span className="block font-mono text-[10px] mt-2">REWARD · {mission.reward} RED STAR{mission.reward > 1 ? "S" : ""}</span>}
              </button>
            ))}
          </div>
        ) : (
          <p className="font-mono text-xs text-muted text-right">Waiting for {player.name}</p>
        )}
      </div>
    </CenterOverlay>
  );
}

const MISSILE_POWER_COPY: Record<string, { title: string; text: string }> = {
  recon: { title: "Recon", text: "Before drawing a Coin card, spend a Missile to take any face-up Territory card." },
  bad_intel: { title: "Bad Intel", text: "At another player's turn start, spend a Missile to deny one continent bonus." },
  rally: { title: "Rally", text: "At your turn start, spend a Missile to add two troops in every HQ you control." },
  emp: { title: "EMP", text: "Before a combat roll, spend a Missile to prevent die modification in that territory this turn." },
  interference: { title: "Interference", text: "As a Resource card is drawn, spend a Missile to block that card." },
};

function MissilePowerModal({ gs, dispatch, canAct }: {
  gs: GameState;
  dispatch: (action: Action) => void;
  canAct: boolean;
}) {
  const choice = gs.missilePowerChoice!;
  const player = gs.players[choice.playerId];
  return (
    <CenterOverlay label="Choose a Missile power">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <FactionEmblem factionId={choice.factionId} size="md" />
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-signal">Red Star earned · brown slot unlocked</p>
            <h2 className="font-display font-bold tracking-widest text-xl">{player.name}: choose one permanent Missile Power</h2>
          </div>
        </div>
        <p className="text-sm text-muted">Each activation costs one Missile and may be used once per turn.</p>
        <div className="grid gap-2">
          {choice.options.map((powerId) => {
            const copy = MISSILE_POWER_COPY[powerId] ?? { title: powerName(powerId), text: "Spend one Missile to activate." };
            return (
              <button key={powerId} type="button" disabled={!canAct}
                onClick={() => dispatch({ type: "missilePower.choose", playerId: choice.playerId, powerId })}
                className="text-left border border-line rounded-sm p-3 hover:border-signal disabled:opacity-40">
                <span className="block font-display font-bold tracking-widest text-sm text-signal">{copy.title}</span>
                <span className="block text-xs text-muted mt-1">{copy.text}</span>
              </button>
            );
          })}
        </div>
      </div>
    </CenterOverlay>
  );
}

function EventResolutionModal({ gs, dispatch, canManage, actorId }: {
  gs: GameState;
  dispatch: (action: Action) => void;
  canManage: boolean;
  actorId: string;
}) {
  const eventCard = gs.legacyCards.pendingEvent!;
  const [note, setNote] = useState("");
  const [resolutionText, setResolutionText] = useState("");
  const [resolutionError, setResolutionError] = useState<string>();
  const sourced = [
    /:fortify-\d+$/, /:control-the-people-\d+$/, /:riots$/, /:resistance-\d+$/,
    /:join-the-cause-\d+$/, /:fallout-\d+$/, /:agent-of-chaos-\d+$/, /:mutants-evolve-\d+$/,
    /:ruins-\d+$/, /:reinforcements-\d+$/, /:mysterious-island-\d+$/,
  ].some((pattern) => pattern.test(eventCard.id));
  const alienActorExists = Object.values(gs.players).some((player) => player.factionId === "aliens") || !!gs.alienAlliancePlayerId;
  const resolutionOptional = (eventCard.id.includes(":ruins-")
      && (!alienActorExists || !Object.values(gs.territories).some((territory) => territory.city?.type === "minor")))
    || (eventCard.id.includes(":reinforcements-")
      && (!alienActorExists || !Object.values(gs.territories).some((territory) => !!territory.city && territory.troops === 0 && !territory.controller)))
    || (eventCard.id.includes(":mysterious-island-")
      && (!gs.alienIsland || !gs.territories[gs.alienIsland.territoryId]?.controller || gs.sideboard.slots.every((cardId) => !cardId)));
  const automaticResolution = (): Extract<Action, { type: "event.resolve" }>["resolution"] => {
    if (eventCard.id.endsWith(":riots")) return { kind: "riots" };
    if (eventCard.id.includes(":resistance-")) return { kind: "resistance" };
    if (eventCard.id.includes(":fallout-")) return { kind: "fallout" };
    if (eventCard.id.includes(":agent-of-chaos-")) return { kind: "agentOfChaos" };
    return undefined;
  };
  const example = eventCard.id.includes(":fortify-")
    ? '{"kind":"reinforceCities","placements":[{"territoryId":"alaska","count":2}]}'
    : eventCard.id.includes(":control-the-people-")
      ? '{"kind":"controlPeopleTroops","territoryId":"alaska"}'
      : eventCard.id.includes(":join-the-cause-")
        ? '{"kind":"joinCauseTroops","placements":[{"territoryId":"alaska","count":3}]}'
        : eventCard.id.includes(":mutants-evolve-")
          ? `{"kind":"mutantsEvolve","choice":"${gs.mutantEvolutionChoices.length === 0 ? "offensive" : "bodies"}"}`
          : eventCard.id.includes(":ruins-")
            ? '{"kind":"alienRuins","territoryId":"alaska"}'
            : eventCard.id.includes(":reinforcements-")
              ? '{"kind":"alienReinforcements","territoryId":"alaska"}'
              : eventCard.id.includes(":mysterious-island-") ? '{"kind":"alienIslandCard","slot":0}' : "";
  const commit = (destination: "box" | "discard" | "ongoing") => {
    try {
      const resolution = automaticResolution() ?? (resolutionText.trim()
        ? JSON.parse(resolutionText) as Extract<Action, { type: "event.resolve" }>["resolution"]
        : undefined);
      if (sourced && !resolution && !resolutionOptional) throw new Error("Enter the card's choice data before resolving.");
      setResolutionError(undefined);
      dispatch({ type: "event.resolve", playerId: actorId, destination, note, resolution });
    } catch (error) {
      setResolutionError(error instanceof Error ? error.message : "Invalid Event resolution data");
    }
  };
  return (
    <CenterOverlay label="Event card">
      <div className="space-y-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-danger">Even Resource revealed in slot 1</p>
          <h2 className="font-display font-bold tracking-widest text-xl text-signal mt-1">{eventCard.title}</h2>
        </div>
        <p className="whitespace-pre-wrap text-sm text-text">{eventCard.text}</p>
        <p className="text-xs text-muted">Resolve the physical card completely, then record where its instructions place it.</p>
        {sourced && !automaticResolution() && (
          <textarea aria-label="Event resolution data" value={resolutionText} onChange={(event) => setResolutionText(event.target.value)}
            disabled={!canManage} placeholder={example || "Event resolution JSON"}
            className="w-full min-h-20 bg-ink border border-line rounded-sm p-3 font-mono text-xs" />
        )}
        {resolutionError && <p role="alert" className="text-xs text-danger">{resolutionError}</p>}
        <textarea aria-label="Event resolution note" value={note} onChange={(event) => setNote(event.target.value)}
          disabled={!canManage} placeholder={canManage ? "Optional resolution note" : "Waiting for the campaign host"}
          className="w-full min-h-20 bg-ink border border-line rounded-sm p-3 text-sm" />
        <div className="flex flex-wrap justify-end gap-2">
          {(["box", "discard", "ongoing"] as const).map((destination) => (
            <Btn key={destination} tone={destination === "box" ? "primary" : undefined} disabled={!canManage}
              onClick={() => commit(destination)}>
              {destination === "box" ? "RETURN TO BOX" : destination === "discard" ? "EVENT DISCARD" : "KEEP ONGOING"}
            </Btn>
          ))}
        </div>
      </div>
    </CenterOverlay>
  );
}

function MissionCompletionModal({ gs, dispatch, setUi, canManage, actorId }: {
  gs: GameState;
  dispatch: (action: Action) => void;
  setUi: (fn: (ui: UiState) => UiState) => void;
  canManage: boolean;
  actorId: string;
}) {
  const mission = gs.legacyCards.activeMission!;
  const claimantPlayerId = gs.turnOrder[gs.activeIdx];
  const [reward, setReward] = useState<1 | 2>(mission.reward ?? 1);
  const [seaFirst, setSeaFirst] = useState(manifest.territories[0].id);
  const [seaSecond, setSeaSecond] = useState(manifest.territories[1].id);
  const explore = mission.id.endsWith(":explore-the-world");
  return (
    <CenterOverlay label="Complete mission">
      <div className="space-y-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted">Host-confirm physical completion</p>
          <h2 className="font-display font-bold tracking-widest text-xl text-signal mt-1">{mission.title}</h2>
        </div>
        <p className="whitespace-pre-wrap text-sm text-text">{mission.text}</p>
        <p className="text-sm text-muted">
          {gs.players[claimantPlayerId].name} completes this instead of drawing a Resource card.
        </p>
        {explore && (
          <div className="grid sm:grid-cols-2 gap-2">
            <label className="text-xs text-muted">First sea-line territory
              <select value={seaFirst} onChange={(event) => setSeaFirst(event.target.value)} className="block w-full bg-ink border border-line p-2 mt-1">
                {manifest.territories.map((territory) => <option key={territory.id} value={territory.id}>{territory.name}</option>)}
              </select>
            </label>
            <label className="text-xs text-muted">Second sea-line territory
              <select value={seaSecond} onChange={(event) => setSeaSecond(event.target.value)} className="block w-full bg-ink border border-line p-2 mt-1">
                {manifest.territories.map((territory) => <option key={territory.id} value={territory.id}>{territory.name}</option>)}
              </select>
            </label>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted">RED STAR REWARD</span>
          {([1, 2] as const).map((value) => (
            <Btn key={value} tone={reward === value ? "primary" : undefined}
              disabled={!canManage || (mission.reward !== undefined && mission.reward !== value)}
              onClick={() => setReward(value)}>{value}</Btn>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Btn onClick={() => setUi((current) => ({ ...current, missionDialog: false }))}>CANCEL</Btn>
          <Btn tone="primary" disabled={!canManage} onClick={() => {
            dispatch({ type: "mission.complete", playerId: actorId, claimantPlayerId, reward,
              ...(explore ? { seaLineConnection: [seaFirst, seaSecond] as [string, string] } : {}) });
            setUi((current) => ({ ...current, missionDialog: false }));
          }}>CONFIRM MISSION</Btn>
        </div>
      </div>
    </CenterOverlay>
  );
}

function momentForEvent(gs: GameState, event: GameEvent): ImportantMoment[] {
  const playerName = event.playerId ? gs.players[event.playerId]?.name ?? "A player" : "A player";
  const by = typeof event.data?.by === "string" ? gs.players[event.data.by]?.name : undefined;
  if (event.type === "RedStarGained") {
    const territory = typeof event.data?.territory === "string" ? territoryName(event.data.territory) : "an enemy HQ";
    return [{ key: event.seq, title: "RED STAR EARNED", detail: `${playerName} captured the HQ in ${territory}. That HQ now counts as a Red Star.`, playerId: event.playerId, tone: "signal" }];
  }
  if (event.type === "RedStarPurchased" || event.type === "CoinDepletionRedStar") {
    const reason = event.type === "RedStarPurchased" ? "purchased a Red Star" : "earned the final coin-pile Red Star";
    return [{ key: event.seq, title: "RED STAR EARNED", detail: `${playerName} ${reason}.`, playerId: event.playerId, tone: "signal" }];
  }
  if (event.type === "PlayerKnockedOut") {
    return [{ key: event.seq, title: "PLAYER KNOCKED OUT", detail: `${playerName} was knocked out${by ? ` by ${by}` : ""}. They may still return by Joining the War.`, playerId: event.playerId, tone: "danger" }];
  }
  if (event.type === "PlayerEliminated") {
    return [{ key: event.seq, title: "PLAYER ELIMINATED", detail: `${playerName} has no legal way to rejoin and is out of this game.`, playerId: event.playerId, tone: "danger" }];
  }
  return [];
}

function PhaseProceed({ gs, actor, canAct, dispatch }: {
  gs: GameState;
  actor?: string;
  canAct: boolean;
  dispatch: (action: Action) => void;
}) {
  if (!actor || !canAct || gs.combat) return null;
  let label: string | undefined;
  let action: Action | undefined;
  if (gs.phase === "join_or_recruit" && gs.recruit?.remaining === 0) {
    label = "DEPLOYMENT COMPLETE  →  ATTACK";
    action = { type: "recruit.done", playerId: actor };
  } else if (gs.phase === "expand_attack") {
    label = "DONE ATTACKING  →  MANEUVER";
    action = { type: "phase.endAttacks", playerId: actor };
  } else if (gs.phase === "maneuver" && maneuverDecision(gs, actor).hasLegalMove) {
    label = "SKIP MANEUVER  →  END TURN";
    action = { type: "phase.endManeuver", playerId: actor };
  }
  if (!label || !action) return null;
  return (
    <button type="button" onClick={() => dispatch(action!)}
      className="absolute left-1/2 bottom-5 z-30 -translate-x-1/2 rounded-sm border border-signal bg-panel/95 px-5 py-3 font-display font-black tracking-widest text-signal shadow-2xl hover:bg-signal hover:text-ink">
      {label}
    </button>
  );
}

function PhaseNotice({ gs, actor, actorPlayer, canAct }: {
  gs: GameState;
  actor?: string;
  actorPlayer?: GameState["players"][string];
  canAct: boolean;
}) {
  if (!actor || !actorPlayer || gs.phase === "setup" || gs.phase === "game_over") return null;
  let action = canAct ? "Resolve your current decision." : `${actorPlayer.name} is resolving this phase.`;
  let detail: React.ReactNode = null;

  if (gs.phase === "start_turn") {
    action = canAct ? "Buy Red Stars or begin recruitment." : `${actorPlayer.name} may buy Red Stars before recruitment.`;
  } else if (gs.phase === "join_or_recruit") {
    const owned = Object.values(gs.territories).some((t) => t.controller === actor);
    if (!owned || !gs.recruit) {
      action = canAct
        ? `Join the war with ${joinWarTroops(gs, actor)} troops on a highlighted territory.`
        : `${actorPlayer.name} is joining the war with ${joinWarTroops(gs, actor)} troops.`;
    } else {
      action = gs.recruit.remaining > 0
        ? (canAct ? "Place generated troops on your territories." : `${actorPlayer.name} is placing troops.`)
        : (canAct ? "All troops placed. Advance to Attack." : `${actorPlayer.name} can advance to Attack.`);
      detail = (
        <span>
          Total {gs.recruit.breakdown.total} / Remaining {gs.recruit.remaining}
        </span>
      );
    }
  } else if (gs.phase === "expand_attack") {
    action = canAct ? "Attack, expand, or end attacks." : `${actorPlayer.name} is attacking or expanding.`;
  } else if (gs.phase === "maneuver") {
    action = gs.maneuverUsed
      ? (canAct ? "Maneuver used. End maneuver to continue." : `${actorPlayer.name} has used their maneuver.`)
      : (canAct ? "Move troops once, or end maneuver." : `${actorPlayer.name} may maneuver once.`);
  } else if (gs.phase === "end_turn") {
    action = canAct ? "Draw if eligible, then end turn." : `${actorPlayer.name} is ending the turn.`;
  }

  return (
    <div className="phase-notice hidden sm:block absolute left-3 bottom-3 z-20 max-w-[min(92%,520px)] pointer-events-none">
      <div className="bg-panel/95 border border-line rounded-sm px-4 py-3 shadow-xl shadow-black/30">
        <div className="font-mono text-[10px] uppercase tracking-[0.24em] text-muted">
          {canAct ? "Current phase" : "Waiting"}
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="font-display font-extrabold tracking-widest text-2xl text-signal">{phaseLabel(gs.phase)}</span>
          <span className="inline-flex items-center gap-2 text-sm text-text">
            <FactionEmblem factionId={actorPlayer.factionId} size="xs" />
            {actorPlayer.name}
          </span>
          {detail && <span className="font-mono text-xs text-signal">{detail}</span>}
        </div>
        <div className="text-sm text-text leading-snug">{action}</div>
      </div>
    </div>
  );
}

function clampCount(value: number, min: number, max: number) {
  const safeMax = Math.max(min, max);
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.round(value), min), safeMax);
}

function MissileInterruptBar({ gs, dispatch, canActFor }: {
  gs: GameState;
  dispatch: (action: Action) => void;
  canActFor: (playerId?: string) => boolean;
}) {
  const targetPlayerId = gs.turnOrder[gs.activeIdx];
  const eligible = Object.values(gs.players).filter((player) => player.id !== targetPlayerId && player.factionId
    && player.missiles > 0 && !gs.missilePowersUsedThisTurn.includes(player.id));
  const continentTargets = gs.phase === "start_turn" ? manifest.continents.filter((continent) => manifest.territories
    .filter((territory) => territory.continent === continent.id)
    .every((territory) => gs.territories[territory.id].controller === targetPlayerId)) : [];
  const badIntel = eligible.filter((player) => gs.factionMissilePowers[player.factionId!] === "bad_intel");
  const interference = eligible.filter((player) => gs.factionMissilePowers[player.factionId!] === "interference");
  if ((gs.phase === "start_turn" && (badIntel.length === 0 || continentTargets.length === 0))
      || (gs.phase === "end_turn" && interference.length === 0)) return null;

  return (
    <div className="fixed left-1/2 bottom-28 -translate-x-1/2 z-[55] bg-panel border border-signal/60 rounded-sm px-4 py-3 w-[min(92vw,900px)] shadow-2xl">
      <p className="font-mono text-[10px] uppercase tracking-widest text-signal mb-2">Missile Power interrupt · optional</p>
      <div className="flex flex-wrap gap-2">
        {gs.phase === "start_turn" && badIntel.flatMap((player) => continentTargets.map((continent) => (
          <Btn key={`${player.id}-${continent.id}`} disabled={!canActFor(player.id)}
            onClick={() => dispatch({ type: "missilePower.badIntel", playerId: player.id, targetPlayerId, continentId: continent.id })}>
            {player.name}: BAD INTEL · {continentName(continent.id)}
          </Btn>
        )))}
        {gs.phase === "end_turn" && interference.flatMap((player) => [
          ...gs.sideboard.slots.flatMap((cardId, slot) => cardId ? [(
            <Btn key={`${player.id}-slot-${slot}`} disabled={!canActFor(player.id)}
              onClick={() => dispatch({ type: "missilePower.interference", playerId: player.id, targetPlayerId, choice: { slot } })}>
              {player.name}: BLOCK SLOT {slot + 1}
            </Btn>
          )] : []),
          gs.sideboard.coinPile.length > 0 ? (
            <Btn key={`${player.id}-coin`} disabled={!canActFor(player.id)}
              onClick={() => dispatch({ type: "missilePower.interference", playerId: player.id, targetPlayerId, choice: { coin: true } })}>
              {player.name}: BLOCK COIN
            </Btn>
          ) : null,
        ])}
      </div>
    </div>
  );
}

function ScarPlayModal({ gs, ui, setUi, canActFor, dispatch }: {
  gs: GameState;
  ui: UiState;
  setUi: (fn: (u: UiState) => UiState) => void;
  canActFor: (pid?: string) => boolean;
  dispatch: (action: Action) => void;
}) {
  const sd = ui.scarDialog!;
  const def = scarById(sd.scarId) as { text?: string; target?: string; timing?: string } | undefined;
  const player = gs.players[sd.playerId];
  const factionTarget = def?.target === "faction";
  const timingBlocked = factionTarget ? gs.phase !== "start_turn"
    : gs.phase === "game_over" || !!(gs.combat && (gs.combat.natural || gs.combat.awaitingMoveIn));
  const canPlay = canActFor(sd.playerId) && !timingBlocked;
  const close = () => setUi((u) => ({ ...u, scarDialog: undefined, scarTarget: undefined }));
  const choose = () => setUi((u) => ({
    ...u,
    scarDialog: undefined,
    scarTarget: { playerId: sd.playerId, instanceId: sd.instanceId, scarId: sd.scarId },
  }));
  const playWeakness = (factionId: string) => {
    dispatch({ type: "weakness.play", playerId: sd.playerId, scarInstanceId: sd.instanceId, factionId });
    close();
  };

  return (
    <CenterOverlay label={`Play ${scarName(sd.scarId)}`}>
      <div className="p-5">
        <div className="flex flex-col sm:flex-row gap-5">
          <ScarCard scarId={sd.scarId} size="md" />
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[10px] uppercase tracking-widest text-muted mb-1">
              {player?.name ?? "Player"} holds this scar
            </div>
            <h2 className="font-display font-extrabold tracking-widest text-3xl text-danger mb-3">
              {scarName(sd.scarId)}
            </h2>
            <p className="text-sm leading-relaxed text-text mb-3">
              {def?.text ?? "Place this scar on an eligible territory. Its effect is permanent in this game."}
            </p>
            <div className="grid gap-2 text-sm">
              <div><span className="text-muted">Target:</span> {def?.target ?? "Any territory with no scar."}</div>
              <div><span className="text-muted">Timing:</span> {timingBlocked ? "Blocked during this timing window." : "Playable at this stable boundary."}</div>
            </div>
            {factionTarget && (
              <div className="grid gap-2 mt-4" aria-label="Weakness target faction">
                {Object.values(gs.players).filter((candidate) => candidate.factionId && !gs.factionWeaknesses[candidate.factionId]).map((candidate) => (
                  <button key={candidate.factionId} type="button" disabled={!canPlay}
                    onClick={() => playWeakness(candidate.factionId!)}
                    className="border border-line hover:border-danger rounded-sm px-3 py-2 text-left disabled:opacity-40">
                    {factionById(candidate.factionId)?.name ?? candidate.factionId} · {candidate.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Btn onClick={close}>CANCEL</Btn>
          {!factionTarget && <Btn tone="primary" disabled={!canPlay} onClick={choose}>CHOOSE TERRITORY</Btn>}
        </div>
      </div>
    </CenterOverlay>
  );
}

function ScarTargetBanner({ gs, ui, setUi, dispatch }: {
  gs: GameState;
  ui: UiState;
  setUi: (fn: (u: UiState) => UiState) => void;
  dispatch: (a: Action) => void;
}) {
  const st = ui.scarTarget!;
  const selected = st.territoryId ? gs.territories[st.territoryId] : undefined;
  const legal = !!st.territoryId && !!selected && !selected.hqFaction && selected.scars.length === 0;
  const cancel = () => setUi((u) => ({ ...u, scarDialog: undefined, scarTarget: undefined }));
  const confirm = () => {
    if (!legal) return;
    dispatch({ type: "scar.play", playerId: st.playerId, scarInstanceId: st.instanceId, territoryId: st.territoryId! });
    setUi((u) => ({ ...u, scarDialog: undefined, scarTarget: undefined }));
  };

  return (
    <div className="fixed left-1/2 bottom-6 -translate-x-1/2 z-[60] bg-panel border border-danger rounded-sm px-4 py-3 flex items-center gap-3 flex-wrap w-[min(92vw,760px)] shadow-2xl">
      <DecisionChip name={gs.players[st.playerId].name} color={factionById(gs.players[st.playerId].factionId)?.color}
        factionId={gs.players[st.playerId].factionId} />
      <span className="text-sm min-w-0 flex-1">
        Play <span className="text-danger font-semibold">{scarName(st.scarId)}</span>: click a territory without an HQ or scar.
        {" "}{st.territoryId
          ? <span className={legal ? "text-signal" : "text-danger"}>{territoryName(st.territoryId)}</span>
          : <span className="text-muted">No territory selected.</span>}
      </span>
      <Btn tone="primary" disabled={!legal} onClick={confirm}>CONFIRM</Btn>
      <button type="button" onClick={cancel}
        className="font-mono text-xs text-muted hover:text-text">CANCEL</button>
    </div>
  );
}

function RewardTargetBanner({ gs, ui, setUi, dispatch }: {
  gs: GameState;
  ui: UiState;
  setUi: (fn: (u: UiState) => UiState) => void;
  dispatch: (a: Action) => void;
}) {
  const [name, setName] = useState("");
  const rt = ui.rewardTarget!;
  const needsName = rt.kind === "name_continent" || rt.kind === "found_major_city" || rt.kind === "found_minor_city";
  const targeted = rt.kind === "name_continent"
    ? (rt.continentId ? continentName(rt.continentId) : undefined)
    : (rt.territoryId ? territoryName(rt.territoryId) : undefined);
  const instruction: Record<NonNullable<UiState["rewardTarget"]>["kind"], string> = {
    name_continent: "click a territory of an unnamed continent",
    found_major_city: "click any territory without a city",
    cancel_scar: "click a scarred territory",
    change_continent_bonus: "pick +1 or −1, then click a territory of an unchanged continent",
    fortify_city: "click a city territory",
    found_minor_city: "click a territory you control without a city",
  };
  const marks = Object.values(gs.continents).map((c) => c.bonusMark);

  const confirm = () => {
    if (rt.kind === "name_continent") {
      dispatch({ type: "reward.choose", playerId: rt.playerId, reward: { kind: "name_continent", continentId: rt.continentId!, name } });
    } else if (rt.kind === "found_major_city" || rt.kind === "found_minor_city") {
      dispatch({ type: "reward.choose", playerId: rt.playerId, reward: { kind: rt.kind, territoryId: rt.territoryId!, name } });
    }
    setUi((u) => ({ ...u, rewardTarget: undefined }));
  };

  return (
    <div className="fixed left-1/2 bottom-6 -translate-x-1/2 z-[60] bg-panel border border-signal rounded-sm px-4 py-3 flex items-center gap-3 flex-wrap w-[min(92vw,820px)] shadow-2xl">
      <DecisionChip name={gs.players[rt.playerId].name} color={factionById(gs.players[rt.playerId].factionId)?.color}
        factionId={gs.players[rt.playerId].factionId} />
      <span className="text-sm">{instruction[rt.kind]}</span>
      {rt.kind === "change_continent_bonus" && (
        <span className="inline-flex gap-1">
          {([1, -1] as const).map((d) => (
            <button key={d} disabled={marks.includes(d)}
              onClick={() => setUi((u) => ({ ...u, rewardTarget: { ...rt, delta: d } }))}
              className={`px-2 py-0.5 rounded-sm border font-mono text-xs disabled:opacity-40 ${
                rt.delta === d ? "border-signal text-signal" : "border-line"}`}>
              {d > 0 ? "+1" : "−1"}
            </button>
          ))}
        </span>
      )}
      {needsName && targeted && (
        <>
          <span className="font-mono text-xs text-signal">{targeted}</span>
          <input autoFocus aria-label="Reward name" value={name} onChange={(e) => setName(e.target.value)} placeholder="enter a name"
            className="bg-panel-2 border border-line rounded-sm px-2 py-1 text-sm font-mono w-44 focus:border-signal outline-none" />
          <Btn tone="primary" disabled={!name.trim()} onClick={confirm}>CONFIRM</Btn>
        </>
      )}
      <button onClick={() => setUi((u) => ({ ...u, rewardTarget: undefined }))}
        className="font-mono text-xs text-muted hover:text-text">CANCEL</button>
    </div>
  );
}

function WorldCapitalTargetBanner({ ui, setUi, dispatch }: {
  ui: UiState;
  setUi: (fn: (u: UiState) => UiState) => void;
  dispatch: (action: Action) => void;
}) {
  const target = ui.worldCapitalTarget!;
  const [name, setName] = useState("");
  const confirm = () => {
    dispatch({
      type: "mission.foundWorldCapital",
      playerId: target.hostPlayerId,
      founderPlayerId: target.founderPlayerId,
      territoryId: target.territoryId!,
      name,
    });
    setUi((current) => ({ ...current, worldCapitalTarget: undefined }));
  };
  return (
    <div className="fixed left-1/2 bottom-6 -translate-x-1/2 z-[60] bg-panel border border-signal rounded-sm px-4 py-3 flex items-center gap-3 flex-wrap w-[min(92vw,820px)] shadow-2xl">
      <span className="font-display font-bold tracking-widest text-xs text-signal">WORLD CAPITAL MISSION</span>
      {!target.territoryId ? (
        <span className="text-sm">Confirm the physical Mission, then click a territory without a city.</span>
      ) : (
        <>
          <span className="font-mono text-xs text-signal">{territoryName(target.territoryId)}</span>
          <input autoFocus aria-label="World Capital name" value={name} onChange={(event) => setName(event.target.value)}
            placeholder="enter the capital name"
            className="bg-panel-2 border border-line rounded-sm px-2 py-1 text-sm font-mono w-52 focus:border-signal outline-none" />
          <Btn tone="primary" disabled={!name.trim()} onClick={confirm}>PLACE &amp; OPEN PACK 4</Btn>
        </>
      )}
      <button onClick={() => setUi((current) => ({ ...current, worldCapitalTarget: undefined }))}
        className="font-mono text-xs text-muted hover:text-text">CANCEL</button>
    </div>
  );
}

// new (1-web-b): shared game screen — extracted from SandboxGame so the local hot-seat
// wrapper and the networked (Socket.IO) wrapper drive the identical UI.
// new (UI-8): blocking decisions live on a shared overlay layer — full-screen faction/power
// takeover (setup), centered combat overlay, bottom decision dock — instead of the rail.
import { useEffect, useMemo, useRef, useState } from "react";
import { waitingOn, maneuverNetwork, isLegalStart, type GameState, type Action } from "@risk/rules";
import { manifest, territoryById } from "@risk/map";
import Board, { type Highlight } from "./Board.tsx";
import SidePanel from "./SidePanel.tsx";
import Ledger from "./Ledger.tsx";
import EffectsLayer from "./EffectsLayer.tsx";
import SetupTakeover from "./SetupTakeover.tsx";
import CombatOverlay from "./CombatOverlay.tsx";
import TurnDecisionDock from "./TurnDecisionDock.tsx";
import HandStrip from "./HandStrip.tsx"; // new (UI-9)
import ActionBar from "./ActionBar.tsx"; // new (UI-2)
import VictoryFlow from "./VictoryFlow.tsx"; // new (UI-12)
import { DecisionChip } from "./overlays.tsx";
import { continentName, factionById, powerName, scarName, territoryName } from "./labels.ts";
import { Btn } from "./overlays.tsx";

const PHASES: { id: GameState["phase"]; label: string }[] = [
  { id: "setup", label: "SETUP" },
  { id: "start_turn", label: "START" },
  { id: "join_or_recruit", label: "RECRUIT" },
  { id: "expand_attack", label: "ATTACK" },
  { id: "maneuver", label: "MANEUVER" },
  { id: "end_turn", label: "END" },
];

export interface UiState {
  selected?: string;
  pickedFaction?: string;
  pickedPower?: string; // new (9): first-play starting-power pick
  placeCount: number;
  moveCount: number;
  expandCount: number;
  selectedCards: string[];
  /** new (UI-12): a chosen end-game reward whose target selection dropped to the board. */
  rewardTarget?: {
    kind: "name_continent" | "found_major_city" | "cancel_scar" | "change_continent_bonus" | "fortify_city" | "found_minor_city";
    playerId: string;
    territoryId?: string;
    continentId?: string;
    delta: 1 | -1;
  };
  /** new (UI-12): a held scar being played — next board click on an unscarred territory places it. */
  scarTarget?: { playerId: string; instanceId: string; scarId: string };
}

export default function GameScreen({ gs, dispatch, onExit, error, viewer }: {
  gs: GameState;
  dispatch: (a: Action) => void;
  onExit: () => void;
  error: string | null;
  /** When set (networked), only this player's controls are live; hot-seat passes undefined. */
  viewer?: string;
}) {
  const [ui, setUi] = useState<UiState>({ placeCount: 1, moveCount: 1, expandCount: 1, selectedCards: [] });
  const [localError, setLocalError] = useState<string | null>(null);
  const [autoDefend, setAutoDefend] = useState<Record<string, boolean>>({}); // new (UI-8): per-player toggle, off by default

  const actor = waitingOn(gs); // whoever the game waits on
  const actorPlayer = actor ? gs.players[actor] : undefined;
  const canActFor = (pid?: string) => !!pid && (!viewer || pid === viewer); // networked: view-only unless it's your decision
  const canAct = !viewer || actor === viewer;
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
      setUi((u) => ({ ...u, pickedFaction: undefined, pickedPower: undefined, selected: undefined, rewardTarget: undefined }));
    }
  }, [actor]);

  // new (UI-8): auto-defend with max dice — dispatches the defender dice choice when enabled.
  useEffect(() => {
    const c = gs.combat;
    if (!c || c.natural || c.awaitingMoveIn || c.attackerDice === undefined || c.defenderDice !== undefined) return;
    if (!autoDefend[c.defender] || !canActFor(c.defender)) return;
    doDispatch({ type: "attack.defenderDice", playerId: c.defender, count: Math.min(2, gs.territories[c.to].troops) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gs, autoDefend]);

  // Setup readiness: faction picked + power resolved (stored permanent choice or first-play pick).
  const setupReady = gs.phase === "setup" && !!ui.pickedFaction && !!(gs.factionPowers[ui.pickedFaction] ?? ui.pickedPower);

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
    // new (UI-12): active targeting modes glow their legal targets and override phase highlights
    if (ui.scarTarget && canActFor(ui.scarTarget.playerId)) {
      for (const t of manifest.territories) if (gs.territories[t.id].scars.length === 0) h[t.id] = "highlight-start";
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
    if (gs.phase === "setup" && ui.pickedFaction) {
      for (const t of manifest.territories) if (isLegalStart(gs, t.id, true, ui.pickedFaction, actor)) h[t.id] = "highlight-start";
    }
    if (gs.phase === "join_or_recruit") {
      const owned = Object.values(gs.territories).some((t) => t.controller === actor);
      if (!owned) {
        const fid = gs.players[actor].factionId;
        for (const t of manifest.territories) if (isLegalStart(gs, t.id, false, fid, actor)) h[t.id] = "highlight-start";
      }
    }
    if (gs.phase === "expand_attack" && !gs.combat && ui.selected) {
      const from = gs.territories[ui.selected];
      if (from?.controller === actor) {
        h[ui.selected] = "selected";
        for (const n of territoryById(ui.selected).neighbors) {
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
    if (gs.phase === "maneuver" && ui.selected && !gs.maneuverUsed) {
      const from = gs.territories[ui.selected];
      if (from?.controller === actor) {
        h[ui.selected] = "selected";
        for (const tid of maneuverNetwork(gs, actor, ui.selected)) h[tid] = "highlight-move";
      }
    }
    return h;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gs, ui.selected, ui.pickedFaction, ui.rewardTarget, ui.scarTarget, actor, canAct]);

  const onTerritoryClick = (tid: string) => {
    // new (UI-12): scar play targeting — the holder acts on anyone's turn at a stable boundary
    if (ui.scarTarget) {
      const st = ui.scarTarget;
      if (!canActFor(st.playerId) || gs.territories[tid].scars.length > 0) return;
      doDispatch({ type: "scar.play", playerId: st.playerId, scarInstanceId: st.instanceId, territoryId: tid });
      setUi((u) => ({ ...u, scarTarget: undefined }));
      return;
    }
    // new (UI-12): end-game reward targeting dropped to the board
    if (gs.phase === "game_over" && ui.rewardTarget) {
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
    switch (gs.phase) {
      case "setup": {
        if (!ui.pickedFaction) { setLocalError("Pick a faction first"); return; }
        const stored = gs.factionPowers[ui.pickedFaction];
        if (!stored && !ui.pickedPower) { setLocalError("Pick a starting power first"); return; }
        setLocalError(null);
        doDispatch({ type: "setup.choose", playerId: actor, factionId: ui.pickedFaction, territoryId: tid, powerId: stored ? undefined : ui.pickedPower });
        return;
      }
      case "join_or_recruit": {
        const owned = Object.values(gs.territories).some((x) => x.controller === actor);
        if (!owned) return doDispatch({ type: "join.enter", playerId: actor, territoryId: tid });
        if (gs.recruit && t.controller === actor) {
          const count = Math.min(ui.placeCount, gs.recruit.remaining);
          if (count > 0) doDispatch({ type: "recruit.place", playerId: actor, territoryId: tid, count });
        }
        return;
      }
      case "expand_attack": {
        if (gs.combat) return;
        if (t.controller === actor) return setUi((u) => ({ ...u, selected: tid }));
        if (ui.selected && territoryById(ui.selected).neighbors.includes(tid)) {
          if (!t.controller && t.troops === 0) {
            return doDispatch({ type: "attack.expand", playerId: actor, from: ui.selected, to: tid, troops: ui.expandCount });
          }
          if (t.controller && t.controller !== actor) {
            return doDispatch({ type: "attack.declare", playerId: actor, from: ui.selected, to: tid });
          }
        }
        return;
      }
      case "maneuver": {
        if (t.controller === actor && !ui.selected) return setUi((u) => ({ ...u, selected: tid }));
        if (t.controller === actor && ui.selected === tid) return setUi((u) => ({ ...u, selected: undefined }));
        if (ui.selected && highlights[tid] === "highlight-move") {
          return doDispatch({ type: "maneuver.move", playerId: actor, from: ui.selected, to: tid, count: ui.moveCount });
        }
        if (t.controller === actor) return setUi((u) => ({ ...u, selected: tid }));
        return;
      }
    }
  };

  return (
    <div className="relative h-full grid grid-rows-[auto_1fr] overflow-hidden">
      {/* Command strip — signature element: ops-board phase track */}
      <header className="border-b border-line bg-panel px-6 py-3 grid grid-cols-[auto_1fr_auto] items-center gap-6">
        <button onClick={onExit} className="font-mono text-xs text-muted hover:text-text">← HUB</button>
        <nav className="flex items-center gap-1 justify-center" aria-label="Turn phases">
          {PHASES.map((p, i) => {
            const active = gs.phase === p.id || (gs.phase === "game_over" && p.id === "end_turn");
            return (
              <span key={p.id} className="flex items-center gap-1">
                {i > 0 && <span className="text-line">—</span>}
                <span className={`font-display font-bold tracking-widest text-sm px-2 py-0.5 rounded-sm ${
                  active ? "bg-signal text-ink" : "text-muted"}`}>{p.label}</span>
              </span>
            );
          })}
        </nav>
        <div className="font-mono text-xs text-right">
          {gs.phase === "game_over" ? (
            <span className="text-signal">GAME OVER</span>
          ) : actorPlayer ? (
            <>
              <span className="text-muted">{canAct ? "ACTING: " : "WAITING ON: "}</span>
              <span style={{ color: playerFaction(actor) ?? "var(--color-signal)" }}>{actorPlayer.name}</span>
              <span className="text-muted"> · T{gs.turnNumber}</span>
            </>
          ) : null}
        </div>
      </header>

      <div className="grid grid-cols-[1fr_340px] min-h-0">
        <div className="grid grid-rows-[1fr_auto_auto] min-h-0">
          <div className="relative min-h-0 p-4 overflow-auto">
            <div className="relative w-full max-h-full aspect-[749.819/519.068]">
              <Board gs={gs} playerFaction={playerFaction} highlights={highlights} onTerritoryClick={onTerritoryClick} />
              <EffectsLayer gs={gs} />
              {shownError && (
                <div role="alert" className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-panel border border-danger text-danger font-mono text-xs px-4 py-2 rounded-sm">
                  {shownError}
                </div>
              )}
            </div>
            {/* new (UI-8): HQ placement hint once the takeover hands off to the board */}
            {gs.phase === "setup" && actor && canAct && setupReady && ui.pickedFaction && (
              <div className="absolute top-6 left-1/2 -translate-x-1/2 z-30 bg-panel border border-signal rounded-sm px-4 py-2 flex items-center gap-3">
                <DecisionChip name={actorPlayer!.name} color={factionById(ui.pickedFaction)?.color} you={!!viewer} />
                <span className="text-sm">
                  {factionById(ui.pickedFaction)?.name} — {powerName(gs.factionPowers[ui.pickedFaction] ?? ui.pickedPower!)}:
                  {" "}click a highlighted territory to place your HQ.
                </span>
                <button onClick={() => setUi((u) => ({ ...u, pickedFaction: undefined, pickedPower: undefined }))}
                  className="font-mono text-xs text-muted hover:text-text">CHANGE</button>
              </div>
            )}
            {/* new (UI-12): scar-play targeting banner */}
            {ui.scarTarget && (
              <div className="absolute top-6 left-1/2 -translate-x-1/2 z-30 bg-panel border border-danger rounded-sm px-4 py-2 flex items-center gap-3">
                <span className="text-sm">
                  Play <span className="text-danger font-semibold">{scarName(ui.scarTarget.scarId)}</span>:
                  {" "}click an unscarred territory. The scar is permanent.
                </span>
                <button onClick={() => setUi((u) => ({ ...u, scarTarget: undefined }))}
                  className="font-mono text-xs text-muted hover:text-text">CANCEL</button>
              </div>
            )}
            {/* new (UI-12): reward targeting banner — glow → click → (name) → sticker on */}
            {gs.phase === "game_over" && ui.rewardTarget && (
              <RewardTargetBanner gs={gs} ui={ui} setUi={setUi} dispatch={doDispatch} />
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
        <aside className="border-l border-line bg-panel min-h-0 grid grid-rows-[1fr_auto]">
          <div className="overflow-y-auto">
            <SidePanel gs={gs} actor={canAct ? actor : undefined} playerFaction={playerFaction} />
          </div>
          <Ledger gs={gs} />{/* new (UI-2): collapsible BATTLE LOG tab */}
        </aside>
      </div>

      {/* new (UI-8): shared overlay layer — blocking decisions */}
      {gs.phase === "setup" && actor && canAct && !setupReady && (
        <SetupTakeover gs={gs} ui={ui} setUi={setUi} actor={actor} you={!!viewer} />
      )}
      {gs.combat && (
        <CombatOverlay gs={gs} dispatch={doDispatch} canActFor={canActFor} autoDefend={autoDefend}
          onAutoDefend={(pid, on) => setAutoDefend((m) => ({ ...m, [pid]: on }))} />
      )}
      {gs.phase === "game_over" && gs.winner && ( // new (UI-12): victory → signing → rewards → aftermath
        <VictoryFlow gs={gs} dispatch={doDispatch} canActFor={canActFor} ui={ui} setUi={setUi} />
      )}
    </div>
  );
}

// new (UI-12): board-target banner for a chosen reward — instruction, optional name entry, confirm.
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
    <div className="absolute top-6 left-1/2 -translate-x-1/2 z-30 bg-panel border border-signal rounded-sm px-4 py-2 flex items-center gap-3 flex-wrap max-w-[90%]">
      <DecisionChip name={gs.players[rt.playerId].name} color={factionById(gs.players[rt.playerId].factionId)?.color} />
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
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="enter a name"
            className="bg-panel-2 border border-line rounded-sm px-2 py-1 text-sm font-mono w-44 focus:border-signal outline-none" />
          <Btn tone="primary" disabled={!name.trim()} onClick={confirm}>CONFIRM</Btn>
        </>
      )}
      <button onClick={() => setUi((u) => ({ ...u, rewardTarget: undefined }))}
        className="font-mono text-xs text-muted hover:text-text">CANCEL</button>
    </div>
  );
}

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
import { DecisionChip } from "./overlays.tsx";
import { factionById, powerName } from "./labels.ts";

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
      setUi((u) => ({ ...u, pickedFaction: undefined, pickedPower: undefined, selected: undefined }));
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

  // Phase-aware board highlights
  const highlights = useMemo<Record<string, Highlight>>(() => {
    const h: Record<string, Highlight> = {};
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
  }, [gs, ui.selected, ui.pickedFaction, actor, canAct]);

  const onTerritoryClick = (tid: string) => {
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
        </div>
        <aside className="border-l border-line bg-panel min-h-0 grid grid-rows-[1fr_220px]">
          <div className="overflow-y-auto">
            <SidePanel gs={gs} ui={ui} setUi={setUi} dispatch={doDispatch} actor={canAct ? actor : undefined} playerFaction={playerFaction} />
          </div>
          <Ledger gs={gs} />
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
      {(gs.phase === "start_turn" || gs.phase === "end_turn") && actor && canAct && (
        <TurnDecisionDock gs={gs} ui={ui} setUi={setUi} dispatch={doDispatch} actor={actor} />
      )}
    </div>
  );
}

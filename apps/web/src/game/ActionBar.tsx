// new (UI-2): slim per-phase action bar in the bottom strip — the spatial grammar is
// bottom = you, right = the table. Non-blocking phase controls live here; blocking
// decisions stay on the UI-8 overlay surfaces (takeover, combat overlay, dock).
import { joinWarTroops, maneuverDecision, type Action, type GameState } from "@risk/rules";
import type { UiState } from "./GameScreen.tsx";
import { Btn, TroopPicker } from "./overlays.tsx";
import { cardResources } from "./labels.ts";

export default function ActionBar({ gs, ui, setUi, dispatch, actor }: {
  gs: GameState;
  ui: UiState;
  setUi: (fn: (u: UiState) => UiState) => void;
  dispatch: (a: Action) => void;
  actor: string;
}) {
  const p = gs.players[actor];
  const maneuver = maneuverDecision(gs, actor);
  const earlyControl = maneuver.available && maneuver.early ? (
    <Btn tone={ui.maneuverMode ? "primary" : "default"} onClick={() => setUi((current) => ({
      ...current,
      maneuverMode: !current.maneuverMode,
      selected: undefined,
    }))}>
      {ui.maneuverMode ? "CANCEL EARLY MANEUVER" : "EARLY MANEUVER"}
    </Btn>
  ) : null;

  if (ui.maneuverMode && maneuver.available) {
    const source = ui.selected ? gs.territories[ui.selected] : undefined;
    const maxMove = source?.controller === actor ? Math.max(1, source.troops - 1) : 1;
    return (
      <Bar>
        <span className="font-display font-bold tracking-widest text-sm text-ok">EARLY MANEUVER</span>
        <span className="text-xs text-muted">Select a 2+ troop source, then an owned destination.</span>
        <span className="flex items-center gap-1.5 text-xs whitespace-nowrap">
          move <TroopPicker label="Early maneuver troops" value={ui.moveCount} min={1} max={maxMove}
            disabled={!source}
            onChange={(count) => setUi((current) => ({ ...current, moveCount: count }))} /> troops
        </span>
        {earlyControl}
      </Bar>
    );
  }

  if (gs.phase === "join_or_recruit") {
    const owned = Object.values(gs.territories).some((t) => t.controller === actor);
    if (!owned) {
      return (
        <Bar>
          <span className="text-xs text-muted">
            You hold no territory — click a highlighted territory to re-enter with{" "}
            {joinWarTroops(gs, actor)} troops.
          </span>
          {earlyControl}
        </Bar>
      );
    }
    if (!gs.recruit) return null;
    const b = gs.recruit.breakdown;
    const continentTotal = b.continents.reduce((n, c) => n + c.total, 0);
    const selectedResources = ui.selectedCards.reduce((sum, cardId) => sum + cardResources(gs, cardId), 0)
      + (p.factionId === gs.alienCollaboratorFactionId && ui.selectedCards.length > 0 ? 1 : 0);
    return (
      <Bar>
        <span className="font-mono text-[10px] text-muted whitespace-nowrap">
          (terr {b.territories}{b.population > 0 ? ` + pop ${b.population}` : ""})/3 → {b.fromTerritories}
          {continentTotal !== 0 && <> · continents → {continentTotal}</>}
          {b.tradeIns > 0 && <> · trade-ins → {b.tradeIns}</>}
        </span>
        <span className="font-display font-bold tracking-widest text-lg text-signal whitespace-nowrap">
          {gs.recruit.remaining} TO PLACE
        </span>
        <span className="flex items-center gap-1.5 text-xs whitespace-nowrap">
          place <TroopPicker label="Recruit troops" value={ui.placeCount} min={1} max={Math.max(1, gs.recruit.remaining)}
            onChange={(n) => setUi((u) => ({ ...u, placeCount: n }))} /> per click
        </span>
        {ui.selectedCards.length >= 1 && selectedResources >= 2 && selectedResources <= 10 && (
          <Btn onClick={() => dispatch({ type: "recruit.trade", playerId: actor, cardIds: ui.selectedCards })}>
            TRADE {selectedResources} RESOURCES
          </Btn>
        )}
        {gs.recruit.remaining === 0 && (
          <Btn tone="primary" onClick={() => dispatch({ type: "recruit.done", playerId: actor })}>TO ATTACK</Btn>
        )}
        {earlyControl}
      </Bar>
    );
  }

  if (gs.phase === "expand_attack" && !gs.combat) {
    const source = ui.selected ? gs.territories[ui.selected] : undefined;
    const canPickExpandCount = !!source && source.controller === actor && source.troops >= 2;
    const maxExpand = canPickExpandCount ? Math.max(1, source.troops - 1) : 1;
    return (
      <Bar>
        <span className="font-display font-bold tracking-widest text-sm text-danger whitespace-nowrap">ATTACK / EXPAND</span>
        <span className="text-xs text-muted whitespace-nowrap">Select your territory, then an adjacent target: empty = expand, enemy = attack.</span>
        <span className="flex items-center gap-1.5 text-xs whitespace-nowrap">
          expand with <TroopPicker label="Expand troops" value={ui.expandCount} min={1} max={maxExpand}
            disabled={!canPickExpandCount}
            onChange={(n) => setUi((u) => ({ ...u, expandCount: n }))} /> troops
        </span>
        <Btn onClick={() => dispatch({ type: "phase.endAttacks", playerId: actor })}>END ATTACKS</Btn>
        {earlyControl}
      </Bar>
    );
  }

  if (gs.phase === "maneuver") {
    const source = ui.selected ? gs.territories[ui.selected] : undefined;
    const canPickMoveCount = !!source && source.controller === actor && source.troops >= 2 && !gs.maneuverUsed;
    const maxMove = canPickMoveCount ? Math.max(1, source.troops - 1) : 1;
    return (
      <Bar>
        <span className="font-display font-bold tracking-widest text-sm text-ok whitespace-nowrap">MANEUVER</span>
        <span className="text-xs text-muted whitespace-nowrap">
          {gs.maneuverUsed
            ? "Maneuver used. End the phase."
            : "Optional: move troops once. Source needs 2+ troops; destination must be owned and reachable unless your power says otherwise."}
        </span>
        {!gs.maneuverUsed && (
          <span className="flex items-center gap-1.5 text-xs whitespace-nowrap">
            move <TroopPicker label="Maneuver troops" value={ui.moveCount} min={1} max={maxMove}
              disabled={!canPickMoveCount}
              onChange={(n) => setUi((u) => ({ ...u, moveCount: n }))} /> troops
          </span>
        )}
        <Btn tone="primary" onClick={() => dispatch({ type: "phase.endManeuver", playerId: actor })}>END MANEUVER</Btn>
      </Bar>
    );
  }

  if ((gs.phase === "start_turn" || gs.phase === "end_turn") && earlyControl) {
    return <Bar>{earlyControl}</Bar>;
  }

  return null;
}

function Bar({ children }: { children: React.ReactNode }) {
  return (
    <div data-action-bar className="flex items-center gap-3 flex-wrap justify-end">
      {children}
    </div>
  );
}

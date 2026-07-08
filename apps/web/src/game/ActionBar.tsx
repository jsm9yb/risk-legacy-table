// new (UI-2): slim per-phase action bar in the bottom strip — the spatial grammar is
// bottom = you, right = the table. Non-blocking phase controls live here; blocking
// decisions stay on the UI-8 overlay surfaces (takeover, combat overlay, dock).
import { contentPack } from "@risk/content";
import type { Action, GameState } from "@risk/rules";
import type { UiState } from "./GameScreen.tsx";
import { Btn, Num } from "./overlays.tsx";

export default function ActionBar({ gs, ui, setUi, dispatch, actor }: {
  gs: GameState;
  ui: UiState;
  setUi: (fn: (u: UiState) => UiState) => void;
  dispatch: (a: Action) => void;
  actor: string;
}) {
  const p = gs.players[actor];

  if (gs.phase === "join_or_recruit") {
    const owned = Object.values(gs.territories).some((t) => t.controller === actor);
    if (!owned) {
      return (
        <Bar>
          <span className="text-xs text-muted">
            You hold no territory — click a highlighted territory to re-enter with{" "}
            {String((contentPack.ruleConstants.minRecruit as any).value)} troops.
          </span>
        </Bar>
      );
    }
    if (!gs.recruit) return null;
    const b = gs.recruit.breakdown;
    const continentTotal = b.continents.reduce((n, c) => n + c.total, 0);
    return (
      <Bar>
        <span className="font-mono text-[10px] text-muted whitespace-nowrap">
          (terr {b.territories}{b.population > 0 ? ` + pop ${b.population}` : ""})/3 → {b.fromTerritories}
          {continentTotal !== 0 && <> · continents → {continentTotal}</>}
          {b.tradeIns > 0 && <> · trade-ins → {b.tradeIns}</>}
        </span>
        <span className="font-mono text-xs text-signal whitespace-nowrap">to place: {gs.recruit.remaining}</span>
        <span className="flex items-center gap-1.5 text-xs whitespace-nowrap">
          place <Num value={ui.placeCount} min={1} max={Math.max(1, gs.recruit.remaining)}
            onChange={(n) => setUi((u) => ({ ...u, placeCount: n }))} /> per click
        </span>
        {p.hand.length >= 2 && ui.selectedCards.length >= 2 && (
          <Btn onClick={() => dispatch({ type: "recruit.trade", playerId: actor, cardIds: ui.selectedCards })}>
            TRADE {ui.selectedCards.length}
          </Btn>
        )}
        {gs.recruit.remaining === 0 && (
          <Btn tone="primary" onClick={() => dispatch({ type: "recruit.done", playerId: actor })}>TO ATTACK</Btn>
        )}
      </Bar>
    );
  }

  if (gs.phase === "expand_attack" && !gs.combat) {
    return (
      <Bar>
        <span className="text-xs text-muted whitespace-nowrap">Select your territory, then an adjacent target: empty = expand, enemy = attack.</span>
        <span className="flex items-center gap-1.5 text-xs whitespace-nowrap">
          expand with <Num value={ui.expandCount} min={1} max={99}
            onChange={(n) => setUi((u) => ({ ...u, expandCount: n }))} /> troops
        </span>
        <Btn onClick={() => dispatch({ type: "phase.endAttacks", playerId: actor })}>END ATTACKS</Btn>
      </Bar>
    );
  }

  if (gs.phase === "maneuver") {
    return (
      <Bar>
        <span className="text-xs text-muted whitespace-nowrap">
          {gs.maneuverUsed ? "Maneuver used." : "Select a source, then a connected territory."}
        </span>
        {!gs.maneuverUsed && (
          <span className="flex items-center gap-1.5 text-xs whitespace-nowrap">
            move <Num value={ui.moveCount} min={1} max={99}
              onChange={(n) => setUi((u) => ({ ...u, moveCount: n }))} /> troops
          </span>
        )}
        <Btn tone="primary" onClick={() => dispatch({ type: "phase.endManeuver", playerId: actor })}>END MANEUVER</Btn>
      </Bar>
    );
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

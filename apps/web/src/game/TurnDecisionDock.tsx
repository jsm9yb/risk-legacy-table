// new (UI-8): bottom-anchored dock for card/hand decisions — start-of-turn Red Star
// purchase and the mandatory end-of-turn draw. Renders only for the acting player.
import { contentPack } from "@risk/content";
import type { Action, GameState } from "@risk/rules";
import type { UiState } from "./GameScreen.tsx";
import { cardDef, cardLabel, factionById } from "./labels.ts";
import { BottomDock, Btn, DecisionChip } from "./overlays.tsx";

export default function TurnDecisionDock({ gs, ui, setUi, dispatch, actor }: {
  gs: GameState;
  ui: UiState;
  setUi: (fn: (u: UiState) => UiState) => void;
  dispatch: (a: Action) => void;
  actor: string;
}) {
  const p = gs.players[actor];
  const color = factionById(p.factionId)?.color;

  const toggleCard = (id: string, on: boolean) =>
    setUi((u) => ({ ...u, selectedCards: on ? [...u.selectedCards, id] : u.selectedCards.filter((x) => x !== id) }));

  if (gs.phase === "start_turn") {
    return (
      <BottomDock label="Start of turn">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-display font-bold tracking-widest text-sm">START OF TURN</h3>
          <DecisionChip name={p.name} color={color} />
        </div>
        <p className="text-xs text-muted mb-2">
          Buy Red Stars before recruiting. Cost: {String((contentPack.ruleConstants.redStarPurchaseCost as any).value)} Resource cards.
        </p>
        {p.hand.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2">
            {p.hand.map((id) => (
              <label key={id} className="flex items-center gap-2 font-mono text-xs">
                <input type="checkbox" checked={ui.selectedCards.includes(id)}
                  onChange={(e) => toggleCard(id, e.target.checked)} />
                {cardLabel(id)}
              </label>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          {ui.selectedCards.length === 4 && (
            <Btn tone="primary" onClick={() => dispatch({ type: "start.buyRedStar", playerId: actor, cardIds: ui.selectedCards })}>BUY RED STAR</Btn>
          )}
          <Btn onClick={() => dispatch({ type: "start.done", playerId: actor })}>CONTINUE</Btn>
        </div>
      </BottomDock>
    );
  }

  if (gs.phase === "end_turn") {
    if (!p.conqueredEnemyThisTurn) {
      return (
        <BottomDock label="End of turn">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-display font-bold tracking-widest text-sm">END OF TURN</h3>
            <DecisionChip name={p.name} color={color} />
          </div>
          <Btn tone="primary" onClick={() => dispatch({ type: "end.turn", playerId: actor })}>END TURN</Btn>
        </BottomDock>
      );
    }
    const mineInSlot = (id: string | null) => {
      const c = id ? cardDef(id) : undefined;
      return !!c && c.kind === "territory" && gs.territories[c.territoryId].controller === actor;
    };
    const hasMatch = gs.sideboard.slots.some(mineInSlot);
    return (
      <BottomDock label="End of turn">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-display font-bold tracking-widest text-sm">DRAW A RESOURCE CARD</h3>
          <DecisionChip name={p.name} color={color} />
        </div>
        <p className="text-xs text-muted mb-2">
          You conquered enemy territory — draw one Resource card.
          {hasMatch && <span className="text-signal"> A face-up card matches your territory: taking it is mandatory before coins.</span>}
        </p>
        <div className="space-y-1">
          {gs.sideboard.slots.map((id, i) => {
            if (!id) return <div key={i} className="font-mono text-xs text-muted">slot {i + 1}: —</div>;
            const mine = mineInSlot(id);
            return (
              <div key={i} className="flex items-center gap-2 font-mono text-xs">
                <span className={mine ? "text-signal" : "text-muted"}>slot {i + 1}: {cardLabel(id)}</span>
                {mine && <Btn tone="primary" onClick={() => dispatch({ type: "end.draw", playerId: actor, choice: { slot: i } })}>TAKE</Btn>}
              </div>
            );
          })}
          <div className="flex items-center gap-2 font-mono text-xs">
            <span className="text-muted">coin pile: {(gs.sideboard as any).coinCount ?? gs.sideboard.coinPile.length}</span>
            <Btn disabled={hasMatch} onClick={() => dispatch({ type: "end.draw", playerId: actor, choice: { coin: true } })}>TAKE COIN</Btn>
          </div>
        </div>
      </BottomDock>
    );
  }

  return null;
}

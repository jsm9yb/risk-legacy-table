// new (UI-8): bottom-anchored dock for card/hand decisions — start-of-turn Red Star
// purchase and the mandatory end-of-turn draw. Renders only for the acting player.
// UI-9: card flows render ResourceCard components; buy selection happens on the hand strip.
import { contentPack } from "@risk/content";
import type { Action, GameState } from "@risk/rules";
import type { UiState } from "./GameScreen.tsx";
import { cardDef, cardResources, factionById } from "./labels.ts";
import ResourceCard, { STAR_PATH } from "./cards/ResourceCard.tsx";
import { BottomDock, Btn, DecisionChip } from "./overlays.tsx";

export default function TurnDecisionDock({ gs, ui, dispatch, actor }: {
  gs: GameState;
  ui: UiState;
  dispatch: (a: Action) => void;
  actor: string;
}) {
  const p = gs.players[actor];
  const color = factionById(p.factionId)?.color;
  const starCost = Number((contentPack.ruleConstants.redStarPurchaseCost as any).value);

  if (gs.phase === "start_turn") {
    return (
      <BottomDock label="Start of turn">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-display font-bold tracking-widest text-sm">START OF TURN</h3>
          <DecisionChip name={p.name} color={color} />
        </div>
        <p className="text-xs text-muted mb-2">
          Buy Red Stars before recruiting: select {starCost} Resource cards in your hand below.
        </p>
        <div className="flex gap-2 items-center">
          <Btn tone="primary" disabled={ui.selectedCards.length !== starCost}
            onClick={() => dispatch({ type: "start.buyRedStar", playerId: actor, cardIds: ui.selectedCards })}>
            <span className="inline-flex items-center gap-1.5">
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" aria-hidden="true"><path d={STAR_PATH} fill="currentColor" /></svg>
              BUY RED STAR ({ui.selectedCards.length}/{starCost})
            </span>
          </Btn>
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
    const coinCount = (gs.sideboard as any).coinCount ?? gs.sideboard.coinPile.length;
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
        <div className="flex items-end gap-3 flex-wrap">{/* new (UI-5): wraps at phone widths */}
          {gs.sideboard.slots.map((id, i) => (
            <div key={i} className="flex flex-col items-center gap-1.5">
              {id
                ? <ResourceCard size="md" cardId={id} resources={cardResources(gs, id)}
                    selected={mineInSlot(id)} />
                : <span className="block w-24 aspect-[5/7] rounded-[6%] border border-line bg-ink/30" />}
              {id && mineInSlot(id)
                ? <Btn tone="primary" ariaLabel={`Take slot ${i + 1}`}
                    onClick={() => dispatch({ type: "end.draw", playerId: actor, choice: { slot: i } })}>TAKE</Btn>
                : <span className="font-mono text-[9px] text-muted">slot {i + 1}</span>}
            </div>
          ))}
          <div className="flex flex-col items-center gap-1.5 ml-2">
            <span data-coin-pile className={`coin-face block w-14 aspect-square rounded-full relative ${coinCount === 0 ? "opacity-30" : ""}`}>
              <svg viewBox="0 0 24 24" className="absolute inset-[16%]" aria-hidden="true">
                <path d={STAR_PATH} fill="#8a6d1c" opacity="0.55" />
              </svg>
            </span>
            <Btn disabled={hasMatch || coinCount === 0}
              onClick={() => dispatch({ type: "end.draw", playerId: actor, choice: { coin: true } })}>TAKE COIN</Btn>
          </div>
        </div>
      </BottomDock>
    );
  }

  return null;
}

// Bottom-anchored dock for start/end-of-turn Resource-card decisions.
import { contentPack } from "@risk/content";
import { endTurnDecision, hasFactionPower, neighborsOf, type Action, type GameState } from "@risk/rules";
import type { UiState } from "./GameScreen.tsx";
import { cardResources, factionById } from "./labels.ts";
import ResourceCard, { CoinFace, STAR_PATH } from "./cards/ResourceCard.tsx";
import { BottomDock, Btn, DecisionChip } from "./overlays.tsx";

export default function TurnDecisionDock({ gs, ui, dispatch, actor }: {
  gs: GameState;
  ui: UiState;
  dispatch: (a: Action) => void;
  actor: string;
}) {
  const player = gs.players[actor];
  const color = factionById(player.factionId)?.color;
  const starCost = Number((contentPack.ruleConstants.redStarPurchaseCost as any).value);

  if (gs.phase === "start_turn") {
    const hasTerritory = Object.values(gs.territories).some((territory) => territory.controller === actor);
    const mobileMoves = hasFactionPower(gs, actor, "mobile") && !gs.mobileHqUsed
      ? Object.entries(gs.territories).flatMap(([from, territory]) =>
        territory.controller === actor && territory.hqFaction
          ? neighborsOf(gs, from).filter((to) => gs.territories[to].controller === actor && !gs.territories[to].hqFaction && gs.territories[to].scars.length === 0)
            .map((to) => ({ from, to }))
          : [])
      : [];
    const canRally = !!player.factionId && gs.factionMissilePowers[player.factionId] === "rally"
      && player.missiles > 0 && !gs.missilePowersUsedThisTurn.includes(actor);
    return (
      <BottomDock label="Start of turn">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-display font-bold tracking-widest text-sm">START OF TURN</h3>
          <DecisionChip name={player.name} color={color} factionId={player.factionId} />
        </div>
        <p className="text-xs text-muted mb-2">
          Buy Red Stars before recruiting: select {starCost} Resource cards in your hand below.
        </p>
        {mobileMoves.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3" aria-label="Mobile HQ moves">
            {mobileMoves.map((move) => (
              <Btn key={`${move.from}-${move.to}`} onClick={() => dispatch({ type: "start.moveHq", playerId: actor, ...move })}>
                MOVE HQ · {move.from.replaceAll("_", " ")} → {move.to.replaceAll("_", " ")}
              </Btn>
            ))}
          </div>
        )}
        {canRally && (
          <div className="mb-3">
            <Btn onClick={() => dispatch({ type: "missilePower.rally", playerId: actor })}>RALLY · SPEND 1 MISSILE</Btn>
          </div>
        )}
        <div className="flex gap-2 items-center">
          <Btn tone="primary" disabled={ui.selectedCards.length !== starCost}
            onClick={() => dispatch({ type: "start.buyRedStar", playerId: actor, cardIds: ui.selectedCards })}>
            <span className="inline-flex items-center gap-1.5">
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" aria-hidden="true"><path d={STAR_PATH} fill="currentColor" /></svg>
              BUY RED STAR ({ui.selectedCards.length}/{starCost})
            </span>
          </Btn>
          <Btn onClick={() => dispatch({ type: "start.done", playerId: actor })}>
            {hasTerritory ? "BEGIN RECRUITMENT" : "JOIN THE WAR"}
          </Btn>
        </div>
      </BottomDock>
    );
  }

  if (gs.phase !== "end_turn") return null;

  const decision = endTurnDecision(gs, actor);
  if (!decision.eligibleForDraw) {
    return (
      <BottomDock label="End of turn">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-display font-bold tracking-widest text-sm">END OF TURN</h3>
          <DecisionChip name={player.name} color={color} factionId={player.factionId} />
        </div>
        <Btn tone="primary" onClick={() => dispatch({ type: "end.turn", playerId: actor })}>END TURN</Btn>
      </BottomDock>
    );
  }

  if (!decision.drawAvailable) {
    return (
      <BottomDock label="End of turn">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-display font-bold tracking-widest text-sm">NO RESOURCE CARD AVAILABLE</h3>
          <DecisionChip name={player.name} color={color} factionId={player.factionId} />
        </div>
        <p className="text-xs text-muted mb-3">
          The coin pile is empty and no face-up Territory card matches. Continue without drawing.
        </p>
        <Btn tone="primary" onClick={() => dispatch({ type: "end.turn", playerId: actor })}>END TURN</Btn>
      </BottomDock>
    );
  }

  const hasMatch = decision.matchingSlots.length > 0;
  const canRecon = !!player.factionId && gs.factionMissilePowers[player.factionId] === "recon"
    && player.missiles > 0 && !gs.missilePowersUsedThisTurn.includes(actor) && !hasMatch && decision.coinAvailable;
  const coinCount = (gs.sideboard as GameState["sideboard"] & { coinCount?: number }).coinCount
    ?? gs.sideboard.coinPile.length;
  return (
    <BottomDock label="End of turn">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-display font-bold tracking-widest text-sm">DRAW A RESOURCE CARD</h3>
        <DecisionChip name={player.name} color={color} factionId={player.factionId} />
      </div>
      <p className="text-xs text-muted mb-2">
        {decision.earnedBy === "expansionist_supply"
          ? "EXPANSIONIST SUPPLY — you may draw after expanding into four territories."
          : "You conquered enemy territory — draw one Resource card."}
        {hasMatch && <span className="text-signal"> A face-up card matches your territory: taking it is mandatory before coins.</span>}
      </p>
      <div className="flex items-end gap-3 flex-wrap">
        {gs.sideboard.slots.map((cardId, slot) => {
          const matches = decision.matchingSlots.includes(slot);
          return (
            <div key={slot} className="flex flex-col items-center gap-1.5">
              {cardId
                ? <ResourceCard size="md" cardId={cardId} resources={cardResources(gs, cardId)} selected={matches} />
                : <span className="block w-24 aspect-[5/7] rounded-[6%] border border-line bg-ink/30" />}
              {cardId && matches ? (
                <span className="flex flex-col gap-1">
                  <Btn tone="primary" ariaLabel={`Take slot ${slot + 1}`}
                    onClick={() => dispatch({ type: "end.draw", playerId: actor, choice: { slot } })}>TAKE</Btn>
                  {decision.canKhanReinforce && (
                    <Btn ariaLabel={`Take slot ${slot + 1} and reinforce`}
                      onClick={() => dispatch({ type: "end.draw", playerId: actor, choice: { slot }, khanReinforce: true })}>
                      TAKE +1 TROOP
                    </Btn>
                  )}
                </span>
              ) : cardId && canRecon ? (
                <Btn ariaLabel={`Recon slot ${slot + 1}`}
                  onClick={() => dispatch({ type: "end.draw", playerId: actor, choice: { reconSlot: slot } })}>RECON</Btn>
              ) : <span className="font-mono text-[9px] text-muted">slot {slot + 1}</span>}
            </div>
          );
        })}
        <div className="flex flex-col items-center gap-1.5 ml-2">
          <CoinFace pile className={`block w-14 aspect-square rounded-full ${coinCount === 0 ? "opacity-30" : ""}`} />
          <Btn disabled={hasMatch || !decision.coinAvailable}
            onClick={() => dispatch({ type: "end.draw", playerId: actor, choice: { coin: true } })}>TAKE COIN</Btn>
        </div>
        {decision.canEndTurn && (
          <Btn onClick={() => dispatch({ type: "end.turn", playerId: actor })}>END TURN WITHOUT DRAW</Btn>
        )}
      </div>
    </BottomDock>
  );
}

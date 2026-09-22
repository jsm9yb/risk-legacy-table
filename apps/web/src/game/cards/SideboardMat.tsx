// rail sideboard mat modeled on the rulebook illustration — top row
// DRAW (face-down stack) · COIN (face-up pile) · MISSION · EVENT (sealed outlines until
// modules unlock) · DISCARD; bottom row numbered slots 1→4 face-up; red star pool beside.
import { useEffect } from "react";
import { resourceCardDefinition, type GameState, type LegacyCard, type TerritoryId } from "@risk/rules";
import { redStars, waitingOn, endTurnDecision } from "@risk/rules";
import { cardResources } from "../labels.ts";
import ResourceCard, { CoinFace, STAR_PATH } from "./ResourceCard.tsx";
import { CARD_TEXTURE_URL } from "./texture.ts";

function MatCell({ label, children, anchor }: { label: string; children: React.ReactNode; anchor?: string }) {
  return (
    <div className="flex flex-col items-center gap-1 min-w-0">
      <div data-table-anchor={anchor} className="h-16 flex items-center justify-center">{children}</div>
      <span className="font-mono text-[8px] text-muted uppercase tracking-wider text-center leading-tight">{label}</span>
    </div>
  );
}

function EmptySlot({ sealed }: { sealed?: boolean }) {
  return (
    <span className={`block w-11 aspect-[5/7] rounded-[6%] border ${
      sealed ? "border-dashed border-muted/50" : "border-line"} bg-ink/30`} />
  );
}

function LegacyFace({ card, kind }: { card: LegacyCard; kind: "mission" | "event" }) {
  return (
    <span title={`${card.title}: ${card.text}`}
      className={`block w-11 aspect-[5/7] rounded-[6%] border p-1 overflow-hidden ${
        kind === "mission" ? "border-signal bg-signal/10" : "border-danger bg-danger/10"}`}>
      <span className="block font-display font-bold text-[7px] leading-tight text-center uppercase">{card.title}</span>
      {card.reward && <span className="block font-mono text-[7px] text-center text-signal mt-1">+{card.reward} STAR</span>}
    </span>
  );
}

export default function SideboardMat({ gs, onTerritoryCardHover }: {
  gs: GameState;
  onTerritoryCardHover?: (territoryId: TerritoryId | undefined) => void;
}) {
  useEffect(() => () => onTerritoryCardHover?.(undefined), [onTerritoryCardHover]);
  const sb = gs.sideboard;
  const actor = waitingOn(gs);
  const decision = actor && gs.phase === "end_turn" ? endTurnDecision(gs, actor) : undefined;
  const deckCount = (sb as any).territoryDeckCount ?? sb.territoryDeck.length;
  const coinCount = (sb as any).coinCount ?? sb.coinPile.length;
  const discardTop = sb.discard[sb.discard.length - 1];
  const eventDeckCount = (gs.legacyCards as any).eventDeckCount ?? gs.legacyCards.eventDeck.length;
  const starsInPlay = gs.turnOrder.reduce((n, pid) => n + redStars(gs, pid).total, 0);

  return (
    <div>
      {decision?.drawAvailable && actor && <p role="status" className="text-sm text-signal mb-2">{gs.players[actor].name} is choosing a Resource card. {decision.matchingSlots.length ? "Highlighted cards match their territory." : "A Coin is available."}</p>}
      <div className="rounded-sm border border-line bg-panel-2 p-2" style={{ backgroundImage: `url(${CARD_TEXTURE_URL})` }}>
        <div className="grid grid-cols-5 gap-1 mb-2">
          <MatCell label={`draw ${deckCount}`} anchor="draw">
            {deckCount > 0 ? <ResourceCard size="xs" faceDown /> : <EmptySlot />}
          </MatCell>
          <MatCell label={`coin ${coinCount}`} anchor="coin">
            {coinCount > 0
              ? <CoinFace pile className="block w-8 aspect-square rounded-full" />
              : <EmptySlot />}
          </MatCell>
          <MatCell label="mission">
            {gs.legacyCards.activeMission
              ? <LegacyFace card={gs.legacyCards.activeMission} kind="mission" />
              : <EmptySlot sealed />}
          </MatCell>
          <MatCell label={`event ${eventDeckCount}`}>
            {gs.legacyCards.pendingEvent
              ? <LegacyFace card={gs.legacyCards.pendingEvent} kind="event" />
              : <EmptySlot sealed={eventDeckCount === 0} />}
          </MatCell>
          <MatCell label={`discard ${sb.discard.length}`} anchor="discard">
            {discardTop ? <ResourceCard size="xs" cardId={discardTop} resources={cardResources(gs, discardTop)} /> : <EmptySlot />}
          </MatCell>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {sb.slots.map((id, i) => (
            <div key={i} data-table-anchor="sideboard" data-anchor-id={`${i}`} className="flex flex-col items-center gap-1">
              {id ? <ResourceCard size="sm" cardId={id} resources={cardResources(gs, id)}
                selected={decision?.drawAvailable && decision.matchingSlots.includes(i)}
                onHoverChange={(hovered) => {
                  const definition = resourceCardDefinition(id);
                  onTerritoryCardHover?.(hovered && definition?.kind === "territory" ? definition.territoryId : undefined);
                }} /> : <EmptySlot />}
              <span className="font-mono text-[8px] text-muted">{i + 1}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-1.5 font-mono text-[10px] text-muted">
        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" aria-hidden="true">
          <path d={STAR_PATH} fill="#c9504a" />
        </svg>
        red stars in play: {starsInPlay}
      </div>
    </div>
  );
}

// new (UI-9): rail sideboard mat modeled on the rulebook illustration — top row
// DRAW (face-down stack) · COIN (face-up pile) · MISSION · EVENT (sealed outlines until
// modules unlock) · DISCARD; bottom row numbered slots 1→4 face-up; red star pool beside.
import type { GameState } from "@risk/rules";
import { redStars } from "@risk/rules";
import { cardResources } from "../labels.ts";
import ResourceCard, { STAR_PATH } from "./ResourceCard.tsx";
import { CARD_TEXTURE_URL } from "./texture.ts";

function MatCell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 min-w-0">
      <div className="h-16 flex items-center justify-center">{children}</div>
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

export default function SideboardMat({ gs }: { gs: GameState }) {
  const sb = gs.sideboard;
  const deckCount = (sb as any).territoryDeckCount ?? sb.territoryDeck.length;
  const coinCount = (sb as any).coinCount ?? sb.coinPile.length;
  const discardTop = sb.discard[sb.discard.length - 1];
  const starsInPlay = gs.turnOrder.reduce((n, pid) => n + redStars(gs, pid).total, 0);

  return (
    <div>
      <div className="rounded-sm border border-line bg-panel-2 p-2" style={{ backgroundImage: `url(${CARD_TEXTURE_URL})` }}>
        <div className="grid grid-cols-5 gap-1 mb-2">
          <MatCell label={`draw ${deckCount}`}>
            {deckCount > 0 ? <ResourceCard size="xs" faceDown /> : <EmptySlot />}
          </MatCell>
          <MatCell label={`coin ${coinCount}`}>
            {coinCount > 0
              ? <span data-coin-pile className="coin-face block w-8 aspect-square rounded-full relative">
                  <svg viewBox="0 0 24 24" className="absolute inset-[16%]" aria-hidden="true">
                    <path d={STAR_PATH} fill="#8a6d1c" opacity="0.55" />
                  </svg>
                </span>
              : <EmptySlot />}
          </MatCell>
          <MatCell label="mission"><EmptySlot sealed /></MatCell>
          <MatCell label="event"><EmptySlot sealed /></MatCell>
          <MatCell label={`discard ${sb.discard.length}`}>
            {discardTop ? <ResourceCard size="xs" cardId={discardTop} resources={cardResources(gs, discardTop)} /> : <EmptySlot />}
          </MatCell>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {sb.slots.map((id, i) => (
            <div key={i} className="flex flex-col items-center gap-1">
              {id ? <ResourceCard size="sm" cardId={id} resources={cardResources(gs, id)} /> : <EmptySlot />}
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

// new (UI-9): physical-game-styled Resource card. One deck, two faces: territory cards
// (yellow name banner, textured gray art panel with the board's own territory silhouette
// filled per continent, yellow lower panel with a 3×2 grid of six coin slots) and coin
// cards (one big coin face). Face-down cards show the black logo back. Textures are
// code-drawn behind the CARD_TEXTURE_URL seam (texture.ts).
import { continentColors, territoryById, territoryPath } from "@risk/map";
import { cardDef, territoryName } from "../labels.ts";
import { CARD_TEXTURE_URL } from "./texture.ts";

export type CardSize = "xs" | "sm" | "md" | "lg";
const SIZES: Record<CardSize, string> = {
  xs: "w-12 text-[5px]",
  sm: "w-16 text-[6.5px]",
  md: "w-24 text-[9px]",
  lg: "w-32 text-[12px]",
};

export const STAR_PATH =
  "M12 1.6 L14.9 8.2 L22.1 8.9 L16.6 13.6 L18.4 20.7 L12 16.8 L5.6 20.7 L7.4 13.6 L1.9 8.9 L9.1 8.2 Z";

export function CoinFace({ className = "", pile }: { className?: string; pile?: boolean }) {
  return (
    <span data-coin="filled" data-coin-pile={pile ? "" : undefined}
      className={`coin-face relative overflow-hidden ${className}`}>
      <svg viewBox="0 0 32 32" className="absolute inset-[14%]" aria-hidden="true">
        <circle cx="16" cy="16" r="12.2" fill="none" stroke="#7b431f" strokeWidth="1.4" opacity="0.55" />
        <path d="M18.8 8.2 C15.3 8.4 12.8 11.1 12.8 14.4 C12.8 16.5 13.8 18.3 15.2 19.4 C13.3 20.6 11.8 22.7 11.2 25.2 H23.5 C22.9 22.5 21.2 20.4 19.1 19.2 C20.1 18.4 20.9 17.2 21.2 15.8 L18.1 15.8 C18.9 14.5 19.4 13 19.2 11.4 C19.1 10.2 18.9 9.1 18.8 8.2 Z"
          fill="#6f3f21" opacity="0.72" />
      </svg>
    </span>
  );
}

function CoinPip({ filled }: { filled: boolean }) {
  return (
    filled
      ? <CoinFace className="block aspect-square rounded-full" />
      : <span data-coin="empty" className="block aspect-square rounded-full border border-[#8a6d1c]/50" />
  );
}

function TerritoryArt({ territoryId }: { territoryId: string }) {
  const geo = territoryPath(territoryId);
  if (!geo) return null;
  const territory = territoryById(territoryId);
  const context = territory.neighbors
    .filter((id) => territoryById(id).continent === territory.continent)
    .map((id) => ({ id, geo: territoryPath(id)! }))
    .filter((entry) => !!entry.geo);
  const crop = unionBox([geo, ...context.map((entry) => entry.geo)].map((entry) => entry.bbox));
  const [x1, y1, x2, y2] = crop;
  const w = x2 - x1;
  const h = y2 - y1;
  const pad = Math.max(w, h) * 0.12;
  const color = continentColors[territory.continent] ?? "#9a9a94";
  const stroke = Math.max(Math.max(w, h) * 0.018, 1.8);
  return (
    <svg data-territory-art viewBox={`${x1 - pad} ${y1 - pad} ${w + pad * 2} ${h + pad * 2}`}
      preserveAspectRatio="xMidYMid meet" className="absolute inset-0 w-full h-full" aria-hidden="true">
      {context.map((entry) => (
        <path key={entry.id} data-context-territory={entry.id} d={entry.geo.d}
          fill={color} opacity="0.28" stroke="#f7f2da" strokeWidth={stroke * 0.55} strokeLinejoin="round" />
      ))}
      <path data-selected-territory={territoryId} d={geo.d} fill={color}
        stroke="#fff7cf" strokeWidth={stroke} strokeLinejoin="round" />
      <path d={geo.d} fill="none" stroke="#15120b" strokeWidth={stroke * 0.34} strokeLinejoin="round" opacity="0.55" />
    </svg>
  );
}

function unionBox(boxes: readonly (readonly [number, number, number, number])[]) {
  return boxes.reduce<readonly [number, number, number, number]>((acc, box) => [
    Math.min(acc[0], box[0]),
    Math.min(acc[1], box[1]),
    Math.max(acc[2], box[2]),
    Math.max(acc[3], box[3]),
  ], boxes[0]);
}

export default function ResourceCard({ cardId, resources, size = "md", faceDown, selected, onClick, title }: {
  /** Omit (with faceDown) for anonymous backs in decks/hidden hands. */
  cardId?: string;
  /** Current resource value incl. upgrades; defaults to the pack's printed value. */
  resources?: number;
  size?: CardSize;
  faceDown?: boolean;
  selected?: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const frame = `${SIZES[size]} aspect-[5/7] relative shrink-0 rounded-[6%] overflow-hidden shadow-md shadow-black/40 ${
    selected ? "ring-2 ring-signal" : ""} ${onClick ? "cursor-pointer hover:ring-1 hover:ring-signal/60" : ""}`;

  if (faceDown || !cardId) {
    return (
      <Frame frame={frame} onClick={onClick} title={title}>
        <div data-card-back className="absolute inset-0 bg-[#101215] flex items-center justify-center"
          style={{ backgroundImage: `url(${CARD_TEXTURE_URL})` }}>
          <svg viewBox="0 0 24 24" className="w-1/2" aria-hidden="true">
            <path d={STAR_PATH} fill="#c9504a" stroke="#2a0c0c" strokeWidth="0.8" />
          </svg>
        </div>
      </Frame>
    );
  }

  const def = cardDef(cardId);
  const value = Math.max(0, resources ?? def.resources);

  if (def.kind === "coin") {
    return (
      <Frame frame={frame} onClick={onClick} title={title} cardId={cardId}>
        <div className="absolute inset-0 bg-[#efe7d2] flex items-center justify-center"
          style={{ backgroundImage: `url(${CARD_TEXTURE_URL})` }}>
          <CoinFace className="block w-[58%] aspect-square rounded-full" />
          <span className="absolute bottom-[2.5%] right-[5%] font-mono text-[0.9em] text-[#6b5b23]">{def.id}</span>
        </div>
      </Frame>
    );
  }

  return (
    <Frame frame={frame} onClick={onClick} title={title ?? territoryName(def.territoryId)} cardId={cardId}>
      <div className="absolute inset-0 bg-[#efe7d2] flex flex-col" style={{ backgroundImage: `url(${CARD_TEXTURE_URL})` }}>
        <div className="bg-[#e0b73b] border-b border-[#8a6d1c]/40 text-[#161006] font-display font-bold uppercase text-center leading-tight px-[4%] py-[4%] text-[1.15em] min-h-[16%] flex items-center justify-center">
          {territoryName(def.territoryId)}
        </div>
        <div className="relative flex-1 mx-[6%] my-[4%] rounded-[3%] overflow-hidden bg-[#a9aaa2]"
          style={{ backgroundImage: `url(${CARD_TEXTURE_URL})` }}>
          <TerritoryArt territoryId={def.territoryId} />
        </div>
        <div className="bg-[#e0b73b] border-t border-[#8a6d1c]/40 px-[14%] pt-[4%] pb-[6%]">
          <div className="grid grid-cols-3 gap-[6%]">
            {Array.from({ length: 6 }, (_, i) => <CoinPip key={i} filled={i < value} />)}
          </div>
        </div>
        <span className="absolute bottom-[1%] right-[4%] font-mono text-[0.85em] text-[#6b5b23]">{def.id}</span>
      </div>
    </Frame>
  );
}

function Frame({ frame, onClick, title, cardId, children }: {
  frame: string; onClick?: () => void; title?: string; cardId?: string; children: React.ReactNode;
}) {
  if (onClick) {
    return (
      <button type="button" onClick={onClick} title={title} data-card-id={cardId} className={frame}>
        {children}
      </button>
    );
  }
  return <div title={title} data-card-id={cardId} className={frame}>{children}</div>;
}

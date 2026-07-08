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

function CoinPip({ filled }: { filled: boolean }) {
  return (
    <span data-coin={filled ? "filled" : "empty"}
      className={`block aspect-square rounded-full ${filled ? "coin-face" : "border border-[#8a6d1c]/50"}`} />
  );
}

function Silhouette({ territoryId }: { territoryId: string }) {
  const geo = territoryPath(territoryId);
  if (!geo) return null;
  const [x1, y1, x2, y2] = geo.bbox;
  const w = x2 - x1;
  const h = y2 - y1;
  const pad = Math.max(w, h) * 0.09;
  const color = continentColors[territoryById(territoryId).continent] ?? "#9a9a94";
  return (
    <svg data-silhouette viewBox={`${x1 - pad} ${y1 - pad} ${w + pad * 2} ${h + pad * 2}`}
      preserveAspectRatio="xMidYMid meet" className="absolute inset-0 w-full h-full" aria-hidden="true">
      <path d={geo.d} fill={color} stroke="#ffffff" strokeWidth={Math.max(w, h) * 0.022} strokeLinejoin="round" />
    </svg>
  );
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
          <span data-coin="filled" className="coin-face block w-[58%] aspect-square rounded-full relative">
            <svg viewBox="0 0 24 24" className="absolute inset-[16%]" aria-hidden="true">
              <path d={STAR_PATH} fill="#8a6d1c" opacity="0.55" />
            </svg>
          </span>
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
          <Silhouette territoryId={def.territoryId} />
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

// Faction emblem — framed vector mark with a circular crop at small sizes. Unknown
// custom/legacy faction ids retain a styled monogram fallback.
import { factionById } from "./labels.ts";
import { FACTION_EMBLEMS } from "./factionAssets.ts";

export type EmblemSize = "xs" | "sm" | "md" | "lg";
const SIZES: Record<EmblemSize, string> = {
  xs: "w-7 h-7 border-2",
  sm: "w-10 h-10 border-2",
  md: "w-14 h-14 border-2",
  lg: "w-24 h-24 border-4",
};
// circular crop at small sizes; framed rounded tile at md+
const SHAPES: Record<EmblemSize, string> = {
  xs: "rounded-full",
  sm: "rounded-full",
  md: "rounded-md",
  lg: "rounded-lg",
};

export default function FactionEmblem({ factionId, size = "md", className }: {
  factionId?: string;
  size?: EmblemSize;
  className?: string;
}) {
  const faction = factionById(factionId);
  const art = factionId ? FACTION_EMBLEMS[factionId] : undefined;
  const frame = `${SIZES[size]} ${SHAPES[size]} shrink-0 overflow-hidden bg-[#101215] inline-flex items-center justify-center ${className ?? ""}`;
  const borderColor = faction?.color ?? "#5a6578";

  if (art) {
    return (
      <span data-emblem={factionId} className={frame} style={{ borderColor, boxShadow: `0 0 0 1px ${borderColor}55, 0 3px 10px #0008` }}>
        <img src={art} alt={`${faction?.name ?? factionId} emblem`} className="w-full h-full object-contain" />
      </span>
    );
  }
  // Styled fallback for custom/legacy faction ids outside the canonical content pack.
  const initials = (faction?.name ?? factionId ?? "?")
    .split(/\s+/)
    .map((w) => w[0])
    .filter((ch) => !!ch && /[A-Za-z0-9]/.test(ch))
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";
  const textSize = { xs: "text-[9px]", sm: "text-xs", md: "text-lg", lg: "text-3xl" }[size];
  return (
    <span data-emblem={factionId ?? "unknown"} data-emblem-fallback className={frame}
      style={{ borderColor, boxShadow: `0 0 0 1px ${borderColor}55, 0 3px 10px #0008` }}>
      <span className={`font-display font-bold ${textSize}`} style={{ color: borderColor }}>{initials}</span>
    </span>
  );
}

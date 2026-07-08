// new (UI-10): faction emblem — framed tile with a faction-color border, circular crop at
// small sizes. Falls back to a styled monogram for factions without art (module factions).
import { factionById } from "./labels.ts";
import { FACTION_EMBLEMS } from "./factionAssets.ts";

export type EmblemSize = "xs" | "sm" | "md" | "lg";
const SIZES: Record<EmblemSize, string> = {
  xs: "w-5 h-5 border",
  sm: "w-9 h-9 border-2",
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

export default function FactionEmblem({ factionId, size = "md" }: { factionId?: string; size?: EmblemSize }) {
  const faction = factionById(factionId);
  const art = factionId ? FACTION_EMBLEMS[factionId] : undefined;
  const frame = `${SIZES[size]} ${SHAPES[size]} shrink-0 overflow-hidden bg-[#101215] inline-flex items-center justify-center`;
  const borderColor = faction?.color ?? "#5a6578";

  if (art) {
    return (
      <span data-emblem={factionId} className={frame} style={{ borderColor }}>
        <img src={art} alt={`${faction?.name ?? factionId} emblem`} className="w-full h-full object-cover" />
      </span>
    );
  }
  // styled fallback: faction-color monogram tile (module factions without art)
  const initials = (faction?.name ?? factionId ?? "?")
    .split(/\s+/)
    .map((w) => w[0])
    .filter((ch) => !!ch && /[A-Za-z0-9]/.test(ch))
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";
  const textSize = { xs: "text-[9px]", sm: "text-xs", md: "text-lg", lg: "text-3xl" }[size];
  return (
    <span data-emblem={factionId ?? "unknown"} data-emblem-fallback className={frame} style={{ borderColor }}>
      <span className={`font-display font-bold ${textSize}`} style={{ color: borderColor }}>{initials}</span>
    </span>
  );
}

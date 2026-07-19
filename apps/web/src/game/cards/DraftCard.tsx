import type { DraftCategory } from "@risk/rules";

const categoryTitles: Record<DraftCategory, string> = {
  faction: "Faction",
  turnOrder: "Turn Order",
  placementOrder: "Starting Placement",
  startingTroops: "Starting Troops",
  startingCoinCards: "Starting Coin Cards",
};

export function draftCardLabel(category: DraftCategory, value: string | number, factionName?: string) {
  if (category === "faction") return factionName ?? String(value);
  if (category === "turnOrder") return `Turn ${value}`;
  if (category === "placementOrder") return `Place ${value}`;
  if (category === "startingTroops") return `${value} Troops`;
  return `${value} Coin Card${value === 1 ? "" : "s"}`;
}

export default function DraftCard({ category, value, factionName, selected, disabled, onSelect, compact = false }: {
  category: DraftCategory;
  value: string | number;
  factionName?: string;
  selected?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  compact?: boolean;
}) {
  const className = `${compact ? "w-24 min-h-28" : "w-28 min-h-36"} relative shrink-0 rounded-md border-2 p-2 bg-[#e8dfc8] text-[#18140d] shadow-lg transition ${
    selected ? "border-signal -translate-y-1 ring-2 ring-signal/40" : "border-[#655d4c]"} ${disabled ? "opacity-50" : "hover:-translate-y-1 hover:border-signal"}`;
  const body = <>
    <span className="block font-mono text-[8px] uppercase tracking-widest text-[#675f50]">{categoryTitles[category]}</span>
    <span className="block border-y border-[#8b806a] my-2 py-3 font-display font-black tracking-wide text-center text-sm leading-tight">{draftCardLabel(category, value, factionName)}</span>
    <span aria-hidden className="absolute bottom-2 left-1/2 -translate-x-1/2 text-xl text-[#9b853b]">★</span>
  </>;
  return onSelect ? <button type="button" disabled={disabled} aria-pressed={selected} onClick={onSelect} className={className}>{body}</button>
    : <div className={className}>{body}</div>;
}

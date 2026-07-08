// new (UI-12): scar card — the full scar art as a physical-styled card, used by the
// scar-play flow in the hand strip (the board shows the matching circular chip, UI-10).
import { scarName } from "../labels.ts";
import { SCAR_ART } from "../factionAssets.ts";
import { CARD_TEXTURE_URL } from "./texture.ts";

export default function ScarCard({ scarId, size = "sm", onClick, selected }: {
  scarId: string;
  size?: "sm" | "md";
  onClick?: () => void;
  selected?: boolean;
}) {
  const dims = size === "sm" ? "w-16 text-[6.5px]" : "w-28 text-[10px]";
  const art = SCAR_ART[scarId];
  const name = scarName(scarId);
  const body = (
    <span className="absolute inset-0 bg-[#14090a] flex flex-col" style={{ backgroundImage: `url(${CARD_TEXTURE_URL})` }}>
      <span className="bg-danger/90 text-ink font-display font-bold uppercase text-center leading-tight px-[4%] py-[4%] text-[1.15em]">
        {name}
      </span>
      <span className="relative flex-1 m-[6%] rounded-[3%] overflow-hidden border border-danger/40 bg-[#1a0d0e]">
        {art
          ? <img src={art} alt={`${name} scar`} className="absolute inset-0 w-full h-full object-cover" />
          : <span className="absolute inset-0 flex items-center justify-center font-display font-bold text-danger text-[2.5em]">!</span>}
      </span>
    </span>
  );
  const frame = `${dims} aspect-[5/7] relative shrink-0 rounded-[6%] overflow-hidden shadow-md shadow-black/40 ${
    selected ? "ring-2 ring-danger" : ""} ${onClick ? "cursor-pointer hover:ring-1 hover:ring-danger/70" : ""}`;
  if (onClick) {
    return (
      <button type="button" data-scar-card={scarId} aria-label={`Play ${name}`} onClick={onClick} className={frame}>
        {body}
      </button>
    );
  }
  return <span data-scar-card={scarId} className={frame}>{body}</span>;
}

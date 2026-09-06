import ammoShortage from "../../assets/scars/ammo_shortage-scar.svg?raw";
import biohazard from "../../assets/scars/biohazard-scar.svg?raw";
import bunker from "../../assets/scars/bunker-scar.svg?raw";
import mercenary from "../../assets/scars/mercenary-scar.svg?raw";
import weakness from "../../assets/scars/weakness-scar.svg?raw";
import fortification from "../../assets/scars/fortification-scar.svg?raw";
import fallout from "../../assets/scars/fallout-scar.svg?raw";

/**
 * Compact physical-sticker-inspired marks for scars that need more than a text
 * abbreviation to read on the table. The SVGs deliberately retain bold shapes
 * and limited colors so they remain recognizable at a 10 px board footprint.
 */
export const SCAR_MARK_ASSETS: Readonly<Partial<Record<string, string>>> = Object.freeze({
  ammo_shortage: ammoShortage,
  biohazard,
  bunker,
  mercenary,
  weakness,
  fortification,
  fallout,
});

export function scarMarkAsset(scarId: string) {
  return SCAR_MARK_ASSETS[scarId];
}

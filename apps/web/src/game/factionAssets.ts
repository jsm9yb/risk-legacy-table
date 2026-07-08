// new (UI-10): faction + scar art registry. Emblem PNGs have solid dark backgrounds —
// render them inside framed tiles (faction-color border) and circular crops at small
// sizes. Module factions without art fall back to FactionEmblem's styled monogram.
import dieMechaniker from "../assets/factions/die_mechaniker.png";
import enclaveOfTheBear from "../assets/factions/enclave_of_the_bear.png";
import imperialBalkania from "../assets/factions/imperial_balkania.png";
import khanIndustries from "../assets/factions/khan_industries.png";
import saharanRepublic from "../assets/factions/saharan_republic.png";
import ammoShortage from "../assets/scars/ammo_shortage.png";
import biohazard from "../assets/scars/biohazard.png";
import bunker from "../assets/scars/bunker.png";
import fallout from "../assets/scars/fallout.png";
import fortification from "../assets/scars/fortification.png";
import mercenary from "../assets/scars/mercenary.png";
import weakness from "../assets/scars/weakness.png";

export const FACTION_EMBLEMS: Record<string, string> = {
  die_mechaniker: dieMechaniker,
  enclave_of_the_bear: enclaveOfTheBear,
  imperial_balkania: imperialBalkania,
  khan_industries: khanIndustries,
  saharan_republic: saharanRepublic,
};

/** Short player-facing flavor per base faction (UI copy, not rules data). */
export const FACTION_BLURBS: Record<string, string> = {
  die_mechaniker: "Precision engineers whose headquarters never falls cheap.",
  enclave_of_the_bear: "Frontier clans that break an enemy's nerve before the charge.",
  imperial_balkania: "A sprawling bureaucracy that turns population into armies.",
  khan_industries: "A corporate war machine with supply depots everywhere.",
  saharan_republic: "Desert nomads who move where no road exists.",
};

/** Distinct troop-marker silhouettes so factions read beyond color on the board (UI-10). */
export type TroopShape = "circle" | "square" | "diamond" | "hex" | "shield";
export const FACTION_TROOP_SHAPES: Record<string, TroopShape> = {
  die_mechaniker: "square",
  enclave_of_the_bear: "hex",
  imperial_balkania: "diamond",
  khan_industries: "circle",
  saharan_republic: "shield",
};

export const SCAR_ART: Record<string, string> = {
  ammo_shortage: ammoShortage,
  biohazard,
  bunker,
  fallout,
  fortification,
  mercenary,
  weakness,
};

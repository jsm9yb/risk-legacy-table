// Bold vector silhouettes keep faction and scar marks readable on the board's 14px
// chips. Their circular sticker language is inspired by Risk Legacy's original
// low-ammo and fortification iconography.
import dieMechaniker from "../assets/factions/die_mechaniker-mark.svg";
import enclaveOfTheBear from "../assets/factions/enclave_of_the_bear-mark.svg";
import imperialBalkania from "../assets/factions/imperial_balkania-mark.svg";
import khanIndustries from "../assets/factions/khan_industries-mark.svg";
import saharanRepublic from "../assets/factions/saharan_republic-mark.svg";
import mutants from "../assets/factions/mutants-mark.svg";
import aliens from "../assets/factions/aliens-mark.svg";
import dieMechanikerCard from "../assets/faction-cards/die_mechaniker.jpg";
import enclaveOfTheBearCard from "../assets/faction-cards/enclave_of_the_bear.jpg";
import imperialBalkaniaCard from "../assets/faction-cards/imperial_balkania.jpg";
import khanIndustriesCard from "../assets/faction-cards/khan_industries.jpg";
import saharanRepublicCard from "../assets/faction-cards/saharan_republic.jpg";
import mutantsCard from "../assets/faction-cards/mutants.jpg";
import aliensCard from "../assets/faction-cards/aliens.jpg";
import ammoShortage from "../assets/scars/ammo_shortage-card.webp";
import biohazard from "../assets/scars/biohazard-scar.svg";
import bunker from "../assets/scars/bunker-scar.svg";
import fallout from "../assets/scars/fallout-scar.svg";
import fortification from "../assets/scars/fortification-scar.svg";
import mercenary from "../assets/scars/mercenary-scar.svg";
import weakness from "../assets/scars/weakness-scar.svg";

export const FACTION_EMBLEMS: Record<string, string> = {
  die_mechaniker: dieMechaniker,
  enclave_of_the_bear: enclaveOfTheBear,
  imperial_balkania: imperialBalkania,
  khan_industries: khanIndustries,
  saharan_republic: saharanRepublic,
  mutants,
  aliens,
};

/** Scans of the physical faction-card fronts, used by the setup draft. */
export const FACTION_CARD_ART: Record<string, string> = {
  die_mechaniker: dieMechanikerCard,
  enclave_of_the_bear: enclaveOfTheBearCard,
  imperial_balkania: imperialBalkaniaCard,
  khan_industries: khanIndustriesCard,
  saharan_republic: saharanRepublicCard,
  mutants: mutantsCard,
  aliens: aliensCard,
};

/** The two sealed-faction scans are stored portrait-first and rotate in the card frame. */
export const FACTION_CARD_ART_ROTATIONS: Record<string, "clockwise" | "counterclockwise"> = {
  mutants: "counterclockwise",
  aliens: "clockwise",
};

/** Short player-facing flavor per base faction (UI copy, not rules data). */
export const FACTION_BLURBS: Record<string, string> = {
  die_mechaniker: "Precision engineers whose headquarters never falls cheap.",
  enclave_of_the_bear: "Frontier clans that break an enemy's nerve before the charge.",
  imperial_balkania: "A sprawling bureaucracy that turns population into armies.",
  khan_industries: "A corporate war machine with supply depots everywhere.",
  saharan_republic: "Desert nomads who move where no road exists.",
  mutants: "Fallout-born survivors who turn poisoned ground into an advantage.",
  aliens: "Invaders from beyond the world, reinforced by cities and Alien Island.",
};

/** Distinct troop-marker silhouettes so factions read beyond color on the board (UI-10). */
export type TroopShape = "circle" | "square" | "diamond" | "hex" | "shield" | "burst" | "teardrop";
export const FACTION_TROOP_SHAPES: Record<string, TroopShape> = {
  die_mechaniker: "square",
  enclave_of_the_bear: "hex",
  imperial_balkania: "diamond",
  khan_industries: "circle",
  saharan_republic: "shield",
  mutants: "burst",
  aliens: "teardrop",
};

export const SCAR_ART: Record<string, string> = {
  ammo_shortage: ammoShortage,
  biohazard,
  bunker,
  fallout,
  fortification,
  mercenary,
  weakness,
  weakness_cautious: weakness,
  weakness_purist: weakness,
  weakness_short_sighted: weakness,
  weakness_city_shy: weakness,
  weakness_primitive: weakness,
  weakness_yellow: weakness,
};

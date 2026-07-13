import { contentPack } from "@risk/content";

/** The sealed Alien Island Territory card joins the Resource deck when Pocket 2 opens. */
export const ALIEN_ISLAND_CARD_ID = "alien_island_resource";

export const alienIslandTerritoryCard = {
  id: ALIEN_ISLAND_CARD_ID,
  kind: "territory" as const,
  territoryId: "alien_island",
  resources: 1,
};

export type ResourceCardDefinition =
  | (typeof contentPack.cards.territoryCards)[number]
  | (typeof contentPack.cards.coinCards)[number]
  | typeof alienIslandTerritoryCard;

export function resourceCardDefinition(id: string): ResourceCardDefinition | undefined {
  return contentPack.cards.territoryCards.find((card) => card.id === id)
    ?? contentPack.cards.coinCards.find((card) => card.id === id)
    ?? (id === ALIEN_ISLAND_CARD_ID ? alienIslandTerritoryCard : undefined);
}

export function territoryCardDefinitions(includeAlienIsland = false) {
  return includeAlienIsland
    ? [...contentPack.cards.territoryCards, alienIslandTerritoryCard]
    : [...contentPack.cards.territoryCards];
}

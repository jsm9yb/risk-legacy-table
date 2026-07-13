// new (UI-1): player-facing labels for content ids — the UI never shows raw snake_case ids.
import { contentPack, factionDefinitionById } from "@risk/content";
import { manifest } from "@risk/map";
import { resourceCardDefinition, type GameState } from "@risk/rules";

const territoryNames = new Map(manifest.territories.map((t) => [t.id, t.name]));
const continentNames = new Map(manifest.continents.map((c) => [c.id, c.name]));

export const titleCase = (id: string) =>
  id.replace(/_/g, " ").replace(/\b[a-z]/g, (ch) => ch.toUpperCase());

export const territoryName = (id: string) => territoryNames.get(id) ?? titleCase(id);
export const continentName = (id: string) => continentNames.get(id) ?? titleCase(id);

export const factionById = (id?: string) => id
  ? factionDefinitionById(id, contentPack.sealedFactions.map((faction) => faction.sourceModuleId))
  : undefined;
export const powerById = (id: string) => contentPack.powers.find((p) => p.id === id);
export const powerName = (id: string) => powerById(id)?.name ?? titleCase(id);
export const scarById = (id: string) => contentPack.scars.find((sc) => sc.id === id);
export const scarName = (id: string) => scarById(id)?.name ?? titleCase(id);

export const cardDef = (id: string) => resourceCardDefinition(id)!;

export const cardLabel = (id: string) => {
  const c = cardDef(id);
  return c.kind === "territory"
    ? `${territoryName(c.territoryId)} (${c.resources})`
    : `Coin (${c.resources})`;
};

/** Current resource value of a card incl. upgrade_territory_card overrides (UI-9). */
export const cardResources = (gs: GameState, id: string) =>
  gs.cardModifications[id]?.resources ?? cardDef(id).resources;

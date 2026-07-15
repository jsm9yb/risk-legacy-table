import presentationJson from "../data/presentation.json" with { type: "json" };
import manifestJson from "../data/manifest.json" with { type: "json" };

export type TerritoryPresentationProfile = "tiny" | "normal" | "wide";
export type TroopPlacementSlot = [number, number, number];
export type TroopPlacementSlots = [
  TroopPlacementSlot,
  TroopPlacementSlot,
  TroopPlacementSlot,
  TroopPlacementSlot,
  TroopPlacementSlot,
];

interface AuthoredTerritoryPresentationDef {
  territoryId: string;
  cameraFocus: [number, number];
  /** Exactly one city, ruin, or fallout asset occupies this permanent-mark position. */
  architectureSlot: [number, number];
  /** Exactly one ordinary territory scar occupies this permanent-mark position. */
  scarSlot: [number, number];
  /** Military-layer position for the faction HQ, independent from permanent marks. */
  hqSlot: [number, number];
  /** @deprecated Printed registration reference retained for source compatibility. */
  markSlot?: [number, number];
  /** Three 3-unit footprints followed by two 1-unit footprints. */
  troopSlots: TroopPlacementSlots;
  profile: TerritoryPresentationProfile;
}

export interface ContinentPresentationDef {
  continentId: string;
  nameSlot: [number, number];
  bonusSlot: [number, number];
}

export interface TerritoryPresentationDef {
  territoryId: string;
  cameraFocus: [number, number];
  profile: TerritoryPresentationProfile;
  /** Three 3-unit footprints followed by two 1-unit footprints. */
  pieceSlots: TroopPlacementSlots;
  countSlot: [number, number];
  /** Compatibility alias retained for presentation-spec consumers. */
  overflowSlot: [number, number];
  architectureSlot: [number, number];
  hqSlot: [number, number];
  /** @deprecated Use architectureSlot. */
  citySlot: [number, number];
  scarSlot: [number, number];
  /** @deprecated Fortifications are baked into architecture assets. */
  fortificationSlot: [number, number];
  labelAvoidance: Array<[number, number, number, number]>;
  preferredRoutePorts: Partial<Record<string, [number, number]>>;
}

const source = presentationJson as {
  version: string;
  continents: ContinentPresentationDef[];
  territories: AuthoredTerritoryPresentationDef[];
};
const manifestSource = manifestJson as { continents: { id: string }[]; territories: { id: string }[] };

function expand(def: AuthoredTerritoryPresentationDef): TerritoryPresentationDef {
  const [x, y] = def.cameraFocus;
  const spread = def.profile === "tiny" ? 7 : def.profile === "wide" ? 11 : 9;
  const pieceSlots = def.troopSlots;
  const countSlot: [number, number] = [x, y + 28];
  return {
    territoryId: def.territoryId,
    profile: def.profile,
    cameraFocus: [x, y],
    pieceSlots,
    countSlot,
    overflowSlot: countSlot,
    architectureSlot: def.architectureSlot,
    hqSlot: def.hqSlot,
    citySlot: def.architectureSlot,
    scarSlot: def.scarSlot,
    fortificationSlot: def.architectureSlot,
    labelAvoidance: [[x - spread * 1.5, y - 2, spread * 3, 8]],
    preferredRoutePorts: {},
  };
}

export const presentationVersion = source.version;
export const continentPresentationDefinitions = source.continents;
const continentsById = new Map(continentPresentationDefinitions.map((definition) => [definition.continentId, definition]));

export function continentPresentationFor(continentId: string) {
  const definition = continentsById.get(continentId);
  if (!definition) throw new Error(`Missing continent presentation definition: ${continentId}`);
  return definition;
}

export const presentationDefinitions = source.territories.map(expand);
const byId = new Map(presentationDefinitions.map((definition) => [definition.territoryId, definition]));

export function presentationFor(territoryId: string) {
  const definition = byId.get(territoryId);
  if (!definition) throw new Error(`Missing presentation definition: ${territoryId}`);
  return definition;
}

export function validatePresentationManifest(): string[] {
  const errors: string[] = [];
  const continentIds = new Set<string>();
  for (const definition of continentPresentationDefinitions) {
    if (continentIds.has(definition.continentId)) errors.push(`${definition.continentId}: duplicate continent id`);
    continentIds.add(definition.continentId);
    for (const [x, y] of [definition.nameSlot, definition.bonusSlot]) {
      if (x < 0 || x > 749.819 || y < 0 || y > 519.068) errors.push(`${definition.continentId}: continent point outside board viewBox`);
    }
  }
  for (const { id } of manifestSource.continents) if (!continentIds.has(id)) errors.push(`${id}: missing continent presentation definition`);
  const required = [...manifestSource.territories.map((territory) => territory.id), "alien_island"];
  const ids = new Set<string>();
  for (const definition of presentationDefinitions) {
    if (ids.has(definition.territoryId)) errors.push(`${definition.territoryId}: duplicate id`);
    ids.add(definition.territoryId);
    if (definition.pieceSlots.length !== 5) errors.push(`${definition.territoryId}: requires exactly 5 denomination-specific troop slots`);
    if (definition.architectureSlot[0] === definition.scarSlot[0] && definition.architectureSlot[1] === definition.scarSlot[1]) errors.push(`${definition.territoryId}: architecture and scar slots must be distinct`);
    if (definition.hqSlot[0] === definition.scarSlot[0] && definition.hqSlot[1] === definition.scarSlot[1]) errors.push(`${definition.territoryId}: HQ and scar slots must be distinct`);
    if (definition.hqSlot[0] === definition.architectureSlot[0] && definition.hqSlot[1] === definition.architectureSlot[1]) errors.push(`${definition.territoryId}: HQ and architecture slots must be distinct`);
    const points = [definition.cameraFocus, definition.countSlot, definition.overflowSlot, definition.architectureSlot, definition.hqSlot, definition.citySlot, definition.scarSlot, definition.fortificationSlot, ...definition.pieceSlots];
    for (const [x, y] of points) if (x < 0 || x > 749.819 || y < 0 || y > 519.068) errors.push(`${definition.territoryId}: point outside board viewBox`);
  }
  for (const id of required) if (!ids.has(id)) errors.push(`${id}: missing presentation definition`);
  return errors;
}

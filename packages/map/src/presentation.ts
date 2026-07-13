import presentationJson from "../data/presentation.json" with { type: "json" };
import manifestJson from "../data/manifest.json" with { type: "json" };

export type TerritoryPresentationProfile = "tiny" | "normal" | "wide";

interface AuthoredTerritoryPresentationDef {
  territoryId: string;
  cameraFocus: [number, number];
  profile: TerritoryPresentationProfile;
}

export interface TerritoryPresentationDef {
  territoryId: string;
  cameraFocus: [number, number];
  profile: TerritoryPresentationProfile;
  pieceSlots: Array<[number, number, number]>;
  countSlot: [number, number];
  /** Compatibility alias retained for presentation-spec consumers. */
  overflowSlot: [number, number];
  hqSlot: [number, number];
  citySlot: [number, number];
  scarSlot: [number, number];
  fortificationSlot: [number, number];
  labelAvoidance: Array<[number, number, number, number]>;
  preferredRoutePorts: Partial<Record<string, [number, number]>>;
}

const source = presentationJson as { version: string; territories: AuthoredTerritoryPresentationDef[] };
const manifestSource = manifestJson as { territories: { id: string }[] };

function expand(def: AuthoredTerritoryPresentationDef): TerritoryPresentationDef {
  const [x, y] = def.cameraFocus;
  const spread = def.profile === "tiny" ? 7 : def.profile === "wide" ? 11 : 9;
  const scale = def.profile === "tiny" ? 0.78 : def.profile === "wide" ? 1 : 0.9;
  const countSlot: [number, number] = [x, y + 28];
  return {
    territoryId: def.territoryId,
    profile: def.profile,
    cameraFocus: [x, y],
    pieceSlots: [
      [x - spread, y + 6, scale], [x, y + 7, scale], [x + spread, y + 6, scale],
      [x - spread * 0.62, y - 3, scale * 0.94], [x + spread * 0.62, y - 3, scale * 0.94],
      [x - spread * 1.25, y - 5, scale * 0.9], [x + spread * 1.25, y - 5, scale * 0.9],
    ],
    countSlot,
    overflowSlot: countSlot,
    hqSlot: [x + spread + 8, y - 12],
    citySlot: [x - spread - 7, y + 14],
    scarSlot: [x + spread + 7, y + 14],
    fortificationSlot: [x - spread - 7, y - 16],
    labelAvoidance: [[x - spread * 1.5, y - 2, spread * 3, 8]],
    preferredRoutePorts: {},
  };
}

export const presentationVersion = source.version;
export const presentationDefinitions = source.territories.map(expand);
const byId = new Map(presentationDefinitions.map((definition) => [definition.territoryId, definition]));

export function presentationFor(territoryId: string) {
  const definition = byId.get(territoryId);
  if (!definition) throw new Error(`Missing presentation definition: ${territoryId}`);
  return definition;
}

export function validatePresentationManifest(): string[] {
  const errors: string[] = [];
  const required = [...manifestSource.territories.map((territory) => territory.id), "alien_island"];
  const ids = new Set<string>();
  for (const definition of presentationDefinitions) {
    if (ids.has(definition.territoryId)) errors.push(`${definition.territoryId}: duplicate id`);
    ids.add(definition.territoryId);
    if (definition.pieceSlots.length < 5) errors.push(`${definition.territoryId}: requires at least 5 piece slots`);
    const points = [definition.cameraFocus, definition.countSlot, definition.overflowSlot, definition.hqSlot, definition.citySlot, definition.scarSlot, definition.fortificationSlot, ...definition.pieceSlots];
    for (const [x, y] of points) if (x < 0 || x > 749.819 || y < 0 || y > 519.068) errors.push(`${definition.territoryId}: point outside board viewBox`);
  }
  for (const id of required) if (!ids.has(id)) errors.push(`${id}: missing presentation definition`);
  return errors;
}

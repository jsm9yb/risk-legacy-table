import type { TerritoryState } from "@risk/rules";
import type { ArchitectureAtlasKey, ArchitectureCityTier, FortificationDurability } from "../../assets/table/architecture/catalog.ts";

export type ArchitecturePresentation =
  | { kind: "city"; cityType: ArchitectureCityTier; assetKey: ArchitectureAtlasKey; fortificationRemaining?: number }
  | { kind: "ruin"; assetKey: "ruin" }
  | { kind: "fallout"; assetKey: "fallout" };

export interface TerritoryLayerProjection {
  architecture?: ArchitecturePresentation;
  scarId?: string;
}

function normalizedDurability(remaining: number | undefined) {
  if (remaining === undefined || !Number.isFinite(remaining) || remaining <= 0) return undefined;
  return Math.min(10, Math.max(1, Math.trunc(remaining))) as FortificationDurability;
}

/** Purely projects canonical rules state into the three table-placement layers. */
export function projectTerritoryLayers(territory: TerritoryState): TerritoryLayerProjection {
  const fallout = territory.scars.includes("fallout");
  if (fallout) return { architecture: { kind: "fallout", assetKey: "fallout" } };
  if (territory.ruin) {
    return {
      architecture: { kind: "ruin", assetKey: "ruin" },
      scarId: territory.scars.find((scarId) => scarId !== "fallout"),
    };
  }
  if (!territory.city) return { scarId: territory.scars.find((scarId) => scarId !== "fallout") };

  const remaining = normalizedDurability(territory.fortification?.remaining);
  const assetKey: ArchitectureAtlasKey = remaining
    ? `city.${territory.city.type}.fortified.${remaining}`
    : `city.${territory.city.type}.base`;
  return {
    architecture: {
      kind: "city",
      cityType: territory.city.type,
      assetKey,
      fortificationRemaining: remaining,
    },
    scarId: territory.scars.find((scarId) => scarId !== "fallout"),
  };
}

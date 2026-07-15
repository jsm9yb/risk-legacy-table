import type { GameState } from "@risk/rules";

export type TableQuality = "high" | "balanced" | "low";

export function requiredFactionAtlasIds(
  state: Pick<GameState, "players" | "territories">,
  availableFactionIds: ReadonlySet<string>,
) {
  const referencedFactionIds = [
    ...Object.values(state.players).map((player) => player.factionId),
    ...Object.values(state.territories).map((territory) => territory.hqFaction),
  ];
  return [...new Set(referencedFactionIds.filter(
    (factionId): factionId is string => !!factionId && availableFactionIds.has(factionId),
  ))].sort();
}

const TEXT_RESOLUTION_LIMITS: Record<TableQuality, { min: number; max: number }> = {
  low: { min: 2, max: 4 },
  balanced: { min: 3, max: 6 },
  high: { min: 4, max: 8 },
};
const MAX_TABLE_ZOOM = 2.4;

export function tableTextTextureResolution(
  quality: TableQuality,
  rendererResolution: number,
  fitScale: number,
) {
  const limits = TEXT_RESOLUTION_LIMITS[quality];
  const zoomReadyResolution = Math.ceil(rendererResolution * Math.max(1, fitScale) * MAX_TABLE_ZOOM);
  return Math.max(limits.min, Math.min(limits.max, zoomReadyResolution));
}

export function territoryLabelAlpha(_overlapsArmy: boolean) {
  return 1;
}

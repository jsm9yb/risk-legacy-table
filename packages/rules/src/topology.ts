import { manifest } from "@risk/map";
import type { GameState, TerritoryId } from "./types.ts";

export const ALIEN_ISLAND_ID = "alien_island";

/** Runtime topology including sealed components that are not part of the base map manifest. */
export function territoryIds(state: GameState): TerritoryId[] {
  return Object.keys(state.territories);
}

export function neighborsOf(state: GameState, territoryId: TerritoryId): TerritoryId[] {
  const neighbors = [...(manifest.territories.find((territory) => territory.id === territoryId)?.neighbors ?? [])];
  for (const [first, second] of state.customConnections ?? []) {
    if (first === territoryId && !neighbors.includes(second)) neighbors.push(second);
    if (second === territoryId && !neighbors.includes(first)) neighbors.push(first);
  }
  if (state.alienIsland?.territoryId === territoryId) return [...new Set([...neighbors, ...state.alienIsland.connections])];
  if (state.alienIsland?.connections.includes(territoryId)) neighbors.push(state.alienIsland.territoryId);
  return [...new Set(neighbors)];
}

export function isBaseTerritory(territoryId: TerritoryId): boolean {
  return manifest.territories.some((territory) => territory.id === territoryId);
}

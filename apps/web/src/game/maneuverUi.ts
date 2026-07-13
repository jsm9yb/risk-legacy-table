import { maneuverNetwork, territoryIds, type GameState } from "@risk/rules";

export function ignoresManeuverConnectivity(gs: GameState, playerId: string) {
  const factionId = gs.players[playerId]?.factionId;
  return !!factionId && gs.factionPowers[factionId] === "unconnected_maneuver";
}

export function maneuverDestinations(gs: GameState, playerId: string, from: string) {
  if (ignoresManeuverConnectivity(gs, playerId)) {
    return territoryIds(gs)
      .filter((tid) => tid !== from && gs.territories[tid].controller === playerId);
  }
  return maneuverNetwork(gs, playerId, from);
}

export function isManeuverSource(gs: GameState, playerId: string, territoryId: string) {
  const territory = gs.territories[territoryId];
  return territory?.controller === playerId
    && territory.troops >= 2
    && maneuverDestinations(gs, playerId, territoryId).length > 0;
}

import { contentPack } from "@risk/content";
import { territoryById } from "@risk/map";
import type { GameState, Phase, PlayerId } from "./types.ts";
import { ALIEN_ISLAND_ID, neighborsOf } from "./topology.ts";
import { resourceCardDefinition } from "./resourceCards.ts";

type PublicSideboard = GameState["sideboard"] & { coinCount?: number };

export function playerPower(state: GameState, playerId: PlayerId): string | undefined {
  const factionId = state.players[playerId]?.factionId;
  return factionId ? state.factionPowers[factionId] : undefined;
}

const COMEBACK_POWER_NAMES: Record<string, string> = {
  resourceful: "resourceful",
  stealthy: "stealthy",
  wellarmed: "well_armed",
  mobile: "mobile",
  convincing: "convincing",
  wellsupplied: "well_supplied",
};

/** Canonical executable id for a faction's blue Comeback Power. */
export function playerComebackPower(state: GameState, playerId: PlayerId): string | undefined {
  const factionId = state.players[playerId]?.factionId;
  const card = factionId ? state.comebackPowers[factionId] : undefined;
  if (!card) return undefined;
  const title = card.title.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (COMEBACK_POWER_NAMES[title]) return COMEBACK_POWER_NAMES[title];
  const idTail = card.id.split(":").at(-1)?.toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
  return COMEBACK_POWER_NAMES[idTail];
}

export function hasFactionPower(state: GameState, playerId: PlayerId, powerId: string): boolean {
  return playerPower(state, playerId) === powerId || playerComebackPower(state, playerId) === powerId;
}

export function expansionistDrawEarned(state: GameState, playerId: PlayerId): boolean {
  if (!hasFactionPower(state, playerId, "expansionist_supply")) return false;
  const threshold = ((contentPack.powers.find((p) => p.id === "expansionist_supply") as any)?.effect?.expandThreshold ?? 4) as number;
  return state.expandedThisTurn >= threshold;
}

/** Pack 3 Homeland: most starts in a continent; a tie means the faction has no Homeland. */
export function factionHomeland(state: GameState, factionId: string): string | undefined {
  if (!state.unlockedModules.includes("pack_3_homelands_missions")) return undefined;
  if (factionId === "aliens") return undefined;
  const history = (state.factionHistory[factionId] ?? []).filter((entry) => entry.gameNumber <= 15);
  if (history.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const entry of history) {
    if (entry.startingTerritoryId === ALIEN_ISLAND_ID) continue;
    const continent = territoryById(entry.startingTerritoryId).continent;
    counts.set(continent, (counts.get(continent) ?? 0) + 1);
  }
  const max = Math.max(...counts.values());
  const leaders = [...counts].filter(([, count]) => count === max).map(([continent]) => continent);
  return leaders.length === 1 ? leaders[0] : undefined;
}

export function canClaimFaceUpTerritory(state: GameState, playerId: PlayerId, territoryId: string): boolean {
  if (state.territories[territoryId]?.controller === playerId) return true;
  if (territoryId === ALIEN_ISLAND_ID) return false;
  const factionId = state.players[playerId]?.factionId;
  const homeland = factionId ? factionHomeland(state, factionId) : undefined;
  return !!homeland && territoryById(territoryId).continent === homeland;
}

export interface EndTurnDecision {
  eligibleForDraw: boolean;
  earnedBy: "conquest" | "expansionist_supply" | "resourceful" | null;
  matchingSlots: number[];
  coinAvailable: boolean;
  drawAvailable: boolean;
  drawRequired: boolean;
  canEndTurn: boolean;
  canKhanReinforce: boolean;
}

/** Rules-owned description of the complete end-turn Resource-card decision. */
export function endTurnDecision(state: GameState, playerId: PlayerId): EndTurnDecision {
  const player = state.players[playerId];
  const expansionist = !!player && !player.conqueredEnemyThisTurn && expansionistDrawEarned(state, playerId);
  const resourceful = !!player && !player.conqueredEnemyThisTurn && state.expandedIntoCityThisTurn
    && hasFactionPower(state, playerId, "resourceful");
  const earnedBy = player?.conqueredEnemyThisTurn ? "conquest" : expansionist ? "expansionist_supply" : resourceful ? "resourceful" : null;
  const matchingSlots = state.sideboard.slots.flatMap((cardId, slot) => {
    if (state.blockedResourceDraws?.some((choice) => "slot" in choice && choice.slot === slot)) return [];
    const def = cardId ? resourceCardDefinition(cardId) : undefined;
    return def?.kind === "territory" && canClaimFaceUpTerritory(state, playerId, def.territoryId) ? [slot] : [];
  });
  const sideboard = state.sideboard as PublicSideboard;
  const coinBlocked = state.blockedResourceDraws?.some((choice) => "coin" in choice) ?? false;
  const coinAvailable = !coinBlocked && (sideboard.coinCount ?? sideboard.coinPile.length) > 0;
  const eligibleForDraw = earnedBy !== null;
  const drawAvailable = eligibleForDraw && (matchingSlots.length > 0 || coinAvailable);
  const drawRequired = !!player?.conqueredEnemyThisTurn && drawAvailable;

  return {
    eligibleForDraw,
    earnedBy,
    matchingSlots,
    coinAvailable,
    drawAvailable,
    drawRequired,
    canEndTurn: !player?.conqueredEnemyThisTurn || !drawAvailable,
    canKhanReinforce: hasFactionPower(state, playerId, "territory_card_reinforcement"),
  };
}

export interface StartTurnDecision {
  redStarCost: number;
  canBuyRedStar: boolean;
  autoAdvance: boolean;
}

/** Start of turn always remains explicit so optional legacy reactions cannot be raced by a timer. */
export function startTurnDecision(state: GameState, playerId: PlayerId): StartTurnDecision {
  const redStarCost = Number((contentPack.ruleConstants.redStarPurchaseCost as { value: number }).value);
  const canBuyRedStar = (state.players[playerId]?.hand.length ?? 0) >= redStarCost;
  return { redStarCost, canBuyRedStar, autoAdvance: false };
}

const EARLY_MANEUVER_PHASES: Phase[] = ["start_turn", "join_or_recruit", "expand_attack", "end_turn"];

export interface ManeuverDecision {
  available: boolean;
  early: boolean;
  used: boolean;
  hasLegalMove: boolean;
}

function hasLegalManeuver(state: GameState, playerId: PlayerId): boolean {
  const owned = Object.entries(state.territories)
    .filter(([, territory]) => territory.controller === playerId)
    .map(([id]) => id);
  const sources = owned.filter((id) => state.territories[id].troops >= 2);
  if (sources.length === 0 || owned.length < 2) return false;
  if (hasFactionPower(state, playerId, "unconnected_maneuver")) return true;
  const ownedSet = new Set(owned);
  return sources.some((source) => {
    const seen = new Set([source]);
    const queue = [source];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const neighbor of neighborsOf(state, current)) {
        if (!ownedSet.has(neighbor) || seen.has(neighbor)) continue;
        if (neighbor !== source) return true;
        seen.add(neighbor);
        queue.push(neighbor);
      }
    }
    return false;
  });
}

/** Rules-owned availability for the normal and Saharan early maneuver windows. */
export function maneuverDecision(state: GameState, playerId: PlayerId): ManeuverDecision {
  const active = state.turnOrder[state.activeIdx] === playerId;
  const normal = state.phase === "maneuver";
  const early = EARLY_MANEUVER_PHASES.includes(state.phase)
    && hasFactionPower(state, playerId, "early_maneuver");
  return {
    available: active && !state.maneuverUsed && !state.combat && (normal || early),
    early: !normal && early,
    used: state.maneuverUsed,
    hasLegalMove: hasLegalManeuver(state, playerId),
  };
}

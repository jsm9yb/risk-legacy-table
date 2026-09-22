// hidden-information filtering, moved from apps/server so the web
// client tests and the server share one policy. Pure: clones, never mutates input.
import type { GameState, PlayerId } from "./types.ts";
import { redStars, waitingOn } from "./engine.ts";

/** Extra presentation fields the filter adds for clients. */
export interface FilteredExtras {
  quickLook: {
    id: PlayerId; name: string; factionId?: string;
    redStars: { tokens: number; board: number; total: number };
    missiles: number; resourceCards: number; hasScarCard: boolean;
    knockedOut: boolean; eliminated: boolean;
    territories: number; troops: number;
  }[];
  waitingOn?: PlayerId;
}
export type FilteredGameState = GameState & FilteredExtras;

/**
 * Per-viewer view: other players' resource hands and held-scar identities are stripped
 * (counts stay public), deck orders become counts. Spectators pass viewerId = null.
 */
export function filterStateFor(state: GameState, viewerId: PlayerId | null): FilteredGameState {
  const s = structuredClone(state) as FilteredGameState;
  // The server is the only RNG authority. Exposing either value lets a client
  // predict every future die roll and reconstruct deterministic deck shuffles.
  s.seed = 0;
  s.rngState = 0;
  s.log = s.log.map((event) => event.type === "GameStarted" && event.data?.seed !== undefined
    ? { ...event, data: { ...event.data, seed: 0 } }
    : event);
  s.legacyCards ??= {
    eventDeck: [], eventDiscard: [], eventBox: [], ongoingEvents: [],
    missionDeck: [], missionBox: [], privateMissionPool: [],
  };
  s.legacyCards.privateMissionPool ??= [];
  s.factionMissilePowers ??= {};
  s.factionWeaknesses ??= {};
  s.mutantEvolutionChoices ??= [];
  s.missilePowersUsedThisTurn ??= [];
  s.empTerritories ??= [];
  s.badIntelDeniedContinents ??= [];
  s.blockedResourceDraws ??= [];
  s.customConnections ??= [];
  s.privateMissionProgress ??= {
    tradedResources: 0, highValueTerritoryCards: 0, forcedOccupation: false, wideBorderAtStart: false,
  };
  for (const p of Object.values(s.players)) {
    (p as any).handCount = p.hand.length; // public resource card count
    if (p.id !== viewerId) {
      p.hand = [];
      p.scarHand = []; // held-scar identities hidden; scarCardCount stays public
    }
  }
  // Hidden deck order: counts only
  (s.sideboard as any).territoryDeckCount = s.sideboard.territoryDeck.length;
  s.sideboard.territoryDeck = [];
  (s.sideboard as any).coinCount = s.sideboard.coinPile.length;
  if (state.advancedDraft?.pendingCoinClaim?.playerId !== viewerId) s.sideboard.coinPile = [];
  // Event/Mission deck order is hidden; only the face-up/pending cards and counts
  // are public. Discard/box contents are already known from prior reveals.
  (s.legacyCards as any).eventDeckCount = s.legacyCards.eventDeck.length;
  (s.legacyCards as any).missionDeckCount = s.legacyCards.missionDeck.length;
  (s.legacyCards as any).privateMissionPoolCount = s.legacyCards.privateMissionPool.length;
  s.legacyCards.eventDeck = [];
  if (state.missionChoice?.playerId !== viewerId) s.legacyCards.missionDeck = [];
  s.legacyCards.privateMissionPool = [];
  const viewerFaction = viewerId ? state.players[viewerId]?.factionId : undefined;
  for (const [factionId, mission] of Object.entries(s.capturedPrivateMissions ?? {})) {
    if (factionId === viewerFaction) continue;
    s.capturedPrivateMissions[factionId] = {
      id: `hidden:${factionId}`,
      sourceModuleId: mission.sourceModuleId,
      title: "Private Mission",
      text: "",
    };
  }
  // Host-entered sealed text may contain private missions or other hidden cards.
  // Clients only need the public requirement names; authoritative content stays server-side.
  s.hostContent = {};
  // Quick-look pane payload (Q48): tokens, board stars, totals
  s.quickLook = Object.values(state.players).map((p) => ({
    id: p.id, name: p.name, factionId: p.factionId,
    redStars: redStars(state, p.id),
    missiles: p.missiles, resourceCards: p.hand.length,
    hasScarCard: p.scarCardCount > 0,
    knockedOut: p.knockedOut, eliminated: p.eliminated,
    territories: Object.values(state.territories).filter((t) => t.controller === p.id).length,
    troops: Object.values(state.territories).filter((t) => t.controller === p.id).reduce((a, t) => a + t.troops, 0),
  }));
  s.waitingOn = waitingOn(state);
  return s;
}

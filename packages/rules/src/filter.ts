// new (1-web-b): hidden-information filtering, moved from apps/server so the web
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
  s.sideboard.coinPile = [];
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

import { describe, expect, it } from "vitest";
import { applyAction, createGame, filterStateFor, startTurnDecision } from "./index.ts";

const players = [
  { id: "p1", name: "Ada" },
  { id: "p2", name: "Lin" },
  { id: "p3", name: "Rex" },
];

describe("production guardrails", () => {
  it("never exposes deterministic RNG state to a network viewer", () => {
    const authoritative = createGame({ gameId: "guard-1", seed: 987654321, players });
    const filtered = filterStateFor(authoritative, "p1");
    expect(filtered.seed).toBe(0);
    expect(filtered.rngState).toBe(0);
    expect(filtered.log.find((event) => event.type === "GameStarted")?.data?.seed).toBe(0);
    expect(JSON.stringify(filtered)).not.toContain("987654321");
  });

  it("rejects duplicate Resource-card ids in purchases and trades", () => {
    const state = createGame({ gameId: "guard-2", seed: 7, players });
    const playerId = state.turnOrder[state.activeIdx];
    const cardId = state.sideboard.territoryDeck[0];
    state.phase = "start_turn";
    state.players[playerId].hand = [cardId];
    expect(() => applyAction(state, {
      type: "start.buyRedStar", playerId, cardIds: [cardId, cardId, cardId, cardId],
    })).toThrow(/only once/);

    state.phase = "join_or_recruit";
    state.recruit = { remaining: 0, breakdown: { tradeIns: 0 } } as any;
    expect(() => applyAction(state, {
      type: "recruit.trade", playerId, cardIds: [cardId, cardId],
    })).toThrow(/only once/);
  });

  it("keeps start of turn explicit even without a Red Star purchase", () => {
    const state = createGame({ gameId: "guard-3", seed: 9, players });
    const playerId = state.turnOrder[state.activeIdx];
    state.phase = "start_turn";
    state.players[playerId].hand = [];
    expect(startTurnDecision(state, playerId)).toMatchObject({ canBuyRedStar: false, autoAdvance: false });
  });
});

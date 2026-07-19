import { describe, expect, it } from "vitest";
import { contentPack } from "@risk/content";
import {
  applyCampaignPreparationAction,
  applyAction,
  beginCampaignPreparation,
  createGame,
  filterStateFor,
  createUnpreparedCampaign,
  isCampaignPrepared,
  waitingOn,
  type CampaignState,
} from "./index.ts";

const participants = [
  { playerId: "p1", name: "One", seat: 0 },
  { playerId: "p2", name: "Two", seat: 1 },
  { playerId: "p3", name: "Three", seat: 2 },
];

function place(campaign: CampaignState, index: number, cardId: string, slot: 1 | 2 = 1) {
  const preparation = campaign.preparation!;
  return applyCampaignPreparationAction(campaign, {
    type: "preparation.placeResourceSticker",
    playerId: preparation.participants[preparation.actorIndex].playerId,
    stickerId: `world-coin-${String(index + 1).padStart(2, "0")}`,
    cardId,
    slot,
  });
}

function sealedInteractiveCampaign() {
  let campaign = createUnpreparedCampaign("Terra", participants);
  for (let index = 0; index < 12; index++) campaign = place(campaign, index, contentPack.cards.territoryCards[index].id);
  const reviewer = campaign.preparation!.participants[campaign.preparation!.actorIndex].playerId;
  campaign = applyCampaignPreparationAction(campaign, { type: "preparation.confirmReview", playerId: reviewer });
  return applyCampaignPreparationAction(campaign, { type: "preparation.seal", playerId: reviewer });
}

describe("Prepare the World", () => {
  it("snapshots clockwise participants when LAN preparation begins", () => {
    const campaign = beginCampaignPreparation(createUnpreparedCampaign("Terra"), [...participants].reverse());
    expect(campaign.preparation?.participants.map((participant) => participant.playerId)).toEqual(["p1", "p2", "p3"]);
    expect(campaign.preparation?.stage).toBe("resource_stickers");
  });

  it("commits twelve alternating stickers, including two on one card", () => {
    let campaign = createUnpreparedCampaign("Terra", participants);
    expect(campaign.preparation?.stage).toBe("resource_stickers");

    const cards = contentPack.cards.territoryCards;
    campaign = place(campaign, 0, cards[0].id, 1);
    expect(campaign.preparation?.actorIndex).toBe(1);
    campaign = place(campaign, 1, cards[0].id, 2);
    for (let index = 2; index < 12; index++) campaign = place(campaign, index, cards[index - 1].id);
    expect(campaign.preparation?.stage).toBe("review");
    expect(campaign.preparation?.resourceStickers[1]).toMatchObject({ cardId: cards[0].id, slot: 2, placedBy: "p2", sequence: 2 });

    const reviewer = campaign.preparation!.participants[campaign.preparation!.actorIndex].playerId;
    campaign = applyCampaignPreparationAction(campaign, { type: "preparation.confirmReview", playerId: reviewer });
    campaign = applyCampaignPreparationAction(campaign, { type: "preparation.seal", playerId: reviewer }, "2026-07-16T00:00:00.000Z");
    expect(isCampaignPrepared(campaign)).toBe(true);
    expect(campaign.preparation?.sealedAt).toBe("2026-07-16T00:00:00.000Z");
    expect(campaign.board.cardModifications.find((modification) => modification.cardId === cards[0].id)?.resources).toBe(3);
    expect(() => applyCampaignPreparationAction(campaign, { type: "preparation.seal", playerId: reviewer })).toThrow(/already complete/);
  });

  it("lets an admin override atomically place every remaining Coin using validated placements", () => {
    let campaign = createUnpreparedCampaign("Terra", participants);
    campaign = place(campaign, 0, contentPack.cards.territoryCards[0].id);
    const remaining = campaign.preparation!.resourceStickers.filter((sticker) => !sticker.cardId);
    const cards = contentPack.cards.territoryCards.slice(1, 12);
    campaign = applyCampaignPreparationAction(campaign, {
      type: "preparation.randomizeResourceStickers",
      playerId: "p1",
      placements: remaining.map((sticker, index) => ({ stickerId: sticker.stickerId, cardId: cards[index].id, slot: 1 })),
    });

    expect(campaign.preparation?.stage).toBe("review");
    expect(campaign.preparation?.resourceStickers.every((sticker) => sticker.cardId)).toBe(true);
    expect(campaign.preparation?.resourceStickers.slice(1).every((sticker) => sticker.placedBy === "p1")).toBe(true);
  });

  it("rejects incomplete or illegal admin override distributions", () => {
    const campaign = createUnpreparedCampaign("Terra", participants);
    const stickers = campaign.preparation!.resourceStickers;
    const cardId = contentPack.cards.territoryCards[0].id;
    expect(() => applyCampaignPreparationAction(campaign, {
      type: "preparation.randomizeResourceStickers", playerId: "p1", placements: [],
    })).toThrow(/every remaining/i);
    expect(() => applyCampaignPreparationAction(campaign, {
      type: "preparation.randomizeResourceStickers",
      playerId: "p1",
      placements: stickers.map((sticker) => ({ stickerId: sticker.stickerId, cardId, slot: 1 })),
    })).toThrow(/already filled/i);
  });

  it("rejects wrong actors, duplicate stickers and slots, slot two first, and invalid targets", () => {
    let campaign = createUnpreparedCampaign("Terra", participants);
    const card = contentPack.cards.territoryCards[0].id;
    const current = campaign.preparation!.participants[0].playerId;
    expect(() => applyCampaignPreparationAction(campaign, {
      type: "preparation.placeResourceSticker", playerId: "p2", stickerId: "world-coin-01", cardId: card, slot: 1,
    })).toThrow(/not this player's/);
    expect(() => applyCampaignPreparationAction(campaign, {
      type: "preparation.placeResourceSticker", playerId: current, stickerId: "world-coin-01", cardId: card, slot: 2,
    })).toThrow(/slot 1/);
    expect(() => applyCampaignPreparationAction(campaign, {
      type: "preparation.placeResourceSticker", playerId: current, stickerId: "world-coin-01", cardId: "coin_1", slot: 1,
    })).toThrow(/base Territory/);
    campaign = place(campaign, 0, card);
    expect(() => applyCampaignPreparationAction(campaign, {
      type: "preparation.placeResourceSticker", playerId: "p2", stickerId: "world-coin-01", cardId: card, slot: 2,
    })).toThrow(/already placed/);
    expect(() => applyCampaignPreparationAction(campaign, {
      type: "preparation.placeResourceSticker", playerId: "p2", stickerId: "world-coin-02", cardId: card, slot: 1,
    })).toThrow(/already filled/);
  });

  it("rejects incomplete sealing and game creation", () => {
    const campaign = createUnpreparedCampaign("Terra", participants);
    expect(() => applyCampaignPreparationAction(campaign, { type: "preparation.seal", playerId: "p1" })).toThrow(/review/i);
    expect(() => createGame({ gameId: "g1", seed: 1, players: participants.map(({ playerId: id, name }) => ({ id, name })), campaign })).toThrow(/must be sealed/);
  });

  it("defers permanent faction powers to the first player who selects that faction", () => {
    const faction = contentPack.factions[0];
    const campaign = createUnpreparedCampaign("Terra", participants);
    expect(() => applyCampaignPreparationAction(campaign, {
      type: "preparation.chooseFactionPower", playerId: "p2", factionId: faction.id, powerId: faction.startingPowers[0],
    })).toThrow(/first player.*select.*faction/i);
  });

  it("reveals setup order and interrupts a new advanced draft for explicit private Coin claims", () => {
    const campaign = sealedInteractiveCampaign();
    campaign.unlockedModules.push("pack_1_advanced_draft_biohazards");
    let state = createGame({ gameId: "advanced", seed: 7, players: participants.map(({ playerId: id, name }) => ({ id, name })), campaign });
    const first = state.setup!.chooserOrder[0];
    expect(state.setup?.stage).toBe("order_reveal");
    expect(waitingOn(state)).toBe(first);
    expect(() => applyAction(state, { type: "draft.pick", playerId: first, category: "startingCoinCards", value: 2 })).toThrow(/Acknowledge/);
    state = applyAction(state, { type: "setup.acknowledgeOrder", playerId: first });
    state = applyAction(state, { type: "draft.pick", playerId: first, category: "startingCoinCards", value: 2 });
    expect(state.advancedDraft?.pendingCoinClaim).toEqual({ playerId: first, total: 2, remaining: 2 });
    expect(state.advancedDraft?.nextPickIdx).toBe(0);
    expect(() => applyAction(state, { type: "draft.takeStartingCoin", playerId: participants.find((p) => p.playerId !== first)!.playerId, cardId: state.sideboard.coinPile[0] })).toThrow(/Only the drafting player/);

    const firstCoin = state.sideboard.coinPile[0];
    state = applyAction(state, { type: "draft.takeStartingCoin", playerId: first, cardId: firstCoin });
    expect(filterStateFor(state, first).sideboard.coinPile.length).toBeGreaterThan(0);
    const other = participants.find((participant) => participant.playerId !== first)!.playerId;
    expect(filterStateFor(state, other).sideboard.coinPile).toEqual([]);
    expect(filterStateFor(state, other).players[first].hand).toEqual([]);
    state = applyAction(state, { type: "draft.takeStartingCoin", playerId: first, cardId: state.sideboard.coinPile[0] });
    expect(state.advancedDraft?.pendingCoinClaim).toBeUndefined();
    expect(state.advancedDraft?.nextPickIdx).toBe(1);

    while (!state.advancedDraft!.completed) {
      const draft = state.advancedDraft!;
      const playerId = waitingOn(state)!;
      if (draft.pendingCoinClaim) {
        state = applyAction(state, { type: "draft.takeStartingCoin", playerId, cardId: state.sideboard.coinPile[0] });
        continue;
      }
      const picks = draft.picks[playerId];
      if (!picks.factionId) state = applyAction(state, { type: "draft.pick", playerId, category: "faction", value: draft.available.factions[0] });
      else if (picks.turnOrder === undefined) state = applyAction(state, { type: "draft.pick", playerId, category: "turnOrder", value: draft.available.turnOrder[0] });
      else if (picks.placementOrder === undefined) state = applyAction(state, { type: "draft.pick", playerId, category: "placementOrder", value: draft.available.placementOrder[0] });
      else if (picks.startingTroops === undefined) state = applyAction(state, { type: "draft.pick", playerId, category: "startingTroops", value: draft.available.startingTroops[0] });
      else state = applyAction(state, { type: "draft.pick", playerId, category: "startingCoinCards", value: draft.available.startingCoinCards[0] });
    }
    expect(state.setup?.stage).toBe("starting_placement");
    for (const player of Object.values(state.players)) expect(player.hand).toHaveLength(state.advancedDraft!.picks[player.id].startingCoinCards!);
  });
});

// new: task 10b — cross-game campaign persistence (SPEC §7, §10)
import { describe, it, expect } from "vitest";
import { createGame, applyAction, isLegalStart, waitingOn } from "./engine.ts";
import { initialCampaign, applyGameToCampaign, type CampaignState } from "./campaign.ts";
import type { GameState } from "./types.ts";
import { contentPack, cityPopulation } from "@risk/content";

const P = [
  { id: "u1", name: "Ada" },
  { id: "u2", name: "Lin" },
  { id: "u3", name: "Rex" },
];

/** Seat all three players on fixed legal starts (avoids ural/peru/ukraine, used as legacy targets). */
// Power picks are inert for these flows (no automatic dice/recruit effects). // new (9)
const SEAT_POWERS: Record<string, string> = { // new
  khan_industries: "territory_card_reinforcement",
  die_mechaniker: "defensive_stand",
  saharan_republic: "unconnected_maneuver",
};
function seatAll(s: GameState): GameState {
  const factions = ["khan_industries", "die_mechaniker", "saharan_republic"];
  const starts = ["alaska", "brazil", "western_australia"];
  for (const pid of [...s.setup!.chooserOrder]) {
    const idx = P.findIndex((p) => p.id === pid);
    s = applyAction(s, { type: "setup.choose", playerId: pid, factionId: factions[idx], territoryId: starts[idx], powerId: s.factionPowers[factions[idx]] ? undefined : SEAT_POWERS[factions[idx]] }); // new: pick on first play only
  }
  return s;
}

/** Win via red-star purchase for the active player (turnOrder[0]). */
function winNow(s: GameState): GameState {
  const winner = s.turnOrder[0];
  s.players[winner].redStarTokens = 2; // +1 purchased +1 own controlled HQ = 4
  s.players[winner].hand = ["42", "43", "44", "45"];
  return applyAction(s, { type: "start.buyRedStar", playerId: winner, cardIds: ["42", "43", "44", "45"] });
}

describe("campaign state (10b)", () => {
  it("initialCampaign starts at game 0 with full reward + starter-scar inventories", () => {
    const c = initialCampaign("Terra Nova");
    expect(c.worldName).toBe("Terra Nova");
    expect(c.gameNumber).toBe(0);
    expect(c.inventories).toEqual({
      cancelStickers: 4, fortifyMarks: 5, majorCities: 5, minorCities: 9,
      scarInstances: { bunker: 3, ammo_shortage: 3 },
    });
    expect(c.board.scars).toEqual([]);
    expect(c.signatures).toEqual({});
    expect(c.factionPowerChoices).toEqual({});
    expect(c.board.cardModifications).toHaveLength(12);
    expect(c.board.cardModifications.every((mod) => mod.resources === 2)).toBe(true);
  });

  it("keeps permanent legacy state isolated between campaigns", () => {
    const first = initialCampaign("First World");
    first.factionPowerChoices.khan_industries = "territory_card_reinforcement";
    first.board.scars.push({ territoryId: "ural", scarId: "bunker" });
    first.board.cities.push({ territoryId: "peru", type: "major", name: "Old City", foundedByPlayerId: "u1" });
    first.inventories.scarInstances.bunker = 0;
    first.unlockedModules.push("pack_1_advanced_draft_biohazards");

    const second = initialCampaign("Second World");
    expect(second.factionPowerChoices).toEqual({});
    expect(second.board.scars).toEqual([]);
    expect(second.board.cities).toEqual([]);
    expect(second.inventories.scarInstances.bunker).toBe(3);
    expect(second.unlockedModules).toEqual([]);
  });

  it("validates custom before-Game-1 powers and exactly 12 resource stickers capped at 3", () => {
    const powers = Object.fromEntries(contentPack.factions.map((faction) => [faction.id, faction.startingPowers[0]]));
    const c = initialCampaign("Custom", {
      factionPowerChoices: powers,
      resourceStickerCardIds: ["0", "0", "1", "1", "2", "2", "3", "3", "4", "4", "5", "5"],
    });
    expect(c.factionPowerChoices).toEqual(powers);
    expect(c.board.cardModifications).toHaveLength(6);
    expect(c.board.cardModifications.every((mod) => mod.resources === 3)).toBe(true);
    expect(() => initialCampaign("Bad", { resourceStickerCardIds: Array(12).fill("0") })).toThrow(/above 3/);
    expect(() => initialCampaign("Bad", { resourceStickerCardIds: ["0"] })).toThrow(/exactly 12/);
    expect(() => initialCampaign("Bad", { factionPowerChoices: {} })).toThrow(/starting power/);
  });

  it("applyGameToCampaign folds a finished game's legacy outputs into the campaign", () => {
    const initial = initialCampaign("Terra");
    let s = seatAll(createGame({ gameId: "g1", seed: 42, players: P, campaign: initial }));
    const winner = s.turnOrder[0];
    // Play a known Bunker onto ural through the real action (consumes the physical instance)
    s.players[winner].scarHand = [{ instanceId: "bunker#1", scarId: "bunker" }];
    s.players[winner].scarCardCount = 1;
    s = applyAction(s, { type: "scar.play", playerId: winner, scarInstanceId: "bunker#1", territoryId: "ural" });
    s = winNow(s);
    const heldOn = s.rewards!.order.slice(1);
    s = applyAction(s, { type: "reward.choose", playerId: winner, reward: { kind: "name_continent", continentId: "asia", name: "Khanate" } });
    const minorTid = Object.entries(s.territories).find(([, t]) => t.controller === heldOn[0] && !t.city)![0];
    s = applyAction(s, { type: "reward.choose", playerId: heldOn[0], reward: { kind: "found_minor_city", territoryId: minorTid, name: "Linden" } });
    const cardTid = Object.entries(s.territories).find(([, t]) => t.controller === heldOn[1])![0];
    const cardDef = contentPack.cards.territoryCards.find((c) => c.territoryId === cardTid)!;
    s = applyAction(s, { type: "reward.choose", playerId: heldOn[1], reward: { kind: "upgrade_territory_card", cardId: cardDef.id } });
    expect(s.rewards!.committed).toBe(true);

    const camp = applyGameToCampaign(initial, s);
    expect(camp.gameNumber).toBe(1);
    expect(camp.signatures[winner]).toBe(1);
    expect(camp.board.scars).toEqual([{ territoryId: "ural", scarId: "bunker" }]);
    expect(camp.board.cities).toEqual([{ territoryId: minorTid, type: "minor", name: "Linden", foundedByPlayerId: heldOn[0] }]);
    expect(camp.board.continentNames["asia"]).toEqual({ name: "Khanate", namedBy: winner });
    const startingResources = initial.board.cardModifications.find((mod) => mod.cardId === cardDef.id)?.resources ?? cardDef.resources;
    expect(camp.board.cardModifications.find((mod) => mod.cardId === cardDef.id)?.resources).toBe(startingResources + 1);
    for (const mod of initial.board.cardModifications.filter((mod) => mod.cardId !== cardDef.id)) {
      expect(camp.board.cardModifications).toContainEqual(mod); // all twelve before-Game-1 stickers persist
    }
    expect(camp.inventories.minorCities).toBe(8);
    expect(camp.inventories.scarInstances).toEqual({ bunker: 2, ammo_shortage: 3 }); // played bunker consumed; unplayed dealt scars return
    expect(camp.foundedMinorCities).toBe(1);
    const winnerFaction = s.players[winner].factionId!;
    expect(camp.factionResults[winnerFaction]).toEqual(["won"]);
    expect(camp.factionHistory[winnerFaction]).toEqual([{
      gameNumber: 1,
      playerId: winner,
      playerName: s.players[winner].name,
      startingTerritoryId: s.players[winner].startingTerritoryId,
      result: "won",
    }]);
    expect(camp.factionResults["imperial_balkania"]).toEqual(["unused"]); // 3p game: 2 factions unused
  });

  it("createGame(campaign) seeds board legacy, inventories, card mods, and signature-driven setup", () => {
    const camp: CampaignState = initialCampaign("Terra");
    camp.gameNumber = 1;
    camp.signatures = { u1: 2, u2: 0, u3: 0 };
    camp.board.scars = [{ territoryId: "ural", scarId: "ammo_shortage" }, { territoryId: "peru", scarId: "bunker" }];
    camp.board.cities = [{ territoryId: "peru", type: "major", name: "Novagrad", foundedByPlayerId: "u2" }];
    camp.board.fortifications = [{ territoryId: "peru", durability: 7 }];
    camp.board.continentNames = { asia: { name: "Khanate", namedBy: "u1" } };
    camp.board.continentBonusMarks = { australia: -1 };
    camp.board.cardModifications = [{ cardId: "0", resources: 3 }, { cardId: "5", destroyed: true }];
    camp.inventories.minorCities = 8;
    camp.inventories.scarInstances = { bunker: 1, ammo_shortage: 0 };
    camp.factionHistory = {
      khan_industries: [{ gameNumber: 1, playerId: "u1", playerName: "Ada", startingTerritoryId: "alaska", result: "won" }],
    };

    const s = createGame({ gameId: "g2", seed: 7, players: P, campaign: camp });
    expect(s.gameNumber).toBe(2);
    // signature-driven: 2 signatures -> 2 missiles, no token; 0 signatures -> 1 token, no missiles
    expect(s.players["u1"].missiles).toBe(2);
    expect(s.players["u1"].redStarTokens).toBe(0);
    expect(s.players["u2"].missiles).toBe(0);
    expect(s.players["u2"].redStarTokens).toBe(1);
    expect(s.signatures).toEqual({ u1: 2, u2: 0, u3: 0 });
    expect(s.factionHistory.khan_industries).toEqual(camp.factionHistory.khan_industries);
    // board legacy
    expect(s.territories["ural"].scars).toEqual(["ammo_shortage"]);
    expect(s.territories["peru"].city).toEqual({ type: "major", population: cityPopulation("major"), name: "Novagrad", foundedByPlayerId: "u2" });
    expect(s.territories["peru"].fortification).toEqual({ max: 10, remaining: 7 });
    expect(s.continents["asia"]).toEqual({ name: "Khanate", namedBy: "u1" });
    expect(s.continents["australia"]).toEqual({ bonusMark: -1 });
    // cards: upgrades overlay, destroyed cards never enter the deck
    expect(s.cardModifications["0"]).toEqual({ resources: 3 });
    expect(s.sideboard.destroyed).toEqual(["5"]);
    const inPlay = [...s.sideboard.territoryDeck, ...s.sideboard.slots.filter((x): x is string => x !== null)];
    expect(inPlay).not.toContain("5");
    expect(inPlay).toHaveLength(41);
    // inventories carried
    expect(s.inventories.minorCities).toBe(8);
    // scar deal: only 1 instance left for 3 players -> nobody is dealt one
    expect(Object.values(s.players).every((p) => p.scarCardCount === 0)).toBe(true);
    expect(s.log.some((e) => e.type === "ScarCardsNotDealt")).toBe(true);
  });

  it("carried scars block legal starts; the founder's Major City stays legal even if scarred", () => {
    const camp = initialCampaign("Terra");
    camp.gameNumber = 1;
    camp.board.scars = [{ territoryId: "ural", scarId: "ammo_shortage" }, { territoryId: "peru", scarId: "bunker" }];
    camp.board.cities = [{ territoryId: "peru", type: "major", name: "Novagrad", foundedByPlayerId: "u2" }];
    const s = createGame({ gameId: "g2", seed: 9, players: P, campaign: camp });
    expect(isLegalStart(s, "ural")).toBe(false); // scarred = marked
    expect(isLegalStart(s, "peru", false, undefined, "u2")).toBe(true); // own founded Major City, even if scarred
    expect(isLegalStart(s, "peru", false, undefined, "u3")).toBe(false); // not the founder
    expect(isLegalStart(s, "ukraine")).toBe(true); // untouched territory unaffected
  });

  it("a full-inventory campaign still deals one hidden starter scar per player", () => {
    const camp = initialCampaign("Terra");
    camp.gameNumber = 3;
    const s = createGame({ gameId: "g4", seed: 11, players: P, campaign: camp });
    expect(Object.values(s.players).every((p) => p.scarCardCount === 1)).toBe(true);
  });

  it("stops the reward flow after Game 15: no signing, no rewards", () => {
    const camp = initialCampaign("Terra");
    camp.gameNumber = 15; // the next game is 16
    let s = seatAll(createGame({ gameId: "g16", seed: 13, players: P, campaign: camp }));
    expect(s.gameNumber).toBe(16);
    s = winNow(s);
    expect(s.phase).toBe("game_over");
    expect(s.rewards).toBeUndefined();
    expect(s.signatures[s.winner!]).toBe(0); // starter reward changes (incl. signing) stop
    expect(s.log.some((e) => e.type === "BoardSigned")).toBe(false);
    // the finished game still folds into the campaign (results history continues)
    const after = applyGameToCampaign(camp, s);
    expect(after.gameNumber).toBe(16);
    const winnerFaction = s.players[s.winner!].factionId!;
    expect(after.factionResults[winnerFaction]).toEqual(["won"]);
  });

  it("completes Game 15 with the official most-wins tie roll and persists the final world name", () => {
    const camp = initialCampaign("Terra");
    camp.gameNumber = 14;
    let s = seatAll(createGame({ gameId: "g15", seed: 15, players: P, campaign: camp }));
    const winner = s.turnOrder[0];
    const tiedPlayer = s.turnOrder[1];
    s.signatures = { [winner]: 3, [tiedPlayer]: 4, [s.turnOrder[2]]: 2 }; // winner's new signature creates a 4-4 tie
    s.continents.africa = { name: "Tied Player's Reach", namedBy: tiedPlayer };
    s = winNow(s);
    for (const playerId of s.rewards!.order) {
      s = applyAction(s, {
        type: "reward.choose",
        playerId,
        reward: playerId === winner
          ? { kind: "name_continent", continentId: "asia", name: "Winner's Reach" }
          : { kind: "pass" },
      });
    }

    expect(s.rewards?.committed).toBe(true);
    expect(s.worldCompletion?.name).toBeUndefined();
    expect(s.log.some((event) => event.type === "WorldNamingRoll")).toBe(true);
    const namer = s.worldCompletion!.namingPlayerId;
    expect(waitingOn(s)).toBe(namer);
    const wrong = s.turnOrder.find((playerId) => playerId !== namer)!;
    expect(() => applyAction(s, { type: "world.name", playerId: wrong, name: "Stolen" })).toThrow(/selected player/);
    s = applyAction(s, { type: "world.name", playerId: namer, name: "Aeternum" });
    expect(waitingOn(s)).toBeUndefined();

    const completed = applyGameToCampaign(camp, s);
    expect(completed.worldName).toBe("Aeternum");
    expect(completed.completedWorld).toEqual({ namedByPlayerId: namer, completedAtGame: 15 });
    expect(createGame({ gameId: "g16", seed: 16, players: P, campaign: completed }).worldName).toBe("Aeternum");
  });

  it("round-trips: game 1 fold seeds game 2 (winner's signature becomes a missile)", () => {
    let g1 = seatAll(createGame({ gameId: "g1", seed: 21, players: P }));
    g1 = winNow(g1);
    const winner = g1.winner!;
    for (const pid of g1.rewards!.order) {
      g1 = applyAction(g1, {
        type: "reward.choose", playerId: pid,
        reward: pid === winner ? { kind: "name_continent", continentId: "africa", name: "Zaharan" } : { kind: "pass" },
      });
    }
    const camp = applyGameToCampaign(initialCampaign("Terra"), g1);
    const g2 = createGame({ gameId: "g2", seed: 22, players: P, campaign: camp });
    expect(g2.gameNumber).toBe(2);
    expect(g2.players[winner].missiles).toBe(1); // 1 signature -> 1 missile, no starting token
    expect(g2.players[winner].redStarTokens).toBe(0);
    expect(g2.continents["africa"]).toEqual({ name: "Zaharan", namedBy: winner });
    const others = P.map((p) => p.id).filter((id) => id !== winner);
    for (const pid of others) {
      expect(g2.players[pid].redStarTokens).toBe(1);
      expect(g2.players[pid].missiles).toBe(0);
    }
  });
});

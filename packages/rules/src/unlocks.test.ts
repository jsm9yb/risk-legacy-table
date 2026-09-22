// sealed-module unlock engine (SPEC §9)
import { describe, it, expect } from "vitest";
import { createGame, applyAction, joinWarTroops, waitingOn } from "./engine.ts";
import { endTurnDecision, factionHomeland } from "./decisions.ts";
import { filterStateFor } from "./filter.ts";
import { neighborsOf } from "./topology.ts";
import { initialCampaign, applyGameToCampaign, supplyModuleContent } from "./campaign.ts";
import type { GameState } from "./types.ts";
import { factionDefinitionById } from "@risk/content";

const P = [
  { id: "u1", name: "Ada" },
  { id: "u2", name: "Lin" },
  { id: "u3", name: "Rex" },
];
const SEAT_POWERS: Record<string, string> = {
  khan_industries: "territory_card_reinforcement",
  die_mechaniker: "defensive_stand",
  saharan_republic: "unconnected_maneuver",
};

function seatAll(s: GameState): GameState {
  const factions = ["khan_industries", "die_mechaniker", "saharan_republic"];
  const starts = ["alaska", "brazil", "western_australia"];
  for (const pid of [...s.setup!.chooserOrder]) {
    const idx = P.findIndex((p) => p.id === pid);
    s = applyAction(s, { type: "setup.choose", playerId: pid, factionId: factions[idx], territoryId: starts[idx], powerId: s.factionPowers[factions[idx]] ? undefined : SEAT_POWERS[factions[idx]] });
  }
  return s;
}

function winNow(s: GameState): GameState {
  const winner = s.turnOrder[s.activeIdx];
  s.players[winner].redStarTokens = 2;
  s.players[winner].hand = ["42", "43", "44", "45"];
  return applyAction(s, { type: "start.buyRedStar", playerId: winner, cardIds: ["42", "43", "44", "45"] });
}

function attachComeback(s: GameState, playerId: string, title: string) {
  const factionId = s.players[playerId].factionId!;
  s.comebackPowers[factionId] = {
    id: `pack2:power:${title.toLowerCase().replace(/[^a-z0-9]/g, "-")}`,
    sourceModuleId: "pack_2_comeback_mercenaries",
    title,
    text: "Sourced physical effect",
  };
}

describe("unlock engine (11)", () => {
  it("Pack 2 reveals mid-game when a player is eliminated by a failed Join the War", () => {
    let s = seatAll(createGame({ gameId: "g", seed: 61, players: P }));
    const victim = s.turnOrder[0];
    const other = s.turnOrder[1];
    // wipe the victim and fill the whole board: no legal join territory remains
    for (const t of Object.values(s.territories)) {
      if (t.controller === victim) { t.controller = undefined; t.troops = 0; t.hqFaction = undefined; }
    }
    for (const t of Object.values(s.territories)) {
      if (!t.controller) { t.controller = other; t.troops = 1; }
    }
    s = applyAction(s, { type: "start.done", playerId: victim });
    expect(s.players[victim].eliminated).toBe(true);
    expect(s.log.some((e) => e.type === "ModuleTriggered" && e.data?.moduleId === "pack_2_comeback_mercenaries")).toBe(true);
    expect(s.unlockedModules).toContain("pack_2_comeback_mercenaries"); // mid-game reveal
    expect(s.log.some((e) => e.type === "ModuleRevealed" && e.data?.moduleId === "pack_2_comeback_mercenaries")).toBe(true);
    expect(s.contentRequired).toEqual([]);
    expect(waitingOn(s)).toBe(victim);
    expect(s.comebackChoice).toMatchObject({ playerId: victim, factionId: s.players[victim].factionId });
    expect(s.comebackChoice?.options.map((option) => option.title)).toEqual([
      "Resourceful", "Stealthy", "Well-Armed", "Mobile", "Convincing", "Well-Supplied",
    ]);
    expect(() => applyAction(s, { type: "start.done", playerId: other })).toThrow(/choose a comeback power/);
    const selected = s.comebackChoice!.options[1];
    s = applyAction(s, { type: "comeback.choose", playerId: victim, optionId: selected.id });
    expect(s.comebackPowers[s.players[victim].factionId!]).toEqual(selected);
    expect(s.log.some((event) => event.type === "ComebackPowerChosen" && event.playerId === victim)).toBe(true);
    expect(s.turnOrder[s.activeIdx]).not.toBe(victim); // failed-join continuation resumed after the choice
  });

  it("a revealed Pack 2 folds into the campaign: module flag, 3 Mercenary instances, content-required entry", () => {
    let s = seatAll(createGame({ gameId: "g", seed: 62, players: P }));
    s.unlockedModules.push("pack_2_comeback_mercenaries"); // as revealed mid-game
    const comeback = {
      id: "pack_2_comeback_mercenaries:power:border-recruiters",
      sourceModuleId: "pack_2_comeback_mercenaries",
      title: "Border Recruiters",
      text: "Host-entered physical power text",
    };
    s.comebackPowers.khan_industries = comeback;
    s = winNow(s);
    for (const pid of s.rewards!.order) {
      s = applyAction(s, {
        type: "reward.choose", playerId: pid,
        reward: pid === s.winner ? { kind: "name_continent", continentId: "africa", name: "Zaharan" } : { kind: "pass" },
      });
    }
    s.contentRequired = [{ moduleId: "pack_2_comeback_mercenaries", items: ["powers"] }];
    const camp = applyGameToCampaign(initialCampaign("Terra"), s);
    expect(camp.unlockedModules).toEqual(["pack_2_comeback_mercenaries"]);
    expect(camp.inventories.scarInstances["mercenary"]).toBe(3);
    expect(camp.contentRequired).toEqual([{ moduleId: "pack_2_comeback_mercenaries", items: ["powers"] }]);
    expect(camp.factionComebackPowers.khan_industries).toEqual(comeback);
    const nextGame = createGame({ gameId: "g-next", seed: 620, players: P, campaign: camp });
    expect(nextGame.comebackPowers.khan_industries).toEqual(comeback);
  });

  it("queues end-game comeback choices for factions classified as eliminated", () => {
    let s = seatAll(createGame({ gameId: "pack2-end", seed: 621, players: P }));
    const victim = s.turnOrder[1];
    for (const territory of Object.values(s.territories)) {
      if (territory.controller === victim) {
        territory.controller = undefined;
        territory.troops = 0;
      }
    }
    s = winNow(s);
    expect(s.results?.[s.players[victim].factionId!]).toBe("eliminated");
    while (s.rewards && !s.rewards.committed) {
      const claimant = s.rewards.order[s.rewards.nextIdx];
      s = applyAction(s, {
        type: "reward.choose",
        playerId: claimant,
        reward: claimant === s.winner
          ? { kind: "name_continent", continentId: "europe", name: "Afterland" }
          : { kind: "pass" },
      });
    }
    expect(s.contentRequired).toEqual([]);
    expect(s.phase).toBe("game_over");
    expect(waitingOn(s)).toBe(victim);
    const option = s.comebackChoice!.options[0];
    s = applyAction(s, { type: "comeback.choose", playerId: victim, optionId: option.id });
    expect(s.comebackPowers[s.players[victim].factionId!]).toEqual(option);
    expect(s.comebackChoice).toBeUndefined();
  });

  it("mercenary adds 1 troop at the controller's end of turn only", () => {
    let s = seatAll(createGame({ gameId: "g", seed: 63, players: P }));
    const pid = s.turnOrder[0];
    const other = s.turnOrder[1];
    s.territories["ukraine"].controller = pid;
    s.territories["ukraine"].troops = 3;
    s.territories["ukraine"].scars = ["mercenary"];
    s.territories["ural"].controller = other;
    s.territories["ural"].troops = 2;
    s.territories["ural"].scars = ["mercenary"];
    s = applyAction(s, { type: "start.done", playerId: pid });
    const myTerr = Object.entries(s.territories).find(([tid, t]) => t.controller === pid && tid !== "ukraine")![0];
    s = applyAction(s, { type: "recruit.place", playerId: pid, territoryId: myTerr, count: s.recruit!.remaining });
    s = applyAction(s, { type: "recruit.done", playerId: pid });
    s = applyAction(s, { type: "phase.endAttacks", playerId: pid });
    s = applyAction(s, { type: "phase.endManeuver", playerId: pid });
    s = applyAction(s, { type: "end.turn", playerId: pid });
    expect(s.territories["ukraine"].troops).toBe(4); // controller's end of turn: +1
    expect(s.territories["ural"].troops).toBe(2); // not the other player's end of turn
  });

  it("executes Resourceful, Stealthy, Mobile, and Convincing comeback powers", () => {
    let resourceful = seatAll(createGame({ gameId: "resourceful", seed: 631, players: P }));
    const resourcefulPlayer = resourceful.turnOrder[0];
    attachComeback(resourceful, resourcefulPlayer, "Resourceful");
    const source = resourceful.players[resourcefulPlayer].startingTerritoryId!;
    const city = neighborsOf(resourceful, source).find((territoryId) => !resourceful.territories[territoryId].controller)!;
    resourceful.territories[city].city = { type: "minor", population: 1, name: "Open City" };
    resourceful = applyAction(resourceful, { type: "start.done", playerId: resourcefulPlayer });
    resourceful = applyAction(resourceful, {
      type: "recruit.place", playerId: resourcefulPlayer, territoryId: source, count: resourceful.recruit!.remaining,
    });
    resourceful = applyAction(resourceful, { type: "recruit.done", playerId: resourcefulPlayer });
    resourceful = applyAction(resourceful, { type: "attack.expand", playerId: resourcefulPlayer, from: source, to: city, troops: 2 });
    resourceful = applyAction(resourceful, { type: "phase.endAttacks", playerId: resourcefulPlayer });
    resourceful = applyAction(resourceful, { type: "phase.endManeuver", playerId: resourcefulPlayer });
    expect(endTurnDecision(resourceful, resourcefulPlayer).earnedBy).toBe("resourceful");

    let stealthy = seatAll(createGame({ gameId: "stealthy", seed: 632, players: P }));
    const stealthyPlayer = stealthy.turnOrder[0];
    attachComeback(stealthy, stealthyPlayer, "Stealthy");
    stealthy = applyAction(stealthy, { type: "start.done", playerId: stealthyPlayer });
    const hiddenTarget = Object.entries(stealthy.territories).find(([, territory]) =>
      !territory.controller && territory.troops === 0 && !territory.city && territory.scars.length === 0)![0];
    stealthy = applyAction(stealthy, {
      type: "recruit.place", playerId: stealthyPlayer, territoryId: hiddenTarget, count: stealthy.recruit!.remaining,
    });
    expect(stealthy.territories[hiddenTarget].controller).toBe(stealthyPlayer);
    expect(stealthy.log.some((event) => event.type === "FactionPowerApplied" && event.data?.powerId === "stealthy")).toBe(true);

    let mobile = seatAll(createGame({ gameId: "mobile", seed: 633, players: P }));
    const mobilePlayer = mobile.turnOrder[0];
    attachComeback(mobile, mobilePlayer, "Mobile");
    const hqFrom = mobile.players[mobilePlayer].startingTerritoryId!;
    const hqTo = neighborsOf(mobile, hqFrom)[0];
    mobile.territories[hqTo] = { controller: mobilePlayer, troops: 1, scars: [] };
    mobile.territories[hqTo].scars = ["bunker"];
    expect(() => applyAction(mobile, { type: "start.moveHq", playerId: mobilePlayer, from: hqFrom, to: hqTo })).toThrow(/scar/);
    mobile.territories[hqTo].scars = [];
    mobile = applyAction(mobile, { type: "start.moveHq", playerId: mobilePlayer, from: hqFrom, to: hqTo });
    expect(mobile.territories[hqFrom].hqFaction).toBeUndefined();
    expect(mobile.territories[hqTo].hqFaction).toBe(mobile.players[mobilePlayer].factionId);

    let convincing = seatAll(createGame({ gameId: "convincing", seed: 634, players: P }));
    const convincingPlayer = convincing.turnOrder[0];
    attachComeback(convincing, convincingPlayer, "Convincing");
    const mercenaryTerritory = convincing.players[convincingPlayer].startingTerritoryId!;
    convincing.territories[mercenaryTerritory].scars.push("mercenary");
    const before = convincing.territories[mercenaryTerritory].troops;
    convincing = applyAction(convincing, { type: "start.done", playerId: convincingPlayer });
    convincing = applyAction(convincing, {
      type: "recruit.place", playerId: convincingPlayer, territoryId: mercenaryTerritory, count: convincing.recruit!.remaining,
    });
    const afterRecruit = convincing.territories[mercenaryTerritory].troops;
    convincing = applyAction(convincing, { type: "recruit.done", playerId: convincingPlayer });
    convincing = applyAction(convincing, { type: "phase.endAttacks", playerId: convincingPlayer });
    convincing = applyAction(convincing, { type: "phase.endManeuver", playerId: convincingPlayer });
    expect(afterRecruit).toBeGreaterThan(before);
    expect(convincing.territories[mercenaryTerritory].troops).toBe(afterRecruit + 2);
  });

  it("executes Well-Armed against HQs and Well-Supplied against Ammo Shortage", () => {
    let s = seatAll(createGame({ gameId: "armed-supplied", seed: 635, players: P }));
    const attacker = s.turnOrder[0];
    const defender = s.turnOrder[1];
    const observer = s.turnOrder[2];
    attachComeback(s, attacker, "Well-Armed");
    attachComeback(s, defender, "Well-Supplied");
    const to = s.players[defender].startingTerritoryId!;
    const from = neighborsOf(s, to)[0];
    s.territories[from] = { controller: attacker, troops: 3, scars: [] };
    s.territories[to].controller = defender;
    s.territories[to].troops = 2;
    s.territories[to].scars = ["ammo_shortage"];
    s.players[observer].missiles = 1;
    s.phase = "expand_attack";
    s.activeIdx = s.turnOrder.indexOf(attacker);
    s.combat = {
      from, to, attacker, defender,
      attackerDice: 1, defenderDice: 1,
      natural: { att: [3], def: [4] },
      modifiers: [], unmodifiable: { att: [false], def: [false] },
      window: { passed: [] },
    };
    s = applyAction(s, { type: "combat.pass", playerId: observer });
    const resolved = [...s.log].reverse().find((event) => event.type === "CombatResolved")!;
    expect(resolved.data?.final).toEqual({ att: [4], def: [4] });
    expect(resolved.data?.scarModifiers).toEqual([]);
    expect(resolved.data?.powerModifiers).toEqual(expect.arrayContaining([
      expect.objectContaining({ powerId: "well_armed", side: "att", delta: 1 }),
    ]));
  });

  it("module scars are playable only once their module is revealed", () => {
    let s = seatAll(createGame({ gameId: "g", seed: 64, players: P }));
    const pid = s.turnOrder[0];
    s.players[pid].scarHand = [{ instanceId: "mercenary#1", scarId: "mercenary" }];
    s.players[pid].scarCardCount = 1;
    expect(() => applyAction(s, { type: "scar.play", playerId: pid, scarInstanceId: "mercenary#1", territoryId: "ural" })).toThrow(/not playable/);
    s.unlockedModules.push("pack_2_comeback_mercenaries");
    s = applyAction(s, { type: "scar.play", playerId: pid, scarInstanceId: "mercenary#1", territoryId: "ural" });
    expect(s.territories["ural"].scars).toEqual(["mercenary"]);
  });

  it("unlocked module scars join the setup deal pool from the campaign inventory", () => {
    const camp = initialCampaign("Terra");
    camp.gameNumber = 3;
    camp.unlockedModules = ["pack_2_comeback_mercenaries"];
    camp.inventories.scarInstances = { bunker: 0, ammo_shortage: 0, mercenary: 3 };
    const s = createGame({ gameId: "g", seed: 65, players: P, campaign: camp });
    for (const pid of Object.keys(s.players)) {
      expect(s.players[pid].scarCardCount).toBe(1);
      expect(s.players[pid].scarHand[0].scarId).toBe("mercenary");
    }
  });

  it("Pack 1 reveals at end-game and seeds canonical Events plus the advanced draft", () => {
    const camp = initialCampaign("Terra");
    camp.gameNumber = 5;
    camp.foundedMinorCities = 8;
    camp.inventories.minorCities = 1; // the 9th (last) Minor City is still available
    let s = seatAll(createGame({ gameId: "g", seed: 66, players: P, campaign: camp }));
    s = winNow(s);
    const winner = s.winner!;
    const heldOn = s.rewards!.order.slice(1);
    s = applyAction(s, { type: "reward.choose", playerId: winner, reward: { kind: "name_continent", continentId: "asia", name: "Khanate" } });
    const tid = Object.entries(s.territories).find(([, t]) => t.controller === heldOn[0] && !t.city)![0];
    s = applyAction(s, { type: "reward.choose", playerId: heldOn[0], reward: { kind: "found_minor_city", territoryId: tid, name: "Ninth" } });
    expect(s.log.some((e) => e.type === "ModuleTriggered" && e.data?.moduleId === "pack_1_advanced_draft_biohazards")).toBe(true);
    expect(s.unlockedModules).not.toContain("pack_1_advanced_draft_biohazards"); // end-game reveal waits for the last reward
    s = applyAction(s, { type: "reward.choose", playerId: heldOn[1], reward: { kind: "pass" } });
    expect(s.rewards!.committed).toBe(true);
    expect(s.unlockedModules).toContain("pack_1_advanced_draft_biohazards"); // revealed after rewards commit
    expect(s.log.some((e) => e.type === "ModuleRevealed" && e.data?.moduleId === "pack_1_advanced_draft_biohazards")).toBe(true);

    const folded = applyGameToCampaign(camp, s);
    expect(folded.unlockedModules).toContain("pack_1_advanced_draft_biohazards");
    expect(folded.inventories.scarInstances["biohazard"]).toBe(3);
    expect(folded.contentRequired).toEqual([]);
    const next = createGame({ gameId: "g2", seed: 67, players: P, campaign: folded });
    expect(next.advancedDraft?.completed).toBe(false);
    expect(next.contentRequired).toEqual([]);
    expect(next.legacyCards.eventDeck.filter((card) => card.sourceModuleId === "pack_1_advanced_draft_biohazards")).toHaveLength(7);
  });

  it("a game-end elimination (knockout classification) reveals Pack 2 at end-game", () => {
    let s = seatAll(createGame({ gameId: "g", seed: 69, players: P }));
    const knocked = s.turnOrder[2];
    for (const t of Object.values(s.territories)) {
      if (t.controller === knocked) { t.controller = undefined; t.troops = 0; } // knocked out, never rejoined
    }
    s = winNow(s);
    expect(s.results![s.players[knocked].factionId!]).toBe("eliminated");
    expect(s.unlockedModules).not.toContain("pack_2_comeback_mercenaries"); // end-game reveal waits for rewards
    for (const pid of s.rewards!.order) {
      s = applyAction(s, {
        type: "reward.choose", playerId: pid,
        reward: pid === s.winner ? { kind: "name_continent", continentId: "europe", name: "Neu Europa" } : { kind: "pass" },
      });
    }
    expect(s.unlockedModules).toContain("pack_2_comeback_mercenaries");
  });

  it("campaign-seeded games start with previously unlocked modules active", () => {
    const camp = initialCampaign("Terra");
    camp.unlockedModules = ["pack_2_comeback_mercenaries"];
    const s = createGame({ gameId: "g", seed: 68, players: P, campaign: camp });
    expect(s.unlockedModules).toEqual(["pack_2_comeback_mercenaries"]);
  });

  it("supplying host content clears the pause and lifts the Pack 1 draft gate (import wizard, 12)", () => {
    const camp = initialCampaign("Terra");
    camp.gameNumber = 6;
    camp.unlockedModules = ["pack_1_advanced_draft_biohazards"];
    camp.contentRequired = [{ moduleId: "pack_1_advanced_draft_biohazards", items: ["draft", "events"] }];
    expect(() => createGame({ gameId: "g", seed: 71, players: P, campaign: camp })).toThrow(/draft/);
    // unknown module / item are rejected
    expect(() => supplyModuleContent(camp, "nope", "draft", {})).toThrow(/pending/);
    expect(() => supplyModuleContent(camp, "pack_1_advanced_draft_biohazards", "missions", {})).toThrow(/pending/);
    const afterDraft = supplyModuleContent(camp, "pack_1_advanced_draft_biohazards", "draft", { cards: ["4 troops", "2 coins"] });
    expect(afterDraft.contentRequired).toEqual([{ moduleId: "pack_1_advanced_draft_biohazards", items: ["events"] }]);
    expect(afterDraft.hostContent["pack_1_advanced_draft_biohazards.draft"]).toEqual({ cards: ["4 troops", "2 coins"] });
    expect(camp.contentRequired[0].items).toEqual(["draft", "events"]); // pure: input untouched
    // the draft gate lifts; the remaining "events" item does not block game creation
    const s = createGame({ gameId: "g", seed: 72, players: P, campaign: afterDraft });
    expect(s.gameNumber).toBe(7);
    expect(s.advancedDraft?.completed).toBe(false);
    // supplying the last item removes the module's pause entirely
    const done = supplyModuleContent(afterDraft, "pack_1_advanced_draft_biohazards", "events", ["urban_panic: ..."]);
    expect(done.contentRequired).toEqual([]);
  });

  it("runs Pack 1's five-category snake draft and applies turn, placement, troop, Coin, and faction cards", () => {
    let camp = initialCampaign("Terra");
    camp.gameNumber = 6;
    camp.unlockedModules = ["pack_1_advanced_draft_biohazards"];
    camp.contentRequired = [{ moduleId: "pack_1_advanced_draft_biohazards", items: ["draft"] }];
    camp = supplyModuleContent(camp, "pack_1_advanced_draft_biohazards", "draft", { sourced: true });
    let s = createGame({ gameId: "advanced-draft", seed: 721, players: P, campaign: camp });
    const initialOrder = [...s.setup!.chooserOrder];
    expect(s.advancedDraft?.pickOrder).toEqual([
      ...initialOrder,
      ...[...initialOrder].reverse(),
      ...initialOrder,
      ...[...initialOrder].reverse(),
      ...initialOrder,
    ]);

    const categories = ["faction", "turnOrder", "placementOrder", "startingTroops", "startingCoinCards"] as const;
    for (let round = 0; round < categories.length; round++) {
      for (let pick = 0; pick < P.length; pick++) {
        const playerId = waitingOn(s)!;
        const category = categories[round];
        const available = category === "faction"
          ? s.advancedDraft!.available.factions
          : s.advancedDraft!.available[category];
        s = applyAction(s, { type: "draft.pick", playerId, category, value: available[0] });
      }
    }

    expect(s.advancedDraft?.completed).toBe(true);
    expect(s.setup!.chooserOrder).toEqual(initialOrder);
    expect(s.turnOrder).toEqual([...initialOrder].reverse());
    const sixTroopPlayer = [...initialOrder].reverse()[0];
    expect(s.players[sixTroopPlayer].startingTroops).toBe(6);
    expect(joinWarTroops(s, sixTroopPlayer)).toBe(3);
    expect(s.players[sixTroopPlayer].hand).toHaveLength(s.advancedDraft!.picks[sixTroopPlayer].startingCoinCards!);
    expect(Object.values(s.players).reduce((count, player) => count + player.hand.length, 0)).toBe(3);

    const starts = ["alaska", "brazil", "western_australia"];
    for (const [index, playerId] of s.setup!.chooserOrder.entries()) {
      const factionId = s.advancedDraft!.picks[playerId].factionId!;
      if (index === 0) {
        expect(() => applyAction(s, {
          type: "setup.choose", playerId, factionId: s.advancedDraft!.available.factions[0], territoryId: starts[index],
        })).toThrow(/selected in the advanced draft/);
      }
      s = applyAction(s, {
        type: "setup.choose", playerId, factionId, territoryId: starts[index],
        powerId: s.factionPowers[factionId] ? undefined : factionDefinitionById(factionId, s.unlockedModules)?.startingPowers[0],
      });
      expect(s.territories[starts[index]].troops).toBe(s.players[playerId].startingTroops);
    }
    expect(s.phase).toBe("start_turn");
    expect(s.log.some((event) => event.type === "AdvancedDraftCompleted")).toBe(true);
  });

  it("Pack 3 reveals after a person's second signature and their winner reward", () => {
    const camp = initialCampaign("Terra");
    camp.gameNumber = 4;
    camp.signatures = { u1: 1, u2: 1, u3: 1 };
    let s = seatAll(createGame({ gameId: "g5", seed: 73, players: P, campaign: camp }));
    s = winNow(s);
    const winner = s.winner!;

    expect(s.signatures[winner]).toBe(2);
    expect(s.log.some((e) => e.type === "ModuleTriggered" && e.data?.moduleId === "pack_3_homelands_missions")).toBe(true);
    expect(s.unlockedModules).not.toContain("pack_3_homelands_missions");

    s = applyAction(s, {
      type: "reward.choose",
      playerId: winner,
      reward: { kind: "name_continent", continentId: "north_america", name: "Ada's Reach" },
    });
    expect(s.unlockedModules).toContain("pack_3_homelands_missions");
    const chosen = s.log.findIndex((e) => e.type === "ContinentNamed" && e.playerId === winner);
    const revealed = s.log.findIndex((e) => e.type === "ModuleRevealed" && e.data?.moduleId === "pack_3_homelands_missions");
    expect(revealed).toBeGreaterThan(chosen);
    expect(s.rewards?.committed).toBe(false); // held-on rewards continue after the reveal
  });

  it("Pocket 1 reveals on the third Missile in one combat roll before casualties resolve", () => {
    let s = seatAll(createGame({
      gameId: "nuclear",
      seed: 74,
      players: P.map((player) => ({ ...player, missiles: 1 })),
    }));
    const attacker = s.turnOrder[0];
    const defender = s.turnOrder[1];
    const observer = s.turnOrder[2];
    const from = "alaska";
    const to = "northwest_territory";
    s.territories[from].controller = attacker;
    s.territories[from].troops = 8;
    s.territories[to].controller = defender;
    s.territories[to].troops = 2;
    for (const territory of Object.values(s.territories)) {
      if (territory.controller === observer) {
        territory.controller = undefined;
        territory.troops = 0;
      }
    }
    s.territories.alberta = { controller: observer, troops: 1, scars: [] };
    const observerCard = s.sideboard.territoryDeck[0];
    s.players[observer].hand = [observerCard];
    s.phase = "expand_attack";

    s = applyAction(s, { type: "attack.declare", playerId: attacker, from, to });
    s = applyAction(s, { type: "attack.chooseAttackers", playerId: attacker, count: 3 });
    s = applyAction(s, { type: "attack.defenderDice", playerId: defender, count: 2 });
    expect(waitingOn(s)).toBe(attacker);
    s = applyAction(s, { type: "combat.useMissile", playerId: attacker, side: "att", dieIndex: 0 });
    expect(waitingOn(s)).toBe(defender);
    s = applyAction(s, { type: "combat.useMissile", playerId: defender, side: "def", dieIndex: 0 });
    expect(waitingOn(s)).toBe(observer); // non-participants get the official third priority window
    s = applyAction(s, { type: "combat.useMissile", playerId: observer, side: "att", dieIndex: 1 });

    expect(s.unlockedModules).toContain("pocket_1_nuclear_war_mutants");
    const revealed = s.log.findIndex((e) => e.type === "ModuleRevealed" && e.data?.moduleId === "pocket_1_nuclear_war_mutants");
    expect(revealed).toBeGreaterThan(-1);
    expect(s.log.findIndex((e) => e.type === "CombatResolved")).toBe(-1);
    expect(s.contentRequired).toEqual([]);
    expect(s.combat).toBeUndefined();
    expect(s.log.some((e) => e.type === "NuclearOpeningResolved")).toBe(true);
    expect(s.log.some((e) => e.type === "CombatResolved")).toBe(false);
    expect(s.territories[to]).toMatchObject({ troops: 0, controller: undefined, hqFaction: undefined, scars: ["fallout"] });
    expect(s.territories[from].troops).toBeLessThan(5); // three committed attackers, then the land-adjacent die loss
    expect(s.territories.alberta).toMatchObject({ troops: 0, controller: undefined });
    expect(s.players[observer]).toMatchObject({ knockedOut: true, hand: [] });
    expect(s.sideboard.discard).toContain(observerCard);
    expect(s.log.find((e) => e.type === "NuclearOpeningResolved")?.data).toMatchObject({ attackingTroops: 3 });
  });

  it("Pocket 2 reveals after 30+ troops are calculated while a Missile remains, before placement", () => {
    let s = seatAll(createGame({ gameId: "aliens", seed: 75, players: P }));
    const active = s.turnOrder[0];
    s.players[active].missiles = 1;
    for (const territory of Object.values(s.territories)) {
      territory.controller = active;
      territory.troops = 1;
    }

    s = applyAction(s, { type: "start.done", playerId: active });
    expect(s.recruit!.breakdown.total).toBeGreaterThanOrEqual(30);
    expect(s.unlockedModules).toContain("pocket_2_alien_landing");
    const calculated = s.log.findIndex((e) => e.type === "RecruitCalculated");
    const revealed = s.log.findIndex((e) => e.type === "ModuleRevealed" && e.data?.moduleId === "pocket_2_alien_landing");
    expect(revealed).toBeGreaterThan(calculated);
    expect(s.log.some((e) => e.type === "TroopsPlaced")).toBe(false);
    expect(s.contentRequired).toEqual([]);
    s = applyAction(s, {
      type: "alien.placeIsland",
      playerId: active,
      name: "Arrival",
      connections: ["brazil", "indonesia"],
    });
    expect(s.alienIsland).toEqual({ territoryId: "alien_island", name: "Arrival", connections: ["brazil", "indonesia"] });
    expect(s.territories.alien_island).toMatchObject({ controller: active, troops: 10 });
    expect(s.factionWeaknesses[s.players[active].factionId!]).toBe("alien_collaborator");
    expect(s.sideboard.territoryDeck).toContain("alien_island_resource");
    expect(neighborsOf(s, "brazil")).toContain("alien_island");
    expect(neighborsOf(s, "alien_island")).toEqual(["brazil", "indonesia"]);

    s.territories.brazil = { controller: active, troops: 5, scars: [] };
    s.territories.alien_island = { troops: 0, scars: [] };
    s.phase = "expand_attack";
    s.recruit = undefined;
    s = applyAction(s, { type: "attack.expand", playerId: active, from: "brazil", to: "alien_island", troops: 2 });
    expect(s.territories.alien_island).toMatchObject({ controller: active, troops: 2 });

    const reverseAttack = structuredClone(s);
    const defender = reverseAttack.turnOrder.find((playerId) => playerId !== active)!;
    reverseAttack.territories.alien_island = { controller: active, troops: 4, scars: [] };
    reverseAttack.territories.brazil = { controller: defender, troops: 1, scars: [] };
    reverseAttack.phase = "expand_attack";
    const declared = applyAction(reverseAttack, { type: "attack.declare", playerId: active, from: "alien_island", to: "brazil" });
    expect(declared.combat).toMatchObject({ from: "alien_island", to: "brazil", attacker: active, defender });

    const maneuver = structuredClone(s);
    maneuver.territories.alien_island = { controller: active, troops: 3, scars: [] };
    maneuver.territories.brazil = { controller: active, troops: 2, scars: [] };
    maneuver.phase = "maneuver";
    const moved = applyAction(maneuver, { type: "maneuver.move", playerId: active, from: "alien_island", to: "brazil", count: 1 });
    expect(moved.territories.alien_island.troops).toBe(2);
    expect(moved.territories.brazil.troops).toBe(3);
  });

  it("Pack 4 reveals its canonical Private Missions and permanently attaches a completed one", () => {
    const camp = initialCampaign("Terra");
    camp.gameNumber = 9;
    camp.unlockedModules = ["pack_3_homelands_missions"];
    camp.hostContent["pack_3_homelands_missions.missions"] = "Host-entered Mission deck";
    camp.factionHistory.khan_industries = [
      { gameNumber: 2, playerId: "u1", playerName: "Ada", startingTerritoryId: "alaska", result: "won" },
      { gameNumber: 7, playerId: "u2", playerName: "Lin", startingTerritoryId: "brazil", result: "won" },
    ];
    camp.factionHistory.die_mechaniker = [
      { gameNumber: 8, playerId: "u3", playerName: "Rex", startingTerritoryId: "western_australia", result: "won" },
    ];
    let s = seatAll(createGame({ gameId: "capital", seed: 76, players: P, campaign: camp }));
    const founder = s.turnOrder[0];
    s = applyAction(s, {
      type: "mission.foundWorldCapital",
      playerId: founder,
      founderPlayerId: founder,
      territoryId: "middle_east",
      name: "Unity",
    });

    expect(s.territories.middle_east.city).toMatchObject({ type: "world_capital", population: 5, name: "Unity" });
    expect(s.worldCapitalTerritoryId).toBe("middle_east");
    expect(s.leadFactionId).toBe("khan_industries");
    expect(s.unlockedModules).toContain("pack_4_lead_faction_private_missions");
    expect(s.contentRequired).toEqual([]);
    expect(s.legacyCards.missionDeck.filter((mission) =>
      mission.sourceModuleId === "pack_4_lead_faction_private_missions").map((mission) => mission.title).sort()).toEqual([
      "Advanced Tactics", "Advanced Training", "Forced Occupation", "Guerilla Warfare", "Urban Troop Surge", "Wide Border",
    ]);

    const factionId = s.players[founder].factionId!;
    const mission = s.legacyCards.missionDeck.find((candidate) => candidate.title === "Forced Occupation")!;
    s.legacyCards.missionDeck = s.legacyCards.missionDeck.filter((candidate) => candidate.id !== mission.id);
    s.legacyCards.activeMission = mission;
    s.activeIdx = s.turnOrder.indexOf(founder);
    s.phase = "end_turn";
    s.privateMissionProgress.forcedOccupation = true;
    const starsBeforeCapture = s.players[founder].redStarTokens;
    s = applyAction(s, {
      type: "mission.complete",
      playerId: founder,
      claimantPlayerId: founder,
      reward: 1,
    });
    expect(s.players[founder].redStarTokens).toBe(starsBeforeCapture + 1);
    expect(s.capturedPrivateMissions[factionId]).toMatchObject({ title: "Forced Occupation" });
    const other = s.turnOrder.find((playerId) => playerId !== founder)!;
    const filtered = filterStateFor(s, other);
    expect(filtered.capturedPrivateMissions[factionId]).toMatchObject({ title: "Private Mission", text: "" });

    s.activeIdx = s.turnOrder.indexOf(founder);
    s.phase = "end_turn";
    s.privateMissionsUsed = [];
    s.privateMissionProgress.forcedOccupation = true;
    const starsBefore = s.players[founder].redStarTokens;
    s = applyAction(s, { type: "privateMission.activate", playerId: founder, claimantPlayerId: founder });
    expect(s.players[founder].redStarTokens).toBe(starsBefore + 1);
    expect(s.privateMissionsUsed).toContain(factionId);
    s.activeIdx = s.turnOrder.indexOf(founder);
    s.phase = "end_turn";
    expect(() => applyAction(s, {
      type: "privateMission.activate", playerId: founder, claimantPlayerId: founder,
    })).toThrow(/already activated/);
  });

  it("the Lead Faction places its three setup troops in an unoccupied World Capital without an HQ", () => {
    const camp = initialCampaign("Terra");
    camp.gameNumber = 10;
    camp.unlockedModules = ["pack_3_homelands_missions", "pack_4_lead_faction_private_missions"];
    camp.worldCapitalTerritoryId = "middle_east";
    camp.leadFactionId = "khan_industries";
    camp.factionHistory.khan_industries = [
      { gameNumber: 7, playerId: "u1", playerName: "Ada", startingTerritoryId: "brazil", result: "won" },
    ];
    camp.board.cities.push({ territoryId: "middle_east", type: "world_capital", name: "Unity", foundedByPlayerId: "u2" });
    const s = seatAll(createGame({ gameId: "capital-next", seed: 77, players: P, campaign: camp }));
    expect(s.territories.middle_east).toMatchObject({ controller: "u1", troops: 3 });
    expect(s.territories.middle_east.hqFaction).toBeUndefined();
    expect(s.log.some((event) => event.type === "LeadFactionCapitalBonus" && event.playerId === "u1")).toBe(true);
  });

  it("Pack 3 Homeland requires a unique most-started continent and expands face-up draw eligibility", () => {
    const camp = initialCampaign("Terra");
    camp.gameNumber = 8;
    camp.unlockedModules = ["pack_3_homelands_missions"];
    camp.hostContent["pack_3_homelands_missions.missions"] = "Host-entered Missions";
    camp.hostContent["pack_3_homelands_missions.events"] = "Host-entered Events";
    camp.factionHistory.khan_industries = [
      { gameNumber: 1, playerId: "u1", playerName: "Ada", startingTerritoryId: "brazil", result: "held_on" },
      { gameNumber: 2, playerId: "u1", playerName: "Ada", startingTerritoryId: "china", result: "held_on" },
      { gameNumber: 3, playerId: "u1", playerName: "Ada", startingTerritoryId: "argentina", result: "won" },
      { gameNumber: 4, playerId: "u1", playerName: "Ada", startingTerritoryId: "japan", result: "won" },
      { gameNumber: 5, playerId: "u1", playerName: "Ada", startingTerritoryId: "china", result: "held_on" },
    ];
    let s = seatAll(createGame({ gameId: "homeland", seed: 78, players: P, campaign: camp }));
    expect(factionHomeland(s, "khan_industries")).toBe("asia");
    s.activeIdx = s.turnOrder.indexOf("u1");
    s.phase = "end_turn";
    s.players.u1.conqueredEnemyThisTurn = true;
    s.territories.japan.controller = "u2"; // not controlled by Khan, but inside its Homeland
    s.territories.japan.troops = 2;
    s.sideboard.slots[0] = "32"; // Japan
    s = applyAction(s, { type: "end.draw", playerId: "u1", choice: { slot: 0 } });
    expect(s.players.u1.hand).toContain("32");
  });
});

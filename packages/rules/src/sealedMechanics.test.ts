import { describe, expect, it } from "vitest";
import { contentPack, factionDefinitions } from "@risk/content";
import { applyAction, createGame, isLegalStart, recruitBreakdown } from "./engine.ts";
import { initialCampaign } from "./campaign.ts";
import type { GameState, LegacyCard } from "./types.ts";

const PLAYERS = [
  { id: "u1", name: "Ada" },
  { id: "u2", name: "Bryn" },
  { id: "u3", name: "Cy" },
];
const STARTS = ["alaska", "brazil", "western_australia"];

function seated(modules: string[] = []): GameState {
  const campaign = initialCampaign("Sealed QA");
  campaign.unlockedModules = [...modules];
  let state = createGame({ gameId: `sealed-${modules.join("-")}`, seed: 951, players: PLAYERS, campaign });
  for (let index = 0; index < PLAYERS.length; index++) {
    const playerId = state.setup!.chooserOrder[state.setup!.nextIdx];
    const faction = contentPack.factions.find((candidate) => !Object.values(state.players).some((player) => player.factionId === candidate.id))!;
    state = applyAction(state, {
      type: "setup.choose", playerId, factionId: faction.id, territoryId: STARTS[index],
      powerId: state.factionPowers[faction.id] ? undefined : faction.startingPowers[0],
    });
  }
  return state;
}

function active(state: GameState) {
  return state.turnOrder[state.activeIdx];
}

function setPendingEvent(state: GameState, id: string, title: string, sourceModuleId: string): GameState {
  const next = structuredClone(state);
  next.phase = "end_turn";
  next.legacyCards.pendingEvent = { id, title, text: title, sourceModuleId };
  return next;
}

describe("sourced Pocket 1 mechanics", () => {
  it("executes Rally, Bad Intel, EMP, Interference, and Recon in their printed windows", () => {
    let rally = seated(["pocket_1_nuclear_war_mutants"]);
    const rallyPlayer = active(rally);
    const rallyFaction = rally.players[rallyPlayer].factionId!;
    const rallyTerritory = rally.players[rallyPlayer].startingTerritoryId!;
    rally.factionMissilePowers[rallyFaction] = "rally";
    rally.players[rallyPlayer].missiles = 2;
    const before = rally.territories[rallyTerritory].troops;
    rally = applyAction(rally, { type: "missilePower.rally", playerId: rallyPlayer });
    expect(rally.territories[rallyTerritory].troops).toBe(before + 2);
    expect(rally.players[rallyPlayer].missiles).toBe(1);
    expect(() => applyAction(rally, { type: "missilePower.rally", playerId: rallyPlayer })).toThrow(/once per turn/);

    let intel = seated(["pocket_1_nuclear_war_mutants"]);
    const target = active(intel);
    const spy = intel.turnOrder[1];
    intel.factionMissilePowers[intel.players[spy].factionId!] = "bad_intel";
    intel.players[spy].missiles = 1;
    for (const territory of contentPack.cards.territoryCards) {
      if (["indonesia", "new_guinea", "western_australia", "eastern_australia"].includes(territory.territoryId)) {
        intel.territories[territory.territoryId].controller = target;
        intel.territories[territory.territoryId].troops = 1;
      }
    }
    intel = applyAction(intel, { type: "missilePower.badIntel", playerId: spy, targetPlayerId: target, continentId: "australia" });
    intel = applyAction(intel, { type: "start.done", playerId: target });
    expect(intel.recruit!.breakdown.continents.map((continent) => continent.id)).not.toContain("australia");

    let emp = seated(["pocket_1_nuclear_war_mutants"]);
    const attacker = active(emp);
    const defender = emp.turnOrder[1];
    const observer = emp.turnOrder[2];
    const from = emp.players[attacker].startingTerritoryId!;
    const to = from === "alaska" ? "northwest_territory" : "north_africa";
    emp.phase = "expand_attack";
    emp.territories[from].troops = 6;
    emp.territories[to] = { controller: defender, troops: 2, scars: ["bunker"] };
    emp.factionMissilePowers[emp.players[observer].factionId!] = "emp";
    emp.players[observer].missiles = 1;
    emp = applyAction(emp, { type: "attack.declare", playerId: attacker, from, to });
    emp = applyAction(emp, { type: "attack.chooseAttackers", playerId: attacker, count: 2 });
    emp = applyAction(emp, { type: "missilePower.emp", playerId: observer });
    emp = applyAction(emp, { type: "attack.defenderDice", playerId: defender, count: 2 });
    expect(emp.log.filter((event) => event.type === "CombatResolved").at(-1)?.data?.scarModifiers).toEqual([]);
    expect(emp.log.some((event) => event.type === "TimingWindowOpened")).toBe(false);

    let interference = seated(["pocket_1_nuclear_war_mutants"]);
    const drawer = active(interference);
    const jammer = interference.turnOrder[1];
    interference.phase = "end_turn";
    interference.players[drawer].conqueredEnemyThisTurn = true;
    interference.factionMissilePowers[interference.players[jammer].factionId!] = "interference";
    interference.players[jammer].missiles = 1;
    for (const cardId of interference.sideboard.slots) {
      if (!cardId) continue;
      const territoryId = contentPack.cards.territoryCards.find((card) => card.id === cardId)!.territoryId;
      interference.territories[territoryId].controller = undefined;
    }
    interference = applyAction(interference, { type: "missilePower.interference", playerId: jammer, targetPlayerId: drawer, choice: { coin: true } });
    expect(() => applyAction(interference, { type: "end.draw", playerId: drawer, choice: { coin: true } })).toThrow(/Interference/);

    let recon = seated(["pocket_1_nuclear_war_mutants"]);
    const scout = active(recon);
    recon.phase = "end_turn";
    recon.players[scout].conqueredEnemyThisTurn = true;
    recon.factionMissilePowers[recon.players[scout].factionId!] = "recon";
    recon.players[scout].missiles = 1;
    for (const cardId of recon.sideboard.slots) {
      if (!cardId) continue;
      const territoryId = contentPack.cards.territoryCards.find((card) => card.id === cardId)!.territoryId;
      recon.territories[territoryId].controller = undefined;
    }
    const selected = recon.sideboard.slots[0]!;
    recon = applyAction(recon, { type: "end.draw", playerId: scout, choice: { reconSlot: 0 } });
    expect(recon.players[scout].hand).toContain(selected);
    expect(recon.players[scout].missiles).toBe(0);
  });

  it("enforces Fallout losses, placement/maneuver restrictions, and the Mutant reversal", () => {
    let human = seated(["pocket_1_nuclear_war_mutants"]);
    const playerId = active(human);
    human.phase = "expand_attack";
    human.territories.alaska.troops = 7;
    human.territories.northwest_territory = { troops: 0, scars: ["fallout"] };
    human = applyAction(human, { type: "attack.expand", playerId, from: "alaska", to: "northwest_territory", troops: 4 });
    expect(human.territories.northwest_territory.troops).toBe(2);
    human.phase = "end_turn";
    human = applyAction(human, { type: "end.turn", playerId });
    expect(human.territories.northwest_territory.troops).toBe(1);

    let mutants = seated(["pocket_1_nuclear_war_mutants"]);
    const mutantPlayer = active(mutants);
    mutants.players[mutantPlayer].factionId = "mutants";
    mutants.phase = "expand_attack";
    mutants.territories.alaska.troops = 7;
    mutants.territories.northwest_territory = { troops: 0, scars: ["fallout"] };
    mutants = applyAction(mutants, { type: "attack.expand", playerId: mutantPlayer, from: "alaska", to: "northwest_territory", troops: 4 });
    expect(mutants.territories.northwest_territory.troops).toBe(4);
    mutants.phase = "end_turn";
    mutants = applyAction(mutants, { type: "end.turn", playerId: mutantPlayer });
    expect(mutants.territories.northwest_territory.troops).toBe(5);
  });

  it("combines the two Mutants Evolve choices into the sourced hidden power", () => {
    let state = seated(["pocket_1_nuclear_war_mutants"]);
    state.players[active(state)].factionId = "mutants";
    state = setPendingEvent(state, "pocket_1_nuclear_war_mutants:event:mutants-evolve-1", "The Mutants Evolve", "pocket_1_nuclear_war_mutants");
    state = applyAction(state, { type: "event.resolve", playerId: active(state), destination: "box", resolution: { kind: "mutantsEvolve", choice: "offensive" } });
    state = setPendingEvent(state, "pocket_1_nuclear_war_mutants:event:mutants-evolve-2", "The Mutants Evolve", "pocket_1_nuclear_war_mutants");
    state = applyAction(state, { type: "event.resolve", playerId: active(state), destination: "box", resolution: { kind: "mutantsEvolve", choice: "bodies" } });
    expect(state.mutantEvolutionChoices).toEqual(["offensive", "bodies"]);
    expect(state.mutantEvolution).toBe("unnatural_strength");
  });

  it.each([
    ["offensive", "bodies", "unnatural_strength"],
    ["offensive", "brains", "mindshackle"],
    ["defensive", "bodies", "defensive_cloning"],
    ["defensive", "brains", "mass_hypnosis"],
  ] as const)("maps %s + %s to %s", (axis, form, expected) => {
    let state = seated(["pocket_1_nuclear_war_mutants"]);
    state.players[active(state)].factionId = "mutants";
    state = setPendingEvent(state, "pocket_1_nuclear_war_mutants:event:mutants-evolve-1", "The Mutants Evolve", "pocket_1_nuclear_war_mutants");
    state = applyAction(state, { type: "event.resolve", playerId: active(state), destination: "box", resolution: { kind: "mutantsEvolve", choice: axis } });
    state = setPendingEvent(state, "pocket_1_nuclear_war_mutants:event:mutants-evolve-2", "The Mutants Evolve", "pocket_1_nuclear_war_mutants");
    state = applyAction(state, { type: "event.resolve", playerId: active(state), destination: "box", resolution: { kind: "mutantsEvolve", choice: form } });
    expect(state.mutantEvolution).toBe(expected);
  });

  it("executes all four revealed Mutant evolutions", () => {
    let strength = seated(["pocket_1_nuclear_war_mutants"]);
    const attacker = active(strength);
    const defender = strength.turnOrder[1];
    strength.players[attacker].factionId = "mutants";
    strength.mutantEvolution = "unnatural_strength";
    strength.players[attacker].missiles = 1;
    strength.phase = "expand_attack";
    strength.territories.alaska = { controller: attacker, troops: 5, scars: [] };
    strength.territories.northwest_territory = { controller: defender, troops: 1, scars: [] };
    strength.combat = {
      from: "alaska", to: "northwest_territory", attacker, defender, attackerDice: 1, defenderDice: 1,
      natural: { att: [6], def: [6] }, modifiers: [], unmodifiable: { att: [false], def: [false] }, window: { passed: [] },
    };
    strength = applyAction(strength, { type: "combat.pass", playerId: attacker });
    expect(strength.territories.alaska.troops).toBe(5);
    expect(strength.territories.northwest_territory.troops).toBe(0);

    let cloning = seated(["pocket_1_nuclear_war_mutants"]);
    const cloneAttacker = active(cloning);
    const cloneDefender = cloning.turnOrder[1];
    cloning.players[cloneDefender].factionId = "mutants";
    cloning.mutantEvolution = "defensive_cloning";
    cloning.players[cloneAttacker].missiles = 1;
    cloning.phase = "expand_attack";
    cloning.territories.alaska = { controller: cloneAttacker, troops: 5, scars: [] };
    cloning.territories.northwest_territory = { controller: cloneDefender, troops: 3, scars: [] };
    cloning.combat = {
      from: "alaska", to: "northwest_territory", attacker: cloneAttacker, defender: cloneDefender, attackerDice: 1, defenderDice: 2,
      natural: { att: [1], def: [2, 2] }, modifiers: [], unmodifiable: { att: [false], def: [false, false] }, window: { passed: [] },
    };
    cloning = applyAction(cloning, { type: "combat.pass", playerId: cloneAttacker });
    expect(cloning.territories.northwest_territory.troops).toBe(4);

    let hypnosis = seated(["pocket_1_nuclear_war_mutants"]);
    const mutant = active(hypnosis);
    hypnosis.players[mutant].factionId = "mutants";
    hypnosis.mutantEvolution = "mass_hypnosis";
    hypnosis.phase = "join_or_recruit";
    hypnosis.recruit = { remaining: 0, breakdown: { territories: 1, fromTerritories: 3, population: 0, continents: [], tradeIns: 0, total: 3 } };
    const alaskaCard = contentPack.cards.territoryCards.find((card) => card.territoryId === "alaska")!.id;
    const secondCard = contentPack.cards.territoryCards.find((card) => card.territoryId === "brazil")!.id;
    hypnosis.players[mutant].hand = [alaskaCard, secondCard];
    hypnosis = applyAction(hypnosis, { type: "recruit.trade", playerId: mutant, cardIds: [alaskaCard, secondCard], protectTerritoryId: "alaska" });
    expect(hypnosis.protectedMutantTerritoryId).toBe("alaska");
    const enemy = hypnosis.turnOrder[1];
    hypnosis.activeIdx = hypnosis.turnOrder.indexOf(enemy);
    hypnosis.phase = "expand_attack";
    hypnosis.territories.northwest_territory = { controller: enemy, troops: 5, scars: [] };
    expect(() => applyAction(hypnosis, { type: "attack.declare", playerId: enemy, from: "northwest_territory", to: "alaska" })).toThrow(/Mass Hypnosis/);

    let mind = seated(["pocket_1_nuclear_war_mutants"]);
    const mindMutant = active(mind);
    const target = mind.turnOrder[1];
    mind.players[mindMutant].factionId = "mutants";
    mind.mutantEvolution = "mindshackle";
    mind.phase = "end_turn";
    mind.players[mindMutant].conqueredEnemyThisTurn = true;
    const slotCard = mind.sideboard.slots[0]!;
    const slotTerritory = contentPack.cards.territoryCards.find((card) => card.id === slotCard)!.territoryId;
    mind.territories[slotTerritory].controller = mindMutant;
    const targetCard = mind.sideboard.coinPile.shift()!;
    mind.players[target].hand = [targetCard];
    mind.log.push({ seq: ++mind.eventSeq, type: "TerritoryConquered", playerId: mindMutant, data: { territory: "alberta", from: "alaska", moved: 1, defender: target, hqCaptured: null } });
    mind = applyAction(mind, { type: "end.draw", playerId: mindMutant, choice: { slot: 0 }, mindshackleTargetPlayerId: target });
    expect(mind.players[mindMutant].hand).toContain(targetCard);
    expect(mind.players[target].hand).toContain(slotCard);
  });
});

describe("sourced Pocket 2 mechanics", () => {
  it("makes both sealed factions draftable only after their pockets open", () => {
    expect(factionDefinitions([]).map((faction) => faction.id)).not.toContain("mutants");
    expect(factionDefinitions(["pocket_1_nuclear_war_mutants"]).map((faction) => faction.id)).toContain("mutants");
    expect(factionDefinitions(["pocket_2_alien_landing"]).map((faction) => faction.id)).toContain("aliens");
  });

  it("applies Alien Collaborator trade/city penalties and Alien city immunity", () => {
    let state = seated(["pocket_2_alien_landing"]);
    const playerId = active(state);
    const factionId = state.players[playerId].factionId!;
    state.alienCollaboratorFactionId = factionId;
    state.phase = "join_or_recruit";
    state.recruit = { remaining: 0, breakdown: { territories: 1, fromTerritories: 3, population: 0, continents: [], tradeIns: 0, total: 3 } };
    const oneResource = contentPack.cards.territoryCards.find((card) => card.resources === 1 && !state.cardModifications[card.id])!.id;
    state.players[playerId].hand = [oneResource];
    state = applyAction(state, { type: "recruit.trade", playerId, cardIds: [oneResource] });
    expect(state.recruit!.breakdown.tradeIns).toBe(1); // one printed resource + Collaborator's one = payout row 2

    state.phase = "expand_attack";
    state.territories.alaska = { controller: playerId, troops: 8, scars: [] };
    state.territories.northwest_territory = { troops: 0, city: { type: "minor", population: 1 }, scars: [] };
    state = applyAction(state, { type: "attack.expand", playerId, from: "alaska", to: "northwest_territory", troops: 5 });
    expect(state.territories.northwest_territory.troops).toBe(2); // population 1 + Collaborator 2

    let aliens = seated(["pocket_2_alien_landing"]);
    const alienPlayer = active(aliens);
    aliens.players[alienPlayer].factionId = "aliens";
    aliens.phase = "expand_attack";
    aliens.territories.alaska = { controller: alienPlayer, troops: 5, scars: [] };
    aliens.territories.northwest_territory = { troops: 0, city: { type: "major", population: 2 }, scars: [] };
    aliens = applyAction(aliens, { type: "attack.expand", playerId: alienPlayer, from: "alaska", to: "northwest_territory", troops: 3 });
    expect(aliens.territories.northwest_territory.troops).toBe(3);
  });

  it("enforces all five Weakness effects", () => {
    const primitive = seated(["pocket_2_alien_landing"]);
    const playerId = active(primitive);
    const factionId = primitive.players[playerId].factionId!;
    primitive.territories.alaska.city = { type: "world_capital", population: 5 };
    primitive.factionWeaknesses[factionId] = "primitive";
    expect(recruitBreakdown(primitive, playerId).population).toBe(0);

    let cautious = seated(["pocket_2_alien_landing"]);
    const cautiousPlayer = active(cautious);
    cautious.factionWeaknesses[cautious.players[cautiousPlayer].factionId!] = "cautious";
    cautious.phase = "join_or_recruit";
    cautious.recruit = { remaining: 3, breakdown: { territories: 3, fromTerritories: 3, population: 0, continents: [], tradeIns: 0, total: 3 } };
    for (const territoryId of ["alaska", "northwest_territory", "alberta"]) cautious.territories[territoryId] = { controller: cautiousPlayer, troops: 1, scars: [] };
    cautious = applyAction(cautious, { type: "recruit.place", playerId: cautiousPlayer, territoryId: "alaska", count: 1 });
    cautious = applyAction(cautious, { type: "recruit.place", playerId: cautiousPlayer, territoryId: "northwest_territory", count: 1 });
    expect(() => applyAction(cautious, { type: "recruit.place", playerId: cautiousPlayer, territoryId: "alberta", count: 1 })).toThrow(/at most two/);

    let purist = seated(["pocket_2_alien_landing"]);
    const puristPlayer = active(purist);
    purist.factionWeaknesses[purist.players[puristPlayer].factionId!] = "purist";
    purist.phase = "end_turn";
    purist.players[puristPlayer].conqueredEnemyThisTurn = true;
    purist.players[puristPlayer].hand = purist.sideboard.coinPile.splice(0, 2);
    for (const cardId of purist.sideboard.slots) {
      const territoryId = contentPack.cards.territoryCards.find((card) => card.id === cardId)!.territoryId;
      purist.territories[territoryId].controller = undefined;
    }
    expect(() => applyAction(purist, { type: "end.draw", playerId: puristPlayer, choice: { coin: true } })).toThrow(/two Coin/);

    let cityShy = seated(["pocket_2_alien_landing"]);
    const shyPlayer = active(cityShy);
    cityShy.factionWeaknesses[cityShy.players[shyPlayer].factionId!] = "city_shy";
    cityShy.phase = "expand_attack";
    cityShy.territories.alaska = { controller: shyPlayer, troops: 5, scars: [] };
    cityShy.territories.northwest_territory = { troops: 0, city: { type: "minor", population: 1 }, scars: [] };
    cityShy = applyAction(cityShy, { type: "attack.expand", playerId: shyPlayer, from: "alaska", to: "northwest_territory", troops: 3 });
    expect(cityShy.territories.northwest_territory.troops).toBe(1);

    let shortSighted = seated(["pocket_2_alien_landing"]);
    const shortPlayer = active(shortSighted);
    shortSighted.factionWeaknesses[shortSighted.players[shortPlayer].factionId!] = "short_sighted";
    shortSighted.phase = "maneuver";
    shortSighted.territories.alaska = { controller: shortPlayer, troops: 3, scars: [] };
    shortSighted.territories.northwest_territory = { controller: shortPlayer, troops: 1, scars: [] };
    shortSighted.territories.alberta = { controller: shortPlayer, troops: 1, scars: [] };
    shortSighted.territories.ontario = { controller: shortPlayer, troops: 1, scars: [] };
    expect(() => applyAction(shortSighted, { type: "maneuver.move", playerId: shortPlayer, from: "alaska", to: "ontario", count: 1 })).toThrow(/one territory/);
  });

  it("plays a Weakness Scar onto a faction and consumes the physical card", () => {
    let state = seated(["pocket_2_alien_landing"]);
    const holder = active(state);
    const targetFaction = "khan_industries"; // a non-Alien faction need not be playing this game
    state.players[holder].scarHand = [{ instanceId: "weakness_cautious#1", scarId: "weakness_cautious" }];
    state.players[holder].scarCardCount = 1;
    state = applyAction(state, { type: "weakness.play", playerId: holder, scarInstanceId: "weakness_cautious#1", factionId: targetFaction });
    expect(state.factionWeaknesses[targetFaction]).toBe("cautious");
    expect(state.players[holder].scarHand).toEqual([]);
    expect(state.log.some((event) => event.type === "ScarPlayed" && event.data?.factionId === targetFaction)).toBe(true);

    const rejected = seated(["pocket_2_alien_landing"]);
    const rejectedHolder = active(rejected);
    rejected.players[rejectedHolder].scarHand = [{ instanceId: "weakness_cautious#1", scarId: "weakness_cautious" }];
    expect(() => applyAction(rejected, {
      type: "weakness.play", playerId: rejectedHolder, scarInstanceId: "weakness_cautious#1", factionId: "aliens",
    })).toThrow(/non-Alien/);
  });

  it("includes Alien Island's Territory card in later games and honors permanent destruction", () => {
    const campaign = initialCampaign("Alien Card QA");
    campaign.unlockedModules = ["pocket_2_alien_landing"];
    campaign.alienIsland = { territoryId: "alien_island", name: "Arrival", connections: ["brazil", "indonesia"] };
    let state = createGame({ gameId: "alien-card", seed: 976, players: PLAYERS, campaign });
    expect([...state.sideboard.slots, ...state.sideboard.territoryDeck]).toContain("alien_island_resource");
    expect(state.alienAlliancePlayerId).toBeUndefined();

    campaign.board.cardModifications.push({ cardId: "alien_island_resource", destroyed: true });
    state = createGame({ gameId: "alien-card-destroyed", seed: 977, players: PLAYERS, campaign });
    expect([...state.sideboard.slots, ...state.sideboard.territoryDeck]).not.toContain("alien_island_resource");
    expect(state.sideboard.destroyed).toContain("alien_island_resource");
  });

  it("executes Die Humans, persists its Ruin, and treats the Ruin as a rebuildable mark", () => {
    let state = seated(["pocket_2_alien_landing"]);
    const playerId = active(state);
    state.players[playerId].factionId = "aliens";
    state.territories.northwest_territory = {
      controller: state.turnOrder[1], troops: 4, hqFaction: state.players[state.turnOrder[1]].factionId,
      city: { type: "minor", population: 1 }, scars: [],
    };
    state = setPendingEvent(state, "pocket_2_alien_landing:event:ruins-1", "Die Humans", "pocket_2_alien_landing");
    state = applyAction(state, { type: "event.resolve", playerId, destination: "box", resolution: { kind: "alienRuins", territoryId: "northwest_territory" } });
    expect(state.territories.northwest_territory).toMatchObject({ troops: 0, ruin: true, controller: undefined, hqFaction: undefined });
    expect(state.territories.northwest_territory.city).toBeUndefined();
    expect(isLegalStart(state, "northwest_territory")).toBe(false);

    state.phase = "game_over";
    state.winner = playerId;
    state.rewards = { order: [playerId], nextIdx: 0, committed: false };
    state = applyAction(state, { type: "reward.choose", playerId, reward: { kind: "found_major_city", territoryId: "northwest_territory", name: "Phoenix" } });
    expect(state.territories.northwest_territory.ruin).toBeUndefined();
    expect(state.territories.northwest_territory.city?.name).toBe("Phoenix");
  });

  it("discards Die Humans when no Alien player can ruin a city", () => {
    let state = seated(["pocket_2_alien_landing"]);
    const playerId = active(state);
    state = setPendingEvent(state, "pocket_2_alien_landing:event:ruins-1", "Die Humans", "pocket_2_alien_landing");
    state = applyAction(state, { type: "event.resolve", playerId, destination: "discard" });
    expect(state.legacyCards.eventDiscard.at(-1)?.title).toBe("Die Humans");
  });
});

describe("sourced Pack 4 mechanics", () => {
  it("derives a unique playing Lead Faction, grants its World Capital troops, and lets it choose the opening Mission", () => {
    const campaign = initialCampaign("Lead QA");
    campaign.gameNumber = 10;
    campaign.unlockedModules = ["pack_3_homelands_missions", "pack_4_lead_faction_private_missions"];
    campaign.worldCapitalTerritoryId = "middle_east";
    campaign.board.cities.push({ territoryId: "middle_east", type: "world_capital", name: "Unity", foundedByPlayerId: "u2" });
    campaign.factionHistory.khan_industries = [
      { gameNumber: 2, playerId: "u1", playerName: "Ada", startingTerritoryId: "brazil", result: "won" },
      { gameNumber: 7, playerId: "u2", playerName: "Bryn", startingTerritoryId: "alaska", result: "won" },
    ];
    campaign.factionHistory.die_mechaniker = [
      { gameNumber: 8, playerId: "u3", playerName: "Cy", startingTerritoryId: "western_australia", result: "won" },
    ];
    let state = createGame({ gameId: "lead-pack4", seed: 966, players: PLAYERS, campaign });
    const factions = ["khan_industries", "die_mechaniker", "saharan_republic"];
    for (let index = 0; index < PLAYERS.length; index++) {
      const playerId = state.setup!.chooserOrder[state.setup!.nextIdx];
      const faction = contentPack.factions.find((candidate) => candidate.id === factions[index])!;
      state = applyAction(state, {
        type: "setup.choose", playerId, factionId: faction.id, territoryId: STARTS[index],
        powerId: state.factionPowers[faction.id] ? undefined : faction.startingPowers[0],
      });
    }
    const lead = Object.values(state.players).find((player) => player.factionId === "khan_industries")!;
    expect(state.leadFactionId).toBe("khan_industries");
    expect(state.territories.middle_east).toMatchObject({ controller: lead.id, troops: 3 });
    expect(state.territories.middle_east.hqFaction).toBeUndefined();
    expect(state.missionChoice?.playerId).toBe(lead.id);
    expect(state.legacyCards.activeMission).toBeUndefined();
    const selected = state.legacyCards.missionDeck.find((mission) => mission.title === "Urban Troop Surge")!;
    state = applyAction(state, { type: "mission.choose", playerId: lead.id, missionId: selected.id });
    expect(state.legacyCards.activeMission?.id).toBe(selected.id);
    expect(state.missionChoice).toBeUndefined();
  });

  it("has no Lead Faction on a wins tie, leaving the World Capital empty and selecting the Mission randomly", () => {
    const campaign = initialCampaign("Lead tie QA");
    campaign.gameNumber = 10;
    campaign.unlockedModules = ["pack_3_homelands_missions", "pack_4_lead_faction_private_missions"];
    campaign.worldCapitalTerritoryId = "middle_east";
    campaign.board.cities.push({ territoryId: "middle_east", type: "world_capital", name: "Unity", foundedByPlayerId: "u2" });
    campaign.factionHistory.khan_industries = [
      { gameNumber: 2, playerId: "u1", playerName: "Ada", startingTerritoryId: "brazil", result: "won" },
    ];
    campaign.factionHistory.die_mechaniker = [
      { gameNumber: 8, playerId: "u3", playerName: "Cy", startingTerritoryId: "western_australia", result: "won" },
    ];
    let state = createGame({ gameId: "lead-tie-pack4", seed: 967, players: PLAYERS, campaign });
    const factions = ["khan_industries", "die_mechaniker", "saharan_republic"];
    for (let index = 0; index < PLAYERS.length; index++) {
      const playerId = state.setup!.chooserOrder[state.setup!.nextIdx];
      const faction = contentPack.factions.find((candidate) => candidate.id === factions[index])!;
      state = applyAction(state, {
        type: "setup.choose", playerId, factionId: faction.id, territoryId: STARTS[index],
        powerId: state.factionPowers[faction.id] ? undefined : faction.startingPowers[0],
      });
    }
    expect(state.leadFactionId).toBeUndefined();
    expect(state.territories.middle_east.troops).toBe(0);
    expect(state.territories.middle_east.controller).toBeUndefined();
    expect(state.missionChoice).toBeUndefined();
    expect(state.legacyCards.activeMission).toBeTruthy();
  });

  it.each([
    ["wide-border", (state: GameState, playerId: string) => { state.privateMissionProgress.wideBorderAtStart = true; }],
    ["forced-occupation", (state: GameState, playerId: string) => { state.privateMissionProgress.forcedOccupation = true; }],
    ["guerilla-warfare", (state: GameState, playerId: string) => {
      state.territories.alaska.scars = ["bunker"];
      state.territories.alaska.controller = playerId;
      state.territories.brazil.scars = ["mercenary"];
      state.territories.brazil.controller = playerId;
    }],
    ["advanced-training", (state: GameState, playerId: string) => { state.privateMissionProgress.tradedResources = 10; }],
    ["urban-troop-surge", (state: GameState, playerId: string) => {
      state.territories.middle_east = { controller: playerId, troops: 1, scars: [], city: { type: "world_capital", population: 5 } };
      for (const territoryId of ["alaska", "brazil", "western_australia"]) {
        state.territories[territoryId].controller = playerId;
        state.territories[territoryId].city = { type: "major", population: 2 };
      }
    }],
    ["advanced-tactics", (state: GameState, playerId: string) => { state.privateMissionProgress.highValueTerritoryCards = 2; }],
  ] as const)("validates and completes the %s faction mission once per game", (slug, satisfy) => {
    let state = seated(["pack_4_lead_faction_private_missions"]);
    const playerId = active(state);
    const factionId = state.players[playerId].factionId!;
    const mission: LegacyCard = {
      id: `pack_4_lead_faction_private_missions:privateMission:${slug}`,
      sourceModuleId: "pack_4_lead_faction_private_missions",
      title: slug,
      text: slug,
      reward: 1,
    };
    state.capturedPrivateMissions[factionId] = mission;
    state.phase = "end_turn";
    expect(() => applyAction(state, { type: "privateMission.activate", playerId, claimantPlayerId: playerId })).toThrow(/condition/);
    satisfy(state, playerId);
    const stars = state.players[playerId].redStarTokens;
    state = applyAction(state, { type: "privateMission.activate", playerId, claimantPlayerId: playerId });
    expect(state.players[playerId].redStarTokens).toBe(stars + 1);
    expect(state.privateMissionsUsed).toContain(factionId);
  });
});

describe("sourced Pack 1 and Pack 3 cards", () => {
  it.each([
    { players: 3, troops: [6, 8, 10], coins: [0, 1, 2] },
    { players: 4, troops: [6, 8, 8, 10], coins: [0, 0, 1, 2] },
    { players: 5, troops: [6, 8, 8, 10, 10], coins: [0, 0, 1, 1, 2] },
  ])("uses only the $players-player-marked advanced draft cards", ({ players, troops, coins }) => {
    const campaign = initialCampaign("Draft pool QA");
    campaign.unlockedModules.push("pack_1_advanced_draft_biohazards");
    const state = createGame({ gameId: `draft-${players}`, seed: 77, players: PLAYERS.concat([
      { id: "u4", name: "Dee" }, { id: "u5", name: "Eli" },
    ]).slice(0, players), campaign });
    expect(state.advancedDraft!.available.turnOrder).toEqual(Array.from({ length: players }, (_, index) => index + 1));
    expect(state.advancedDraft!.available.placementOrder).toEqual(Array.from({ length: players }, (_, index) => index + 1));
    expect(state.advancedDraft!.available.startingTroops).toEqual(troops);
    expect(state.advancedDraft!.available.startingCoinCards).toEqual(coins);
  });

  it("resolves Resistance automatically and rejects an unearned public Mission", () => {
    let state = seated(["pack_3_homelands_missions"]);
    const playerId = active(state);
    state.territories.alaska.city = { type: "minor", population: 1 };
    state.territories.alaska.troops = 2;
    state = setPendingEvent(state, "pack_1_advanced_draft_biohazards:event:resistance-1", "Resistance", "pack_1_advanced_draft_biohazards");
    state = applyAction(state, { type: "event.resolve", playerId, destination: "discard", resolution: { kind: "resistance" } });
    expect(state.territories.alaska.troops).toBe(1);

    const mission: LegacyCard = {
      id: "pack_3_homelands_missions:mission:reign-of-terror", sourceModuleId: "pack_3_homelands_missions",
      title: "Reign of Terror", text: "Conquer nine territories", reward: 1,
    };
    state.phase = "end_turn";
    state.activeIdx = state.turnOrder.indexOf(playerId);
    state.legacyCards.activeMission = mission;
    expect(() => applyAction(state, { type: "mission.complete", playerId, claimantPlayerId: playerId, reward: 1 })).toThrow(/condition/);
  });

  it("executes Fortify, Control the People, Riots, and Join the Cause", () => {
    let fortify = seated();
    const leader = active(fortify);
    fortify.territories.alaska.city = { type: "major", population: 2 };
    fortify.territories.alaska.troops = 3;
    fortify = setPendingEvent(fortify, "pack_1_advanced_draft_biohazards:event:fortify-1", "Fortify", "pack_1_advanced_draft_biohazards");
    fortify = applyAction(fortify, {
      type: "event.resolve", playerId: leader, destination: "discard",
      resolution: { kind: "reinforceCities", placements: [{ territoryId: "alaska", count: 2 }] },
    });
    expect(fortify.territories.alaska.troops).toBe(5);

    let control = seated();
    const controller = active(control);
    control.territories.alaska.city = { type: "major", population: 2 };
    control = setPendingEvent(control, "pack_1_advanced_draft_biohazards:event:control-the-people-1", "Control the People", "pack_1_advanced_draft_biohazards");
    const before = control.territories.alaska.troops;
    control = applyAction(control, { type: "event.resolve", playerId: controller, destination: "discard", resolution: { kind: "controlPeopleTroops", territoryId: "alaska" } });
    expect(control.territories.alaska.troops).toBe(before + 5);

    let riots = seated();
    riots.territories.alaska.city = { type: "major", population: 2 };
    riots.territories.alaska.troops = 1;
    riots = setPendingEvent(riots, "pack_1_advanced_draft_biohazards:event:riots", "Riots", "pack_1_advanced_draft_biohazards");
    riots = applyAction(riots, { type: "event.resolve", playerId: active(riots), destination: "discard", resolution: { kind: "riots" } });
    expect(riots.log.some((event) => event.type === "RiotTested" && event.data?.territory === "alaska")).toBe(true);

    let cause = seated(["pack_3_homelands_missions"]);
    const causeLeader = active(cause);
    cause.territories.alaska.city = { type: "major", population: 2 };
    cause = setPendingEvent(cause, "pack_3_homelands_missions:event:join-the-cause-1", "Join the Cause", "pack_3_homelands_missions");
    const causeBefore = cause.territories.alaska.troops;
    cause = applyAction(cause, {
      type: "event.resolve", playerId: causeLeader, destination: "discard",
      resolution: { kind: "joinCauseTroops", placements: [{ territoryId: "alaska", count: 3 }] },
    });
    expect(cause.territories.alaska.troops).toBe(causeBefore + 3);
  });

  it("executes Fallout and Agent of Chaos Event effects", () => {
    let fallout = seated(["pocket_1_nuclear_war_mutants"]);
    const human = active(fallout);
    fallout.territories.alaska.scars = ["fallout"];
    fallout.territories.northwest_territory = { controller: human, troops: 6, scars: [] };
    fallout = setPendingEvent(fallout, "pocket_1_nuclear_war_mutants:event:fallout-1", "Fallout", "pocket_1_nuclear_war_mutants");
    fallout = applyAction(fallout, { type: "event.resolve", playerId: human, destination: "box", resolution: { kind: "fallout" } });
    expect(fallout.territories.northwest_territory.troops).toBeLessThan(6);

    let chaos = seated(["pocket_1_nuclear_war_mutants"]);
    const mutant = active(chaos);
    chaos.players[mutant].factionId = "mutants";
    const stars = chaos.players[mutant].redStarTokens;
    chaos = setPendingEvent(chaos, "pocket_1_nuclear_war_mutants:event:agent-of-chaos-1", "Agent of Chaos", "pocket_1_nuclear_war_mutants");
    chaos = applyAction(chaos, { type: "event.resolve", playerId: mutant, destination: "discard", resolution: { kind: "agentOfChaos" } });
    expect(chaos.players[mutant].redStarTokens).toBe(stars + 1);
  });

  it("executes Beam Down and lets Mysterious Island trigger a second Event", () => {
    let reinforcements = seated(["pocket_2_alien_landing"]);
    const alien = active(reinforcements);
    reinforcements.players[alien].factionId = "aliens";
    reinforcements.territories.northwest_territory = { troops: 0, city: { type: "minor", population: 1 }, scars: [] };
    reinforcements = setPendingEvent(reinforcements, "pocket_2_alien_landing:event:reinforcements-1", "Beam Down", "pocket_2_alien_landing");
    reinforcements = applyAction(reinforcements, {
      type: "event.resolve", playerId: alien, destination: "discard",
      resolution: { kind: "alienReinforcements", territoryId: "northwest_territory" },
    });
    expect(reinforcements.territories.northwest_territory).toMatchObject({ controller: alien, troops: 5 });

    let island = seated(["pocket_2_alien_landing"]);
    const islandController = active(island);
    island.alienIsland = { territoryId: "alien_island", name: "Arrival", connections: ["brazil", "indonesia"] };
    island.territories.alien_island = { controller: islandController, troops: 4, scars: [] };
    const cardId = island.sideboard.slots[1]!;
    const evenCard = contentPack.cards.territoryCards.find((card) =>
      !island.sideboard.slots.includes(card.id)
      && (island.cardModifications[card.id]?.resources ?? card.resources) % 2 === 0)!;
    island.sideboard.territoryDeck = [evenCard.id, ...island.sideboard.territoryDeck.filter((id) => id !== evenCard.id)];
    island.legacyCards.eventDeck = [{ id: "pocket_1_nuclear_war_mutants:event:agent-of-chaos-1", title: "Agent of Chaos", text: "", sourceModuleId: "pocket_1_nuclear_war_mutants" }];
    island = setPendingEvent(island, "pocket_2_alien_landing:event:mysterious-island-1", "Mysterious Island", "pocket_2_alien_landing");
    island = applyAction(island, { type: "event.resolve", playerId: islandController, destination: "discard", resolution: { kind: "alienIslandCard", slot: 1 } });
    expect(island.players[islandController].hand).toContain(cardId);
    expect(island.legacyCards.pendingEvent?.title).toBe("Agent of Chaos");
    expect(island.phase).toBe("end_turn");
  });
});

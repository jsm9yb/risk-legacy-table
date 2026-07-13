import { describe, expect, it } from "vitest";
import { applyGameToCampaign } from "./campaign.ts";
import { createGame, waitingOn } from "./engine.ts";
import { neighborsOf } from "./topology.ts";
import {
  advanceCampaignScenarioToFirstTurn,
  CAMPAIGN_SCENARIO_IDS,
  completeCampaignScenarioGame,
  createCampaignScenarios,
} from "./campaignScenarios.ts";

const players = [
  { id: "qa1", name: "Ada" },
  { id: "qa2", name: "Lin" },
  { id: "qa3", name: "Rex" },
];

describe("campaign QA scenario matrix", () => {
  it("provides a stable, unique scenario for every declared campaign stage", () => {
    const scenarios = createCampaignScenarios();
    expect(scenarios.map((scenario) => scenario.id)).toEqual(CAMPAIGN_SCENARIO_IDS);
    expect(new Set(scenarios.map((scenario) => scenario.campaign.worldName)).size).toBe(scenarios.length);
    expect(scenarios.length).toBeGreaterThanOrEqual(18);
  });

  it("creates the next real game from every startable snapshot and preserves the legacy state", () => {
    for (const scenario of createCampaignScenarios()) {
      const create = () => createGame({
        gameId: `qa-${scenario.id}`,
        seed: 1000 + scenario.campaign.gameNumber,
        players,
        campaign: scenario.campaign,
      });
      if (scenario.expectedStart === "blocked_on_import") {
        expect(create, scenario.id).toThrow(/advanced setup draft.*host-entered/i);
        continue;
      }
      const game = create();
      expect(game.gameNumber, scenario.id).toBe(scenario.campaign.gameNumber + 1);
      expect(game.unlockedModules, scenario.id).toEqual(scenario.campaign.unlockedModules);
      expect(game.log.some((event) => event.type === "CampaignLegacyApplied"), scenario.id).toBe(true);
      expect(game.sideboard.slots.filter(Boolean), scenario.id).toHaveLength(4);
      if (scenario.campaign.contentRequired.length > 0) {
        expect(game.contentRequired, scenario.id).toEqual(scenario.campaign.contentRequired);
        expect(waitingOn(game), scenario.id).toBeUndefined();
      }
    }
  });

  it("clears sealed-content gates and completes setup in every startable campaign", () => {
    for (const scenario of createCampaignScenarios()) {
      if (scenario.expectedStart === "blocked_on_import") continue;
      const initial = createGame({
        gameId: `qa-flow-${scenario.id}`,
        seed: 4000 + scenario.campaign.gameNumber,
        players,
        campaign: scenario.campaign,
      });
      const flow = advanceCampaignScenarioToFirstTurn(initial);
      const expectedContent = scenario.campaign.contentRequired.flatMap((requirement) =>
        requirement.items.map((item) => `${requirement.moduleId}.${item}`));

      expect(flow.suppliedContent, scenario.id).toEqual(expectedContent);
      expect(flow.setupChoices, scenario.id).toHaveLength(players.length);
      expect(flow.state.contentRequired, scenario.id).toEqual([]);
      expect(flow.state.phase, scenario.id).toBe("start_turn");
      expect(flow.state.log.some((event) => event.type === "UnusedFactionsRecorded"), scenario.id).toBe(true);
      const seatedFactions = Object.values(flow.state.players).map((player) => player.factionId);
      if (scenario.campaign.unlockedModules.includes("pocket_1_nuclear_war_mutants")) {
        expect(seatedFactions, scenario.id).toContain("mutants");
      }
      if (scenario.campaign.unlockedModules.includes("pocket_2_alien_landing")) {
        expect(seatedFactions, scenario.id).toContain("aliens");
      }
      for (const player of Object.values(flow.state.players)) {
        expect(player.factionId, scenario.id).toBeTruthy();
        expect(Object.values(flow.state.territories).some((territory) =>
          territory.controller === player.id && territory.hqFaction === player.factionId), scenario.id).toBe(true);
      }
    }
  });

  it("survives a persisted JSON round trip at every campaign boundary", () => {
    for (const scenario of createCampaignScenarios()) {
      const restored = JSON.parse(JSON.stringify(scenario.campaign));
      expect(restored, scenario.id).toEqual(scenario.campaign);
      const create = () => createGame({
        gameId: `qa-restored-${scenario.id}`,
        seed: 5000 + scenario.campaign.gameNumber,
        players,
        campaign: restored,
      });
      if (scenario.expectedStart === "blocked_on_import") {
        expect(create, scenario.id).toThrow(/advanced setup draft.*host-entered/i);
      } else {
        expect(advanceCampaignScenarioToFirstTurn(create()).state.phase, scenario.id).toBe("start_turn");
      }
    }
  });

  it("wins, folds, and starts the following game from every startable campaign boundary", () => {
    for (const scenario of createCampaignScenarios()) {
      if (scenario.expectedStart === "blocked_on_import") continue;
      const firstTurn = advanceCampaignScenarioToFirstTurn(createGame({
        gameId: `qa-fold-${scenario.id}`,
        seed: 6000 + scenario.campaign.gameNumber,
        players,
        campaign: scenario.campaign,
      })).state;
      const finished = completeCampaignScenarioGame(firstTurn);
      expect(finished.winner, scenario.id).toBe(finished.turnOrder[0]);
      expect(finished.rewards?.committed ?? true, scenario.id).toBe(true);

      const folded = applyGameToCampaign(scenario.campaign, finished);
      expect(folded.gameNumber, scenario.id).toBe(finished.gameNumber);
      expect(folded.unlockedModules, scenario.id).toEqual(finished.unlockedModules);
      expect(folded.hostContent, scenario.id).toEqual(finished.hostContent);
      expect(folded.factionComebackPowers, scenario.id).toEqual(finished.comebackPowers);
      expect(folded.factionPrivateMissions, scenario.id).toEqual(finished.capturedPrivateMissions);
      expect(folded.factionMissilePowers, scenario.id).toEqual(finished.factionMissilePowers);
      expect(folded.factionWeaknesses, scenario.id).toEqual(finished.factionWeaknesses);
      expect(folded.mutantEvolution, scenario.id).toEqual(finished.mutantEvolution);
      expect(folded.mutantEvolutionChoices, scenario.id).toEqual(finished.mutantEvolutionChoices);
      expect(folded.bringerOfNuclearFireFactionId, scenario.id).toBe(finished.bringerOfNuclearFireFactionId);
      expect(folded.alienCollaboratorFactionId, scenario.id).toBe(finished.alienCollaboratorFactionId);
      expect(folded.alienIsland, scenario.id).toEqual(finished.alienIsland);
      expect(folded.board.customConnections, scenario.id).toEqual(finished.customConnections);

      const following = createGame({
        gameId: `qa-following-${scenario.id}`,
        seed: 7000 + folded.gameNumber,
        players,
        campaign: JSON.parse(JSON.stringify(folded)),
      });
      expect(following.gameNumber, scenario.id).toBe(finished.gameNumber + 1);
      expect(following.unlockedModules, scenario.id).toEqual(folded.unlockedModules);
      expect(following.factionMissilePowers, scenario.id).toEqual(folded.factionMissilePowers);
      expect(following.factionWeaknesses, scenario.id).toEqual(folded.factionWeaknesses);
      expect(following.mutantEvolution, scenario.id).toEqual(folded.mutantEvolution);
      expect(following.mutantEvolutionChoices, scenario.id).toEqual(folded.mutantEvolutionChoices);
      expect(following.bringerOfNuclearFireFactionId, scenario.id).toBe(folded.bringerOfNuclearFireFactionId);
      expect(following.alienCollaboratorFactionId, scenario.id).toBe(folded.alienCollaboratorFactionId);
      expect(following.alienIsland, scenario.id).toEqual(folded.alienIsland);
      expect(following.customConnections, scenario.id).toEqual(folded.board.customConnections);
    }
  });

  it("covers signature setup, durable board changes, all six official unlocks, and post-15 play", () => {
    const byId = Object.fromEntries(createCampaignScenarios().map((scenario) => [scenario.id, scenario]));

    const game2 = createGame({ gameId: "qa-game-2", seed: 2002, players, campaign: byId.returning_game_2.campaign });
    expect(game2.players.qa1).toMatchObject({ missiles: 1, redStarTokens: 0 });
    expect(game2.players.qa2).toMatchObject({ missiles: 0, redStarTokens: 1 });

    const developed = createGame({ gameId: "qa-developed", seed: 2006, players, campaign: byId.developed_board_game_6.campaign });
    expect(developed.territories.ural.scars).toContain("bunker");
    expect(developed.territories.brazil.fortification?.remaining).toBe(6);
    expect(developed.sideboard.destroyed).toContain("12");

    const allUnlocks = byId.both_pockets_active.campaign.unlockedModules;
    expect(allUnlocks).toEqual(expect.arrayContaining([
      "pack_1_advanced_draft_biohazards",
      "pack_2_comeback_mercenaries",
      "pack_3_homelands_missions",
      "pack_4_lead_faction_private_missions",
      "pocket_1_nuclear_war_mutants",
      "pocket_2_alien_landing",
    ]));

    const post15 = createGame({ gameId: "qa-game-16", seed: 2016, players, campaign: byId.completed_game_15.campaign });
    expect(post15.gameNumber).toBe(16);
    expect(post15.territories.middle_east.city?.type).toBe("world_capital");

    const pack4 = advanceCampaignScenarioToFirstTurn(createGame({
      gameId: "qa-pack-4",
      seed: 2010,
      players,
      campaign: byId.world_capital_pack_4_active.campaign,
    })).state;
    const leadPlayer = Object.values(pack4.players).find((player) => player.factionId === "khan_industries")!;
    expect(pack4.territories.middle_east).toMatchObject({
      controller: leadPlayer.id,
      troops: 3,
      city: { type: "world_capital" },
    });
    expect(pack4.territories.middle_east.hqFaction).toBeUndefined();
  });

  it("pins every snapshot to its intended rulebook unlock boundary", () => {
    const byId = Object.fromEntries(createCampaignScenarios().map((scenario) => [scenario.id, scenario]));

    const fresh = byId.fresh_game_1.campaign;
    expect(fresh).toMatchObject({ gameNumber: 0, unlockedModules: [], contentRequired: [], foundedMinorCities: 0 });
    expect(fresh.board.cardModifications.reduce((stickers, modification) =>
      stickers + ((modification.resources ?? 1) - 1), 0)).toBe(12);

    const returning = byId.returning_game_2.campaign;
    expect(returning).toMatchObject({ gameNumber: 1, signatures: { qa1: 1, qa2: 0, qa3: 0 } });

    const developed = byId.developed_board_game_6.campaign;
    expect(developed).toMatchObject({ gameNumber: 5, foundedMinorCities: 2 });
    expect(developed.board).toMatchObject({
      continentBonusMarks: { asia: -1, south_america: 1 },
      continentNames: { north_america: { name: "First Reach" }, australia: { name: "Southern Shield" } },
    });

    const pack1Pending = byId.pack_1_import_pending.campaign;
    expect(pack1Pending).toMatchObject({ gameNumber: 6, foundedMinorCities: 9 });
    expect(pack1Pending.board.cities.filter((city) => city.type === "minor")).toHaveLength(9);
    expect(pack1Pending.contentRequired).toEqual([{
      moduleId: "pack_1_advanced_draft_biohazards",
      items: ["draft", "events"],
    }]);
    expect(byId.pack_1_active.campaign.contentRequired).toEqual([]);
    expect(byId.pack_1_active.campaign.hostContent).toHaveProperty("pack_1_advanced_draft_biohazards.draft");

    const pack2Pending = byId.pack_2_import_pending.campaign;
    expect(pack2Pending.unlockedModules).toContain("pack_2_comeback_mercenaries");
    expect(pack2Pending.contentRequired).toEqual([{
      moduleId: "pack_2_comeback_mercenaries",
      items: ["powers"],
    }]);
    expect(byId.pack_2_active.campaign.hostContent).toHaveProperty("pack_2_comeback_mercenaries.powers");
    expect(byId.pack_2_active.campaign.factionComebackPowers.khan_industries).toMatchObject({ title: "Resourceful" });
    const pack2Game = createGame({ gameId: "qa-pack2-power", seed: 2004, players, campaign: byId.pack_2_active.campaign });
    expect(pack2Game.comebackPowers.khan_industries).toMatchObject({ title: "Resourceful" });

    const pack3Ready = byId.pack_3_trigger_ready.campaign;
    expect(pack3Ready.signatures).toEqual({ qa1: 1, qa2: 1, qa3: 1 });
    expect(pack3Ready.unlockedModules).not.toContain("pack_3_homelands_missions");
    const pack3Pending = byId.pack_3_import_pending.campaign;
    expect(pack3Pending.signatures.qa1).toBe(2);
    expect(pack3Pending.unlockedModules).toContain("pack_3_homelands_missions");
    expect(pack3Pending.contentRequired).toContainEqual({
      moduleId: "pack_3_homelands_missions",
      items: ["missions", "events"],
    });

    const pack4Pending = byId.pack_4_import_pending.campaign;
    expect(pack4Pending).toMatchObject({
      worldCapitalTerritoryId: "middle_east",
      leadFactionId: "khan_industries",
    });
    expect(pack4Pending.unlockedModules).toContain("pack_4_lead_faction_private_missions");
    expect(pack4Pending.contentRequired).toContainEqual({
      moduleId: "pack_4_lead_faction_private_missions",
      items: ["privateMissions"],
    });

    const pack4 = byId.world_capital_pack_4_active.campaign;
    expect(pack4).toMatchObject({ worldCapitalTerritoryId: "middle_east", leadFactionId: "khan_industries" });
    expect(pack4.unlockedModules).toContain("pack_4_lead_faction_private_missions");
    expect(pack4.board.cities).toContainEqual(expect.objectContaining({
      territoryId: "middle_east", type: "world_capital",
    }));

    const privateCaptured = byId.pack_4_private_mission_captured.campaign;
    expect(privateCaptured.factionPrivateMissions.khan_industries).toMatchObject({ title: "QA Private Mission One" });
    const privateGame = createGame({ gameId: "qa-private", seed: 2011, players, campaign: privateCaptured });
    expect(privateGame.capturedPrivateMissions.khan_industries).toMatchObject({ title: "QA Private Mission One" });
    expect(privateGame.legacyCards.missionDeck.map((mission) => mission.title)).toContain("QA Private Mission Two");
    expect(privateGame.privateMissionsUsed).toEqual([]);

    const pocket1Pending = byId.pocket_1_import_pending.campaign;
    expect(pocket1Pending.unlockedModules).toContain("pocket_1_nuclear_war_mutants");
    expect(pocket1Pending.contentRequired).toContainEqual({
      moduleId: "pocket_1_nuclear_war_mutants",
      items: ["missilePowers", "events", "faction"],
    });
    expect(pocket1Pending.board.scars).toContainEqual({ territoryId: "kamchatka", scarId: "fallout" });

    const pocket1Active = byId.both_pockets_active.campaign;
    expect(pocket1Active.factionMissilePowers.khan_industries).toBe("rally");
    expect(pocket1Active.bringerOfNuclearFireFactionId).toBe("enclave_of_the_bear");
    expect(pocket1Active.mutantEvolutionChoices).toEqual(["offensive", "bodies"]);
    expect(pocket1Active.mutantEvolution).toBe("unnatural_strength");

    const pocket2Pending = byId.pocket_2_import_pending.campaign;
    expect(pocket2Pending.unlockedModules).toContain("pocket_2_alien_landing");
    expect(pocket2Pending.contentRequired).toContainEqual({
      moduleId: "pocket_2_alien_landing",
      items: ["events", "scars", "faction"],
    });
    expect(pocket2Pending.alienIsland).toBeUndefined();

    const pockets = byId.both_pockets_active.campaign;
    expect(pockets.unlockedModules).toEqual(expect.arrayContaining([
      "pocket_1_nuclear_war_mutants",
      "pocket_2_alien_landing",
    ]));
    expect(pockets.board.scars).toContainEqual({ territoryId: "kamchatka", scarId: "fallout" });
    expect(pockets.alienCollaboratorFactionId).toBe("khan_industries");
    expect(pockets.factionWeaknesses.imperial_balkania).toBe("cautious");
    expect(pockets.contentRequired).toEqual([]);

    const alienCampaign = byId.alien_island_active.campaign;
    expect(alienCampaign.alienIsland).toEqual({ territoryId: "alien_island", name: "Arrival", connections: ["brazil", "indonesia"] });
    const alienGame = createGame({ gameId: "qa-alien-island", seed: 2013, players, campaign: alienCampaign });
    expect(alienGame.territories.alien_island).toMatchObject({ troops: 0, scars: [] });
    expect(neighborsOf(alienGame, "alien_island")).toEqual(["brazil", "indonesia"]);
    expect(neighborsOf(alienGame, "brazil")).toContain("alien_island");

    expect(byId.completed_game_15.campaign).toMatchObject({
      gameNumber: 15,
      completedWorld: { namedByPlayerId: "qa1", completedAtGame: 15 },
    });
    expect(byId.post_campaign_game_16.campaign).toMatchObject({ gameNumber: 16 });
  });

  it("returns fresh snapshots so one test campaign cannot mutate another", () => {
    const first = createCampaignScenarios();
    first[0].campaign.signatures.qa1 = 99;
    const second = createCampaignScenarios();
    expect(second[0].campaign.signatures.qa1).toBeUndefined();
  });
});

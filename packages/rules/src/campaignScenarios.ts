import { contentPack, factionDefinitions } from "@risk/content";
import { manifest } from "@risk/map";
import { initialCampaign, type CampaignState, type GameResult } from "./campaign.ts";
import { applyAction, isLegalStart, waitingOn } from "./engine.ts";
import type { GameState } from "./types.ts";

export const CAMPAIGN_SCENARIO_IDS = [
  "fresh_game_1",
  "returning_game_2",
  "developed_board_game_6",
  "pack_1_import_pending",
  "pack_1_active",
  "pack_2_import_pending",
  "pack_2_active",
  "pack_3_trigger_ready",
  "pack_3_import_pending",
  "pack_4_import_pending",
  "world_capital_pack_4_active",
  "pack_4_private_mission_captured",
  "pocket_1_import_pending",
  "pocket_2_import_pending",
  "both_pockets_active",
  "alien_island_active",
  "completed_game_15",
  "post_campaign_game_16",
] as const;

export type CampaignScenarioId = typeof CAMPAIGN_SCENARIO_IDS[number];

export interface CampaignScenario {
  id: CampaignScenarioId;
  title: string;
  description: string;
  expectedStart: "starts" | "blocked_on_import";
  campaign: CampaignState;
}

export interface CampaignScenarioFlow {
  state: GameState;
  suppliedContent: string[];
  setupChoices: { playerId: string; factionId: string; territoryId: string }[];
}

/**
 * Finishes a scenario through real victory/reward actions. Direct fixture setup is
 * limited to granting the active player the four cards/tokens needed to exercise
 * the public Red Star victory path deterministically.
 */
export function completeCampaignScenarioGame(initial: GameState): GameState {
  let state = structuredClone(initial);
  const winner = state.turnOrder[0];
  state.players[winner].redStarTokens = 2;
  state.players[winner].hand = ["42", "43", "44", "45"];
  state = applyAction(state, {
    type: "start.buyRedStar",
    playerId: winner,
    cardIds: ["42", "43", "44", "45"],
  });
  if (state.missilePowerChoice) {
    state = applyAction(state, {
      type: "missilePower.choose",
      playerId: state.missilePowerChoice.playerId,
      powerId: state.missilePowerChoice.options[0],
    });
  }
  state = supplyPendingContent(state).state;

  while (state.rewards && !state.rewards.committed) {
    const chooser = waitingOn(state);
    if (!chooser) throw new Error("Campaign scenario reward flow has no active chooser");
    if (chooser === winner) {
      const continentId = manifest.continents
        .find((continent) => !state.continents[continent.id]?.name)?.id;
      if (!continentId) throw new Error("Campaign scenario has no unnamed continent for the winner reward");
      state = applyAction(state, {
        type: "reward.choose",
        playerId: chooser,
        reward: { kind: "name_continent", continentId, name: `QA ${state.gameNumber}` },
      });
    } else {
      state = applyAction(state, { type: "reward.choose", playerId: chooser, reward: { kind: "pass" } });
    }
    state = supplyPendingContent(state).state;
  }
  return state;
}

const basePowers = {
  khan_industries: "territory_card_reinforcement",
  die_mechaniker: "defensive_stand",
  saharan_republic: "unconnected_maneuver",
  enclave_of_the_bear: "total_conquest",
  imperial_balkania: "expansionist_supply",
};

const qaPrivateMission = {
  id: "pack_4_lead_faction_private_missions:privateMission:qa-private-1",
  sourceModuleId: "pack_4_lead_faction_private_missions",
  title: "QA Private Mission One",
  text: "Host-adjudicated private condition.",
};

const qaComebackPower = {
  id: "pack_2_comeback_mercenaries:power:resourceful",
  sourceModuleId: "pack_2_comeback_mercenaries",
  title: "Resourceful",
  text: "Earn a Resource draw after expanding into a city.",
};

function clone(campaign: CampaignState): CampaignState {
  return structuredClone(campaign);
}

function fillResults(campaign: CampaignState, games: number) {
  for (const faction of contentPack.factions) {
    campaign.factionResults[faction.id] = Array.from({ length: games }, () => "unused" as GameResult);
  }
}

function resizeResults(campaign: CampaignState, games: number) {
  for (const faction of contentPack.factions) {
    const results = [...(campaign.factionResults[faction.id] ?? [])].slice(0, games);
    while (results.length < games) results.push("unused");
    campaign.factionResults[faction.id] = results;
  }
}

function markModuleActive(campaign: CampaignState, moduleId: string, content: Record<string, unknown> = {}) {
  if (!campaign.unlockedModules.includes(moduleId)) campaign.unlockedModules.push(moduleId);
  campaign.contentRequired = campaign.contentRequired.filter((entry) => entry.moduleId !== moduleId);
  for (const [item, value] of Object.entries(content)) campaign.hostContent[`${moduleId}.${item}`] = value;
}

/**
 * Exercises the shared in-game gates used by local, network, and simulator play.
 * The returned state has supplied every pending sealed-content item and completed
 * normal faction/HQ setup through the real action API.
 */
export function advanceCampaignScenarioToFirstTurn(initial: GameState): CampaignScenarioFlow {
  const supplied = supplyPendingContent(initial);
  let state = supplied.state;
  const suppliedContent = supplied.suppliedContent;
  const setupChoices: CampaignScenarioFlow["setupChoices"] = [];

  while (state.advancedDraft && !state.advancedDraft.completed) {
    const playerId = waitingOn(state);
    if (!playerId) throw new Error("Campaign scenario draft has no active picker");
    const picks = state.advancedDraft.picks[playerId];
    if (!picks.factionId) {
      const factionId = [
        state.unlockedModules.includes("pocket_2_alien_landing") ? "aliens" : undefined,
        state.unlockedModules.includes("pocket_1_nuclear_war_mutants") ? "mutants" : undefined,
        state.leadFactionId,
        ...state.advancedDraft.available.factions,
      ].find((candidate): candidate is string => !!candidate && state.advancedDraft!.available.factions.includes(candidate))!;
      state = applyAction(state, { type: "draft.pick", playerId, category: "faction", value: factionId });
    } else if (picks.turnOrder === undefined) {
      state = applyAction(state, { type: "draft.pick", playerId, category: "turnOrder", value: state.advancedDraft.available.turnOrder[0] });
    } else if (picks.placementOrder === undefined) {
      state = applyAction(state, { type: "draft.pick", playerId, category: "placementOrder", value: state.advancedDraft.available.placementOrder[0] });
    } else if (picks.startingTroops === undefined) {
      state = applyAction(state, { type: "draft.pick", playerId, category: "startingTroops", value: state.advancedDraft.available.startingTroops[0] });
    } else {
      state = applyAction(state, { type: "draft.pick", playerId, category: "startingCoinCards", value: state.advancedDraft.available.startingCoinCards[0] });
    }
  }

  let setupGuard = state.turnOrder.length + 1;
  while (state.phase === "setup" && setupGuard-- > 0) {
    const playerId = waitingOn(state);
    if (!playerId) throw new Error("Campaign scenario setup has no active chooser");
    const draftedFactionId = state.advancedDraft?.picks[playerId]?.factionId;
    const availableFactions = factionDefinitions(state.unlockedModules);
    const unusedFactions = availableFactions.filter((candidate) =>
      !Object.values(state.players).some((player) => player.factionId === candidate.id));
    const faction = draftedFactionId
      ? availableFactions.find((candidate) => candidate.id === draftedFactionId)
      : unusedFactions.find((candidate) => candidate.id === state.leadFactionId) ?? unusedFactions[0];
    if (!faction) throw new Error("Campaign scenario setup has no available faction");
    const territory = manifest.territories.find((candidate) =>
      isLegalStart(state, candidate.id, true, faction.id));
    if (!territory) throw new Error(`Campaign scenario setup has no legal start for ${faction.id}`);
    setupChoices.push({ playerId, factionId: faction.id, territoryId: territory.id });
    state = applyAction(state, {
      type: "setup.choose",
      playerId,
      factionId: faction.id,
      territoryId: territory.id,
      powerId: state.factionPowers[faction.id] ? undefined : faction.startingPowers[0],
    });
  }

  if (state.phase !== "start_turn") {
    throw new Error(`Campaign scenario did not reach the first turn (phase=${state.phase})`);
  }
  if (state.missionChoice) {
    const mission = state.legacyCards.missionDeck[0];
    if (!mission) throw new Error("Campaign scenario Lead Faction has no Mission to choose");
    state = applyAction(state, {
      type: "mission.choose",
      playerId: state.missionChoice.playerId,
      missionId: mission.id,
    });
  }
  return { state, suppliedContent, setupChoices };
}

function supplyPendingContent(initial: GameState): { state: GameState; suppliedContent: string[] } {
  let state = initial;
  const suppliedContent: string[] = [];
  while (state.contentRequired.length > 0) {
    const requirement = state.contentRequired[0];
    const item = requirement.items[0];
    const key = `${requirement.moduleId}.${item}`;
    state = applyAction(state, {
      type: "module.supplyContent",
      playerId: state.turnOrder[0],
      moduleId: requirement.moduleId,
      item,
      content: `QA host content for ${key}`,
    });
    suppliedContent.push(key);
  }
  return { state, suppliedContent };
}

/**
 * Reusable, deterministic campaign snapshots for engine, UI, server, and manual QA.
 * They intentionally contain no active-game state: each snapshot should be used to
 * create the next game through the real createGame/session path.
 */
export function createCampaignScenarios(worldPrefix = "QA World"): CampaignScenario[] {
  const fresh = initialCampaign(`${worldPrefix} 01 - Fresh`);
  fresh.factionPowerChoices = { ...basePowers };

  const returning = initialCampaign(`${worldPrefix} 02 - Returning`);
  returning.gameNumber = 1;
  returning.signatures = { qa1: 1, qa2: 0, qa3: 0 };
  returning.factionPowerChoices = { ...basePowers };
  fillResults(returning, 1);
  returning.factionResults.khan_industries[0] = "won";
  returning.board.continentNames.north_america = { name: "First Reach", namedBy: "qa1" };

  const developed = initialCampaign(`${worldPrefix} 03 - Developed`);
  developed.gameNumber = 5;
  developed.signatures = { qa1: 2, qa2: 1, qa3: 2 };
  developed.factionPowerChoices = { ...basePowers };
  fillResults(developed, 5);
  developed.factionResults.khan_industries = ["won", "held_on", "unused", "won", "held_on"];
  developed.factionResults.die_mechaniker = ["held_on", "won", "held_on", "unused", "held_on"];
  developed.board.scars = [
    { territoryId: "ural", scarId: "bunker" },
    { territoryId: "peru", scarId: "ammo_shortage" },
  ];
  developed.board.cities = [
    { territoryId: "brazil", type: "major", name: "Port Ada", foundedByPlayerId: "qa1" },
    { territoryId: "japan", type: "minor", name: "Lin Harbor", foundedByPlayerId: "qa2" },
    { territoryId: "eastern_australia", type: "minor", name: "Rex Point", foundedByPlayerId: "qa3" },
  ];
  developed.board.fortifications = [{ territoryId: "brazil", durability: 6 }];
  developed.board.continentNames = {
    north_america: { name: "First Reach", namedBy: "qa1" },
    australia: { name: "Southern Shield", namedBy: "qa3" },
  };
  developed.board.continentBonusMarks = { asia: -1, south_america: 1 };
  developed.board.cardModifications = developed.board.cardModifications
    .map((modification) => modification.cardId === "0" ? { ...modification, resources: 3 } : modification)
    .concat({ cardId: "12", destroyed: true });
  developed.inventories = {
    cancelStickers: 3,
    fortifyMarks: 4,
    majorCities: 4,
    minorCities: 7,
    scarInstances: { bunker: 2, ammo_shortage: 2 },
  };
  developed.foundedMinorCities = 2;

  const pack1Pending = clone(developed);
  pack1Pending.worldName = `${worldPrefix} 04 - Pack 1 Pending`;
  pack1Pending.gameNumber = 6;
  resizeResults(pack1Pending, 6);
  pack1Pending.unlockedModules = ["pack_1_advanced_draft_biohazards"];
  pack1Pending.contentRequired = [{ moduleId: "pack_1_advanced_draft_biohazards", items: ["draft", "events"] }];
  pack1Pending.inventories.minorCities = 0;
  pack1Pending.inventories.scarInstances.biohazard = 3;
  const minorTerritories = ["japan", "eastern_australia", "greenland", "egypt", "india", "alberta", "argentina", "iceland", "siam"];
  pack1Pending.board.cities = minorTerritories.map((territoryId, index) => ({
    territoryId,
    type: "minor" as const,
    name: `Minor ${index + 1}`,
    foundedByPlayerId: ["qa1", "qa2", "qa3"][index % 3],
  }));
  pack1Pending.foundedMinorCities = 9;

  const pack1Active = clone(pack1Pending);
  pack1Active.worldName = `${worldPrefix} 05 - Pack 1 Active`;
  markModuleActive(pack1Active, "pack_1_advanced_draft_biohazards", {
    draft: { cards: ["host-entered advanced draft cards"] },
    events: [{ id: "city-event", title: "Host-entered City Event", text: "Resolve using the physical card." }],
  });

  const pack2Pending = clone(developed);
  pack2Pending.worldName = `${worldPrefix} 06 - Pack 2 Pending`;
  pack2Pending.gameNumber = 3;
  resizeResults(pack2Pending, 3);
  pack2Pending.unlockedModules = ["pack_2_comeback_mercenaries"];
  pack2Pending.contentRequired = [{ moduleId: "pack_2_comeback_mercenaries", items: ["powers"] }];
  pack2Pending.inventories.scarInstances.mercenary = 3;

  const pack2Active = clone(pack2Pending);
  pack2Active.worldName = `${worldPrefix} 07 - Pack 2 Active`;
  markModuleActive(pack2Active, "pack_2_comeback_mercenaries", {
    powers: ["host-entered comeback powers"],
  });
  pack2Active.factionComebackPowers.khan_industries = structuredClone(qaComebackPower);

  const pack3Ready = clone(pack1Active);
  pack3Ready.worldName = `${worldPrefix} 08 - Pack 3 Trigger Ready`;
  pack3Ready.gameNumber = 7;
  resizeResults(pack3Ready, 7);
  pack3Ready.signatures = { qa1: 1, qa2: 1, qa3: 1 };
  markModuleActive(pack3Ready, "pack_2_comeback_mercenaries", { powers: ["host-entered comeback powers"] });
  pack3Ready.factionComebackPowers.khan_industries = structuredClone(qaComebackPower);

  const pack3Pending = clone(pack3Ready);
  pack3Pending.worldName = `${worldPrefix} 09 - Pack 3 Pending`;
  pack3Pending.gameNumber = 8;
  resizeResults(pack3Pending, 8);
  pack3Pending.signatures.qa1 = 2;
  pack3Pending.unlockedModules.push("pack_3_homelands_missions");
  pack3Pending.contentRequired.push({ moduleId: "pack_3_homelands_missions", items: ["missions", "events"] });

  const pack4Pending = clone(pack3Pending);
  pack4Pending.worldName = `${worldPrefix} 10 - Pack 4 Pending`;
  pack4Pending.gameNumber = 10;
  resizeResults(pack4Pending, 10);
  markModuleActive(pack4Pending, "pack_3_homelands_missions", {
    missions: [
      { id: "qa-mission-1", title: "QA Mission One", text: "Host-adjudicated physical condition.", reward: 1 },
      { id: "qa-mission-2", title: "QA Mission Two", text: "Host-adjudicated physical condition.", reward: 2 },
    ],
    events: [{ id: "population-event", title: "Host-entered Population Event", text: "Resolve using the physical card." }],
  });
  pack4Pending.unlockedModules.push("pack_4_lead_faction_private_missions");
  pack4Pending.contentRequired.push({
    moduleId: "pack_4_lead_faction_private_missions",
    items: ["privateMissions"],
  });
  pack4Pending.worldCapitalTerritoryId = "middle_east";
  pack4Pending.leadFactionId = "khan_industries";
  pack4Pending.factionHistory.khan_industries = [{
    gameNumber: 2,
    playerId: "qa1",
    playerName: "Ada",
    startingTerritoryId: "brazil",
    result: "won",
  }];
  pack4Pending.board.cities.push({ territoryId: "middle_east", type: "world_capital", name: "World Capital", foundedByPlayerId: "qa1" });

  const pack4Active = clone(pack4Pending);
  pack4Active.worldName = `${worldPrefix} 11 - World Capital`;
  markModuleActive(pack4Active, "pack_4_lead_faction_private_missions", {
    privateMissions: [
      { id: "qa-private-1", title: qaPrivateMission.title, text: qaPrivateMission.text },
      { id: "qa-private-2", title: "QA Private Mission Two", text: "Second host-adjudicated private condition." },
    ],
  });

  const privateMissionCaptured = clone(pack4Active);
  privateMissionCaptured.worldName = `${worldPrefix} 12 - Private Mission Captured`;
  privateMissionCaptured.gameNumber = 11;
  resizeResults(privateMissionCaptured, 11);
  privateMissionCaptured.factionPrivateMissions.khan_industries = structuredClone(qaPrivateMission);

  const pocket1Pending = clone(privateMissionCaptured);
  pocket1Pending.worldName = `${worldPrefix} 13 - Pocket 1 Pending`;
  pocket1Pending.gameNumber = 12;
  resizeResults(pocket1Pending, 12);
  pocket1Pending.unlockedModules.push("pocket_1_nuclear_war_mutants");
  pocket1Pending.contentRequired.push({
    moduleId: "pocket_1_nuclear_war_mutants",
    items: ["missilePowers", "events", "faction"],
  });
  pocket1Pending.board.scars.push({ territoryId: "kamchatka", scarId: "fallout" });

  const pocket1Active = clone(pocket1Pending);
  pocket1Active.worldName = `${worldPrefix} 14 - Pocket 1 Active`;
  markModuleActive(pocket1Active, "pocket_1_nuclear_war_mutants");
  pocket1Active.factionMissilePowers.khan_industries = "rally";
  pocket1Active.bringerOfNuclearFireFactionId = "enclave_of_the_bear";
  pocket1Active.mutantEvolutionChoices = ["offensive", "bodies"];
  pocket1Active.mutantEvolution = "unnatural_strength";

  const pocket2Pending = clone(pocket1Active);
  pocket2Pending.worldName = `${worldPrefix} 15 - Pocket 2 Pending`;
  pocket2Pending.unlockedModules.push("pocket_2_alien_landing");
  pocket2Pending.contentRequired.push({
    moduleId: "pocket_2_alien_landing",
    items: ["events", "scars", "faction"],
  });

  const pocketsActive = clone(pocket2Pending);
  pocketsActive.worldName = `${worldPrefix} 16 - Both Pockets`;
  markModuleActive(pocketsActive, "pocket_2_alien_landing");
  pocketsActive.alienCollaboratorFactionId = "khan_industries";
  pocketsActive.factionWeaknesses.imperial_balkania = "cautious";

  const alienIslandActive = clone(pocketsActive);
  alienIslandActive.worldName = `${worldPrefix} 17 - Alien Island`;
  alienIslandActive.gameNumber = 13;
  resizeResults(alienIslandActive, 13);
  alienIslandActive.alienIsland = { territoryId: "alien_island", name: "Arrival", connections: ["brazil", "indonesia"] };

  const completed15 = clone(alienIslandActive);
  completed15.worldName = `${worldPrefix} 18 - Game 15 Complete`;
  completed15.gameNumber = 15;
  completed15.signatures = { qa1: 6, qa2: 5, qa3: 4 };
  completed15.completedWorld = { namedByPlayerId: "qa1", completedAtGame: 15 };
  fillResults(completed15, 15);

  const postCampaign = clone(completed15);
  postCampaign.worldName = `${worldPrefix} 19 - Post Campaign`;
  postCampaign.gameNumber = 16;

  return [
    { id: "fresh_game_1", title: "Fresh campaign", description: "Game 1 with an untouched board.", expectedStart: "starts", campaign: fresh },
    { id: "returning_game_2", title: "Returning winner", description: "Game 2 signature-to-Missile setup.", expectedStart: "starts", campaign: returning },
    { id: "developed_board_game_6", title: "Developed board", description: "Scars, cities, fortification, names, bonuses, and card changes.", expectedStart: "starts", campaign: developed },
    { id: "pack_1_import_pending", title: "Pack 1 import pending", description: "Ninth Minor City placed; advanced draft blocks the next game.", expectedStart: "blocked_on_import", campaign: pack1Pending },
    { id: "pack_1_active", title: "Pack 1 active", description: "Advanced draft and event content supplied.", expectedStart: "starts", campaign: pack1Active },
    { id: "pack_2_import_pending", title: "Pack 2 import pending", description: "Elimination pack open; comeback power text pending.", expectedStart: "starts", campaign: pack2Pending },
    { id: "pack_2_active", title: "Pack 2 active", description: "Comeback powers supplied and Mercenaries available.", expectedStart: "starts", campaign: pack2Active },
    { id: "pack_3_trigger_ready", title: "Pack 3 trigger ready", description: "Every QA player is one win away from a second signature.", expectedStart: "starts", campaign: pack3Ready },
    { id: "pack_3_import_pending", title: "Pack 3 import pending", description: "Second signature recorded; Missions and events pending.", expectedStart: "starts", campaign: pack3Pending },
    { id: "pack_4_import_pending", title: "Pack 4 import pending", description: "World Capital placed; Private Mission text pending.", expectedStart: "starts", campaign: pack4Pending },
    { id: "world_capital_pack_4_active", title: "World Capital / Pack 4", description: "World Capital, Lead Faction, and private missions active.", expectedStart: "starts", campaign: pack4Active },
    { id: "pack_4_private_mission_captured", title: "Private Mission captured", description: "A faction carries a captured Private Mission into the next game.", expectedStart: "starts", campaign: privateMissionCaptured },
    { id: "pocket_1_import_pending", title: "Pocket 1 import pending", description: "Nuclear opening resolved; Mutant content pending.", expectedStart: "starts", campaign: pocket1Pending },
    { id: "pocket_2_import_pending", title: "Pocket 2 import pending", description: "Alien landing triggered; Alien content pending.", expectedStart: "starts", campaign: pocket2Pending },
    { id: "both_pockets_active", title: "Both pockets active", description: "Nuclear and Alien content supplied for late-campaign QA.", expectedStart: "starts", campaign: pocketsActive },
    { id: "alien_island_active", title: "Alien Island active", description: "Off-board island and its two permanent sea-line connections are active.", expectedStart: "starts", campaign: alienIslandActive },
    { id: "completed_game_15", title: "Game 15 complete", description: "Starter board changes have ended.", expectedStart: "starts", campaign: completed15 },
    { id: "post_campaign_game_16", title: "Post-campaign play", description: "Customized world remains playable after the legacy campaign.", expectedStart: "starts", campaign: postCampaign },
  ];
}

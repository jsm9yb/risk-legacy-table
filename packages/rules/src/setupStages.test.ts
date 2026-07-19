import { describe, expect, it } from "vitest";
import { contentPack } from "@risk/content";
import { manifest } from "@risk/map";
import { applyAction, createGame, initialCampaign, isLegalStart, waitingOn } from "./index.ts";

describe("explicit setup stages", () => {
  it("runs Lead Faction mission setup after placement and before turn 1", () => {
    const campaign = initialCampaign("Mission Order");
    campaign.preparation = {
      stage: "complete",
      participants: [
        { playerId: "p1", name: "One", seat: 0 },
        { playerId: "p2", name: "Two", seat: 1 },
        { playerId: "p3", name: "Three", seat: 2 },
      ],
      actorIndex: 0,
      factionPowerChoices: {},
      resourceStickers: [],
    };
    campaign.unlockedModules.push("pack_4_lead_faction_private_missions");
    campaign.factionHistory.khan_industries = [{
      gameNumber: 1, playerId: "old", playerName: "Veteran", startingTerritoryId: "alaska", result: "won",
    }];
    let state = createGame({ gameId: "mission-order", seed: 19, players: campaign.preparation.participants.map(({ playerId: id, name }) => ({ id, name })), campaign });
    state = applyAction(state, { type: "setup.acknowledgeOrder", playerId: waitingOn(state)! });
    const factions = ["khan_industries", "die_mechaniker", "saharan_republic"];
    while (state.phase === "setup") {
      const playerId = waitingOn(state)!;
      const factionId = factions[Object.values(state.players).filter((player) => player.factionId).length];
      const faction = contentPack.factions.find((candidate) => candidate.id === factionId)!;
      const territory = manifest.territories.find((candidate) => isLegalStart(state, candidate.id, true, factionId, playerId))!;
      state = applyAction(state, { type: "setup.choose", playerId, factionId, territoryId: territory.id, powerId: faction.startingPowers[0] });
    }
    expect(state.setup?.stage).toBe("complete");
    expect(state.missionChoice?.reason).toBe("game_start");
    const missionStage = state.log.findIndex((event) => event.type === "SetupStageChanged" && event.data?.stage === "mission_setup");
    const choice = state.log.findIndex((event) => event.type === "LeadFactionMissionChoiceOpened");
    const complete = state.log.findIndex((event) => event.type === "SetupStageChanged" && event.data?.stage === "complete");
    const turn = state.log.findIndex((event) => event.type === "TurnStarted");
    expect(missionStage).toBeGreaterThan(-1);
    expect(missionStage).toBeLessThan(choice);
    expect(choice).toBeLessThan(complete);
    expect(complete).toBeLessThan(turn);
  });
});

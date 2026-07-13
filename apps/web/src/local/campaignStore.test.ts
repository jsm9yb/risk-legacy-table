import { describe, expect, it, vi } from "vitest";
import {
  advanceCampaignScenarioToFirstTurn,
  applyAction,
  completeCampaignScenarioGame,
  createCampaignScenarios,
  createGame,
} from "@risk/rules";
import { manifest } from "@risk/map";
import {
  clearLocalCampaign,
  createNextLocalGame,
  foldCompletedLocalGame,
  loadLocalCampaign,
  LOCAL_CAMPAIGN_VERSION,
  persistActiveGame,
  saveLocalCampaign,
  startLocalCampaign,
  type LocalCampaignSave,
} from "./campaignStore.ts";
import { driveToVictory } from "../game/test-fixtures.ts";

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

const players = [
  { id: "u1", name: "Ada" },
  { id: "u2", name: "Lin" },
  { id: "u3", name: "Rex" },
];

describe("local campaign store", () => {
  it("creates, loads, persists, and clears an active hot-seat game", () => {
    const storage = memoryStorage();
    const save = startLocalCampaign({ seed: 11, worldName: "Terra", players }, storage);

    expect(save.activeGame?.phase).toBe("setup");
    expect(loadLocalCampaign(storage)?.id).toBe(save.id);

    const changed = { ...save.activeGame!, turnNumber: 7 };
    persistActiveGame(save, changed, storage);
    expect(loadLocalCampaign(storage)?.activeGame?.turnNumber).toBe(7);

    clearLocalCampaign(storage);
    expect(loadLocalCampaign(storage)).toBeNull();
  });

  it("replaces a developed campaign with a distinct, completely fresh campaign", () => {
    const storage = memoryStorage();
    const now = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    try {
      const first = startLocalCampaign({ seed: 11, worldName: "First World", players }, storage);
      first.campaignState.factionPowerChoices.khan_industries = "territory_card_reinforcement";
      first.campaignState.board.scars.push({ territoryId: "ural", scarId: "bunker" });
      first.campaignState.inventories.scarInstances.bunker = 0;
      saveLocalCampaign(first, storage);

      const second = startLocalCampaign({ seed: 12, worldName: "Second World", players }, storage);
      expect(second.id).not.toBe(first.id);
      expect(second.campaignState.factionPowerChoices).toEqual({});
      expect(second.activeGame?.factionPowers).toEqual({});
      expect(second.campaignState.board.scars).toEqual([]);
      expect(second.activeGame?.territories.ural.scars).toEqual([]);
      expect(second.campaignState.inventories.scarInstances.bunker).toBe(3);
      expect(loadLocalCampaign(storage)?.id).toBe(second.id);
    } finally {
      now.mockRestore();
    }
  });

  it("fails closed on corrupt saves", () => {
    const storage = memoryStorage();
    storage.setItem("risk-legacy.localCampaign.v1", "{not-json");
    expect(loadLocalCampaign(storage)).toBeNull();
  });

  it("folds a completed local game into campaign state and removes the active game", () => {
    const storage = memoryStorage();
    const save = startLocalCampaign({ seed: 89, worldName: "Terra", players }, storage);
    let finished = driveToVictory(89);
    const winner = finished.winner!;
    const unnamed = manifest.continents.find((c) => !finished.continents[c.id]?.name)!;

    finished = applyAction(finished, {
      type: "reward.choose",
      playerId: winner,
      reward: { kind: "name_continent", continentId: unnamed.id, name: "Ada's Reach" },
    });
    while (finished.rewards && !finished.rewards.committed) {
      const playerId = finished.rewards.order[finished.rewards.nextIdx];
      finished = applyAction(finished, { type: "reward.choose", playerId, reward: { kind: "pass" } });
    }

    const folded = foldCompletedLocalGame(save, finished, storage);
    expect(folded.activeGame).toBeUndefined();
    expect(folded.campaignState.gameNumber).toBe(finished.gameNumber);
    expect(folded.completedSummaries).toHaveLength(1);
    expect(loadLocalCampaign(storage)?.activeGame).toBeUndefined();
  }, 30000);

  it("round-trips every campaign-stage fixture through local save, fold, and next-game creation", () => {
    for (const [index, scenario] of createCampaignScenarios("Local QA").entries()) {
      const storage = memoryStorage();
      const now = "2026-07-10T00:00:00.000Z";
      const base: LocalCampaignSave = {
        version: LOCAL_CAMPAIGN_VERSION,
        schema: { save: LOCAL_CAMPAIGN_VERSION, game: 1, campaign: 1 },
        id: `local-${scenario.id}`,
        metadata: { worldName: scenario.campaign.worldName, createdAt: now, updatedAt: now },
        players,
        seed: 8000 + index,
        campaignState: scenario.campaign,
        completedSummaries: [],
      };
      saveLocalCampaign(base, storage);
      const restored = loadLocalCampaign(storage)!;
      expect(restored.campaignState, scenario.id).toEqual(scenario.campaign);

      const create = () => createGame({
        gameId: `${base.id}-g${scenario.campaign.gameNumber + 1}`,
        seed: base.seed,
        players,
        campaign: restored.campaignState,
      });
      if (scenario.expectedStart === "blocked_on_import") {
        expect(create, scenario.id).toThrow(/advanced setup draft.*host-entered/i);
        continue;
      }

      const firstTurn = advanceCampaignScenarioToFirstTurn(create()).state;
      const activeSave = persistActiveGame(restored, firstTurn, storage);
      expect(loadLocalCampaign(storage)?.activeGame, scenario.id).toEqual(firstTurn);

      const finished = completeCampaignScenarioGame(activeSave.activeGame!);
      const folded = foldCompletedLocalGame(activeSave, finished, storage);
      expect(folded.activeGame, scenario.id).toBeUndefined();
      expect(folded.campaignState.gameNumber, scenario.id).toBe(finished.gameNumber);
      expect(folded.completedSummaries, scenario.id).toContainEqual(expect.objectContaining({
        gameId: finished.gameId,
        gameNumber: finished.gameNumber,
        winner: finished.winner,
      }));

      const following = createNextLocalGame(folded, 9000 + index, storage);
      expect(following.activeGame?.gameNumber, scenario.id).toBe(finished.gameNumber + 1);
      expect(loadLocalCampaign(storage)?.activeGame, scenario.id).toEqual(following.activeGame);
    }
  }, 30000);
});

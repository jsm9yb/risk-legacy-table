import { describe, expect, it } from "vitest";
import { CURRENT_LOCAL_SAVE_VERSION, migrateLocalSave, validateLocalSaveShape } from "./migrations.ts";

const legacy = {
  version: 1,
  id: "local-1",
  metadata: { worldName: "Terra", createdAt: "now", updatedAt: "now" },
  players: [{ id: "u1", name: "Ada" }, { id: "u2", name: "Lin" }],
  seed: 1,
  campaignState: { gameNumber: 0 },
  completedSummaries: [],
};

describe("local save migrations", () => {
  it("migrates the supported v1 save without discarding state", () => {
    const result = migrateLocalSave(legacy);
    expect(result.error).toBeUndefined();
    expect(result.fromVersion).toBe(1);
    expect(result.value).toMatchObject({ version: CURRENT_LOCAL_SAVE_VERSION, id: legacy.id, campaignState: legacy.campaignState });
    expect(validateLocalSaveShape(result.value)).toEqual([]);
  });

  it("fails with an actionable error for future and malformed saves", () => {
    expect(migrateLocalSave({ ...legacy, version: 999 }).error).toMatch(/newer/i);
    expect(migrateLocalSave("broken").error).toMatch(/json object/i);
  });

  it("moves unfinished v3 saves directly to Coin placement and discards premature faction powers", () => {
    const result = migrateLocalSave({
      ...legacy,
      version: 3,
      campaignState: {
        gameNumber: 0,
        factionPowerChoices: { khan_industries: "hq_reinforcement" },
        preparation: {
          stage: "faction_powers",
          participants: [],
          actorIndex: 0,
          factionPowerChoices: { khan_industries: "hq_reinforcement" },
          resourceStickers: Array.from({ length: 12 }, (_, index) => ({ stickerId: `world-coin-${index + 1}` })),
        },
      },
      activeGame: {
        gameNumber: 1,
        phase: "setup",
        players: { u1: { id: "u1" }, u2: { id: "u2" } },
        factionPowers: { khan_industries: "hq_reinforcement" },
      },
    });
    expect(result.value?.campaignState.preparation.stage).toBe("resource_stickers");
    expect(result.value?.campaignState.factionPowerChoices).toEqual({});
    expect(result.value?.campaignState.preparation.factionPowerChoices).toEqual({});
    expect(result.value?.activeGame.factionPowers).toEqual({});
  });
});

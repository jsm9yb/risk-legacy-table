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
});


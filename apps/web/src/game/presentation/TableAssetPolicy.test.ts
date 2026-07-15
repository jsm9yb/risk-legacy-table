import { describe, expect, it } from "vitest";
import { createGame } from "@risk/rules";
import {
  requiredFactionAtlasIds,
  tableTextTextureResolution,
  territoryLabelAlpha,
} from "./TableAssetPolicy.ts";

describe("table asset policy", () => {
  it("loads an HQ atlas even when that faction is not assigned to a player", () => {
    const state = createGame({
      gameId: "asset-policy",
      seed: 77,
      players: [
        { id: "u1", name: "Ada" },
        { id: "u2", name: "Lin" },
        { id: "u3", name: "Rex" },
      ],
    });
    state.players.u1.factionId = "die_mechaniker";
    state.territories.alaska.hqFaction = "aliens";

    expect(requiredFactionAtlasIds(state, new Set(["aliens", "die_mechaniker"]))).toEqual([
      "aliens",
      "die_mechaniker",
    ]);
  });

  it("rasterizes text densely enough for the table's maximum zoom", () => {
    expect(tableTextTextureResolution("balanced", 1, 1.28)).toBeGreaterThanOrEqual(4);
    expect(tableTextTextureResolution("high", 2, 1.28)).toBeGreaterThanOrEqual(7);
  });

  it("keeps territory names opaque when an army is nearby", () => {
    expect(territoryLabelAlpha(true)).toBe(1);
  });
});

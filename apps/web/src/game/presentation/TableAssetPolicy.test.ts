import { describe, expect, it } from "vitest";
import { createGame } from "@risk/rules";
import { readdirSync, readFileSync } from "node:fs";
import factionFrames from "../../assets/table/pieces/frames.json";
import {
  MAX_TABLE_ZOOM,
  requiredFactionAtlasIds,
  tableMiniatureTextureSourceOptions,
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

  it("supports close-up table inspection with smooth miniature downscaling", () => {
    expect(MAX_TABLE_ZOOM).toBe(3.2);
    expect(tableMiniatureTextureSourceOptions()).toEqual({
      scaleMode: "linear",
      autoGenerateMipmaps: true,
    });
  });

  it("keeps every runtime miniature atlas lossless", () => {
    const atlasRoot = new URL("../../assets/table/pieces/", import.meta.url);
    const factionDirectories = readdirSync(atlasRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    expect(factionDirectories.length).toBeGreaterThan(0);
    for (const factionId of factionDirectories) {
      const bytes = readFileSync(new URL(`${factionId}/atlas.webp`, atlasRoot));
      expect(bytes.includes(Buffer.from("VP8L")), factionId).toBe(true);
    }
  });

  it("gives all 21 miniature frames a transparent guard band and a common baseline", () => {
    expect(Object.keys(factionFrames)).toHaveLength(7);
    for (const frames of Object.values(factionFrames)) {
      for (const [column, kind] of (["one", "three", "hq"] as const).entries()) {
        const frame = frames[kind];
        expect(frame.width).toBeGreaterThan(0);
        expect(frame.height).toBeGreaterThan(0);
        expect(frame.x).toBeGreaterThanOrEqual(column * 256 + 16);
        expect(frame.x + frame.width).toBeLessThanOrEqual((column + 1) * 256 - 16);
        expect(frame.y).toBeGreaterThanOrEqual(80);
        expect(frame.y + frame.height).toBe(496);
      }
    }
  });

  it("keeps unobstructed map names readable while yielding to miniatures", () => {
    expect(territoryLabelAlpha()).toBe(0.78);
    expect(territoryLabelAlpha(true)).toBe(0.2);
  });
});

import { describe, expect, it } from "vitest";
import type { TerritoryState } from "@risk/rules";
import { ARCHITECTURE_ATLAS, ARCHITECTURE_ATLAS_KEYS, ARCHITECTURE_CITY_TIERS } from "../../assets/table/architecture/catalog.ts";
import { projectTerritoryLayers } from "./ArchitecturePresentation.ts";

function territory(overrides: Partial<TerritoryState> = {}): TerritoryState {
  return { troops: 0, scars: [], ...overrides };
}

describe("architecture asset catalog", () => {
  it("covers all 35 replacement-state frames inside the production atlas", () => {
    expect(ARCHITECTURE_ATLAS.frameCount).toBe(35);
    expect(ARCHITECTURE_ATLAS_KEYS).toHaveLength(35);
    expect(new Set(ARCHITECTURE_ATLAS_KEYS).size).toBe(35);
    for (const tier of ARCHITECTURE_CITY_TIERS) {
      expect(ARCHITECTURE_ATLAS_KEYS).toContain(`city.${tier}.base`);
      for (let remaining = 1; remaining <= 10; remaining++) {
        expect(ARCHITECTURE_ATLAS_KEYS).toContain(`city.${tier}.fortified.${remaining}`);
      }
    }
    expect(ARCHITECTURE_ATLAS_KEYS).toContain("ruin");
    expect(ARCHITECTURE_ATLAS_KEYS).toContain("fallout");
    for (const frame of Object.values(ARCHITECTURE_ATLAS.frames)) {
      expect(frame.width).toBe(128);
      expect(frame.height).toBe(128);
      expect(frame.x + frame.width).toBeLessThanOrEqual(ARCHITECTURE_ATLAS.width);
      expect(frame.y + frame.height).toBeLessThanOrEqual(ARCHITECTURE_ATLAS.height);
    }
  });
});

describe("territory layer projection", () => {
  it.each(ARCHITECTURE_CITY_TIERS)("selects every %s city durability asset and returns to base", (cityType) => {
    for (let remaining = 1; remaining <= 10; remaining++) {
      expect(projectTerritoryLayers(territory({
        city: { type: cityType, population: 1 },
        fortification: { max: 10, remaining },
      })).architecture?.assetKey).toBe(`city.${cityType}.fortified.${remaining}`);
    }
    expect(projectTerritoryLayers(territory({ city: { type: cityType, population: 1 } })).architecture?.assetKey)
      .toBe(`city.${cityType}.base`);
    expect(projectTerritoryLayers(territory({
      city: { type: cityType, population: 1 },
      fortification: { max: 10, remaining: 0 },
    })).architecture?.assetKey).toBe(`city.${cityType}.base`);
  });

  it("applies fallout, ruin, then city precedence and never places a scar beside fallout", () => {
    expect(projectTerritoryLayers(territory({
      city: { type: "major", population: 2 },
      ruin: true,
      scars: ["bunker", "fallout"],
    }))).toEqual({ architecture: { kind: "fallout", assetKey: "fallout" } });

    expect(projectTerritoryLayers(territory({
      city: { type: "major", population: 2 },
      ruin: true,
      scars: ["bunker"],
    }))).toEqual({ architecture: { kind: "ruin", assetKey: "ruin" }, scarId: "bunker" });
  });

  it("exposes only the first ordinary scar without letting an HQ suppress it", () => {
    expect(projectTerritoryLayers(territory({ hqFaction: "mutants", scars: ["bunker", "biohazard"] })))
      .toEqual({ scarId: "bunker" });
  });
});

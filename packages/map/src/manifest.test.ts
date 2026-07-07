import { describe, it, expect } from "vitest";
import { manifest, validateManifest, continentTerritories } from "./index.ts";

describe("map manifest", () => {
  it("validates with no errors", () => {
    expect(validateManifest()).toEqual([]);
  });
  it("has exactly 42 territories across 6 continents", () => {
    expect(manifest.territories.length).toBe(42);
    const counts = manifest.continents.map((c) => continentTerritories(c.id).length);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(42);
    expect(Object.fromEntries(manifest.continents.map((c, i) => [c.id, counts[i]]))).toEqual({
      north_america: 9, south_america: 4, europe: 7, africa: 6, asia: 12, australia: 4,
    });
  });
});

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { manifest, validateManifest, continentColors, continentTerritories, territoryById, territoryPath, visualConnections } from "./index.ts";

const boardSvg = readFileSync(new URL("../assets/board.svg", import.meta.url), "utf8");
const printedTerritoryLabels = Object.fromEntries(
  [...boardSvg.matchAll(/<text class="territory-label"[^>]*>(.*?)<\/text>/g)].map(([, body]) => {
    const spans = [...body.matchAll(/<tspan[^>]*>(.*?)<\/tspan>/g)];
    const first = body.match(/<tspan x="([^"]+)" y="([^"]+)"[^>]*>/);
    if (!first) throw new Error(`Malformed territory label: ${body}`);
    return [spans.map((span) => span[1]).join(" "), { x: Number(first[1]), y: Number(first[2]) }];
  }),
);

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
  it("keeps visual connections aligned with rules adjacency", () => {
    const seen = new Set<string>();
    for (const [from, to] of visualConnections) {
      const key = [from, to].sort().join("--");
      expect(seen.has(key)).toBe(false);
      seen.add(key);
      expect(territoryById(from).neighbors).toContain(to);
      expect(territoryById(to).neighbors).toContain(from);
    }
  });

  it("prints every Great Britain connection defined by the rules map", () => {
    for (const neighbor of territoryById("great_britain").neighbors) {
      expect(boardSvg).toContain(`data-route="great_britain--${neighbor}"`);
    }
  });

  it("renders island territories as unified silhouettes", () => {
    for (const territoryId of ["great_britain", "indonesia"]) {
      const path = territoryPath(territoryId);
      expect(path, territoryId).toBeDefined();
      expect(path!.d.match(/\bM\s/g), territoryId).toHaveLength(1);
      expect(boardSvg.split(path!.d), `${territoryId} halo and artwork`).toHaveLength(3);
    }
  });

  it("keeps the requested territory titles at their hand-authored optical positions", () => {
    expect(Object.fromEntries([
      "Northwest Territory",
      "Greenland",
      "Western United States",
      "Brazil",
      "Argentina",
      "East Africa",
      "Eastern Australia",
      "Western Australia",
      "Kamchatka",
      "India",
      "Middle East",
    ].map((name) => [name, printedTerritoryLabels[name]]))).toEqual({
      "Northwest Territory": { x: 137.89, y: 74.51 },
      Greenland: { x: 256.25, y: 69.19 },
      "Western United States": { x: 124, y: 176.63 },
      Brazil: { x: 221.94, y: 345.57 },
      Argentina: { x: 202.33, y: 415.63 },
      "East Africa": { x: 444.38, y: 361.94 },
      "Eastern Australia": { x: 697.94, y: 420.62 },
      "Western Australia": { x: 649.02, y: 431.57 },
      Kamchatka: { x: 663.8, y: 106.45 },
      India: { x: 544.15, y: 276.56 },
      "Middle East": { x: 457.56, y: 271.99 },
    });
  });

  it("uses one authored visual treatment for every territory in a continent", () => {
    for (const continentId of Object.keys(continentColors)) {
      expect(boardSvg).toContain(`id="continent-${continentId}"`);
      expect(boardSvg).toContain(`.territory-border[data-continent="${continentId}"] { fill: url(#continent-${continentId}); }`);
    }
  });

  it("leaves continent name fields blank until a campaign winner names them", () => {
    const labels = [...boardSvg.matchAll(/<text class="continent-count"[^>]*>(.*?)<\/text>/g)];
    expect(labels).toHaveLength(6);
    expect(labels.map((match) => match[1].trim())).toEqual(["", "", "", "", "", ""]);
  });
});

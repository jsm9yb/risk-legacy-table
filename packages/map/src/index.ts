import manifestJson from "../data/manifest.json" with { type: "json" };
import territoryPathJson from "../data/territory-paths.json" with { type: "json" };

export interface TerritoryDef {
  id: string;
  name: string;
  continent: string;
  grid: [number, number];
  neighbors: string[];
}
export interface ContinentDef { id: string; name: string; baseBonus: number }
export interface MapManifest {
  version: string;
  viewBox: string;
  continents: ContinentDef[];
  territories: TerritoryDef[];
}

export const manifest = manifestJson as unknown as MapManifest;
const territoryPathData = territoryPathJson as unknown as {
  territories: Record<string, {
    d: string;
    anchor: readonly [number, number];
    bbox: readonly [number, number, number, number];
  }>;
};

/** Pixel anchor for a territory in board viewBox coordinates. */
export function anchor(t: TerritoryDef): { x: number; y: number } {
  const artAnchor = territoryPathData.territories[t.id]?.anchor;
  if (artAnchor) return { x: artAnchor[0], y: artAnchor[1] };
  return { x: 48 + t.grid[0] * 58, y: 46 + t.grid[1] * 62 };
}

/** Raw board-art geometry for a territory (path + bbox in board viewBox coordinates) — reused
 * by the resource-card silhouettes (UI-9) so cards and board share one source of truth. */ // new
export function territoryPath(id: string): { d: string; bbox: readonly [number, number, number, number] } | undefined { // new
  const t = territoryPathData.territories[id]; // new
  return t ? { d: t.d, bbox: t.bbox } : undefined; // new
} // new

/** Continent identity colors (board callouts + card silhouette fills share this palette). */ // new
export const continentColors: Record<string, string> = { // new
  north_america: "#8cc63f", // new
  south_america: "#f89a1c", // new
  europe: "#8293c4", // new
  africa: "#a66a2a", // new
  asia: "#5b8038", // new
  australia: "#755b65", // new
}; // new

export function territoryById(id: string): TerritoryDef {
  const t = manifest.territories.find((t) => t.id === id);
  if (!t) throw new Error(`Unknown territory: ${id}`);
  return t;
}

export function continentTerritories(continentId: string): TerritoryDef[] {
  return manifest.territories.filter((t) => t.continent === continentId);
}

/** Validate manifest invariants: 42 territories, symmetric adjacency, valid continents. */
export function validateManifest(m: MapManifest = manifest): string[] {
  const errors: string[] = [];
  if (m.territories.length !== 42) errors.push(`Expected 42 territories, found ${m.territories.length}`);
  const ids = new Set(m.territories.map((t) => t.id));
  if (ids.size !== m.territories.length) errors.push("Duplicate territory ids");
  const continents = new Set(m.continents.map((c) => c.id));
  for (const t of m.territories) {
    if (!continents.has(t.continent)) errors.push(`${t.id}: unknown continent ${t.continent}`);
    for (const n of t.neighbors) {
      if (!ids.has(n)) errors.push(`${t.id}: unknown neighbor ${n}`);
      else {
        const back = m.territories.find((x) => x.id === n)!;
        if (!back.neighbors.includes(t.id)) errors.push(`Asymmetric adjacency: ${t.id} -> ${n}`);
      }
    }
  }
  if (m.continents.length !== 6) errors.push(`Expected 6 continents, found ${m.continents.length}`);
  return errors;
}

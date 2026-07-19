import atlasSrc from "./atlas.webp";
import atlasManifest from "./atlas.json";

export const ARCHITECTURE_CITY_TIERS = ["minor", "major", "world_capital"] as const;
export type ArchitectureCityTier = (typeof ARCHITECTURE_CITY_TIERS)[number];
export type FortificationDurability = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export type ArchitectureAtlasKey =
  | `city.${ArchitectureCityTier}.base`
  | `city.${ArchitectureCityTier}.fortified.${FortificationDurability}`
  | "ruin"
  | "fallout";

export interface ArchitectureAtlasFrame { x: number; y: number; width: number; height: number }

const frames = atlasManifest.frames as Record<ArchitectureAtlasKey, ArchitectureAtlasFrame>;

export const ARCHITECTURE_ATLAS = {
  src: atlasSrc,
  width: atlasManifest.meta.width,
  height: atlasManifest.meta.height,
  frameCount: atlasManifest.meta.frameCount,
  frames,
} as const;

export const ARCHITECTURE_ATLAS_KEYS = Object.freeze(Object.keys(frames) as ArchitectureAtlasKey[]);

export const ARCHITECTURE_ASSET_PROMPTS = {
  base: "One isolated printed board-game marker with a crisp navy/cyan/cream arched silhouette, front-facing compact footprint, strong tier distinction at 20 pixels, flat chroma background, no text or runtime state marks.",
  fortification: "Deterministic offline composite: ten fixed perimeter segments consumed clockwise from 12 o'clock; remaining segments bright cyan, spent segments dark and damaged.",
  mode: "Five built-in image generations with local chroma-key removal; 30 fortified variants and the production atlas are built by scripts/build-architecture-assets.py.",
} as const;

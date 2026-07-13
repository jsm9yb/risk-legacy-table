import aliens from "./pieces/aliens/atlas.webp";
import dieMechaniker from "./pieces/die_mechaniker/atlas.webp";
import enclave from "./pieces/enclave_of_the_bear/atlas.webp";
import balkania from "./pieces/imperial_balkania/atlas.webp";
import khan from "./pieces/khan_industries/atlas.webp";
import mutants from "./pieces/mutants/atlas.webp";
import saharan from "./pieces/saharan_republic/atlas.webp";

export interface AtlasFrame { x: number; y: number; width: number; height: number }
export interface FactionPieceAtlas { src: string; one: AtlasFrame; three: AtlasFrame; hq: AtlasFrame }

export const FACTION_PIECE_ATLASES: Record<string, FactionPieceAtlas> = {
  aliens: { src: aliens, one: { x: 8, y: 97, width: 240, height: 399 }, three: { x: 264, y: 309, width: 240, height: 187 }, hq: { x: 520, y: 278, width: 240, height: 218 } },
  die_mechaniker: { src: dieMechaniker, one: { x: 8, y: 184, width: 240, height: 312 }, three: { x: 264, y: 218, width: 240, height: 278 }, hq: { x: 520, y: 288, width: 240, height: 208 } },
  enclave_of_the_bear: { src: enclave, one: { x: 8, y: 180, width: 240, height: 316 }, three: { x: 264, y: 296, width: 240, height: 200 }, hq: { x: 520, y: 289, width: 240, height: 207 } },
  imperial_balkania: { src: balkania, one: { x: 8, y: 105, width: 240, height: 391 }, three: { x: 264, y: 310, width: 240, height: 186 }, hq: { x: 520, y: 228, width: 240, height: 268 } },
  khan_industries: { src: khan, one: { x: 8, y: 106, width: 240, height: 390 }, three: { x: 264, y: 209, width: 240, height: 287 }, hq: { x: 520, y: 154, width: 240, height: 342 } },
  mutants: { src: mutants, one: { x: 8, y: 229, width: 240, height: 267 }, three: { x: 264, y: 302, width: 240, height: 194 }, hq: { x: 520, y: 235, width: 240, height: 261 } },
  saharan_republic: { src: saharan, one: { x: 8, y: 116, width: 240, height: 380 }, three: { x: 264, y: 279, width: 240, height: 217 }, hq: { x: 520, y: 173, width: 240, height: 323 } },
};

export const TABLE_ASSET_PROMPTS = {
  composition: "Create an original compact tabletop miniature atlas with exactly three isolated subjects in three non-overlapping columns: one infantry, one heavy piece, and one headquarters building. Use the supplied faction scan only as a visual-language reference. Strong readable silhouettes, chunky shapes, and bold value separation must remain recognizable at 14–20 pixels tall.",
  finish: "Consistent orthographic-like 38-degree downward three-quarter camera for all three, consistent scale and baseline. Premium prerendered 3D board-game miniature, matte painted resin/plastic, gentle warm upper-left key light and restrained cool rim light. Solid flat pure chroma-key backdrop fills the entire background. No floor plane, no horizon, no cast shadow, no contact shadow beyond the piece base, no glow, no particles. No text, letters, numbers, logos, watermark, frame, labels, extra objects, extra figures, duplicate subjects, or cropped parts.",
  mode: "Built-in image generation with local chroma-key removal, alpha validation, and WebP production export.",
} as const;

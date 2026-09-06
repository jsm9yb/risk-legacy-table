import aliens from "./pieces/aliens/atlas.webp";
import dieMechaniker from "./pieces/die_mechaniker/atlas.webp";
import enclave from "./pieces/enclave_of_the_bear/atlas.webp";
import balkania from "./pieces/imperial_balkania/atlas.webp";
import khan from "./pieces/khan_industries/atlas.webp";
import mutants from "./pieces/mutants/atlas.webp";
import saharan from "./pieces/saharan_republic/atlas.webp";
import frames from "./pieces/frames.json";

export interface AtlasFrame { x: number; y: number; width: number; height: number }
export interface FactionPieceAtlas { src: string; one: AtlasFrame; three: AtlasFrame; hq: AtlasFrame }

export const FACTION_PIECE_ATLASES: Record<string, FactionPieceAtlas> = {
  aliens: { src: aliens, ...frames.aliens },
  die_mechaniker: { src: dieMechaniker, ...frames.die_mechaniker },
  enclave_of_the_bear: { src: enclave, ...frames.enclave_of_the_bear },
  imperial_balkania: { src: balkania, ...frames.imperial_balkania },
  khan_industries: { src: khan, ...frames.khan_industries },
  mutants: { src: mutants, ...frames.mutants },
  saharan_republic: { src: saharan, ...frames.saharan_republic },
};

export const TABLE_ASSET_PROMPTS = {
  composition: "Create an original compact tabletop miniature atlas with exactly three isolated subjects in three non-overlapping columns: one infantry, one heavy piece, and one headquarters building. Use the supplied faction scan only as a visual-language reference. Strong readable silhouettes, chunky shapes, and bold value separation must remain recognizable at 14–20 pixels tall.",
  finish: "Consistent orthographic-like 38-degree downward three-quarter camera for all three, consistent scale and baseline. Premium prerendered 3D board-game miniature, matte painted resin/plastic, gentle warm upper-left key light and restrained cool rim light. Solid flat pure chroma-key backdrop fills the entire background. No floor plane, no horizon, no cast shadow, no contact shadow beyond the piece base, no glow, no particles. No text, letters, numbers, logos, watermark, frame, labels, extra objects, extra figures, duplicate subjects, or cropped parts.",
  mode: "Built-in image generation with local chroma-key removal, connected-silhouette isolation, padded frame packing, alpha validation, and lossless WebP export. Exact v2 prompts: art-source/generated/pieces/prompts-v2.json.",
} as const;

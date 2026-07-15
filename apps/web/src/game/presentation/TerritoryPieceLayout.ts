import type { TerritoryPresentationDef, TerritoryPresentationProfile } from "@risk/map";
import type { ArmyPieceModel } from "./ArmyStack.ts";

export const ARMY_PIECE_HEIGHT: Record<1 | 3, number> = { 1: 17, 3: 14 };
export const ARMY_PIECE_MAX_ASPECT: Record<1 | 3, number> = { 1: 0.9, 3: 1.3 };

const ARMY_SAFETY_HALF_WIDTH = 9.5;
const ARMY_SAFETY_HEIGHT = 17.5;
const ARMY_SAFETY_FOOT = 2;

export function hqPieceHeight(profile: TerritoryPresentationProfile) {
  return profile === "tiny" ? 16 : profile === "wide" ? 20 : 18;
}

export function architecturePieceHeight(profile: TerritoryPresentationProfile) {
  return profile === "tiny" ? 16 : profile === "wide" ? 20 : 18;
}

/** Compatibility helper for semantic placement effects. HQ presence never changes the scar position. */
export function scarDisplaySlot(definition: TerritoryPresentationDef, _hqPresent = false): [number, number] {
  return definition.scarSlot;
}

export interface LayoutBounds {
  id: string;
  kind: "army" | "count" | "hq" | "architecture" | "fortification" | "scars";
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function centeredBounds(id: string, kind: LayoutBounds["kind"], x: number, y: number, width: number, height: number): LayoutBounds {
  return { id, kind, left: x - width / 2, top: y - height / 2, right: x + width / 2, bottom: y + height / 2 };
}

function armySlotSafetyBounds(id: string, [x, y, scale]: [number, number, number]): LayoutBounds {
  return {
    id,
    kind: "army",
    left: x - ARMY_SAFETY_HALF_WIDTH * scale,
    top: y - ARMY_SAFETY_HEIGHT * scale,
    right: x + ARMY_SAFETY_HALF_WIDTH * scale,
    bottom: y + ARMY_SAFETY_FOOT * scale,
  };
}

export function armyBoundsForPieces(definition: TerritoryPresentationDef, pieces: readonly ArmyPieceModel[]): LayoutBounds[] {
  return pieces.map((piece) => armySlotSafetyBounds(`army-${piece.slot}`, definition.pieceSlots[piece.slot]));
}

function hqBounds(definition: TerritoryPresentationDef): LayoutBounds {
  const hqHeight = hqPieceHeight(definition.profile);
  return {
    id: "hq",
    kind: "hq",
    left: definition.hqSlot[0] - hqHeight * 0.6,
    top: definition.hqSlot[1] - hqHeight,
    right: definition.hqSlot[0] + hqHeight * 0.6,
    bottom: definition.hqSlot[1],
  };
}

function architectureBounds(definition: TerritoryPresentationDef): LayoutBounds {
  const size = architecturePieceHeight(definition.profile);
  return centeredBounds("architecture", "architecture", ...definition.architectureSlot, size, size);
}

function scarBounds(definition: TerritoryPresentationDef): LayoutBounds {
  return centeredBounds("scars", "scars", ...definition.scarSlot, 10, 10);
}

export interface TerritoryLayoutContents {
  army: boolean;
  hq: boolean;
  scars: boolean;
  city: boolean;
  fortification: boolean;
}

/** All three layers use fixed authored positions; content never shifts troop geometry. */
export function territoryDisplayLayout(
  definition: TerritoryPresentationDef,
  _contents: TerritoryLayoutContents,
): TerritoryPresentationDef {
  return definition;
}

export function territoryClutterBounds(
  definition: TerritoryPresentationDef,
  _total: number,
  pieces: readonly ArmyPieceModel[],
): LayoutBounds[] {
  const bounds = armyBoundsForPieces(definition, pieces);
  bounds.push(hqBounds(definition));
  bounds.push(architectureBounds(definition));
  bounds.push(scarBounds(definition));
  return bounds;
}

export function intersectionRatio(a: LayoutBounds, b: LayoutBounds) {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  const intersection = width * height;
  const areaA = (a.right - a.left) * (a.bottom - a.top);
  const areaB = (b.right - b.left) * (b.bottom - b.top);
  return intersection / Math.min(areaA, areaB);
}

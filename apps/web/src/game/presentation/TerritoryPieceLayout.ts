import type { TerritoryPresentationDef, TerritoryPresentationProfile } from "@risk/map";
import type { ArmyPieceModel } from "./ArmyStack.ts";

export const ARMY_PIECE_HEIGHT: Record<1 | 3, number> = { 1: 17, 3: 14 };
export const ARMY_PIECE_MAX_ASPECT: Record<1 | 3, number> = { 1: 0.9, 3: 1.3 };

export function hqPieceHeight(profile: TerritoryPresentationProfile) {
  return profile === "tiny" ? 16 : profile === "wide" ? 20 : 18;
}

export function troopCountPlateWidth(total: number) {
  return Math.max(16, String(Math.max(0, Math.floor(total))).length * 6 + 8);
}

export interface LayoutBounds {
  id: string;
  kind: "army" | "count" | "hq" | "city" | "fortification" | "scars";
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function centeredBounds(id: string, kind: LayoutBounds["kind"], x: number, y: number, width: number, height: number): LayoutBounds {
  return { id, kind, left: x - width / 2, top: y - height / 2, right: x + width / 2, bottom: y + height / 2 };
}

export function territoryClutterBounds(
  definition: TerritoryPresentationDef,
  total: number,
  pieces: readonly ArmyPieceModel[],
): LayoutBounds[] {
  const bounds: LayoutBounds[] = pieces.map((piece) => {
    const [x, y, scale] = definition.pieceSlots[piece.slot];
    const height = ARMY_PIECE_HEIGHT[piece.denomination] * scale;
    const width = height * ARMY_PIECE_MAX_ASPECT[piece.denomination];
    return {
      id: `army-${piece.slot}`,
      kind: "army" as const,
      left: x - width / 2,
      top: y - height,
      right: x + width / 2,
      bottom: y,
    };
  });
  const [countX, countY] = definition.countSlot;
  bounds.push(centeredBounds("count", "count", countX, countY, troopCountPlateWidth(total), 10));

  const [hqX, hqY] = definition.hqSlot;
  const hqHeight = hqPieceHeight(definition.profile);
  bounds.push({ id: "hq", kind: "hq", left: hqX - hqHeight * 0.6, top: hqY - hqHeight, right: hqX + hqHeight * 0.6, bottom: hqY });
  bounds.push(centeredBounds("city", "city", ...definition.citySlot, 12, 12));
  bounds.push(centeredBounds("fortification", "fortification", ...definition.fortificationSlot, 14, 14));
  bounds.push({
    id: "scars",
    kind: "scars",
    left: definition.scarSlot[0] - 5,
    top: definition.scarSlot[1] - 5,
    right: definition.scarSlot[0] + 11,
    bottom: definition.scarSlot[1] + 9,
  });
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

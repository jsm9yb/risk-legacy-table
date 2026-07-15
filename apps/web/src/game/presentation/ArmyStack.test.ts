import { describe, expect, it } from "vitest";
import { composeArmyStack } from "./ArmyStack.ts";

describe("Army Stack composition", () => {
  it.each([
    [0, [], 0],
    [1, [1], 0],
    [2, [1, 1], 0],
    [3, [3], 0],
    [5, [3, 1, 1], 0],
    [8, [3, 3, 1, 1], 0],
    [14, [3, 3, 3, 1, 1], 3],
    [23, [3, 3, 3, 1, 1], 12],
  ])("represents %i troops with physical denominations", (total, denominations, reserve) => {
    const stack = composeArmyStack(total, "game:alaska");
    expect(stack.pieces.map((piece) => piece.denomination)).toEqual(denominations);
    expect(stack.reserve).toBe(reserve);
    expect(stack.accessibleLabel).toContain(`${total} troops`);
  });

  it("is stable for the same game and territory", () => {
    expect(composeArmyStack(14, "g1:alaska")).toEqual(composeArmyStack(14, "g1:alaska"));
    expect(composeArmyStack(14, "g1:alaska").pieces.map((piece) => piece.id)).not.toEqual(
      composeArmyStack(14, "g1:brazil").pieces.map((piece) => piece.id),
    );
  });

  it("preserves exact totals for every count from 0 through 100", () => {
    for (let total = 0; total <= 100; total++) {
      const stack = composeArmyStack(total, `g:t:${total}`);
      expect(stack.pieces.reduce((sum, piece) => sum + piece.denomination, 0) + stack.reserve).toBe(total);
      expect(stack.pieces.length).toBeLessThanOrEqual(5);
      expect(stack.pieces.every((piece) => piece.slot >= 0 && piece.slot <= 4)).toBe(true);
    }
  });

  it("uses the three authored 3-unit slots followed by the two authored 1-unit slots", () => {
    expect(composeArmyStack(1, "g:one").pieces.map((piece) => piece.slot)).toEqual([3]);
    expect(composeArmyStack(2, "g:two").pieces.map((piece) => piece.slot)).toEqual([3, 4]);
    expect(composeArmyStack(5, "g:five").pieces.map((piece) => piece.slot)).toEqual([0, 3, 4]);
    expect(composeArmyStack(99, "g:many").pieces.map((piece) => piece.slot)).toEqual([0, 1, 2, 3, 4]);
  });
});

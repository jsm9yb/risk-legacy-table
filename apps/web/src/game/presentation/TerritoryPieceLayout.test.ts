import { describe, expect, it } from "vitest";
import { presentationDefinitions } from "@risk/map";
import { composeArmyStack } from "./ArmyStack.ts";
import { intersectionRatio, territoryClutterBounds } from "./TerritoryPieceLayout.ts";

const representativeCounts = [1, 2, 3, 5, 8, 14, 23, 99];

describe("global territory clutter budget", () => {
  it("keeps exact counts and permanent marks readable in every territory profile", () => {
    const violations: string[] = [];
    for (const definition of presentationDefinitions) {
      for (const total of representativeCounts) {
        const stack = composeArmyStack(total, `audit:${definition.territoryId}`);
        const bounds = territoryClutterBounds(definition, total, stack.pieces);
        for (let left = 0; left < bounds.length; left++) {
          for (let right = left + 1; right < bounds.length; right++) {
            const a = bounds[left];
            const b = bounds[right];
            if (a.kind === "army" && b.kind === "army") continue;
            const ratio = intersectionRatio(a, b);
            const budget = a.kind === "army" || b.kind === "army" ? 0.08 : 0;
            if (ratio > budget) violations.push(`${definition.territoryId}@${total}: ${a.id}/${b.id} ${ratio.toFixed(3)} > ${budget}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("audits all 42 territories and Alien Island at every representative count", () => {
    expect(presentationDefinitions).toHaveLength(43);
    expect(presentationDefinitions.length * representativeCounts.length).toBe(344);
  });
});

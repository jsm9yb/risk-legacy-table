import { describe, expect, it } from "vitest";
import { presentationDefinitions } from "@risk/map";
import { composeArmyStack } from "./ArmyStack.ts";
import { scarDisplaySlot, territoryClutterBounds, territoryDisplayLayout } from "./TerritoryPieceLayout.ts";

const representativeCounts = [1, 2, 3, 5, 8, 14, 23, 99];

describe("global territory clutter budget", () => {
  it("keeps architecture, scar, and HQ on independent authored positions", () => {
    const definition = presentationDefinitions.find(({ territoryId }) => territoryId === "alaska")!;
    expect(scarDisplaySlot(definition, false)).toEqual(definition.scarSlot);
    expect(scarDisplaySlot(definition, true)).toEqual(definition.scarSlot);
    expect(definition.architectureSlot).not.toEqual(definition.scarSlot);
    expect(definition.hqSlot).not.toEqual(definition.scarSlot);
  });

  it("keeps troop placement fixed across all permanent-mark combinations", () => {
    const definition = presentationDefinitions.find(({ territoryId }) => territoryId === "northwest_territory")!;
    const ordinary = territoryDisplayLayout(definition, { army: true, hq: false, scars: false, city: true, fortification: true });
    const hq = territoryDisplayLayout(definition, { army: true, hq: true, scars: false, city: true, fortification: true });
    const scar = territoryDisplayLayout(definition, { army: true, hq: false, scars: true, city: true, fortification: true });
    expect(hq.pieceSlots).toEqual(ordinary.pieceSlots);
    expect(scar.pieceSlots).toEqual(ordinary.pieceSlots);
  });

  it("does not include troop count plates or fortification arcs in visible clutter", () => {
    const definition = presentationDefinitions.find(({ territoryId }) => territoryId === "alaska")!;
    const stack = composeArmyStack(99, "audit:alaska");
    const kinds = territoryClutterBounds(definition, stack.total, stack.pieces).map(({ kind }) => kind);
    expect(kinds).not.toContain("count");
    expect(kinds).not.toContain("fortification");
  });

  it("passes every manually authored placement anchor through unchanged", () => {
    for (const definition of presentationDefinitions) {
      const layout = territoryDisplayLayout(definition, { army: true, hq: true, scars: true, city: true, fortification: true });
      expect(layout, definition.territoryId).toBe(definition);
    }
  });

  it("audits all 42 territories and Alien Island at every representative count", () => {
    expect(presentationDefinitions).toHaveLength(43);
    expect(presentationDefinitions.length * representativeCounts.length).toBe(344);
  });
});

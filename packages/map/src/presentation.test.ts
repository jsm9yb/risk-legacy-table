import { describe, expect, it } from "vitest";
import { manifest } from "./index.ts";
import { continentPresentationDefinitions, continentPresentationFor, presentationDefinitions, presentationFor, validatePresentationManifest } from "./presentation.ts";

describe("map presentation manifest", () => {
  it("covers all 42 territories and Alien Island with valid slots", () => {
    expect(validatePresentationManifest()).toEqual([]);
    expect(presentationDefinitions).toHaveLength(43);
    for (const territory of manifest.territories) {
      const definition = presentationFor(territory.id);
      expect(definition.pieceSlots).toHaveLength(5);
      expect(definition.countSlot).not.toEqual(definition.scarSlot);
      expect(definition.architectureSlot).not.toEqual(definition.scarSlot);
      expect(definition.hqSlot).not.toEqual(definition.scarSlot);
      expect(definition.hqSlot).not.toEqual(definition.architectureSlot);
      expect(definition.citySlot).toEqual(definition.architectureSlot);
      expect(definition.fortificationSlot).toEqual(definition.architectureSlot);
      expect(["tiny", "normal", "wide"]).toContain(definition.profile);
    }
  });

  it("provides permanent-name and bonus-mark slots for all six continents", () => {
    expect(continentPresentationDefinitions).toHaveLength(6);
    for (const continent of manifest.continents) {
      expect(continentPresentationFor(continent.id).nameSlot).not.toEqual(continentPresentationFor(continent.id).bonusSlot);
    }
  });

  it("registers independent top architecture, bottom scar, and military HQ positions", () => {
    for (const territory of manifest.territories) {
      const definition = presentationFor(territory.id);
      expect(definition.architectureSlot, territory.id).not.toEqual(definition.scarSlot);
      expect(definition.hqSlot, territory.id).not.toEqual(definition.scarSlot);
    }
    expect(presentationFor("alaska")).toMatchObject({ architectureSlot: [41.7, 91.8], scarSlot: [60.8, 102.5], hqSlot: [42, 80.6] });
    expect(presentationFor("east_africa")).toMatchObject({ architectureSlot: [422, 336.6], scarSlot: [445.1, 336.5], hqSlot: [424.2, 325.7] });
    expect(presentationFor("china")).toMatchObject({ architectureSlot: [553.6, 210], scarSlot: [623.3, 229.1], hqSlot: [555.5, 197.4] });
    expect(presentationFor("madagascar")).toMatchObject({ architectureSlot: [466.8, 440.1], scarSlot: [482.8, 443.7], hqSlot: [481.2, 434] });
  });

  it("preserves the editor's denomination-specific troop placement order", () => {
    expect(presentationFor("alaska").pieceSlots).toEqual([
      [61.2, 93.7, 0.9],
      [67.6, 74.4, 0.9],
      [70.6, 84.9, 0.9],
      [59.8, 84, 0.9],
      [70.8, 96.6, 0.9],
    ]);
    expect(presentationFor("madagascar").pieceSlots).toEqual([
      [462.4, 457.9, 0.58],
      [468.7, 459.4, 0.58],
      [461.2, 466.4, 0.58],
      [474.2, 458.6, 0.58],
      [469.2, 467.2, 0.58],
    ]);
  });
});

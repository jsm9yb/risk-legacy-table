import { describe, expect, it } from "vitest";
import { manifest } from "./index.ts";
import { presentationDefinitions, presentationFor, validatePresentationManifest } from "./presentation.ts";

describe("map presentation manifest", () => {
  it("covers all 42 territories and Alien Island with valid slots", () => {
    expect(validatePresentationManifest()).toEqual([]);
    expect(presentationDefinitions).toHaveLength(43);
    for (const territory of manifest.territories) {
      const definition = presentationFor(territory.id);
      expect(definition.pieceSlots.length).toBeGreaterThanOrEqual(5);
      expect(definition.countSlot).not.toEqual(definition.scarSlot);
      expect(["tiny", "normal", "wide"]).toContain(definition.profile);
    }
  });
});

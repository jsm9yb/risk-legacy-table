import { describe, expect, it } from "vitest";
import { SCAR_MARK_ASSETS, scarMarkAsset } from "./ScarPresentation.ts";

describe("scar presentation assets", () => {
  it.each(["ammo_shortage", "bunker", "mercenary", "biohazard", "weakness", "fortification", "fallout"])("provides simple vector art for %s", (scarId) => {
    const asset = scarMarkAsset(scarId);
    expect(asset).toContain("<svg");
    expect(asset).toContain('viewBox="0 0 128 128"');
    expect(asset).not.toContain("<text");
    expect(asset).not.toMatch(/<(filter|image|use|mask)\b/);
  });

  it("keeps the focused asset set explicit", () => {
    expect(Object.keys(SCAR_MARK_ASSETS).sort()).toEqual(["ammo_shortage", "biohazard", "bunker", "fallout", "fortification", "mercenary", "weakness"]);
    expect(scarMarkAsset("unknown")).toBeUndefined();
  });
});

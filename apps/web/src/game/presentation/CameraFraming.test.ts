import { describe, expect, it } from "vitest";
import { cameraPanForFocus } from "./CameraFraming.ts";

describe("automatic table framing", () => {
  const world = { width: 750, height: 520 };
  it("centers a board that fits inside the viewport", () => {
    expect(cameraPanForFocus([40, 40], world, { width: 1000, height: 700 }, 1)).toEqual({ x: 0, y: 0 });
  });
  it("stops at the board edge instead of exposing empty tabletop", () => {
    const viewport = { width: 1000, height: 700 };
    for (const focus of [[0, 0], [750, 520]] as const) {
      const pan = cameraPanForFocus(focus, world, viewport, 2);
      const left = viewport.width / 2 - (world.width / 2 - pan.x) * 2;
      const top = viewport.height / 2 - (world.height / 2 - pan.y) * 2;
      expect(left).toBeLessThanOrEqual(0);
      expect(top).toBeLessThanOrEqual(0);
      expect(left + world.width * 2).toBeGreaterThanOrEqual(viewport.width);
      expect(top + world.height * 2).toBeGreaterThanOrEqual(viewport.height);
    }
  });
  it("can still center an interior focus at close zoom", () => {
    expect(cameraPanForFocus([360, 250], world, { width: 1000, height: 700 }, 2)).toEqual({ x: 15, y: 10 });
  });
});

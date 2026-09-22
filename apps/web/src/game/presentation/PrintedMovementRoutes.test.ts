import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { presentationFor, visualConnections } from "@risk/map";
import { movementRoutePoint, printedMovementRoute } from "./PrintedMovementRoutes.ts";

const board = readFileSync(new URL("../../../../../packages/map/assets/board.svg", import.meta.url), "utf8");

describe("printed movement routes", () => {
  it("uses the actual route ink for every sea connection in both directions", () => {
    for (const [from, to] of visualConnections) {
      const forward = printedMovementRoute(board, from, to);
      const reverse = printedMovementRoute(board, to, from);
      expect(movementRoutePoint(forward, 0)).toEqual(presentationFor(from).cameraFocus);
      expect(movementRoutePoint(forward, 1)[0]).toBeCloseTo(presentationFor(to).cameraFocus[0]);
      expect(reverse).toEqual([...forward].reverse().map((part) => [...part].reverse()));
    }
  });

  it("follows the exact Great Britain quadratic midpoint", () => {
    const route = printedMovementRoute(board, "great_britain", "iceland");
    expect(route[0][13][0]).toBeCloseTo(0.25 * 307.18 + 0.5 * 325.88 + 0.25 * 322.13);
    expect(route[0][13][1]).toBeCloseTo(0.25 * 156.46 + 0.5 * 134.24 + 0.25 * 105.44);
  });

  it("crosses the Pacific at the board edges without traversing other territories", () => {
    const route = printedMovementRoute(board, "alaska", "kamchatka");
    expect(route).toHaveLength(2);
    expect(route[0].at(-1)).toEqual([4, 91]);
    expect(route[1][0]).toEqual([746, 101]);
    for (let p = 0; p <= 1; p += 0.01) { const [x] = movementRoutePoint(route, p); expect(x < 100 || x > 600).toBe(true); }
  });

  it("keeps land movement direct and follows dynamic island curves", () => {
    expect(printedMovementRoute(board, "brazil", "peru")[0]).toHaveLength(2);
    expect(printedMovementRoute(board, "alien_island", "brazil")[0].length).toBeGreaterThan(20);
  });
});

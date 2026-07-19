import { describe, expect, it } from "vitest";
import { alienIslandRouteModels, alienIslandRoutePath } from "./AlienIslandRoutes.ts";

describe("Alien Island sea-route geometry", () => {
  it("uses authored coast ports instead of territory camera centers", () => {
    expect(alienIslandRouteModels(["brazil", "indonesia"])).toMatchObject([
      { territoryId: "brazil", start: [544, 433], end: [253, 350] },
      { territoryId: "indonesia", start: [575, 422], end: [600, 386] },
    ]);
  });

  it("bends the Eastern Australia connector below Western Australia", () => {
    const [route] = alienIslandRouteModels(["eastern_australia"]);

    expect(route).toMatchObject({
      territoryId: "eastern_australia",
      start: [586, 442],
      end: [700, 465],
    });
    expect(route.control[1]).toBeGreaterThan(500);
    expect(alienIslandRoutePath(route)).toBe(
      `M ${route.start.join(" ")} Q ${route.control.join(" ")} ${route.end.join(" ")}`,
    );
  });
});

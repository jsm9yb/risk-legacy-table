import { describe, expect, it } from "vitest";
import { continentMarkModels } from "./ContinentMarks.ts";

describe("continent legacy marks", () => {
  it("renders only names and bonus changes earned during the campaign", () => {
    const models = continentMarkModels({
      continents: {
        north_america: { name: "First Reach", namedBy: "u1" },
        europe: { bonusMark: 1 },
        australia: { name: "The Rim", namedBy: "u2", bonusMark: -1 },
      },
    });

    expect(models.map(({ continentId, name, bonusMark }) => ({ continentId, name, bonusMark }))).toEqual([
      { continentId: "north_america", name: "First Reach", bonusMark: undefined },
      { continentId: "europe", name: undefined, bonusMark: 1 },
      { continentId: "australia", name: "The Rim", bonusMark: -1 },
    ]);
  });
});

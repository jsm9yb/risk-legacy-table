import { describe, expect, it } from "vitest";
import { territoryOwnerStyle } from "./TerritoryOwnerStyle.ts";

describe("territory owner treatment", () => {
  it("keeps the printed continent fill intact when a territory gains units", () => {
    expect(territoryOwnerStyle(0xd34f4f)).toEqual({
      fill: 0xd34f4f,
      fillAlpha: 0,
      stroke: { color: 0xd34f4f, width: 1.35, alpha: 0.72 },
    });
  });
});

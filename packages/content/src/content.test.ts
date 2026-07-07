import { describe, it, expect } from "vitest";
import { validateContentPack, contentPack, troopsForResources } from "./index.ts";

describe("content pack", () => {
  it("has no validation errors", () => {
    expect(validateContentPack().errors).toEqual([]);
  });
  it("payout table matches official rows", () => {
    expect(troopsForResources(2)).toBe(1);
    expect(troopsForResources(9)).toBe(8);
    expect(troopsForResources(10)).toBe(10);
    expect(troopsForResources(14)).toBe(10); // 10+ caps at 10
    expect(troopsForResources(1)).toBe(0);
  });
  it("five factions, two starting powers each", () => {
    expect(contentPack.factions).toHaveLength(5);
    for (const f of contentPack.factions) expect(f.startingPowers).toHaveLength(2);
  });
});

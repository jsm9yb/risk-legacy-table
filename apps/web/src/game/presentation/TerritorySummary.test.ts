import { describe, expect, it } from "vitest";
import { createGame } from "@risk/rules";
import { territoryAccessibleLabel, territorySummary } from "./TerritorySummary.ts";

describe("territory summary", () => {
  it("reports exact troops, faction identity, and every competing permanent mark", () => {
    const state = createGame({ gameId: "summary", seed: 7, players: [
      { id: "u1", name: "Ada" }, { id: "u2", name: "Lin" }, { id: "u3", name: "Rex" },
    ] });
    state.players.u1.factionId = "enclave_of_the_bear";
    state.territories.alaska = {
      controller: "u1",
      troops: 23,
      hqFaction: "enclave_of_the_bear",
      city: { type: "major", population: 2, name: "Northgate" },
      fortification: { max: 10, remaining: 7 },
      scars: ["bunker", "ammo_shortage"],
      ruin: true,
    };

    expect(territorySummary(state, "alaska")).toMatchObject({
      name: "Alaska",
      controller: "Ada",
      faction: "Enclave of the Bear",
      troops: 23,
      denomination: "7 × 3 + 2 × 1",
      marks: [
        "Enclave of the Bear HQ",
        "major · Northgate",
        "Fortification 7/10",
        "Ruins",
        "Scar · bunker",
        "Scar · ammo shortage",
      ],
    });
    expect(territoryAccessibleLabel(state, "alaska", "selected")).toContain("23 troops: 7 × 3 + 2 × 1");
  });
});

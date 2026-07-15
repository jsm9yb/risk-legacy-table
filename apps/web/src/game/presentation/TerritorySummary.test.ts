import { describe, expect, it } from "vitest";
import { createGame } from "@risk/rules";
import { territoryAccessibleLabel, territorySummary } from "./TerritorySummary.ts";

describe("territory summary", () => {
  it("reports exact troops and only the resolved occupants of each visual layer", () => {
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
        "Ruins",
        "Scar · bunker",
      ],
    });
    expect(territoryAccessibleLabel(state, "alaska", "selected")).toContain("23 troops: 7 × 3 + 2 × 1");
  });

  it("describes fallout as architecture without also exposing it as a scar", () => {
    const state = createGame({ gameId: "fallout-summary", seed: 8, players: [
      { id: "u1", name: "Ada" }, { id: "u2", name: "Lin" }, { id: "u3", name: "Rex" },
    ] });
    state.territories.alaska = { troops: 0, scars: ["fallout", "bunker"], ruin: true };
    expect(territorySummary(state, "alaska").marks).toEqual(["Fallout zone"]);
    expect(territoryAccessibleLabel(state, "alaska")).toContain("Fallout zone");
    expect(territoryAccessibleLabel(state, "alaska")).not.toContain("Scar · fallout");
  });
});

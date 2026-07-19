import { describe, expect, it } from "vitest";
import { createGame } from "@risk/rules";
import { cityEffectSummary, territoryAccessibleLabel, territorySummary } from "./TerritorySummary.ts";

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
        "Scar · Bunker — Defender adds +1 to the highest defense die.",
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

  it("explains a city's recruitment, resistance, founder, and fortification effects", () => {
    const state = createGame({ gameId: "city-summary", seed: 9, players: [
      { id: "u1", name: "Ada" }, { id: "u2", name: "Lin" }, { id: "u3", name: "Rex" },
    ] });
    state.territories.alaska = {
      troops: 0,
      scars: [],
      city: { type: "major", population: 2, name: "Northgate", foundedByPlayerId: "u1" },
      fortification: { max: 10, remaining: 7 },
    };

    expect(cityEffectSummary(state, "alaska")).toEqual({
      territoryId: "alaska",
      name: "Northgate",
      typeLabel: "Major City",
      population: 2,
      recruitmentEffect: "Counts as +2 in territories + population before dividing by 3.",
      unoccupiedEntryEffect: "An enemy expanding into this unoccupied city loses 2 troops.",
      founderEffect: "Its founder may start here when it is unoccupied.",
      fortificationEffect: "Fortified: +2 more troops to enter unoccupied; +1 to each defense die (7/10 uses).",
    });
    expect(territoryAccessibleLabel(state, "alaska")).toContain("population +2");
  });
});

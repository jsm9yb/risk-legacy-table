// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { filterStateFor } from "@risk/rules";
import WarChronicle, { permanentDeltas, publicWarMoments } from "./WarChronicle.tsx";
import { throughSetup } from "./test-fixtures.ts";

afterEach(cleanup);

describe("public war chronicle", () => {
  it("prioritizes consequential events, preserves chronology, and never copies hidden payloads", () => {
    const gs = throughSetup(412);
    const actor = gs.turnOrder[0];
    gs.log = [
      { seq: 1, type: "PrivateMissionActivated", playerId: actor, data: { title: "SECRET MISSION" } },
      ...Array.from({ length: 7 }, (_, index) => ({ seq: index + 2, type: "TerritoryConquered" as const, playerId: actor, data: { territory: "alaska", from: "alberta", moved: 1, defender: gs.turnOrder[1], hqCaptured: index === 0 ? "die_mechaniker" : null } })),
      { seq: 9, type: "GameWon", playerId: actor, data: { reason: "4 Red Stars", results: {} } },
    ];
    const highlights = publicWarMoments(filterStateFor(gs, null));
    expect(highlights).toHaveLength(5);
    expect(highlights[0].title).toBe("HEADQUARTERS CAPTURED");
    expect(highlights.at(-1)?.title).toBe("THE DECISIVE MOMENT");
    expect(highlights.map((moment) => moment.seq)).toEqual([...highlights.map((moment) => moment.seq)].sort((a, b) => a - b));
    expect(JSON.stringify(highlights)).not.toContain("SECRET MISSION");
    render(<WarChronicle gs={gs} />);
    expect(screen.getByText("HEADQUARTERS CAPTURED")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "NEXT MOMENT" }));
    expect(screen.getByText("BORDER BROKEN")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "SKIP TO VICTORY" }));
    expect(screen.getByText("THE DECISIVE MOMENT")).toBeTruthy();
    expect((screen.getByRole("button", { name: "NEXT MOMENT" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("reconstructs proven permanent deltas without assuming unavailable prior values", () => {
    expect(permanentDeltas([
      { seq: 1, type: "TerritoryCardUpgraded", data: { cardId: "alaska", resources: 4 } },
      { seq: 2, type: "CityFortified", data: { territory: "alaska", durability: 10 } },
      { seq: 3, type: "MajorCityFounded", data: { territory: "alberta", name: "New Home" } },
    ])).toEqual([
      { seq: 1, label: "alaska", before: "3 resources", after: "4 resources" },
      { seq: 3, label: "Alberta", before: "No city", after: "New Home · major city" },
    ]);
  });
});

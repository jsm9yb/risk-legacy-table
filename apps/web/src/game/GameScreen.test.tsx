// @vitest-environment jsdom
import "../test-shims.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { contentPack } from "@risk/content";
import { createGame, waitingOn } from "@risk/rules";
import GameScreen from "./GameScreen.tsx";

afterEach(cleanup);

describe("GameScreen", () => {
  it("highlights an own-founded Major City as a legal setup start", () => {
    const gs = createGame({
      gameId: "ui-major-city",
      seed: 11,
      players: [
        { id: "u1", name: "Ada" },
        { id: "u2", name: "Lin" },
        { id: "u3", name: "Rex" },
      ],
    });
    const actor = waitingOn(gs)!;
    gs.territories.alaska.city = {
      type: "major",
      population: 2,
      name: "Northgate",
      foundedByPlayerId: actor,
    };
    const faction = contentPack.factions[0];

    render(<GameScreen gs={gs} dispatch={vi.fn()} onExit={vi.fn()} error={null} />);
    fireEvent.click(screen.getByText(faction.name));

    expect(document.getElementById("alaska")?.getAttribute("class")).toContain("highlight-start");
  });
});

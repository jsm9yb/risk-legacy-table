// @vitest-environment jsdom
import "../test-shims.ts";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { contentPack } from "@risk/content";
import { applyAction, createGame, waitingOn, type Action, type GameState } from "@risk/rules";
import GameScreen from "./GameScreen.tsx";
import { throughSetup } from "./test-fixtures.ts";

afterEach(cleanup);

// Hot-seat harness over the REAL engine: any illegal dispatch throws and fails the test.
let current: GameState;
function Harness({ initial }: { initial: GameState }) {
  const [gs, setGs] = useState(initial);
  current = gs;
  const dispatch = (a: Action) => setGs((s) => (current = applyAction(s, a)));
  return <GameScreen gs={gs} dispatch={dispatch} onExit={() => {}} error={null} />;
}

describe("GameScreen", () => {
  it("renders the imported board SVG with all clickable territory paths", () => {
    const gs = createGame({
      gameId: "ui-board-art",
      seed: 7,
      players: [
        { id: "u1", name: "Ada" },
        { id: "u2", name: "Lin" },
        { id: "u3", name: "Rex" },
      ],
    });

    render(<GameScreen gs={gs} dispatch={vi.fn()} onExit={vi.fn()} error={null} />);

    const board = document.getElementById("risk-board-modern");
    expect(board).toBeTruthy();
    expect(board!.querySelector("title")?.textContent).toBe("Risk Legacy campaign board");
    expect(board!.querySelectorAll("path.territory-border")).toHaveLength(42);
    expect(board!.querySelectorAll(".station-mark")).toHaveLength(0);
    expect(board!.querySelectorAll(".continent-callout")).toHaveLength(6);
    expect(document.getElementById("alaska")).toBeTruthy();
  });

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

  it("runs setup through the full-screen faction/power takeover with readable labels (UI-1/UI-8)", () => {
    const gs = createGame({
      gameId: "ui-board-click",
      seed: 13,
      players: [
        { id: "u1", name: "Ada" },
        { id: "u2", name: "Lin" },
        { id: "u3", name: "Rex" },
      ],
    });
    const actor = waitingOn(gs)!;
    const faction = contentPack.factions[0];
    const powerId = faction.startingPowers[0];
    const power = contentPack.powers.find((p) => p.id === powerId)!;
    const dispatch = vi.fn();

    render(<GameScreen gs={gs} dispatch={dispatch} onExit={vi.fn()} error={null} />);

    // full-screen takeover with the whose-decision chip; no raw snake_case power ids anywhere (UI-1)
    const takeover = screen.getByRole("dialog", { name: "Faction setup" });
    expect(within(takeover).getByText(gs.players[actor].name)).toBeTruthy();
    for (const f of contentPack.factions) {
      expect(within(takeover).getByText(f.name)).toBeTruthy();
      for (const pw of f.startingPowers) expect(screen.queryByText(pw)).toBeNull();
    }

    // faction step → power step (readable name + rules text) → takeover closes to the board
    fireEvent.click(screen.getByText(faction.name));
    fireEvent.click(screen.getByText(power.name));
    expect(screen.queryByRole("dialog", { name: "Faction setup" })).toBeNull();
    expect(screen.getByText(/click a highlighted territory/i)).toBeTruthy();

    fireEvent.click(document.getElementById("alaska")!);
    expect(dispatch).toHaveBeenCalledWith({
      type: "setup.choose",
      playerId: actor,
      factionId: faction.id,
      territoryId: "alaska",
      powerId,
    });
  });

  it("recruit phase controls live in the bottom action bar, not the rail (UI-2)", () => {
    let gs = throughSetup(83);
    const pid = waitingOn(gs)!;
    gs = applyAction(gs, { type: "start.done", playerId: pid });
    render(<Harness initial={gs} />);

    const bar = document.querySelector("[data-action-bar]") as HTMLElement;
    expect(bar).toBeTruthy();
    expect(within(bar).getByText(`to place: ${current.recruit!.remaining}`)).toBeTruthy();
    const rail = document.querySelector("aside") as HTMLElement;
    expect(within(rail).queryByText(/to place/)).toBeNull(); // the rail is ambient only

    // board clicks place via the stepper count; TO ATTACK advances the phase
    const mine = Object.entries(current.territories).find(([, t]) => t.controller === pid)![0];
    const start = current.recruit!.remaining;
    for (let i = 0; i < start; i++) fireEvent.click(document.getElementById(mine)!);
    expect(current.recruit!.remaining).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "TO ATTACK" }));
    expect(current.phase).toBe("expand_attack");
    expect(screen.getByRole("button", { name: "END ATTACKS" })).toBeTruthy();
  });

  it("battle log is a collapsed rail tab that windows long logs (UI-2)", () => {
    const gs = throughSetup(89);
    for (let i = 1; i <= 300; i++) gs.log.push({ seq: gs.eventSeq + i, type: "SyntheticEvent" });

    render(<GameScreen gs={gs} dispatch={vi.fn()} onExit={vi.fn()} error={null} />);
    expect(screen.queryByTestId("ledger-log")).toBeNull(); // collapsed by default
    fireEvent.click(screen.getByText("BATTLE LOG"));

    const log = screen.getByTestId("ledger-log");
    expect(log.querySelectorAll("div").length).toBeLessThanOrEqual(50); // latest window only
    fireEvent.click(screen.getByText(/earlier \d+ events/));
    expect(screen.getByTestId("ledger-log").querySelectorAll("div")).toHaveLength(gs.log.length);
  });
});

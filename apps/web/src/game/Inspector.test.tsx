// @vitest-environment jsdom
// new (UI-3): the territory inspector — attack-source target verdicts and setup placement
// guidance (illegal starts never dispatch; the inspector explains why).
import "../test-shims.ts";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { contentPack } from "@risk/content";
import { applyAction, createGame, isLegalStart, waitingOn, type Action, type GameState } from "@risk/rules";
import { manifest } from "@risk/map";
import GameScreen from "./GameScreen.tsx";
import { powerById, territoryName } from "./labels.ts";
import { atExpandAttack } from "./test-fixtures.ts";

afterEach(cleanup);

let current: GameState;
function Harness({ initial }: { initial: GameState }) {
  const [gs, setGs] = useState(initial);
  current = gs;
  const dispatch = (a: Action) => setGs((s) => (current = applyAction(s, a)));
  return <GameScreen gs={gs} dispatch={dispatch} onExit={() => {}} error={null} />;
}

describe("territory inspector (UI-3)", () => {
  it("selecting an attack source lists adjacent targets with explicit consequences", () => {
    const { gs, mine, target, enemy } = atExpandAttack(103);
    render(<Harness initial={gs} />);

    fireEvent.click(document.getElementById(mine)!);
    const inspector = screen.getByTestId("inspector");
    expect(within(inspector).getByText(territoryName(mine))).toBeTruthy();
    expect(within(inspector).getByText(/Attack source/)).toBeTruthy();
    // the enemy outpost reads as an attack with its defender count; empty neighbors as expands
    expect(within(inspector).getByText(`attack ${gs.players[enemy].name} (1 defending)`)).toBeTruthy();
    expect(within(inspector).getAllByText(/expand \(/).length).toBeGreaterThan(0);

    // clicking the target commits the declaration — the combat overlay takes over from there
    fireEvent.click(document.getElementById(target)!);
    expect(current.combat?.to).toBe(target);
    expect(screen.getByRole("dialog", { name: "Combat" })).toBeTruthy();
    expect(within(screen.getByTestId("inspector")).getByText(territoryName(target))).toBeTruthy();
  });

  it("setup: an illegal start never dispatches and the inspector explains why", () => {
    let gs = createGame({
      gameId: "ui3-setup", seed: 7,
      players: [{ id: "u1", name: "Ada" }, { id: "u2", name: "Lin" }, { id: "u3", name: "Rex" }],
    });
    const first = waitingOn(gs)!;
    const f1 = contentPack.factions[0];
    const taken = manifest.territories.find((t) => isLegalStart(gs, t.id, true, f1.id, first))!.id;
    gs = applyAction(gs, { type: "setup.choose", playerId: first, factionId: f1.id, territoryId: taken, powerId: f1.startingPowers[0] });

    render(<Harness initial={gs} />);
    const actor = waitingOn(current)!;
    const f2 = contentPack.factions[1];
    fireEvent.click(screen.getByText(f2.name));
    fireEvent.click(screen.getByText(powerById(f2.startingPowers[0])!.name));

    // clicking the first player's territory is illegal — no dispatch, reason in the inspector
    fireEvent.click(document.getElementById(taken)!);
    expect(current.players[actor].factionId).toBeUndefined();
    const inspector = screen.getByTestId("inspector");
    expect(within(inspector).getByText(/already claimed/)).toBeTruthy();

    // a legal territory still places normally
    const legal = manifest.territories.find((t) => isLegalStart(current, t.id, true, f2.id, actor))!.id;
    fireEvent.click(document.getElementById(legal)!);
    expect(current.players[actor].factionId).toBe(f2.id);
  });
});

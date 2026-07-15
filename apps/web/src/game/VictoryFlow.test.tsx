// @vitest-environment jsdom
// new (UI-12): the end-game ritual — victory beat → signing → reward modal in claim order
// (board-targeted rewards drop to the board) → envelope reveal → aftermath; and the
// scar-play card flow from the hand strip to a circular board chip.
import "../test-shims.ts";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { applyAction, type Action, type GameState } from "@risk/rules";
import { manifest } from "@risk/map";
import GameScreen from "./GameScreen.tsx";
import { atExpandAttack, driveToVictory } from "./test-fixtures.ts";

afterEach(cleanup);

let current: GameState;
function Harness({ initial }: { initial: GameState }) {
  const [gs, setGs] = useState(initial);
  current = gs;
  const dispatch = (a: Action) => setGs((s) => (current = applyAction(s, a)));
  return <GameScreen gs={gs} dispatch={dispatch} onExit={() => {}} error={null} />;
}

describe("victory & reward flow (UI-12)", () => {
  it("victory beat → signing → reward modal claim order → board-targeted naming → aftermath", () => {
    const gs = driveToVictory(97);
    const winner = gs.winner!;
    expect(gs.rewards?.committed).toBe(false);
    render(<Harness initial={gs} />);

    // victory beat: full-screen takeover with the winner's emblem
    const victory = screen.getByRole("dialog", { name: "Victory" });
    expect(victory.querySelector(`[data-emblem="${gs.players[winner].factionId}"]`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "SIGN THE BOARD" }));

    // signing moment: the winner's name in a handwriting face
    expect(screen.getByTestId("signature").textContent).toBe(gs.players[winner].name);
    fireEvent.click(screen.getByRole("button", { name: "CLAIM THE SPOILS" }));

    // reward modal: the winner decides first
    let modal = screen.getByRole("dialog", { name: "Rewards" });
    expect(within(modal).getByText(gs.players[winner].name)).toBeTruthy();

    // board-targeted reward: name a continent — glow → click → name → confirm
    fireEvent.click(within(modal).getByRole("button", { name: /Name a Continent/ }));
    expect(screen.queryByRole("dialog", { name: "Rewards" })).toBeNull(); // dropped to the board
    const unnamed = manifest.continents.find((c) => !current.continents[c.id]?.name)!;
    const tid = manifest.territories.find((t) => t.continent === unnamed.id)!.id;
    fireEvent.click(document.getElementById(tid)!);
    fireEvent.change(screen.getByPlaceholderText("enter a name"), { target: { value: "New Ada Land" } });
    fireEvent.click(screen.getByRole("button", { name: "CONFIRM" }));
    expect(current.continents[unnamed.id]?.name).toBe("New Ada Land");

    // the claim order walks the held-on claimants, whose-decision chip per claimant
    let guard = 8;
    while (current.rewards && !current.rewards.committed && guard-- > 0) {
      const claimant = current.rewards.order[current.rewards.nextIdx];
      modal = screen.getByRole("dialog", { name: "Rewards" });
      expect(within(modal).getByText(current.players[claimant].name)).toBeTruthy();
      fireEvent.click(within(modal).getByRole("button", { name: "PASS" }));
    }
    expect(current.rewards?.committed).toBe(true);

    while (current.contentRequired.length > 0) {
      const requirement = current.contentRequired[0];
      const item = requirement.items[0];
      expect(screen.getByRole("dialog", { name: "Sealed content required" })).toBeTruthy();
      fireEvent.change(screen.getByLabelText(`Sealed content: ${requirement.moduleId}.${item}`), {
        target: { value: `Host-entered ${item}` },
      });
      fireEvent.click(screen.getByRole("button", { name: "SAVE & RESUME" }));
    }
    while (current.comebackChoice) {
      const option = current.comebackChoice.options[0];
      const modal = screen.getByRole("dialog", { name: "Choose a comeback power" });
      fireEvent.click(within(modal).getByRole("button", { name: new RegExp(option.title) }));
    }

    // envelope reveal only when a module unlocked this game; then the aftermath
    const envelope = screen.queryByRole("dialog", { name: "Sealed pack" });
    if (envelope) {
      fireEvent.click(screen.getByRole("button", { name: "TEAR OPEN" }));
      fireEvent.click(screen.getByRole("button", { name: "CONTINUE" }));
    }
    const aftermath = screen.getByRole("dialog", { name: "Aftermath" });
    expect(within(aftermath).getByText(/New Ada Land/)).toBeTruthy(); // world-change recap
    expect(within(aftermath).getByText("WON")).toBeTruthy();
  });

  it("a module unlock shows the envelope tear-open reveal before the aftermath", () => {
    const gs = driveToVictory(97);
    // resolve rewards synthetically and stage a revealed module after the win
    gs.rewards = { order: gs.rewards!.order, nextIdx: gs.rewards!.order.length, committed: true };
    gs.log.push({ seq: ++gs.eventSeq, type: "ModuleRevealed", data: { moduleId: "pack_3", name: "Pack 3 — Homelands" } });

    render(<Harness initial={gs} />);
    expect(screen.getByRole("dialog", { name: "Sealed pack" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "TEAR OPEN" }));
    expect(screen.getByText("Pack 3 — Homelands")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "CONTINUE" }));
    expect(screen.getByRole("dialog", { name: "Aftermath" })).toBeTruthy();
    expect(screen.getByText(/SEALED PACK OPENED/)).toBeTruthy();
  });

  it("keeps Game 15 open until the selected player names the completed world", () => {
    const gs = driveToVictory(99);
    const winner = gs.winner!;
    gs.gameNumber = 15;
    gs.rewards = { order: gs.rewards!.order, nextIdx: gs.rewards!.order.length, committed: true };
    gs.worldCompletion = { namingPlayerId: winner };
    render(<Harness initial={gs} />);

    expect(screen.getByRole("dialog", { name: "Name the completed world" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Completed world name"), { target: { value: "Aeternum" } });
    fireEvent.click(screen.getByRole("button", { name: "SEAL THE NAME" }));

    expect(current.worldCompletion?.name).toBe("Aeternum");
    expect(current.worldName).toBe("Aeternum");
    expect(screen.getByRole("dialog", { name: "Aftermath" })).toBeTruthy();
    expect(screen.getByText(/completed and named the world/)).toBeTruthy();
  });

  it("a held scar plays as a card from the strip onto the board as a circular chip", () => {
    const { gs, pid } = atExpandAttack(101);
    const scar = gs.players[pid].scarHand[0];
    expect(scar).toBeTruthy(); // starter scars dealt at setup
    render(<Harness initial={gs} />);

    // the strip renders the held scar as a full-art card; clicking opens the play modal
    fireEvent.click(screen.getByRole("button", { name: /^Play / }));
    const modal = screen.getByRole("dialog", { name: /^Play / });
    expect(within(modal).getByText(/Target:/)).toBeTruthy();
    fireEvent.click(within(modal).getByRole("button", { name: "CHOOSE TERRITORY" }));
    expect(screen.getByText(/without an HQ or scar/i)).toBeTruthy();

    const hqTerritoryId = manifest.territories.find((t) => current.territories[t.id].hqFaction)!.id;
    fireEvent.click(document.getElementById(hqTerritoryId)!);
    expect(screen.getByRole("button", { name: "CONFIRM" }).hasAttribute("disabled")).toBe(true);

    const tid = manifest.territories.find((t) => {
      const territory = current.territories[t.id];
      return !territory.hqFaction && territory.scars.length === 0;
    })!.id;
    const before = current.territories[tid].scars.length;
    fireEvent.click(document.getElementById(tid)!);
    expect(current.territories[tid].scars).toHaveLength(before);
    fireEvent.click(screen.getByRole("button", { name: "CONFIRM" }));
    expect(current.territories[tid].scars).toContain(scar.scarId);
    expect(current.players[pid].scarHand).toHaveLength(0);
  });
});

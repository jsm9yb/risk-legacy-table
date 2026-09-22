// @vitest-environment jsdom
// the combat overlay drives dice choice → roll → missile window → casualties →
// move-in through the real action API; turn decisions render in the bottom dock.
import "../test-shims.ts";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { applyAction, type Action, type GameState } from "@risk/rules";
import GameScreen from "./GameScreen.tsx";
import CombatOverlay from "./CombatOverlay.tsx";
import { territoryName } from "./labels.ts";
import { atExpandAttack, throughSetup } from "./test-fixtures.ts";

afterEach(cleanup);

// Hot-seat harness over the REAL engine: any illegal dispatch throws and fails the test.
let current: GameState;
function Harness({ initial }: { initial: GameState }) {
  const [gs, setGs] = useState(initial);
  current = gs;
  const dispatch = (a: Action) => setGs((s) => (current = applyAction(s, a)));
  return <GameScreen gs={gs} dispatch={dispatch} onExit={() => {}} error={null} />;
}

const attackDiceBtn = () =>
  screen.queryByRole("button", { name: "Attack with 3 dice" }) ??
  screen.queryByRole("button", { name: "Attack with 2 dice" }) ??
  screen.queryByRole("button", { name: "Attack with 1 die" });

describe("combat overlay (UI-8)", () => {
  it("holds combat controls while the table director resolves the roll", () => {
    let { gs, pid, mine, target } = atExpandAttack(44);
    gs = applyAction(gs, { type: "attack.declare", playerId: pid, from: mine, to: target });
    const view = render(<CombatOverlay gs={gs} dispatch={() => {}} canActFor={() => true} autoDefend={{}} onAutoDefend={() => {}} presentationBusy />);
    expect(screen.getByRole("status").textContent).toBe("Resolving on the table…");
    expect((screen.getByRole("button", { name: "WITHDRAW" }).closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
    view.rerender(<CombatOverlay gs={gs} dispatch={() => {}} canActFor={() => true} autoDefend={{}} onAutoDefend={() => {}} presentationBusy={false} />);
    expect((screen.getByRole("button", { name: "WITHDRAW" }).closest("fieldset") as HTMLFieldSetElement).disabled).toBe(false);
  });

  it("keeps animation skip usable while combat controls are held", () => {
    let { gs, pid, mine, target } = atExpandAttack(44);
    gs = applyAction(gs, { type: "attack.declare", playerId: pid, from: mine, to: target });
    const skip = vi.fn();
    render(<CombatOverlay gs={gs} dispatch={() => {}} canActFor={() => true} autoDefend={{}} onAutoDefend={() => {}}
      presentationBusy canSkipPresentation onSkipPresentation={skip} />);
    const button = screen.getByRole("button", { name: "SKIP ANIMATION" });
    expect(button.closest("fieldset")).toBeNull();
    fireEvent.click(button);
    expect(skip).toHaveBeenCalledOnce();
  });

  it("lets the network defender play a scar before choosing defense dice", () => {
    let { gs, pid, mine, target, enemy } = atExpandAttack(44);
    gs.players[enemy].scarHand = [{ instanceId: "defender-bunker", scarId: "bunker" }];
    gs.players[enemy].scarCardCount = 1;
    gs = applyAction(gs, { type: "attack.declare", playerId: pid, from: mine, to: target });
    gs = applyAction(gs, { type: "attack.chooseAttackers", playerId: pid, count: 1 });
    function Defender() {
      const [state, setState] = useState(gs);
      current = state;
      return <GameScreen gs={state} viewer={enemy} dispatch={(action) => setState((previous) => applyAction(previous, action))} onExit={() => {}} error={null} />;
    }
    render(<Defender />);
    const combat = screen.getByRole("dialog", { name: "Combat" });
    fireEvent.click(within(combat).getByRole("button", { name: `${gs.players[enemy].name}: Bunker` }));
    expect(screen.queryByRole("dialog", { name: "Combat" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "CHOOSE TERRITORY" }));
    fireEvent.click(document.getElementById(target)!);
    fireEvent.click(screen.getByRole("button", { name: "CONFIRM" }));
    expect(current.territories[target].scars).toContain("bunker");
    expect(current.players[enemy].scarHand).toHaveLength(0);
    expect(current.combat?.natural).toBeUndefined();
    expect(screen.getByRole("dialog", { name: "Combat" })).toBeTruthy();
  });

  it("drives declare → dice choice → auto-defend roll → attack again → move-in to conquest", () => {
    const { gs, pid, mine, target } = atExpandAttack(41);
    render(<Harness initial={gs} />);

    // declaring an attack on the board opens the centered combat overlay
    fireEvent.click(document.getElementById(mine)!);
    fireEvent.click(document.getElementById(target)!);
    const dialog = screen.getByRole("dialog", { name: "Combat" });
    expect(dialog.closest("[data-battle-tray]")).toBeTruthy();
    expect(within(dialog).getByText(new RegExp(territoryName(target)))).toBeTruthy();
    expect(current.combat).toBeTruthy();

    // Each attack starts at zero until the player chooses a legal count.
    // MIN/MAX are quick presets, while Enter submits the highlighted number.
    const attackers = screen.getByRole("spinbutton", { name: "Attacking troops" }) as HTMLInputElement;
    expect(attackers.value).toBe("0");
    expect((screen.getByRole("button", { name: "Attack with 0 dice" }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.activeElement).toBe(attackers);
    fireEvent.click(screen.getByRole("button", { name: "Use minimum attackers" }));
    expect(attackers.value).toBe("1");
    expect(screen.getByLabelText("Selected attack dice").querySelectorAll("[data-table-anchor='die']")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Use maximum attackers" }));
    expect(attackers.value).toBe("3");
    expect(screen.getByLabelText("Selected attack dice").querySelectorAll("[data-table-anchor='die']")).toHaveLength(3);
    fireEvent.keyDown(attackers, { key: "Enter", code: "Enter" });

    // The defender decision then enables auto-defend (max dice), which dispatches
    // the defender choice and rolls immediately.
    fireEvent.click(screen.getByLabelText("Auto-defend with max dice"));
    expect(current.log.some((e) => e.type === "DiceRolled")).toBe(true);
    expect(document.querySelector("[data-roll-outcome]")).toBeTruthy();
    expect(document.querySelectorAll("[data-die-face]").length).toBeGreaterThan(0);
    expect(document.querySelector("[data-casualty-delta='att']")).toBeTruthy();
    expect(document.querySelector("[data-casualty-delta='def']")).toBeTruthy();
    const comparisons = screen.getByRole("list", { name: "Resolved dice comparisons" });
    const resolvedRoll = current.log.filter((event) => event.type === "CombatResolved").at(-1)!;
    expect(within(comparisons).getAllByRole("listitem")).toHaveLength((resolvedRoll.data as { comparisons: unknown[] }).comparisons.length);

    // siege loop: ATTACK AGAIN re-arms the same battle until the single defender falls
    for (let i = 0; i < 30; i++) {
      const moveInPicker = screen.queryByRole("button", { name: "Choose Move-in troops" });
      if (moveInPicker) {
        expect(document.querySelector("[data-roll-outcome]")).toBeTruthy();
        fireEvent.click(moveInPicker);
        fireEvent.click(screen.getByRole("button", { name: "MOVE IN" }));
        break;
      }
      const again = screen.queryByRole("button", { name: "ATTACK AGAIN" });
      if (again) { fireEvent.click(again); continue; }
      const maximum = screen.queryByRole("button", { name: "Use maximum attackers" });
      if (maximum) fireEvent.click(maximum);
      const dice = attackDiceBtn();
      if (dice) { fireEvent.click(dice); continue; }
      throw new Error("combat overlay offered no next step");
    }

    // conquest completed through the real action API and the overlay closed
    expect(current.territories[target].controller).toBe(pid);
    expect(current.log.some((e) => e.type === "TerritoryConquered")).toBe(true);
    expect(screen.queryByRole("dialog", { name: "Combat" })).toBeNull();
  });

  it("interrupts the roll with an explicit missile modifier window", () => {
    const { gs, pid, mine, target } = atExpandAttack(43);
    const defender = gs.territories[target].controller!;
    const observer = gs.turnOrder.find((playerId) => playerId !== pid && playerId !== defender)!;
    gs.players[observer].missiles = 2;
    render(<Harness initial={gs} />);

    fireEvent.click(document.getElementById(mine)!);
    fireEvent.click(document.getElementById(target)!);
    fireEvent.click(screen.getByRole("button", { name: "Use maximum attackers" }));
    fireEvent.click(screen.getByRole("button", { name: "Attack with 3 dice" }));
    fireEvent.click(screen.getByRole("button", { name: "Defend with 1 die" }));

    // the roll happened but is NOT resolved — the window interrupts
    expect(screen.getByText("MISSILE WINDOW")).toBeTruthy();
    expect(current.combat?.window).toBeTruthy();
    expect(current.log.some((e) => e.type === "CombatResolved")).toBe(false);

    // spend one missile, then pass — the roll resolves with an unmodifiable 6
    fireEvent.click(screen.getAllByRole("button", { name: /^Missile: set attack die/ })[0]);
    expect(current.players[observer].missiles).toBe(1);
    expect(screen.getByRole("list", { name: "Missile interventions" }).textContent).toContain(`${gs.players[observer].name} intervened`);
    expect(document.querySelector("[data-die-change]")?.textContent).toContain("→ 6");
    expect(screen.getByText("MISSILE WINDOW")).toBeTruthy(); // still holding a missile — window persists
    fireEvent.click(screen.getByRole("button", { name: "PASS" }));

    expect(screen.queryByText("MISSILE WINDOW")).toBeNull();
    expect(document.querySelector("[data-roll-outcome]")).toBeTruthy();
    expect(document.querySelectorAll("[data-die-face]").length).toBeGreaterThan(0);
    const resolved = current.log.filter((e) => e.type === "CombatResolved").at(-1)!;
    expect((resolved.data as any).final.att).toContain(6);
  });

  it("renders start-of-turn decisions in the bottom dock", () => {
    const gs = throughSetup(47);
    render(<Harness initial={gs} />);

    const dock = screen.getByRole("dialog", { name: "Start of turn" });
    fireEvent.click(within(dock).getByRole("button", { name: "BEGIN RECRUITMENT" }));
    expect(current.phase).toBe("join_or_recruit");
    expect(screen.queryByRole("dialog", { name: "Start of turn" })).toBeNull();
  });
});

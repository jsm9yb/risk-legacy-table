// @vitest-environment jsdom
// new (UI-8): the combat overlay drives dice choice → roll → missile window → casualties →
// move-in through the real action API; turn decisions render in the bottom dock.
import "../test-shims.ts";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { contentPack } from "@risk/content";
import { applyAction, createGame, isLegalStart, waitingOn, type Action, type GameState } from "@risk/rules";
import { manifest, territoryById } from "@risk/map";
import GameScreen from "./GameScreen.tsx";
import { territoryName } from "./labels.ts";

afterEach(cleanup);

// Hot-seat harness over the REAL engine: any illegal dispatch throws and fails the test.
let current: GameState;
function Harness({ initial }: { initial: GameState }) {
  const [gs, setGs] = useState(initial);
  current = gs;
  const dispatch = (a: Action) => setGs((s) => (current = applyAction(s, a)));
  return <GameScreen gs={gs} dispatch={dispatch} onExit={() => {}} error={null} />;
}

function throughSetup(seed: number): GameState {
  let gs = createGame({
    gameId: `combat-ui-${seed}`,
    seed,
    players: [
      { id: "u1", name: "Ada" },
      { id: "u2", name: "Lin" },
      { id: "u3", name: "Rex" },
    ],
  });
  while (gs.phase === "setup") {
    const pid = waitingOn(gs)!;
    const faction = contentPack.factions.find((f) => !Object.values(gs.players).some((x) => x.factionId === f.id))!;
    const start = manifest.territories.find((t) => isLegalStart(gs, t.id, true, faction.id, pid))!;
    gs = applyAction(gs, {
      type: "setup.choose", playerId: pid, factionId: faction.id, territoryId: start.id,
      powerId: gs.factionPowers[faction.id] ? undefined : faction.startingPowers[0],
    });
  }
  return gs;
}

/** Real actions to expand_attack, then plant a 1-troop enemy outpost next to the attacker's stack. */
function atExpandAttack(seed: number) {
  let gs = throughSetup(seed);
  const pid = waitingOn(gs)!;
  gs = applyAction(gs, { type: "start.done", playerId: pid });
  const mine = Object.entries(gs.territories).find(([, t]) => t.controller === pid)![0];
  gs = applyAction(gs, { type: "recruit.place", playerId: pid, territoryId: mine, count: gs.recruit!.remaining });
  gs = applyAction(gs, { type: "recruit.done", playerId: pid });
  const enemy = gs.turnOrder.find((x) => x !== pid)!;
  const target = territoryById(mine).neighbors.find((n) => !gs.territories[n].controller)!;
  gs.territories[target] = { controller: enemy, troops: 1, scars: [] };
  return { gs, pid, mine, target, enemy };
}

const attackDiceBtn = () =>
  screen.queryByRole("button", { name: "Attack with 3 dice" }) ??
  screen.queryByRole("button", { name: "Attack with 2 dice" }) ??
  screen.queryByRole("button", { name: "Attack with 1 die" });

describe("combat overlay (UI-8)", () => {
  it("drives declare → dice choice → auto-defend roll → attack again → move-in to conquest", () => {
    const { gs, pid, mine, target } = atExpandAttack(41);
    render(<Harness initial={gs} />);

    // declaring an attack on the board opens the centered combat overlay
    fireEvent.click(document.getElementById(mine)!);
    fireEvent.click(document.getElementById(target)!);
    const dialog = screen.getByRole("dialog", { name: "Combat" });
    expect(within(dialog).getByText(new RegExp(territoryName(target)))).toBeTruthy();
    expect(current.combat).toBeTruthy();

    // attacker picks 3 dice; the defender decision then enables auto-defend (max dice),
    // which dispatches the defender choice and rolls immediately
    fireEvent.click(screen.getByRole("button", { name: "Attack with 3 dice" }));
    fireEvent.click(screen.getByLabelText("Auto-defend with max dice"));
    expect(current.log.some((e) => e.type === "DiceRolled")).toBe(true);

    // siege loop: ATTACK AGAIN re-arms the same battle until the single defender falls
    for (let i = 0; i < 30; i++) {
      const moveIn = screen.queryByRole("button", { name: /^MOVE IN/ });
      if (moveIn) { fireEvent.click(moveIn); break; }
      const again = screen.queryByRole("button", { name: "ATTACK AGAIN" });
      if (again) { fireEvent.click(again); continue; }
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
    gs.players[pid].missiles = 2;
    render(<Harness initial={gs} />);

    fireEvent.click(document.getElementById(mine)!);
    fireEvent.click(document.getElementById(target)!);
    fireEvent.click(screen.getByRole("button", { name: "Attack with 3 dice" }));
    fireEvent.click(screen.getByRole("button", { name: "Defend with 1 die" }));

    // the roll happened but is NOT resolved — the window interrupts
    expect(screen.getByText("MISSILE WINDOW")).toBeTruthy();
    expect(current.combat?.window).toBeTruthy();
    expect(current.log.some((e) => e.type === "CombatResolved")).toBe(false);

    // spend one missile, then pass — the roll resolves with an unmodifiable 6
    fireEvent.click(screen.getAllByRole("button", { name: /^Missile: set attack die/ })[0]);
    expect(current.players[pid].missiles).toBe(1);
    expect(screen.getByText("MISSILE WINDOW")).toBeTruthy(); // still holding a missile — window persists
    fireEvent.click(screen.getByRole("button", { name: "PASS" }));

    expect(screen.queryByText("MISSILE WINDOW")).toBeNull();
    const resolved = current.log.filter((e) => e.type === "CombatResolved").at(-1)!;
    expect((resolved.data as any).final.att).toContain(6);
  });

  it("renders start-of-turn decisions in the bottom dock", () => {
    const gs = throughSetup(47);
    render(<Harness initial={gs} />);

    const dock = screen.getByRole("dialog", { name: "Start of turn" });
    fireEvent.click(within(dock).getByRole("button", { name: "CONTINUE" }));
    expect(current.phase).toBe("join_or_recruit");
    expect(screen.queryByRole("dialog", { name: "Start of turn" })).toBeNull();
  });
});

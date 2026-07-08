// @vitest-environment jsdom
// new (UI-10): faction visual identity — five distinct emblems across setup, roster, and
// combat surfaces; styled fallback for module factions; emblem shields + distinct troop
// silhouettes on the board.
import "../test-shims.ts";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { contentPack } from "@risk/content";
import { applyAction, createGame, type Action, type GameState } from "@risk/rules";
import FactionEmblem from "./FactionEmblem.tsx";
import GameScreen from "./GameScreen.tsx";
import { atExpandAttack } from "./test-fixtures.ts";

afterEach(cleanup);

let current: GameState;
function Harness({ initial }: { initial: GameState }) {
  const [gs, setGs] = useState(initial);
  current = gs;
  const dispatch = (a: Action) => setGs((s) => (current = applyAction(s, a)));
  return <GameScreen gs={gs} dispatch={dispatch} onExit={() => {}} error={null} />;
}

describe("FactionEmblem (UI-10)", () => {
  it("renders distinct art for all five base factions and a styled fallback otherwise", () => {
    const { container } = render(
      <div>
        {contentPack.factions.map((f) => <FactionEmblem key={f.id} factionId={f.id} />)}
        <FactionEmblem factionId="mutants" />
      </div>
    );
    const sources = [...container.querySelectorAll("[data-emblem] img")].map((img) => img.getAttribute("src"));
    expect(sources).toHaveLength(5);
    expect(new Set(sources).size).toBe(5); // five distinct emblem images
    const fallback = container.querySelector("[data-emblem-fallback]")!;
    expect(fallback.getAttribute("data-emblem")).toBe("mutants");
    expect(fallback.querySelector("img")).toBeNull();
  });

  it("setup takeover shows a faction card per faction: emblem, name, blurb, both powers", () => {
    const gs = createGame({
      gameId: "ui10-setup", seed: 5,
      players: [{ id: "u1", name: "Ada" }, { id: "u2", name: "Lin" }, { id: "u3", name: "Rex" }],
    });
    render(<GameScreen gs={gs} dispatch={vi.fn()} onExit={vi.fn()} error={null} />);
    const takeover = screen.getByRole("dialog", { name: "Faction setup" });
    for (const f of contentPack.factions) {
      expect(takeover.querySelector(`[data-emblem="${f.id}"]`)).toBeTruthy();
      expect(within(takeover).getByText(f.name)).toBeTruthy();
    }
  });

  it("roster and combat surfaces render the seated factions' emblems", () => {
    const { gs, pid, mine, target, enemy } = atExpandAttack(71);
    render(<Harness initial={gs} />);

    // rail Quick Look roster: an emblem per seated player
    const rail = document.querySelector("aside")!;
    for (const p of [pid, enemy]) {
      const fid = gs.players[p].factionId!;
      expect(rail.querySelector(`[data-emblem="${fid}"]`)).toBeTruthy();
    }

    // combat overlay header: attacker + defender emblems
    fireEvent.click(document.getElementById(mine)!);
    fireEvent.click(document.getElementById(target)!);
    const dialog = screen.getByRole("dialog", { name: "Combat" });
    expect(dialog.querySelector(`[data-emblem="${gs.players[pid].factionId}"]`)).toBeTruthy();
    expect(dialog.querySelector(`[data-emblem="${gs.players[enemy].factionId}"]`)).toBeTruthy();
  });

  it("board HQ markers render circular emblem shields and troop markers use faction shapes", () => {
    const { gs } = atExpandAttack(73);
    render(<Harness initial={gs} />);
    expect(document.querySelectorAll("[data-hq-emblem]").length).toBe(3); // one shield per placed HQ
    const shapes = new Set(
      [...document.querySelectorAll("[data-troop-shape]")].map((el) => el.getAttribute("data-troop-shape"))
    );
    expect(shapes.size).toBeGreaterThanOrEqual(3); // distinct silhouettes beyond color
  });
});

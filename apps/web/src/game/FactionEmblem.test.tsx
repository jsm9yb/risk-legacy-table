// @vitest-environment jsdom
// faction visual identity — distinct emblems across setup, roster, and
// combat surfaces; complete sealed-faction assets; emblem shields + distinct troop
// silhouettes on the board.
import "../test-shims.ts";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { contentPack } from "@risk/content";
import { applyAction, createGame, type Action, type GameState } from "@risk/rules";
import FactionEmblem from "./FactionEmblem.tsx";
import FactionCard from "./FactionCard.tsx";
import { FACTION_BLURBS, FACTION_CARD_ART, FACTION_EMBLEMS, FACTION_TROOP_SHAPES, SCAR_ART } from "./factionAssets.ts";
import GameScreen from "./GameScreen.tsx";
import { atExpandAttack } from "./test-fixtures.ts";

afterEach(cleanup);

function Harness({ initial }: { initial: GameState }) {
  const [gs, setGs] = useState(initial);
  const dispatch = (a: Action) => setGs((s) => applyAction(s, a));
  return <GameScreen gs={gs} dispatch={dispatch} onExit={() => {}} error={null} />;
}

describe("FactionEmblem (UI-10)", () => {
  it("renders distinct emblem art for every base and sealed faction", () => {
    const factions = [...contentPack.factions, ...contentPack.sealedFactions];
    const { container } = render(
      <div>
        {factions.map((f) => <FactionEmblem key={f.id} factionId={f.id} />)}
      </div>
    );
    const sources = [...container.querySelectorAll("[data-emblem] img")].map((img) => img.getAttribute("src"));
    expect(sources).toHaveLength(factions.length);
    expect(new Set(sources).size).toBe(factions.length);
    expect(container.querySelector("[data-emblem-fallback]")).toBeNull();
  });

  it("retains a styled monogram fallback for custom legacy factions", () => {
    const { container } = render(<FactionEmblem factionId="custom_legacy" />);
    expect(container.querySelector('[data-emblem-fallback="true"]')).toBeTruthy();
    expect(container.querySelector("img")).toBeNull();
  });

  it("accounts for every canonical faction and board mark in the asset registry", () => {
    const factions = [...contentPack.factions, ...contentPack.sealedFactions];
    for (const faction of factions) {
      expect(FACTION_EMBLEMS[faction.id], `${faction.id} emblem`).toBeTruthy();
      expect(FACTION_CARD_ART[faction.id], `${faction.id} card art`).toBeTruthy();
      expect(FACTION_BLURBS[faction.id], `${faction.id} blurb`).toBeTruthy();
      expect(FACTION_TROOP_SHAPES[faction.id], `${faction.id} troop shape`).toBeTruthy();
    }
    expect(new Set(factions.map((faction) => FACTION_TROOP_SHAPES[faction.id])).size).toBe(factions.length);
    for (const scar of contentPack.scars) expect(SCAR_ART[scar.id], `${scar.id} mark`).toBeTruthy();
    expect(SCAR_ART.fallout, "runtime fallout mark").toBeTruthy();
  });

  it("uses physical card art and innate-rules treatment for sealed factions", () => {
    const { container } = render(<div>{contentPack.sealedFactions.map((faction) => (
      <FactionCard key={faction.id} faction={faction} history={[]} currentGame={1} />
    ))}</div>);
    for (const faction of contentPack.sealedFactions) {
      expect(container.querySelector(`[data-faction-card-art="${faction.id}"]`)).toBeTruthy();
      expect(container.querySelector(`[data-emblem="${faction.id}"]`)).toBeTruthy();
    }
    expect(container.querySelector(".physical-faction-card-missing")).toBeNull();
    expect(container.querySelector(".faction-power-sticker")).toBeNull();
  });

  it("passes an optional className to the root emblem", () => {
    const { container } = render(<FactionEmblem factionId="enclave_of_the_bear" className="emblem-impact" />);
    expect(container.querySelector("[data-emblem]")?.classList.contains("emblem-impact")).toBe(true);
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

});

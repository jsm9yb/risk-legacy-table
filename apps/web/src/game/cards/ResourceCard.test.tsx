// @vitest-environment jsdom
// new (UI-9): rendered Resource cards — component contract (territory face with per-continent
// silhouette + coin pips incl. upgrades, coin face, card back), the end-of-turn draw flow on
// card components, and the hidden-hand guarantee against filtered payloads.
import "../../test-shims.ts";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { contentPack } from "@risk/content";
import { applyAction, filterStateFor, type Action, type GameState } from "@risk/rules";
import GameScreen from "../GameScreen.tsx";
import { territoryName } from "../labels.ts";
import { atExpandAttack, conquerOutpost, throughSetup } from "../test-fixtures.ts";
import ResourceCard from "./ResourceCard.tsx";

afterEach(cleanup);

let current: GameState;
function Harness({ initial }: { initial: GameState }) {
  const [gs, setGs] = useState(initial);
  current = gs;
  const dispatch = (a: Action) => setGs((s) => (current = applyAction(s, a)));
  return <GameScreen gs={gs} dispatch={dispatch} onExit={() => {}} error={null} />;
}

describe("ResourceCard (UI-9)", () => {
  const territoryCard = contentPack.cards.territoryCards[0];
  const coinCard = contentPack.cards.coinCards[0];

  it("renders a territory face: name banner, continent silhouette, six coin slots with filled pips", () => {
    const { container } = render(<ResourceCard cardId={territoryCard.id} />);
    expect(screen.getByText(territoryName(territoryCard.territoryId))).toBeTruthy();
    expect(container.querySelector("[data-territory-art]")).toBeTruthy();
    expect(container.querySelector("[data-selected-territory]")).toBeTruthy();
    expect(container.querySelectorAll("[data-coin]")).toHaveLength(6);
    expect(container.querySelectorAll('[data-coin="filled"]')).toHaveLength(territoryCard.resources);
  });

  it("an upgraded card shows its extra coin, drawn identically to base coins", () => {
    const { container } = render(<ResourceCard cardId={territoryCard.id} resources={territoryCard.resources + 1} />);
    const filled = container.querySelectorAll('[data-coin="filled"]');
    expect(filled).toHaveLength(territoryCard.resources + 1);
    // upgraded coins are indistinguishable from base coins (physical-sticker rule)
    const classes = new Set([...filled].map((el) => el.getAttribute("class")));
    expect(classes.size).toBe(1);
  });

  it("renders a coin face as one big coin, and a face-down card as the logo back", () => {
    const coin = render(<ResourceCard cardId={coinCard.id} />);
    expect(coin.container.querySelectorAll('[data-coin="filled"]')).toHaveLength(1);
    expect(coin.container.querySelector("[data-territory-art]")).toBeNull();

    const back = render(<ResourceCard faceDown />);
    expect(back.container.querySelector("[data-card-back]")).toBeTruthy();
    expect(back.container.querySelector("[data-coin]")).toBeNull();
  });

  it("renders board-derived territory art for every territory card", () => {
    for (const card of contentPack.cards.territoryCards) {
      const { container, unmount } = render(<ResourceCard cardId={card.id} size="xs" />);
      expect(container.querySelector("[data-territory-art]")).toBeTruthy();
      expect(container.querySelector(`[data-selected-territory="${card.territoryId}"]`)).toBeTruthy();
      unmount();
    }
  });
});

describe("card flows (UI-9)", () => {
  it("end-of-turn draw renders slot cards and puts the taken card in the hand", () => {
    let { gs, pid } = conquerOutpost(61);
    gs = applyAction(gs, { type: "phase.endAttacks", playerId: pid });
    gs = applyAction(gs, { type: "phase.endManeuver", playerId: pid });
    expect(gs.phase).toBe("end_turn");

    // guarantee a mandatory match in slot 1: a face-up card for a territory the actor controls
    const match = contentPack.cards.territoryCards.find((c) => gs.territories[c.territoryId].controller === pid)!;
    gs.sideboard.slots[0] = match.id;

    render(<Harness initial={gs} />);
    const dock = screen.getByRole("dialog", { name: "End of turn" });
    expect(dock.querySelector(`[data-card-id="${match.id}"]`)).toBeTruthy(); // slots render as card components
    const coinBtn = screen.getByRole("button", { name: "TAKE COIN" }) as HTMLButtonElement;
    expect(coinBtn.disabled).toBe(true); // matching draw is mandatory before coins

    fireEvent.click(screen.getByRole("button", { name: "Take slot 1" }));
    expect(current.players[pid].hand).toContain(match.id);
  });

  it("offers Khan's optional reinforcement on a matching Territory-card draw", () => {
    let { gs, pid } = conquerOutpost(62);
    gs = applyAction(gs, { type: "phase.endAttacks", playerId: pid });
    gs = applyAction(gs, { type: "phase.endManeuver", playerId: pid });
    gs.factionPowers[gs.players[pid].factionId!] = "territory_card_reinforcement";
    const match = contentPack.cards.territoryCards.find((c) => gs.territories[c.territoryId].controller === pid)!;
    gs.sideboard.slots[0] = match.id;
    const before = gs.territories[match.territoryId].troops;

    render(<Harness initial={gs} />);
    fireEvent.click(screen.getByRole("button", { name: "Take slot 1 and reinforce" }));
    expect(current.territories[match.territoryId].troops).toBe(before + 1);
  });

  it("offers Expansionist Supply's optional draw without a conquest", () => {
    const gs = throughSetup(63);
    const pid = gs.turnOrder[0];
    gs.phase = "end_turn";
    gs.expandedThisTurn = 4;
    gs.players[pid].conqueredEnemyThisTurn = false;
    gs.factionPowers[gs.players[pid].factionId!] = "expansionist_supply";

    render(<Harness initial={gs} />);
    expect(screen.getByText(/EXPANSIONIST SUPPLY/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "END TURN WITHOUT DRAW" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "TAKE COIN" })).toBeTruthy();
  });

  it("offers End Turn when a mandatory draw has no remaining source", () => {
    const gs = throughSetup(64);
    const pid = gs.turnOrder[0];
    gs.phase = "end_turn";
    gs.players[pid].conqueredEnemyThisTurn = true;
    gs.sideboard.coinPile = [];
    gs.sideboard.slots = contentPack.cards.territoryCards
      .filter((c) => gs.territories[c.territoryId].controller !== pid)
      .slice(0, 4)
      .map((c) => c.id);

    render(<Harness initial={gs} />);
    expect(screen.getByText(/NO RESOURCE CARD AVAILABLE/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "END TURN" }));
    expect(current.phase).toBe("start_turn");
  });

  it("never renders other players' card faces from filtered payloads; own hand shows in the strip", () => {
    const { gs, pid } = atExpandAttack(67);
    const other = gs.turnOrder.find((x) => x !== pid)!;
    const [mineCard, theirCard] = contentPack.cards.territoryCards
      .map((c) => c.id)
      .filter((id) => !gs.sideboard.slots.includes(id));
    gs.players[pid].hand = [mineCard];
    gs.players[other].hand = [theirCard];

    const filtered = filterStateFor(gs, pid); // the exact server policy
    render(<GameScreen gs={filtered} dispatch={vi.fn()} onExit={vi.fn()} error={null} viewer={pid} />);

    // own face renders in the always-visible hand strip; the other player's never renders
    expect(document.querySelector(`[data-card-id="${mineCard}"]`)).toBeTruthy();
    expect(document.querySelector(`[data-card-id="${theirCard}"]`)).toBeNull();
    // counts stay public in the rail quick look (viewer + the hidden hand both show 1)
    const cardCounts = [...document.querySelectorAll('[data-metric="cards"]')].map((el) => el.textContent);
    expect(cardCounts.filter((text) => text === "1")).toHaveLength(2);
  });
});

// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { territoryCardDefinitions, type GameState } from "@risk/rules";
import { atExpandAttack } from "../test-fixtures.ts";
import SidePanel from "../SidePanel.tsx";
import HandStrip from "../HandStrip.tsx";
import { createPresentationDirector } from "./PresentationDirector.ts";
import { ManualPresentationClock } from "./PresentationClock.ts";
import { RecordingTableSceneAdapter } from "./RecordingTableSceneAdapter.ts";
import { RecordingTableAudioAdapter } from "./TableAudio.ts";

afterEach(cleanup);
const tick = async () => {for (let i = 0; i < 10; i++) await Promise.resolve();};
function Display({state, player}: {state: GameState; player: string}) {
  return <><SidePanel gs={state} actor={player} playerFaction={() => undefined} />
    <HandStrip gs={state} player={player} ui={{placeCount: 1, expandCount: 1, moveCount: 1, selectedCards: []}} setUi={() => {}} selectable={false} /></>;
}

it("keeps the drawn card at its source until flight ends, then exposes the empty slot before refill", async () => {
  const previous = structuredClone(atExpandAttack(931).gs);
  const playerId = previous.turnOrder[previous.activeIdx];
  const [drawn, replacement] = territoryCardDefinitions();
  previous.players[playerId].hand = [];
  previous.sideboard.slots[0] = drawn.id;
  const next = structuredClone(previous);
  next.eventSeq += 2;
  next.players[playerId].hand = [drawn.id];
  next.sideboard.slots[0] = replacement.id;
  const view = render(<Display state={previous} player={playerId} />);
  const clock = new ManualPresentationClock();
  const scene = new RecordingTableSceneAdapter(clock);
  const director = createPresentationDirector(scene, clock, new RecordingTableAudioAdapter(), state => view.rerender(<Display state={state} player={playerId} />));
  const slot = () => view.container.querySelector('[data-table-anchor="sideboard"][data-anchor-id="0"]');
  const hand = () => view.container.querySelector('[data-table-anchor="hand"][data-anchor-priority="2"]');
  await act(async () => {
    director.mount(previous);
    director.submit({previous, next, source: "network", receivedAt: 0, events: [
      {type: "gameplay.present", seq: next.eventSeq - 1, command: {type: "cards.transfer", playerId, kind: "draw", count: 1, slot: 0, source: "territory"}},
      {type: "gameplay.present", seq: next.eventSeq, command: {type: "cards.transfer", playerId, kind: "refill", count: 1}},
    ]});
  });
  expect(slot()?.querySelector('[data-card-id]')?.getAttribute("data-card-id")).toBe(drawn.id);
  expect(hand()?.querySelector('[data-card-id]')).toBeNull();
  await act(async () => {clock.advance(520); await tick();});
  expect(slot()?.querySelector('[data-card-id]')).toBeNull();
  expect(hand()?.querySelector('[data-card-id]')?.getAttribute("data-card-id")).toBe(drawn.id);
  await act(async () => {clock.advance(520); await tick();});
  expect(slot()?.querySelector('[data-card-id]')?.getAttribute("data-card-id")).toBe(replacement.id);
  expect(scene.current).toBe(next);
  director.dispose();
});

it("updates the visible reinforcement reserve only when placed troops land", async () => {
  const previous = structuredClone(atExpandAttack(932).gs);
  const playerId = previous.turnOrder[previous.activeIdx];
  const territoryId = Object.keys(previous.territories).find(id => previous.territories[id].controller === playerId)!;
  previous.phase = "join_or_recruit";
  previous.recruit = {remaining: 5, breakdown: {territories: 3, population: 0, fromTerritories: 5, continents: [], tradeIns: 0, total: 5}};
  const next = structuredClone(previous);
  next.eventSeq++;
  next.recruit!.remaining = 3;
  next.territories[territoryId].troops += 2;
  const view = render(<Display state={previous} player={playerId} />);
  const clock = new ManualPresentationClock();
  const director = createPresentationDirector(new RecordingTableSceneAdapter(clock), clock, new RecordingTableAudioAdapter(), state => view.rerender(<Display state={state} player={playerId} />));
  await act(async () => {
    director.mount(previous);
    director.submit({previous, next, source: "local", receivedAt: 0, events: [{type: "troops.placed", seq: next.eventSeq, playerId, territoryId, count: 2}]});
  });
  expect(screen.getByRole("status", {name: "Reinforcement reserve"}).textContent).toContain("RESERVE · 5");
  await act(async () => {clock.advance(360); await tick();});
  expect(screen.getByRole("status", {name: "Reinforcement reserve"}).textContent).toContain("RESERVE · 3");
  director.dispose();
});

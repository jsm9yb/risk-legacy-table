import { expect, it, vi } from "vitest";
import { atExpandAttack } from "../test-fixtures.ts";
import { RecordingTableSceneAdapter } from "./RecordingTableSceneAdapter.ts";
import { ManualPresentationClock } from "./PresentationClock.ts";
import { RecordingTableAudioAdapter } from "./TableAudio.ts";
import { createPresentationDirector } from "./PresentationDirector.ts";
import { createStateTransition } from "./events.ts";
import { planTransition } from "./planTransition.ts";

function fixture() {
  const clock = new ManualPresentationClock();
  const scene = new RecordingTableSceneAdapter(clock);
  const execute = vi.spyOn(scene, "execute");
  const director = createPresentationDirector(scene, clock, new RecordingTableAudioAdapter());
  const state = atExpandAttack(111).gs;
  director.mount(state);
  return {clock, scene, execute, director, state};
}

it("carries a continent naming location from the real event to the spatial ink command", () => {
  const previous = atExpandAttack(112).gs;
  const seq = previous.eventSeq + 1;
  const next = {...previous, eventSeq: seq, log: [...previous.log,
    {seq, type: "ContinentNamed" as const, playerId: "u1", data: {continentId: "north_america", name: "New Frontier"}}]};
  const plan = planTransition(createStateTransition(previous, next, "local", 0), "full");
  expect(plan.beats[0].commands[0]).toMatchObject({type: "legacy.ritual", ritual: "continent.named", continentId: "north_america", text: "New Frontier"});
});

it("keeps decision feedback nonblocking, deduplicated, and cancels it before gameplay", () => {
  const {director, execute, state} = fixture();
  let blocked = true;
  director.subscribe(s => { blocked = s.inputBlocked; });
  const interaction = {selectedTerritoryId: "alaska", intents: {alberta: "attack"}};
  director.setInteractionState(interaction);
  const feedback = execute.mock.calls.find(([c]) => c.type === "decision.feedback")!;
  expect(feedback[2]).toBe(900);
  expect(blocked).toBe(false);
  director.setInteractionState({...interaction});
  expect(execute.mock.calls.filter(([c]) => c.type === "decision.feedback")).toHaveLength(1);
  director.submit({previous: state, next: {...state, eventSeq: state.eventSeq + 1}, source: "local", receivedAt: 0,
    events: [{type: "module.revealed", seq: state.eventSeq + 1, moduleId: "pocket_1", timing: "mid_game"}]});
  expect(feedback[1].aborted).toBe(true);
  director.setInteractionState({selectedTerritoryId: "alberta", intents: {}});
  expect(execute.mock.calls.filter(([c]) => c.type === "decision.feedback")).toHaveLength(1);
  director.dispose();
});

it("cancels old selections and suppresses spatial feedback for reduced and instant motion", () => {
  const {director, execute} = fixture();
  director.setInteractionState({selectedTerritoryId: "alaska", intents: {}});
  const first = execute.mock.calls[0][1];
  director.setInteractionState({selectedTerritoryId: "alberta", intents: {}});
  expect(first.aborted).toBe(true);
  const second = execute.mock.calls[1][1];
  director.setMotionPreference("reduced");
  expect(second.aborted).toBe(true);
  director.setInteractionState({selectedTerritoryId: "alaska", intents: {}});
  director.setMotionPreference("instant");
  director.setInteractionState({selectedTerritoryId: "alberta", intents: {}});
  expect(execute).toHaveBeenCalledTimes(2);
  director.dispose();
});

import { describe, expect, it } from "vitest";
import { atExpandAttack } from "../test-fixtures.ts";
import { RecordingTableSceneAdapter } from "./RecordingTableSceneAdapter.ts";
import { ManualPresentationClock } from "./PresentationClock.ts";
import { createPresentationDirector } from "./PresentationDirector.ts";
import { RecordingTableAudioAdapter } from "./TableAudio.ts";

const tick = async () => { await Promise.resolve(); await Promise.resolve(); };

describe("Presentation Director", () => {
  it("never commits an aborted transition over a resync or its successor", async () => {
    const clock = new ManualPresentationClock();
    const scene = new RecordingTableSceneAdapter(clock);
    const director = createPresentationDirector(scene, clock, new RecordingTableAudioAdapter());
    const previous = atExpandAttack(115).gs;
    const interrupted = { ...previous, eventSeq: previous.eventSeq + 1 };
    const resynced = { ...previous, eventSeq: previous.eventSeq + 10 };
    const newest = { ...previous, eventSeq: previous.eventSeq + 11 };
    director.mount(previous);
    director.submit({ previous, next: interrupted, source: "network", receivedAt: 0,
      events: [{ type: "module.revealed", seq: interrupted.eventSeq, moduleId: "pocket_1", timing: "mid_game" }] });
    director.settleImmediately(resynced, "reconnect");
    director.submit({ previous: resynced, next: newest, source: "network", receivedAt: 1,
      events: [{ type: "module.revealed", seq: newest.eventSeq, moduleId: "pocket_2", timing: "mid_game" }] });
    for (let i = 0; i < 5; i++) await tick();
    expect(scene.current?.eventSeq).toBe(resynced.eventSeq);
    expect(scene.records).not.toContain(`apply seq=${interrupted.eventSeq}`);
    clock.flush();
    for (let i = 0; i < 5; i++) await tick();
    expect(scene.current?.eventSeq).toBe(newest.eventSeq);
    director.dispose();
  });

  it("does not apply state after disposal interrupts an animation", async () => {
    const clock = new ManualPresentationClock();
    const scene = new RecordingTableSceneAdapter(clock);
    const director = createPresentationDirector(scene, clock, new RecordingTableAudioAdapter());
    const previous = atExpandAttack(116).gs;
    const next = { ...previous, eventSeq: previous.eventSeq + 1 };
    director.mount(previous);
    director.submit({ previous, next, source: "local", receivedAt: 0,
      events: [{ type: "module.revealed", seq: next.eventSeq, moduleId: "pocket_1", timing: "mid_game" }] });
    director.dispose();
    for (let i = 0; i < 5; i++) await tick();
    expect(scene.records).not.toContain(`apply seq=${next.eventSeq}`);
  });

  it("records semantic commands and settles authoritative state", async () => {
    const clock = new ManualPresentationClock();
    const scene = new RecordingTableSceneAdapter(clock);
    const director = createPresentationDirector(scene, clock, new RecordingTableAudioAdapter());
    const { gs: previous } = atExpandAttack(111);
    director.mount(previous);
    const next = { ...previous, eventSeq: previous.eventSeq + 1 };
    director.submit({ previous, next, source: "local", receivedAt: 0, events: [{ type: "army.maneuvered", seq: next.eventSeq, playerId: "u1", from: "alaska", to: "alberta", count: 3 }] });
    await tick();
    expect(scene.records).toContain("camera.frame alaska -> alberta");
    clock.flush(); await tick(); clock.flush(); await tick();
    expect(scene.records).toContain("army.move alaska -> alberta count=3 tone=maneuver");
    expect(scene.records).toContain(`apply seq=${next.eventSeq}`);
  });

  it("skip applies every pending commit by settling to the transition's next state", async () => {
    const clock = new ManualPresentationClock();
    const scene = new RecordingTableSceneAdapter(clock);
    const director = createPresentationDirector(scene, clock, new RecordingTableAudioAdapter());
    const { gs: previous } = atExpandAttack(112);
    director.mount(previous);
    const next = { ...previous, eventSeq: previous.eventSeq + 1 };
    director.submit({ previous, next, source: "network", receivedAt: 0, events: [{ type: "module.revealed", seq: next.eventSeq, moduleId: "pocket_1", timing: "mid_game" }] });
    await tick();
    director.skipCurrentSequence();
    await tick();
    expect(scene.current?.eventSeq).toBe(next.eventSeq);
  });

  it("hard-resyncs queue overflow to the newest authoritative snapshot", () => {
    const clock = new ManualPresentationClock();
    const scene = new RecordingTableSceneAdapter(clock);
    const director = createPresentationDirector(scene, clock, new RecordingTableAudioAdapter());
    let previous = atExpandAttack(113).gs;
    director.mount(previous);
    director.setMotionPreference("instant");
    for (let i = 0; i < 22; i++) {
      const next = { ...previous, eventSeq: previous.eventSeq + 1 };
      director.submit({ previous, next, source: "replay", receivedAt: i, events: [{ type: "module.revealed", seq: next.eventSeq, moduleId: `module_${i}`, timing: "mid_game" }] });
      previous = next;
    }
    expect(scene.records.some((record) => record.includes("table.resync queue_overflow"))).toBe(true);
  });

  it("records ordinary turn, combat, conquest, scar, and reconnect commit order", async () => {
    const clock = new ManualPresentationClock();
    const scene = new RecordingTableSceneAdapter(clock);
    const director = createPresentationDirector(scene, clock, new RecordingTableAudioAdapter());
    const { gs: previous } = atExpandAttack(114);
    director.mount(previous);
    const next = { ...previous, eventSeq: previous.eventSeq + 6 };
    director.submit({
      previous,
      next,
      source: "network",
      receivedAt: 0,
      events: [
        { type: "troops.placed", seq: previous.eventSeq + 1, playerId: "u1", territoryId: "alaska", count: 3 },
        { type: "army.maneuvered", seq: previous.eventSeq + 2, playerId: "u1", from: "alaska", to: "alberta", count: 3 },
        { type: "battle.resolved", seq: previous.eventSeq + 3, from: "alaska", to: "northwest_territory", attackerLosses: 1, defenderLosses: 2 },
        { type: "territory.conquered", seq: previous.eventSeq + 4, playerId: "u1", from: "alaska", to: "northwest_territory", moved: 3 },
        { type: "scar.applied", seq: previous.eventSeq + 5, playerId: "u1", territoryId: "greenland", scarId: "fallout" },
        { type: "phase.changed", seq: previous.eventSeq + 6, phase: "maneuver" },
      ],
    });
    for (let index = 0; index < 24; index++) { await tick(); clock.flush(); }

    expect(scene.records).toEqual(expect.arrayContaining([
      "army.place alaska count=3",
      "army.move alaska -> alberta count=3 tone=maneuver",
      "battle.impact alaska -> northwest_territory",
      "army.remove alaska count=1 side=attacker",
      "army.remove northwest_territory count=2 side=defender",
      "army.move alaska -> northwest_territory count=3 tone=conquest",
      "territory.conquest northwest_territory player=u1",
      "scar.apply greenland scar=fallout",
      `apply seq=${next.eventSeq}`,
    ]));
    director.settleImmediately(next, "reconnect");
    expect(scene.records).toContain("table.resync reconnect");
  });
});

it("batches queued rapid placements and leaves recruitment input available", async () => {
  const clock = new ManualPresentationClock();
  const scene = new RecordingTableSceneAdapter(clock);
  const director = createPresentationDirector(scene, clock, new RecordingTableAudioAdapter());
  let previous = atExpandAttack(117).gs;
  director.mount(previous);
  const snapshots: boolean[] = [];
  director.subscribe(s => snapshots.push(s.inputBlocked));
  for (let i = 0; i < 4; i++) {
    const next = {...previous, eventSeq: previous.eventSeq + 1};
    director.submit({previous, next, source: "local", receivedAt: i, events: [{type: "troops.placed", seq: next.eventSeq, playerId: "u1", territoryId: "alaska", count: 1}]});
    previous = next;
  }
  for (let i = 0; i < 12; i++) {clock.flush(); await tick();}
  expect(scene.records.filter(r => r.startsWith("army.place"))).toEqual(["army.place alaska count=1", "army.place alaska count=3"]);
  expect(scene.current?.eventSeq).toBe(previous.eventSeq);
  expect(snapshots.every(blocked => !blocked)).toBe(true);
  director.dispose();
});

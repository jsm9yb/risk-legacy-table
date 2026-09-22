import { expect, it } from "vitest";
import { atExpandAttack } from "../test-fixtures.ts";
import { publicBoardSnapshot, type HistoryFrame } from "../history/PublicBoardHistory.ts";
import { createPresentationDirector } from "./PresentationDirector.ts";
import { ManualPresentationClock } from "./PresentationClock.ts";
import { RecordingTableSceneAdapter } from "./RecordingTableSceneAdapter.ts";
import { RecordingTableAudioAdapter } from "./TableAudio.ts";

const tick = async () => {for (let i = 0; i < 12; i++) await Promise.resolve();};
function fixture() {
  const live = atExpandAttack(925).gs;
  const board = publicBoardSnapshot(live);
  const before = structuredClone(board);
  before.territories.alaska.troops = 81;
  const frame: HistoryFrame = {id: "recorded", seq: live.eventSeq - 1, title: "Recorded conquest", detail: "An observed public board", provenance: "captured", weight: 1, before, after: board, focus: {to: "alaska"}};
  const clock = new ManualPresentationClock();
  const scene = new RecordingTableSceneAdapter(clock);
  const director = createPresentationDirector(scene, clock, new RecordingTableAudioAdapter());
  director.mount(live);
  director.setMotionPreference("instant");
  return {live, frame, clock, scene, director};
}

it("holds actual historical armies and restores authority when the player exits", async () => {
  const {live, frame, scene, director} = fixture();
  const statuses: boolean[] = [];
  director.subscribe(s => statuses.push(s.inputBlocked));
  const playback = director.playHistory([frame], {hold: true, side: "before"});
  await tick();
  expect(scene.current?.territories.alaska.troops).toBe(81);
  expect(scene.current?.log).toEqual([]);
  expect(statuses.at(-1)).toBe(true);
  director.skipCurrentSequence();
  await playback;
  expect(scene.current).toBe(live);
  expect(statuses.at(-1)).toBe(false);
  director.dispose();
});

it("a new network action interrupts history and cannot be overwritten by its old finally", async () => {
  const {live, frame, scene, director} = fixture();
  const playback = director.playHistory([frame], {hold: true, side: "before"});
  await tick();
  const newest = {...live, eventSeq: live.eventSeq + 1};
  director.submit({previous: live, next: newest, events: [{type: "troops.placed", seq: newest.eventSeq, playerId: live.turnOrder[0], territoryId: "alaska", count: 1}], source: "network", receivedAt: 0});
  await playback;
  expect(scene.current).toBe(newest);
  director.dispose();
});

it("switching a held before/after view does not restore the live board between views", async () => {
  const {frame, scene, director} = fixture();
  const before = director.playHistory([frame], {hold: true, side: "before"});
  await tick();
  const after = director.playHistory([frame], {hold: true, side: "after"});
  await before; await tick();
  expect(scene.current?.territories.alaska.troops).toBe(frame.after.territories.alaska.troops);
  expect(scene.current?.log).toEqual([]);
  director.skipCurrentSequence(); await after;
  director.dispose();
});

it("reduced-motion history changes views without historical camera travel", async () => {
  const {frame, scene, director, clock} = fixture();
  director.setMotionPreference("reduced");
  const playback = director.playHistory([frame], {hold: true, side: "before"});
  for (let i = 0; i < 4; i++) {clock.flush(); await tick();}
  expect(scene.records.some(record => record.startsWith("camera.frame"))).toBe(false);
  director.skipCurrentSequence(); await playback;
  director.dispose();
});

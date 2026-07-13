import { describe, expect, it } from "vitest";
import { applyAction } from "@risk/rules";
import { atExpandAttack } from "../test-fixtures.ts";
import { createStateTransition, translatePresentationEvents } from "./events.ts";

describe("presentation event translation", () => {
  it("translates recruitment with complete spatial data", () => {
    const { gs: previous, pid, mine: territoryId } = atExpandAttack(91);
    const recruitState = structuredClone(previous);
    recruitState.phase = "join_or_recruit";
    recruitState.recruit = { remaining: 1, breakdown: { territories: 3, fromTerritories: 3, population: 0, continents: [], tradeIns: 0, total: 1 } };
    const next = applyAction(recruitState, { type: "recruit.place", playerId: pid, territoryId, count: 1 });

    expect(translatePresentationEvents(recruitState, next)).toEqual([
      expect.objectContaining({ type: "troops.placed", territoryId, count: 1 }),
    ]);
  });

  it("rejects missing event ranges instead of fabricating animation", () => {
    const { gs: previous } = atExpandAttack(92);
    const next = structuredClone(previous);
    next.eventSeq += 2;
    expect(() => translatePresentationEvents(previous, next, [])).toThrow(/event gap/i);
  });

  it("preserves unknown events as non-blocking diagnostics", () => {
    const { gs: previous } = atExpandAttack(93);
    const next = structuredClone(previous);
    next.log.push({ seq: ++next.eventSeq, type: "FutureEvent", data: {} } as any);
    expect(createStateTransition(previous, next, "replay", 100).events).toEqual([
      { type: "presentation.unknown", seq: next.eventSeq, sourceType: "FutureEvent" },
    ]);
  });
});

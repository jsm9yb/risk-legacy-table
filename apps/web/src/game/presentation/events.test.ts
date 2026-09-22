import { describe, expect, it } from "vitest";
import { applyAction, type GameEvent } from "@risk/rules";
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

it("keeps resource identity private while translating the economy and targeted intervention", () => {
  const previous = atExpandAttack(94).gs;
  previous.combat = {from: "alaska", to: "kamchatka"} as NonNullable<typeof previous.combat>;
  const data: GameEvent[] = [
    {seq: previous.eventSeq + 1, type: "RecruitCalculated", playerId: "u1", data: {breakdown: {total: 7, fromTerritories: 3, population: 2, continents: [{id: "australia", total: 4}]}}},
    {seq: previous.eventSeq + 2, type: "ResourceCardDrawn", playerId: "u2", data: {kind: "territory", slot: 1, cardId: "private-card"}},
    {seq: previous.eventSeq + 3, type: "MissileCommitted", playerId: "u1", data: {side: "def", dieIndex: 1, naturalValue: 2}},
  ];
  const next = {...previous, combat: undefined, eventSeq: previous.eventSeq + data.length};
  const events = translatePresentationEvents(previous, next, data);
  expect(events[0]).toMatchObject({command: {type: "recruitment.show", total: 7}});
  expect(events[1]).toMatchObject({command: {type: "cards.transfer", kind: "draw", count: 1}});
  expect(JSON.stringify(events)).not.toContain("private-card");
  expect(events[2]).toMatchObject({type: "missile.committed", from: "alaska", to: "kamchatka", side: "def", dieIndex: 1, naturalValue: 2});
});

it("uses final engine comparisons including defender-winning ties", () => {
  const previous = atExpandAttack(95).gs;
  const event: GameEvent = {seq: previous.eventSeq + 1, type: "CombatResolved", playerId: "u1", data: {from: "alaska", to: "kamchatka", final: {att: [6, 4], def: [6, 3]}, comparisons: [{att: 6, def: 6, winner: "def"}, {att: 4, def: 3, winner: "att"}], attackerLosses: 1, defenderLosses: 1}};
  const next = {...previous, eventSeq: event.seq};
  expect(translatePresentationEvents(previous, next, [event])[0]).toMatchObject({comparison: {attack: [6, 4], comparisons: [{att: 6, def: 6, winner: "def"}, {att: 4, def: 3, winner: "att"}]}});
});

it("animates scar and power modifiers in the engine order after missile replacements", () => {
  const previous = atExpandAttack(96).gs;
  const event: GameEvent = {seq: previous.eventSeq + 1, type: "CombatResolved", playerId: "u1", data: {
    from: "alaska", to: "kamchatka", natural: {att: [3], def: [4]}, final: {att: [6], def: [4]},
    modifiers: [{side: "att", dieIndex: 0}], scarModifiers: [{scarId: "bunker", dieIndex: 0, delta: 1}],
    powerModifiers: [{powerId: "intimidation", side: "def", dieIndex: 0, delta: -1}],
    comparisons: [{att: 6, def: 4, winner: "att"}], attackerLosses: 0, defenderLosses: 1,
  }};
  const translated = translatePresentationEvents(previous, {...previous, eventSeq: event.seq}, [event])[0];
  expect(translated).toMatchObject({modifiers: [
    {type: "battle.modify", source: "bunker", side: "def", naturalValue: 4, finalValue: 5},
    {type: "battle.modify", source: "intimidation", side: "def", naturalValue: 5, finalValue: 4},
  ]});
});

it("resorts modified dice for comparisons and keeps knockout distinct from elimination", () => {
  const previous = atExpandAttack(97).gs;
  const events: GameEvent[] = [
    {seq: previous.eventSeq + 1, type: "CombatResolved", data: {from: "alaska", to: "kamchatka", final: {att: [5, 6], def: [3, 5]}, comparisons: [{att: 6, def: 5, winner: "att"}, {att: 5, def: 3, winner: "att"}]}},
    {seq: previous.eventSeq + 2, type: "PlayerKnockedOut", playerId: "u2", data: {by: "u1"}},
  ];
  const mapped = translatePresentationEvents(previous, {...previous, eventSeq: previous.eventSeq + 2}, events);
  expect(mapped[0]).toMatchObject({comparison: {attack: [6, 5], defense: [5, 3]}});
  expect(mapped[1]).toMatchObject({command: {type: "player.eliminate", kind: "knocked_out"}});
});

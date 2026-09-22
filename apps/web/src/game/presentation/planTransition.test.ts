import { describe, expect, it } from "vitest";
import { atExpandAttack } from "../test-fixtures.ts";
import { planTransition } from "./planTransition.ts";
import type { PresentationEvent, StateTransition } from "./types.ts";

describe("transition planning", () => {
  it("orders battle impact before casualties and conquest", () => {
    const { gs: state } = atExpandAttack(101);
    const transition = {
      previous: state,
      next: { ...state, eventSeq: state.eventSeq + 2 },
      source: "local" as const,
      receivedAt: 0,
      events: [
        { type: "battle.resolved" as const, seq: state.eventSeq + 1, from: "alaska", to: "kamchatka", attackerLosses: 1, defenderLosses: 2 },
        { type: "territory.conquered" as const, seq: state.eventSeq + 2, playerId: "u1", from: "alaska", to: "kamchatka", moved: 3 },
      ],
    };
    const plan = planTransition(transition, "full");
    expect(plan.beats.flatMap((beat) => beat.commands.map((command) => command.type))).toEqual([
      "battle.impact", "army.remove", "army.remove", "army.move", "territory.conquest",
    ]);
    expect(plan.beats.at(-1)?.commit).toBe("transition");
  });

  it("keeps informative reduced-motion beats at 80-120ms and instant at zero", () => {
    const { gs: state } = atExpandAttack(102);
    const transition = {
      previous: state,
      next: { ...state, eventSeq: state.eventSeq + 1 },
      source: "local" as const,
      receivedAt: 0,
      events: [{ type: "troops.placed" as const, seq: state.eventSeq + 1, playerId: "u1", territoryId: "alaska", count: 2 }],
    };
    expect(planTransition(transition, "reduced").beats[0].durationMs).toBeGreaterThanOrEqual(80);
    expect(planTransition(transition, "reduced").beats[0].durationMs).toBeLessThanOrEqual(120);
    expect(planTransition(transition, "instant").beats[0].durationMs).toBe(0);
  });

  it("removes automatic camera travel in reduced motion", () => {
    const { gs: state } = atExpandAttack(103);
    const transition = {
      previous: state,
      next: { ...state, eventSeq: state.eventSeq + 1 },
      source: "network" as const,
      receivedAt: 0,
      events: [{ type: "army.maneuvered" as const, seq: state.eventSeq + 1, playerId: "u1", from: "alaska", to: "alberta", count: 2 }],
    };
    expect(planTransition(transition, "reduced").beats.flatMap((beat) => beat.commands).some((command) => command.type === "camera.frame")).toBe(false);
  });

  it("provides full, reduced, and instant plans for the complete semantic event catalog", () => {
    const { gs: state } = atExpandAttack(104);
    const events: PresentationEvent[] = [
      { type: "troops.placed", seq: 1, playerId: "u1", territoryId: "alaska", count: 3 },
      { type: "territory.expanded", seq: 2, playerId: "u1", from: "alaska", to: "alberta", moved: 2, losses: 1 },
      { type: "battle.declared", seq: 3, attackerId: "u1", defenderId: "u2", from: "alaska", to: "northwest_territory" },
      { type: "dice.rolled", seq: 4, from: "alaska", to: "northwest_territory", attack: [6, 4], defense: [5] },
      { type: "battle.resolved", seq: 5, from: "alaska", to: "northwest_territory", attackerLosses: 1, defenderLosses: 1 },
      { type: "territory.conquered", seq: 6, playerId: "u1", from: "alaska", to: "northwest_territory", moved: 3 },
      { type: "army.maneuvered", seq: 7, playerId: "u1", from: "alaska", to: "alberta", count: 2 },
      { type: "scar.applied", seq: 8, playerId: "u1", territoryId: "greenland", scarId: "fallout" },
      { type: "scar.attrition", seq: 9, playerId: "u1", territoryId: "greenland", delta: -1 },
      { type: "city.founded", seq: 10, playerId: "u1", territoryId: "alberta", cityType: "minor", name: "Northgate" },
      { type: "city.fortified", seq: 11, playerId: "u1", territoryId: "alberta" },
      { type: "hq.moved", seq: 12, playerId: "u1", from: "alaska", to: "alberta", factionId: "die_mechaniker" },
      { type: "redStar.gained", seq: 13, playerId: "u1", source: "hq", territoryId: "alberta" },
      { type: "missile.committed", seq: 14, playerId: "u1", from: "alaska", to: "northwest_territory", side: "att" },
      { type: "module.revealed", seq: 15, moduleId: "pocket_1", timing: "mid_game" },
      { type: "nuclear.resolved", seq: 16, territories: ["alaska", "alberta"] },
      { type: "alienIsland.placed", seq: 17, playerId: "u1", territoryId: "alien_island", connections: ["indonesia", "eastern_australia"] },
      { type: "phase.changed", seq: 18, phase: "maneuver" },
      { type: "game.won", seq: 19, playerId: "u1", reason: "4 Red Stars" },
      { type: "legacy.ritual", seq: 20, ritual: "board.signed", playerId: "u1" },
    ];
    const next = { ...state, eventSeq: state.eventSeq + events.length };
    const transition: StateTransition = { previous: state, next, source: "replay", receivedAt: 0, events };
    const full = planTransition(transition, "full");
    const reduced = planTransition(transition, "reduced");
    const instant = planTransition(transition, "instant");

    for (const event of events) expect(full.beats.some((beat) => beat.label.startsWith(event.type))).toBe(true);
    expect(full.beats.every((beat) => beat.durationMs > 0)).toBe(true);
    expect(reduced.beats.every((beat) => beat.durationMs >= 80 && beat.durationMs <= 120)).toBe(true);
    expect(reduced.beats.flatMap((beat) => beat.commands).some((command) => command.type === "camera.frame")).toBe(false);
    expect(instant.beats.every((beat) => beat.durationMs === 0)).toBe(true);
  });
});

it("commits casualties before occupation without mutating the authoritative states", () => {
  const previous = structuredClone(atExpandAttack(105).gs);
  previous.territories.alaska = {...previous.territories.alaska, troops: 8, controller: "u1"};
  previous.territories.kamchatka = {...previous.territories.kamchatka, troops: 2, controller: "u2"};
  const next = structuredClone(previous);
  next.eventSeq += 2;
  next.territories.alaska.troops = 4;
  next.territories.kamchatka = {...next.territories.kamchatka, troops: 3, controller: "u1"};
  const plan = planTransition({previous, next, source: "local", receivedAt: 0, events: [
    {type: "battle.resolved", seq: next.eventSeq - 1, from: "alaska", to: "kamchatka", attackerLosses: 1, defenderLosses: 2},
    {type: "territory.conquered", seq: next.eventSeq, from: "alaska", to: "kamchatka", playerId: "u1", moved: 3, capturedHqFactionId: "die_mechaniker"},
  ]}, "full");
  const casualties = plan.beats.find(b => b.commands.some(c => c.type === "army.remove"))!.visualState!;
  expect(casualties.territories.alaska.troops).toBe(7);
  expect(casualties.territories.kamchatka.troops).toBe(0);
  const conquest = plan.beats.find(b => b.commands.some(c => c.type === "territory.conquest"))!.visualState!;
  expect(conquest.territories.kamchatka).toMatchObject({troops: 3, controller: "u1"});
  expect(plan.beats.flatMap(b => b.commands).some(c => c.type === "hq.capture")).toBe(true);
  expect(previous.territories.alaska.troops).toBe(8);
  expect(next.territories.alaska.troops).toBe(4);
});

it("shows arrival before fallout and settles expansion ownership", () => {
  const previous = structuredClone(atExpandAttack(106).gs);
  previous.territories.alaska = {...previous.territories.alaska, troops: 8, controller: "u1"};
  previous.territories.kamchatka = {...previous.territories.kamchatka, troops: 0, controller: undefined};
  const next = structuredClone(previous);
  next.eventSeq += 2;
  const plan = planTransition({previous, next, source: "network", receivedAt: 0, events: [
    {type: "scar.attrition", sourceType: "FalloutLosses", seq: next.eventSeq - 1, territoryId: "kamchatka", playerId: "u1", delta: -2},
    {type: "territory.expanded", seq: next.eventSeq, from: "alaska", to: "kamchatka", playerId: "u1", moved: 4, losses: 0},
  ]}, "full");
  const arrival = plan.beats.findIndex(b => b.commands.some(c => c.type === "army.move"));
  const fallout = plan.beats.findIndex(b => b.commands.some(c => c.type === "army.remove"));
  expect(arrival).toBeLessThan(fallout);
  expect(plan.beats[fallout].visualState?.territories.kamchatka).toMatchObject({troops: 2, controller: "u1"});
});

it("projects batched recruitment and trades from earned amounts without subtracting placements twice", () => {
  const previous = structuredClone(atExpandAttack(107).gs);
  const next = {...previous, eventSeq: previous.eventSeq + 3, recruit: {remaining: 7, breakdown: {territories: 3, fromTerritories: 5, population: 0, continents: [], tradeIns: 4, total: 9}}};
  const plan = planTransition({previous, next, source: "network", receivedAt: 0, events: [
    {type: "gameplay.present", seq: next.eventSeq - 2, command: {type: "recruitment.show", playerId: "u1", total: 5, fromTerritories: 5, population: 0, continents: []}},
    {type: "gameplay.present", seq: next.eventSeq - 1, command: {type: "cards.transfer", playerId: "u1", kind: "trade", count: 2, troops: 4}},
    {type: "troops.placed", seq: next.eventSeq, playerId: "u1", territoryId: "alaska", count: 2},
  ]}, "full");
  expect(plan.beats.map(b => b.visualState?.recruit?.remaining)).toEqual([5, 9, 7]);
});

it("does not move a later conquest ahead of ordinary start-turn attrition", () => {
  const previous = atExpandAttack(108).gs;
  const plan = planTransition({previous, next: {...previous, eventSeq: previous.eventSeq + 2}, source: "network", receivedAt: 0, events: [
    {type: "scar.attrition", sourceType: "ScarAttrition", seq: previous.eventSeq + 1, territoryId: "kamchatka", playerId: "u2", delta: -1},
    {type: "territory.conquered", seq: previous.eventSeq + 2, from: "alaska", to: "kamchatka", playerId: "u1", moved: 3},
  ]}, "full");
  expect(plan.beats[0].commands[0].type).toBe("army.remove");
});

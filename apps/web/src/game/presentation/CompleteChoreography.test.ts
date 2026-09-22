import { describe, expect, it, vi } from "vitest";
import { type GameEvent } from "@risk/rules";
import { atExpandAttack } from "../test-fixtures.ts";
import { translatePresentationEvents } from "./events.ts";
import { planTransition } from "./planTransition.ts";
import { PixiTableSceneAdapter } from "./PixiTableSceneAdapter.ts";

describe("complete gameplay choreography", () => {
  it("routes accepted public reward-card changes to the card renderer even outside the hand", async () => {
    const previous = atExpandAttack(890).gs;
    const playerId = Object.keys(previous.players)[0];
    previous.players[playerId].hand = [];
    for (const [type, kind] of [["TerritoryCardUpgraded", "upgrade"], ["TerritoryCardDestroyed", "destroy"]] as const) {
      const event: GameEvent = {seq: previous.eventSeq + 1, type, playerId, data: {cardId: "territory_greenland", resources: 4}};
      const next = {...previous, eventSeq: event.seq};
      const events = translatePresentationEvents(previous, next, [event]);
      const command = planTransition({previous, next, events, source: "local", receivedAt: 0}, "full").beats[0].commands[0];
      const scene = Object.create(PixiTableSceneAdapter.prototype);
      scene.current = {state: previous};
      scene.animateCards = vi.fn().mockResolvedValue(undefined);
      await scene.execute(command, new AbortController().signal, 720);
      expect(scene.animateCards).toHaveBeenCalledWith(expect.objectContaining({kind, playerId, cardIds: ["territory_greenland"]}), 720, expect.any(AbortSignal));
    }
  });
  it("retains dice commitments inside a network batch after combat has cleared", () => {
    const previous = atExpandAttack(891).gs;
    const log: GameEvent[] = [
      {seq: previous.eventSeq + 1, type: "AttackDeclared", playerId: "u1", data: {from: "alaska", to: "kamchatka", defender: "u2"}},
      {seq: previous.eventSeq + 2, type: "AttackersChosen", playerId: "u1", data: {count: 3}},
      {seq: previous.eventSeq + 3, type: "DefenderDiceChosen", playerId: "u2", data: {count: 2}},
    ];
    const events = translatePresentationEvents(previous, {...previous, combat: undefined, eventSeq: log.at(-1)!.seq}, log);
    expect(events[1]).toMatchObject({command: {type: "battle.prepare", from: "alaska", to: "kamchatka", attackCount: 3}});
    expect(events[2]).toMatchObject({command: {type: "battle.prepare", defenseCount: 2}});
  });

  it("draws before refilling the vacated slot and never copies hidden card payloads", () => {
    const previous = atExpandAttack(892).gs;
    const pid = Object.keys(previous.players)[0];
    previous.players[pid].hand = [];
    const log: GameEvent[] = [
      {seq: previous.eventSeq + 1, type: "ResourceCardDrawn", playerId: pid, data: {kind: "territory", slot: 2, cardId: "SECRET"}},
      {seq: previous.eventSeq + 2, type: "SideboardRefilled", data: {slots: ["a", "b", "c", "d"]}},
    ];
    const next = {...previous, eventSeq: log.at(-1)!.seq};
    const events = translatePresentationEvents(previous, next, log);
    const sequence = planTransition({previous, next, events, source: "network", receivedAt: 0}, "full");
    expect(sequence.beats.flatMap(b => b.commands).filter(c => c.type === "cards.transfer").map(c => c.kind)).toEqual(["draw", "refill"]);
    expect(sequence.beats[0].visualState?.sideboard.slots[2]).toBeNull();
    expect(sequence.beats[1].visualState?.sideboard).toEqual(next.sideboard);
    expect(JSON.stringify(events)).not.toContain("SECRET");
  });

  it("shows both score changes and the new leader for an HQ changing hands", () => {
    const previous = atExpandAttack(893).gs;
    const [attacker, defender] = Object.keys(previous.players);
    for (const t of Object.values(previous.territories)) t.hqFaction = undefined;
    previous.players[attacker].redStarTokens = 1;
    previous.players[defender].redStarTokens = 1;
    previous.territories.alaska = {...previous.territories.alaska, troops: 6, controller: attacker};
    previous.territories.kamchatka = {...previous.territories.kamchatka, troops: 0, controller: defender, hqFaction: "third-party-hq"};
    const next = structuredClone(previous);
    next.eventSeq++;
    next.territories.kamchatka.controller = attacker;
    const sequence = planTransition({previous, next, source: "local", receivedAt: 0, events: [{type: "territory.conquered", seq: next.eventSeq, playerId: attacker, from: "alaska", to: "kamchatka", moved: 3, capturedHqFactionId: "third-party-hq"}]}, "full");
    const score = sequence.beats.flatMap(b => b.commands).find(c => c.type === "score.change");
    expect(score).toMatchObject({changes: expect.arrayContaining([{playerId: attacker, before: 1, after: 2}, {playerId: defender, before: 2, after: 1}]), leadersBefore: [defender], leadersAfter: [attacker]});
  });

  it("uses shorter subsequent rolls without shortening comparison or casualty explanations", () => {
    const previous = atExpandAttack(894).gs;
    const seq = previous.eventSeq;
    previous.log.push({seq: seq - 1, type: "AttackDeclared"}, {seq, type: "DiceRolled"});
    const next = {...previous, eventSeq: seq + 1};
    const sequence = planTransition({previous, next, source: "local", receivedAt: 0, events: [{type: "dice.rolled", seq: seq + 1, from: "alaska", to: "kamchatka", attack: [6], defense: [4]}]}, "full");
    expect(sequence.beats[0].durationMs).toBe(380);
  });
});

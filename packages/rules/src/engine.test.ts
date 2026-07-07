import { describe, it, expect } from "vitest";
import { createGame, applyAction, recruitBreakdown, redStars, waitingOn, isLegalStart, RuleViolation } from "./engine.ts";
import { initialCampaign, applyGameToCampaign } from "./campaign.ts"; // new (9)
import type { GameState } from "./types.ts";
import { manifest } from "@risk/map";

const P = [
  { id: "u1", name: "Ada" },
  { id: "u2", name: "Lin" },
  { id: "u3", name: "Rex" },
];

// Power picks here are deliberately inert for legacy tests (no automatic dice/recruit effects); // new
// power behaviors get their own describe block below. // new
const TEST_POWERS: Record<string, string> = { // new
  khan_industries: "territory_card_reinforcement",
  die_mechaniker: "defensive_stand",
  saharan_republic: "unconnected_maneuver",
  enclave_of_the_bear: "total_conquest",
  imperial_balkania: "expansionist_supply",
};

function setupGame(seed = 42): GameState {
  let s = createGame({ gameId: "g1", seed, players: P });
  const factions = ["khan_industries", "die_mechaniker", "saharan_republic"];
  const starts = ["alaska", "brazil", "western_australia"];
  const order = [...s.setup!.chooserOrder];
  for (let i = 0; i < order.length; i++) {
    const pid = order[i];
    const idx = P.findIndex((p) => p.id === pid);
    s = applyAction(s, { type: "setup.choose", playerId: pid, factionId: factions[idx], territoryId: starts[idx], powerId: TEST_POWERS[factions[idx]] }); // new: first play requires a power pick
  }
  return s;
}

describe("setup", () => {
  it("rolls chooser order deterministically and seats all players", () => {
    const a = createGame({ gameId: "g", seed: 7, players: P });
    const b = createGame({ gameId: "g", seed: 7, players: P });
    expect(a.setup!.chooserOrder).toEqual(b.setup!.chooserOrder);
    expect(a.setup!.chooserOrder).toHaveLength(3);
  });
  it("places starting troops + HQ automatically, records unused factions, enters start_turn", () => {
    const s = setupGame();
    expect(s.phase).toBe("start_turn");
    expect(s.territories["alaska"].hqFaction).toBe("khan_industries");
    expect(s.territories["alaska"].troops).toBe(8); // flat 8 per player (starter rules, confirmed)
    const unused = s.log.find((e) => e.type === "UnusedFactionsRecorded");
    expect((unused!.data!.factions as string[]).sort()).toEqual(["enclave_of_the_bear", "imperial_balkania"]);
  });
  it("rejects initial HQ placement adjacent to another faction HQ; requires 3+ players", () => {
    expect(() => createGame({ gameId: "g", seed: 1, players: P.slice(0, 2) })).toThrow(RuleViolation); // 2p unsupported
    let s = createGame({ gameId: "g", seed: 3, players: P });
    const first = s.setup!.chooserOrder[0];
    s = applyAction(s, { type: "setup.choose", playerId: first, factionId: "khan_industries", territoryId: "ural", powerId: TEST_POWERS.khan_industries }); // new
    const second = s.setup!.chooserOrder[1];
    // siberia is adjacent to ural -> illegal HQ placement
    expect(() => applyAction(s, { type: "setup.choose", playerId: second, factionId: "die_mechaniker", territoryId: "siberia", powerId: TEST_POWERS.die_mechaniker })).toThrow(/adjacent/); // new
    expect(isLegalStart(s, "siberia", true, "die_mechaniker")).toBe(false);
    expect(isLegalStart(s, "brazil", true, "die_mechaniker")).toBe(true);
  });
  it("blocks illegal starts and duplicate factions", () => {
    let s = createGame({ gameId: "g", seed: 1, players: P });
    const first = s.setup!.chooserOrder[0];
    s = applyAction(s, { type: "setup.choose", playerId: first, factionId: "khan_industries", territoryId: "japan", powerId: TEST_POWERS.khan_industries }); // new
    const second = s.setup!.chooserOrder[1];
    expect(() => applyAction(s, { type: "setup.choose", playerId: second, factionId: "khan_industries", territoryId: "china", powerId: TEST_POWERS.khan_industries })).toThrow(RuleViolation); // new
    expect(() => applyAction(s, { type: "setup.choose", playerId: second, factionId: "saharan_republic", territoryId: "japan", powerId: TEST_POWERS.saharan_republic })).toThrow(RuleViolation); // new
    expect(isLegalStart(s, "japan")).toBe(false);
  });
  it("sideboard has 4 face-up slots, 38-card deck, 10 coins", () => {
    const s = setupGame();
    expect(s.sideboard.slots.filter(Boolean)).toHaveLength(4);
    expect(s.sideboard.territoryDeck).toHaveLength(38);
    expect(s.sideboard.coinPile).toHaveLength(10);
  });
});

describe("recruitment", () => {
  it("computes minimum 3 with breakdown", () => {
    const s = setupGame();
    const pid = s.turnOrder[0];
    const b = recruitBreakdown(s, pid);
    expect(b.fromTerritories).toBe(3);
    expect(b.total).toBe(3);
  });
  it("adds continent bonus breakdown when fully controlled", () => {
    const s = setupGame();
    const pid = s.turnOrder[0];
    for (const t of manifest.territories.filter((t) => t.continent === "australia")) {
      s.territories[t.id].controller = pid;
      s.territories[t.id].troops = Math.max(1, s.territories[t.id].troops);
    }
    const b = recruitBreakdown(s, pid);
    const au = b.continents.find((c) => c.id === "australia")!;
    expect(au).toEqual({ id: "australia", base: 2, globalModifier: 0, namedBonus: 0, total: 2 });
  });
  it("enforces exact placement before phase advance", () => {
    let s = setupGame();
    const pid = s.turnOrder[0];
    s = applyAction(s, { type: "start.done", playerId: pid });
    expect(s.phase).toBe("join_or_recruit");
    expect(() => applyAction(s, { type: "recruit.done", playerId: pid })).toThrow(/Place all troops/);
    const myTerr = Object.entries(s.territories).find(([, t]) => t.controller === pid)![0];
    s = applyAction(s, { type: "recruit.place", playerId: pid, territoryId: myTerr, count: s.recruit!.remaining });
    s = applyAction(s, { type: "recruit.done", playerId: pid });
    expect(s.phase).toBe("expand_attack");
  });
});

describe("combat", () => {
  function intoCombat(seed = 5) {
    let s = setupGame(seed);
    const att = s.turnOrder[0];
    const def = s.turnOrder[1];
    // engineer adjacency: give attacker ukraine(20), defender ural(2)
    s.territories["ukraine"].controller = att;
    s.territories["ukraine"].troops = 20;
    s.territories["ural"].controller = def;
    s.territories["ural"].troops = 2;
    s = applyAction(s, { type: "start.done", playerId: att });
    const myTerr = Object.entries(s.territories).find(([, t]) => t.controller === att)![0];
    s = applyAction(s, { type: "recruit.place", playerId: att, territoryId: myTerr, count: s.recruit!.remaining });
    s = applyAction(s, { type: "recruit.done", playerId: att });
    s = applyAction(s, { type: "attack.declare", playerId: att, from: "ukraine", to: "ural" });
    return { s, att, def };
  }

  it("defender wins ties; pairwise highest-to-lowest", () => {
    let { s, att, def } = intoCombat();
    s = applyAction(s, { type: "attack.chooseAttackers", playerId: att, count: 3 });
    s = applyAction(s, { type: "attack.defenderDice", playerId: def, count: 2 });
    const resolved = s.log.findLast((e) => e.type === "CombatResolved")!;
    const cmp = resolved.data!.comparisons as { att: number; def: number; winner: string }[];
    for (const c of cmp) {
      expect(c.winner).toBe(c.att > c.def ? "att" : "def");
    }
    expect(cmp.length).toBe(2);
  });

  it("resolves immediately when nobody can modify (no missiles)", () => {
    let { s, att, def } = intoCombat();
    s = applyAction(s, { type: "attack.chooseAttackers", playerId: att, count: 3 });
    s = applyAction(s, { type: "attack.defenderDice", playerId: def, count: 2 });
    expect(s.log.some((e) => e.type === "TimingWindowOpened")).toBe(false);
    expect(s.log.some((e) => e.type === "CombatResolved")).toBe(true);
  });

  it("opens modifier window when a participant has missiles; missile sets unmodifiable 6", () => {
    let s = setupGame(11);
    const att = s.turnOrder[0];
    const def = s.turnOrder[1];
    s.players[att].missiles = 1;
    s.territories["ukraine"].controller = att;
    s.territories["ukraine"].troops = 20;
    s.territories["ural"].controller = def;
    s.territories["ural"].troops = 2;
    s = applyAction(s, { type: "start.done", playerId: att });
    const myTerr = Object.entries(s.territories).find(([, t]) => t.controller === att)![0];
    s = applyAction(s, { type: "recruit.place", playerId: att, territoryId: myTerr, count: s.recruit!.remaining });
    s = applyAction(s, { type: "recruit.done", playerId: att });
    s = applyAction(s, { type: "attack.declare", playerId: att, from: "ukraine", to: "ural" });
    s = applyAction(s, { type: "attack.chooseAttackers", playerId: att, count: 3 });
    s = applyAction(s, { type: "attack.defenderDice", playerId: def, count: 2 });
    expect(s.log.some((e) => e.type === "TimingWindowOpened")).toBe(true);
    expect(waitingOn(s)).toBe(att);
    s = applyAction(s, { type: "combat.useMissile", playerId: att, dieIndex: 0 });
    const resolved = s.log.findLast((e) => e.type === "CombatResolved")!;
    expect((resolved.data!.final as any).att[0]).toBe(6);
    expect(s.players[att].missiles).toBe(0);
  });

  it("conquest move-in bounds, HQ stays original faction, knockout transfers cards", () => {
    let s = setupGame(13);
    const att = s.turnOrder[0];
    const def = s.turnOrder[1];
    // Defender's ONLY presence is ural with 1 troop and their HQ; give them resource cards.
    for (const [tid, t] of Object.entries(s.territories)) {
      if (t.controller === def) { t.controller = undefined; t.troops = 0; t.hqFaction = undefined; }
    }
    const defFaction = s.players[def].factionId!;
    s.territories["ural"].controller = def;
    s.territories["ural"].troops = 1;
    s.territories["ural"].hqFaction = defFaction;
    s.players[def].hand = ["0", "1"];
    s.territories["ukraine"].controller = att;
    s.territories["ukraine"].troops = 20;
    s = applyAction(s, { type: "start.done", playerId: att });
    const myTerr = Object.entries(s.territories).find(([, t]) => t.controller === att)![0];
    s = applyAction(s, { type: "recruit.place", playerId: att, territoryId: myTerr, count: s.recruit!.remaining });
    s = applyAction(s, { type: "recruit.done", playerId: att });
    // attack until conquered
    let guard = 0;
    while (guard++ < 50) {
      if (!s.combat) s = applyAction(s, { type: "attack.declare", playerId: att, from: "ukraine", to: "ural" });
      s = applyAction(s, { type: "attack.chooseAttackers", playerId: att, count: Math.min(3, s.territories["ukraine"].troops - 1) });
      s = applyAction(s, { type: "attack.defenderDice", playerId: def, count: 1 });
      if (s.combat?.awaitingMoveIn) break;
    }
    expect(s.combat!.awaitingMoveIn).toBeTruthy();
    const { min, max } = s.combat!.awaitingMoveIn!;
    expect(max).toBe(s.territories["ukraine"].troops - 1);
    expect(() => applyAction(s, { type: "attack.moveIn", playerId: att, count: max + 1 })).toThrow(RuleViolation);
    s = applyAction(s, { type: "attack.moveIn", playerId: att, count: min });
    expect(s.territories["ural"].controller).toBe(att);
    expect(s.territories["ural"].hqFaction).toBe(defFaction); // HQ piece keeps original faction
    expect(s.players[def].knockedOut).toBe(true);
    expect(s.players[att].hand).toEqual(expect.arrayContaining(["0", "1"]));
    expect(s.players[def].hand).toEqual([]);
  });
});

describe("red stars and victory", () => {
  it("counts tokens + controlled HQ territories separately", () => {
    const s = setupGame();
    const pid = s.turnOrder[0];
    const rs = redStars(s, pid);
    expect(rs.tokens).toBe(1);
    expect(rs.board).toBe(1); // own HQ counts (verify-flagged)
    expect(rs.total).toBe(2);
  });
  it("locks the game immediately at 4 red stars", () => {
    let s = setupGame();
    const pid = s.turnOrder[0];
    s.players[pid].redStarTokens = 3; // + own HQ = 4 on next victory-checking action
    s.players[pid].hand = ["42", "43", "44", "45"];
    s.players[pid].redStarTokens = 2;
    s = applyAction(s, { type: "start.buyRedStar", playerId: pid, cardIds: ["42", "43", "44", "45"] });
    expect(s.phase).toBe("game_over");
    expect(s.winner).toBe(pid);
    expect(s.results![s.players[pid].factionId!]).toBe("won");
    expect(() => applyAction(s, { type: "start.done", playerId: pid })).toThrow(RuleViolation);
  });
});

describe("end turn and sideboard", () => {
  it("requires conquest for a draw; coin draw discards slot 4 and refills", () => {
    let s = setupGame(21);
    const pid = s.turnOrder[0];
    s = applyAction(s, { type: "start.done", playerId: pid });
    const myTerr = Object.entries(s.territories).find(([, t]) => t.controller === pid)![0];
    s = applyAction(s, { type: "recruit.place", playerId: pid, territoryId: myTerr, count: s.recruit!.remaining });
    s = applyAction(s, { type: "recruit.done", playerId: pid });
    s = applyAction(s, { type: "phase.endAttacks", playerId: pid });
    s = applyAction(s, { type: "phase.endManeuver", playerId: pid });
    expect(() => applyAction(s, { type: "end.draw", playerId: pid, choice: { coin: true } })).toThrow(/conquered/);
    s = applyAction(s, { type: "end.turn", playerId: pid });
    expect(s.turnOrder[s.activeIdx]).not.toBe(pid);
    expect(s.phase).toBe("start_turn");
  });
  it("forces matching face-up territory card over coin when available", () => {
    let s = setupGame(33);
    const pid = s.turnOrder[0];
    s.players[pid].conqueredEnemyThisTurn = true;
    // Make slot 0 card's territory controlled by pid
    const slot0 = s.sideboard.slots[0]!;
    const tid = (await_card(slot0)).territoryId!;
    s.territories[tid].controller = pid;
    s.territories[tid].troops = Math.max(1, s.territories[tid].troops);
    s.phase = "end_turn";
    expect(() => applyAction(s, { type: "end.draw", playerId: pid, choice: { coin: true } })).toThrow(/matching/);
    s = applyAction(s, { type: "end.draw", playerId: pid, choice: { slot: 0 } });
    expect(s.players[pid].hand).toContain(slot0);
    expect(s.sideboard.slots.every((x) => x !== null)).toBe(true); // refilled
    expect(s.phase).toBe("start_turn"); // turn advanced
  });
});

describe("scar effects (Slice 8)", () => { // new: whole describe block
  /** Combat harness: attacker on ukraine(20) vs defender on ural(10); prep mutates before the turn starts. */
  function scarCombat(seed: number, prep: (s: GameState) => void) {
    let s = setupGame(seed);
    const att = s.turnOrder[0];
    const def = s.turnOrder[1];
    s.territories["ukraine"].controller = att;
    s.territories["ukraine"].troops = 20;
    s.territories["ural"].controller = def;
    s.territories["ural"].troops = 10;
    prep(s);
    s = applyAction(s, { type: "start.done", playerId: att });
    const myTerr = Object.entries(s.territories).find(([tid, t]) => t.controller === att && tid !== "ukraine")![0];
    s = applyAction(s, { type: "recruit.place", playerId: att, territoryId: myTerr, count: s.recruit!.remaining });
    s = applyAction(s, { type: "recruit.done", playerId: att });
    s = applyAction(s, { type: "attack.declare", playerId: att, from: "ukraine", to: "ural" });
    return { s, att, def };
  }
  function lastResolved(s: GameState) {
    const e = s.log.findLast((x) => x.type === "CombatResolved")!;
    return e.data! as { natural: { att: number[]; def: number[] }; final: { att: number[]; def: number[] } };
  }
  /** Plays the active player's turn straight through to end.turn (recruits dumped on a non-ukraine territory). */
  function playThroughTurnEnd(s: GameState, pid: string): GameState {
    s = applyAction(s, { type: "start.done", playerId: pid });
    const myTerr = Object.entries(s.territories).find(([tid, t]) => t.controller === pid && tid !== "ukraine")![0];
    s = applyAction(s, { type: "recruit.place", playerId: pid, territoryId: myTerr, count: s.recruit!.remaining });
    s = applyAction(s, { type: "recruit.done", playerId: pid });
    s = applyAction(s, { type: "phase.endAttacks", playerId: pid });
    s = applyAction(s, { type: "phase.endManeuver", playerId: pid });
    return applyAction(s, { type: "end.turn", playerId: pid });
  }

  it("bunker adds +1 to the highest defense die only", () => {
    let { s, att, def } = scarCombat(101, (st) => { st.territories["ural"].scars = ["bunker"]; });
    s = applyAction(s, { type: "attack.chooseAttackers", playerId: att, count: 3 });
    s = applyAction(s, { type: "attack.defenderDice", playerId: def, count: 2 });
    const r = lastResolved(s);
    expect(r.final.def[0]).toBe(Math.min(6, r.natural.def[0] + 1)); // natural sorted desc -> index 0 is highest; clamp 1..6
    expect(r.final.def[1]).toBe(r.natural.def[1]);
    expect(r.final.att).toEqual(r.natural.att);
  });

  it("ammo shortage subtracts 1 from the highest defense die only", () => {
    let { s, att, def } = scarCombat(102, (st) => { st.territories["ural"].scars = ["ammo_shortage"]; });
    s = applyAction(s, { type: "attack.chooseAttackers", playerId: att, count: 3 });
    s = applyAction(s, { type: "attack.defenderDice", playerId: def, count: 2 });
    const r = lastResolved(s);
    expect(r.final.def[0]).toBe(Math.max(1, r.natural.def[0] - 1)); // clamp 1..6
    expect(r.final.def[1]).toBe(r.natural.def[1]);
  });

  it("missile-set dice are unmodifiable by scars", () => {
    let { s, att, def } = scarCombat(103, (st) => {
      st.territories["ural"].scars = ["bunker"];
      st.players[st.turnOrder[1]].missiles = 1;
    });
    s = applyAction(s, { type: "attack.chooseAttackers", playerId: att, count: 3 });
    s = applyAction(s, { type: "attack.defenderDice", playerId: def, count: 2 });
    s = applyAction(s, { type: "combat.useMissile", playerId: def, dieIndex: 0 });
    const r = lastResolved(s);
    expect(r.final.def[0]).toBe(6); // missile 6 exactly — bunker must NOT push it to 7
    expect(r.final.def[1]).toBe(r.natural.def[1]);
  });

  it("fortification adds +1 to each defense die; durability marked on 3-attacker rolls only", () => {
    let { s, att, def } = scarCombat(105, (st) => {
      st.territories["ural"].city = { type: "major", name: "Uralgrad", population: 2 }; // new: full city model
      st.territories["ural"].fortification = { max: 10, remaining: 10 };
    });
    s = applyAction(s, { type: "attack.chooseAttackers", playerId: att, count: 3 });
    s = applyAction(s, { type: "attack.defenderDice", playerId: def, count: 2 });
    let r = lastResolved(s);
    expect(r.final.def[0]).toBe(Math.min(6, r.natural.def[0] + 1)); // clamp 1..6
    expect(r.final.def[1]).toBe(Math.min(6, r.natural.def[1] + 1));
    expect(s.territories["ural"].fortification!.remaining).toBe(9);
    expect(s.log.some((e) => e.type === "FortificationDurabilityMarked")).toBe(true);
    // 2-attacker roll: dice still modified, durability NOT marked
    s = applyAction(s, { type: "attack.chooseAttackers", playerId: att, count: 2 });
    s = applyAction(s, { type: "attack.defenderDice", playerId: def, count: 2 });
    r = lastResolved(s);
    expect(r.final.def[0]).toBe(Math.min(6, r.natural.def[0] + 1)); // clamp 1..6
    expect(r.final.def[1]).toBe(Math.min(6, r.natural.def[1] + 1));
    expect(s.territories["ural"].fortification!.remaining).toBe(9);
  });

  it("fortification expires when the last durability box is marked", () => {
    let { s, att, def } = scarCombat(107, (st) => {
      st.territories["ural"].city = { type: "major", population: 2 }; // new: full city model
      st.territories["ural"].fortification = { max: 10, remaining: 1 };
    });
    s = applyAction(s, { type: "attack.chooseAttackers", playerId: att, count: 3 });
    s = applyAction(s, { type: "attack.defenderDice", playerId: def, count: 2 });
    expect(s.territories["ural"].fortification).toBeUndefined();
    expect(s.log.some((e) => e.type === "FortificationExpired")).toBe(true);
  });

  it("biohazard removes 1 troop from the controller's territory at their end of turn only", () => {
    let s = setupGame(109);
    const pid = s.turnOrder[0];
    const other = s.turnOrder[1];
    s.territories["ukraine"].controller = pid;
    s.territories["ukraine"].troops = 3;
    s.territories["ukraine"].scars = ["biohazard"];
    s.territories["ural"].controller = other;
    s.territories["ural"].troops = 2;
    s.territories["ural"].scars = ["biohazard"];
    s = playThroughTurnEnd(s, pid);
    expect(s.territories["ukraine"].troops).toBe(2);
    expect(s.territories["ural"].troops).toBe(2); // not other's end of turn — untouched
  });

  it("biohazard vacates the territory when its last troop is lost", () => {
    let s = setupGame(111);
    const pid = s.turnOrder[0];
    s.territories["ukraine"].controller = pid;
    s.territories["ukraine"].troops = 1;
    s.territories["ukraine"].scars = ["biohazard"];
    s = playThroughTurnEnd(s, pid);
    expect(s.territories["ukraine"].troops).toBe(0);
    expect(s.territories["ukraine"].controller).toBeUndefined();
  });

  it("biohazard also triggers on the end-of-turn draw path", () => {
    let s = setupGame(113);
    const pid = s.turnOrder[0];
    s.players[pid].conqueredEnemyThisTurn = true;
    const slot0 = s.sideboard.slots[0]!;
    const tid = (await_card(slot0)).territoryId!;
    s.territories[tid].controller = pid;
    s.territories[tid].troops = 5;
    s.territories[tid].scars = ["biohazard"];
    s.phase = "end_turn";
    s = applyAction(s, { type: "end.draw", playerId: pid, choice: { slot: 0 } });
    expect(s.territories[tid].troops).toBe(4);
  });
});

describe("scar play action (8b)", () => { // new
  /** Run the active player's recruit so a combat can be declared from ukraine. */
  function recruitThenAttackReady(s: GameState, att: string): GameState {
    s = applyAction(s, { type: "start.done", playerId: att });
    const myTerr = Object.entries(s.territories).find(([tid, t]) => t.controller === att && tid !== "ukraine")![0];
    s = applyAction(s, { type: "recruit.place", playerId: att, territoryId: myTerr, count: s.recruit!.remaining });
    return applyAction(s, { type: "recruit.done", playerId: att });
  }

  it("deals one hidden starter scar (Bunker/Ammo) instance per player when inventory suffices", () => {
    const s = setupGame(201);
    for (const pid of s.turnOrder) {
      expect(s.players[pid].scarCardCount).toBe(1);
      expect(s.players[pid].scarHand).toHaveLength(1);
      expect(["bunker", "ammo_shortage"]).toContain(s.players[pid].scarHand[0].scarId);
    }
    expect(s.log.some((e) => e.type === "ScarCardsDealt")).toBe(true);
  });

  it("a holder plays a scar onto an unscarred territory, consuming the instance and revealing it", () => {
    let s = setupGame(202);
    const pid = s.turnOrder[0];
    const inst = s.players[pid].scarHand[0];
    expect(s.territories["ural"].scars).toEqual([]);
    s = applyAction(s, { type: "scar.play", playerId: pid, scarInstanceId: inst.instanceId, territoryId: "ural" });
    expect(s.territories["ural"].scars).toEqual([inst.scarId]);
    expect(s.players[pid].scarHand).toHaveLength(0);
    expect(s.players[pid].scarCardCount).toBe(0);
    expect(s.log.some((e) => e.type === "ScarPlayed")).toBe(true);
  });

  it("rejects a scar you don't hold and a second scar on the same territory", () => {
    let s = setupGame(203);
    const a = s.turnOrder[0], b = s.turnOrder[1];
    expect(() => applyAction(s, { type: "scar.play", playerId: a, scarInstanceId: "nope#9", territoryId: "ural" })).toThrow(/do not hold/);
    s = applyAction(s, { type: "scar.play", playerId: a, scarInstanceId: s.players[a].scarHand[0].instanceId, territoryId: "ural" });
    expect(() => applyAction(s, { type: "scar.play", playerId: b, scarInstanceId: s.players[b].scarHand[0].instanceId, territoryId: "ural" })).toThrow(/one scar per territory/);
  });

  it("can be played on another player's turn (not gated to the active player)", () => {
    let s = setupGame(204);
    const active = s.turnOrder[0];
    const other = s.turnOrder[1];
    const inst = s.players[other].scarHand[0];
    s = applyAction(s, { type: "scar.play", playerId: other, scarInstanceId: inst.instanceId, territoryId: "ural" });
    expect(s.territories["ural"].scars).toEqual([inst.scarId]);
    expect(s.turnOrder[s.activeIdx]).toBe(active); // turn/active player unchanged
  });

  it("rejects playing during a post-roll missile window", () => {
    let s = setupGame(205);
    const att = s.turnOrder[0], def = s.turnOrder[1];
    s.players[att].missiles = 1;
    s.territories["ukraine"].controller = att; s.territories["ukraine"].troops = 20;
    s.territories["ural"].controller = def; s.territories["ural"].troops = 5;
    const inst = s.players[att].scarHand[0];
    s = recruitThenAttackReady(s, att);
    s = applyAction(s, { type: "attack.declare", playerId: att, from: "ukraine", to: "ural" });
    s = applyAction(s, { type: "attack.chooseAttackers", playerId: att, count: 3 });
    s = applyAction(s, { type: "attack.defenderDice", playerId: def, count: 2 });
    expect(s.combat?.natural).toBeTruthy(); // missile window open
    expect(() => applyAction(s, { type: "scar.play", playerId: att, scarInstanceId: inst.instanceId, territoryId: "kamchatka" }))
      .toThrow(/missile window|move-in/);
  });

  it("rejects playing during a conquest move-in", () => {
    let s = setupGame(206);
    const att = s.turnOrder[0], def = s.turnOrder[1];
    s.territories["ukraine"].controller = att; s.territories["ukraine"].troops = 20;
    s.territories["ural"].controller = def; s.territories["ural"].troops = 1;
    const inst = s.players[att].scarHand[0];
    s = recruitThenAttackReady(s, att);
    let guard = 0;
    while (guard++ < 50 && !s.combat?.awaitingMoveIn) {
      if (!s.combat) s = applyAction(s, { type: "attack.declare", playerId: att, from: "ukraine", to: "ural" });
      s = applyAction(s, { type: "attack.chooseAttackers", playerId: att, count: Math.min(3, s.territories["ukraine"].troops - 1) });
      s = applyAction(s, { type: "attack.defenderDice", playerId: def, count: 1 });
    }
    expect(s.combat?.awaitingMoveIn).toBeTruthy();
    expect(() => applyAction(s, { type: "scar.play", playerId: att, scarInstanceId: inst.instanceId, territoryId: "kamchatka" }))
      .toThrow(/missile window|move-in/);
  });

  it("reachability: a Bunker placed via scar.play changes a later defense roll on that territory", () => {
    let s = setupGame(208);
    const att = s.turnOrder[0], def = s.turnOrder[1];
    s.players[def].scarHand = [{ instanceId: "bunker#1", scarId: "bunker" }]; // ensure a known Bunker to play
    s.players[def].scarCardCount = 1;
    s.territories["ukraine"].controller = att; s.territories["ukraine"].troops = 20;
    s.territories["ural"].controller = def; s.territories["ural"].troops = 10;
    s = applyAction(s, { type: "scar.play", playerId: def, scarInstanceId: "bunker#1", territoryId: "ural" });
    expect(s.territories["ural"].scars).toEqual(["bunker"]);
    s = recruitThenAttackReady(s, att);
    s = applyAction(s, { type: "attack.declare", playerId: att, from: "ukraine", to: "ural" });
    s = applyAction(s, { type: "attack.chooseAttackers", playerId: att, count: 3 });
    s = applyAction(s, { type: "attack.defenderDice", playerId: def, count: 2 });
    const r = s.log.findLast((e) => e.type === "CombatResolved")!.data as any;
    expect(r.final.def[0]).toBe(Math.min(6, r.natural.def[0] + 1)); // placed-via-action Bunker fired in combat
  });
});

describe("cities (model & mechanics)", () => { // new: whole describe block (task `city`)
  it("counts a controlled city's population INSIDE the recruit division (corrected formula)", () => { // new: (territories + population) / 3, floor, min 3
    const s = setupGame(301);
    const pid = s.turnOrder[0];
    // Give pid 10 territories so the division dominates the minimum
    const empty = manifest.territories.filter((t) => !s.territories[t.id].controller).slice(0, 9);
    for (const t of empty) { s.territories[t.id].controller = pid; s.territories[t.id].troops = 1; }
    expect(recruitBreakdown(s, pid).fromTerritories).toBe(3); // floor(10/3)
    const tid = Object.entries(s.territories).find(([, t]) => t.controller === pid)![0];
    s.territories[tid].city = { type: "major", population: cityPopulation("major"), foundedByPlayerId: pid };
    const b = recruitBreakdown(s, pid);
    expect(b.population).toBe(2); // Major City population (pack data)
    expect(b.fromTerritories).toBe(4); // floor((10 + 2) / 3)
    expect(b.total).toBe(4); // population is not added at face value
  });

  it("a Major City is a legal start only for its founder; minor cities never qualify", () => {
    const s = setupGame(302);
    const empty = manifest.territories.find((t) => {
      const st = s.territories[t.id];
      return st.troops === 0 && !st.controller && !st.hqFaction;
    })!.id;
    const founder = s.turnOrder[0];
    const other = s.turnOrder[1];
    s.territories[empty].city = { type: "major", population: 2, foundedByPlayerId: founder };
    expect(isLegalStart(s, empty, false, undefined, founder)).toBe(true); // founder may start here
    expect(isLegalStart(s, empty, false, undefined, other)).toBe(false); // another player's Major City does not qualify
    s.territories[empty].city = { type: "minor", population: 1, foundedByPlayerId: founder };
    expect(isLegalStart(s, empty, false, undefined, founder)).toBe(false); // minor cities never qualify, even for the founder
  });

  it("expanding into an unoccupied city pays population resistance (minor 1, major 2)", () => {
    const expandInto = (city: NonNullable<GameState["territories"][string]["city"]>) => {
      let s = setupGame(303);
      const pid = s.turnOrder[0];
      s.territories["ukraine"].controller = pid;
      s.territories["ukraine"].troops = 10;
      s.territories["ural"].controller = undefined;
      s.territories["ural"].troops = 0;
      s.territories["ural"].city = city;
      s.phase = "expand_attack";
      return applyAction(s, { type: "attack.expand", playerId: pid, from: "ukraine", to: "ural", troops: 5 });
    };
    expect(expandInto({ type: "minor", population: 1 }).territories["ural"].troops).toBe(4); // 5 - 1
    const major = expandInto({ type: "major", population: 2 });
    expect(major.territories["ural"].troops).toBe(3); // 5 - 2
    expect(major.territories["ural"].controller).toBe(major.turnOrder[0]);
  });
});

describe("faction powers (9)", () => { // new: whole describe block
  /** Run the active player's start+recruit so combat/expansion can begin. */
  function toAttackPhase(s: GameState): GameState {
    const pid = s.turnOrder[s.activeIdx];
    s = applyAction(s, { type: "start.done", playerId: pid });
    const myTerr = Object.entries(s.territories).find(([tid, t]) => t.controller === pid && tid !== "ukraine")![0];
    s = applyAction(s, { type: "recruit.place", playerId: pid, territoryId: myTerr, count: s.recruit!.remaining });
    return applyAction(s, { type: "recruit.done", playerId: pid });
  }
  /** Attacker on ukraine vs defender on `target`; powers assigned by direct mutation. */
  function powerCombat(seed: number, prep: (s: GameState, att: string, def: string) => void) {
    let s = setupGame(seed);
    const att = s.turnOrder[0];
    const def = s.turnOrder[1];
    // neutralize the default combat-relevant picks so each test controls exactly one power
    s.factionPowers[s.players[att].factionId!] = "territory_card_reinforcement";
    s.factionPowers[s.players[def].factionId!] = "territory_card_reinforcement";
    s.territories["ukraine"].controller = att;
    s.territories["ukraine"].troops = 30;
    s.territories["ural"].controller = def;
    s.territories["ural"].troops = 10;
    prep(s, att, def);
    s = toAttackPhase(s);
    return { s, att, def };
  }
  function roll(s: GameState, att: string, def: string, attDice = 3, defDice = 2): GameState {
    if (!s.combat) s = applyAction(s, { type: "attack.declare", playerId: att, from: "ukraine", to: "ural" });
    s = applyAction(s, { type: "attack.chooseAttackers", playerId: att, count: attDice });
    return applyAction(s, { type: "attack.defenderDice", playerId: def, count: defDice });
  }
  const lastResolved = (s: GameState) =>
    s.log.findLast((e) => e.type === "CombatResolved")!.data as {
      natural: { att: number[]; def: number[] }; final: { att: number[]; def: number[] };
      powerModifiers: { powerId: string; dieIndex: number; delta: number }[];
    };

  it("setup requires a first-play power choice from the faction's own pair and records it", () => {
    let s = createGame({ gameId: "g", seed: 5, players: P });
    const first = s.setup!.chooserOrder[0];
    expect(() => applyAction(s, { type: "setup.choose", playerId: first, factionId: "khan_industries", territoryId: "japan" })).toThrow(/starting power/);
    expect(() => applyAction(s, { type: "setup.choose", playerId: first, factionId: "khan_industries", territoryId: "japan", powerId: "early_maneuver" })).toThrow(/does not belong/);
    s = applyAction(s, { type: "setup.choose", playerId: first, factionId: "khan_industries", territoryId: "japan", powerId: "hq_reinforcement" });
    expect(s.factionPowers["khan_industries"]).toBe("hq_reinforcement");
    expect(s.log.some((e) => e.type === "FactionPowerChosen")).toBe(true);
  });

  it("campaign-stored power choices are permanent (attached to the faction)", () => {
    const camp = initialCampaign("Terra");
    camp.factionPowerChoices = { khan_industries: "hq_reinforcement" };
    let s = createGame({ gameId: "g", seed: 5, players: P, campaign: camp });
    const first = s.setup!.chooserOrder[0];
    expect(() => applyAction(s, { type: "setup.choose", playerId: first, factionId: "khan_industries", territoryId: "japan", powerId: "territory_card_reinforcement" })).toThrow(/permanent/);
    s = applyAction(s, { type: "setup.choose", playerId: first, factionId: "khan_industries", territoryId: "japan" }); // stored choice applies, no pick needed
    expect(s.factionPowers["khan_industries"]).toBe("hq_reinforcement");
  });

  it("round_up_recruiting rounds the (territories+population)/3 division up, before min and bonuses", () => {
    const s = setupGame(501);
    const pid = s.turnOrder[0];
    const empty = manifest.territories.filter((t) => !s.territories[t.id].controller).slice(0, 9);
    for (const t of empty) { s.territories[t.id].controller = pid; s.territories[t.id].troops = 1; }
    expect(recruitBreakdown(s, pid).fromTerritories).toBe(3); // floor(10/3) without the power
    s.factionPowers[s.players[pid].factionId!] = "round_up_recruiting";
    expect(recruitBreakdown(s, pid).fromTerritories).toBe(4); // ceil(10/3)
    // the minimum still applies when the rounded value is below it
    for (const t of empty) { s.territories[t.id].controller = undefined; s.territories[t.id].troops = 0; }
    expect(recruitBreakdown(s, pid).fromTerritories).toBe(3); // max(ceil(1/3), 3)
  });

  it("hq_reinforcement adds 1 troop to each controlled territory holding any HQ at turn start", () => {
    let s = setupGame(502);
    const p0 = s.turnOrder[0];
    const p1 = s.turnOrder[1];
    s.factionPowers[s.players[p1].factionId!] = "hq_reinforcement";
    // p1 also holds a captured territory containing another faction's HQ
    const p1Hq = Object.entries(s.territories).find(([, t]) => t.controller === p1 && t.hqFaction)![0];
    s.territories["ukraine"].controller = p1;
    s.territories["ukraine"].troops = 5;
    s.territories["ukraine"].hqFaction = s.players[p0].factionId!;
    const hqBefore = s.territories[p1Hq].troops;
    // play p0's turn to hand the turn to p1
    s = applyAction(s, { type: "start.done", playerId: p0 });
    const myTerr = Object.entries(s.territories).find(([, t]) => t.controller === p0)![0];
    s = applyAction(s, { type: "recruit.place", playerId: p0, territoryId: myTerr, count: s.recruit!.remaining });
    s = applyAction(s, { type: "recruit.done", playerId: p0 });
    s = applyAction(s, { type: "phase.endAttacks", playerId: p0 });
    s = applyAction(s, { type: "phase.endManeuver", playerId: p0 });
    s = applyAction(s, { type: "end.turn", playerId: p0 });
    expect(s.turnOrder[s.activeIdx]).toBe(p1);
    expect(s.territories[p1Hq].troops).toBe(hqBefore + 1); // own HQ reinforced
    expect(s.territories["ukraine"].troops).toBe(6); // captured enemy-HQ territory reinforced too
    expect(s.log.filter((e) => e.type === "FactionPowerApplied" && e.data?.powerId === "hq_reinforcement")).toHaveLength(2);
  });

  it("fortified_hq: +1 to each defense die when Die Mechaniker defends its own HQ territory", () => {
    const { s: s0, att, def } = powerCombat(503, (st, _att, d) => {
      st.factionPowers[st.players[d].factionId!] = "fortified_hq";
      st.territories["ural"].hqFaction = st.players[d].factionId!;
    });
    const s = roll(s0, att, def);
    const r = lastResolved(s);
    expect(r.final.def[0]).toBe(Math.min(6, r.natural.def[0] + 1));
    expect(r.final.def[1]).toBe(Math.min(6, r.natural.def[1] + 1));
    expect(s.log.some((e) => e.type === "FactionPowerApplied" && e.data?.powerId === "fortified_hq")).toBe(true);
    // no durability marking without a real Fortification mark, even on a 3-attacker roll
    expect(s.log.some((e) => e.type === "FortificationDurabilityMarked")).toBe(false);
  });

  it("fortified_hq does not stack with an active Fortification mark", () => {
    const { s: s0, att, def } = powerCombat(504, (st, _att, d) => {
      st.factionPowers[st.players[d].factionId!] = "fortified_hq";
      st.territories["ural"].hqFaction = st.players[d].factionId!;
      st.territories["ural"].city = { type: "minor", population: 1 };
      st.territories["ural"].fortification = { max: 10, remaining: 5 };
    });
    const s = roll(s0, att, def);
    const r = lastResolved(s);
    expect(r.powerModifiers).toEqual([]); // the mark already gives +1 each; power stands down
    expect(r.final.def[0]).toBe(Math.min(6, r.natural.def[0] + 1)); // exactly +1, not +2
    expect(r.final.def[1]).toBe(Math.min(6, r.natural.def[1] + 1));
  });

  it("fortified_hq is inert when Die Mechaniker defends a territory without its HQ", () => {
    const { s: s0, att, def } = powerCombat(505, (st, _att, d) => {
      st.factionPowers[st.players[d].factionId!] = "fortified_hq"; // ural has no HQ piece
    });
    const s = roll(s0, att, def);
    expect(lastResolved(s).powerModifiers).toEqual([]);
  });

  it("defensive_stand: a natural double-6 defense locks the territory for the rest of the turn", () => {
    let locked = false;
    for (let seed = 600; seed < 900 && !locked; seed++) {
      const { s: s0, att, def } = powerCombat(seed, (st, _att, d) => {
        st.factionPowers[st.players[d].factionId!] = "defensive_stand";
      });
      const s = roll(s0, att, def);
      const nat = (s.log.findLast((e) => e.type === "DiceRolled")!.data as any).def as number[];
      if (!(nat.length === 2 && nat[0] === 6 && nat[1] === 6)) continue;
      locked = true;
      expect(s.blockedAttackTargets).toContain("ural");
      expect(s.log.some((e) => e.type === "FactionPowerApplied" && e.data?.powerId === "defensive_stand")).toBe(true);
      // combat may stay open, but a NEW declaration on ural this turn is illegal
      let s2 = s;
      if (s2.combat) s2 = applyAction(s2, { type: "attack.cancel", playerId: att });
      expect(() => applyAction(s2, { type: "attack.declare", playerId: att, from: "ukraine", to: "ural" })).toThrow(/Defensive Stand/);
    }
    expect(locked).toBe(true); // a double-6 defense must occur within the seed range
  });

  it("lower_die_intimidation: -1 on the lower defense die at the first target, until Enclave attacks elsewhere", () => {
    const { s: s0, att, def } = powerCombat(506, (st, a, d) => {
      st.factionPowers[st.players[a].factionId!] = "lower_die_intimidation";
      st.territories["afghanistan"].controller = d; // a second target adjacent to ukraine
      st.territories["afghanistan"].troops = 8;
    });
    let s = applyAction(s0, { type: "attack.declare", playerId: att, from: "ukraine", to: "ural" });
    s = roll(s, att, def);
    let r = lastResolved(s);
    expect(r.powerModifiers).toEqual([{ powerId: "lower_die_intimidation", playerId: att, dieIndex: 1, delta: -1 }]);
    expect(r.final.def[1]).toBe(Math.max(1, r.natural.def[1] - 1)); // lower die -1, clamped
    expect(r.final.def[0]).toBe(r.natural.def[0]);
    // keep attacking the SAME territory: still applies
    if (!s.combat) s = applyAction(s, { type: "attack.declare", playerId: att, from: "ukraine", to: "ural" });
    s = roll(s, att, def);
    expect(lastResolved(s).powerModifiers).toHaveLength(1);
    // attack a DIFFERENT territory: effect breaks for the rest of the turn
    if (s.combat) s = applyAction(s, { type: "attack.cancel", playerId: att });
    s = applyAction(s, { type: "attack.declare", playerId: att, from: "ukraine", to: "afghanistan" });
    s = roll(s, att, def);
    expect(lastResolved(s).powerModifiers).toEqual([]);
    // even returning to the first target: broken stays broken this turn
    if (s.combat) s = applyAction(s, { type: "attack.cancel", playerId: att });
    s = applyAction(s, { type: "attack.declare", playerId: att, from: "ukraine", to: "ural" });
    s = roll(s, att, def);
    expect(lastResolved(s).powerModifiers).toEqual([]);
  });

  it("total_conquest: a natural three-of-a-kind that kills wipes all defenders", () => {
    let fired = false;
    for (let seed = 700; seed < 1100 && !fired; seed++) {
      const { s: s0, att, def } = powerCombat(seed, (st, a) => {
        st.factionPowers[st.players[a].factionId!] = "total_conquest";
      });
      let s = applyAction(s0, { type: "attack.declare", playerId: att, from: "ukraine", to: "ural" });
      s = roll(s, att, def);
      const ev = s.log.findLast((e) => e.type === "FactionPowerApplied" && e.data?.powerId === "total_conquest");
      if (!ev) continue;
      fired = true;
      const nat = (s.log.findLast((e) => e.type === "DiceRolled")!.data as any).att as number[];
      expect(nat[0]).toBe(nat[2]); // three of a kind
      expect(s.territories["ural"].troops).toBe(0); // ALL 10 defenders removed (max 2 die normally)
      expect(s.combat?.awaitingMoveIn).toBeTruthy(); // conquers normally
    }
    expect(fired).toBe(true);
  });

  it("expansionist_supply: expanding into 4+ unoccupied territories earns the end-of-turn draw", () => {
    const run = (expansions: number) => {
      let s = setupGame(507);
      const pid = s.turnOrder[0];
      s.factionPowers[s.players[pid].factionId!] = "expansionist_supply";
      s.territories["ukraine"].controller = pid;
      s.territories["ukraine"].troops = 30;
      const targets = ["ural", "afghanistan", "middle_east", "southern_europe"].slice(0, expansions);
      for (const t of targets) { s.territories[t].controller = undefined; s.territories[t].troops = 0; s.territories[t].scars = []; }
      s = toAttackPhase(s);
      for (const t of targets) s = applyAction(s, { type: "attack.expand", playerId: pid, from: "ukraine", to: t, troops: 2 });
      s = applyAction(s, { type: "phase.endAttacks", playerId: pid });
      s = applyAction(s, { type: "phase.endManeuver", playerId: pid });
      return { s, pid };
    };
    const four = run(4);
    expect(four.s.players[four.pid].conqueredEnemyThisTurn).toBe(false);
    const drawn = applyAction(four.s, { type: "end.draw", playerId: four.pid, choice: { coin: true } });
    expect(drawn.log.some((e) => e.type === "FactionPowerApplied" && e.data?.powerId === "expansionist_supply")).toBe(true);
    const three = run(3);
    expect(() => applyAction(three.s, { type: "end.draw", playerId: three.pid, choice: { coin: true } })).toThrow(/conquered/);
  });

  it("territory_card_reinforcement: optional +1 troop where Khan draws a matching Territory card", () => {
    let s = setupGame(508);
    const pid = s.turnOrder[0];
    s.factionPowers[s.players[pid].factionId!] = "territory_card_reinforcement";
    s.players[pid].conqueredEnemyThisTurn = true;
    const slot0 = s.sideboard.slots[0]!;
    const tid = (await_card(slot0)).territoryId!;
    s.territories[tid].controller = pid;
    s.territories[tid].troops = 3;
    s.phase = "end_turn";
    const before = s.territories[tid].troops;
    const s2 = applyAction(s, { type: "end.draw", playerId: pid, choice: { slot: 0 }, khanReinforce: true });
    expect(s2.territories[tid].troops).toBe(before + 1);
    expect(s2.log.some((e) => e.type === "FactionPowerApplied" && e.data?.powerId === "territory_card_reinforcement")).toBe(true);
    // without the power the flag is rejected
    s.factionPowers[s.players[pid].factionId!] = "hq_reinforcement";
    expect(() => applyAction(s, { type: "end.draw", playerId: pid, choice: { slot: 0 }, khanReinforce: true })).toThrow(/Reinforcing/);
  });

  it("early_maneuver: Saharan takes its one maneuver at a stable point of its own turn", () => {
    let s = setupGame(509);
    const pid = s.turnOrder[0];
    s.factionPowers[s.players[pid].factionId!] = "early_maneuver";
    s.territories["ukraine"].controller = pid;
    s.territories["ukraine"].troops = 6;
    s.territories["ural"].controller = pid;
    s.territories["ural"].troops = 2;
    s = toAttackPhase(s); // expand_attack phase, no combat open
    const uralBefore = s.territories["ural"].troops;
    s = applyAction(s, { type: "maneuver.move", playerId: pid, from: "ukraine", to: "ural", count: 3 });
    expect(s.territories["ural"].troops).toBe(uralBefore + 3);
    expect(s.log.some((e) => e.type === "FactionPowerApplied" && e.data?.powerId === "early_maneuver")).toBe(true);
    expect(s.maneuverUsed).toBe(true);
    expect(() => applyAction(s, { type: "maneuver.move", playerId: pid, from: "ural", to: "ukraine", count: 1 })).toThrow(/One maneuver/);
  });

  it("maneuver outside the maneuver phase stays illegal without early_maneuver", () => {
    let s = setupGame(510);
    const pid = s.turnOrder[0];
    s.factionPowers[s.players[pid].factionId!] = "unconnected_maneuver"; // an extraManeuver power, but not the early one
    s.territories["ukraine"].controller = pid;
    s.territories["ukraine"].troops = 6;
    s.territories["ural"].controller = pid;
    s.territories["ural"].troops = 2;
    s = toAttackPhase(s);
    expect(() => applyAction(s, { type: "maneuver.move", playerId: pid, from: "ukraine", to: "ural", count: 3 })).toThrow(/Illegal in phase/);
  });

  it("unconnected_maneuver: source and target need only be controlled", () => {
    let s = setupGame(511);
    const pid = s.turnOrder[0];
    s.factionPowers[s.players[pid].factionId!] = "territory_card_reinforcement"; // neutralize the default pick (pid may be Saharan)
    s.territories["ukraine"].controller = pid;
    s.territories["ukraine"].troops = 6;
    s.territories["japan"].controller = pid; // not connected to ukraine through pid's territories
    s.territories["japan"].troops = 2;
    s = toAttackPhase(s);
    s = applyAction(s, { type: "phase.endAttacks", playerId: pid });
    // without the power: rejected
    expect(() => applyAction(s, { type: "maneuver.move", playerId: pid, from: "ukraine", to: "japan", count: 3 })).toThrow(/not connected/);
    s.factionPowers[s.players[pid].factionId!] = "unconnected_maneuver";
    const japanBefore = s.territories["japan"].troops;
    s = applyAction(s, { type: "maneuver.move", playerId: pid, from: "ukraine", to: "japan", count: 3 });
    expect(s.territories["japan"].troops).toBe(japanBefore + 3);
    expect(s.log.some((e) => e.type === "FactionPowerApplied" && e.data?.powerId === "unconnected_maneuver")).toBe(true);
  });

  it("power choices made in-game fold into the campaign", () => {
    const s = setupGame(512);
    const camp = initialCampaign("Terra");
    const g = { ...s, winner: s.turnOrder[0], gameNumber: 1 } as GameState; // minimal finished shape for the fold
    g.results = {};
    const folded = applyGameToCampaign(camp, g);
    expect(folded.factionPowerChoices).toEqual({
      khan_industries: "territory_card_reinforcement",
      die_mechaniker: "defensive_stand",
      saharan_republic: "unconnected_maneuver",
    });
  });
});

describe("end-game rewards & signatures (10a)", () => { // new: whole describe block
  /** Drive a 3p game to victory via red-star purchase; winner = turnOrder[0], the other two hold on. */
  function wonGame(seed: number, prep?: (s: GameState) => void): { s: GameState; winner: string; heldOn: string[] } {
    let s = setupGame(seed);
    const winner = s.turnOrder[0];
    prep?.(s);
    s.players[winner].redStarTokens = 2; // +1 purchased +1 own controlled HQ = 4
    s.players[winner].hand = ["42", "43", "44", "45"];
    s = applyAction(s, { type: "start.buyRedStar", playerId: winner, cardIds: ["42", "43", "44", "45"] });
    expect(s.phase).toBe("game_over");
    return { s, winner, heldOn: s.rewards!.order.slice(1) };
  }
  const controlledBy = (s: GameState, pid: string) =>
    Object.entries(s.territories).find(([, t]) => t.controller === pid && !t.city)![0];

  it("victory auto-signs the board for the winner and opens rewards winner-first, clockwise", () => {
    const { s, winner } = wonGame(401);
    expect(s.signatures[winner]).toBe(1);
    expect(s.log.some((e) => e.type === "BoardSigned" && e.playerId === winner)).toBe(true);
    expect(s.rewards!.order).toEqual([s.turnOrder[0], s.turnOrder[1], s.turnOrder[2]]); // winner first, held-on clockwise
    expect(s.rewards!.committed).toBe(false);
    expect(waitingOn(s)).toBe(winner); // rewards flow routes to the current claimant
  });

  it("winner names a continent; named continents cannot be renamed; namer gets a personal +1 when controlling it", () => {
    const { s, winner, heldOn } = wonGame(402, (st) => {
      st.continents["north_america"] = { name: "Old World", namedBy: "someone_else" };
    });
    expect(() => applyAction(s, { type: "reward.choose", playerId: winner, reward: { kind: "name_continent", continentId: "north_america", name: "X" } })).toThrow(/already named/);
    expect(() => applyAction(s, { type: "reward.choose", playerId: winner, reward: { kind: "name_continent", continentId: "australia", name: "   " } })).toThrow(/name/i);
    const s2 = applyAction(s, { type: "reward.choose", playerId: winner, reward: { kind: "name_continent", continentId: "australia", name: "Ada's Reach" } });
    expect(s2.continents["australia"]).toEqual({ name: "Ada's Reach", namedBy: winner });
    expect(s2.log.some((e) => e.type === "ContinentNamed")).toBe(true);
    for (const t of manifest.territories.filter((t) => t.continent === "australia")) {
      s2.territories[t.id].controller = winner;
      s2.territories[t.id].troops = 1;
    }
    const au = recruitBreakdown(s2, winner).continents.find((c) => c.id === "australia")!;
    expect(au.namedBonus).toBe(1);
    expect(au.total).toBe(au.base + 1);
    for (const t of manifest.territories.filter((t) => t.continent === "australia")) s2.territories[t.id].controller = heldOn[0];
    const auOther = recruitBreakdown(s2, heldOn[0]).continents.find((c) => c.id === "australia")!;
    expect(auOther.namedBonus).toBe(0); // the +1 is personal to the namer
  });

  it("winner founds a Major City on any city-less territory (even enemy-held), consuming inventory", () => {
    const { s, winner, heldOn } = wonGame(403);
    const enemyTid = controlledBy(s, heldOn[0]);
    const s2 = applyAction(s, { type: "reward.choose", playerId: winner, reward: { kind: "found_major_city", territoryId: enemyTid, name: "Novagrad" } });
    expect(s2.territories[enemyTid].city).toEqual({ type: "major", population: cityPopulation("major"), name: "Novagrad", foundedByPlayerId: winner });
    expect(s2.inventories.majorCities).toBe(4);
    const { s: s3, winner: w3 } = wonGame(404, (st) => { st.territories["ural"].city = { type: "minor", population: 1 }; });
    expect(() => applyAction(s3, { type: "reward.choose", playerId: w3, reward: { kind: "found_major_city", territoryId: "ural", name: "Nope" } })).toThrow(/city/);
  });

  it("winner cancels a territory scar, consuming a cancel sticker", () => {
    const { s, winner } = wonGame(405, (st) => { st.territories["ural"].scars = ["bunker"]; });
    expect(() => applyAction(s, { type: "reward.choose", playerId: winner, reward: { kind: "cancel_scar", territoryId: "ukraine" } })).toThrow(/scar/i);
    const s2 = applyAction(s, { type: "reward.choose", playerId: winner, reward: { kind: "cancel_scar", territoryId: "ural" } });
    expect(s2.territories["ural"].scars).toEqual([]);
    expect(s2.inventories.cancelStickers).toBe(3);
    expect(s2.log.some((e) => e.type === "ScarCancelled")).toBe(true);
  });

  it("winner changes a continent bonus; each mark used once campaign-wide, each continent changed once", () => {
    const { s, winner } = wonGame(406, (st) => { st.continents["europe"] = { bonusMark: 1 }; }); // the +1 mark is spent
    expect(() => applyAction(s, { type: "reward.choose", playerId: winner, reward: { kind: "change_continent_bonus", continentId: "australia", delta: 1 } })).toThrow(/already/);
    expect(() => applyAction(s, { type: "reward.choose", playerId: winner, reward: { kind: "change_continent_bonus", continentId: "europe", delta: -1 } })).toThrow(/already/);
    const s2 = applyAction(s, { type: "reward.choose", playerId: winner, reward: { kind: "change_continent_bonus", continentId: "australia", delta: -1 } });
    expect(s2.continents["australia"].bonusMark).toBe(-1);
    for (const t of manifest.territories.filter((t) => t.continent === "australia")) {
      s2.territories[t.id].controller = winner;
      s2.territories[t.id].troops = 1;
    }
    const au = recruitBreakdown(s2, winner).continents.find((c) => c.id === "australia")!;
    expect(au.globalModifier).toBe(-1); // global: applies to whoever controls it
    expect(au.total).toBe(au.base - 1);
  });

  it("winner fortifies a city at 10 durability, replacing any existing fortification", () => {
    const { s, winner } = wonGame(407, (st) => {
      st.territories["ural"].city = { type: "minor", population: 1 };
      st.territories["ural"].fortification = { max: 10, remaining: 3 };
    });
    expect(() => applyAction(s, { type: "reward.choose", playerId: winner, reward: { kind: "fortify_city", territoryId: "ukraine" } })).toThrow(/city/);
    const s2 = applyAction(s, { type: "reward.choose", playerId: winner, reward: { kind: "fortify_city", territoryId: "ural" } });
    expect(s2.territories["ural"].fortification).toEqual({ max: 10, remaining: 10 });
    expect(s2.inventories.fortifyMarks).toBe(4);
  });

  it("held-on players found Minor Cities on controlled territories, clockwise after the winner", () => {
    const { s, winner, heldOn } = wonGame(408);
    expect(() => applyAction(s, { type: "reward.choose", playerId: heldOn[0], reward: { kind: "found_minor_city", territoryId: controlledBy(s, heldOn[0]), name: "Early" } })).toThrow(/Not your reward/);
    let s2 = applyAction(s, { type: "reward.choose", playerId: winner, reward: { kind: "name_continent", continentId: "asia", name: "Khanate" } });
    expect(() => applyAction(s2, { type: "reward.choose", playerId: heldOn[0], reward: { kind: "name_continent", continentId: "europe", name: "Nope" } })).toThrow(/held-on/i);
    expect(() => applyAction(s2, { type: "reward.choose", playerId: heldOn[0], reward: { kind: "found_minor_city", territoryId: controlledBy(s2, winner), name: "Nope" } })).toThrow(/control/);
    const tid = controlledBy(s2, heldOn[0]);
    s2 = applyAction(s2, { type: "reward.choose", playerId: heldOn[0], reward: { kind: "found_minor_city", territoryId: tid, name: "Linden" } });
    expect(s2.territories[tid].city).toEqual({ type: "minor", population: cityPopulation("minor"), name: "Linden", foundedByPlayerId: heldOn[0] });
    expect(s2.inventories.minorCities).toBe(8);
    expect(s2.log.some((e) => e.type === "MinorCityFounded")).toBe(true);
  });

  it("held-on upgrades a controlled territory card (+1 resource, never coins, max 6)", () => {
    const { s, winner, heldOn } = wonGame(409);
    let s2 = applyAction(s, { type: "reward.choose", playerId: winner, reward: { kind: "name_continent", continentId: "africa", name: "Zaharan" } });
    const p1 = heldOn[0];
    const tid = controlledBy(s2, p1);
    const cardDef = contentPack.cards.territoryCards.find((c) => c.territoryId === tid)!;
    expect(() => applyAction(s2, { type: "reward.choose", playerId: p1, reward: { kind: "upgrade_territory_card", cardId: "42" } })).toThrow(/territory card/i);
    const otherCard = contentPack.cards.territoryCards.find((c) => c.territoryId === controlledBy(s2, winner))!.id;
    expect(() => applyAction(s2, { type: "reward.choose", playerId: p1, reward: { kind: "upgrade_territory_card", cardId: otherCard } })).toThrow(/control/);
    s2.cardModifications[cardDef.id] = { resources: 6 };
    expect(() => applyAction(s2, { type: "reward.choose", playerId: p1, reward: { kind: "upgrade_territory_card", cardId: cardDef.id } })).toThrow(/6/);
    delete s2.cardModifications[cardDef.id];
    s2 = applyAction(s2, { type: "reward.choose", playerId: p1, reward: { kind: "upgrade_territory_card", cardId: cardDef.id } });
    expect(s2.cardModifications[cardDef.id]).toEqual({ resources: cardDef.resources + 1 });
    expect(s2.log.some((e) => e.type === "TerritoryCardUpgraded")).toBe(true);
  });

  it("recruit trade-ins read upgraded card resources", () => {
    let s = setupGame(410);
    const pid = s.turnOrder[0];
    const cardA = contentPack.cards.territoryCards[0];
    const cardB = contentPack.cards.territoryCards[1];
    s.players[pid].hand = [cardA.id, cardB.id];
    s.cardModifications[cardA.id] = { resources: 5 }; // upgraded in a prior game (carried by 10b)
    s = applyAction(s, { type: "start.done", playerId: pid });
    s = applyAction(s, { type: "recruit.trade", playerId: pid, cardIds: [cardA.id, cardB.id] });
    const ev = s.log.findLast((e) => e.type === "ResourceCardsTraded")!;
    expect(ev.data!.resources).toBe(5 + cardB.resources);
  });

  it("held-on may pass; winner may not while a winner reward is available; commit fires when all resolve", () => {
    const { s, winner, heldOn } = wonGame(411);
    expect(() => applyAction(s, { type: "reward.choose", playerId: winner, reward: { kind: "pass" } })).toThrow(/must resolve/i);
    let s2 = applyAction(s, { type: "reward.choose", playerId: winner, reward: { kind: "change_continent_bonus", continentId: "south_america", delta: 1 } });
    s2 = applyAction(s2, { type: "reward.choose", playerId: heldOn[0], reward: { kind: "pass" } });
    expect(s2.log.some((e) => e.type === "RewardPassed")).toBe(true);
    s2 = applyAction(s2, { type: "reward.choose", playerId: heldOn[1], reward: { kind: "pass" } });
    expect(s2.rewards!.committed).toBe(true);
    expect(s2.log.some((e) => e.type === "EndGameRewardsCommitted")).toBe(true);
    expect(waitingOn(s2)).toBeUndefined();
    expect(() => applyAction(s2, { type: "reward.choose", playerId: winner, reward: { kind: "name_continent", continentId: "africa", name: "Late" } })).toThrow(/No end-game reward/);
  });
});

import { contentPack, cityPopulation } from "@risk/content"; // new: cityPopulation reads pop from pack data
function await_card(id: string): { territoryId?: string } {
  return contentPack.cards.territoryCards.find((c) => c.id === id) ?? {};
}

// new: task 11 — sealed-module unlock engine (SPEC §9)
import { describe, it, expect } from "vitest";
import { createGame, applyAction, RuleViolation } from "./engine.ts";
import { initialCampaign, applyGameToCampaign, supplyModuleContent, type CampaignState } from "./campaign.ts";
import type { GameState } from "./types.ts";

const P = [
  { id: "u1", name: "Ada" },
  { id: "u2", name: "Lin" },
  { id: "u3", name: "Rex" },
];
const SEAT_POWERS: Record<string, string> = {
  khan_industries: "territory_card_reinforcement",
  die_mechaniker: "defensive_stand",
  saharan_republic: "unconnected_maneuver",
};

function seatAll(s: GameState): GameState {
  const factions = ["khan_industries", "die_mechaniker", "saharan_republic"];
  const starts = ["alaska", "brazil", "western_australia"];
  for (const pid of [...s.setup!.chooserOrder]) {
    const idx = P.findIndex((p) => p.id === pid);
    s = applyAction(s, { type: "setup.choose", playerId: pid, factionId: factions[idx], territoryId: starts[idx], powerId: s.factionPowers[factions[idx]] ? undefined : SEAT_POWERS[factions[idx]] });
  }
  return s;
}

function winNow(s: GameState): GameState {
  const winner = s.turnOrder[s.activeIdx];
  s.players[winner].redStarTokens = 2;
  s.players[winner].hand = ["42", "43", "44", "45"];
  return applyAction(s, { type: "start.buyRedStar", playerId: winner, cardIds: ["42", "43", "44", "45"] });
}

describe("unlock engine (11)", () => {
  it("Pack 2 reveals mid-game when a player is eliminated by a failed Join the War", () => {
    let s = seatAll(createGame({ gameId: "g", seed: 61, players: P }));
    const victim = s.turnOrder[0];
    const other = s.turnOrder[1];
    // wipe the victim and fill the whole board: no legal join territory remains
    for (const t of Object.values(s.territories)) {
      if (t.controller === victim) { t.controller = undefined; t.troops = 0; t.hqFaction = undefined; }
    }
    for (const t of Object.values(s.territories)) {
      if (!t.controller) { t.controller = other; t.troops = 1; }
    }
    s = applyAction(s, { type: "start.done", playerId: victim });
    expect(s.players[victim].eliminated).toBe(true);
    expect(s.log.some((e) => e.type === "ModuleTriggered" && e.data?.moduleId === "pack_2_comeback_mercenaries")).toBe(true);
    expect(s.unlockedModules).toContain("pack_2_comeback_mercenaries"); // mid-game reveal
    expect(s.log.some((e) => e.type === "ModuleRevealed" && e.data?.moduleId === "pack_2_comeback_mercenaries")).toBe(true);
    const req = s.log.find((e) => e.type === "ModuleContentRequired" && e.data?.moduleId === "pack_2_comeback_mercenaries");
    expect(req?.data?.items).toEqual(["powers"]); // comeback power text pauses for the host (task 12)
  });

  it("a revealed Pack 2 folds into the campaign: module flag, 3 Mercenary instances, content-required entry", () => {
    let s = seatAll(createGame({ gameId: "g", seed: 62, players: P }));
    s.unlockedModules.push("pack_2_comeback_mercenaries"); // as revealed mid-game
    s = winNow(s);
    for (const pid of s.rewards!.order) {
      s = applyAction(s, {
        type: "reward.choose", playerId: pid,
        reward: pid === s.winner ? { kind: "name_continent", continentId: "africa", name: "Zaharan" } : { kind: "pass" },
      });
    }
    const camp = applyGameToCampaign(initialCampaign("Terra"), s);
    expect(camp.unlockedModules).toEqual(["pack_2_comeback_mercenaries"]);
    expect(camp.inventories.scarInstances["mercenary"]).toBe(3);
    expect(camp.contentRequired).toEqual([{ moduleId: "pack_2_comeback_mercenaries", items: ["powers"] }]);
  });

  it("mercenary adds 1 troop at the controller's end of turn only", () => {
    let s = seatAll(createGame({ gameId: "g", seed: 63, players: P }));
    const pid = s.turnOrder[0];
    const other = s.turnOrder[1];
    s.territories["ukraine"].controller = pid;
    s.territories["ukraine"].troops = 3;
    s.territories["ukraine"].scars = ["mercenary"];
    s.territories["ural"].controller = other;
    s.territories["ural"].troops = 2;
    s.territories["ural"].scars = ["mercenary"];
    s = applyAction(s, { type: "start.done", playerId: pid });
    const myTerr = Object.entries(s.territories).find(([tid, t]) => t.controller === pid && tid !== "ukraine")![0];
    s = applyAction(s, { type: "recruit.place", playerId: pid, territoryId: myTerr, count: s.recruit!.remaining });
    s = applyAction(s, { type: "recruit.done", playerId: pid });
    s = applyAction(s, { type: "phase.endAttacks", playerId: pid });
    s = applyAction(s, { type: "phase.endManeuver", playerId: pid });
    s = applyAction(s, { type: "end.turn", playerId: pid });
    expect(s.territories["ukraine"].troops).toBe(4); // controller's end of turn: +1
    expect(s.territories["ural"].troops).toBe(2); // not the other player's end of turn
  });

  it("module scars are playable only once their module is revealed", () => {
    let s = seatAll(createGame({ gameId: "g", seed: 64, players: P }));
    const pid = s.turnOrder[0];
    s.players[pid].scarHand = [{ instanceId: "mercenary#1", scarId: "mercenary" }];
    s.players[pid].scarCardCount = 1;
    expect(() => applyAction(s, { type: "scar.play", playerId: pid, scarInstanceId: "mercenary#1", territoryId: "ural" })).toThrow(/not playable/);
    s.unlockedModules.push("pack_2_comeback_mercenaries");
    s = applyAction(s, { type: "scar.play", playerId: pid, scarInstanceId: "mercenary#1", territoryId: "ural" });
    expect(s.territories["ural"].scars).toEqual(["mercenary"]);
  });

  it("unlocked module scars join the setup deal pool from the campaign inventory", () => {
    const camp = initialCampaign("Terra");
    camp.gameNumber = 3;
    camp.unlockedModules = ["pack_2_comeback_mercenaries"];
    camp.inventories.scarInstances = { bunker: 0, ammo_shortage: 0, mercenary: 3 };
    const s = createGame({ gameId: "g", seed: 65, players: P, campaign: camp });
    for (const pid of Object.keys(s.players)) {
      expect(s.players[pid].scarCardCount).toBe(1);
      expect(s.players[pid].scarHand[0].scarId).toBe("mercenary");
    }
  });

  it("Pack 1 reveals at end-game when the 9th Minor City is founded; the next game blocks on the advanced draft", () => {
    const camp = initialCampaign("Terra");
    camp.gameNumber = 5;
    camp.foundedMinorCities = 8;
    camp.inventories.minorCities = 1; // the 9th (last) Minor City is still available
    let s = seatAll(createGame({ gameId: "g", seed: 66, players: P, campaign: camp }));
    s = winNow(s);
    const winner = s.winner!;
    const heldOn = s.rewards!.order.slice(1);
    s = applyAction(s, { type: "reward.choose", playerId: winner, reward: { kind: "name_continent", continentId: "asia", name: "Khanate" } });
    const tid = Object.entries(s.territories).find(([, t]) => t.controller === heldOn[0] && !t.city)![0];
    s = applyAction(s, { type: "reward.choose", playerId: heldOn[0], reward: { kind: "found_minor_city", territoryId: tid, name: "Ninth" } });
    expect(s.log.some((e) => e.type === "ModuleTriggered" && e.data?.moduleId === "pack_1_advanced_draft_biohazards")).toBe(true);
    expect(s.unlockedModules).not.toContain("pack_1_advanced_draft_biohazards"); // end-game reveal waits for the last reward
    s = applyAction(s, { type: "reward.choose", playerId: heldOn[1], reward: { kind: "pass" } });
    expect(s.rewards!.committed).toBe(true);
    expect(s.unlockedModules).toContain("pack_1_advanced_draft_biohazards"); // revealed after rewards commit
    expect(s.log.some((e) => e.type === "ModuleRevealed" && e.data?.moduleId === "pack_1_advanced_draft_biohazards")).toBe(true);

    const folded = applyGameToCampaign(camp, s);
    expect(folded.unlockedModules).toContain("pack_1_advanced_draft_biohazards");
    expect(folded.inventories.scarInstances["biohazard"]).toBe(3);
    expect(folded.contentRequired.some((c) => c.moduleId === "pack_1_advanced_draft_biohazards" && c.items.includes("draft"))).toBe(true);
    // Pack 1's advanced setup REPLACES base roll setup and blocks until draft values are host-entered (D5)
    expect(() => createGame({ gameId: "g2", seed: 67, players: P, campaign: folded })).toThrow(/draft/);
  });

  it("a game-end elimination (knockout classification) reveals Pack 2 at end-game", () => {
    let s = seatAll(createGame({ gameId: "g", seed: 69, players: P }));
    const knocked = s.turnOrder[2];
    for (const t of Object.values(s.territories)) {
      if (t.controller === knocked) { t.controller = undefined; t.troops = 0; } // knocked out, never rejoined
    }
    s = winNow(s);
    expect(s.results![s.players[knocked].factionId!]).toBe("eliminated");
    expect(s.unlockedModules).not.toContain("pack_2_comeback_mercenaries"); // end-game reveal waits for rewards
    for (const pid of s.rewards!.order) {
      s = applyAction(s, {
        type: "reward.choose", playerId: pid,
        reward: pid === s.winner ? { kind: "name_continent", continentId: "europe", name: "Neu Europa" } : { kind: "pass" },
      });
    }
    expect(s.unlockedModules).toContain("pack_2_comeback_mercenaries");
  });

  it("campaign-seeded games start with previously unlocked modules active", () => {
    const camp = initialCampaign("Terra");
    camp.unlockedModules = ["pack_2_comeback_mercenaries"];
    const s = createGame({ gameId: "g", seed: 68, players: P, campaign: camp });
    expect(s.unlockedModules).toEqual(["pack_2_comeback_mercenaries"]);
  });

  it("supplying host content clears the pause and lifts the Pack 1 draft gate (import wizard, 12)", () => { // new: whole test
    const camp = initialCampaign("Terra");
    camp.gameNumber = 6;
    camp.unlockedModules = ["pack_1_advanced_draft_biohazards"];
    camp.contentRequired = [{ moduleId: "pack_1_advanced_draft_biohazards", items: ["draft", "events"] }];
    expect(() => createGame({ gameId: "g", seed: 71, players: P, campaign: camp })).toThrow(/draft/);
    // unknown module / item are rejected
    expect(() => supplyModuleContent(camp, "nope", "draft", {})).toThrow(/pending/);
    expect(() => supplyModuleContent(camp, "pack_1_advanced_draft_biohazards", "missions", {})).toThrow(/pending/);
    const afterDraft = supplyModuleContent(camp, "pack_1_advanced_draft_biohazards", "draft", { cards: ["4 troops", "2 coins"] });
    expect(afterDraft.contentRequired).toEqual([{ moduleId: "pack_1_advanced_draft_biohazards", items: ["events"] }]);
    expect(afterDraft.hostContent["pack_1_advanced_draft_biohazards.draft"]).toEqual({ cards: ["4 troops", "2 coins"] });
    expect(camp.contentRequired[0].items).toEqual(["draft", "events"]); // pure: input untouched
    // the draft gate lifts; the remaining "events" item does not block game creation
    const s = createGame({ gameId: "g", seed: 72, players: P, campaign: afterDraft });
    expect(s.gameNumber).toBe(7);
    // supplying the last item removes the module's pause entirely
    const done = supplyModuleContent(afterDraft, "pack_1_advanced_draft_biohazards", "events", ["urban_panic: ..."]);
    expect(done.contentRequired).toEqual([]);
  });
});

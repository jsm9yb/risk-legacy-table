import { describe, expect, it } from "vitest";
import { applyAction } from "@risk/rules";
import { atExpandAttack } from "../test-fixtures.ts";
import { actionPreview, friendlyRoute } from "./preview.ts";
import type { InteractionModel } from "./InteractionPolicy.ts";

describe("action previews", () => {
  it("distinguishes joining the war from placing a starting HQ", () => {
    const { gs, pid, target } = atExpandAttack(414);
    const config = { actorId: pid, placeCount: 1, moveCount: 1, expandCount: 1 };
    const interaction: InteractionModel = { mode: "recruit", territories: { [target]: "start" }, instruction: "Join" };
    expect(actionPreview(gs, interaction, config, target)?.kind).toBe("join");
    expect(actionPreview(gs, { ...interaction, mode: "setup" }, config, target)?.kind).toBe("setup");
  });

  it("uses the real entry losses and leaves the state untouched", () => {
    const { gs, pid, mine, target } = atExpandAttack(410);
    gs.territories[mine].troops = 12;
    gs.territories[target] = { troops: 0, scars: ["fallout"], city: { type: "minor", population: 1, name: "Gate" } };
    const before = structuredClone(gs);
    const interaction: InteractionModel = { mode: "expand_attack", selectedTerritoryId: mine, territories: { [target]: "start" }, instruction: "Expand" };
    const preview = actionPreview(gs, interaction, { actorId: pid, placeCount: 1, moveCount: 1, expandCount: 6 }, target)!;
    const committed = applyAction(gs, { type: "attack.expand", playerId: pid, from: mine, to: target, troops: 6 });
    expect(preview.targetAfter).toBe(committed.territories[target].troops);
    expect(preview.sourceAfter).toBe(6);
    expect(preview.label).toContain("lost on entry");
    expect(gs).toEqual(before);
  });

  it("does not preview enemy decisions or invent battle outcomes", () => {
    const { gs, pid, mine, target } = atExpandAttack(411);
    const interaction: InteractionModel = { mode: "spectator", selectedTerritoryId: mine, territories: { [target]: "attack" }, instruction: "Watch" };
    const config = { actorId: pid, placeCount: 1, moveCount: 1, expandCount: 2 };
    expect(actionPreview(gs, interaction, config, target)).toBeUndefined();
    const preview = actionPreview(gs, { ...interaction, mode: "expand_attack" }, config, target)!;
    expect(preview.targetAfter).toBe(gs.territories[target].troops);
    expect(preview.label).toContain("outcome decided by dice");
  });

  it("uses friendly connectivity and only bypasses it for the appropriate power", () => {
    const { gs, pid } = atExpandAttack(412);
    for (const territory of Object.values(gs.territories)) territory.controller = undefined;
    for (const id of ["alaska", "alberta", "ontario", "brazil"]) gs.territories[id].controller = pid;
    expect(friendlyRoute(gs, pid, "alaska", "ontario")).toEqual(["alaska", "alberta", "ontario"]);
    expect(friendlyRoute(gs, pid, "alaska", "brazil")).toEqual([]);
    gs.factionPowers[gs.players[pid].factionId!] = "unconnected_maneuver";
    expect(friendlyRoute(gs, pid, "alaska", "brazil")).toEqual(["alaska", "brazil"]);
  });

  it("clamps reinforcement previews to the remaining reserve", () => {
    const { gs, pid, mine } = atExpandAttack(413);
    gs.phase = "join_or_recruit";
    gs.recruit = { remaining: 2, breakdown: { territories: 1, fromTerritories: 3, population: 0, continents: [], tradeIns: 0, total: 3 } };
    const interaction: InteractionModel = { mode: "recruit", territories: { [mine]: "recruit" }, instruction: "Recruit" };
    const preview = actionPreview(gs, interaction, { actorId: pid, placeCount: 9, moveCount: 1, expandCount: 1 }, mine)!;
    expect(preview.count).toBe(2);
    expect(preview.reserveAfter).toBe(0);
    expect(preview.targetAfter).toBe(gs.territories[mine].troops + 2);
  });
});

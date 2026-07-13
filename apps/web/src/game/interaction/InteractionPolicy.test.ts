import { describe, expect, it } from "vitest";
import { atExpandAttack } from "../test-fixtures.ts";
import { deriveInteractionModel, interactionPolicy } from "./deriveInteractionModel.ts";

describe("Interaction Policy", () => {
  it("gives pointer and accessibility adapters one attack model", () => {
    const { gs, pid, mine, target } = atExpandAttack(201);
    const source = deriveInteractionModel({ state: gs, actorId: pid });
    expect(source.territories[mine]).toBe("selected");
    const selected = deriveInteractionModel({ state: gs, actorId: pid, selectedTerritoryId: mine });
    expect(selected.territories[target]).toBe("attack");
    expect(interactionPolicy.activate(target, { state: gs, actorId: pid, selectedTerritoryId: mine })).toEqual({
      kind: "action", action: { type: "attack.declare", playerId: pid, from: mine, to: target },
    });
  });

  it("keeps spectators inspectable without dispatching actions", () => {
    const { gs, pid, mine } = atExpandAttack(202);
    const input = { state: gs, actorId: pid, viewerId: "spectator" };
    expect(deriveInteractionModel(input).mode).toBe("spectator");
    expect(interactionPolicy.activate(mine, input).kind).toBe("explanation");
  });

  it("derives setup, recruit, expansion, and maneuver actions from one policy", () => {
    const { gs, pid, mine, target } = atExpandAttack(203);

    const setup = structuredClone(gs);
    setup.phase = "setup";
    for (const territoryId of Object.keys(setup.territories)) setup.territories[territoryId] = { troops: 0, scars: [] };
    const setupInput = { state: setup, actorId: pid, setupFactionId: setup.players[pid].factionId! };
    expect(deriveInteractionModel(setupInput).mode).toBe("setup");
    expect(interactionPolicy.activate(mine, setupInput).kind).toBe("action");

    const recruit = structuredClone(gs);
    recruit.phase = "join_or_recruit";
    recruit.recruit = { remaining: 3, breakdown: { territories: 3, fromTerritories: 3, population: 0, continents: [], tradeIns: 0, total: 3 } };
    expect(interactionPolicy.activate(mine, { state: recruit, actorId: pid, placeCount: 2 })).toMatchObject({ kind: "action", action: { type: "recruit.place", count: 2 } });

    const expansion = structuredClone(gs);
    expansion.territories[target] = { troops: 0, scars: [] };
    expect(interactionPolicy.activate(target, { state: expansion, actorId: pid, selectedTerritoryId: mine, expandCount: 2 })).toMatchObject({ kind: "action", action: { type: "attack.expand", troops: 2 } });

    const maneuver = structuredClone(gs);
    maneuver.phase = "maneuver";
    maneuver.territories[target] = { controller: pid, troops: 1, scars: [] };
    expect(interactionPolicy.activate(target, { state: maneuver, actorId: pid, selectedTerritoryId: mine, moveCount: 2 })).toMatchObject({ kind: "action", action: { type: "maneuver.move", count: 2 } });
  });

  it("announces scar and reward targeting modes", () => {
    const { gs, pid } = atExpandAttack(204);
    expect(deriveInteractionModel({ state: gs, actorId: pid, overrideMode: "scar" })).toMatchObject({ mode: "scar", instruction: "Choose a territory for the Scar" });
    expect(deriveInteractionModel({ state: gs, actorId: pid, overrideMode: "reward" })).toMatchObject({ mode: "reward", instruction: "Choose a reward target" });
  });
});

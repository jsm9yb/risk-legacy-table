// new (UI-9): shared test fixtures — real-engine game states for component tests.
import { contentPack } from "@risk/content";
import { applyAction, createGame, isLegalStart, waitingOn, type GameState } from "@risk/rules";
import { manifest, territoryById } from "@risk/map";

/** Drive setup with real actions: three players pick factions, powers, and legal starts. */
export function throughSetup(seed: number): GameState {
  let gs = createGame({
    gameId: `fixture-${seed}`,
    seed,
    players: [
      { id: "u1", name: "Ada" },
      { id: "u2", name: "Lin" },
      { id: "u3", name: "Rex" },
    ],
  });
  while (gs.phase === "setup") {
    const pid = waitingOn(gs)!;
    const faction = contentPack.factions.find((f) => !Object.values(gs.players).some((x) => x.factionId === f.id))!;
    const start = manifest.territories.find((t) => isLegalStart(gs, t.id, true, faction.id, pid))!;
    gs = applyAction(gs, {
      type: "setup.choose", playerId: pid, factionId: faction.id, territoryId: start.id,
      powerId: gs.factionPowers[faction.id] ? undefined : faction.startingPowers[0],
    });
  }
  return gs;
}

/** Real actions to expand_attack, then plant a 1-troop enemy outpost next to the attacker's stack. */
export function atExpandAttack(seed: number) {
  let gs = throughSetup(seed);
  const pid = waitingOn(gs)!;
  gs = applyAction(gs, { type: "start.done", playerId: pid });
  const mine = Object.entries(gs.territories).find(([, t]) => t.controller === pid)![0];
  gs = applyAction(gs, { type: "recruit.place", playerId: pid, territoryId: mine, count: gs.recruit!.remaining });
  gs = applyAction(gs, { type: "recruit.done", playerId: pid });
  const enemy = gs.turnOrder.find((x) => x !== pid)!;
  const target = territoryById(mine).neighbors.find((n) => !gs.territories[n].controller)!;
  gs.territories[target] = { controller: enemy, troops: 1, scars: [] };
  return { gs, pid, mine, target, enemy };
}

/** Drive the planted battle to conquest through the real action API (deterministic per seed). */
export function conquerOutpost(seed: number) {
  let { gs, pid, mine, target, enemy } = atExpandAttack(seed);
  gs = applyAction(gs, { type: "attack.declare", playerId: pid, from: mine, to: target });
  for (let i = 0; i < 40 && gs.combat; i++) {
    const c = gs.combat;
    if (c.awaitingMoveIn) { gs = applyAction(gs, { type: "attack.moveIn", playerId: pid, count: c.awaitingMoveIn.max }); break; }
    if (c.natural && c.window) { gs = applyAction(gs, { type: "combat.pass", playerId: waitingOn(gs)! }); continue; }
    if (c.attackerDice === undefined) { gs = applyAction(gs, { type: "attack.chooseAttackers", playerId: pid, count: Math.min(3, gs.territories[mine].troops - 1) }); continue; }
    gs = applyAction(gs, { type: "attack.defenderDice", playerId: enemy, count: 1 });
  }
  if (gs.territories[target].controller !== pid) throw new Error("fixture failed to conquer the outpost");
  return { gs, pid, mine, target, enemy };
}

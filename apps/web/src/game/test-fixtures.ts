// new (UI-9): shared test fixtures — real-engine game states for component tests.
import { contentPack } from "@risk/content";
import { applyAction, createGame, isLegalStart, waitingOn, type Action, type GameState } from "@risk/rules";
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

/** Greedy bot step (simulator policy) — stops at game_over so reward tests drive the UI. */ // new (UI-12)
function pickAction(s: GameState): Action | null {
  const pid = waitingOn(s);
  if (!pid || s.phase === "game_over") return null;
  const p = s.players[pid];
  if (s.phase === "setup") {
    const faction = contentPack.factions.find((f) => !Object.values(s.players).some((x) => x.factionId === f.id))!;
    const start = manifest.territories.find((t) => isLegalStart(s, t.id, true, faction.id, pid))!;
    return { type: "setup.choose", playerId: pid, factionId: faction.id, territoryId: start.id, powerId: s.factionPowers[faction.id] ? undefined : faction.startingPowers[0] };
  }
  const c = s.combat;
  if (c) {
    if (c.awaitingMoveIn) return { type: "attack.moveIn", playerId: c.attacker, count: c.awaitingMoveIn.max };
    if (c.natural && c.window) return { type: "combat.pass", playerId: pid };
    if (c.attackerDice === undefined) return { type: "attack.chooseAttackers", playerId: pid, count: Math.min(3, s.territories[c.from].troops - 1) };
    if (c.defenderDice === undefined) return { type: "attack.defenderDice", playerId: pid, count: Math.min(2, s.territories[c.to].troops) };
  }
  const owned = () => Object.entries(s.territories).filter(([, t]) => t.controller === pid);
  switch (s.phase) {
    case "start_turn":
      if (p.hand.length >= 4) return { type: "start.buyRedStar", playerId: pid, cardIds: p.hand.slice(0, 4) };
      return { type: "start.done", playerId: pid };
    case "join_or_recruit": {
      if (owned().length === 0) {
        const start = manifest.territories.find((t) => isLegalStart(s, t.id, false, p.factionId, pid));
        return start ? { type: "join.enter", playerId: pid, territoryId: start.id } : null;
      }
      if (s.recruit && s.recruit.remaining > 0) {
        const mine = owned();
        const nextToHq = mine.find(([tid]) => territoryById(tid).neighbors.some((n) => {
          const x = s.territories[n];
          return x.hqFaction && x.controller && x.controller !== pid;
        }));
        const frontier = mine.find(([tid]) => territoryById(tid).neighbors.some((n) => s.territories[n].controller && s.territories[n].controller !== pid));
        return { type: "recruit.place", playerId: pid, territoryId: (nextToHq ?? frontier ?? mine[0])[0], count: s.recruit.remaining };
      }
      return { type: "recruit.done", playerId: pid };
    }
    case "expand_attack": {
      const cands: { from: string; to: string; hq: boolean; margin: number }[] = [];
      for (const [tid, t] of owned()) {
        if (t.troops < 3) continue;
        for (const n of territoryById(tid).neighbors) {
          const nt = s.territories[n];
          if (nt.controller && nt.controller !== pid && nt.troops <= t.troops - 2 && !s.blockedAttackTargets.includes(n)) {
            cands.push({ from: tid, to: n, hq: !!nt.hqFaction, margin: t.troops - nt.troops });
          }
        }
      }
      cands.sort((x, y) => Number(y.hq) - Number(x.hq) || y.margin - x.margin);
      if (cands[0]) return { type: "attack.declare", playerId: pid, from: cands[0].from, to: cands[0].to };
      const expandable = owned()
        .filter(([tid, t]) => t.troops >= 4 && territoryById(tid).neighbors.some((n) => {
          const nt = s.territories[n];
          return !nt.controller && nt.troops === 0 && !nt.city && nt.scars.length === 0;
        }))
        .sort((x, y) => y[1].troops - x[1].troops)[0];
      if (expandable) {
        const [tid, t] = expandable;
        const to = territoryById(tid).neighbors.find((n) => {
          const nt = s.territories[n];
          return !nt.controller && nt.troops === 0 && !nt.city && nt.scars.length === 0;
        })!;
        return { type: "attack.expand", playerId: pid, from: tid, to, troops: Math.floor(t.troops / 2) };
      }
      return { type: "phase.endAttacks", playerId: pid };
    }
    case "maneuver":
      return { type: "phase.endManeuver", playerId: pid };
    case "end_turn": {
      if (!p.conqueredEnemyThisTurn) return { type: "end.turn", playerId: pid };
      const slot = s.sideboard.slots.findIndex((id) => {
        const cd = id && contentPack.cards.territoryCards.find((x) => x.id === id);
        return cd && s.territories[cd.territoryId].controller === pid;
      });
      if (slot >= 0) return { type: "end.draw", playerId: pid, choice: { slot } };
      if (s.sideboard.coinPile.length > 0) return { type: "end.draw", playerId: pid, choice: { coin: true } };
      return { type: "end.turn", playerId: pid };
    }
    default:
      return null;
  }
}

/** Bot-drive a whole game to game_over with the reward flow still open (deterministic per seed). */ // new (UI-12)
export function driveToVictory(seed: number): GameState {
  let gs = throughSetup(seed);
  for (let i = 0; i < 8000; i++) {
    if (gs.phase === "game_over") break;
    const a = pickAction(gs);
    if (!a) break;
    gs = applyAction(gs, a);
  }
  if (gs.phase !== "game_over" || !gs.winner) throw new Error("fixture failed to reach a winner");
  return gs;
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

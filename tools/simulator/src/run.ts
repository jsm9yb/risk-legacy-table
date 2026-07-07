/**
 * Seeded full-game sanity harness: plays a complete game with a naive greedy
 * policy through the real engine API (same actions a client would send).
 * Usage: npm run sim -- [seed] [players]
 */
import { createGame, applyAction, waitingOn, redStars, isLegalStart, initialCampaign, applyGameToCampaign, type GameState, type Action } from "@risk/rules"; // new: isLegalStart; campaign chain (10b)
import { contentPack } from "@risk/content";
import { territoryById, manifest } from "@risk/map";

const seed = Number(process.argv[2] ?? 1234);
const playerCount = Math.min(5, Math.max(3, Number(process.argv[3] ?? 4))); // new: 3-5 players
const players = Array.from({ length: playerCount }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` }));

let s = createGame({ gameId: `sim-${seed}`, seed, players });

function owned(s: GameState, pid: string) {
  return Object.entries(s.territories).filter(([, t]) => t.controller === pid);
}
function pickAction(s: GameState): Action | null {
  const pid = waitingOn(s);
  if (!pid) return null;
  const p = s.players[pid];

  if (s.phase === "setup") {
    const faction = contentPack.factions.find((f) => !Object.values(s.players).some((x) => x.factionId === f.id))!;
    const start = manifest.territories.find((t) => isLegalStart(s, t.id, true, faction.id))!; // new: HQ-adjacency-aware
    const powerId = s.factionPowers[faction.id] ? undefined : faction.startingPowers[0]; // new (9): first play picks the faction's first power
    return { type: "setup.choose", playerId: pid, factionId: faction.id, territoryId: start.id, powerId };
  }
  const c = s.combat;
  if (c) {
    if (c.awaitingMoveIn) return { type: "attack.moveIn", playerId: c.attacker, count: c.awaitingMoveIn.max };
    if (c.natural && c.window) return { type: "combat.pass", playerId: pid };
    if (c.attackerDice === undefined) return { type: "attack.chooseAttackers", playerId: pid, count: Math.min(3, s.territories[c.from].troops - 1) };
    if (c.defenderDice === undefined) return { type: "attack.defenderDice", playerId: pid, count: Math.min(2, s.territories[c.to].troops) };
  }
  switch (s.phase) {
    case "start_turn":
      if (p.hand.length >= 4) return { type: "start.buyRedStar", playerId: pid, cardIds: p.hand.slice(0, 4) };
      return { type: "start.done", playerId: pid };
    case "join_or_recruit": {
      if (owned(s, pid).length === 0) {
        const start = manifest.territories.find((t) => isLegalStart(s, t.id, false, p.factionId)); // new
        return start ? { type: "join.enter", playerId: pid, territoryId: start.id } : null;
      }
      if (s.recruit && s.recruit.remaining > 0) {
        const mine = owned(s, pid);
        // new: prefer a territory adjacent to an enemy HQ, else any frontier, else anything
        const nextToHq = mine.find(([tid]) =>
          territoryById(tid).neighbors.some((n) => { const x = s.territories[n]; return x.hqFaction && x.controller && x.controller !== pid; })
        );
        const frontier = mine.find(([tid]) =>
          territoryById(tid).neighbors.some((n) => s.territories[n].controller && s.territories[n].controller !== pid)
        );
        const target = nextToHq ?? frontier ?? mine[0];
        return { type: "recruit.place", playerId: pid, territoryId: target[0], count: s.recruit.remaining };
      }
      return { type: "recruit.done", playerId: pid };
    }
    case "expand_attack": {
      // new: rank candidate attacks, preferring enemy-HQ targets (board Red Stars -> win)
      type Cand = { from: string; to: string; hq: boolean; margin: number };
      const cands: Cand[] = [];
      for (const [tid, t] of owned(s, pid)) {
        if (t.troops < 3) continue;
        for (const n of territoryById(tid).neighbors) {
          const nt = s.territories[n];
          if (nt.controller && nt.controller !== pid && nt.troops <= t.troops - 2) {
            cands.push({ from: tid, to: n, hq: !!nt.hqFaction, margin: t.troops - nt.troops });
          }
        }
      }
      cands.sort((a, b) => Number(b.hq) - Number(a.hq) || b.margin - a.margin); // new: HQs first, then biggest edge
      if (cands[0]) return { type: "attack.declare", playerId: pid, from: cands[0].from, to: cands[0].to };
      // new: no attack available -> expand into an empty neighbor from the strongest stack to grow toward enemies
      const expandable = owned(s, pid)
        .filter(([tid, t]) => t.troops >= 4 && territoryById(tid).neighbors.some((n) => !s.territories[n].controller && s.territories[n].troops === 0))
        .sort((a, b) => b[1].troops - a[1].troops)[0];
      if (expandable) {
        const [tid, t] = expandable;
        const to = territoryById(tid).neighbors.find((n) => !s.territories[n].controller && s.territories[n].troops === 0)!;
        return { type: "attack.expand", playerId: pid, from: tid, to, troops: Math.floor(t.troops / 2) };
      }
      return { type: "phase.endAttacks", playerId: pid };
    }
    case "maneuver":
      return { type: "phase.endManeuver", playerId: pid };
    case "end_turn": {
      if (!p.conqueredEnemyThisTurn) return { type: "end.turn", playerId: pid };
      const slot = s.sideboard.slots.findIndex((id) => {
        if (!id) return false;
        const c = contentPack.cards.territoryCards.find((x) => x.id === id);
        return c && s.territories[c.territoryId].controller === pid;
      });
      if (slot >= 0) return { type: "end.draw", playerId: pid, choice: { slot } };
      if (s.sideboard.coinPile.length > 0) return { type: "end.draw", playerId: pid, choice: { coin: true } };
      return { type: "end.turn", playerId: pid }; // edge: nothing drawable
    }
    default:
      return null;
  }
}

const MAX = 6000; // new: bounded for a fast sanity run

function playToWinner(state: GameState): { state: GameState; steps: number } { // new: refactored so a chained game 2 can reuse it
  let steps = 0;
  while (state.phase !== "game_over" && steps < MAX) {
    const a = pickAction(state);
    if (!a) break;
    try {
      state = applyAction(state, a);
    } catch (e) {
      console.error(`Step ${steps}: ${a.type} rejected: ${(e as Error).message}`);
      if (a.type === "end.draw") { state = applyAction(state, { type: "end.turn", playerId: a.playerId }); }
      else throw e;
    }
    steps++;
  }
  return { state, steps };
}

// End-game rewards (10a): drive the post-win resolution through the real action API. // new
function resolveRewards(state: GameState): GameState { // new: refactored into a function for the chained game
  let guard = 0;
  while (state.rewards && !state.rewards.committed && guard++ < 10) {
    const pid = waitingOn(state)!; // current reward claimant
    const isWinner = state.rewards.order[0] === pid;
    if (isWinner) {
      const unnamed = manifest.continents.find((c) => !state.continents[c.id]?.name)!;
      state = applyAction(state, { type: "reward.choose", playerId: pid, reward: { kind: "name_continent", continentId: unnamed.id, name: `${state.players[pid].name}'s ${unnamed.name}` } });
    } else {
      const tid = Object.entries(state.territories).find(([, t]) => t.controller === pid && !t.city)?.[0];
      state = applyAction(state, tid // found a Minor City where possible, else pass
        ? { type: "reward.choose", playerId: pid, reward: { kind: "found_minor_city", territoryId: tid, name: `Fort ${state.players[pid].name}` } }
        : { type: "reward.choose", playerId: pid, reward: { kind: "pass" } });
    }
  }
  return state;
}

const g1 = playToWinner(s); // new
const steps = g1.steps; // new
s = resolveRewards(g1.state); // new

console.log(`seed=${seed} players=${playerCount} steps=${steps} events=${s.log.length} turns=${s.turnNumber}`);
if (s.winner) {
  console.log(`WINNER: ${s.players[s.winner].name} (${s.players[s.winner].factionId}) — ${s.winReason}`);
  console.log("results:", s.results);
  console.log(`rewards: committed=${s.rewards?.committed} signatures=${JSON.stringify(s.signatures)}`); // new
  console.log(`  continents named: ${Object.entries(s.continents).filter(([, c]) => c.name).map(([id, c]) => `${id}="${c.name}"`).join(", ") || "none"}`); // new
  console.log(`  minor cities founded: ${Object.entries(s.territories).filter(([, t]) => t.city?.type === "minor").map(([tid, t]) => `${t.city!.name}@${tid}`).join(", ") || "none"} (inventory ${s.inventories.minorCities}/9)`); // new
} else {
  console.log(`No winner after ${steps} steps (phase=${s.phase})`);
  for (const p of Object.values(s.players)) {
    console.log(`  ${p.name}: territories=${owned(s, p.id).length} stars=${redStars(s, p.id).total} eliminated=${p.eliminated}`);
  }
}
const dice = s.log.filter((e) => e.type === "DiceRolled").length;
console.log(`audit: ${dice} dice events, ${s.log.filter((e) => e.type === "ResourceCardDrawn").length} draws, ${s.log.filter((e) => e.type === "TerritoryConquered").length} conquests`);
const powerCounts: Record<string, number> = {}; // new (9): reachability — which powers actually fired
for (const e of s.log) if (e.type === "FactionPowerApplied") powerCounts[(e.data as any).powerId] = (powerCounts[(e.data as any).powerId] ?? 0) + 1; // new
console.log(`powers applied: ${Object.entries(powerCounts).map(([k, v]) => `${k}×${v}`).join(", ") || "none"}`); // new
console.log(`modules unlocked: ${s.unlockedModules.join(", ") || "none"}`); // new (11)

// 10b reachability: fold the finished game into a campaign and play GAME 2 seeded from it. // new
if (s.winner && s.rewards?.committed) { // new: whole block
  const camp = applyGameToCampaign(initialCampaign("Sim World"), s);
  let g2state = createGame({ gameId: `sim-${seed}-g2`, seed: seed + 1, players, campaign: camp });
  const w1 = s.winner;
  console.log(`--- GAME 2 seeded from campaign (gameNumber=${g2state.gameNumber}): ${g2state.players[w1].name} starts with ${g2state.players[w1].missiles} missile(s) + ${g2state.players[w1].redStarTokens} token(s); board carries ${camp.board.cities.length} cities, ${camp.board.scars.length} scars`);
  const g2 = playToWinner(g2state);
  g2state = resolveRewards(g2.state);
  if (g2state.winner) {
    const g2Powers: Record<string, number> = {}; // new (9)
    for (const e of g2state.log) if (e.type === "FactionPowerApplied") g2Powers[(e.data as any).powerId] = (g2Powers[(e.data as any).powerId] ?? 0) + 1; // new
    console.log(`GAME 2 WINNER: ${g2state.players[g2state.winner].name} (${g2state.players[g2state.winner].factionId}) after ${g2.steps} steps — ${g2state.winReason}; signatures=${JSON.stringify(g2state.signatures)}`);
    console.log(`GAME 2 powers applied: ${Object.entries(g2Powers).map(([k, v]) => `${k}×${v}`).join(", ") || "none"}`); // new
  } else {
    console.log(`GAME 2: no winner after ${g2.steps} steps (phase=${g2state.phase})`);
    process.exitCode = 1; // a campaign-seeded game must still converge
  }
}

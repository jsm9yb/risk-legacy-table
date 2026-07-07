/**
 * Deterministic Risk Legacy rules engine.
 * Pure-ish: applyAction clones state, validates, mutates the clone, appends events, returns it.
 * All randomness flows through state.rngState (seeded, replayable).
 *
 * v1 scope: setup draft, start-of-turn, join-the-war/recruit, expand & attack with
 * missile timing windows, maneuver, end-turn sideboard draw, coin depletion award,
 * knockout/elimination, victory + automatic result classification.
 * Deferred (next slices): faction power executable handlers, unlock module activation. // new
 */
import { manifest, territoryById } from "@risk/map";
import { contentPack, ruleValue, troopsForResources, cityPopulation } from "@risk/content"; // new: cityPopulation for reward founding
import { rollDie, shuffled } from "./rng.ts";
import type {
  Action, GameState, GameEvent, PlayerId, TerritoryId, FactionId, RecruitBreakdown, PendingCombat,
} from "./types.ts";
import type { CampaignState } from "./campaign.ts"; // new (10b)

export class RuleViolation extends Error {}

const card = (id: string) =>
  contentPack.cards.territoryCards.find((c) => c.id === id) ??
  contentPack.cards.coinCards.find((c) => c.id === id);

/** Card resource value with upgrade_territory_card modifications overlaid on the pack base value. */ // new
const cardResources = (s: GameState, id: string) => s.cardModifications[id]?.resources ?? card(id)!.resources; // new

function emit(s: GameState, type: string, playerId?: PlayerId, data?: Record<string, unknown>) {
  s.log.push({ seq: ++s.eventSeq, type, playerId, data });
}

// ---------- Game creation / setup ----------

export interface NewGameConfig {
  gameId: string;
  seed: number;
  players: { id: PlayerId; name: string; redStarTokens?: number; missiles?: number }[];
  campaign?: CampaignState; // new (10b): seed this game from persisted campaign legacy
}

export function createGame(cfg: NewGameConfig): GameState {
  if (cfg.players.length < 3 || cfg.players.length > 5) throw new RuleViolation("3-5 players (2-player is not a supported starter mode)"); // new: starter rules
  const camp = cfg.campaign; // new
  // Pack 1 (D5): the advanced setup draft REPLACES base roll setup and blocks until draft card values are host-entered. // new (11)
  if (camp?.unlockedModules.includes("pack_1_advanced_draft_biohazards") // new
      && camp.contentRequired?.some((c) => c.moduleId === "pack_1_advanced_draft_biohazards" && c.items.includes("draft"))) { // new
    throw new RuleViolation("Pack 1 is open: the advanced setup draft replaces base roll setup and needs host-entered draft card values (import wizard)"); // new
  } // new
  const s: GameState = {
    gameId: cfg.gameId,
    seed: cfg.seed,
    gameNumber: (camp?.gameNumber ?? 0) + 1, // new: campaign game counter (1 with no history)
    rngState: cfg.seed >>> 0,
    phase: "setup",
    turnOrder: [],
    activeIdx: 0,
    turnNumber: 0,
    players: {},
    territories: Object.fromEntries(manifest.territories.map((t) => [t.id, { troops: 0, scars: [] }])),
    sideboard: {
      territoryDeck: [], slots: [null, null, null, null], discard: [],
      coinPile: [], coinDiscard: [], destroyed: [], coinDepletionAwarded: false,
    },
    startTurnDone: false,
    maneuverUsed: false,
    factionPowers: { ...camp?.factionPowerChoices }, // new (9): powers attach to factions; campaign carries prior choices
    blockedAttackTargets: [], // new (9)
    expandedThisTurn: 0, // new (9)
    signatures: Object.fromEntries(cfg.players.map((p) => [p.id, camp?.signatures[p.id] ?? 0])), // new: seeded from campaign history
    continents: {}, // new: continent names/bonus marks (rewards write these; 10b carries them)
    inventories: camp // new: reward inventories carry across games
      ? { cancelStickers: camp.inventories.cancelStickers, fortifyMarks: camp.inventories.fortifyMarks, majorCities: camp.inventories.majorCities, minorCities: camp.inventories.minorCities } // new
      : { ...ruleValue<GameState["inventories"]>("rewardInventories") }, // new: finite reward inventories from pack data
    cardModifications: {}, // new: territory-card upgrades, overlaid on pack card values
    unlockedModules: [...(camp?.unlockedModules ?? [])], // new (11): previously revealed modules stay active
    pendingUnlocks: [], // new (11)
    eventSeq: 0,
    log: [],
  };
  for (const p of cfg.players) {
    const sig = s.signatures[p.id]; // new: signature-driven setup (SPEC §4/§7)
    s.players[p.id] = {
      id: p.id, name: p.name,
      redStarTokens: p.redStarTokens ?? (sig >= 1 ? 0 : 1), // new: >=1 signature -> no starting token
      missiles: p.missiles ?? sig, // new: missiles = signature count (0 with no history)
      hand: [], scarHand: [], scarCardCount: 0, // new: scarHand holds dealt starter scars (identity hidden)
      knockedOut: false, eliminated: false, conqueredEnemyThisTurn: false,
    };
  }
  if (camp) { // new (10b): apply persisted board legacy before any placement
    for (const sc of camp.board.scars) s.territories[sc.territoryId].scars.push(sc.scarId); // new
    for (const c of camp.board.cities) s.territories[c.territoryId].city = { type: c.type, population: cityPopulation(c.type), name: c.name, foundedByPlayerId: c.foundedByPlayerId }; // new
    const fortMax = (scarById("fortification") as any)?.durability ?? 10; // new
    for (const f of camp.board.fortifications) s.territories[f.territoryId].fortification = { max: fortMax, remaining: f.durability }; // new
    for (const [cid, named] of Object.entries(camp.board.continentNames)) s.continents[cid] = { ...s.continents[cid], name: named.name, namedBy: named.namedBy }; // new
    for (const [cid, mark] of Object.entries(camp.board.continentBonusMarks)) s.continents[cid] = { ...s.continents[cid], bonusMark: mark }; // new
    for (const m of camp.board.cardModifications) if (m.resources !== undefined) s.cardModifications[m.cardId] = { resources: m.resources }; // new
    emit(s, "CampaignLegacyApplied", undefined, { gameNumber: s.gameNumber, scars: camp.board.scars.length, cities: camp.board.cities.length, fortifications: camp.board.fortifications.length }); // new
  }
  emit(s, "GameStarted", undefined, { gameId: cfg.gameId, seed: cfg.seed, players: cfg.players.map((p) => p.id) });

  // Server dice roll determines chooser order (logged as setup randomness, re-rolling ties)
  let pool = cfg.players.map((p) => p.id);
  const order: PlayerId[] = [];
  const rolls: Record<PlayerId, number> = {};
  while (pool.length) {
    const round = pool.map((id) => ({ id, roll: rollDie(s) }));
    for (const r of round) rolls[r.id] = r.roll;
    const max = Math.max(...round.map((r) => r.roll));
    const winners = round.filter((r) => r.roll === max);
    if (winners.length === 1) {
      order.push(winners[0].id);
      pool = pool.filter((id) => id !== winners[0].id);
    }
    emit(s, "SetupOrderRoll", undefined, { round: round.map((r) => ({ ...r })) });
  }
  s.setup = { chooserOrder: order, nextIdx: 0, rolls };
  s.turnOrder = order;
  emit(s, "SetupChooserOrder", undefined, { order });

  // Sideboard: shuffled territory deck, exactly 4 face-up slots, coin pile
  const destroyedCards = new Set((camp?.board.cardModifications ?? []).filter((m) => m.destroyed).map((m) => m.cardId)); // new: destroyed cards never re-enter play
  s.sideboard.destroyed = [...destroyedCards]; // new
  const deck = shuffled(s, contentPack.cards.territoryCards.map((c) => c.id).filter((id) => !destroyedCards.has(id))); // new: filter before shuffle
  s.sideboard.slots = [deck.shift()!, deck.shift()!, deck.shift()!, deck.shift()!];
  s.sideboard.territoryDeck = deck;
  s.sideboard.coinPile = [...contentPack.cards.coinCards.map((c) => c.id)];
  emit(s, "SideboardSetup", undefined, { slots: s.sideboard.slots, deckCount: deck.length, coinCount: 10 });

  // Scar deal: one hidden starter-scar instance per player, only if enough instances exist (D1). // new
  // Starter inventory = campaign scar-instance counts when carrying over, else pack `instances`. // new
  const scarPool = shuffled( // new
    s,
    contentPack.scars
      .filter((x) => scarAvailable(s.unlockedModules, x)) // new (11): unlocked module scars join the pool
      .flatMap((x) => {
        const count = camp ? camp.inventories.scarInstances[x.id] ?? 0 : (x as any).instances ?? 0; // new: played instances are consumed forever
        return Array.from({ length: count }, (_, i) => ({ instanceId: `${x.id}#${i + 1}`, scarId: x.id }));
      }),
  );
  if (scarPool.length >= cfg.players.length) { // new
    for (const p of cfg.players) {
      const inst = scarPool.shift()!; // identity withheld from event payloads (public-safe)
      s.players[p.id].scarHand = [inst];
      s.players[p.id].scarCardCount = 1;
    }
    emit(s, "ScarCardsDealt", undefined, { perPlayer: 1 });
  } else {
    emit(s, "ScarCardsNotDealt", undefined, { available: scarPool.length, needed: cfg.players.length });
  }
  return s;
}

export function startingTroops(_playerCount?: number): number {
  return ruleValue<number>("startingTroops"); // new: flat 8 per player; no player-count scaling
}

export function joinWarTroops(): number {
  return Math.floor(startingTroops() / 2); // new: half the starting total (=4 with starter rules)
}

/**
 * Legal placement test. A territory qualifies if it is unoccupied and unmarked,
 * or an unoccupied Major City founded by the placing player (city system arrives
 * with the founding slice). Minor cities never qualify. When placing an HQ
 * (initial setup), the territory may not be adjacent to another faction's HQ.
 */
export function isLegalStart(s: GameState, tid: TerritoryId, placingHq = false, placingFaction?: FactionId, placingPlayerId?: PlayerId): boolean { // new: placingPlayerId for the founder check
  const t = s.territories[tid];
  const unoccupiedUnmarked = t.troops === 0 && !t.controller && !t.hqFaction && !t.city && t.scars.length === 0; // new: cities AND scars are marks; only the founder's Major City overrides (even if scarred)
  const ownFoundedMajorCity = t.troops === 0 && !t.controller && t.city?.type === "major" && t.city.foundedByPlayerId === placingPlayerId; // new: keyed on city type + founder (player), not population/faction
  if (!unoccupiedUnmarked && !ownFoundedMajorCity) return false; // minor/world-capital cities, and another player's Major City, never qualify
  if (placingHq) {
    for (const n of territoryById(tid).neighbors) { // new: HQ-adjacency restriction
      const nt = s.territories[n];
      if (nt.hqFaction && nt.hqFaction !== placingFaction) return false;
    }
  }
  return true;
}

// ---------- Faction powers (Slice 9) ---------- // new

/** The selected starting power of the player's faction, or undefined. */ // new
function playerPower(s: GameState, pid: PlayerId): string | undefined { // new
  const fid = s.players[pid]?.factionId; // new
  return fid ? s.factionPowers[fid] : undefined; // new
} // new

function hasPower(s: GameState, pid: PlayerId, powerId: string): boolean { // new
  return playerPower(s, pid) === powerId; // new
} // new

/** expansionist_supply: Imperial earned a draw by expanding into 4+ unoccupied territories this turn. */ // new
function expansionistDrawEarned(s: GameState, pid: PlayerId): boolean { // new
  if (!hasPower(s, pid, "expansionist_supply")) return false; // new
  const threshold = ((contentPack.powers.find((x) => x.id === "expansionist_supply") as any)?.effect?.expandThreshold ?? 4) as number; // new: power data from pack
  return s.expandedThisTurn >= threshold; // new
} // new

/** Per-turn power bookkeeping + automatic start-of-turn powers. Runs whenever a turn begins. */ // new
function enterStartTurn(s: GameState, pid: PlayerId) { // new
  s.blockedAttackTargets = []; // new: defensive_stand locks expire when the active turn ends
  s.intimidation = undefined; // new
  s.expandedThisTurn = 0; // new
  if (hasPower(s, pid, "hq_reinforcement")) { // new: Khan — +1 troop on each controlled territory containing any HQ
    for (const [tid, t] of Object.entries(s.territories)) { // new
      if (t.controller !== pid || !t.hqFaction || t.troops <= 0) continue; // new
      t.troops++; // new
      emit(s, "FactionPowerApplied", pid, { powerId: "hq_reinforcement", territory: tid, troops: t.troops }); // new
    } // new
  } // new
} // new

// ---------- Recruitment ----------

export function recruitBreakdown(s: GameState, pid: PlayerId): RecruitBreakdown {
  const owned = Object.entries(s.territories).filter(([, t]) => t.controller === pid);
  const n = owned.length;
  const min = ruleValue<number>("minRecruit");
  const per = ruleValue<number>("territoriesPerTroop");
  const population = owned.reduce((sum, [, t]) => sum + (t.city?.population ?? 0), 0);
  // Corrected formula: population counts INSIDE the division (rulebook; `recruitCountsPopulationInDivision`). // new
  const round = hasPower(s, pid, "round_up_recruiting") ? Math.ceil : Math.floor; // new: Imperial rounds UP, before min-recruit and bonuses
  const fromTerritories = Math.max(round((n + population) / per), min); // new
  const continents = manifest.continents
    .filter((c) => manifest.territories.filter((t) => t.continent === c.id).every((t) => s.territories[t.id].controller === pid))
    .map((c) => {
      const legacy = s.continents[c.id]; // new: change_continent_bonus is global; name_continent's +1 is personal to the namer
      const globalModifier = legacy?.bonusMark ?? 0; // new
      const namedBonus = legacy?.namedBy === pid ? ruleValue<number>("namedContinentBonus") : 0; // new
      return { id: c.id, base: c.baseBonus, globalModifier, namedBonus, total: c.baseBonus + globalModifier + namedBonus }; // new
    });
  const total = fromTerritories + continents.reduce((a, c) => a + c.total, 0); // new: population no longer added at face value (it's inside the division)
  return { territories: n, fromTerritories, population, continents, tradeIns: 0, total };
}

export function redStars(s: GameState, pid: PlayerId): { tokens: number; board: number; total: number } {
  const p = s.players[pid];
  const ownCounts = ruleValue<boolean>("ownHqCountsAsRedStar");
  let board = 0;
  for (const t of Object.values(s.territories)) {
    if (!t.hqFaction || t.controller !== pid) continue;
    if (!ownCounts && t.hqFaction === p.factionId) continue;
    board++;
  }
  return { tokens: p.redStarTokens, board, total: p.redStarTokens + board };
}

// ---------- Victory ----------

function checkVictory(s: GameState): void {
  if (s.phase === "game_over") return;
  const alive = Object.values(s.players).filter((p) => !p.eliminated);
  const target = ruleValue<number>("redStarsToWin");
  let winner: PlayerId | undefined;
  let reason = "";
  for (const p of alive) {
    if (redStars(s, p.id).total >= target) { winner = p.id; reason = `${target} Red Stars`; break; }
  }
  if (!winner && alive.length === 1 && Object.keys(s.players).length > 1) {
    winner = alive[0].id; reason = "All other factions eliminated";
  }
  if (!winner) return;
  s.winner = winner;
  s.winReason = reason;
  s.phase = "game_over";
  s.combat = undefined;
  // Automatic Won / Held On / Eliminated classification (host correction is a server-layer concern)
  s.results = {};
  for (const p of Object.values(s.players)) {
    const hasTroops = Object.values(s.territories).some((t) => t.controller === p.id && t.troops > 0);
    const status = p.id === winner ? "won" : p.eliminated || !hasTroops ? "eliminated" : "held_on";
    if (p.factionId) s.results[p.factionId] = status;
  }
  emit(s, "GameWon", winner, { reason, results: s.results });
  if (Object.values(s.results).some((r) => r === "eliminated")) { // new (11): Pack 2's "else end-game" branch — any elimination opens it
    queueUnlock(s, "pack_2_comeback_mercenaries", "end_game"); // new
  } // new
  beginEndGameRewards(s); // new: sign the board + open reward resolution (SPEC §7)
}

// ---------- End-game rewards & signatures (10a) ---------- // new

/**
 * SPEC §7 post-game resolution: the winner signs (mandatory, automatic) and resolves one
 * winner reward; then held-on non-winners choose clockwise from the winner. Eliminated and
 * unused factions get no reward. Runs inside the locked game_over phase.
 */ // new
function beginEndGameRewards(s: GameState) { // new
  const lastRewardGame = ruleValue<number>("starterRewardsLastGame"); // new (10b): starter reward changes stop after Game 15
  if (s.gameNumber > lastRewardGame) { // new
    emit(s, "EndGameRewardsSkipped", undefined, { gameNumber: s.gameNumber, lastRewardGame }); // new
    processUnlocks(s, "end_game"); // new (11): pending end-game unlocks still reveal when no reward flow opens
    return; // new: no signing, no rewards — existing legacy state stays active
  } // new
  const winner = s.winner!; // new
  s.signatures[winner] = (s.signatures[winner] ?? 0) + 1; // new: signatures are mandatory, tied to the player
  emit(s, "BoardSigned", winner, { signatures: s.signatures[winner] }); // new: AfterSignatureAdded hook point (Pack 3, task 11)
  const order = [winner]; // new
  const wIdx = s.turnOrder.indexOf(winner); // new
  for (let step = 1; step < s.turnOrder.length; step++) { // new: clockwise from the winner
    const pid = s.turnOrder[(wIdx + step) % s.turnOrder.length]; // new
    const fid = s.players[pid].factionId; // new
    if (fid && s.results?.[fid] === "held_on") order.push(pid); // new
  } // new
  s.rewards = { order, nextIdx: 0, committed: false }; // new
  emit(s, "EndGameRewardsOpened", winner, { order }); // new
} // new

/** Is any winner reward still resolvable? (Gates the winner's pass — normally one reward is mandatory.) */ // new
function anyWinnerRewardAvailable(s: GameState): boolean { // new
  const terrs = Object.values(s.territories); // new
  if (manifest.continents.some((c) => !s.continents[c.id]?.name)) return true; // name_continent // new
  if (s.inventories.majorCities > 0 && terrs.some((t) => !t.city)) return true; // found_major_city // new
  if (s.inventories.cancelStickers > 0 && terrs.some((t) => t.scars.length > 0)) return true; // cancel_scar // new
  const marks = Object.values(s.continents).map((c) => c.bonusMark); // new
  if ((!marks.includes(1) || !marks.includes(-1)) && manifest.continents.some((c) => s.continents[c.id]?.bonusMark === undefined)) return true; // change_continent_bonus // new
  if (s.inventories.fortifyMarks > 0 && terrs.some((t) => t.city)) return true; // fortify_city // new
  return false; // new
} // new

// ---------- Sideboard ----------

function refillSlots(s: GameState) {
  for (let i = 0; i < 4; i++) {
    if (s.sideboard.slots[i] === null) {
      if (s.sideboard.territoryDeck.length === 0 && s.sideboard.discard.length > 0) {
        s.sideboard.territoryDeck = shuffled(s, s.sideboard.discard);
        s.sideboard.discard = [];
        emit(s, "TerritoryDeckReshuffled", undefined, { count: s.sideboard.territoryDeck.length });
      }
      s.sideboard.slots[i] = s.sideboard.territoryDeck.shift() ?? null;
    }
  }
  emit(s, "SideboardRefilled", undefined, { slots: [...s.sideboard.slots], deckCount: s.sideboard.territoryDeck.length });
  // AfterSideboardRefill unlock hook: no-op until Event cards unlock (Slice 11)
}

function coinDepletionCheck(s: GameState) {
  if (s.sideboard.coinPile.length > 0 || s.sideboard.coinDepletionAwarded) return;
  s.sideboard.coinDepletionAwarded = true;
  const counts = Object.values(s.players)
    .filter((p) => !p.eliminated)
    .map((p) => ({ id: p.id, n: Object.values(s.territories).filter((t) => t.controller === p.id).length }));
  const max = Math.max(...counts.map((c) => c.n));
  const leaders = counts.filter((c) => c.n === max);
  if (leaders.length === 1) {
    s.players[leaders[0].id].redStarTokens++;
    emit(s, "CoinDepletionRedStar", leaders[0].id, { territories: max });
    checkVictory(s);
  } else {
    emit(s, "CoinDepletionTieNoAward", undefined, { leaders: leaders.map((l) => l.id), territories: max });
  }
}

// ---------- Turn advancement ----------

function activePlayer(s: GameState): PlayerId {
  return s.turnOrder[s.activeIdx];
}

function advanceTurn(s: GameState) {
  const n = s.turnOrder.length;
  for (let step = 1; step <= n; step++) {
    const idx = (s.activeIdx + step) % n;
    const pid = s.turnOrder[idx];
    const p = s.players[pid];
    if (p.eliminated) continue;
    s.activeIdx = idx;
    s.turnNumber++;
    p.conqueredEnemyThisTurn = false;
    s.startTurnDone = false;
    s.maneuverUsed = false;
    s.recruit = undefined;
    s.combat = undefined;
    s.phase = "start_turn";
    emit(s, "TurnStarted", pid, { turn: s.turnNumber });
    enterStartTurn(s, pid); // new (9): per-turn power state + start-of-turn powers
    return;
  }
}

function ensureActive(s: GameState, pid: PlayerId) {
  if (activePlayer(s) !== pid) throw new RuleViolation("Not your turn");
}
function ensurePhase(s: GameState, ...phases: GameState["phase"][]) {
  if (!phases.includes(s.phase)) throw new RuleViolation(`Illegal in phase ${s.phase}`);
}

// ---------- Unlock module engine (Slice 11) ---------- // new

/**
 * Sealed modules trigger during play, queue, and reveal at their timing —
 * mid-game immediately, end-game after the last reward resolves. Multiple pending
 * unlocks always process in the canonical manifest order (Pack 1→2→3→4→Pocket 1→2).
 * Host-entered content (`contentRequired`) is announced here and supplied by the
 * import wizard (task 12); the campaign layer records the pause.
 */ // new
function queueUnlock(s: GameState, moduleId: string, timing: "mid_game" | "end_game") { // new: whole function
  if (s.unlockedModules.includes(moduleId) || s.pendingUnlocks.some((u) => u.moduleId === moduleId)) return;
  emit(s, "ModuleTriggered", undefined, { moduleId, timing });
  s.pendingUnlocks.push({ moduleId, timing });
  if (timing === "mid_game") processUnlocks(s, "mid_game");
}

function processUnlocks(s: GameState, timing: "mid_game" | "end_game") { // new: whole function
  const due = s.pendingUnlocks.filter((u) => u.timing === timing || timing === "end_game"); // end-game flush takes everything left
  if (due.length === 0) return;
  const order = (id: string) => contentPack.unlockModules.findIndex((m) => m.id === id); // canonical processing order (SPEC §9)
  due.sort((a, b) => order(a.moduleId) - order(b.moduleId));
  for (const u of due) {
    s.pendingUnlocks = s.pendingUnlocks.filter((x) => x.moduleId !== u.moduleId);
    s.unlockedModules.push(u.moduleId);
    const mod = contentPack.unlockModules.find((m) => m.id === u.moduleId) as any;
    emit(s, "ModuleRevealed", undefined, { moduleId: u.moduleId, name: mod?.name });
    const items = (mod?.contentRequired ?? []) as string[];
    if (items.length) emit(s, "ModuleContentRequired", undefined, { moduleId: u.moduleId, items }); // pause point for the import wizard
  }
}

// ---------- Scar effects (Slice 8) ---------- // new

const scarById = (id: string) => contentPack.scars.find((x) => x.id === id); // new

/** A scar card is available when it's starter-playable or its source module has been revealed. */ // new
function scarAvailable(unlockedModules: string[], def: any): boolean { // new: whole function
  if (def?.starterPlayable) return true;
  const mod = contentPack.unlockModules.find((m) => (m as any).scarSource === def?.source);
  return !!mod && unlockedModules.includes(mod.id);
}

/**
 * Confirmed modifyCombatDie scar deltas against the defending territory's natural dice.
 * Missiles set an unmodifiable 6 — flagged dice are never scar-modified. "Highest die"
 * is index 0 of the natural roll (sorted desc). Fortification lives in its own
 * territory field (not scars[]) and applies to each defense die while durability remains.
 */ // new
function defenseScarModifiers(s: GameState, c: PendingCombat): { scarId: string; dieIndex: number; delta: number }[] { // new
  const t = s.territories[c.to]; // new
  const defCount = c.natural!.def.length; // new
  const mods: { scarId: string; dieIndex: number; delta: number }[] = []; // new
  const tryAdd = (scarId: string, dieIndex: number, delta: number) => { // new
    if (!c.unmodifiable.def[dieIndex]) mods.push({ scarId, dieIndex, delta }); // new
  }; // new
  const deltaOf = (eff: any) => (eff.op === "sub" ? -1 : 1) * (eff.amount ?? 0); // new
  for (const scarId of t.scars) { // new
    const def = scarById(scarId); // new
    if (!def || def.verification !== "confirmed" || def.handler !== "modifyCombatDie") continue; // only confirmed effects // new
    const eff = (def as any).effect ?? {}; // new
    if (eff.side !== "def") continue; // new
    if (eff.applyTo === "highest_die") tryAdd(scarId, 0, deltaOf(eff)); // new
    else if (eff.applyTo === "each_die") for (let i = 0; i < defCount; i++) tryAdd(scarId, i, deltaOf(eff)); // new
  } // new
  if (t.fortification && t.fortification.remaining > 0) { // new
    const eff = (scarById("fortification") as any)?.effect ?? {}; // new
    for (let i = 0; i < defCount; i++) tryAdd("fortification", i, deltaOf(eff)); // new
  } // new
  return mods; // new
} // new

/** Confirmed onEndTurn scar attrition (Biohazard) for the player whose turn is ending. */ // new
function applyEndOfTurnScars(s: GameState, pid: PlayerId) { // new
  for (const [tid, t] of Object.entries(s.territories)) { // new
    if (t.controller !== pid || t.troops <= 0) continue; // new
    for (const scarId of t.scars) { // new
      const def = scarById(scarId); // new
      if (!def || def.verification !== "confirmed" || def.handler !== "onEndTurn") continue; // new
      const eff = (def as any).effect ?? {}; // new
      if (eff.trigger !== "controller_end_turn") continue; // new
      if (eff.op === "remove_troops") { // new: Biohazard
        t.troops = Math.max(0, t.troops - (eff.amount ?? 0)); // new
        const vacated = t.troops === 0; // new
        if (vacated) t.controller = undefined; // last troop lost -> territory abandoned // new
        emit(s, "ScarAttrition", pid, { scarId, territory: tid, remaining: t.troops, vacated }); // new
      } else if (eff.op === "add_troops") { // new (11): Mercenary — +1 if still controlled
        t.troops += eff.amount ?? 0; // new
        emit(s, "ScarReinforcement", pid, { scarId, territory: tid, troops: t.troops }); // new
      } // new
    } // new
  } // new
} // new

// ---------- Combat helpers ----------

function legalModifierActors(s: GameState, c: PendingCombat): PlayerId[] {
  // Missiles are usable on your own just-rolled dice (participants only in v1); attacker priority.
  const out: PlayerId[] = [];
  for (const pid of [c.attacker, c.defender]) {
    if (s.players[pid].missiles > 0 && !c.window?.passed.includes(pid)) out.push(pid);
  }
  return out;
}

/** modifyCombatDie faction powers against the defense dice (SPEC §6). Missile-set dice stay untouched. */ // new
function powerDefenseModifiers(s: GameState, c: PendingCombat): { powerId: string; playerId: PlayerId; dieIndex: number; delta: number }[] { // new: whole function
  const t = s.territories[c.to];
  const defCount = c.natural!.def.length;
  const mods: { powerId: string; playerId: PlayerId; dieIndex: number; delta: number }[] = [];
  // fortified_hq: Die Mechaniker defending the territory holding its own HQ — +1 each defense die,
  // no durability, no expand surcharge; does NOT stack with an active Fortification mark.
  if (hasPower(s, c.defender, "fortified_hq") && t.hqFaction === s.players[c.defender].factionId
      && !(t.fortification && t.fortification.remaining > 0)) {
    for (let i = 0; i < defCount; i++) {
      if (!c.unmodifiable.def[i]) mods.push({ powerId: "fortified_hq", playerId: c.defender, dieIndex: i, delta: 1 });
    }
  }
  // lower_die_intimidation: Enclave attacking its first target of the turn — defender's LOWER die -1.
  if (hasPower(s, c.attacker, "lower_die_intimidation") && s.intimidation
      && !s.intimidation.broken && s.intimidation.territory === c.to) {
    const i = defCount - 1; // natural sorted desc -> last index is the lower die
    if (!c.unmodifiable.def[i]) mods.push({ powerId: "lower_die_intimidation", playerId: c.attacker, dieIndex: i, delta: -1 });
  }
  return mods;
}

function finalDice(s: GameState, c: PendingCombat): { att: number[]; def: number[]; scarModifiers: { scarId: string; dieIndex: number; delta: number }[]; powerModifiers: { powerId: string; playerId: PlayerId; dieIndex: number; delta: number }[] } { // new: takes state for territory scars + powers
  const att = [...c.natural!.att];
  const def = [...c.natural!.def];
  for (const m of c.modifiers) {
    if (m.side === "att") att[m.dieIndex] = 6;
    else def[m.dieIndex] = 6;
  }
  const scarModifiers = defenseScarModifiers(s, c); // new
  for (const m of scarModifiers) def[m.dieIndex] = Math.max(1, Math.min(6, def[m.dieIndex] + m.delta)); // new: clamp 1..6 (D1)
  const powerModifiers = powerDefenseModifiers(s, c); // new (9)
  for (const m of powerModifiers) def[m.dieIndex] = Math.max(1, Math.min(6, def[m.dieIndex] + m.delta)); // new: clamp 1..6
  return { att, def, scarModifiers, powerModifiers }; // new
}

function resolveCombat(s: GameState) {
  const c = s.combat!;
  const { att, def, scarModifiers, powerModifiers } = finalDice(s, c); // new
  for (const m of powerModifiers) emit(s, "FactionPowerApplied", m.playerId, { powerId: m.powerId, territory: c.to, dieIndex: m.dieIndex, delta: m.delta }); // new (9)
  const sortIdx = (arr: number[]) => arr.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
  const A = sortIdx(att);
  const D = sortIdx(def);
  const pairs = Math.min(A.length, D.length);
  let attLoss = 0, defLoss = 0;
  const comparisons: { att: number; def: number; winner: "att" | "def" }[] = [];
  for (let i = 0; i < pairs; i++) {
    const winner = A[i].v > D[i].v ? "att" : "def"; // defender wins ties
    if (winner === "att") defLoss++; else attLoss++;
    comparisons.push({ att: A[i].v, def: D[i].v, winner });
  }
  const from = s.territories[c.from];
  const to = s.territories[c.to];
  const nat = c.natural!; // new (9)
  // total_conquest: natural three-of-a-kind attack + final combat kills >=1 defender -> ALL defenders die. // new
  if (defLoss >= 1 && defLoss < to.troops && hasPower(s, c.attacker, "total_conquest") // new
      && nat.att.length === 3 && nat.att[0] === nat.att[2]) { // new: sorted desc, so first==last means three of a kind
    emit(s, "FactionPowerApplied", c.attacker, { powerId: "total_conquest", territory: c.to, defendersRemoved: to.troops - defLoss }); // new
    defLoss = to.troops; // new
  } // new
  // defensive_stand: natural double-6 defense locks the territory for the rest of the active turn. // new
  if (hasPower(s, c.defender, "defensive_stand") && nat.def.length === 2 && nat.def[0] === 6 && nat.def[1] === 6 // new
      && !s.blockedAttackTargets.includes(c.to)) { // new
    s.blockedAttackTargets.push(c.to); // new
    emit(s, "FactionPowerApplied", c.defender, { powerId: "defensive_stand", territory: c.to }); // new
  } // new
  from.troops -= attLoss;
  to.troops -= defLoss;
  emit(s, "CombatResolved", c.attacker, {
    from: c.from, to: c.to,
    natural: c.natural, final: { att, def }, modifiers: c.modifiers, scarModifiers, powerModifiers, // new
    comparisons, attackerLosses: attLoss, defenderLosses: defLoss,
  });
  const fortEff = (scarById("fortification") as any)?.effect ?? {}; // new
  if (to.fortification && c.attackerDice === (fortEff.markDurabilityWhenAttackersEquals ?? 3)) { // new: mark 1 box per 3-attacker roll
    to.fortification.remaining--; // new
    emit(s, "FortificationDurabilityMarked", c.attacker, { territory: c.to, remaining: to.fortification.remaining }); // new
    if (to.fortification.remaining <= 0) { // new
      to.fortification = undefined; // new: 10 boxes marked -> no longer fortified
      emit(s, "FortificationExpired", undefined, { territory: c.to }); // new
    } // new
  } // new
  c.window = undefined;
  c.natural = undefined;
  c.modifiers = [];
  c.unmodifiable = { att: [], def: [] };

  if (to.troops <= 0) {
    // Conquest: HQ remains as independent piece (original faction styling)
    const surviving = (c.attackerDice ?? 1) - attLoss;
    const min = Math.max(surviving, 1);
    const max = from.troops - 1;
    if (max < min) {
      // Edge: attacker losses leave only forced minimum possible
      c.awaitingMoveIn = { min: Math.min(min, max < 1 ? 1 : max), max: Math.max(max, 1) };
    } else {
      c.awaitingMoveIn = { min, max };
    }
    to.controller = undefined; // pending move-in
    emit(s, "TerritoryCleared", c.attacker, { territory: c.to, defender: c.defender, moveIn: c.awaitingMoveIn });
  } else {
    c.attackerDice = undefined;
    c.defenderDice = undefined;
    if (from.troops <= 1) {
      emit(s, "AttackExhausted", c.attacker, { from: c.from });
      s.combat = undefined;
    }
  }
}

function completeConquest(s: GameState, moved: number) {
  const c = s.combat!;
  const from = s.territories[c.from];
  const to = s.territories[c.to];
  from.troops -= moved;
  to.troops = moved;
  to.controller = c.attacker;
  const attacker = s.players[c.attacker];
  attacker.conqueredEnemyThisTurn = true;
  emit(s, "TerritoryConquered", c.attacker, {
    territory: c.to, from: c.from, moved,
    hqCaptured: to.hqFaction ?? null,
  });
  // Knockout: defender has no troops anywhere -> transfer Resource cards (not scars/tokens/missiles)
  const defender = s.players[c.defender];
  const defenderHasTroops = Object.values(s.territories).some((t) => t.controller === c.defender && t.troops > 0);
  if (!defenderHasTroops && !defender.eliminated) {
    defender.knockedOut = true;
    const transferred = defender.hand.length;
    attacker.hand.push(...defender.hand);
    defender.hand = [];
    emit(s, "PlayerKnockedOut", c.defender, { by: c.attacker, resourceCardsTransferred: transferred });
  }
  s.combat = undefined;
  checkVictory(s);
}

// ---------- Public API ----------

export function applyAction(prev: GameState, action: Action): GameState {
  const s: GameState = structuredClone(prev);
  const p = s.players[action.playerId];
  if (!p) throw new RuleViolation("Unknown player");

  switch (action.type) {
    case "setup.choose": {
      ensurePhase(s, "setup");
      const setup = s.setup!;
      if (setup.chooserOrder[setup.nextIdx] !== action.playerId) throw new RuleViolation("Not your pick");
      if (p.factionId) throw new RuleViolation("Already chose");
      const faction = contentPack.factions.find((f) => f.id === action.factionId);
      if (!faction) throw new RuleViolation("Unknown faction");
      if (Object.values(s.players).some((x) => x.factionId === action.factionId)) throw new RuleViolation("Faction taken");
      const storedPower = s.factionPowers[action.factionId]; // new (9): powers attach to the faction permanently
      if (storedPower) { // new
        if (action.powerId && action.powerId !== storedPower) throw new RuleViolation(`${faction.name} already chose ${storedPower} — power choices are permanent`); // new
      } else { // new
        if (!action.powerId) throw new RuleViolation("Choose a starting power (first time this faction is played)"); // new
        if (!faction.startingPowers.includes(action.powerId)) throw new RuleViolation("That power does not belong to this faction"); // new
      } // new
      if (!isLegalStart(s, action.territoryId, true, action.factionId, action.playerId)) throw new RuleViolation("Illegal starting territory (unoccupied, unmarked, and not adjacent to another HQ)"); // new
      if (!storedPower) { // new
        s.factionPowers[action.factionId] = action.powerId!; // new
        emit(s, "FactionPowerChosen", p.id, { factionId: action.factionId, powerId: action.powerId }); // new
      } // new
      p.factionId = action.factionId;
      const troops = startingTroops(); // new: flat 8
      const t = s.territories[action.territoryId];
      t.controller = p.id;
      t.troops = troops;
      t.hqFaction = action.factionId;
      emit(s, "FactionChosen", p.id, { factionId: action.factionId, territory: action.territoryId, troops });
      setup.nextIdx++;
      if (setup.nextIdx >= setup.chooserOrder.length) {
        const used = new Set(Object.values(s.players).map((x) => x.factionId));
        const unused = contentPack.factions.filter((f) => !used.has(f.id)).map((f) => f.id);
        emit(s, "UnusedFactionsRecorded", undefined, { factions: unused });
        s.setup = undefined;
        s.activeIdx = 0;
        s.turnNumber = 1;
        s.phase = "start_turn";
        emit(s, "TurnStarted", activePlayer(s), { turn: 1 });
        enterStartTurn(s, activePlayer(s)); // new (9): per-turn power state + start-of-turn powers
      }
      return s;
    }

    case "start.buyRedStar": {
      ensurePhase(s, "start_turn");
      ensureActive(s, action.playerId);
      const cost = ruleValue<number>("redStarPurchaseCost");
      if (action.cardIds.length !== cost) throw new RuleViolation(`Red Star costs ${cost} Resource cards`);
      for (const id of action.cardIds) {
        const idx = p.hand.indexOf(id);
        if (idx < 0) throw new RuleViolation("Card not in hand");
      }
      for (const id of action.cardIds) {
        p.hand.splice(p.hand.indexOf(id), 1);
        const def = card(id)!;
        if (def.kind === "territory") s.sideboard.discard.push(id);
        else { s.sideboard.coinDiscard.push(id); }
      }
      p.redStarTokens++;
      emit(s, "RedStarPurchased", p.id, { cards: action.cardIds });
      checkVictory(s);
      return s;
    }

    case "start.done": {
      ensurePhase(s, "start_turn");
      ensureActive(s, action.playerId);
      s.startTurnDone = true;
      const owned = Object.values(s.territories).filter((t) => t.controller === p.id).length;
      if (owned === 0) {
        // Forced Join the War / elimination branch
        const anyLegal = manifest.territories.some((t) => isLegalStart(s, t.id, false, p.factionId, p.id)); // new: a player's own founded Major City counts as a rejoin option
        if (!anyLegal) {
          p.eliminated = true;
          p.knockedOut = false;
          emit(s, "PlayerEliminated", p.id, { reason: "No legal Join the War territory" });
          queueUnlock(s, "pack_2_comeback_mercenaries", "mid_game"); // new (11): elimination from a failed Join the War reveals mid-game
          checkVictory(s);
          if (s.phase !== "game_over") advanceTurn(s);
          return s;
        }
        s.phase = "join_or_recruit";
        emit(s, "JoinTheWarRequired", p.id);
        return s;
      }
      const breakdown = recruitBreakdown(s, p.id);
      if (hasPower(s, p.id, "round_up_recruiting")) { // new (9): audit when the round-up actually changed the result
        const flo = Math.max(Math.floor((breakdown.territories + breakdown.population) / ruleValue<number>("territoriesPerTroop")), ruleValue<number>("minRecruit")); // new
        if (breakdown.fromTerritories > flo) emit(s, "FactionPowerApplied", p.id, { powerId: "round_up_recruiting", bonus: breakdown.fromTerritories - flo }); // new
      } // new
      s.recruit = { remaining: breakdown.total, breakdown };
      s.phase = "join_or_recruit";
      emit(s, "RecruitCalculated", p.id, { breakdown: breakdown as unknown as Record<string, unknown> });
      return s;
    }

    case "join.enter": {
      ensurePhase(s, "join_or_recruit");
      ensureActive(s, action.playerId);
      if (Object.values(s.territories).some((t) => t.controller === p.id)) throw new RuleViolation("You control territory; recruit instead");
      if (!isLegalStart(s, action.territoryId, false, p.factionId, p.id)) throw new RuleViolation("Illegal Join the War territory"); // new: no HQ placed, so no adjacency constraint
      const troops = joinWarTroops(); // new: half starting total (=4)
      const t = s.territories[action.territoryId];
      t.controller = p.id;
      t.troops = troops;
      p.knockedOut = false;
      emit(s, "JoinedTheWar", p.id, { territory: action.territoryId, troops });
      s.phase = "expand_attack";
      return s;
    }

    case "recruit.trade": {
      ensurePhase(s, "join_or_recruit");
      ensureActive(s, action.playerId);
      if (!s.recruit) throw new RuleViolation("No recruit in progress");
      if (action.cardIds.length < 2) throw new RuleViolation("Trade in at least 2 resources");
      let resources = 0;
      for (const id of action.cardIds) {
        if (!p.hand.includes(id)) throw new RuleViolation("Card not in hand");
        resources += cardResources(s, id); // new: honors upgrade_territory_card stickers
      }
      const troops = troopsForResources(resources);
      if (troops <= 0) throw new RuleViolation("Not enough resources for any troops");
      for (const id of action.cardIds) {
        p.hand.splice(p.hand.indexOf(id), 1);
        const def = card(id)!;
        if (def.kind === "territory") s.sideboard.discard.push(id);
        else s.sideboard.coinDiscard.push(id);
      }
      s.recruit.remaining += troops;
      s.recruit.breakdown.tradeIns += troops;
      s.recruit.breakdown.total += troops;
      emit(s, "ResourceCardsTraded", p.id, { cards: action.cardIds, resources, troops });
      return s;
    }

    case "recruit.place": {
      ensurePhase(s, "join_or_recruit");
      ensureActive(s, action.playerId);
      if (!s.recruit) throw new RuleViolation("No recruit in progress");
      if (action.count < 1 || action.count > s.recruit.remaining) throw new RuleViolation("Invalid troop count");
      const t = s.territories[action.territoryId];
      if (t.controller !== p.id) throw new RuleViolation("You do not control that territory");
      t.troops += action.count;
      s.recruit.remaining -= action.count;
      emit(s, "TroopsPlaced", p.id, { territory: action.territoryId, count: action.count, remaining: s.recruit.remaining });
      return s;
    }

    case "recruit.done": {
      ensurePhase(s, "join_or_recruit");
      ensureActive(s, action.playerId);
      if (!s.recruit) throw new RuleViolation("No recruit in progress");
      if (s.recruit.remaining !== 0) throw new RuleViolation(`Place all troops first (${s.recruit.remaining} remaining)`);
      s.recruit = undefined;
      s.phase = "expand_attack";
      emit(s, "PhaseChanged", p.id, { phase: "expand_attack" });
      return s;
    }

    case "attack.expand": {
      ensurePhase(s, "expand_attack");
      ensureActive(s, action.playerId);
      if (s.combat) throw new RuleViolation("Resolve current combat first");
      const from = s.territories[action.from];
      const to = s.territories[action.to];
      if (from.controller !== p.id) throw new RuleViolation("Not your territory");
      if (!territoryById(action.from).neighbors.includes(action.to)) throw new RuleViolation("Not adjacent");
      if (to.troops > 0 || to.controller) throw new RuleViolation("Territory is occupied; attack instead");
      const resistance = (to.city?.population ?? 0) + (to.fortification ? 2 : 0); // new: city population + fortified surcharge; only unoccupied cities resist on expand
      if (action.troops <= resistance) throw new RuleViolation(`Need more than ${resistance} troops (city resistance)`);
      if (action.troops >= from.troops) throw new RuleViolation("Leave at least one troop behind");
      from.troops -= action.troops;
      to.troops = action.troops - resistance;
      to.controller = p.id;
      s.expandedThisTurn++; // new (9): expansionist_supply counter
      emit(s, "TerritoryExpanded", p.id, { from: action.from, to: action.to, troops: action.troops, resistanceLosses: resistance });
      return s;
    }

    case "attack.declare": {
      ensurePhase(s, "expand_attack");
      ensureActive(s, action.playerId);
      if (s.combat) throw new RuleViolation("Combat already open");
      const from = s.territories[action.from];
      const to = s.territories[action.to];
      if (from.controller !== p.id) throw new RuleViolation("Not your territory");
      if (!territoryById(action.from).neighbors.includes(action.to)) throw new RuleViolation("Not adjacent");
      if (!to.controller || to.controller === p.id || to.troops <= 0) throw new RuleViolation("No enemy to attack there");
      if (from.troops < 2) throw new RuleViolation("Need at least 2 troops to attack");
      if (s.blockedAttackTargets.includes(action.to)) throw new RuleViolation("That territory cannot be attacked again this turn (Defensive Stand)"); // new (9)
      if (hasPower(s, p.id, "lower_die_intimidation")) { // new (9): track Enclave's first target of the turn
        if (!s.intimidation) s.intimidation = { territory: action.to, broken: false }; // new
        else if (s.intimidation.territory !== action.to) s.intimidation.broken = true; // new: attacking elsewhere ends the effect for the turn
      } // new
      s.combat = {
        from: action.from, to: action.to,
        attacker: p.id, defender: to.controller,
        modifiers: [], unmodifiable: { att: [], def: [] },
      };
      emit(s, "AttackDeclared", p.id, { from: action.from, to: action.to, defender: to.controller });
      return s;
    }

    case "attack.chooseAttackers": {
      const c = s.combat;
      if (!c || c.natural || c.awaitingMoveIn) throw new RuleViolation("Cannot choose attackers now");
      if (action.playerId !== c.attacker) throw new RuleViolation("Only the attacker chooses attackers");
      const from = s.territories[c.from];
      const max = Math.min(3, from.troops - 1);
      if (action.count < 1 || action.count > max) throw new RuleViolation(`Choose 1-${max} attackers`);
      c.attackerDice = action.count;
      emit(s, "AttackersChosen", p.id, { count: action.count });
      maybeRoll(s);
      return s;
    }

    case "attack.defenderDice": {
      const c = s.combat;
      if (!c || c.natural || c.awaitingMoveIn) throw new RuleViolation("Cannot choose defense dice now");
      if (action.playerId !== c.defender) throw new RuleViolation("Only the defender chooses defense dice");
      const to = s.territories[c.to];
      const max = Math.min(2, to.troops);
      if (action.count < 1 || action.count > max) throw new RuleViolation(`Choose 1-${max} defense dice`);
      c.defenderDice = action.count;
      emit(s, "DefenderDiceChosen", p.id, { count: action.count });
      maybeRoll(s);
      return s;
    }

    case "combat.useMissile": {
      const c = s.combat;
      if (!c?.natural || !c.window) throw new RuleViolation("No modifier window open");
      const actors = legalModifierActors(s, c);
      if (actors[0] !== action.playerId) throw new RuleViolation("Not your response opportunity");
      if (p.missiles < 1) throw new RuleViolation("No missiles");
      const side = action.playerId === c.attacker ? "att" : "def";
      const dice = side === "att" ? c.natural.att : c.natural.def;
      if (action.dieIndex < 0 || action.dieIndex >= dice.length) throw new RuleViolation("Invalid die");
      if (c.unmodifiable[side][action.dieIndex]) throw new RuleViolation("Die is unmodifiable");
      p.missiles--;
      c.modifiers.push({ playerId: p.id, type: "missile", side, dieIndex: action.dieIndex });
      c.unmodifiable[side][action.dieIndex] = true; // missile result is an unmodifiable 6
      c.window.passed = []; // each commit re-opens response opportunities for remaining legal actors
      emit(s, "MissileCommitted", p.id, { side, dieIndex: action.dieIndex, naturalValue: dice[action.dieIndex] });
      if (legalModifierActors(s, c).length === 0) resolveCombat(s);
      return s;
    }

    case "combat.pass": {
      const c = s.combat;
      if (!c?.natural || !c.window) throw new RuleViolation("No modifier window open");
      const actors = legalModifierActors(s, c);
      if (actors[0] !== action.playerId) throw new RuleViolation("Not your response opportunity");
      c.window.passed.push(action.playerId);
      emit(s, "ModifierPassed", p.id);
      if (legalModifierActors(s, c).length === 0) resolveCombat(s);
      return s;
    }

    case "attack.moveIn": {
      const c = s.combat;
      if (!c?.awaitingMoveIn) throw new RuleViolation("No conquest move-in pending");
      if (action.playerId !== c.attacker) throw new RuleViolation("Only the attacker moves in");
      const { min, max } = c.awaitingMoveIn;
      if (action.count < min || action.count > max) throw new RuleViolation(`Move in ${min}-${max} troops`);
      completeConquest(s, action.count);
      return s;
    }

    case "attack.cancel": {
      const c = s.combat;
      if (!c || c.natural || c.awaitingMoveIn) throw new RuleViolation("Cannot cancel mid-roll");
      if (action.playerId !== c.attacker) throw new RuleViolation("Only the attacker cancels");
      s.combat = undefined;
      emit(s, "AttackCancelled", p.id);
      return s;
    }

    case "phase.endAttacks": {
      ensurePhase(s, "expand_attack");
      ensureActive(s, action.playerId);
      if (s.combat) throw new RuleViolation("Resolve current combat first");
      s.phase = "maneuver";
      emit(s, "PhaseChanged", p.id, { phase: "maneuver" });
      return s;
    }

    case "maneuver.move": {
      const early = s.phase !== "maneuver"; // new (9): early_maneuver — any stable point during Saharan's own turn
      if (early) { // new
        if (!hasPower(s, action.playerId, "early_maneuver")) ensurePhase(s, "maneuver"); // new: normal factions keep the phase gate
        ensurePhase(s, "start_turn", "join_or_recruit", "expand_attack", "end_turn"); // new: own-turn phases only
        if (s.combat) throw new RuleViolation("Resolve current combat first"); // new: stable boundary only
      } // new
      ensureActive(s, action.playerId);
      if (s.maneuverUsed) throw new RuleViolation("One maneuver per turn");
      const from = s.territories[action.from];
      const to = s.territories[action.to];
      if (from.controller !== p.id || to.controller !== p.id) throw new RuleViolation("Both territories must be yours");
      const unconnected = !connected(s, p.id, action.from, action.to); // new (9)
      if (unconnected && !hasPower(s, p.id, "unconnected_maneuver")) throw new RuleViolation("Territories not connected through your territories"); // new
      if (action.count < 1 || action.count >= from.troops) throw new RuleViolation("Leave at least one troop behind");
      from.troops -= action.count;
      to.troops += action.count;
      s.maneuverUsed = true;
      if (early) emit(s, "FactionPowerApplied", p.id, { powerId: "early_maneuver", phase: s.phase }); // new
      if (unconnected) emit(s, "FactionPowerApplied", p.id, { powerId: "unconnected_maneuver", from: action.from, to: action.to }); // new
      emit(s, "Maneuvered", p.id, { from: action.from, to: action.to, count: action.count });
      return s;
    }

    case "phase.endManeuver": {
      ensurePhase(s, "maneuver");
      ensureActive(s, action.playerId);
      s.phase = "end_turn";
      emit(s, "PhaseChanged", p.id, { phase: "end_turn" });
      if (!p.conqueredEnemyThisTurn && !expansionistDrawEarned(s, p.id)) { // new (9): Imperial's 4+ expansion also earns the draw
        emit(s, "DrawNotEligible", p.id);
      }
      return s;
    }

    case "end.draw": {
      ensurePhase(s, "end_turn");
      ensureActive(s, action.playerId);
      const expansionist = !p.conqueredEnemyThisTurn && expansionistDrawEarned(s, p.id); // new (9)
      if (!p.conqueredEnemyThisTurn && !expansionist) throw new RuleViolation("No enemy territory conquered this turn");
      if (expansionist) emit(s, "FactionPowerApplied", p.id, { powerId: "expansionist_supply", expandedTerritories: s.expandedThisTurn }); // new
      // Mission draw-vs-mission hook: no-op until Mission cards unlock (Slice 11)
      if ("slot" in action.choice) {
        const i = action.choice.slot;
        const cardId = s.sideboard.slots[i];
        if (cardId === null || i < 0 || i > 3) throw new RuleViolation("Empty slot");
        const def = card(cardId)!;
        if (def.kind !== "territory") throw new RuleViolation("Bad card");
        if (s.territories[def.territoryId].controller !== p.id) {
          throw new RuleViolation("Face-up territory card must show a territory you control"); // verify
        }
        s.sideboard.slots[i] = null;
        p.hand.push(cardId);
        emit(s, "ResourceCardDrawn", p.id, { kind: "territory", slot: i }); // identity owner-only; server filters
        if (action.khanReinforce) { // new (9): territory_card_reinforcement — optional +1 troop on the drawn card's territory
          if (!hasPower(s, p.id, "territory_card_reinforcement")) throw new RuleViolation("Reinforcing the drawn territory requires Khan's Territory Card Reinforcement power");
          s.territories[def.territoryId].troops++; // controller check already enforced above (must control to take)
          emit(s, "FactionPowerApplied", p.id, { powerId: "territory_card_reinforcement", territory: def.territoryId, troops: s.territories[def.territoryId].troops });
        } // new
      } else {
        if (action.khanReinforce) throw new RuleViolation("Only a drawn Territory card can be reinforced"); // new (9)
        const eligible = s.sideboard.slots.some((id) => id && s.territories[(card(id) as any).territoryId]?.controller === p.id);
        if (eligible) throw new RuleViolation("You must take a matching face-up territory card"); // verify
        const coin = s.sideboard.coinPile.shift();
        if (!coin) throw new RuleViolation("Coin pile empty");
        p.hand.push(coin);
        // Slot 4 discard behavior on coin draw
        const slot4 = s.sideboard.slots[3];
        if (slot4) { s.sideboard.discard.push(slot4); s.sideboard.slots[3] = null; }
        emit(s, "ResourceCardDrawn", p.id, { kind: "coin", slot4Discarded: slot4 ?? null });
        coinDepletionCheck(s);
      }
      refillSlots(s);
      if (s.phase !== "game_over") {
        applyEndOfTurnScars(s, p.id); // new: Biohazard attrition at controller's end of turn
        p.conqueredEnemyThisTurn = false;
        advanceTurn(s);
      }
      return s;
    }

    case "scar.play": { // new (8b): a holder plays a starter scar at a stable boundary, on anyone's turn
      if (s.phase === "game_over") throw new RuleViolation("Game is over");
      // Stable boundary only: never interrupt a post-roll missile window or a conquest move-in.
      if (s.combat && (s.combat.natural || s.combat.awaitingMoveIn)) {
        throw new RuleViolation("Cannot play a scar during a missile window or conquest move-in");
      }
      const held = p.scarHand.find((x) => x.instanceId === action.scarInstanceId);
      if (!held) throw new RuleViolation("You do not hold that scar");
      const def = scarById(held.scarId);
      if (!def || !scarAvailable(s.unlockedModules, def)) throw new RuleViolation("That scar is not playable (its module is still sealed)"); // new (11)
      const t = s.territories[action.territoryId];
      if (!t) throw new RuleViolation("Unknown territory");
      if (t.scars.length > 0) throw new RuleViolation("Territory already has a scar (one scar per territory)");
      t.scars.push(held.scarId); // attach (placed scars are public, on the board)
      p.scarHand = p.scarHand.filter((x) => x.instanceId !== held.instanceId); // consume from hand
      p.scarCardCount = p.scarHand.length;
      emit(s, "ScarPlayed", action.playerId, { scarId: held.scarId, instanceId: held.instanceId, territory: action.territoryId });
      return s;
    }

    case "reward.choose": { // new (10a): post-win reward resolution — winner first, held-on clockwise
      if (s.phase !== "game_over" || !s.rewards || s.rewards.committed) throw new RuleViolation("No end-game reward selection open");
      const r = s.rewards;
      if (r.order[r.nextIdx] !== action.playerId) throw new RuleViolation("Not your reward selection");
      const isWinner = r.nextIdx === 0;
      const choice = action.reward;
      const winnerKinds = ["name_continent", "found_major_city", "cancel_scar", "change_continent_bonus", "fortify_city"];
      if (choice.kind !== "pass") {
        if (isWinner && !winnerKinds.includes(choice.kind)) throw new RuleViolation("The winner must choose a winner reward");
        if (!isWinner && winnerKinds.includes(choice.kind)) throw new RuleViolation("Held-on players choose a held-on reward (found_minor_city or upgrade_territory_card)");
      }
      const requireName = (name: string) => {
        const trimmed = name.trim();
        if (!trimmed) throw new RuleViolation("A non-empty name is required");
        return trimmed;
      };
      const continentEntry = (cid: string) => {
        if (!manifest.continents.some((c) => c.id === cid)) throw new RuleViolation("Unknown continent");
        return (s.continents[cid] ??= {});
      };
      const territory = (tid: TerritoryId) => {
        const t = s.territories[tid];
        if (!t) throw new RuleViolation("Unknown territory");
        return t;
      };
      switch (choice.kind) {
        case "name_continent": {
          const entry = continentEntry(choice.continentId);
          if (entry.name) throw new RuleViolation("Continent is already named");
          entry.name = requireName(choice.name);
          entry.namedBy = p.id; // personal +1 when the namer controls it (recruitBreakdown)
          emit(s, "ContinentNamed", p.id, { continentId: choice.continentId, name: entry.name });
          break;
        }
        case "found_major_city": {
          if (s.inventories.majorCities < 1) throw new RuleViolation("No Major Cities left in inventory");
          const t = territory(choice.territoryId);
          if (t.city) throw new RuleViolation("Territory already has a city");
          t.city = { type: "major", population: cityPopulation("major"), name: requireName(choice.name), foundedByPlayerId: p.id };
          s.inventories.majorCities--;
          emit(s, "MajorCityFounded", p.id, { territory: choice.territoryId, name: t.city.name });
          break;
        }
        case "cancel_scar": {
          if (s.inventories.cancelStickers < 1) throw new RuleViolation("No cancel stickers left");
          const t = territory(choice.territoryId);
          if (t.scars.length === 0) throw new RuleViolation("No scar to cancel there");
          const scarId = t.scars.splice(0, 1)[0]; // instance destroyed/cancelled (campaign inventory: 10b)
          s.inventories.cancelStickers--;
          emit(s, "ScarCancelled", p.id, { territory: choice.territoryId, scarId });
          break;
        }
        case "change_continent_bonus": {
          if (choice.delta !== 1 && choice.delta !== -1) throw new RuleViolation("Bonus change is +1 or -1");
          const entry = continentEntry(choice.continentId);
          if (entry.bonusMark !== undefined) throw new RuleViolation("Continent bonus already changed (each continent at most once)");
          if (Object.values(s.continents).some((c) => c.bonusMark === choice.delta)) throw new RuleViolation("That bonus mark is already used (one +1 and one -1 campaign-wide)");
          entry.bonusMark = choice.delta;
          emit(s, "ContinentBonusChanged", p.id, { continentId: choice.continentId, delta: choice.delta });
          break;
        }
        case "fortify_city": {
          if (s.inventories.fortifyMarks < 1) throw new RuleViolation("No Fortification marks left");
          const t = territory(choice.territoryId);
          if (!t.city) throw new RuleViolation("Fortification must target a city");
          const durability = (scarById("fortification") as any)?.durability ?? 10; // pack data
          t.fortification = { max: durability, remaining: durability }; // set or REPLACE at full durability
          s.inventories.fortifyMarks--;
          emit(s, "CityFortified", p.id, { territory: choice.territoryId, durability });
          break;
        }
        case "found_minor_city": {
          if (s.inventories.minorCities < 1) throw new RuleViolation("No Minor Cities left in inventory");
          const t = territory(choice.territoryId);
          if (t.controller !== p.id) throw new RuleViolation("You must control the territory at game end");
          if (t.city) throw new RuleViolation("Territory already has a city");
          t.city = { type: "minor", population: cityPopulation("minor"), name: requireName(choice.name), foundedByPlayerId: p.id };
          s.inventories.minorCities--;
          emit(s, "MinorCityFounded", p.id, { territory: choice.territoryId, name: t.city.name });
          if (s.inventories.minorCities === 0) queueUnlock(s, "pack_1_advanced_draft_biohazards", "end_game"); // new (11): the 9th (last) Minor City founded & named
          break;
        }
        case "upgrade_territory_card": {
          const def = card(choice.cardId);
          if (!def || def.kind !== "territory") throw new RuleViolation("Only territory cards can be upgraded");
          if (s.sideboard.destroyed.includes(choice.cardId)) throw new RuleViolation("Card is destroyed");
          if (s.territories[def.territoryId].controller !== p.id) throw new RuleViolation("You must control the card's territory at game end");
          const max = ruleValue<number>("cardUpgradeMaxResources");
          const current = cardResources(s, choice.cardId);
          if (current >= max) throw new RuleViolation(`Card already at ${max}+ resources`);
          s.cardModifications[choice.cardId] = { resources: current + 1 };
          emit(s, "TerritoryCardUpgraded", p.id, { cardId: choice.cardId, resources: current + 1 });
          break;
        }
        case "pass": {
          if (isWinner && anyWinnerRewardAvailable(s)) throw new RuleViolation("The winner must resolve one winner reward");
          emit(s, "RewardPassed", p.id);
          break;
        }
      }
      r.nextIdx++;
      if (r.nextIdx >= r.order.length) {
        r.committed = true;
        emit(s, "EndGameRewardsCommitted", undefined, { order: r.order });
        processUnlocks(s, "end_game"); // new (11): end-game reveals fire after the last reward resolves
      }
      return s;
    }

    case "end.turn": {
      ensurePhase(s, "end_turn");
      ensureActive(s, action.playerId);
      if (p.conqueredEnemyThisTurn) throw new RuleViolation("Draw your Resource card first");
      applyEndOfTurnScars(s, p.id); // new: Biohazard attrition at controller's end of turn
      emit(s, "TurnEnded", p.id);
      advanceTurn(s);
      return s;
    }
  }
}

function maybeRoll(s: GameState) {
  const c = s.combat!;
  if (c.attackerDice === undefined || c.defenderDice === undefined) return;
  const att = Array.from({ length: c.attackerDice }, () => rollDie(s)).sort((a, b) => b - a);
  const def = Array.from({ length: c.defenderDice }, () => rollDie(s)).sort((a, b) => b - a);
  c.natural = { att, def };
  c.unmodifiable = { att: att.map(() => false), def: def.map(() => false) };
  emit(s, "DiceRolled", c.attacker, { att, def });
  const actors = legalModifierActors(s, { ...c, window: { passed: [] } });
  if (actors.length === 0) {
    resolveCombat(s); // no formal window when nobody can act
  } else {
    c.window = { passed: [] };
    emit(s, "TimingWindowOpened", undefined, { kind: "post_roll_modifiers", actors });
  }
}

function connected(s: GameState, pid: PlayerId, from: TerritoryId, to: TerritoryId): boolean {
  const seen = new Set<TerritoryId>([from]);
  const queue = [from];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === to) return true;
    for (const n of territoryById(cur).neighbors) {
      if (!seen.has(n) && s.territories[n].controller === pid) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return false;
}

/** Maneuver network for UI highlighting. */
export function maneuverNetwork(s: GameState, pid: PlayerId, from: TerritoryId): TerritoryId[] {
  return manifest.territories
    .map((t) => t.id)
    .filter((tid) => tid !== from && s.territories[tid].controller === pid && connected(s, pid, from, tid));
}

/** Whose decision is the game waiting on (for UI/turn routing)? */
export function waitingOn(s: GameState): PlayerId | undefined {
  if (s.phase === "game_over") return s.rewards && !s.rewards.committed ? s.rewards.order[s.rewards.nextIdx] : undefined; // new: reward resolution routes to the current claimant
  if (s.phase === "setup") return s.setup!.chooserOrder[s.setup!.nextIdx];
  const c = s.combat;
  if (c) {
    if (c.awaitingMoveIn) return c.attacker;
    if (c.natural && c.window) return legalModifierActors(s, c)[0];
    if (c.attackerDice === undefined) return c.attacker;
    if (c.defenderDice === undefined) return c.defender;
  }
  return s.turnOrder[s.activeIdx];
}

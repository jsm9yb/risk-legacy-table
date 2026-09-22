/**
 * Deterministic Risk Legacy rules engine.
 * Pure-ish: applyAction clones state, validates, mutates the clone, appends events, returns it.
 * All randomness flows through state.rngState (seeded, replayable).
 */
import { manifest, visualConnections } from "@risk/map";
import { contentPack, factionDefinitionById, factionDefinitions, ruleValue, troopsForResources, cityPopulation } from "@risk/content"; // cityPopulation for reward founding
import { rollDie, shuffled } from "./rng.ts";
import { canClaimFaceUpTerritory, endTurnDecision, expansionistDrawEarned, hasFactionPower as hasPower } from "./decisions.ts";
import type {
  Action, GameState, GameEvent, PlayerId, TerritoryId, FactionId, RecruitBreakdown, PendingCombat, LegacyCard,
} from "./types.ts";
import type { GameEventPayloads, GameEventType } from "./events.ts";
import { isCampaignPrepared, type CampaignState } from "./campaign.ts";
import { ALIEN_ISLAND_ID, isBaseTerritory, neighborsOf, territoryIds } from "./topology.ts";
import { ALIEN_ISLAND_CARD_ID, resourceCardDefinition, territoryCardDefinitions } from "./resourceCards.ts";

export class RuleViolation extends Error {}

const card = resourceCardDefinition;

/** Card resource value with upgrade_territory_card modifications overlaid on the pack base value. */
const cardResources = (s: GameState, id: string) => s.cardModifications[id]?.resources ?? card(id)!.resources;

const ADVANCED_DRAFT_MODULE = "pack_1_advanced_draft_biohazards";
const ADVANCED_DRAFT_CATEGORIES = ["faction", "turnOrder", "placementOrder", "startingTroops", "startingCoinCards"] as const;

function emit<T extends GameEventType>(s: GameState, type: T, playerId?: PlayerId, data?: GameEventPayloads[T]) {
  s.log.push({ seq: ++s.eventSeq, type, playerId, data } as GameEvent);
}

// ---------- Game creation / setup ----------

export interface NewGameConfig {
  gameId: string;
  seed: number;
  players: { id: PlayerId; name: string; redStarTokens?: number; missiles?: number }[];
  campaign?: CampaignState; // seed this game from persisted campaign legacy
}

export function createGame(cfg: NewGameConfig): GameState {
  if (cfg.players.length < 3 || cfg.players.length > 5) throw new RuleViolation("3-5 players (2-player is not a supported starter mode)"); // starter rules
  const camp = cfg.campaign;
  if (camp && !isCampaignPrepared(camp)) throw new RuleViolation("Prepare the World must be sealed before Game 1 can begin");
  // Pack 1 (D5): the advanced setup draft REPLACES base roll setup and blocks until draft card values are host-entered.
  if (camp?.unlockedModules.includes(ADVANCED_DRAFT_MODULE)
      && camp.contentRequired?.some((c) => c.moduleId === ADVANCED_DRAFT_MODULE && c.items.includes("draft"))) {
    throw new RuleViolation("Pack 1 is open: the advanced setup draft replaces base roll setup and needs host-entered draft card values (import wizard)");
  }
  const s: GameState = {
    gameId: cfg.gameId,
    seed: cfg.seed,
    worldName: camp?.worldName ?? "An Unnamed World",
    gameNumber: (camp?.gameNumber ?? 0) + 1, // campaign game counter (1 with no history)
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
    legacyCards: {
      eventDeck: [], eventDiscard: [], eventBox: [], ongoingEvents: [],
      missionDeck: [], missionBox: [], privateMissionPool: [],
    },
    startTurnDone: false,
    maneuverUsed: false,
    factionPowers: { ...camp?.factionPowerChoices }, // powers attach to factions; campaign carries prior choices
    comebackPowers: structuredClone(camp?.factionComebackPowers ?? {}),
    factionMissilePowers: structuredClone(camp?.factionMissilePowers ?? {}),
    factionWeaknesses: structuredClone(camp?.factionWeaknesses ?? {}),
    mutantEvolution: camp?.mutantEvolution,
    mutantEvolutionChoices: [...(camp?.mutantEvolutionChoices ?? [])],
    bringerOfNuclearFireFactionId: camp?.bringerOfNuclearFireFactionId,
    alienCollaboratorFactionId: camp?.alienCollaboratorFactionId,
    alienAlliancePlayerId: undefined,
    missilePowersUsedThisTurn: [],
    empTerritories: [],
    badIntelDeniedContinents: [],
    blockedResourceDraws: [],
    comebackQueue: [],
    factionHistory: structuredClone(camp?.factionHistory ?? {}),
    blockedAttackTargets: [],
    expandedThisTurn: 0,
    expandedIntoCityThisTurn: false,
    mobileHqUsed: false,
    endTurnScarsApplied: false,
    signatures: Object.fromEntries(cfg.players.map((p) => [p.id, camp?.signatures[p.id] ?? 0])), // seeded from campaign history
    continents: {}, // continent names/bonus marks (rewards write these; 10b carries them)
    inventories: camp // reward inventories carry across games
      ? { cancelStickers: camp.inventories.cancelStickers, fortifyMarks: camp.inventories.fortifyMarks, majorCities: camp.inventories.majorCities, minorCities: camp.inventories.minorCities }
      : { ...ruleValue<GameState["inventories"]>("rewardInventories") }, // finite reward inventories from pack data
    cardModifications: {}, // territory-card upgrades, overlaid on pack card values
    unlockedModules: [...(camp?.unlockedModules ?? [])], // previously revealed modules stay active
    pendingUnlocks: [],
    contentRequired: structuredClone(camp?.contentRequired ?? []),
    hostContent: structuredClone(camp?.hostContent ?? {}),
    worldCapitalTerritoryId: camp?.worldCapitalTerritoryId,
    leadFactionId: camp?.leadFactionId,
    alienIsland: structuredClone(camp?.alienIsland),
    customConnections: structuredClone(camp?.board.customConnections ?? []),
    capturedPrivateMissions: structuredClone(camp?.factionPrivateMissions ?? {}),
    privateMissionsUsed: [],
    privateMissionProgress: {
      tradedResources: 0,
      highValueTerritoryCards: 0,
      forcedOccupation: false,
      wideBorderAtStart: false,
    },
    eventSeq: 0,
    log: [],
  };
  if (s.alienIsland) s.territories[s.alienIsland.territoryId] = { troops: 0, scars: [] };
  for (const p of cfg.players) {
    const sig = s.signatures[p.id]; // signature-driven setup (SPEC §4/§7)
    s.players[p.id] = {
      id: p.id, name: p.name,
      startingTroops: startingTroops(),
      redStarTokens: p.redStarTokens ?? (sig >= 1 ? 0 : 1), // >=1 signature -> no starting token
      missiles: p.missiles ?? sig, // missiles = signature count (0 with no history)
      hand: [], scarHand: [], scarCardCount: 0, // scarHand holds dealt starter scars (identity hidden)
      knockedOut: false, eliminated: false, conqueredEnemyThisTurn: false,
    };
  }
  if (camp) { // apply persisted board legacy before any placement
    for (const sc of camp.board.scars) s.territories[sc.territoryId].scars.push(sc.scarId);
    for (const tid of camp.board.ruins ?? []) if (s.territories[tid]) s.territories[tid].ruin = true;
    for (const c of camp.board.cities) s.territories[c.territoryId].city = { type: c.type, population: cityPopulation(c.type), name: c.name, foundedByPlayerId: c.foundedByPlayerId };
    const fortMax = (scarById("fortification") as any)?.durability ?? 10;
    for (const f of camp.board.fortifications) s.territories[f.territoryId].fortification = { max: fortMax, remaining: f.durability };
    for (const [cid, named] of Object.entries(camp.board.continentNames)) s.continents[cid] = { ...s.continents[cid], name: named.name, namedBy: named.namedBy };
    for (const [cid, mark] of Object.entries(camp.board.continentBonusMarks)) s.continents[cid] = { ...s.continents[cid], bonusMark: mark };
    for (const m of camp.board.cardModifications) if (m.resources !== undefined) s.cardModifications[m.cardId] = { resources: m.resources };
    emit(s, "CampaignLegacyApplied", undefined, { gameNumber: s.gameNumber, scars: camp.board.scars.length, cities: camp.board.cities.length, fortifications: camp.board.fortifications.length });
  }
  emit(s, "GameStarted", undefined, { gameId: cfg.gameId, seed: cfg.seed, players: cfg.players.map((p) => p.id) });

  // One high roll determines the first chooser; selection and turn order then continue
  // clockwise in the table order supplied by cfg.players. Only tied high rollers re-roll.
  const tableOrder = cfg.players.map((p) => p.id);
  let pool = [...tableOrder];
  const rolls: Record<PlayerId, number> = {};
  let firstChooser: PlayerId | undefined;
  while (!firstChooser) {
    const round = pool.map((id) => ({ id, roll: rollDie(s) }));
    for (const r of round) rolls[r.id] = r.roll;
    const max = Math.max(...round.map((r) => r.roll));
    const winners = round.filter((r) => r.roll === max);
    if (winners.length === 1) {
      firstChooser = winners[0].id;
    } else {
      pool = winners.map((winner) => winner.id);
    }
    emit(s, "SetupOrderRoll", undefined, { round: round.map((r) => ({ ...r })) });
  }
  const firstIdx = tableOrder.indexOf(firstChooser);
  const order = [...tableOrder.slice(firstIdx), ...tableOrder.slice(0, firstIdx)];
  const interactiveSetup = !!camp?.preparation;
  s.setup = { stage: interactiveSetup ? "order_reveal" : "faction_selection", chooserOrder: order, nextIdx: 0, rolls };
  s.turnOrder = order;
  emit(s, "SetupChooserOrder", undefined, { order });
  if (camp?.unlockedModules.includes(ADVANCED_DRAFT_MODULE)
      && !camp.contentRequired?.some((entry) => entry.moduleId === ADVANCED_DRAFT_MODULE && entry.items.includes("draft"))) {
    const reverse = [...order].reverse();
    s.advancedDraft = {
      pickOrder: ADVANCED_DRAFT_CATEGORIES.flatMap((_, round) => round % 2 === 0 ? order : reverse),
      nextPickIdx: 0,
      picks: Object.fromEntries(order.map((playerId) => [playerId, {}])),
      available: {
        factions: factionDefinitions(s.unlockedModules).map((faction) => faction.id),
        turnOrder: Array.from({ length: cfg.players.length }, (_, index) => index + 1),
        placementOrder: Array.from({ length: cfg.players.length }, (_, index) => index + 1),
        startingTroops: cfg.players.length === 3 ? [6, 8, 10]
          : cfg.players.length === 4 ? [6, 8, 8, 10] : [6, 8, 8, 10, 10],
        startingCoinCards: cfg.players.length === 3 ? [0, 1, 2]
          : cfg.players.length === 4 ? [0, 0, 1, 2] : [0, 0, 1, 1, 2],
      },
      explicitCoinClaims: interactiveSetup,
      completed: false,
    };
    if (!interactiveSetup) s.setup.stage = "advanced_draft";
    emit(s, "AdvancedDraftStarted", undefined, { pickOrder: s.advancedDraft.pickOrder });
  }

  // Sideboard: shuffled territory deck, exactly 4 face-up slots, coin pile
  const destroyedCards = new Set((camp?.board.cardModifications ?? []).filter((m) => m.destroyed).map((m) => m.cardId)); // destroyed cards never re-enter play
  s.sideboard.destroyed = [...destroyedCards];
  const deck = shuffled(s, territoryCardDefinitions(!!camp?.alienIsland).map((c) => c.id).filter((id) => !destroyedCards.has(id))); // filter before shuffle
  s.sideboard.slots = [deck.shift()!, deck.shift()!, deck.shift()!, deck.shift()!];
  s.sideboard.territoryDeck = deck;
  s.sideboard.coinPile = [...contentPack.cards.coinCards.map((c) => c.id)];
  emit(s, "SideboardSetup", undefined, { slots: s.sideboard.slots, deckCount: deck.length, coinCount: 10 });
  initializeLegacyCards(s);

  // Scar deal: one hidden starter-scar instance per player, only if enough instances exist (D1).
  // Starter inventory = campaign scar-instance counts when carrying over, else pack `instances`.
  const scarPool = shuffled(
    s,
    contentPack.scars
      .filter((x) => scarAvailable(s.unlockedModules, x)) // unlocked module scars join the pool
      .flatMap((x) => {
        const count = camp ? camp.inventories.scarInstances[x.id] ?? 0 : (x as any).instances ?? 0; // played instances are consumed forever
        return Array.from({ length: count }, (_, i) => ({ instanceId: `${x.id}#${i + 1}`, scarId: x.id }));
      }),
  );
  if (scarPool.length >= cfg.players.length) {
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
  return ruleValue<number>("startingTroops"); // flat 8 per player; no player-count scaling
}

export function joinWarTroops(s?: GameState, playerId?: PlayerId): number {
  return Math.floor(((playerId ? s?.players[playerId]?.startingTroops : undefined) ?? startingTroops()) / 2);
}

/**
 * Legal placement test. A territory qualifies if it is unoccupied and unmarked,
 * or an unoccupied Major City founded by the placing player (city system arrives
 * with the founding slice). Minor cities never qualify. When placing an HQ
 * (initial setup), the territory may not be adjacent to another faction's HQ.
 */
export function isLegalStart(s: GameState, tid: TerritoryId, placingHq = false, placingFaction?: FactionId, placingPlayerId?: PlayerId): boolean { // placingPlayerId for the founder check
  const t = s.territories[tid];
  if (!t || (!isBaseTerritory(tid) && tid !== s.alienIsland?.territoryId)) return false;
  if (tid === s.alienIsland?.territoryId) return t.troops === 0 && !t.controller && !t.hqFaction;
  const unoccupiedUnmarked = t.troops === 0 && !t.controller && !t.hqFaction && !t.city && !t.ruin && t.scars.length === 0; // cities, ruins, AND scars are marks; only the founder's Major City overrides (even if scarred)
  const ownFoundedMajorCity = t.troops === 0 && !t.controller && t.city?.type === "major" && t.city.foundedByPlayerId === placingPlayerId; // keyed on city type + founder (player), not population/faction
  if (!unoccupiedUnmarked && !ownFoundedMajorCity) return false; // minor/world-capital cities, and another player's Major City, never qualify
  if (placingHq) {
    for (const n of neighborsOf(s, tid)) { // HQ-adjacency restriction
      const nt = s.territories[n];
      if (nt.hqFaction && nt.hqFaction !== placingFaction) return false;
    }
  }
  return true;
}

// ---------- Faction powers ----------

/** The selected starting power of the player's faction, or undefined. */
/** Per-turn power bookkeeping + automatic start-of-turn powers. Runs whenever a turn begins. */
function enterStartTurn(s: GameState, pid: PlayerId) {
  s.blockedAttackTargets = []; // defensive_stand locks expire when the active turn ends
  s.intimidation = undefined;
  s.expandedThisTurn = 0;
  s.expandedIntoCityThisTurn = false;
  s.stealthRecruitTerritory = undefined;
  s.mobileHqUsed = false;
  s.missilePowersUsedThisTurn = [];
  s.empTerritories = [];
  s.badIntelDeniedContinents = [];
  s.blockedResourceDraws = [];
  s.privateMissionProgress = {
    tradedResources: 0,
    highValueTerritoryCards: 0,
    forcedOccupation: false,
    wideBorderAtStart: manifest.continents.filter((continent) => manifest.territories
      .filter((territory) => territory.continent === continent.id)
      .every((territory) => s.territories[territory.id].controller === pid)).length >= 2,
  };
  if (s.players[pid].factionId === "mutants") s.protectedMutantTerritoryId = undefined;
  if (hasPower(s, pid, "hq_reinforcement")) { // Khan — +1 troop on each controlled territory containing any HQ
    for (const [tid, t] of Object.entries(s.territories)) {
      if (t.controller !== pid || !t.hqFaction || t.troops <= 0) continue;
      t.troops++;
      emit(s, "FactionPowerApplied", pid, { powerId: "hq_reinforcement", territory: tid, troops: t.troops });
    }
  }
}

// ---------- Recruitment ----------

export function recruitBreakdown(s: GameState, pid: PlayerId): RecruitBreakdown {
  const owned = Object.entries(s.territories).filter(([, t]) => t.controller === pid);
  const n = owned.length;
  const min = ruleValue<number>("minRecruit");
  const per = ruleValue<number>("territoriesPerTroop");
  const weakness = s.factionWeaknesses[s.players[pid]?.factionId ?? ""];
  const population = weakness === "primitive"
    ? 0
    : owned.reduce((sum, [, t]) => sum + (t.city?.population ?? 0), 0);
  // Corrected formula: population counts INSIDE the division (rulebook; `recruitCountsPopulationInDivision`).
  const round = hasPower(s, pid, "round_up_recruiting") ? Math.ceil : Math.floor; // Imperial rounds UP, before min-recruit and bonuses
  const fromTerritories = Math.max(round((n + population) / per), min);
  const continents = manifest.continents
    .filter((c) => !s.badIntelDeniedContinents.includes(c.id)
      && manifest.territories.filter((t) => t.continent === c.id).every((t) => s.territories[t.id].controller === pid))
    .map((c) => {
      const legacy = s.continents[c.id]; // change_continent_bonus is global; name_continent's +1 is personal to the namer
      const globalModifier = legacy?.bonusMark ?? 0;
      const namedBonus = legacy?.namedBy === pid ? ruleValue<number>("namedContinentBonus") : 0;
      return { id: c.id, base: c.baseBonus, globalModifier, namedBonus, total: c.baseBonus + globalModifier + namedBonus };
    });
  const total = fromTerritories + continents.reduce((a, c) => a + c.total, 0); // population no longer added at face value (it's inside the division)
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
  if (Object.values(s.results).some((r) => r === "eliminated")) { // Pack 2's "else end-game" branch — any elimination opens it
    queueUnlock(s, "pack_2_comeback_mercenaries", "end_game");
  }
  beginEndGameRewards(s); // sign the board + open reward resolution (SPEC §7)
}

// ---------- End-game rewards & signatures (10a) ----------

/**
 * SPEC §7 post-game resolution: the winner signs (mandatory, automatic) and resolves one
 * winner reward; then held-on non-winners choose clockwise from the winner. Eliminated and
 * unused factions get no reward. Runs inside the locked game_over phase.
 */
function beginEndGameRewards(s: GameState) {
  const lastRewardGame = ruleValue<number>("starterRewardsLastGame"); // starter reward changes stop after Game 15
  if (s.gameNumber > lastRewardGame) {
    emit(s, "EndGameRewardsSkipped", undefined, { gameNumber: s.gameNumber, lastRewardGame });
    processUnlocks(s, "end_game"); // pending end-game unlocks still reveal when no reward flow opens
    return; // no signing, no rewards — existing legacy state stays active
  }
  const winner = s.winner!;
  s.signatures[winner] = (s.signatures[winner] ?? 0) + 1; // signatures are mandatory, tied to the player
  emit(s, "BoardSigned", winner, { signatures: s.signatures[winner] }); // AfterSignatureAdded hook point (Pack 3)
  if (s.signatures[winner] === 2) {
    // Official opening condition: a person's second board signature. The reveal is
    // deferred to the end-game reward sequence, after the winner has taken a reward.
    queueUnlock(s, "pack_3_homelands_missions", "end_game");
  }
  const order = [winner];
  const wIdx = s.turnOrder.indexOf(winner);
  for (let step = 1; step < s.turnOrder.length; step++) { // clockwise from the winner
    const pid = s.turnOrder[(wIdx + step) % s.turnOrder.length];
    const fid = s.players[pid].factionId;
    if (fid && s.results?.[fid] === "held_on") order.push(pid);
  }
  s.rewards = { order, nextIdx: 0, committed: false };
  emit(s, "EndGameRewardsOpened", winner, { order });
}

/** After Game 15 rewards, determine who names the completed world using the official tie roll. */
function beginWorldCompletion(s: GameState) {
  if (s.gameNumber !== 15 || s.worldCompletion) return;
  const signatureCounts = Object.values(s.players).map((player) => ({
    playerId: player.id,
    wins: s.signatures[player.id] ?? 0,
  }));
  const mostWins = Math.max(...signatureCounts.map((entry) => entry.wins));
  let contenders = signatureCounts.filter((entry) => entry.wins === mostWins).map((entry) => entry.playerId);
  while (contenders.length > 1) {
    const round = contenders.map((playerId) => {
      const namedContinents = Object.values(s.continents).filter((continent) => continent.namedBy === playerId).length;
      const die = rollDie(s);
      return { playerId, die, namedContinents, total: die + namedContinents };
    });
    emit(s, "WorldNamingRoll", undefined, { round });
    const high = Math.max(...round.map((entry) => entry.total));
    contenders = round.filter((entry) => entry.total === high).map((entry) => entry.playerId);
  }
  s.worldCompletion = { namingPlayerId: contenders[0] };
  emit(s, "WorldNamingOpened", contenders[0], { gameNumber: s.gameNumber, mostWins });
}

/** Is any winner reward still resolvable? (Gates the winner's pass — normally one reward is mandatory.) */
function anyWinnerRewardAvailable(s: GameState): boolean {
  const terrs = manifest.territories.map((territory) => s.territories[territory.id]); // starter reward stickers target the printed board
  if (manifest.continents.some((c) => !s.continents[c.id]?.name)) return true; // name_continent
  if (s.inventories.majorCities > 0 && terrs.some((t) => !t.city)) return true; // found_major_city
  if (s.inventories.cancelStickers > 0 && terrs.some((t) => t.scars.length > 0)) return true; // cancel_scar
  const marks = Object.values(s.continents).map((c) => c.bonusMark);
  if ((!marks.includes(1) || !marks.includes(-1)) && manifest.continents.some((c) => s.continents[c.id]?.bonusMark === undefined)) return true; // change_continent_bonus
  if (s.inventories.fortifyMarks > 0 && terrs.some((t) => t.city)) return true; // fortify_city
  if (territoryCardDefinitions(!!s.alienIsland).some((card) => !s.sideboard.destroyed.includes(card.id))) return true; // destroy_territory_card
  return false;
}

// ---------- Sideboard ----------

function contentCardEntries(raw: unknown): unknown[] {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try { return contentCardEntries(JSON.parse(trimmed)); } catch { /* retain literal host text */ }
    }
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && Array.isArray((raw as { cards?: unknown[] }).cards)) {
    return (raw as { cards: unknown[] }).cards;
  }
  return raw === undefined || raw === null ? [] : [raw];
}

function legacyCardsFromContent(raw: unknown, moduleId: string, kind: "event" | "mission" | "power" | "privateMission"): LegacyCard[] {
  return contentCardEntries(raw).map((entry, index) => {
    const data = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    const literal = typeof entry === "string" ? entry : undefined;
    const defaultKind = kind === "event" ? "Event" : kind === "mission" ? "Mission" : kind === "power" ? "Comeback Power" : "Private Mission";
    const title = String(data.title ?? data.name ?? literal ?? `${defaultKind} ${index + 1}`);
    const text = String(data.text ?? data.rules ?? literal ?? title);
    const suppliedReward = Number(data.reward);
    const reward = suppliedReward === 1 || suppliedReward === 2 ? suppliedReward as 1 | 2 : undefined;
    return {
      id: `${moduleId}:${kind}:${String(data.id ?? index + 1)}`,
      sourceModuleId: moduleId,
      title,
      text,
      ...(reward ? { reward } : {}),
    };
  });
}

const sourcedCard = (moduleId: string, kind: "event" | "mission" | "privateMission", id: string, title: string, text: string, reward?: 1 | 2): LegacyCard => ({
  id: `${moduleId}:${kind}:${id}`, sourceModuleId: moduleId, title, text, ...(reward ? { reward } : {}),
});

const SOURCED_EVENTS: Record<string, LegacyCard[]> = {
  pack_1_advanced_draft_biohazards: [
    ...[1, 2].map((n) => sourcedCard(ADVANCED_DRAFT_MODULE, "event", `fortify-${n}`, "Fortify", "The sole population leader may fortify a controlled city, or add two troops to each of up to two controlled cities.")),
    ...[1, 2].map((n) => sourcedCard(ADVANCED_DRAFT_MODULE, "event", `control-the-people-${n}`, "Control the People", "The sole population leader may add five troops to one controlled city or make an immediate maneuver.")),
    sourcedCard(ADVANCED_DRAFT_MODULE, "event", "riots", "Riots", "Each player with a Major City tests it; a failed test removes troops equal to the natural roll and demolishes its HQ."),
    ...[1, 2].map((n) => sourcedCard(ADVANCED_DRAFT_MODULE, "event", `resistance-${n}`, "Resistance", "Every Minor City containing one or two troops loses one troop.")),
  ],
  pack_3_homelands_missions: [1, 2, 3].map((n) => sourcedCard("pack_3_homelands_missions", "event", `join-the-cause-${n}`, "Join the Cause", "The sole population leader may place three troops among controlled cities or replace the public Mission.")),
  pocket_1_nuclear_war_mutants: [
    ...[1, 2, 3].map((n) => sourcedCard("pocket_1_nuclear_war_mutants", "event", `fallout-${n}`, "Fallout", "Roll once for every land-adjacent territory and remove that many troops; Mutants are unaffected. Remove this Event from the game.")),
    ...[1, 2, 3].map((n) => sourcedCard("pocket_1_nuclear_war_mutants", "event", `agent-of-chaos-${n}`, "Agent of Chaos", "If no human faction has a continent bonus, the Mutants gain one Red Star token.")),
    ...[1, 2].map((n) => sourcedCard("pocket_1_nuclear_war_mutants", "event", `mutants-evolve-${n}`, "The Mutants Evolve", "Advance the Mutants' hidden evolution procedure.")),
  ],
  pocket_2_alien_landing: [
    ...[1, 2, 3].map((n) => sourcedCard("pocket_2_alien_landing", "event", `ruins-${n}`, "Die Humans", "The Alien player may replace a Minor City with Ruins, removing every troop and HQ there; destroy the Event only if a city is ruined.")),
    ...[1, 2].map((n) => sourcedCard("pocket_2_alien_landing", "event", `reinforcements-${n}`, "Beam Down", "The Alien player may place five troops into an unoccupied city.")),
    ...[1, 2].map((n) => sourcedCard("pocket_2_alien_landing", "event", `mysterious-island-${n}`, "Mysterious Island", "Whoever controls Alien Island may take any face-up Territory card.")),
  ],
};

const SOURCED_MISSIONS: LegacyCard[] = [
  sourcedCard("pack_3_homelands_missions", "mission", "imperial-might", "Imperial Might", "Have a current total continent bonus of at least seven.", 1),
  sourcedCard("pack_3_homelands_missions", "mission", "unexpected-attack", "Unexpected Attack", "Conquer every territory in one continent this turn.", 1),
  sourcedCard("pack_3_homelands_missions", "mission", "amphibious-onslaught", "Amphibious Onslaught", "Conquer at least four territories over sea lines this turn.", 1),
  sourcedCard("pack_3_homelands_missions", "mission", "urban-assault", "Urban Assault", "Conquer at least four cities this turn.", 1),
  sourcedCard("pack_3_homelands_missions", "mission", "reign-of-terror", "Reign of Terror", "Conquer at least nine territories this turn.", 1),
  sourcedCard("pack_3_homelands_missions", "mission", "superior-infrastructure", "Superior Infrastructure", "Control at least six cities.", 1),
  sourcedCard("pack_3_homelands_missions", "mission", "explore-the-world", "Explore the World", "Control at least seven islands.", 2),
  sourcedCard("pack_3_homelands_missions", "mission", "the-world-is-ready", "The World Is Ready", "Be eligible to draw a Territory card worth at least four resources; found and name the World Capital there.", 2),
];

const SOURCED_PRIVATE_MISSIONS: LegacyCard[] = [
  sourcedCard("pack_4_lead_faction_private_missions", "privateMission", "wide-border", "Wide Border", "Control two continents at the start of your turn.", 1),
  sourcedCard("pack_4_lead_faction_private_missions", "privateMission", "forced-occupation", "Forced Occupation", "Knock out or eliminate a player holding at least three Resource cards.", 1),
  sourcedCard("pack_4_lead_faction_private_missions", "privateMission", "guerilla-warfare", "Guerilla Warfare", "Control every Bunker and Mercenary territory.", 1),
  sourcedCard("pack_4_lead_faction_private_missions", "privateMission", "advanced-training", "Advanced Training", "Turn in at least ten resources while recruiting troops.", 1),
  sourcedCard("pack_4_lead_faction_private_missions", "privateMission", "urban-troop-surge", "Urban Troop Surge", "Control the World Capital and three Major Cities.", 1),
  sourcedCard("pack_4_lead_faction_private_missions", "privateMission", "advanced-tactics", "Advanced Tactics", "While recruiting, turn in at least two Territory cards worth at least four resources each.", 1),
];

function privateMissionCards(s: GameState): LegacyCard[] {
  const supplied = legacyCardsFromContent(
    s.hostContent["pack_4_lead_faction_private_missions.privateMissions"],
    "pack_4_lead_faction_private_missions",
    "privateMission",
  );
  const capturedIds = new Set(Object.values(s.capturedPrivateMissions).map((mission) => mission.id));
  return structuredClone(supplied.length > 0 ? supplied : SOURCED_PRIVATE_MISSIONS)
    .filter((mission) => !capturedIds.has(mission.id));
}

function cardsForModule(s: GameState, moduleId: string, kind: "event" | "mission"): LegacyCard[] {
  const supplied = legacyCardsFromContent(s.hostContent[`${moduleId}.${kind === "event" ? "events" : "missions"}`], moduleId, kind);
  if (supplied.length > 0) return supplied;
  return structuredClone(kind === "event" ? SOURCED_EVENTS[moduleId] ?? [] : moduleId === "pack_3_homelands_missions" ? SOURCED_MISSIONS : []);
}

function initializeLegacyCards(s: GameState) {
  const events = s.unlockedModules.flatMap((moduleId) => cardsForModule(s, moduleId, "event"));
  const publicMissions = s.unlockedModules.includes("pack_3_homelands_missions")
    ? cardsForModule(s, "pack_3_homelands_missions", "mission") : [];
  const privateMissions = s.unlockedModules.includes("pack_4_lead_faction_private_missions")
    ? privateMissionCards(s) : [];
  const missions = [...publicMissions, ...privateMissions];
  s.legacyCards.eventDeck = shuffled(s, events);
  s.legacyCards.missionDeck = shuffled(s, missions);
  // Once Pack 4 is active, the playing Lead Faction chooses the opening
  // Mission after factions have been seated. Before Pack 4, setup stays random.
  s.legacyCards.activeMission = s.unlockedModules.includes("pack_4_lead_faction_private_missions")
    ? undefined : s.legacyCards.missionDeck.shift();
  s.legacyCards.privateMissionPool = [];
  emit(s, "LegacyCardDecksSetup", undefined, {
    events: events.length,
    missions: missions.length,
    activeMissionId: s.legacyCards.activeMission?.id,
    privateMissions: s.legacyCards.privateMissionPool.length,
  });
}

function mergeSuppliedLegacyCards(s: GameState, moduleId: string, item: string, raw: unknown) {
  if (item === "events") {
    const added = legacyCardsFromContent(raw, moduleId, "event");
    s.legacyCards.eventDeck = shuffled(s, [...s.legacyCards.eventDeck, ...added]);
    emit(s, "EventCardsAdded", undefined, { moduleId, count: added.length, deckCount: s.legacyCards.eventDeck.length });
  }
  if (item === "missions" && s.phase !== "game_over") {
    const added = legacyCardsFromContent(raw, moduleId, "mission");
    s.legacyCards.missionDeck = shuffled(s, [...s.legacyCards.missionDeck, ...added]);
    s.legacyCards.activeMission ??= s.legacyCards.missionDeck.shift();
    emit(s, "MissionCardsAdded", undefined, { moduleId, count: added.length, activeMissionId: s.legacyCards.activeMission?.id });
  }
  if (item === "privateMissions") {
    const capturedIds = new Set(Object.values(s.capturedPrivateMissions).map((mission) => mission.id));
    const added = legacyCardsFromContent(raw, moduleId, "privateMission").filter((mission) => !capturedIds.has(mission.id));
    s.legacyCards.missionDeck = shuffled(s, [...s.legacyCards.missionDeck, ...added]);
    emit(s, "PrivateMissionCardsAdded", undefined, { moduleId, count: added.length });
  }
}

function nextTerritoryCard(s: GameState) {
  if (s.sideboard.territoryDeck.length === 0 && s.sideboard.discard.length > 0) {
    s.sideboard.territoryDeck = shuffled(s, s.sideboard.discard);
    s.sideboard.discard = [];
    emit(s, "TerritoryDeckReshuffled", undefined, { count: s.sideboard.territoryDeck.length });
  }
  return s.sideboard.territoryDeck.shift() ?? null;
}

function advanceFaceUpCards(s: GameState, removedSlot: number) {
  for (let i = removedSlot; i > 0; i--) s.sideboard.slots[i] = s.sideboard.slots[i - 1];
  s.sideboard.slots[0] = nextTerritoryCard(s);
  emit(s, "SideboardRefilled", undefined, { slots: [...s.sideboard.slots], deckCount: s.sideboard.territoryDeck.length });
}

function triggerEventForSlotOne(s: GameState): boolean {
  const cardId = s.sideboard.slots[0];
  if (!cardId || cardResources(s, cardId) % 2 !== 0 || s.legacyCards.eventDeck.length === 0) return false;
  const event = s.legacyCards.eventDeck.shift()!;
  s.legacyCards.pendingEvent = event;
  emit(s, "EventCardDrawn", undefined, { eventId: event.id, title: event.title, sourceModuleId: event.sourceModuleId });
  return true;
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
    maybeOpenMissilePowerChoice(s, leaders[0].id);
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
    s.endTurnScarsApplied = false;
    s.recruit = undefined;
    s.combat = undefined;
    s.phase = "start_turn";
    emit(s, "TurnStarted", pid, { turn: s.turnNumber });
    enterStartTurn(s, pid); // per-turn power state + start-of-turn powers
    return;
  }
}

function ensureActive(s: GameState, pid: PlayerId) {
  if (activePlayer(s) !== pid) throw new RuleViolation("Not your turn");
}
function ensurePhase(s: GameState, ...phases: GameState["phase"][]) {
  if (!phases.includes(s.phase)) throw new RuleViolation(`Illegal in phase ${s.phase}`);
}

// ---------- Unlock module engine ----------

/**
 * Sealed modules trigger during play, queue, and reveal at their timing —
 * mid-game immediately, end-game after the last reward resolves. Multiple pending
 * unlocks always process in the canonical manifest order (Pack 1→2→3→4→Pocket 1→2).
 * Host-entered content (`contentRequired`) is announced here and supplied by the
 * import wizard; the campaign layer records the pause.
 */
function queueUnlock(s: GameState, moduleId: string, timing: "mid_game" | "end_game") {
  if (s.unlockedModules.includes(moduleId) || s.pendingUnlocks.some((u) => u.moduleId === moduleId)) return;
  emit(s, "ModuleTriggered", undefined, { moduleId, timing });
  s.pendingUnlocks.push({ moduleId, timing });
  if (timing === "mid_game") processUnlocks(s, "mid_game");
}

function processUnlocks(s: GameState, timing: "mid_game" | "end_game", onlyModuleId?: string) {
  const due = s.pendingUnlocks.filter((u) => (u.timing === timing || timing === "end_game")
    && (!onlyModuleId || u.moduleId === onlyModuleId)); // end-game flush takes everything left
  if (due.length === 0) return;
  const order = (id: string) => contentPack.unlockModules.findIndex((m) => m.id === id); // canonical processing order (SPEC §9)
  due.sort((a, b) => order(a.moduleId) - order(b.moduleId));
  for (const u of due) {
    s.pendingUnlocks = s.pendingUnlocks.filter((x) => x.moduleId !== u.moduleId);
    s.unlockedModules.push(u.moduleId);
    const mod = contentPack.unlockModules.find((m) => m.id === u.moduleId) as any;
    emit(s, "ModuleRevealed", undefined, { moduleId: u.moduleId, name: mod?.name });
    const items = ((mod?.contentRequired ?? []) as string[])
      .filter((item) => s.hostContent[`${u.moduleId}.${item}`] === undefined);
    if (items.length) {
      const existing = s.contentRequired.find((entry) => entry.moduleId === u.moduleId);
      if (existing) existing.items = [...new Set([...existing.items, ...items])];
      else s.contentRequired.push({ moduleId: u.moduleId, items: [...items] });
      emit(s, "ModuleContentRequired", undefined, { moduleId: u.moduleId, items });
    }
    if (items.length === 0) {
      const events = cardsForModule(s, u.moduleId, "event");
      if (events.length > 0) {
        s.legacyCards.eventDeck = shuffled(s, [...s.legacyCards.eventDeck, ...events]);
        emit(s, "EventCardsAdded", undefined, { moduleId: u.moduleId, count: events.length, deckCount: s.legacyCards.eventDeck.length });
      }
      if (u.moduleId === "pack_3_homelands_missions") {
        const missions = cardsForModule(s, u.moduleId, "mission");
        s.legacyCards.missionDeck = shuffled(s, [...s.legacyCards.missionDeck, ...missions]);
        s.legacyCards.activeMission ??= s.legacyCards.missionDeck.shift();
        emit(s, "MissionCardsAdded", undefined, { moduleId: u.moduleId, count: missions.length, activeMissionId: s.legacyCards.activeMission?.id });
      }
      if (u.moduleId === "pack_4_lead_faction_private_missions") {
        const missions = privateMissionCards(s);
        s.legacyCards.missionDeck = shuffled(s, [...s.legacyCards.missionDeck, ...missions]);
        emit(s, "PrivateMissionCardsAdded", undefined, { moduleId: u.moduleId, count: missions.length });
      }
    }
    if (u.moduleId === "pack_2_comeback_mercenaries" && s.phase === "game_over" && items.length === 0) {
      queueEndGameComebackChoices(s);
    }
  }
}

/** Pocket 2 opens before placement when the active recruit total reaches 30+ and a Missile remains. */
function checkAlienLandingUnlock(s: GameState, playerId: PlayerId) {
  if (s.unlockedModules.includes("pocket_2_alien_landing")) return;
  const recruit = s.recruit;
  if (!recruit || recruit.breakdown.total < 30 || s.players[playerId].missiles < 1) return;
  s.alienCollaboratorFactionId = s.players[playerId].factionId;
  if (s.alienCollaboratorFactionId) s.factionWeaknesses[s.alienCollaboratorFactionId] = "alien_collaborator";
  s.alienAlliancePlayerId = playerId;
  s.alienLandingRecruitPlayerId = playerId;
  emit(s, "AlienCollaboratorNamed", playerId, { factionId: s.players[playerId].factionId, arrivingAliens: 10 });
  queueUnlock(s, "pocket_2_alien_landing", "mid_game");
}

function determineLeadFaction(s: GameState): FactionId | undefined {
  const playing = Object.values(s.players)
    .map((player) => player.factionId)
    .filter((factionId): factionId is FactionId => !!factionId);
  const standings = playing.map((factionId) => ({
    factionId,
    wins: (s.factionHistory[factionId] ?? []).filter((entry) => entry.result === "won").length,
  }));
  const mostWins = Math.max(0, ...standings.map((entry) => entry.wins));
  const leaders = standings.filter((entry) => entry.wins === mostWins);
  return leaders.length === 1 ? leaders[0].factionId : undefined;
}

function leadPlayer(s: GameState): PlayerId | undefined {
  return Object.values(s.players).find((player) => player.factionId === s.leadFactionId)?.id;
}

function openLeadMissionChoice(s: GameState, reason: "game_start" | "world_capital"): boolean {
  const playerId = leadPlayer(s);
  if (!playerId || s.legacyCards.missionDeck.length === 0) return false;
  s.missionChoice = { playerId, reason };
  emit(s, "LeadFactionMissionChoiceOpened", playerId, { reason, choices: s.legacyCards.missionDeck.length });
  return true;
}

function drawRandomMission(s: GameState) {
  s.legacyCards.activeMission = s.legacyCards.missionDeck.shift();
  emit(s, "MissionReplaced", undefined, { missionId: s.legacyCards.activeMission?.id ?? null });
}

function resolveNuclearOpening(s: GameState) {
  const combat = s.combat;
  if (!combat) throw new RuleViolation("The nuclear opening no longer has a combat to resolve");
  const territory = s.territories[combat.to];
  const affectedPlayers = new Set<PlayerId>();
  if (territory.controller) affectedPlayers.add(territory.controller);
  const removed = {
    troops: territory.troops,
    hqFaction: territory.hqFaction,
    city: territory.city?.type,
    scars: [...territory.scars],
    fortification: !!territory.fortification,
  };
  territory.troops = 0;
  territory.controller = undefined;
  territory.hqFaction = undefined;
  territory.city = undefined;
  territory.fortification = undefined;
  territory.ruin = undefined;
  territory.scars = ["fallout"];

  const attackingTroops = Math.min(combat.attackerDice ?? 0, s.territories[combat.from].troops);
  s.territories[combat.from].troops -= attackingTroops;
  if (s.territories[combat.from].controller) affectedPlayers.add(s.territories[combat.from].controller!);

  const seaLines = new Set([
    ...visualConnections.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]),
    ...(s.customConnections ?? []).flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]),
    ...(s.alienIsland?.connections ?? []).flatMap((neighbor) => [`${ALIEN_ISLAND_ID}|${neighbor}`, `${neighbor}|${ALIEN_ISLAND_ID}`]),
  ]);
  const adjacentLosses: Record<TerritoryId, number> = {};
  for (const neighbor of neighborsOf(s, combat.to)) {
    if (seaLines.has(`${combat.to}|${neighbor}`)) continue;
    const adjacent = s.territories[neighbor];
    if (adjacent.controller) affectedPlayers.add(adjacent.controller);
    const losses = rollDie(s);
    adjacentLosses[neighbor] = losses;
    adjacent.troops = Math.max(0, adjacent.troops - losses);
    if (adjacent.troops === 0) adjacent.controller = undefined;
  }

  const territoryCard = territoryCardDefinitions(!!s.alienIsland).find((candidate) => candidate.territoryId === combat.to);
  if (territoryCard && !s.sideboard.destroyed.includes(territoryCard.id)) {
    s.sideboard.destroyed.push(territoryCard.id);
    s.sideboard.territoryDeck = s.sideboard.territoryDeck.filter((id) => id !== territoryCard.id);
    s.sideboard.discard = s.sideboard.discard.filter((id) => id !== territoryCard.id);
    s.sideboard.slots = s.sideboard.slots.map((id) => id === territoryCard.id ? null : id);
    for (const player of Object.values(s.players)) player.hand = player.hand.filter((id) => id !== territoryCard.id);
    delete s.cardModifications[territoryCard.id];
  }

  for (const playerId of affectedPlayers) {
    const player = s.players[playerId];
    if (Object.values(s.territories).some((candidate) => candidate.controller === player.id && candidate.troops > 0)) continue;
    player.knockedOut = true;
    for (const cardId of player.hand) {
      if (card(cardId)?.kind === "territory") s.sideboard.discard.push(cardId);
      else s.sideboard.coinDiscard.push(cardId);
    }
    player.hand = [];
    emit(s, "NuclearKnockout", player.id, { discardedResources: true });
  }
  s.combat = undefined;
  emit(s, "NuclearOpeningResolved", undefined, {
    territory: combat.to, removed, fallout: true, cardId: territoryCard?.id,
    attackingTroops, adjacentLosses,
  });
}

function resumeAfterContent(s: GameState) {
  if (s.contentRequired.length > 0 || !s.contentPause) return;
  const pause = s.contentPause;
  s.contentPause = undefined;
  if (pause.resume === "nuclear_resolution") {
    resolveNuclearOpening(s);
    return;
  }
  if (pause.resume === "failed_join_elimination") {
    if (pause.playerId && queueComebackChoice(s, pause.playerId, "advance_turn")) return;
    checkVictory(s);
    if (s.phase !== "game_over") advanceTurn(s);
  }
}

const SOURCED_COMEBACK_POWERS: LegacyCard[] = [
  { id: "pack2:power:resourceful", sourceModuleId: "pack_2_comeback_mercenaries", title: "Resourceful", text: "Earn a Resource draw after expanding into a city." },
  { id: "pack2:power:stealthy", sourceModuleId: "pack_2_comeback_mercenaries", title: "Stealthy", text: "Recruit into one unmarked, unoccupied territory without expanding." },
  { id: "pack2:power:well-armed", sourceModuleId: "pack_2_comeback_mercenaries", title: "Well-Armed", text: "Add one to attack dice against an HQ." },
  { id: "pack2:power:mobile", sourceModuleId: "pack_2_comeback_mercenaries", title: "Mobile", text: "Move one controlled HQ to an adjacent controlled territory at start of turn." },
  { id: "pack2:power:convincing", sourceModuleId: "pack_2_comeback_mercenaries", title: "Convincing", text: "Gain one additional troop from controlled Mercenary territories." },
  { id: "pack2:power:well-supplied", sourceModuleId: "pack_2_comeback_mercenaries", title: "Well-Supplied", text: "Ignore Ammo Shortage while defending." },
];

const MISSILE_POWER_IDS = ["recon", "bad_intel", "rally", "emp", "interference"] as const;
const WEAKNESS_BY_SCAR: Record<string, string> = {
  weakness_cautious: "cautious",
  weakness_purist: "purist",
  weakness_short_sighted: "short_sighted",
  weakness_city_shy: "city_shy",
  weakness_primitive: "primitive",
};

function maybeOpenMissilePowerChoice(s: GameState, playerId: PlayerId) {
  if (!s.unlockedModules.includes("pocket_1_nuclear_war_mutants") || s.missilePowerChoice) return;
  const factionId = s.players[playerId]?.factionId;
  if (!factionId || s.factionMissilePowers[factionId]) return;
  s.missilePowerChoice = { playerId, factionId, options: [...MISSILE_POWER_IDS] };
  emit(s, "MissilePowerChoiceOpened", playerId, { factionId, options: [...MISSILE_POWER_IDS] });
}

function missilePowerPlayer(s: GameState, playerId: PlayerId, powerId: string) {
  const player = s.players[playerId];
  if (!player?.factionId || s.factionMissilePowers[player.factionId] !== powerId) {
    throw new RuleViolation(`This faction does not have ${powerId.replace("_", " ")}`);
  }
  if (player.missiles < 1) throw new RuleViolation("No missiles");
  if (s.missilePowersUsedThisTurn.includes(playerId)) throw new RuleViolation("A Missile Power may be used only once per turn");
  return player;
}

function spendMissilePower(s: GameState, playerId: PlayerId, powerId: string, data: Record<string, unknown> = {}) {
  const player = missilePowerPlayer(s, playerId, powerId);
  player.missiles--;
  s.missilePowersUsedThisTurn.push(playerId);
  emit(s, "MissilePowerUsed", playerId, { powerId, ...data });
}

function comebackOptions(s: GameState) {
  const supplied = legacyCardsFromContent(
    s.hostContent["pack_2_comeback_mercenaries.powers"],
    "pack_2_comeback_mercenaries",
    "power",
  );
  return supplied.length > 0 ? supplied : structuredClone(SOURCED_COMEBACK_POWERS);
}

function openNextComebackChoice(s: GameState): boolean {
  while (s.comebackQueue.length > 0) {
    const pending = s.comebackQueue.shift()!;
    if (s.comebackPowers[pending.factionId]) continue;
    const options = comebackOptions(s);
    if (options.length === 0) {
      emit(s, "ComebackPowerChoiceUnavailable", pending.playerId, { factionId: pending.factionId });
      continue;
    }
    s.comebackChoice = { ...pending, options };
    emit(s, "ComebackPowerChoiceOpened", pending.playerId, {
      factionId: pending.factionId,
      options: options.map((option) => ({ id: option.id, title: option.title })),
    });
    return true;
  }
  return false;
}

function queueComebackChoice(s: GameState, playerId: PlayerId, resume: "advance_turn" | "game_over"): boolean {
  const factionId = s.players[playerId]?.factionId;
  if (!factionId || s.comebackPowers[factionId]) return false;
  if (s.comebackChoice?.factionId === factionId || s.comebackQueue.some((choice) => choice.factionId === factionId)) return true;
  s.comebackQueue.push({ playerId, factionId, resume });
  return openNextComebackChoice(s);
}

function queueEndGameComebackChoices(s: GameState) {
  for (const player of Object.values(s.players)) {
    if (player.factionId && s.results?.[player.factionId] === "eliminated") {
      queueComebackChoice(s, player.id, "game_over");
    }
  }
}

// ---------- Scar effects ----------

const scarById = (id: string) => contentPack.scars.find((x) => x.id === id);

/** A scar card is available when it's starter-playable or its source module has been revealed. */
function scarAvailable(unlockedModules: string[], def: any): boolean {
  if (def?.starterPlayable) return true;
  const mod = contentPack.unlockModules.find((m) => (m as any).scarSource === def?.source);
  return !!mod && unlockedModules.includes(mod.id);
}

/**
 * Confirmed modifyCombatDie scar deltas against the defending territory's natural dice.
 * Missiles set an unmodifiable 6 — flagged dice are never scar-modified. "Highest die"
 * is index 0 of the natural roll (sorted desc). Fortification lives in its own
 * territory field (not scars[]) and applies to each defense die while durability remains.
 */
function defenseScarModifiers(s: GameState, c: PendingCombat): { scarId: string; dieIndex: number; delta: number }[] {
  if (s.empTerritories.includes(c.to)) return [];
  const t = s.territories[c.to];
  const defCount = c.natural!.def.length;
  const mods: { scarId: string; dieIndex: number; delta: number }[] = [];
  const tryAdd = (scarId: string, dieIndex: number, delta: number) => {
    if (!c.unmodifiable.def[dieIndex]) mods.push({ scarId, dieIndex, delta });
  };
  const deltaOf = (eff: any) => (eff.op === "sub" ? -1 : 1) * (eff.amount ?? 0);
  for (const scarId of t.scars) {
    if (scarId === "ammo_shortage" && hasPower(s, c.defender, "well_supplied")) continue;
    const def = scarById(scarId);
    if (!def || def.verification !== "confirmed" || def.handler !== "modifyCombatDie") continue; // only confirmed effects
    const eff = (def as any).effect ?? {};
    if (eff.side !== "def") continue;
    if (eff.applyTo === "highest_die") tryAdd(scarId, 0, deltaOf(eff));
    else if (eff.applyTo === "each_die") for (let i = 0; i < defCount; i++) tryAdd(scarId, i, deltaOf(eff));
  }
  if (t.fortification && t.fortification.remaining > 0) {
    const eff = (scarById("fortification") as any)?.effect ?? {};
    for (let i = 0; i < defCount; i++) tryAdd("fortification", i, deltaOf(eff));
  }
  return mods;
}

/** Confirmed onEndTurn scar attrition (Biohazard) for the player whose turn is ending. */
function applyEndOfTurnScars(s: GameState, pid: PlayerId) {
  for (const [tid, t] of Object.entries(s.territories)) {
    if (t.controller !== pid || t.troops <= 0) continue;
    const mutants = s.players[pid].factionId === "mutants";
    for (const scarId of t.scars) {
      if (scarId === "fallout") {
        const delta = mutants ? 1 : -1;
        t.troops = Math.max(0, t.troops + delta);
        if (t.troops === 0) t.controller = undefined;
        emit(s, mutants ? "ScarReinforcement" : "ScarAttrition", pid, { scarId, territory: tid, remaining: t.troops });
        continue;
      }
      const def = scarById(scarId);
      if (!def || def.verification !== "confirmed" || def.handler !== "onEndTurn") continue;
      const eff = (def as any).effect ?? {};
      if (eff.trigger !== "controller_end_turn") continue;
      if (eff.op === "remove_troops") { // Biohazard
        const amount = mutants && scarId === "biohazard" ? -(eff.amount ?? 0) : (eff.amount ?? 0);
        t.troops = Math.max(0, t.troops - amount);
        const vacated = t.troops === 0;
        if (vacated) t.controller = undefined; // last troop lost -> territory abandoned
        emit(s, "ScarAttrition", pid, { scarId, territory: tid, remaining: t.troops, vacated });
      } else if (eff.op === "add_troops") { // Mercenary — +1 if still controlled
        if (mutants && scarId === "mercenary") {
          t.troops = Math.max(0, t.troops - (eff.amount ?? 0));
          if (t.troops === 0) t.controller = undefined;
          emit(s, "ScarAttrition", pid, { scarId, territory: tid, remaining: t.troops, reversedForMutants: true });
          continue;
        }
        const convincingBonus = scarId === "mercenary" && hasPower(s, pid, "convincing") ? 1 : 0;
        t.troops += (eff.amount ?? 0) + convincingBonus;
        emit(s, "ScarReinforcement", pid, { scarId, territory: tid, troops: t.troops });
        if (convincingBonus) emit(s, "FactionPowerApplied", pid, { powerId: "convincing", territory: tid, bonus: convincingBonus });
      }
    }
  }
}

function ensureEndTurnScars(s: GameState, pid: PlayerId) {
  if (s.endTurnScarsApplied) return;
  applyEndOfTurnScars(s, pid);
  s.endTurnScarsApplied = true;
}

// ---------- Combat helpers ----------

function legalModifierActors(s: GameState, c: PendingCombat): PlayerId[] {
  if (s.empTerritories.includes(c.to)) return [];
  // Any player may affect any die. Priority is attacker, then defender, then the
  // remaining players clockwise from the attacker (official timing order).
  const attackerIdx = s.turnOrder.indexOf(c.attacker);
  const clockwise = attackerIdx < 0
    ? [...s.turnOrder]
    : [...s.turnOrder.slice(attackerIdx + 1), ...s.turnOrder.slice(0, attackerIdx)];
  const priority = [c.attacker, c.defender, ...clockwise.filter((pid) => pid !== c.defender)];
  return priority.filter((pid, index) => priority.indexOf(pid) === index
    && !s.players[pid].eliminated
    && s.players[pid].missiles > 0
    && !c.window?.passed.includes(pid));
}

/** modifyCombatDie faction powers against the defense dice (SPEC §6). Missile-set dice stay untouched. */
function powerDefenseModifiers(s: GameState, c: PendingCombat): { powerId: string; playerId: PlayerId; side: "att" | "def"; dieIndex: number; delta: number }[] {
  if (s.empTerritories.includes(c.to)) return [];
  const t = s.territories[c.to];
  const defCount = c.natural!.def.length;
  const mods: { powerId: string; playerId: PlayerId; side: "att" | "def"; dieIndex: number; delta: number }[] = [];
  // fortified_hq: Die Mechaniker defending the territory holding its own HQ — +1 each defense die,
  // no durability, no expand surcharge; does NOT stack with an active Fortification mark.
  if (hasPower(s, c.defender, "fortified_hq") && t.hqFaction === s.players[c.defender].factionId
      && !(t.fortification && t.fortification.remaining > 0)) {
    for (let i = 0; i < defCount; i++) {
      if (!c.unmodifiable.def[i]) mods.push({ powerId: "fortified_hq", playerId: c.defender, side: "def", dieIndex: i, delta: 1 });
    }
  }
  // lower_die_intimidation: Enclave attacking its first target of the turn — defender's LOWER die -1.
  if (hasPower(s, c.attacker, "lower_die_intimidation") && s.intimidation
      && !s.intimidation.broken && s.intimidation.territory === c.to) {
    const i = defCount - 1; // natural sorted desc -> last index is the lower die
    if (!c.unmodifiable.def[i]) mods.push({ powerId: "lower_die_intimidation", playerId: c.attacker, side: "def", dieIndex: i, delta: -1 });
  }
  if (hasPower(s, c.attacker, "well_armed") && t.hqFaction) {
    for (let i = 0; i < c.natural!.att.length; i++) {
      if (!c.unmodifiable.att[i]) mods.push({ powerId: "well_armed", playerId: c.attacker, side: "att", dieIndex: i, delta: 1 });
    }
  }
  return mods;
}

function finalDice(s: GameState, c: PendingCombat): { att: number[]; def: number[]; scarModifiers: { scarId: string; dieIndex: number; delta: number }[]; powerModifiers: { powerId: string; playerId: PlayerId; side: "att" | "def"; dieIndex: number; delta: number }[] } { // takes state for territory scars + powers
  const att = [...c.natural!.att];
  const def = [...c.natural!.def];
  for (const m of c.modifiers) {
    if (m.side === "att") att[m.dieIndex] = 6;
    else def[m.dieIndex] = 6;
  }
  const scarModifiers = defenseScarModifiers(s, c);
  for (const m of scarModifiers) def[m.dieIndex] = Math.max(1, Math.min(6, def[m.dieIndex] + m.delta)); // clamp 1..6 (D1)
  const powerModifiers = powerDefenseModifiers(s, c);
  for (const m of powerModifiers) {
    const dice = m.side === "att" ? att : def;
    dice[m.dieIndex] = Math.max(1, Math.min(6, dice[m.dieIndex] + m.delta));
  }
  return { att, def, scarModifiers, powerModifiers };
}

function resolveCombat(s: GameState) {
  const c = s.combat!;
  const { att, def, scarModifiers, powerModifiers } = finalDice(s, c);
  for (const m of powerModifiers) emit(s, "FactionPowerApplied", m.playerId, { powerId: m.powerId, territory: c.to, dieIndex: m.dieIndex, delta: m.delta });
  const sortIdx = (arr: number[]) => arr.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
  const A = sortIdx(att);
  const D = sortIdx(def);
  const pairs = Math.min(A.length, D.length);
  let attLoss = 0, defLoss = 0;
  const comparisons: { att: number; def: number; winner: "att" | "def" }[] = [];
  for (let i = 0; i < pairs; i++) {
    const mutantTie = s.players[c.attacker].factionId === "mutants" && s.mutantEvolution === "unnatural_strength"
      && A[i].v === 6 && D[i].v === 6;
    const winner = A[i].v > D[i].v || mutantTie ? "att" : "def"; // defender wins ties except Unnatural Strength 6s
    if (winner === "att") defLoss++; else attLoss++;
    comparisons.push({ att: A[i].v, def: D[i].v, winner });
  }
  const from = s.territories[c.from];
  const to = s.territories[c.to];
  const nat = c.natural!;
  // total_conquest: natural three-of-a-kind attack + final combat kills >=1 defender -> ALL defenders die.
  if (defLoss >= 1 && defLoss < to.troops && hasPower(s, c.attacker, "total_conquest")
      && nat.att.length === 3 && nat.att[0] === nat.att[2]) { // sorted desc, so first==last means three of a kind
    emit(s, "FactionPowerApplied", c.attacker, { powerId: "total_conquest", territory: c.to, defendersRemoved: to.troops - defLoss });
    defLoss = to.troops;
  }
  // defensive_stand: natural double-6 defense locks the territory for the rest of the active turn.
  if (hasPower(s, c.defender, "defensive_stand") && nat.def.length === 2 && nat.def[0] === 6 && nat.def[1] === 6
      && !s.blockedAttackTargets.includes(c.to)) {
    s.blockedAttackTargets.push(c.to);
    emit(s, "FactionPowerApplied", c.defender, { powerId: "defensive_stand", territory: c.to });
  }
  from.troops -= attLoss;
  to.troops -= defLoss;
  emit(s, "CombatResolved", c.attacker, {
    from: c.from, to: c.to,
    natural: c.natural, final: { att, def }, modifiers: c.modifiers, scarModifiers, powerModifiers,
    comparisons, attackerLosses: attLoss, defenderLosses: defLoss,
  });
  if (s.players[c.defender].factionId === "mutants" && s.mutantEvolution === "defensive_cloning"
      && nat.def.length === 2 && nat.def[0] === nat.def[1] && to.troops > 0) {
    to.troops++;
    emit(s, "MutantEvolutionApplied", c.defender, { evolution: "defensive_cloning", territory: c.to });
  }
  const fortEff = (scarById("fortification") as any)?.effect ?? {};
  if (to.fortification && c.attackerDice === (fortEff.markDurabilityWhenAttackersEquals ?? 3)) { // mark 1 box per 3-attacker roll
    to.fortification.remaining--;
    emit(s, "FortificationDurabilityMarked", c.attacker, { territory: c.to, remaining: to.fortification.remaining });
    if (to.fortification.remaining <= 0) {
      to.fortification = undefined; // 10 boxes marked -> no longer fortified
      emit(s, "FortificationExpired", undefined, { territory: c.to });
    }
  }
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
  if (to.scars.includes("fallout") && s.players[c.attacker].factionId !== "mutants") {
    const falloutLosses = Math.ceil(to.troops / 2);
    to.troops -= falloutLosses;
    emit(s, "FalloutLosses", c.attacker, { territory: c.to, losses: falloutLosses });
  }
  to.controller = to.troops > 0 ? c.attacker : undefined;
  const attacker = s.players[c.attacker];
  attacker.conqueredEnemyThisTurn = true;
  emit(s, "TerritoryConquered", c.attacker, {
    territory: c.to, from: c.from, moved,
    defender: c.defender,
    hqCaptured: to.hqFaction ?? null,
  });
  if (to.hqFaction) {
    emit(s, "RedStarGained", c.attacker, {
      source: "captured_hq",
      territory: c.to,
      hqFaction: to.hqFaction,
    });
  }
  // Knockout: defender has no troops anywhere -> transfer Resource cards (not scars/tokens/missiles)
  const defender = s.players[c.defender];
  const defenderHasTroops = Object.values(s.territories).some((t) => t.controller === c.defender && t.troops > 0);
  if (!defenderHasTroops && !defender.eliminated) {
    defender.knockedOut = true;
    const transferred = defender.hand.length;
    if (transferred >= 3) s.privateMissionProgress.forcedOccupation = true;
    attacker.hand.push(...defender.hand);
    defender.hand = [];
    emit(s, "PlayerKnockedOut", c.defender, { by: c.attacker, resourceCardsTransferred: transferred });
  }
  s.combat = undefined;
  checkVictory(s);
}

function solePopulationLeader(s: GameState): PlayerId | undefined {
  const totals = Object.values(s.players)
    .filter((player) => !player.eliminated)
    .map((player) => ({
      playerId: player.id,
      population: Object.values(s.territories)
        .filter((territory) => territory.controller === player.id)
        .reduce((sum, territory) => sum + (territory.city?.population ?? 0), 0),
    }));
  const max = Math.max(0, ...totals.map((entry) => entry.population));
  const leaders = totals.filter((entry) => entry.population === max);
  return leaders.length === 1 ? leaders[0].playerId : undefined;
}

function alienController(s: GameState): PlayerId | undefined {
  return Object.values(s.players).find((player) => player.factionId === "aliens")?.id
    ?? s.alienAlliancePlayerId;
}

function sourcedMissionSatisfied(s: GameState, playerId: PlayerId, mission: LegacyCard): boolean {
  if (mission.id.startsWith("pack_4_lead_faction_private_missions:privateMission:")) {
    const suffix = mission.id.split(":").at(-1);
    if (suffix === "wide-border") return s.privateMissionProgress.wideBorderAtStart;
    if (suffix === "forced-occupation") return s.privateMissionProgress.forcedOccupation;
    if (suffix === "guerilla-warfare") {
      const targets = Object.values(s.territories).filter((territory) =>
        territory.scars.some((scar) => scar === "bunker" || scar === "mercenary"));
      return targets.length > 0 && targets.every((territory) => territory.controller === playerId);
    }
    if (suffix === "advanced-training") return s.privateMissionProgress.tradedResources >= 10;
    if (suffix === "urban-troop-surge") {
      const worldCapital = Object.values(s.territories).some((territory) =>
        territory.city?.type === "world_capital" && territory.controller === playerId);
      const majorCities = Object.values(s.territories).filter((territory) =>
        territory.city?.type === "major" && territory.controller === playerId).length;
      return worldCapital && majorCities >= 3;
    }
    if (suffix === "advanced-tactics") return s.privateMissionProgress.highValueTerritoryCards >= 2;
    return true;
  }
  if (!mission.id.startsWith("pack_3_homelands_missions:mission:")) return true;
  const turnStart = [...s.log].reverse().find((event) => event.type === "TurnStarted" && event.playerId === playerId)?.seq ?? 0;
  const conquests = s.log.filter((event) => event.seq > turnStart && event.type === "TerritoryConquered" && event.playerId === playerId)
    .map((event) => ({ territory: String(event.data?.territory), from: String(event.data?.from) }));
  const conquered = new Set(conquests.map((entry) => entry.territory));
  const suffix = mission.id.split(":").at(-1);
  if (suffix === "imperial-might") return recruitBreakdown(s, playerId).continents.reduce((sum, continent) => sum + continent.total, 0) >= 7;
  if (suffix === "unexpected-attack") return manifest.continents.some((continent) => manifest.territories
    .filter((territory) => territory.continent === continent.id).every((territory) => conquered.has(territory.id)));
  if (suffix === "amphibious-onslaught") {
    const seaLines = new Set(visualConnections.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));
    return conquests.filter((entry) => seaLines.has(`${entry.from}|${entry.territory}`)
      || s.customConnections.some(([a, b]) => (a === entry.from && b === entry.territory) || (b === entry.from && a === entry.territory))
      || s.alienIsland?.territoryId === entry.from || s.alienIsland?.territoryId === entry.territory).length >= 4;
  }
  if (suffix === "urban-assault") return [...conquered].filter((territoryId) => !!s.territories[territoryId]?.city).length >= 4;
  if (suffix === "reign-of-terror") return conquered.size >= 9;
  if (suffix === "superior-infrastructure") return Object.values(s.territories).filter((territory) => territory.controller === playerId && territory.city).length >= 6;
  if (suffix === "explore-the-world") {
    const islands = ["greenland", "iceland", "great_britain", "madagascar", "japan", "indonesia", "new_guinea", "western_australia", "eastern_australia", ALIEN_ISLAND_ID];
    return islands.filter((territoryId) => s.territories[territoryId]?.controller === playerId).length >= 7;
  }
  if (suffix === "the-world-is-ready") return false; // completed through mission.foundWorldCapital
  return true;
}

function resolveSourcedEvent(s: GameState, event: LegacyCard, resolution: Extract<Action, { type: "event.resolve" }>["resolution"], destination: "box" | "discard" | "ongoing") {
  const id = event.id;
  const leader = solePopulationLeader(s);
  const requireKind = <K extends NonNullable<typeof resolution>["kind"]>(kind: K) => {
    if (!resolution || resolution.kind !== kind) throw new RuleViolation(`${event.title} needs a ${kind} resolution`);
    return resolution as Extract<NonNullable<typeof resolution>, { kind: K }>;
  };
  const requireLeader = () => {
    if (!leader) return undefined;
    return s.players[leader];
  };

  if (id.includes(":fortify-")) {
    const populationLeader = requireLeader();
    if (!populationLeader) return;
    if (resolution?.kind === "fortify") {
      const territory = s.territories[resolution.territoryId];
      if (destination !== "box") throw new RuleViolation("Fortify is removed from the game when a Fortification mark is used");
      if (!territory?.city || territory.controller !== populationLeader.id) throw new RuleViolation("Fortify must target the population leader's city");
      if (s.inventories.fortifyMarks < 1) throw new RuleViolation("No Fortification marks remain");
      const durability = (scarById("fortification") as any)?.durability ?? 10;
      territory.fortification = { max: durability, remaining: durability };
      s.inventories.fortifyMarks--;
      emit(s, "EventEffectApplied", populationLeader.id, { eventId: event.id, kind: resolution.kind, territory: resolution.territoryId });
      return;
    }
    const choice = requireKind("reinforceCities");
    if (destination !== "discard") throw new RuleViolation("Fortify is discarded after reinforcing cities");
    if (choice.placements.length < 1 || choice.placements.length > 2
        || choice.placements.some((placement) => placement.count !== 2)) throw new RuleViolation("Choose one or two cities and add exactly two troops to each");
    for (const placement of choice.placements) {
      const territory = s.territories[placement.territoryId];
      if (!territory?.city || territory.controller !== populationLeader.id) throw new RuleViolation("Reinforcement must target a city the population leader controls");
      territory.troops += 2;
    }
    emit(s, "EventEffectApplied", populationLeader.id, { eventId: event.id, kind: choice.kind, territories: choice.placements.map((placement) => placement.territoryId) });
    return;
  }

  if (id.includes(":control-the-people-")) {
    const populationLeader = requireLeader();
    if (!populationLeader) return;
    if (resolution?.kind === "controlPeopleTroops") {
      const territory = s.territories[resolution.territoryId];
      if (!territory?.city || territory.controller !== populationLeader.id) throw new RuleViolation("Choose a city the population leader controls");
      territory.troops += 5;
    } else {
      const choice = requireKind("controlPeopleManeuver");
      const from = s.territories[choice.from];
      const to = s.territories[choice.to];
      if (from?.controller !== populationLeader.id || to?.controller !== populationLeader.id || !connected(s, populationLeader.id, choice.from, choice.to)) {
        throw new RuleViolation("The immediate maneuver must follow a controlled connection");
      }
      if (choice.count < 1 || choice.count >= from.troops) throw new RuleViolation("Leave at least one troop behind");
      from.troops -= choice.count;
      to.troops += choice.count;
    }
    emit(s, "EventEffectApplied", populationLeader.id, { eventId: event.id, kind: resolution!.kind });
    return;
  }

  if (id.endsWith(":riots")) {
    requireKind("riots");
    for (const [territoryId, territory] of Object.entries(s.territories)) {
      if (territory.city?.type !== "major" || !territory.controller) continue;
      const natural = rollDie(s);
      const modified = natural + territory.troops + (territory.hqFaction ? 1 : 0);
      if (modified < 6) {
        territory.troops = Math.max(0, territory.troops - natural);
        territory.hqFaction = undefined;
        if (territory.troops === 0) territory.controller = undefined;
      }
      emit(s, "RiotTested", territory.controller, { territory: territoryId, natural, modified, passed: modified >= 6 });
    }
    return;
  }

  if (id.includes(":resistance-")) {
    requireKind("resistance");
    for (const territory of Object.values(s.territories)) {
      if (territory.city?.type !== "minor" || territory.troops < 1 || territory.troops > 2) continue;
      territory.troops--;
      if (territory.troops === 0) territory.controller = undefined;
    }
    return;
  }

  if (id.includes(":join-the-cause-")) {
    const populationLeader = requireLeader();
    if (!populationLeader) return;
    if (resolution?.kind === "joinCauseTroops") {
      if (resolution.placements.reduce((sum, placement) => sum + placement.count, 0) !== 3) throw new RuleViolation("Join the Cause places exactly three troops");
      for (const placement of resolution.placements) {
        const territory = s.territories[placement.territoryId];
        if (placement.count < 1 || !territory?.city || territory.controller !== populationLeader.id) throw new RuleViolation("Join the Cause targets controlled cities");
        territory.troops += placement.count;
      }
    } else {
      const choice = requireKind("joinCauseMission");
      const index = s.legacyCards.missionDeck.findIndex((mission) => mission.id === choice.missionId);
      if (index < 0) throw new RuleViolation("Choose a Mission still in the deck");
      if (s.legacyCards.activeMission) s.legacyCards.missionDeck.push(s.legacyCards.activeMission);
      s.legacyCards.activeMission = s.legacyCards.missionDeck.splice(index, 1)[0];
      s.legacyCards.missionDeck = shuffled(s, s.legacyCards.missionDeck);
    }
    emit(s, "EventEffectApplied", populationLeader.id, { eventId: event.id, kind: resolution!.kind });
    return;
  }

  if (id.includes(":fallout-")) {
    requireKind("fallout");
    if (destination !== "box") throw new RuleViolation("Fallout Events are removed from the game");
    const fallout = Object.entries(s.territories).find(([, territory]) => territory.scars.includes("fallout"))?.[0];
    if (!fallout) return;
    const seaLines = new Set(visualConnections.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));
    for (const neighbor of neighborsOf(s, fallout)) {
      if (seaLines.has(`${fallout}|${neighbor}`)) continue;
      const territory = s.territories[neighbor];
      const controller = territory.controller ? s.players[territory.controller] : undefined;
      if (controller?.factionId === "mutants") continue;
      const losses = rollDie(s);
      territory.troops = Math.max(0, territory.troops - losses);
      if (territory.troops === 0) territory.controller = undefined;
      emit(s, "FalloutEventLosses", controller?.id, { territory: neighbor, losses });
    }
    return;
  }

  if (id.includes(":agent-of-chaos-")) {
    if (destination !== "discard") throw new RuleViolation("Agent of Chaos is discarded after resolution");
    requireKind("agentOfChaos");
    const humanHasBonus = Object.values(s.players).some((player) => player.factionId !== "mutants" && player.factionId !== "aliens"
      && manifest.continents.some((continent) => manifest.territories.filter((territory) => territory.continent === continent.id)
        .every((territory) => s.territories[territory.id].controller === player.id)));
    const mutant = Object.values(s.players).find((player) => player.factionId === "mutants");
    if (!humanHasBonus && mutant) {
      mutant.redStarTokens++;
      maybeOpenMissilePowerChoice(s, mutant.id);
      emit(s, "EventRedStarGained", mutant.id, { eventId: event.id });
      checkVictory(s);
    }
    return;
  }

  if (id.includes(":mutants-evolve-")) {
    const choice = requireKind("mutantsEvolve").choice;
    if (destination !== "box") throw new RuleViolation("Mutants Evolve Events are kept in the box");
    const mutant = Object.values(s.players).find((player) => player.factionId === "mutants");
    if (!mutant) return;
    if (s.mutantEvolutionChoices.length === 0 && choice !== "offensive" && choice !== "defensive") throw new RuleViolation("First choose offensive or defensive evolution");
    if (s.mutantEvolutionChoices.length === 1 && choice !== "bodies" && choice !== "brains") throw new RuleViolation("Then choose bodies or brains");
    if (s.mutantEvolutionChoices.length >= 2) throw new RuleViolation("The Mutants already completed both evolution choices");
    s.mutantEvolutionChoices.push(choice);
    if (s.mutantEvolutionChoices.length === 2) {
      const [axis, form] = s.mutantEvolutionChoices;
      s.mutantEvolution = axis === "offensive"
        ? form === "bodies" ? "unnatural_strength" : "mindshackle"
        : form === "bodies" ? "defensive_cloning" : "mass_hypnosis";
      emit(s, "MutantsEvolved", mutant.id, { evolution: s.mutantEvolution });
    }
    return;
  }

  if (id.includes(":ruins-")) {
    const alienPlayerId = alienController(s);
    const validTargets = Object.values(s.territories).some((territory) => territory.city?.type === "minor");
    if (!alienPlayerId || !validTargets) {
      if (resolution) throw new RuleViolation("Die Humans has no legal city to ruin");
      if (destination !== "discard") throw new RuleViolation("Die Humans is discarded when no city is ruined");
      return;
    }
    const choice = requireKind("alienRuins");
    const territory = s.territories[choice.territoryId];
    if (territory?.city?.type !== "minor") throw new RuleViolation("Die Humans replaces a Minor City");
    if (destination !== "box") throw new RuleViolation("Die Humans is destroyed when a city is ruined");
    territory.city = undefined;
    territory.ruin = true;
    territory.troops = 0;
    territory.controller = undefined;
    territory.hqFaction = undefined;
    emit(s, "AlienRuinsPlaced", alienPlayerId, { territory: choice.territoryId });
    return;
  }

  if (id.includes(":reinforcements-")) {
    if (destination !== "discard") throw new RuleViolation("Beam Down is discarded after resolution");
    const alienPlayerId = alienController(s);
    const validTargets = Object.values(s.territories).some((territory) => !!territory.city && territory.troops === 0 && !territory.controller);
    if (!alienPlayerId || !validTargets) {
      if (resolution) throw new RuleViolation("Beam Down has no legal city");
      return;
    }
    const choice = requireKind("alienReinforcements");
    const territory = s.territories[choice.territoryId];
    if (!territory?.city || territory.troops > 0 || territory.controller) throw new RuleViolation("Beam Down targets an unoccupied city");
    territory.controller = alienPlayerId;
    territory.troops = 5;
    emit(s, "AlienReinforcementsPlaced", alienPlayerId, { territory: choice.territoryId, troops: 5 });
    return;
  }

  if (id.includes(":mysterious-island-")) {
    if (destination !== "discard") throw new RuleViolation("Mysterious Island is discarded after resolution");
    const controller = s.alienIsland ? s.territories[s.alienIsland.territoryId]?.controller : undefined;
    if (!controller || s.sideboard.slots.every((cardId) => !cardId)) {
      if (resolution) throw new RuleViolation("Mysterious Island has no legal card to take");
      return;
    }
    const choice = requireKind("alienIslandCard");
    const cardId = s.sideboard.slots[choice.slot];
    if (choice.slot < 0 || choice.slot > 3 || !cardId) throw new RuleViolation("Choose a face-up Territory card");
    s.sideboard.slots[choice.slot] = null;
    s.players[controller].hand.push(cardId);
    advanceFaceUpCards(s, choice.slot);
    emit(s, "EventResourceCardTaken", controller, { eventId: event.id, slot: choice.slot });
  }
}

// ---------- Public API ----------

function completeAdvancedDraft(s: GameState) {
  const draft = s.advancedDraft!;
  for (const playerId of Object.keys(s.players)) {
    const result = draft.picks[playerId];
    if (!result.factionId || result.turnOrder === undefined || result.placementOrder === undefined
        || result.startingTroops === undefined || result.startingCoinCards === undefined) {
      throw new RuleViolation("Advanced draft ended with an incomplete player card set");
    }
    s.players[playerId].startingTroops = result.startingTroops;
    // Compatibility for sessions created before explicit Coin-card claims existed.
    if (!draft.explicitCoinClaims) {
      for (let index = 0; index < result.startingCoinCards; index++) {
        const coin = s.sideboard.coinPile.shift();
        if (!coin) throw new RuleViolation("Not enough Coin cards for advanced draft setup");
        s.players[playerId].hand.push(coin);
      }
    }
  }
  s.turnOrder = Object.keys(s.players).sort((a, b) => draft.picks[a].turnOrder! - draft.picks[b].turnOrder!);
  s.setup!.chooserOrder = Object.keys(s.players).sort((a, b) => draft.picks[a].placementOrder! - draft.picks[b].placementOrder!);
  s.setup!.nextIdx = 0;
  s.setup!.stage = "starting_placement";
  s.activeIdx = 0;
  draft.completed = true;
  emit(s, "AdvancedDraftCompleted", undefined, { turnOrder: s.turnOrder, placementOrder: s.setup!.chooserOrder });
  emit(s, "SetupStageChanged", undefined, { stage: "starting_placement" });
}

function advanceAdvancedDraft(s: GameState) {
  const draft = s.advancedDraft!;
  draft.nextPickIdx++;
  if (draft.nextPickIdx >= draft.pickOrder.length) completeAdvancedDraft(s);
}

export function applyAction(prev: GameState, action: Action): GameState {
  // Runtime clients can bypass TypeScript; validate before arithmetic coerces values.
  if (!action || typeof action !== "object" || typeof action.type !== "string") {
    throw new RuleViolation("Invalid action");
  }
  switch (action.type) {
    case "recruit.place":
    case "attack.chooseAttackers":
    case "attack.defenderDice":
    case "attack.moveIn":
    case "maneuver.move":
      if (!Number.isSafeInteger(action.count) || action.count < 1) throw new RuleViolation("Invalid troop or dice count");
      break;
    case "attack.expand":
      if (!Number.isSafeInteger(action.troops) || action.troops < 1) throw new RuleViolation("Invalid troop count");
      break;
    case "combat.useMissile":
      if (!Number.isSafeInteger(action.dieIndex) || action.dieIndex < 0) throw new RuleViolation("Invalid die index");
      break;
  }
  const s: GameState = structuredClone(prev);
  s.expandedIntoCityThisTurn ??= false;
  s.mobileHqUsed ??= false;
  s.contentRequired ??= [];
  s.hostContent ??= {};
  s.legacyCards ??= {
    eventDeck: [], eventDiscard: [], eventBox: [], ongoingEvents: [],
    missionDeck: [], missionBox: [], privateMissionPool: [],
  };
  s.legacyCards.privateMissionPool ??= [];
  s.comebackPowers ??= {};
  s.comebackQueue ??= [];
  s.capturedPrivateMissions ??= {};
  s.privateMissionsUsed ??= [];
  s.privateMissionProgress ??= {
    tradedResources: 0,
    highValueTerritoryCards: 0,
    forcedOccupation: false,
    wideBorderAtStart: false,
  };
  s.factionMissilePowers ??= {};
  s.factionWeaknesses ??= {};
  s.mutantEvolutionChoices ??= [];
  s.missilePowersUsedThisTurn ??= [];
  s.empTerritories ??= [];
  s.badIntelDeniedContinents ??= [];
  s.blockedResourceDraws ??= [];
  s.customConnections ??= [];

  if (action.type === "module.supplyContent") {
    const entry = s.contentRequired.find((candidate) => candidate.moduleId === action.moduleId);
    if (!entry || !entry.items.includes(action.item)) {
      throw new RuleViolation(`No pending content requirement '${action.item}' for module '${action.moduleId}'`);
    }
    if (action.content === undefined || action.content === null || (typeof action.content === "string" && !action.content.trim())) {
      throw new RuleViolation("Module content cannot be empty");
    }
    s.hostContent[`${action.moduleId}.${action.item}`] = structuredClone(action.content);
    mergeSuppliedLegacyCards(s, action.moduleId, action.item, action.content);
    entry.items = entry.items.filter((item) => item !== action.item);
    if (entry.items.length === 0) s.contentRequired = s.contentRequired.filter((candidate) => candidate !== entry);
    emit(s, "ModuleContentSupplied", action.playerId, { moduleId: action.moduleId, item: action.item });
    if (action.moduleId === "pack_2_comeback_mercenaries"
        && !s.contentRequired.some((candidate) => candidate.moduleId === action.moduleId)
        && s.phase === "game_over") {
      queueEndGameComebackChoices(s);
    }
    resumeAfterContent(s);
    return s;
  }

  if (s.contentRequired.length > 0) {
    const pending = s.contentRequired[0];
    throw new RuleViolation(`Sealed content required for ${pending.moduleId}: ${pending.items.join(", ")}`);
  }

  if (action.type === "event.resolve") {
    const event = s.legacyCards.pendingEvent;
    if (!event) throw new RuleViolation("No Event card is awaiting resolution");
    const beforeResolution = s.eventSeq;
    if (Object.values(SOURCED_EVENTS).some((cards) => cards.some((card) => card.id === event.id))) {
      resolveSourcedEvent(s, event, action.resolution, action.destination);
    }
    if (action.destination === "box") s.legacyCards.eventBox.push(event);
    else if (action.destination === "discard") s.legacyCards.eventDiscard.push(event);
    else s.legacyCards.ongoingEvents.push(event);
    s.legacyCards.pendingEvent = undefined;
    emit(s, "EventCardResolved", action.playerId, {
      eventId: event.id,
      destination: action.destination,
      ...(action.note?.trim() ? { note: action.note.trim() } : {}),
    });
    const mysteriousIslandCardTaken = s.log.some((entry) => entry.seq > beforeResolution
      && entry.type === "EventResourceCardTaken" && entry.data?.eventId === event.id);
    if (mysteriousIslandCardTaken && triggerEventForSlotOne(s)) return s;
    if (s.phase !== "game_over") advanceTurn(s);
    return s;
  }

  if (s.legacyCards.pendingEvent) {
    throw new RuleViolation("Resolve the current Event card before continuing");
  }

  if (s.missionChoice && !s.comebackChoice && !s.missilePowerChoice && action.type !== "mission.choose") {
    throw new RuleViolation(`${s.players[s.missionChoice.playerId]?.name ?? "The Lead Faction"} must choose the Mission`);
  }

  if (action.type === "mission.choose") {
    if (s.comebackChoice || s.missilePowerChoice) throw new RuleViolation("Resolve the pending faction-power choice first");
    const choice = s.missionChoice;
    if (!choice) throw new RuleViolation("No Lead Faction Mission choice is open");
    if (choice.playerId !== action.playerId) throw new RuleViolation("Only the Lead Faction may choose the Mission");
    const index = s.legacyCards.missionDeck.findIndex((mission) => mission.id === action.missionId);
    if (index < 0) throw new RuleViolation("Choose a Mission still in the deck");
    s.legacyCards.activeMission = s.legacyCards.missionDeck.splice(index, 1)[0];
    s.legacyCards.missionDeck = shuffled(s, s.legacyCards.missionDeck);
    s.missionChoice = undefined;
    emit(s, "LeadFactionMissionChosen", action.playerId, { missionId: s.legacyCards.activeMission.id, reason: choice.reason });
    if (choice.reason === "world_capital" && s.phase !== "game_over") advanceTurn(s);
    return s;
  }

  if (s.comebackChoice && action.type !== "comeback.choose") {
    throw new RuleViolation(`${s.players[s.comebackChoice.playerId]?.name ?? "The eliminated player"} must choose a comeback power`);
  }

  if (s.missilePowerChoice && action.type !== "missilePower.choose") {
    throw new RuleViolation(`${s.players[s.missilePowerChoice.playerId]?.name ?? "The eligible player"} must choose a Missile Power`);
  }

  if (action.type === "missilePower.choose") {
    const choice = s.missilePowerChoice;
    if (!choice) throw new RuleViolation("No Missile Power choice is open");
    if (choice.playerId !== action.playerId) throw new RuleViolation("Only the eligible player may choose this Missile Power");
    if (!choice.options.includes(action.powerId)) throw new RuleViolation("Unknown Missile Power");
    s.factionMissilePowers[choice.factionId] = action.powerId;
    s.missilePowerChoice = undefined;
    emit(s, "MissilePowerChosen", action.playerId, { factionId: choice.factionId, powerId: action.powerId });
    return s;
  }

  if (action.type === "missilePower.rally") {
    if (s.phase !== "start_turn" || activePlayer(s) !== action.playerId) throw new RuleViolation("Rally activates at the start of your turn");
    const player = missilePowerPlayer(s, action.playerId, "rally");
    const targets = Object.entries(s.territories).filter(([, territory]) => territory.controller === player.id && territory.hqFaction);
    spendMissilePower(s, player.id, "rally", { territories: targets.map(([id]) => id) });
    for (const [, territory] of targets) territory.troops += 2;
    return s;
  }

  if (action.type === "missilePower.badIntel") {
    if (s.phase !== "start_turn" || activePlayer(s) !== action.targetPlayerId || action.playerId === action.targetPlayerId) {
      throw new RuleViolation("Bad Intel activates at the start of another player's turn");
    }
    if (!manifest.continents.some((continent) => continent.id === action.continentId)) throw new RuleViolation("Unknown continent");
    const controls = manifest.territories.filter((territory) => territory.continent === action.continentId)
      .every((territory) => s.territories[territory.id].controller === action.targetPlayerId);
    if (!controls) throw new RuleViolation("Choose a continent bonus the active player controls");
    spendMissilePower(s, action.playerId, "bad_intel", { targetPlayerId: action.targetPlayerId, continentId: action.continentId });
    s.badIntelDeniedContinents.push(action.continentId);
    return s;
  }

  if (action.type === "missilePower.emp") {
    const combat = s.combat;
    if (!combat || combat.natural || combat.awaitingMoveIn) throw new RuleViolation("EMP activates before a combat roll");
    spendMissilePower(s, action.playerId, "emp", { territory: combat.to });
    if (!s.empTerritories.includes(combat.to)) s.empTerritories.push(combat.to);
    return s;
  }

  if (action.type === "missilePower.interference") {
    if (s.phase !== "end_turn" || activePlayer(s) !== action.targetPlayerId) {
      throw new RuleViolation("Interference activates as the active player draws a Resource card");
    }
    if ("slot" in action.choice) {
      if (action.choice.slot < 0 || action.choice.slot > 3 || !s.sideboard.slots[action.choice.slot]) throw new RuleViolation("Choose a face-up Resource card");
    } else if (s.sideboard.coinPile.length === 0) throw new RuleViolation("The Coin pile is empty");
    spendMissilePower(s, action.playerId, "interference", { targetPlayerId: action.targetPlayerId, choice: action.choice });
    s.blockedResourceDraws.push(structuredClone(action.choice));
    return s;
  }

  if (action.type === "comeback.choose") {
    const choice = s.comebackChoice;
    if (!choice) throw new RuleViolation("No comeback-power choice is open");
    if (choice.playerId !== action.playerId) throw new RuleViolation("Only the eliminated player may choose this comeback power");
    const selected = choice.options.find((option) => option.id === action.optionId);
    if (!selected) throw new RuleViolation("Unknown comeback-power option");
    s.comebackPowers[choice.factionId] = selected;
    s.comebackChoice = undefined;
    emit(s, "ComebackPowerChosen", action.playerId, {
      factionId: choice.factionId,
      optionId: selected.id,
      title: selected.title,
    });
    if (openNextComebackChoice(s)) return s;
    if (choice.resume === "advance_turn") {
      checkVictory(s);
      if (s.phase !== "game_over") advanceTurn(s);
    }
    return s;
  }

  if (action.type === "privateMission.capture") {
    if (s.phase === "setup" || s.phase === "game_over") throw new RuleViolation("Private Missions are captured during an active game");
    if (!s.unlockedModules.includes("pack_4_lead_faction_private_missions")) throw new RuleViolation("Pack 4 is still sealed");
    const claimant = s.players[action.claimantPlayerId];
    if (!claimant?.factionId) throw new RuleViolation("Private Mission claimant has no faction");
    if (s.capturedPrivateMissions[claimant.factionId]) throw new RuleViolation("This faction already holds a Private Mission");
    const title = action.missionTitle.trim();
    if (!title) throw new RuleViolation("Enter the physical Private Mission title");
    const mission = s.legacyCards.privateMissionPool.find((candidate) =>
      candidate.title.localeCompare(title, undefined, { sensitivity: "accent" }) === 0);
    if (!mission) throw new RuleViolation("That Private Mission is not available in the host-supplied pool");
    s.capturedPrivateMissions[claimant.factionId] = mission;
    s.legacyCards.privateMissionPool = s.legacyCards.privateMissionPool.filter((candidate) => candidate.id !== mission.id);
    emit(s, "PrivateMissionCaptured", claimant.id, { factionId: claimant.factionId });
    return s;
  }

  if (action.type === "weakness.play") {
    if (s.phase !== "start_turn") throw new RuleViolation("Weakness Scars are played at the start of a turn");
    const holder = s.players[action.playerId];
    const held = holder?.scarHand.find((scar) => scar.instanceId === action.scarInstanceId);
    const weakness = held ? WEAKNESS_BY_SCAR[held.scarId] : undefined;
    if (!held || !weakness) throw new RuleViolation("You do not hold that Weakness Scar");
    if (action.factionId === "aliens" || !factionDefinitionById(action.factionId, s.unlockedModules)) {
      throw new RuleViolation("Target any non-Alien faction card");
    }
    if (s.factionWeaknesses[action.factionId]) throw new RuleViolation("A Faction card can have only one Weakness Scar");
    s.factionWeaknesses[action.factionId] = weakness;
    holder.scarHand = holder.scarHand.filter((scar) => scar.instanceId !== held.instanceId);
    holder.scarCardCount = holder.scarHand.length;
    emit(s, "ScarPlayed", action.playerId, { scarId: held.scarId, instanceId: held.instanceId, factionId: action.factionId, weakness });
    return s;
  }

  if (action.type === "alien.placeIsland") {
    if (s.phase === "setup" || s.phase === "game_over") throw new RuleViolation("Alien Island is placed during an active game");
    if (!s.unlockedModules.includes("pocket_2_alien_landing")) throw new RuleViolation("Pocket 2 is still sealed");
    if (s.alienIsland || s.territories[ALIEN_ISLAND_ID]) throw new RuleViolation("Alien Island has already been placed");
    const name = action.name.trim() || "Alien Island";
    const [first, second] = action.connections;
    if (first === second) throw new RuleViolation("Alien Island needs two different sea-line connections");
    if (!isBaseTerritory(first) || !isBaseTerritory(second)) throw new RuleViolation("Alien Island sea lines must connect to base-board territories");
    s.alienIsland = { territoryId: ALIEN_ISLAND_ID, name, connections: [first, second] };
    const landing = s.alienLandingRecruitPlayerId === action.playerId;
    s.territories[ALIEN_ISLAND_ID] = { controller: landing ? action.playerId : undefined, troops: landing ? 10 : 0, scars: [] };
    if (!s.sideboard.destroyed.includes(ALIEN_ISLAND_CARD_ID)) {
      s.sideboard.territoryDeck = shuffled(s, [...s.sideboard.territoryDeck, ALIEN_ISLAND_CARD_ID]);
    }
    emit(s, "AlienIslandPlaced", action.playerId, { territory: ALIEN_ISLAND_ID, name, connections: [first, second] });
    return s;
  }

  if (action.type === "faction.claimPrivateMission") {
    ensurePhase(s, "end_turn");
    if (activePlayer(s) !== action.claimantPlayerId) throw new RuleViolation("Only the active player may complete a Private Mission");
    ensureEndTurnScars(s, action.claimantPlayerId);
    const player = s.players[action.claimantPlayerId];
    const factionId = player?.factionId;
    if (factionId !== "mutants" && factionId !== "aliens") throw new RuleViolation("This faction has no built-in Private Mission");
    if (s.privateMissionsUsed.includes(factionId)) throw new RuleViolation("This Private Mission was already completed this game");
    const targets = factionId === "mutants"
      ? Object.values(s.territories).filter((territory) => territory.scars.some((scar) => scar === "biohazard" || scar === "fallout"))
      : Object.values(s.territories).filter((territory) => territory.city);
    const complete = targets.length > 0 && targets.every((territory) => territory.controller === player.id);
    if (!complete) throw new RuleViolation("The faction's Private Mission condition is not complete");
    s.privateMissionsUsed.push(factionId);
    player.redStarTokens++;
    emit(s, "FactionPrivateMissionCompleted", player.id, { factionId });
    maybeOpenMissilePowerChoice(s, player.id);
    checkVictory(s);
    if (s.phase !== "game_over") advanceTurn(s);
    return s;
  }

  if (action.type === "privateMission.activate") {
    ensurePhase(s, "end_turn");
    if (activePlayer(s) !== action.claimantPlayerId) throw new RuleViolation("Only the active player may complete a Private Mission");
    ensureEndTurnScars(s, action.claimantPlayerId);
    const claimant = s.players[action.claimantPlayerId];
    if (!claimant?.factionId) throw new RuleViolation("Private Mission claimant has no faction");
    const mission = s.capturedPrivateMissions[claimant.factionId];
    if (!mission) throw new RuleViolation("This faction has no captured Private Mission");
    if (s.privateMissionsUsed.includes(claimant.factionId)) throw new RuleViolation("This Private Mission was already activated this game");
    if (!sourcedMissionSatisfied(s, claimant.id, mission)) throw new RuleViolation("This Private Mission condition is not complete");
    s.privateMissionsUsed.push(claimant.factionId);
    claimant.redStarTokens++;
    claimant.conqueredEnemyThisTurn = false;
    emit(s, "PrivateMissionActivated", claimant.id, { factionId: claimant.factionId, missionId: mission.id, redStars: 1 });
    maybeOpenMissilePowerChoice(s, claimant.id);
    checkVictory(s);
    if (s.phase !== "game_over") advanceTurn(s);
    return s;
  }

  if (action.type === "mission.complete") {
    ensurePhase(s, "end_turn");
    if (activePlayer(s) !== action.claimantPlayerId) throw new RuleViolation("Only the active player may complete the Mission");
    ensureEndTurnScars(s, action.claimantPlayerId);
    const mission = s.legacyCards.activeMission;
    if (!mission) throw new RuleViolation("No face-up Mission is available");
    if (action.reward !== 1 && action.reward !== 2) throw new RuleViolation("Mission rewards are one or two Red Stars");
    if (mission.reward && mission.reward !== action.reward) throw new RuleViolation("Mission reward does not match the host-entered card");
    if (!sourcedMissionSatisfied(s, action.claimantPlayerId, mission)) throw new RuleViolation("The public Mission condition is not complete");
    const explore = mission.id.endsWith(":explore-the-world");
    if (explore) {
      const [first, second] = action.seaLineConnection ?? [];
      if (!first || !second || first === second || !isBaseTerritory(first) || !isBaseTerritory(second)) {
        throw new RuleViolation("Explore the World must connect two different base-board territories");
      }
      if (neighborsOf(s, first).includes(second)) throw new RuleViolation("Those territories are already connected");
      s.customConnections.push([first, second]);
      emit(s, "SeaLineFounded", action.claimantPlayerId, { connections: [first, second] });
    } else if (action.seaLineConnection) throw new RuleViolation("Only Explore the World creates a sea line");
    const claimant = s.players[action.claimantPlayerId];
    claimant.redStarTokens += action.reward;
    claimant.conqueredEnemyThisTurn = false;
    const isPrivateMission = mission.id.startsWith("pack_4_lead_faction_private_missions:privateMission:");
    if (isPrivateMission && claimant.factionId && !s.capturedPrivateMissions[claimant.factionId]) {
      s.capturedPrivateMissions[claimant.factionId] = mission;
      if (!s.privateMissionsUsed.includes(claimant.factionId)) s.privateMissionsUsed.push(claimant.factionId);
      emit(s, "PrivateMissionCaptured", claimant.id, { factionId: claimant.factionId, missionId: mission.id });
    } else {
      s.legacyCards.missionBox.push(mission);
    }
    s.legacyCards.activeMission = undefined;
    emit(s, "MissionCompleted", claimant.id, { missionId: mission.id, reward: action.reward });
    maybeOpenMissilePowerChoice(s, claimant.id);
    checkVictory(s);
    if (s.phase !== "game_over") {
      drawRandomMission(s);
      advanceTurn(s);
    }
    return s;
  }

  if (action.type === "mission.foundWorldCapital") {
    if (s.phase === "setup" || s.phase === "game_over") throw new RuleViolation("World Capital placement requires an active game");
    if (!s.unlockedModules.includes("pack_3_homelands_missions")) throw new RuleViolation("Pack 3 Missions are still sealed");
    if (s.worldCapitalTerritoryId || Object.values(s.territories).some((territory) => territory.city?.type === "world_capital")) {
      throw new RuleViolation("The World Capital has already been placed");
    }
    if (!s.players[action.founderPlayerId]) throw new RuleViolation("Unknown World Capital founder");
    const territory = s.territories[action.territoryId];
    if (!territory) throw new RuleViolation("Unknown World Capital territory");
    const activeMission = s.legacyCards.activeMission;
    const sourcedWorldMission = activeMission?.id.endsWith(":the-world-is-ready") ?? false;
    if (sourcedWorldMission) {
      if (activePlayer(s) !== action.founderPlayerId || s.phase !== "end_turn") throw new RuleViolation("The active player completes The World Is Ready at end of turn");
      const slot = s.sideboard.slots.findIndex((cardId) => {
        const definition = cardId ? card(cardId) : undefined;
        return definition?.kind === "territory" && definition.territoryId === action.territoryId
          && cardResources(s, cardId!) >= 4 && canClaimFaceUpTerritory(s, action.founderPlayerId, definition.territoryId);
      });
      if (slot < 0) throw new RuleViolation("The World Is Ready requires an eligible face-up Territory card worth at least four resources");
    } else if (territory.city) throw new RuleViolation("World Capital must be placed on a territory without a city");
    const name = action.name.trim();
    if (!name) throw new RuleViolation("A non-empty World Capital name is required");
    territory.city = {
      type: "world_capital",
      population: cityPopulation("world_capital"),
      name,
      foundedByPlayerId: action.founderPlayerId,
    };
    s.worldCapitalTerritoryId = action.territoryId;
    s.leadFactionId = determineLeadFaction(s);
    emit(s, "WorldCapitalFounded", action.founderPlayerId, {
      territory: action.territoryId, name, leadFactionId: s.leadFactionId,
    });
    if (sourcedWorldMission) {
      const founder = s.players[action.founderPlayerId];
      founder.redStarTokens += 2;
      s.legacyCards.missionBox.push(activeMission!);
      s.legacyCards.activeMission = undefined;
      emit(s, "MissionCompleted", founder.id, { missionId: activeMission!.id, reward: 2 });
      maybeOpenMissilePowerChoice(s, founder.id);
    }
    queueUnlock(s, "pack_4_lead_faction_private_missions", "mid_game");
    if (sourcedWorldMission) {
      checkVictory(s);
      if (!s.winner) {
        if (!openLeadMissionChoice(s, "world_capital")) {
          drawRandomMission(s);
          advanceTurn(s);
        }
      }
    }
    return s;
  }
  const p = s.players[action.playerId];
  if (!p) throw new RuleViolation("Unknown player");

  switch (action.type) {
    case "setup.acknowledgeOrder": {
      ensurePhase(s, "setup");
      const setup = s.setup!;
      if (setup.stage !== "order_reveal") throw new RuleViolation("The setup order has already been acknowledged");
      if (setup.chooserOrder[0] !== action.playerId) throw new RuleViolation("The high roller must acknowledge the setup order");
      setup.stage = s.advancedDraft ? "advanced_draft" : "faction_selection";
      emit(s, "SetupOrderAcknowledged", action.playerId, { order: setup.chooserOrder, rolls: setup.rolls });
      emit(s, "SetupStageChanged", undefined, { stage: setup.stage });
      return s;
    }

    case "draft.pick": {
      ensurePhase(s, "setup");
      const draft = s.advancedDraft;
      if (!draft || draft.completed) throw new RuleViolation("No advanced setup draft is open");
      if (s.setup?.stage !== "advanced_draft") throw new RuleViolation("Acknowledge the high-roll order before drafting");
      if (draft.pendingCoinClaim) throw new RuleViolation("Take the drafted starting Coin cards before the next pick");
      if (draft.pickOrder[draft.nextPickIdx] !== action.playerId) throw new RuleViolation("Not your draft pick");
      const picks = draft.picks[action.playerId];
      const takeNumber = (available: number[], current: number | undefined, label: string) => {
        if (current !== undefined) throw new RuleViolation(`Already chose ${label}`);
        if (typeof action.value !== "number") throw new RuleViolation(`${label} draft cards use numeric values`);
        const index = available.indexOf(action.value);
        if (index < 0) throw new RuleViolation(`${label} draft card is unavailable`);
        available.splice(index, 1);
        return action.value;
      };
      switch (action.category) {
        case "faction": {
          if (picks.factionId) throw new RuleViolation("Already chose a faction");
          if (typeof action.value !== "string") throw new RuleViolation("Faction draft cards use faction ids");
          const index = draft.available.factions.indexOf(action.value);
          if (index < 0) throw new RuleViolation("Faction draft card is unavailable");
          picks.factionId = action.value;
          draft.available.factions.splice(index, 1);
          break;
        }
        case "turnOrder":
          picks.turnOrder = takeNumber(draft.available.turnOrder, picks.turnOrder, "turn order");
          break;
        case "placementOrder":
          picks.placementOrder = takeNumber(draft.available.placementOrder, picks.placementOrder, "placement order");
          break;
        case "startingTroops":
          picks.startingTroops = takeNumber(draft.available.startingTroops, picks.startingTroops, "starting troops");
          break;
        case "startingCoinCards":
          picks.startingCoinCards = takeNumber(draft.available.startingCoinCards, picks.startingCoinCards, "starting Coin cards");
          break;
      }
      emit(s, "AdvancedDraftCardChosen", action.playerId, { category: action.category, value: action.value });
      if (action.category === "startingCoinCards" && action.value !== 0 && draft.explicitCoinClaims) {
        draft.pendingCoinClaim = { playerId: action.playerId, total: action.value as number, remaining: action.value as number };
      } else advanceAdvancedDraft(s);
      return s;
    }

    case "draft.takeStartingCoin": {
      ensurePhase(s, "setup");
      const draft = s.advancedDraft;
      const claim = draft?.pendingCoinClaim;
      if (!draft || !claim) throw new RuleViolation("No starting Coin-card claim is open");
      if (claim.playerId !== action.playerId) throw new RuleViolation("Only the drafting player may take starting Coin cards");
      const cardIndex = s.sideboard.coinPile.indexOf(action.cardId);
      if (cardIndex < 0) throw new RuleViolation("That card is not in the public Coin pile");
      const [cardId] = s.sideboard.coinPile.splice(cardIndex, 1);
      s.players[action.playerId].hand.push(cardId);
      claim.remaining--;
      emit(s, "StartingCoinCardTaken", action.playerId, { cardId, remaining: claim.remaining, handCount: s.players[action.playerId].hand.length });
      if (claim.remaining === 0) {
        draft.pendingCoinClaim = undefined;
        advanceAdvancedDraft(s);
      }
      return s;
    }

    case "setup.choose": {
      ensurePhase(s, "setup");
      const setup = s.setup!;
      if (setup.stage !== "faction_selection" && setup.stage !== "starting_placement") throw new RuleViolation("Faction placement is not the current setup stage");
      if (s.advancedDraft && !s.advancedDraft.completed) throw new RuleViolation("Complete the advanced draft before placing factions");
      if (setup.chooserOrder[setup.nextIdx] !== action.playerId) throw new RuleViolation("Not your pick");
      if (p.factionId) throw new RuleViolation("Already chose");
      const draftedFaction = s.advancedDraft?.picks[action.playerId]?.factionId;
      if (draftedFaction && draftedFaction !== action.factionId) throw new RuleViolation("Place the faction selected in the advanced draft");
      const faction = factionDefinitionById(action.factionId, s.unlockedModules);
      if (!faction) throw new RuleViolation("Unknown faction");
      if (Object.values(s.players).some((x) => x.factionId === action.factionId)) throw new RuleViolation("Faction taken");
      const storedPower = s.factionPowers[action.factionId]; // powers attach to the faction permanently
      if (storedPower) {
        if (action.powerId && action.powerId !== storedPower) throw new RuleViolation(`${faction.name} already chose ${storedPower} — power choices are permanent`);
      } else if (faction.startingPowers.length > 0) {
        if (!action.powerId) throw new RuleViolation("Choose a starting power (first time this faction is played)");
        if (!faction.startingPowers.includes(action.powerId)) throw new RuleViolation("That power does not belong to this faction");
      }
      if (!isLegalStart(s, action.territoryId, true, action.factionId, action.playerId)) throw new RuleViolation("Illegal starting territory (unoccupied, unmarked, and not adjacent to another HQ)");
      if (!storedPower && faction.startingPowers.length > 0) {
        s.factionPowers[action.factionId] = action.powerId!;
        emit(s, "FactionPowerChosen", p.id, { factionId: action.factionId, powerId: action.powerId });
      }
      p.factionId = action.factionId;
      p.startingTerritoryId = action.territoryId;
      const troops = p.startingTroops ?? startingTroops();
      const t = s.territories[action.territoryId];
      t.controller = p.id;
      t.troops = troops;
      t.hqFaction = action.factionId;
      emit(s, "FactionChosen", p.id, { factionId: action.factionId, territory: action.territoryId, troops });
      setup.nextIdx++;
      if (setup.nextIdx >= setup.chooserOrder.length) {
        setup.stage = "mission_setup";
        emit(s, "SetupStageChanged", undefined, { stage: "mission_setup" });
        const used = new Set(Object.values(s.players).map((x) => x.factionId));
        const unused = factionDefinitions(s.unlockedModules).filter((f) => !used.has(f.id)).map((f) => f.id);
        emit(s, "UnusedFactionsRecorded", undefined, { factions: unused });
        const mutantsPlaying = Object.values(s.players).some((player) => player.factionId === "mutants");
        if (mutantsPlaying && s.bringerOfNuclearFireFactionId) {
          const bringer = Object.values(s.players).find((player) => player.factionId === s.bringerOfNuclearFireFactionId);
          if (bringer) {
            bringer.missiles += 2;
            emit(s, "BringerMissilesGranted", bringer.id, { factionId: bringer.factionId, missiles: 2 });
          }
        }
        s.activeIdx = 0;
        s.turnNumber = 1;
        s.phase = "start_turn";
        if (s.unlockedModules.includes("pack_4_lead_faction_private_missions")) {
          s.leadFactionId = determineLeadFaction(s);
          const leader = leadPlayer(s);
          const capital = s.worldCapitalTerritoryId ? s.territories[s.worldCapitalTerritoryId] : undefined;
          if (leader && capital?.city?.type === "world_capital" && !capital.controller && capital.troops === 0 && !capital.hqFaction) {
            capital.controller = leader;
            capital.troops = 3;
            emit(s, "LeadFactionCapitalBonus", leader, { factionId: s.leadFactionId, territory: s.worldCapitalTerritoryId, troops: 3 });
          }
        }
        if (s.unlockedModules.includes("pack_4_lead_faction_private_missions") && !s.legacyCards.activeMission) {
          if (!openLeadMissionChoice(s, "game_start")) drawRandomMission(s);
        }
        setup.stage = "complete";
        emit(s, "SetupStageChanged", undefined, { stage: "complete" });
        emit(s, "TurnStarted", activePlayer(s), { turn: 1 });
        enterStartTurn(s, activePlayer(s)); // per-turn power state + start-of-turn powers
      }
      return s;
    }

    case "start.buyRedStar": {
      ensurePhase(s, "start_turn");
      ensureActive(s, action.playerId);
      const cost = ruleValue<number>("redStarPurchaseCost");
      if (action.cardIds.length !== cost) throw new RuleViolation(`Red Star costs ${cost} Resource cards`);
      if (new Set(action.cardIds).size !== action.cardIds.length) throw new RuleViolation("Each Resource card may be used only once");
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
      maybeOpenMissilePowerChoice(s, p.id);
      checkVictory(s);
      return s;
    }

    case "start.moveHq": {
      ensurePhase(s, "start_turn");
      ensureActive(s, action.playerId);
      if (!hasPower(s, p.id, "mobile")) throw new RuleViolation("Moving an HQ at start of turn requires Mobile");
      if (s.mobileHqUsed) throw new RuleViolation("Mobile was already used this turn");
      const from = s.territories[action.from];
      const to = s.territories[action.to];
      if (!from?.hqFaction || from.controller !== p.id) throw new RuleViolation("Choose an HQ you control");
      if (!to || to.controller !== p.id) throw new RuleViolation("Move the HQ into a territory you control");
      if (to.hqFaction) throw new RuleViolation("HQs cannot share a territory");
      if (to.scars.length > 0) throw new RuleViolation("An HQ cannot move onto a scar");
      if (!neighborsOf(s, action.from).includes(action.to)) throw new RuleViolation("Mobile moves an HQ to an adjacent territory");
      to.hqFaction = from.hqFaction;
      from.hqFaction = undefined;
      s.mobileHqUsed = true;
      emit(s, "FactionPowerApplied", p.id, { powerId: "mobile", from: action.from, to: action.to, hqFaction: to.hqFaction });
      return s;
    }

    case "start.done": {
      ensurePhase(s, "start_turn");
      ensureActive(s, action.playerId);
      s.startTurnDone = true;
      const owned = Object.values(s.territories).filter((t) => t.controller === p.id).length;
      if (owned === 0) {
        // Forced Join the War / elimination branch
        const anyLegal = manifest.territories.some((t) => isLegalStart(s, t.id, false, p.factionId, p.id)); // a player's own founded Major City counts as a rejoin option
        if (!anyLegal) {
          p.eliminated = true;
          p.knockedOut = false;
          emit(s, "PlayerEliminated", p.id, { reason: "No legal Join the War territory" });
          if (!s.unlockedModules.includes("pack_2_comeback_mercenaries")) {
            s.contentPause = { resume: "failed_join_elimination", playerId: p.id };
            queueUnlock(s, "pack_2_comeback_mercenaries", "mid_game");
            if (s.contentRequired.length > 0) return s;
            s.contentPause = undefined;
          }
          if (queueComebackChoice(s, p.id, "advance_turn")) return s;
          checkVictory(s);
          if (s.phase !== "game_over") advanceTurn(s);
          return s;
        }
        s.phase = "join_or_recruit";
        emit(s, "JoinTheWarRequired", p.id);
        return s;
      }
      const breakdown = recruitBreakdown(s, p.id);
      if (hasPower(s, p.id, "round_up_recruiting")) { // audit when the round-up actually changed the result
        const flo = Math.max(Math.floor((breakdown.territories + breakdown.population) / ruleValue<number>("territoriesPerTroop")), ruleValue<number>("minRecruit"));
        if (breakdown.fromTerritories > flo) emit(s, "FactionPowerApplied", p.id, { powerId: "round_up_recruiting", bonus: breakdown.fromTerritories - flo });
      }
      s.recruit = { remaining: breakdown.total, breakdown };
      s.phase = "join_or_recruit";
      emit(s, "RecruitCalculated", p.id, { breakdown: breakdown as unknown as Record<string, unknown> });
      checkAlienLandingUnlock(s, p.id);
      return s;
    }

    case "join.enter": {
      ensurePhase(s, "join_or_recruit");
      ensureActive(s, action.playerId);
      if (Object.values(s.territories).some((t) => t.controller === p.id)) throw new RuleViolation("You control territory; recruit instead");
      if (!isLegalStart(s, action.territoryId, false, p.factionId, p.id)) throw new RuleViolation("Illegal Join the War territory"); // no HQ placed, so no adjacency constraint
      const troops = joinWarTroops(s, p.id);
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
      if (s.recruit.breakdown.tradeIns > 0) throw new RuleViolation("You may turn in only one set of Resource cards for troops per turn");
      if (action.cardIds.length < 1) throw new RuleViolation("Trade in at least one Resource card");
      if (new Set(action.cardIds).size !== action.cardIds.length) throw new RuleViolation("Each Resource card may be used only once");
      let resources = 0;
      for (const id of action.cardIds) {
        if (!p.hand.includes(id)) throw new RuleViolation("Card not in hand");
        resources += cardResources(s, id); // honors upgrade_territory_card stickers
      }
      if (p.factionId === s.alienCollaboratorFactionId) resources++;
      if (resources < 2 || resources > 10) throw new RuleViolation("Trade between 2 and 10 resources");
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
      s.privateMissionProgress.tradedResources = resources;
      s.privateMissionProgress.highValueTerritoryCards = action.cardIds.filter((id) => {
        const definition = card(id);
        return definition?.kind === "territory" && cardResources(s, id) >= 4;
      }).length;
      emit(s, "ResourceCardsTraded", p.id, { cards: action.cardIds, resources, troops });
      if (action.protectTerritoryId !== undefined) {
        if (p.factionId !== "mutants" || s.mutantEvolution !== "mass_hypnosis") throw new RuleViolation("Mass Hypnosis is not available");
        const protectedCard = action.cardIds.find((id) => (card(id) as any)?.territoryId === action.protectTerritoryId);
        if (!protectedCard || s.territories[action.protectTerritoryId]?.controller !== p.id) {
          throw new RuleViolation("Mass Hypnosis must protect one controlled territory card in this trade");
        }
        s.protectedMutantTerritoryId = action.protectTerritoryId;
        emit(s, "MutantEvolutionApplied", p.id, { evolution: "mass_hypnosis", territory: action.protectTerritoryId });
      }
      checkAlienLandingUnlock(s, p.id);
      return s;
    }

    case "recruit.place": {
      ensurePhase(s, "join_or_recruit");
      ensureActive(s, action.playerId);
      if (!s.recruit) throw new RuleViolation("No recruit in progress");
      if (action.count < 1 || action.count > s.recruit.remaining) throw new RuleViolation("Invalid troop count");
      const t = s.territories[action.territoryId];
      if (t.scars.includes("fallout") && p.factionId !== "mutants") throw new RuleViolation("Troops cannot be placed into Fallout");
      if (s.alienLandingRecruitPlayerId === p.id && action.territoryId !== s.alienIsland?.territoryId) {
        throw new RuleViolation("Alien landing troops must be placed on Alien Island");
      }
      if (s.factionWeaknesses[p.factionId ?? ""] === "cautious") {
        const recruitStart = [...s.log].reverse().find((event) => event.type === "RecruitCalculated" && event.playerId === p.id)?.seq ?? 0;
        const used = new Set(s.log.filter((event) => event.seq > recruitStart && event.type === "TroopsPlaced" && event.playerId === p.id)
          .map((event) => String(event.data?.territory)));
        if (!used.has(action.territoryId) && used.size >= 2) throw new RuleViolation("Cautious factions place recruited troops into at most two territories");
      }
      const stealthTarget = !t.controller && t.troops === 0 && !t.city && !t.fortification && t.scars.length === 0
        && hasPower(s, p.id, "stealthy")
        && (!s.stealthRecruitTerritory || s.stealthRecruitTerritory === action.territoryId);
      if (t.controller !== p.id && !stealthTarget) throw new RuleViolation("You do not control that territory");
      if (stealthTarget) {
        t.controller = p.id;
        s.stealthRecruitTerritory = action.territoryId;
        emit(s, "FactionPowerApplied", p.id, { powerId: "stealthy", territory: action.territoryId });
      }
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
      if (s.alienLandingRecruitPlayerId === p.id) s.alienLandingRecruitPlayerId = undefined;
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
      if (!neighborsOf(s, action.from).includes(action.to)) throw new RuleViolation("Not adjacent");
      if (to.troops > 0 || to.controller) throw new RuleViolation("Territory is occupied; attack instead");
      const alienCityImmunity = p.factionId === "aliens";
      const collaboratorPenalty = p.factionId === s.alienCollaboratorFactionId ? 2 : 0;
      const weaknessPenalty = s.factionWeaknesses[p.factionId ?? ""] === "city_shy" ? 1 : 0;
      const resistance = (alienCityImmunity ? 0 : (to.city?.population ?? 0))
        + (to.fortification ? 2 : 0) + (to.city ? collaboratorPenalty + weaknessPenalty : 0);
      if (action.troops <= resistance) throw new RuleViolation(`Need more than ${resistance} troops (city resistance)`);
      if (action.troops >= from.troops) throw new RuleViolation("Leave at least one troop behind");
      from.troops -= action.troops;
      to.troops = action.troops - resistance;
      if (to.scars.includes("fallout") && p.factionId !== "mutants") {
        const falloutLosses = Math.ceil(to.troops / 2);
        to.troops -= falloutLosses;
        emit(s, "FalloutLosses", p.id, { territory: action.to, losses: falloutLosses });
      }
      to.controller = to.troops > 0 ? p.id : undefined;
      s.expandedThisTurn++; // expansionist_supply counter
      if (to.city) s.expandedIntoCityThisTurn = true;
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
      if (!neighborsOf(s, action.from).includes(action.to)) throw new RuleViolation("Not adjacent");
      if (!to.controller || to.controller === p.id || to.troops <= 0) throw new RuleViolation("No enemy to attack there");
      if (from.troops < 2) throw new RuleViolation("Need at least 2 troops to attack");
      if (s.blockedAttackTargets.includes(action.to)) throw new RuleViolation("That territory cannot be attacked again this turn (Defensive Stand)");
      if (s.protectedMutantTerritoryId === action.to) throw new RuleViolation("Mass Hypnosis protects that territory until the Mutants' next turn");
      if (hasPower(s, p.id, "lower_die_intimidation")) { // track Enclave's first target of the turn
        if (!s.intimidation) s.intimidation = { territory: action.to, broken: false };
        else if (s.intimidation.territory !== action.to) s.intimidation.broken = true; // attacking elsewhere ends the effect for the turn
      }
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
      const side = action.side ?? (action.playerId === c.attacker ? "att" : "def");
      const dice = side === "att" ? c.natural.att : c.natural.def;
      if (action.dieIndex < 0 || action.dieIndex >= dice.length) throw new RuleViolation("Invalid die");
      if (c.unmodifiable[side][action.dieIndex]) throw new RuleViolation("Die is unmodifiable");
      p.missiles--;
      c.modifiers.push({ playerId: p.id, type: "missile", side, dieIndex: action.dieIndex });
      c.unmodifiable[side][action.dieIndex] = true; // missile result is an unmodifiable 6
      c.window.passed = []; // each commit re-opens response opportunities for remaining legal actors
      emit(s, "MissileCommitted", p.id, { side, dieIndex: action.dieIndex, naturalValue: dice[action.dieIndex] });
      if (c.modifiers.filter((modifier) => modifier.type === "missile").length === 3
          && !s.unlockedModules.includes("pocket_1_nuclear_war_mutants")) {
        // Pocket 1 is revealed after the third Missile is committed to this roll and
        // before normal casualty resolution. The sealed-content pause preserves the
        // pending roll; after import the nuclear opening replaces normal casualties.
        s.bringerOfNuclearFireFactionId = p.factionId;
        emit(s, "BringerOfNuclearFireNamed", p.id, { factionId: p.factionId });
        s.contentPause = { resume: "nuclear_resolution" };
        queueUnlock(s, "pocket_1_nuclear_war_mutants", "mid_game");
        if (s.contentRequired.length > 0) return s;
        resumeAfterContent(s);
        return s;
      }
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
      const early = s.phase !== "maneuver"; // early_maneuver — any stable point during Saharan's own turn
      if (early) {
        if (!hasPower(s, action.playerId, "early_maneuver")) ensurePhase(s, "maneuver"); // normal factions keep the phase gate
        ensurePhase(s, "start_turn", "join_or_recruit", "expand_attack", "end_turn"); // own-turn phases only
        if (s.combat) throw new RuleViolation("Resolve current combat first"); // stable boundary only
      }
      ensureActive(s, action.playerId);
      if (s.maneuverUsed) throw new RuleViolation("One maneuver per turn");
      const from = s.territories[action.from];
      const to = s.territories[action.to];
      if (p.factionId !== "mutants" && (from.scars.includes("fallout") || to.scars.includes("fallout"))) {
        throw new RuleViolation("Troops cannot maneuver into or out of Fallout");
      }
      if (s.factionWeaknesses[p.factionId ?? ""] === "short_sighted"
          && !neighborsOf(s, action.from).includes(action.to)) throw new RuleViolation("Short-Sighted factions maneuver only one territory");
      if (from.controller !== p.id || to.controller !== p.id) throw new RuleViolation("Both territories must be yours");
      const unconnected = !connected(s, p.id, action.from, action.to);
      if (unconnected && !hasPower(s, p.id, "unconnected_maneuver")) throw new RuleViolation("Territories not connected through your territories");
      if (action.count < 1 || action.count >= from.troops) throw new RuleViolation("Leave at least one troop behind");
      from.troops -= action.count;
      to.troops += action.count;
      s.maneuverUsed = true;
      if (early) emit(s, "FactionPowerApplied", p.id, { powerId: "early_maneuver", phase: s.phase });
      if (unconnected) emit(s, "FactionPowerApplied", p.id, { powerId: "unconnected_maneuver", from: action.from, to: action.to });
      emit(s, "Maneuvered", p.id, { from: action.from, to: action.to, count: action.count });
      return s;
    }

    case "phase.endManeuver": {
      ensurePhase(s, "maneuver");
      ensureActive(s, action.playerId);
      s.phase = "end_turn";
      emit(s, "PhaseChanged", p.id, { phase: "end_turn" });
      // Page 12: end-of-turn Scar effects happen after maneuvering and before
      // collecting either a Resource or Mission card.
      ensureEndTurnScars(s, p.id);
      if (!endTurnDecision(s, p.id).eligibleForDraw) {
        emit(s, "DrawNotEligible", p.id);
      }
      return s;
    }

    case "end.draw": {
      ensurePhase(s, "end_turn");
      ensureActive(s, action.playerId);
      ensureEndTurnScars(s, p.id);
      const expansionist = !p.conqueredEnemyThisTurn && expansionistDrawEarned(s, p.id);
      const resourceful = !p.conqueredEnemyThisTurn && s.expandedIntoCityThisTurn && hasPower(s, p.id, "resourceful");
      if (!p.conqueredEnemyThisTurn && !expansionist && !resourceful) {
        throw new RuleViolation("No enemy territory conquered or power-based Resource draw earned this turn");
      }
      if (expansionist) emit(s, "FactionPowerApplied", p.id, { powerId: "expansionist_supply", expandedTerritories: s.expandedThisTurn });
      if (resourceful) emit(s, "FactionPowerApplied", p.id, { powerId: "resourceful" });
      const reconSlot = "reconSlot" in action.choice ? action.choice.reconSlot : undefined;
      const normalSlot = "slot" in action.choice ? action.choice.slot : undefined;
      const recon = reconSlot !== undefined;
      if (normalSlot !== undefined || reconSlot !== undefined) {
        const i = reconSlot ?? normalSlot!;
        const cardId = s.sideboard.slots[i];
        if (cardId === null || i < 0 || i > 3) throw new RuleViolation("Empty slot");
        if (s.blockedResourceDraws.some((choice) => "slot" in choice && choice.slot === i)) {
          throw new RuleViolation("Interference prevents drawing that Resource card");
        }
        const def = card(cardId)!;
        if (def.kind !== "territory") throw new RuleViolation("Bad card");
        if (recon) {
          const normalMatch = s.sideboard.slots.some((id, slot) => id
            && !s.blockedResourceDraws.some((choice) => "slot" in choice && choice.slot === slot)
            && canClaimFaceUpTerritory(s, p.id, (card(id) as any).territoryId));
          if (normalMatch) throw new RuleViolation("Recon activates only before you would draw a Coin card");
          spendMissilePower(s, p.id, "recon", { slot: i });
        } else if (!canClaimFaceUpTerritory(s, p.id, def.territoryId)) {
          throw new RuleViolation("Face-up territory card must show a territory you control or your Pack 3 Homeland");
        }
        s.sideboard.slots[i] = null;
        p.hand.push(cardId);
        emit(s, "ResourceCardDrawn", p.id, { kind: "territory", slot: i }); // identity owner-only; server filters
        if (action.khanReinforce) { // territory_card_reinforcement — optional +1 troop on the drawn card's territory
          if (!hasPower(s, p.id, "territory_card_reinforcement")) throw new RuleViolation("Reinforcing the drawn territory requires Khan's Territory Card Reinforcement power");
          if (s.territories[def.territoryId].controller !== p.id) throw new RuleViolation("Khan can reinforce only a territory it controls");
          s.territories[def.territoryId].troops++;
          emit(s, "FactionPowerApplied", p.id, { powerId: "territory_card_reinforcement", territory: def.territoryId, troops: s.territories[def.territoryId].troops });
        }
        advanceFaceUpCards(s, i);
      } else {
        if (action.khanReinforce) throw new RuleViolation("Only a drawn Territory card can be reinforced");
        const eligible = s.sideboard.slots.some((id, slot) => id
          && !s.blockedResourceDraws.some((choice) => "slot" in choice && choice.slot === slot)
          && canClaimFaceUpTerritory(s, p.id, (card(id) as any).territoryId));
        if (eligible) throw new RuleViolation("You must take a matching face-up territory card"); // verify
        if (s.blockedResourceDraws.some((choice) => "coin" in choice)) throw new RuleViolation("Interference prevents drawing that Coin card");
        if (s.factionWeaknesses[p.factionId ?? ""] === "purist"
            && p.hand.filter((id) => card(id)?.kind === "coin").length >= 2) throw new RuleViolation("Purist factions cannot hold more than two Coin cards");
        const coin = s.sideboard.coinPile.shift();
        if (!coin) throw new RuleViolation("Coin pile empty");
        p.hand.push(coin);
        // Slot 4 discard behavior on coin draw
        const slot4 = s.sideboard.slots[3];
        if (slot4) { s.sideboard.discard.push(slot4); s.sideboard.slots[3] = null; }
        emit(s, "ResourceCardDrawn", p.id, { kind: "coin", slot4Discarded: slot4 ?? null });
        coinDepletionCheck(s);
        advanceFaceUpCards(s, 3);
      }
      if (action.mindshackleTargetPlayerId !== undefined) {
        if (p.factionId !== "mutants" || s.mutantEvolution !== "mindshackle") throw new RuleViolation("Mindshackle is not available");
        const target = s.players[action.mindshackleTargetPlayerId];
        if (!target || target.hand.length === 0) throw new RuleViolation("Mindshackle target has no Resource cards");
        const turnStart = [...s.log].reverse().find((event) => event.type === "TurnStarted")?.seq ?? 0;
        const conqueredTarget = s.log.some((event) => event.seq > turnStart && event.type === "TerritoryConquered"
          && event.playerId === p.id && event.data?.defender === target.id);
        if (!conqueredTarget) throw new RuleViolation("Mindshackle may target only a player whose territory you conquered this turn");
        const drawn = p.hand.at(-1)!;
        const randomIndex = Math.floor((rollDie(s) - 1) / 6 * target.hand.length);
        const received = target.hand.splice(Math.min(randomIndex, target.hand.length - 1), 1)[0];
        p.hand[p.hand.lastIndexOf(drawn)] = received;
        target.hand.push(drawn);
        emit(s, "MutantEvolutionApplied", p.id, { evolution: "mindshackle", targetPlayerId: target.id });
      }
      if (s.phase !== "game_over") {
        p.conqueredEnemyThisTurn = false;
        if (!triggerEventForSlotOne(s)) advanceTurn(s);
      }
      return s;
    }

    case "scar.play": { // a holder plays a starter scar at a stable boundary, on anyone's turn
      if (s.phase === "game_over") throw new RuleViolation("Game is over");
      // Stable boundary only: never interrupt a post-roll missile window or a conquest move-in.
      if (s.combat && (s.combat.natural || s.combat.awaitingMoveIn)) {
        throw new RuleViolation("Cannot play a scar during a missile window or conquest move-in");
      }
      const held = p.scarHand.find((x) => x.instanceId === action.scarInstanceId);
      if (!held) throw new RuleViolation("You do not hold that scar");
      const def = scarById(held.scarId);
      if (!def || !scarAvailable(s.unlockedModules, def)) throw new RuleViolation("That scar is not playable (its module is still sealed)");
      const t = s.territories[action.territoryId];
      if (!t) throw new RuleViolation("Unknown territory");
      if (t.scars.includes("fallout") || action.territoryId === s.alienIsland?.territoryId) throw new RuleViolation("Fallout and Alien Island cannot be scarred or marked");
      if (t.hqFaction) throw new RuleViolation("A territory with an HQ cannot be scarred");
      if (t.scars.length > 0) throw new RuleViolation("Territory already has a scar (one scar per territory)");
      t.scars.push(held.scarId); // attach (placed scars are public, on the board)
      p.scarHand = p.scarHand.filter((x) => x.instanceId !== held.instanceId); // consume from hand
      p.scarCardCount = p.scarHand.length;
      emit(s, "ScarPlayed", action.playerId, { scarId: held.scarId, instanceId: held.instanceId, territory: action.territoryId });
      return s;
    }

    case "reward.choose": { // post-win reward resolution — winner first, held-on clockwise
      if (s.phase !== "game_over" || !s.rewards || s.rewards.committed) throw new RuleViolation("No end-game reward selection open");
      const r = s.rewards;
      if (r.order[r.nextIdx] !== action.playerId) throw new RuleViolation("Not your reward selection");
      const isWinner = r.nextIdx === 0;
      const choice = action.reward;
      const winnerKinds = ["name_continent", "found_major_city", "cancel_scar", "change_continent_bonus", "fortify_city", "destroy_territory_card"];
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
          t.ruin = undefined;
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
        case "destroy_territory_card": {
          const def = card(choice.cardId);
          if (!def || def.kind !== "territory") throw new RuleViolation("Only territory cards can be destroyed");
          if (s.sideboard.destroyed.includes(choice.cardId)) throw new RuleViolation("Card is already destroyed");
          s.sideboard.destroyed.push(choice.cardId);
          s.sideboard.territoryDeck = s.sideboard.territoryDeck.filter((id) => id !== choice.cardId);
          s.sideboard.discard = s.sideboard.discard.filter((id) => id !== choice.cardId);
          s.sideboard.slots = s.sideboard.slots.map((id) => id === choice.cardId ? null : id);
          for (const player of Object.values(s.players)) player.hand = player.hand.filter((id) => id !== choice.cardId);
          delete s.cardModifications[choice.cardId];
          emit(s, "TerritoryCardDestroyed", p.id, { cardId: choice.cardId, territory: def.territoryId });
          break;
        }
        case "found_minor_city": {
          if (s.inventories.minorCities < 1) throw new RuleViolation("No Minor Cities left in inventory");
          const t = territory(choice.territoryId);
          if (t.controller !== p.id) throw new RuleViolation("You must control the territory at game end");
          if (t.city) throw new RuleViolation("Territory already has a city");
          t.city = { type: "minor", population: cityPopulation("minor"), name: requireName(choice.name), foundedByPlayerId: p.id };
          t.ruin = undefined;
          s.inventories.minorCities--;
          emit(s, "MinorCityFounded", p.id, { territory: choice.territoryId, name: t.city.name });
          if (s.inventories.minorCities === 0) queueUnlock(s, "pack_1_advanced_draft_biohazards", "end_game"); // the 9th (last) Minor City founded & named
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
      if (isWinner) {
        // Pack 3's booklet timing is specifically after the second-time winner signs
        // and chooses their reward, before held-on rewards continue.
        processUnlocks(s, "end_game", "pack_3_homelands_missions");
      }
      if (r.nextIdx >= r.order.length) {
        r.committed = true;
        emit(s, "EndGameRewardsCommitted", undefined, { order: r.order });
        processUnlocks(s, "end_game"); // end-game reveals fire after the last reward resolves
        beginWorldCompletion(s);
      }
      return s;
    }

    case "world.name": {
      if (s.phase !== "game_over" || !s.worldCompletion || s.worldCompletion.name) {
        throw new RuleViolation("No completed-world naming decision is open");
      }
      if (s.worldCompletion.namingPlayerId !== action.playerId) throw new RuleViolation("Only the selected player may name the world");
      const name = action.name.trim();
      if (!name) throw new RuleViolation("A non-empty world name is required");
      s.worldCompletion.name = name;
      s.worldName = name;
      emit(s, "WorldNamed", action.playerId, { name, gameNumber: s.gameNumber });
      return s;
    }

    case "end.turn": {
      ensurePhase(s, "end_turn");
      ensureActive(s, action.playerId);
      ensureEndTurnScars(s, p.id);
      const decision = endTurnDecision(s, p.id);
      if (!decision.canEndTurn) throw new RuleViolation("Draw your Resource card first");
      if (p.conqueredEnemyThisTurn && !decision.drawAvailable) {
        emit(s, "ResourceDrawUnavailable", p.id, { reason: "all_sources_exhausted" });
      }
      p.conqueredEnemyThisTurn = false;
      emit(s, "TurnEnded", p.id);
      advanceTurn(s);
      return s;
    }
  }
}

function maybeRoll(s: GameState) {
  const c = s.combat!;
  if (c.attackerDice === undefined || c.defenderDice === undefined) return;
  const rerollMutantOnes = s.players[c.attacker].factionId === "mutants"
    && s.players[c.defender].factionId === s.bringerOfNuclearFireFactionId;
  const attackDie = () => {
    let value = rollDie(s);
    while (rerollMutantOnes && value === 1) value = rollDie(s);
    return value;
  };
  const att = Array.from({ length: c.attackerDice }, attackDie).sort((a, b) => b - a);
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
    for (const n of neighborsOf(s, cur)) {
      const blockedByFallout = s.players[pid].factionId !== "mutants" && s.territories[n].scars.includes("fallout");
      if (!blockedByFallout && !seen.has(n) && s.territories[n].controller === pid) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return false;
}

/** Maneuver network for UI highlighting. */
export function maneuverNetwork(s: GameState, pid: PlayerId, from: TerritoryId): TerritoryId[] {
  return territoryIds(s)
    .filter((tid) => tid !== from && s.territories[tid].controller === pid && connected(s, pid, from, tid));
}

/** Whose decision is the game waiting on (for UI/turn routing)? */
export function waitingOn(s: GameState): PlayerId | undefined {
  if ((s.contentRequired?.length ?? 0) > 0) return undefined;
  if (s.legacyCards?.pendingEvent) return undefined;
  if (s.comebackChoice) return s.comebackChoice.playerId;
  if (s.missilePowerChoice) return s.missilePowerChoice.playerId;
  if (s.missionChoice) return s.missionChoice.playerId;
  if (s.phase === "game_over") {
    if (s.rewards && !s.rewards.committed) return s.rewards.order[s.rewards.nextIdx];
    if (s.worldCompletion && !s.worldCompletion.name) return s.worldCompletion.namingPlayerId;
    return undefined;
  }
  if (s.phase === "setup") {
    if (s.setup?.stage === "order_reveal") return s.setup.chooserOrder[0];
    if (s.advancedDraft?.pendingCoinClaim) return s.advancedDraft.pendingCoinClaim.playerId;
    if (s.advancedDraft && !s.advancedDraft.completed) return s.advancedDraft.pickOrder[s.advancedDraft.nextPickIdx];
    return s.setup!.chooserOrder[s.setup!.nextIdx];
  }
  const c = s.combat;
  if (c) {
    if (c.awaitingMoveIn) return c.attacker;
    if (c.natural && c.window) return legalModifierActors(s, c)[0];
    if (c.attackerDice === undefined) return c.attacker;
    if (c.defenderDice === undefined) return c.defender;
  }
  return s.turnOrder[s.activeIdx];
}

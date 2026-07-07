export type PlayerId = string;
export type TerritoryId = string;
export type CardId = string;
export type FactionId = string;

export interface PlayerState {
  id: PlayerId;
  name: string;
  factionId?: FactionId;
  redStarTokens: number;
  missiles: number;
  hand: CardId[]; // hidden resource cards (filter before sending to other clients)
  scarHand: { instanceId: string; scarId: string }[]; // new: held starter scars — identity hidden, filter to count for others
  scarCardCount: number; // public count (kept in sync with scarHand.length; identity is private)
  knockedOut: boolean;
  eliminated: boolean;
  conqueredEnemyThisTurn: boolean;
}

export interface TerritoryState {
  controller?: PlayerId;
  troops: number;
  hqFaction?: FactionId; // HQ is an independent piece keyed to its ORIGINAL faction
  city?: { type: "minor" | "major" | "world_capital"; population: number; name?: string; foundedByPlayerId?: PlayerId }; // new: full city model (SPEC §7)
  scars: string[];
  fortification?: { max: number; remaining: number };
}

export interface Sideboard {
  territoryDeck: CardId[]; // index 0 = top, face-down order hidden
  slots: (CardId | null)[]; // exactly 4 face-up ordered slots
  discard: CardId[];
  coinPile: CardId[];
  coinDiscard: CardId[];
  destroyed: CardId[];
  coinDepletionAwarded: boolean;
}

export interface CombatModifier {
  playerId: PlayerId;
  type: "missile";
  side: "att" | "def";
  dieIndex: number;
}

export interface PendingCombat {
  from: TerritoryId;
  to: TerritoryId;
  attacker: PlayerId;
  defender: PlayerId;
  attackerDice?: number;
  defenderDice?: number;
  natural?: { att: number[]; def: number[] }; // sorted desc
  modifiers: CombatModifier[];
  unmodifiable: { att: boolean[]; def: boolean[] };
  window?: { passed: PlayerId[] }; // sequential visible response loop; legal actors derived
  awaitingMoveIn?: { min: number; max: number };
}

export type Phase =
  | "setup"
  | "start_turn"
  | "join_or_recruit"
  | "expand_attack"
  | "maneuver"
  | "end_turn"
  | "game_over";

export interface RecruitBreakdown {
  territories: number;
  fromTerritories: number; // max(floor(n/3), min)
  population: number;
  continents: { id: string; base: number; globalModifier: number; namedBonus: number; total: number }[];
  tradeIns: number;
  total: number;
}

/** End-game reward selection (SPEC §7): winner rewards, held-on rewards, or pass. */ // new
export type RewardChoice = // new
  | { kind: "name_continent"; continentId: string; name: string } // new
  | { kind: "found_major_city"; territoryId: TerritoryId; name: string } // new
  | { kind: "cancel_scar"; territoryId: TerritoryId } // new
  | { kind: "change_continent_bonus"; continentId: string; delta: 1 | -1 } // new
  | { kind: "fortify_city"; territoryId: TerritoryId } // new
  | { kind: "found_minor_city"; territoryId: TerritoryId; name: string } // new
  | { kind: "upgrade_territory_card"; cardId: CardId } // new
  | { kind: "pass" }; // new

export interface GameEvent {
  seq: number;
  type: string;
  playerId?: PlayerId;
  data?: Record<string, unknown>;
}

export interface GameState {
  gameId: string;
  seed: number;
  gameNumber: number; // new: campaign game number (1 with no campaign history); rewards stop after 15
  rngState: number;
  phase: Phase;
  setup?: { chooserOrder: PlayerId[]; nextIdx: number; rolls: Record<PlayerId, number> };
  turnOrder: PlayerId[];
  activeIdx: number;
  turnNumber: number;
  players: Record<PlayerId, PlayerState>;
  territories: Record<TerritoryId, TerritoryState>;
  sideboard: Sideboard;
  recruit?: { remaining: number; breakdown: RecruitBreakdown };
  startTurnDone: boolean;
  maneuverUsed: boolean;
  factionPowers: Record<FactionId, string>; // new (9): selected starting power per faction (attaches to faction, not player)
  blockedAttackTargets: TerritoryId[]; // new (9): defensive_stand — territories locked for the rest of the active turn
  intimidation?: { territory: TerritoryId; broken: boolean }; // new (9): lower_die_intimidation — Enclave's first attack target this turn
  expandedThisTurn: number; // new (9): expansionist_supply — unoccupied territories entered this turn
  combat?: PendingCombat;
  winner?: PlayerId;
  winReason?: string;
  results?: Record<FactionId, "won" | "held_on" | "eliminated" | "unused">;
  signatures: Record<PlayerId, number>; // new: board signatures (winner auto-signs at game end; seeded by 10b)
  continents: Record<string, { name?: string; namedBy?: PlayerId; bonusMark?: number }>; // new: name_continent / change_continent_bonus rewards
  inventories: { cancelStickers: number; fortifyMarks: number; majorCities: number; minorCities: number }; // new: finite reward inventories (SPEC §7)
  cardModifications: Record<CardId, { resources?: number }>; // new: upgrade_territory_card results, overlaid on pack card data
  unlockedModules: string[]; // new (11): revealed sealed modules (seeded from campaign, extended by in-game reveals)
  pendingUnlocks: { moduleId: string; timing: "mid_game" | "end_game" }[]; // new (11): triggered but not yet revealed
  rewards?: { order: PlayerId[]; nextIdx: number; committed: boolean }; // new: post-win reward resolution (winner first, held-on clockwise)
  eventSeq: number;
  log: GameEvent[];
}

export type Action =
  | { type: "setup.choose"; playerId: PlayerId; factionId: FactionId; territoryId: TerritoryId; powerId?: string } // new (9): powerId required the first time a faction is played
  | { type: "start.buyRedStar"; playerId: PlayerId; cardIds: CardId[] }
  | { type: "start.done"; playerId: PlayerId }
  | { type: "join.enter"; playerId: PlayerId; territoryId: TerritoryId }
  | { type: "recruit.trade"; playerId: PlayerId; cardIds: CardId[] }
  | { type: "recruit.place"; playerId: PlayerId; territoryId: TerritoryId; count: number }
  | { type: "recruit.done"; playerId: PlayerId }
  | { type: "attack.expand"; playerId: PlayerId; from: TerritoryId; to: TerritoryId; troops: number }
  | { type: "attack.declare"; playerId: PlayerId; from: TerritoryId; to: TerritoryId }
  | { type: "attack.chooseAttackers"; playerId: PlayerId; count: number }
  | { type: "attack.defenderDice"; playerId: PlayerId; count: number }
  | { type: "combat.useMissile"; playerId: PlayerId; dieIndex: number }
  | { type: "combat.pass"; playerId: PlayerId }
  | { type: "attack.moveIn"; playerId: PlayerId; count: number }
  | { type: "attack.cancel"; playerId: PlayerId }
  | { type: "phase.endAttacks"; playerId: PlayerId }
  | { type: "maneuver.move"; playerId: PlayerId; from: TerritoryId; to: TerritoryId; count: number }
  | { type: "phase.endManeuver"; playerId: PlayerId }
  | { type: "end.draw"; playerId: PlayerId; choice: { slot: number } | { coin: true }; khanReinforce?: boolean } // new (9): territory_card_reinforcement opt-in
  | { type: "scar.play"; playerId: PlayerId; scarInstanceId: string; territoryId: TerritoryId } // new
  | { type: "reward.choose"; playerId: PlayerId; reward: RewardChoice } // new: end-game reward selection (10a)
  | { type: "end.turn"; playerId: PlayerId };

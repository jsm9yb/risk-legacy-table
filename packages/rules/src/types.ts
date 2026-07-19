export type PlayerId = string;
export type TerritoryId = string;
export type CardId = string;
export type FactionId = string;

export interface PlayerState {
  id: PlayerId;
  name: string;
  factionId?: FactionId;
  /** The territory this faction/player pairing began from in this game. */
  startingTerritoryId?: TerritoryId;
  /** Pack 1 draft result; also determines this player's Join the War troop count. */
  startingTroops?: number;
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
  ruin?: boolean;
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

export interface LegacyCard {
  id: string;
  sourceModuleId: string;
  title: string;
  text: string;
  reward?: 1 | 2;
}

export interface LegacyCardState {
  eventDeck: LegacyCard[];
  eventDiscard: LegacyCard[];
  eventBox: LegacyCard[];
  ongoingEvents: LegacyCard[];
  pendingEvent?: LegacyCard;
  missionDeck: LegacyCard[];
  missionBox: LegacyCard[];
  activeMission?: LegacyCard;
  privateMissionPool: LegacyCard[];
}

export type EventResolution =
  | { kind: "fortify"; territoryId: TerritoryId }
  | { kind: "reinforceCities"; placements: { territoryId: TerritoryId; count: number }[] }
  | { kind: "controlPeopleTroops"; territoryId: TerritoryId }
  | { kind: "controlPeopleManeuver"; from: TerritoryId; to: TerritoryId; count: number }
  | { kind: "riots" }
  | { kind: "resistance" }
  | { kind: "joinCauseTroops"; placements: { territoryId: TerritoryId; count: number }[] }
  | { kind: "joinCauseMission"; missionId: string }
  | { kind: "fallout" }
  | { kind: "agentOfChaos" }
  | { kind: "mutantsEvolve"; choice: "offensive" | "defensive" | "bodies" | "brains" }
  | { kind: "alienRuins"; territoryId: TerritoryId }
  | { kind: "alienReinforcements"; territoryId: TerritoryId }
  | { kind: "alienIslandCard"; slot: number };

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

export type DraftCategory = "faction" | "turnOrder" | "placementOrder" | "startingTroops" | "startingCoinCards";

export type SetupStage =
  | "order_reveal"
  | "advanced_draft"
  | "faction_selection"
  | "mission_setup"
  | "starting_placement"
  | "complete";

export interface SetupState {
  stage: SetupStage;
  rolls: Record<PlayerId, number>;
  chooserOrder: PlayerId[];
  nextIdx: number;
}

export interface AdvancedDraftPickSet {
  factionId?: FactionId;
  turnOrder?: number;
  placementOrder?: number;
  startingTroops?: number;
  startingCoinCards?: number;
}

export interface AdvancedDraftState {
  pickOrder: PlayerId[];
  nextPickIdx: number;
  picks: Record<PlayerId, AdvancedDraftPickSet>;
  available: {
    factions: FactionId[];
    turnOrder: number[];
    placementOrder: number[];
    startingTroops: number[];
    startingCoinCards: number[];
  };
  /** New interactive campaigns require the drafted player to take actual Coin cards. */
  explicitCoinClaims: boolean;
  pendingCoinClaim?: { playerId: PlayerId; total: number; remaining: number };
  completed: boolean;
}

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
  | { kind: "destroy_territory_card"; cardId: CardId } // winner permanently removes one Territory card
  | { kind: "found_minor_city"; territoryId: TerritoryId; name: string } // new
  | { kind: "upgrade_territory_card"; cardId: CardId } // new
  | { kind: "pass" }; // new

export type { GameEvent } from "./events.ts";

/** One handwritten row on the back of a physical faction card. */
export interface FactionHistoryEntry {
  gameNumber: number;
  playerId: PlayerId;
  playerName: string;
  startingTerritoryId: TerritoryId;
  result: "won" | "held_on" | "eliminated";
}

export interface GameState {
  gameId: string;
  seed: number;
  worldName: string;
  gameNumber: number; // new: campaign game number (1 with no campaign history); rewards stop after 15
  rngState: number;
  phase: Phase;
  setup?: SetupState;
  advancedDraft?: AdvancedDraftState;
  turnOrder: PlayerId[];
  activeIdx: number;
  turnNumber: number;
  players: Record<PlayerId, PlayerState>;
  territories: Record<TerritoryId, TerritoryState>;
  sideboard: Sideboard;
  legacyCards: LegacyCardState;
  recruit?: { remaining: number; breakdown: RecruitBreakdown };
  startTurnDone: boolean;
  maneuverUsed: boolean;
  factionPowers: Record<FactionId, string>; // new (9): selected starting power per faction (attaches to faction, not player)
  comebackPowers: Record<FactionId, LegacyCard>;
  factionMissilePowers: Record<FactionId, string>;
  factionWeaknesses: Record<FactionId, string>;
  mutantEvolution?: "unnatural_strength" | "mindshackle" | "defensive_cloning" | "mass_hypnosis";
  mutantEvolutionChoices: ("offensive" | "defensive" | "bodies" | "brains")[];
  bringerOfNuclearFireFactionId?: FactionId;
  alienCollaboratorFactionId?: FactionId;
  /** During Pocket 2's opening game only, the collaborator commands the arriving Alien troops. */
  alienAlliancePlayerId?: PlayerId;
  missilePowerChoice?: { playerId: PlayerId; factionId: FactionId; options: string[] };
  missilePowersUsedThisTurn: PlayerId[];
  empTerritories: TerritoryId[];
  badIntelDeniedContinents: string[];
  blockedResourceDraws: ({ slot: number } | { coin: true })[];
  protectedMutantTerritoryId?: TerritoryId;
  alienLandingRecruitPlayerId?: PlayerId;
  comebackChoice?: {
    playerId: PlayerId;
    factionId: FactionId;
    options: LegacyCard[];
    resume: "advance_turn" | "game_over";
  };
  comebackQueue: { playerId: PlayerId; factionId: FactionId; resume: "advance_turn" | "game_over" }[];
  factionHistory: Record<FactionId, FactionHistoryEntry[]>; // physical faction-card backs, seeded from campaign history
  blockedAttackTargets: TerritoryId[]; // new (9): defensive_stand — territories locked for the rest of the active turn
  intimidation?: { territory: TerritoryId; broken: boolean }; // new (9): lower_die_intimidation — Enclave's first attack target this turn
  expandedThisTurn: number; // new (9): expansionist_supply — unoccupied territories entered this turn
  expandedIntoCityThisTurn: boolean;
  stealthRecruitTerritory?: TerritoryId;
  mobileHqUsed: boolean;
  endTurnScarsApplied: boolean;
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
  contentRequired: { moduleId: string; items: string[] }[];
  hostContent: Record<string, unknown>;
  contentPause?: { resume: "nuclear_resolution" | "failed_join_elimination"; playerId?: PlayerId };
  worldCapitalTerritoryId?: TerritoryId;
  leadFactionId?: FactionId;
  alienIsland?: { territoryId: TerritoryId; name: string; connections: [TerritoryId, TerritoryId] };
  customConnections: [TerritoryId, TerritoryId][];
  capturedPrivateMissions: Record<FactionId, LegacyCard>;
  privateMissionsUsed: FactionId[];
  missionChoice?: { playerId: PlayerId; reason: "game_start" | "world_capital" };
  privateMissionProgress: {
    tradedResources: number;
    highValueTerritoryCards: number;
    forcedOccupation: boolean;
    wideBorderAtStart: boolean;
  };
  rewards?: { order: PlayerId[]; nextIdx: number; committed: boolean }; // new: post-win reward resolution (winner first, held-on clockwise)
  worldCompletion?: { namingPlayerId: PlayerId; name?: string }; // Game 15: most wins (official tie roll) names the completed world
  eventSeq: number;
  log: GameEvent[];
}

export type Action =
  | { type: "setup.acknowledgeOrder"; playerId: PlayerId }
  | { type: "draft.pick"; playerId: PlayerId; category: DraftCategory; value: string | number }
  | { type: "draft.takeStartingCoin"; playerId: PlayerId; cardId: CardId }
  | { type: "setup.choose"; playerId: PlayerId; factionId: FactionId; territoryId: TerritoryId; powerId?: string } // new (9): powerId required the first time a faction is played
  | { type: "start.buyRedStar"; playerId: PlayerId; cardIds: CardId[] }
  | { type: "start.moveHq"; playerId: PlayerId; from: TerritoryId; to: TerritoryId }
  | { type: "missilePower.choose"; playerId: PlayerId; powerId: string }
  | { type: "missilePower.rally"; playerId: PlayerId }
  | { type: "missilePower.badIntel"; playerId: PlayerId; targetPlayerId: PlayerId; continentId: string }
  | { type: "missilePower.emp"; playerId: PlayerId }
  | { type: "missilePower.interference"; playerId: PlayerId; targetPlayerId: PlayerId; choice: { slot: number } | { coin: true } }
  | { type: "start.done"; playerId: PlayerId }
  | { type: "join.enter"; playerId: PlayerId; territoryId: TerritoryId }
  | { type: "recruit.trade"; playerId: PlayerId; cardIds: CardId[]; protectTerritoryId?: TerritoryId }
  | { type: "recruit.place"; playerId: PlayerId; territoryId: TerritoryId; count: number }
  | { type: "recruit.done"; playerId: PlayerId }
  | { type: "attack.expand"; playerId: PlayerId; from: TerritoryId; to: TerritoryId; troops: number }
  | { type: "attack.declare"; playerId: PlayerId; from: TerritoryId; to: TerritoryId }
  | { type: "attack.chooseAttackers"; playerId: PlayerId; count: number }
  | { type: "attack.defenderDice"; playerId: PlayerId; count: number }
  | { type: "combat.useMissile"; playerId: PlayerId; dieIndex: number; side?: "att" | "def" }
  | { type: "combat.pass"; playerId: PlayerId }
  | { type: "attack.moveIn"; playerId: PlayerId; count: number }
  | { type: "attack.cancel"; playerId: PlayerId }
  | { type: "phase.endAttacks"; playerId: PlayerId }
  | { type: "maneuver.move"; playerId: PlayerId; from: TerritoryId; to: TerritoryId; count: number }
  | { type: "phase.endManeuver"; playerId: PlayerId }
  | { type: "end.draw"; playerId: PlayerId; choice: { slot: number } | { coin: true } | { reconSlot: number }; khanReinforce?: boolean; mindshackleTargetPlayerId?: PlayerId } // new (9): territory_card_reinforcement opt-in
  | { type: "scar.play"; playerId: PlayerId; scarInstanceId: string; territoryId: TerritoryId } // new
  | { type: "weakness.play"; playerId: PlayerId; scarInstanceId: string; factionId: FactionId }
  | { type: "reward.choose"; playerId: PlayerId; reward: RewardChoice } // new: end-game reward selection (10a)
  | { type: "world.name"; playerId: PlayerId; name: string }
  | { type: "module.supplyContent"; playerId: PlayerId; moduleId: string; item: string; content: unknown }
  | { type: "mission.foundWorldCapital"; playerId: PlayerId; founderPlayerId: PlayerId; territoryId: TerritoryId; name: string }
  | { type: "mission.complete"; playerId: PlayerId; claimantPlayerId: PlayerId; reward: 1 | 2; seaLineConnection?: [TerritoryId, TerritoryId] }
  | { type: "mission.choose"; playerId: PlayerId; missionId: string }
  | { type: "event.resolve"; playerId: PlayerId; destination: "box" | "discard" | "ongoing"; note?: string; resolution?: EventResolution }
  | { type: "comeback.choose"; playerId: PlayerId; optionId: string }
  | { type: "privateMission.capture"; playerId: PlayerId; claimantPlayerId: PlayerId; missionTitle: string }
  | { type: "privateMission.activate"; playerId: PlayerId; claimantPlayerId: PlayerId }
  | { type: "alien.placeIsland"; playerId: PlayerId; name: string; connections: [TerritoryId, TerritoryId] }
  | { type: "faction.claimPrivateMission"; playerId: PlayerId; claimantPlayerId: PlayerId }
  | { type: "end.turn"; playerId: PlayerId };
import type { GameEvent } from "./events.ts";

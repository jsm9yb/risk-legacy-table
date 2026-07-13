export type GameEventType =
  | "AdvancedDraftCardChosen" | "AdvancedDraftCompleted" | "AdvancedDraftStarted"
  | "AlienCollaboratorNamed" | "AlienIslandPlaced" | "AlienReinforcementsPlaced" | "AlienRuinsPlaced"
  | "AttackCancelled" | "AttackDeclared" | "AttackersChosen" | "AttackExhausted"
  | "BoardSigned" | "BringerMissilesGranted" | "BringerOfNuclearFireNamed" | "CampaignLegacyApplied"
  | "CityFortified" | "CoinDepletionRedStar" | "CoinDepletionTieNoAward" | "CombatResolved"
  | "ComebackPowerChoiceOpened" | "ComebackPowerChoiceUnavailable" | "ComebackPowerChosen"
  | "ContinentBonusChanged" | "ContinentNamed" | "DefenderDiceChosen" | "DiceRolled" | "DrawNotEligible"
  | "EndGameRewardsCommitted" | "EndGameRewardsOpened" | "EndGameRewardsSkipped"
  | "EventCardDrawn" | "EventCardResolved" | "EventCardsAdded" | "EventEffectApplied" | "EventRedStarGained" | "EventResourceCardTaken"
  | "FactionChosen" | "FactionPowerApplied" | "FactionPowerChosen" | "FactionPrivateMissionCompleted"
  | "FalloutEventLosses" | "FalloutLosses" | "FortificationDurabilityMarked" | "FortificationExpired"
  | "GameStarted" | "GameWon" | "JoinedTheWar" | "JoinTheWarRequired" | "LeadFactionCapitalBonus"
  | "LeadFactionMissionChoiceOpened" | "LeadFactionMissionChosen" | "LegacyCardDecksSetup"
  | "MajorCityFounded" | "Maneuvered" | "MinorCityFounded" | "MissileCommitted"
  | "MissilePowerChoiceOpened" | "MissilePowerChosen" | "MissilePowerUsed"
  | "MissionCardsAdded" | "MissionCompleted" | "MissionReplaced" | "ModifierPassed"
  | "ModuleContentRequired" | "ModuleContentSupplied" | "ModuleRevealed" | "ModuleTriggered"
  | "MutantEvolutionApplied" | "MutantsEvolved" | "NuclearKnockout" | "NuclearOpeningResolved"
  | "PhaseChanged" | "PlayerEliminated" | "PlayerKnockedOut" | "PrivateMissionActivated" | "PrivateMissionCaptured" | "PrivateMissionCardsAdded"
  | "RecruitCalculated" | "RedStarGained" | "RedStarPurchased" | "ResourceCardDrawn" | "ResourceCardsTraded" | "ResourceDrawUnavailable"
  | "RewardPassed" | "RiotTested" | "ScarAttrition" | "ScarCancelled" | "ScarCardsDealt" | "ScarCardsNotDealt" | "ScarPlayed" | "ScarReinforcement"
  | "SeaLineFounded" | "SetupChooserOrder" | "SetupOrderRoll" | "SideboardRefilled" | "SideboardSetup"
  | "TerritoryCardDestroyed" | "TerritoryCardUpgraded" | "TerritoryCleared" | "TerritoryConquered" | "TerritoryDeckReshuffled" | "TerritoryExpanded"
  | "TimingWindowOpened" | "TroopsPlaced" | "TurnEnded" | "TurnStarted" | "UnusedFactionsRecorded"
  | "WorldCapitalFounded" | "WorldNamed" | "WorldNamingOpened" | "WorldNamingRoll";

type AnyPayload = Record<string, unknown>;

export type GameEventPayloads = Record<GameEventType, AnyPayload | undefined> & {
  TroopsPlaced: { territory: string; count: number; remaining: number };
  FactionChosen: { factionId: string; territory: string; troops: number };
  JoinedTheWar: { territory: string; troops: number };
  TerritoryExpanded: { from: string; to: string; troops: number; resistanceLosses: number };
  AttackDeclared: { from: string; to: string; defender: string };
  DiceRolled: { att: number[]; def: number[] };
  TerritoryConquered: { territory: string; from: string; moved: number; defender: string; hqCaptured: string | null };
  Maneuvered: { from: string; to: string; count: number };
  PhaseChanged: { phase: string };
  MissileCommitted: { side: "att" | "def"; dieIndex: number; naturalValue: number };
  GameWon: { reason: string; results: AnyPayload };
};

export type GameEventOf<T extends GameEventType> = {
  seq: number;
  type: T;
  playerId?: string;
  data?: GameEventPayloads[T];
};

export type GameEvent = { [T in GameEventType]: GameEventOf<T> }[GameEventType];


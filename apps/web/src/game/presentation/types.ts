import type { FactionId, GameState, PlayerId, TerritoryId } from "@risk/rules";

export type TransitionSource = "local" | "network" | "reconnect" | "rewind" | "replay";
export type MotionPreference = "full" | "reduced" | "instant";
export type PresentationStatus = "loading" | "idle" | "presenting" | "catching_up" | "resyncing" | "failed";

export type GameplayCommand =
  | { type: "battle.prepare"; from: TerritoryId; to: TerritoryId; attackCount?: number; defenseCount?: number }
  | { type: "setup.faction"; playerId: PlayerId; factionId: FactionId }
  | { type: "score.change"; changes: { playerId: PlayerId; before: number; after: number }[]; leadersBefore: PlayerId[]; leadersAfter: PlayerId[]; territoryId?: TerritoryId }
  | { type: "battle.modify"; from: TerritoryId; to: TerritoryId; side: "att" | "def"; dieIndex: number; naturalValue: number; finalValue: number; source: string }
  | { type: "reward.eligible"; playerId: PlayerId; territoryId: TerritoryId }
  | { type: "recruitment.show"; playerId: PlayerId; total: number; fromTerritories: number; population: number; continents: { id: string; total: number }[] }
  | { type: "cards.transfer"; playerId: PlayerId; kind: "draw" | "trade" | "purchase" | "destroy" | "upgrade" | "refill"; count: number; resources?: number; troops?: number; territoryId?: TerritoryId; slot?: number; source?: "territory" | "coin"; cardIds?: string[] }
  | { type: "turn.handoff"; playerId: PlayerId; stage: "start" | "end"; turn?: number }
  | { type: "setup.claim"; playerId: PlayerId; territoryId: TerritoryId; factionId: FactionId; count: number }
  | { type: "setup.order"; order: string[]; rolls?: { playerId: string; value: number }[]; rounds?: { playerId: string; value: number }[][] }
  | { type: "battle.compare"; from: TerritoryId; to: TerritoryId; attack: number[]; defense: number[]; comparisons: { att: number; def: number; winner: "att" | "def" }[] }
  | { type: "power.activate"; playerId: PlayerId; powerId: string; territoryId?: TerritoryId; from?: TerritoryId; to?: TerritoryId; dieIndex?: number; delta?: number; side?: "att" | "def" }
  | { type: "hq.capture"; playerId: PlayerId; territoryId: TerritoryId; factionId: FactionId }
  | { type: "city.damage"; territoryId: TerritoryId; remaining: number }
  | { type: "player.eliminate"; playerId: PlayerId; kind?: "knocked_out" | "eliminated"; by?: PlayerId }
  | { type: "campaign.recap"; title: string; items: string[] }
  | { type: "continent.control"; playerId: PlayerId; continentId: string; territories: TerritoryId[]; gained: boolean };

export type PresentationEvent =
  | { type: "gameplay.present"; seq: number; command: GameplayCommand }
  | { type: "troops.placed"; seq: number; playerId: PlayerId; territoryId: TerritoryId; count: number }
  | { type: "territory.expanded"; seq: number; playerId: PlayerId; from: TerritoryId; to: TerritoryId; moved: number; losses: number }
  | { type: "battle.declared"; seq: number; attackerId: PlayerId; defenderId: PlayerId; from: TerritoryId; to: TerritoryId }
  | { type: "dice.rolled"; seq: number; from: TerritoryId; to: TerritoryId; attack: number[]; defense: number[] }
  | { type: "battle.resolved"; seq: number; from: TerritoryId; to: TerritoryId; attackerLosses: number; defenderLosses: number; modifiers?: Extract<GameplayCommand, {type: "battle.modify"}>[]; comparison?: Extract<GameplayCommand, {type: "battle.compare"}> }
  | { type: "territory.conquered"; seq: number; playerId: PlayerId; from: TerritoryId; to: TerritoryId; moved: number; capturedHqFactionId?: FactionId; drawEarned?: boolean }
  | { type: "army.maneuvered"; seq: number; playerId: PlayerId; from: TerritoryId; to: TerritoryId; count: number }
  | { type: "scar.applied"; seq: number; playerId: PlayerId; territoryId: TerritoryId; scarId: string }
  | { type: "scar.attrition"; sourceType?: string; seq: number; playerId: PlayerId; territoryId: TerritoryId; delta: number }
  | { type: "city.founded"; seq: number; playerId: PlayerId; territoryId: TerritoryId; cityType: string; name: string }
  | { type: "city.fortified"; seq: number; playerId: PlayerId; territoryId: TerritoryId }
  | { type: "hq.moved"; seq: number; playerId: PlayerId; from: TerritoryId; to: TerritoryId; factionId: FactionId }
  | { type: "redStar.gained"; seq: number; playerId: PlayerId; source: string; territoryId?: TerritoryId }
  | { type: "missile.committed"; seq: number; from: TerritoryId; to: TerritoryId; side: "att" | "def"; playerId?: PlayerId; dieIndex?: number; naturalValue?: number }
  | { type: "module.revealed"; seq: number; moduleId: string; timing: "mid_game" | "end_game" }
  | { type: "nuclear.resolved"; seq: number; territories: TerritoryId[] }
  | { type: "alienIsland.placed"; seq: number; playerId: PlayerId; territoryId: TerritoryId; connections: [TerritoryId, TerritoryId] }
  | { type: "phase.changed"; seq: number; phase: GameState["phase"] }
  | { type: "game.won"; seq: number; playerId: PlayerId; reason: string }
  | { type: "legacy.ritual"; seq: number; ritual: "board.signed" | "continent.named" | "card.upgraded" | "world.named" | "ruins.placed" | "card.destroyed" | "continent.bonus" | "scar.cancelled"; text?: string; playerId?: PlayerId; territoryId?: TerritoryId; cardId?: string; resources?: number }
  | { type: "presentation.none"; seq: number; sourceType: string }
  | { type: "presentation.unknown"; seq: number; sourceType: string };

export interface StateTransition {
  previous: GameState;
  next: GameState;
  events: readonly PresentationEvent[];
  source: TransitionSource;
  receivedAt: number;
}

export interface TableRenderModel {
  state: GameState;
  revision: number;
}

export interface TableInteractionModel {
  preview?: import("../interaction/preview.ts").TableActionPreview;
  selectedTerritoryId?: TerritoryId;
  intents: Readonly<Record<TerritoryId, string>>;
  /** Ephemeral cross-surface emphasis, such as hovering a face-up Territory card. */
  emphasizedTerritoryId?: TerritoryId;
  /** Informational board mode keyed by territory; omitted during ordinary play. */
  resourceValues?: Readonly<Partial<Record<TerritoryId, number>>>;
}

export interface TableViewport {
  width: number;
  height: number;
  devicePixelRatio: number;
}

export interface TableSceneDiagnostics {
  displayedRevision?: number;
  displayedWorldName?: string;
  displayedTerritories?: Record<string, {troops: number; controller?: string}>;
  renderer: "pixi-webgl" | "pixi-webgpu" | "recording" | "dom-fallback";
  quality: "high" | "balanced" | "low";
  texturesBytes: number;
  activeSprites: number;
  activeParticles: number;
  contextLosses: number;
  frameTimeP95?: number;
  textResolution?: number;
  minimumTerritoryLabelAlpha?: number;
  maximumTerritoryLabelAlpha?: number;
  missingHqAtlasIds?: string[];
  hqFallbacks?: number;
  boundaryOcclusions?: number;
  placedContentAboveTerritoryLines?: boolean;
  resourceValueBadges?: number;
  emphasizedTerritoryId?: TerritoryId;
}

export type SceneCommand = GameplayCommand
  | { type: "camera.frame"; from?: TerritoryId; to?: TerritoryId }
  | { type: "army.anticipate"; territoryId: TerritoryId }
  | { type: "army.place"; territoryId: TerritoryId; playerId: PlayerId; count: number }
  | { type: "army.move"; from: TerritoryId; to: TerritoryId; count: number; tone: "expand" | "maneuver" | "conquest"; route?: TerritoryId[] }
  | { type: "army.remove"; territoryId: TerritoryId; count: number; side: "attacker" | "defender" | "attrition" }
  | { type: "battle.dice"; from: TerritoryId; to: TerritoryId; attack: number[]; defense: number[] }
  | { type: "battle.impact"; from: TerritoryId; to: TerritoryId }
  | { type: "territory.conquest"; territoryId: TerritoryId; playerId: PlayerId }
  | { type: "scar.apply"; territoryId: TerritoryId; scarId: string }
  | { type: "city.place"; territoryId: TerritoryId; cityType: string; name: string }
  | { type: "city.fortify"; territoryId: TerritoryId }
  | { type: "hq.move"; from: TerritoryId; to: TerritoryId; factionId: FactionId }
  | { type: "redStar.gain"; playerId: PlayerId; territoryId?: TerritoryId }
  | { type: "missile.commit"; from: TerritoryId; to: TerritoryId; side: "att" | "def"; playerId?: PlayerId; dieIndex?: number; naturalValue?: number }
  | { type: "module.reveal"; moduleId: string }
  | { type: "nuclear.resolve"; territories: TerritoryId[] }
  | { type: "alienIsland.place"; territoryId: TerritoryId; connections: [TerritoryId, TerritoryId] }
  | { type: "phase.change"; phase: GameState["phase"] }
  | { type: "game.victory"; playerId: PlayerId; reason: string }
  | { type: "legacy.ritual"; ritual: "board.signed" | "continent.named" | "card.upgraded" | "world.named" | "ruins.placed" | "card.destroyed" | "continent.bonus" | "scar.cancelled"; text?: string; territoryId?: TerritoryId; cardId?: string; playerId?: PlayerId; resources?: number }
  | { type: "table.resync"; reason: string };

export interface VisualBeat {
  label: string;
  commands: readonly SceneCommand[];
  durationMs: number;
  commit?: "event" | "transition";
  /** Visual-only snapshot committed after this beat, never used for rule decisions. */
  visualState?: import("@risk/rules").GameState;
}

export interface VisualSequence {
  eventSeq: number;
  beats: readonly VisualBeat[];
  estimatedDurationMs: number;
}

export interface PresentationSnapshot {
  replay?: { title: string; detail: string; index: number; total: number; side: "before" | "after"; provenance: "captured" | "permanent" | "current" };
  status: PresentationStatus;
  activeEventSeq?: number;
  activeBeat?: string;
  queuedTransitions: number;
  canSkip: boolean;
  inputBlocked: boolean;
  failure?: string;
}

export type SettleReason = "initial" | "gap" | "queue_overflow" | "reconnect" | "rewind" | "context_loss" | "unknown_event";

import type { FactionId, GameState, PlayerId, TerritoryId } from "@risk/rules";

export type TransitionSource = "local" | "network" | "reconnect" | "rewind" | "replay";
export type MotionPreference = "full" | "reduced" | "instant";
export type PresentationStatus = "loading" | "idle" | "presenting" | "catching_up" | "resyncing" | "failed";

export type PresentationEvent =
  | { type: "troops.placed"; seq: number; playerId: PlayerId; territoryId: TerritoryId; count: number }
  | { type: "territory.expanded"; seq: number; playerId: PlayerId; from: TerritoryId; to: TerritoryId; moved: number; losses: number }
  | { type: "battle.declared"; seq: number; attackerId: PlayerId; defenderId: PlayerId; from: TerritoryId; to: TerritoryId }
  | { type: "dice.rolled"; seq: number; from: TerritoryId; to: TerritoryId; attack: number[]; defense: number[] }
  | { type: "battle.resolved"; seq: number; from: TerritoryId; to: TerritoryId; attackerLosses: number; defenderLosses: number }
  | { type: "territory.conquered"; seq: number; playerId: PlayerId; from: TerritoryId; to: TerritoryId; moved: number; capturedHqFactionId?: FactionId }
  | { type: "army.maneuvered"; seq: number; playerId: PlayerId; from: TerritoryId; to: TerritoryId; count: number }
  | { type: "scar.applied"; seq: number; playerId: PlayerId; territoryId: TerritoryId; scarId: string }
  | { type: "scar.attrition"; seq: number; playerId: PlayerId; territoryId: TerritoryId; delta: number }
  | { type: "city.founded"; seq: number; playerId: PlayerId; territoryId: TerritoryId; cityType: string; name: string }
  | { type: "city.fortified"; seq: number; playerId: PlayerId; territoryId: TerritoryId }
  | { type: "hq.moved"; seq: number; playerId: PlayerId; from: TerritoryId; to: TerritoryId; factionId: FactionId }
  | { type: "redStar.gained"; seq: number; playerId: PlayerId; source: string; territoryId?: TerritoryId }
  | { type: "missile.committed"; seq: number; playerId: PlayerId; from: TerritoryId; to: TerritoryId; side: "att" | "def" }
  | { type: "module.revealed"; seq: number; moduleId: string; timing: "mid_game" | "end_game" }
  | { type: "nuclear.resolved"; seq: number; territories: TerritoryId[] }
  | { type: "alienIsland.placed"; seq: number; playerId: PlayerId; territoryId: TerritoryId; connections: [TerritoryId, TerritoryId] }
  | { type: "phase.changed"; seq: number; phase: GameState["phase"] }
  | { type: "game.won"; seq: number; playerId: PlayerId; reason: string }
  | { type: "legacy.ritual"; seq: number; ritual: "board.signed" | "continent.named" | "card.upgraded" | "world.named" | "ruins.placed"; playerId?: PlayerId; territoryId?: TerritoryId }
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
  selectedTerritoryId?: TerritoryId;
  intents: Readonly<Record<TerritoryId, string>>;
}

export interface TableViewport {
  width: number;
  height: number;
  devicePixelRatio: number;
}

export interface TableSceneDiagnostics {
  renderer: "pixi-webgl" | "pixi-webgpu" | "recording" | "dom-fallback";
  quality: "high" | "balanced" | "low";
  texturesBytes: number;
  activeSprites: number;
  activeParticles: number;
  contextLosses: number;
  frameTimeP95?: number;
  textResolution?: number;
  minimumTerritoryLabelAlpha?: number;
  missingHqAtlasIds?: string[];
  hqFallbacks?: number;
}

export type SceneCommand =
  | { type: "camera.frame"; from?: TerritoryId; to?: TerritoryId }
  | { type: "army.anticipate"; territoryId: TerritoryId }
  | { type: "army.place"; territoryId: TerritoryId; playerId: PlayerId; count: number }
  | { type: "army.move"; from: TerritoryId; to: TerritoryId; count: number; tone: "expand" | "maneuver" | "conquest" }
  | { type: "army.remove"; territoryId: TerritoryId; count: number; side: "attacker" | "defender" | "attrition" }
  | { type: "battle.dice"; from: TerritoryId; to: TerritoryId; attack: number[]; defense: number[] }
  | { type: "battle.impact"; from: TerritoryId; to: TerritoryId }
  | { type: "territory.conquest"; territoryId: TerritoryId; playerId: PlayerId }
  | { type: "scar.apply"; territoryId: TerritoryId; scarId: string }
  | { type: "city.place"; territoryId: TerritoryId; cityType: string; name: string }
  | { type: "city.fortify"; territoryId: TerritoryId }
  | { type: "hq.move"; from: TerritoryId; to: TerritoryId; factionId: FactionId }
  | { type: "redStar.gain"; playerId: PlayerId; territoryId?: TerritoryId }
  | { type: "missile.commit"; from: TerritoryId; to: TerritoryId; side: "att" | "def" }
  | { type: "module.reveal"; moduleId: string }
  | { type: "nuclear.resolve"; territories: TerritoryId[] }
  | { type: "alienIsland.place"; territoryId: TerritoryId; connections: [TerritoryId, TerritoryId] }
  | { type: "phase.change"; phase: GameState["phase"] }
  | { type: "game.victory"; playerId: PlayerId; reason: string }
  | { type: "legacy.ritual"; ritual: "board.signed" | "continent.named" | "card.upgraded" | "world.named" | "ruins.placed"; territoryId?: TerritoryId }
  | { type: "table.resync"; reason: string };

export interface VisualBeat {
  label: string;
  commands: readonly SceneCommand[];
  durationMs: number;
  commit?: "event" | "transition";
}

export interface VisualSequence {
  eventSeq: number;
  beats: readonly VisualBeat[];
  estimatedDurationMs: number;
}

export interface PresentationSnapshot {
  status: PresentationStatus;
  activeEventSeq?: number;
  queuedTransitions: number;
  canSkip: boolean;
  inputBlocked: boolean;
  failure?: string;
}

export type SettleReason = "initial" | "gap" | "queue_overflow" | "reconnect" | "rewind" | "context_loss" | "unknown_event";

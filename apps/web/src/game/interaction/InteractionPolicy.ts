import type { Action, FactionId, GameState, PlayerId, TerritoryId } from "@risk/rules";

export type InteractionMode = "setup" | "recruit" | "expand_attack" | "maneuver" | "reward" | "scar" | "spectator" | "inspect";
export type TerritoryIntent = "selected" | "start" | "recruit" | "attack" | "maneuver" | "inspect" | "illegal" | "spectator";

export interface InteractionModel {
  mode: InteractionMode;
  territories: Readonly<Record<TerritoryId, TerritoryIntent>>;
  selectedTerritoryId?: TerritoryId;
  instruction: string;
}

export interface InteractionInput {
  state: GameState;
  actorId?: PlayerId;
  viewerId?: PlayerId;
  selectedTerritoryId?: TerritoryId;
  setupFactionId?: FactionId;
  setupPowerId?: string;
  placeCount?: number;
  moveCount?: number;
  expandCount?: number;
  overrideMode?: "reward" | "scar";
}

export type InteractionResult =
  | { kind: "selection"; selection?: TerritoryId }
  | { kind: "action"; action: Action }
  | { kind: "explanation"; message: string }
  | { kind: "none" };

export interface InteractionPolicy {
  derive(input: InteractionInput): InteractionModel;
  activate(territoryId: TerritoryId, input: InteractionInput): InteractionResult;
}


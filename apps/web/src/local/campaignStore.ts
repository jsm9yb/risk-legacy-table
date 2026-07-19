import {
  applyGameToCampaign,
  applyCampaignPreparationAction,
  createUnpreparedCampaign,
  createGame,
  initialCampaign,
  isCampaignPrepared,
  type CampaignPreparationAction,
  type CampaignState,
  type GameState,
} from "@risk/rules";
import type { LocalConfig } from "../App.tsx";
import { CURRENT_CAMPAIGN_SCHEMA_VERSION, CURRENT_GAME_SCHEMA_VERSION, CURRENT_LOCAL_SAVE_VERSION, migrateLocalSave, validateLocalSaveShape } from "./migrations.ts";

export const LOCAL_CAMPAIGN_KEY = "risk-legacy.localCampaign.v1";
export const LOCAL_CAMPAIGN_VERSION = CURRENT_LOCAL_SAVE_VERSION;

export interface LocalCampaignSave {
  version: typeof LOCAL_CAMPAIGN_VERSION;
  schema: { save: number; game: number; campaign: number };
  id: string;
  metadata: {
    worldName: string;
    createdAt: string;
    updatedAt: string;
  };
  players: { id: string; name: string }[];
  seed: number;
  campaignState: CampaignState;
  activeGame?: GameState;
  rewind?: { checkpoints: GameState[]; locked: boolean };
  completedSummaries: {
    gameId: string;
    gameNumber: number;
    winner?: string;
    completedAt: string;
  }[];
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function normalizeActiveGame(state: GameState | undefined) {
  if (!state) return state;
  state.legacyCards ??= {
    eventDeck: [], eventDiscard: [], eventBox: [], ongoingEvents: [],
    missionDeck: [], missionBox: [], privateMissionPool: [],
  };
  state.legacyCards.privateMissionPool ??= [];
  state.endTurnScarsApplied ??= false;
  state.comebackPowers ??= {};
  state.comebackQueue ??= [];
  state.capturedPrivateMissions ??= {};
  state.privateMissionsUsed ??= [];
  state.factionMissilePowers ??= {};
  state.factionWeaknesses ??= {};
  state.mutantEvolutionChoices ??= [];
  state.missilePowersUsedThisTurn ??= [];
  state.empTerritories ??= [];
  state.badIntelDeniedContinents ??= [];
  state.blockedResourceDraws ??= [];
  state.customConnections ??= [];
  state.privateMissionProgress ??= {
    tradedResources: 0, highValueTerritoryCards: 0, forcedOccupation: false, wideBorderAtStart: false,
  };
  if (state.setup && !state.setup.stage) {
    state.setup.stage = state.advancedDraft && !state.advancedDraft.completed ? "advanced_draft" : "faction_selection";
  }
  if (state.advancedDraft) state.advancedDraft.explicitCoinClaims ??= false;
  return state;
}

function normalizeCampaignState(state: CampaignState) {
  state.factionMissilePowers ??= {};
  state.factionWeaknesses ??= {};
  state.mutantEvolutionChoices ??= [];
  state.factionPrivateMissions ??= {};
  state.board.ruins ??= [];
  state.board.customConnections ??= [];
  if (state.gameNumber === 0 && state.preparation && state.preparation.stage !== "complete") {
    if (state.preparation.stage !== "review") state.preparation.stage = "resource_stickers";
    state.preparation.factionPowerChoices = {};
    state.factionPowerChoices = {};
  }
  return state;
}

export function loadLocalCampaign(storage: StorageLike = window.localStorage): LocalCampaignSave | null {
  const raw = storage.getItem(LOCAL_CAMPAIGN_KEY);
  if (!raw) return null;
  try {
    const migrated = migrateLocalSave(JSON.parse(raw));
    if (!migrated.value || migrated.error || validateLocalSaveShape(migrated.value).length) return null;
    const save = migrated.value as LocalCampaignSave;
    save.campaignState = normalizeCampaignState(save.campaignState);
    save.activeGame = normalizeActiveGame(save.activeGame);
    if (save.rewind) save.rewind.checkpoints = save.rewind.checkpoints.map((checkpoint) => normalizeActiveGame(checkpoint)!);
    const interactiveFirstWorld = save.campaignState.gameNumber === 0
      && save.campaignState.preparation?.resourceStickers.length === 12;
    if (interactiveFirstWorld) {
      save.campaignState.factionPowerChoices = {};
      save.campaignState.preparation!.factionPowerChoices = {};
      const resetUnchosenSetupPowers = (game: GameState | undefined) => {
        if (game?.gameNumber === 1 && game.phase === "setup" && Object.values(game.players).every((player) => !player.factionId)) game.factionPowers = {};
      };
      resetUnchosenSetupPowers(save.activeGame);
      for (const checkpoint of save.rewind?.checkpoints ?? []) resetUnchosenSetupPowers(checkpoint);
    }
    return save;
  } catch {
    return null;
  }
}

export function saveLocalCampaign(save: LocalCampaignSave, storage: StorageLike = window.localStorage) {
  const next: LocalCampaignSave = {
    ...save,
    metadata: { ...save.metadata, updatedAt: new Date().toISOString() },
  };
  storage.setItem(LOCAL_CAMPAIGN_KEY, JSON.stringify(next));
  return next;
}

export function clearLocalCampaign(storage: StorageLike = window.localStorage) {
  storage.removeItem(LOCAL_CAMPAIGN_KEY);
}

export function startLocalCampaign(config: LocalConfig, storage: StorageLike = window.localStorage) {
  const campaignState = config.customization
    ? initialCampaign(config.worldName ?? "An Unnamed World", config.customization)
    : createUnpreparedCampaign(config.worldName ?? "An Unnamed World", config.players.map((player, seat) => ({
      playerId: player.id,
      name: player.name,
      seat,
    })));
  const id = `local-${globalThis.crypto.randomUUID()}`;
  const activeGame = isCampaignPrepared(campaignState) ? createGame({
    gameId: `${id}-g${campaignState.gameNumber + 1}`, seed: config.seed, players: config.players, campaign: campaignState,
  }) : undefined;
  return saveLocalCampaign({
    version: LOCAL_CAMPAIGN_VERSION,
    schema: { save: LOCAL_CAMPAIGN_VERSION, game: CURRENT_GAME_SCHEMA_VERSION, campaign: CURRENT_CAMPAIGN_SCHEMA_VERSION },
    id,
    metadata: {
      worldName: campaignState.worldName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    players: config.players,
    seed: config.seed,
    campaignState,
    activeGame,
    rewind: activeGame ? { checkpoints: [structuredClone(activeGame)], locked: false } : undefined,
    completedSummaries: [],
  }, storage);
}

export function applyLocalPreparationAction(save: LocalCampaignSave, action: CampaignPreparationAction, storage: StorageLike = window.localStorage) {
  if (save.activeGame) throw new Error("Campaign preparation cannot change after a game session exists");
  const campaignState = applyCampaignPreparationAction(save.campaignState, action);
  return saveLocalCampaign({ ...save, campaignState }, storage);
}

export function persistActiveGame(save: LocalCampaignSave, activeGame: GameState, storage: StorageLike = window.localStorage) {
  return saveLocalCampaign({ ...save, activeGame }, storage);
}

export function foldCompletedLocalGame(save: LocalCampaignSave, finished: GameState, storage: StorageLike = window.localStorage) {
  const campaignState = applyGameToCampaign(save.campaignState, finished);
  return saveLocalCampaign({
    ...save,
    campaignState,
    activeGame: undefined,
    rewind: undefined,
    completedSummaries: [
      ...save.completedSummaries,
      {
        gameId: finished.gameId,
        gameNumber: finished.gameNumber,
        winner: finished.winner,
        completedAt: new Date().toISOString(),
      },
    ],
  }, storage);
}

export function createNextLocalGame(save: LocalCampaignSave, seed = Math.floor(Math.random() * 2 ** 31), storage: StorageLike = window.localStorage) {
  if (!isCampaignPrepared(save.campaignState)) throw new Error("Prepare the World must be sealed before creating the next game");
  const activeGame = createGame({
    gameId: `${save.id}-g${save.campaignState.gameNumber + 1}`,
    seed,
    players: save.players,
    campaign: save.campaignState,
  });
  return saveLocalCampaign({
    ...save,
    seed,
    activeGame,
    rewind: { checkpoints: [structuredClone(activeGame)], locked: false },
  }, storage);
}

export function localLegacyDone(state: GameState) {
  return !!state.winner
    && (!state.rewards || state.rewards.committed)
    && (!state.worldCompletion || !!state.worldCompletion.name)
    && !state.comebackChoice
    && !state.missilePowerChoice
    && !state.missionChoice
    && (state.comebackQueue?.length ?? 0) === 0
    && (state.contentRequired?.length ?? 0) === 0;
}

// canonical cross-game CampaignState (SPEC §7, §10).
// Carry: board scars, cities, fortifications, continent names/bonus marks, destroyed/upgraded
// cards, signatures, faction-power choices/results, scar + reward inventories, unlock flags,
// world name. Do NOT carry: troops, control, hands, unplayed missiles, Red-Star tokens,
// or transient turn/combat state.
import { contentPack, factionDefinitions, ruleValue } from "@risk/content";
import type { CardId, FactionHistoryEntry, FactionId, GameState, LegacyCard, PlayerId, TerritoryId } from "./types.ts";

export type GameResult = "won" | "held_on" | "eliminated" | "unused";

export type CampaignPreparationStage = "faction_powers" | "resource_stickers" | "review" | "complete";

export interface CampaignPreparationParticipant {
  playerId: PlayerId;
  name: string;
  seat: number;
}

export interface CampaignResourceSticker {
  stickerId: string;
  cardId?: CardId;
  slot?: 1 | 2;
  placedBy?: PlayerId;
  sequence?: number;
}

export interface CampaignPreparationState {
  stage: CampaignPreparationStage;
  participants: CampaignPreparationParticipant[];
  actorIndex: number;
  factionPowerChoices: Record<FactionId, string>;
  resourceStickers: CampaignResourceSticker[];
  reviewConfirmedBy?: PlayerId;
  sealedAt?: string;
}

export type CampaignPreparationAction =
  | { type: "preparation.chooseFactionPower"; playerId: PlayerId; factionId: FactionId; powerId: string }
  | { type: "preparation.placeResourceSticker"; playerId: PlayerId; stickerId: string; cardId: CardId; slot: 1 | 2 }
  | { type: "preparation.randomizeResourceStickers"; playerId: PlayerId; placements: { stickerId: string; cardId: CardId; slot: 1 | 2 }[] }
  | { type: "preparation.confirmReview"; playerId: PlayerId }
  | { type: "preparation.seal"; playerId: PlayerId };

export interface CampaignState {
  worldName: string;
  gameNumber: number; // completed games so far; starter reward changes stop after Game 15
  unlockedModules: string[];
  contentRequired: { moduleId: string; items: string[] }[]; // unlocks paused on host-entered card text (cleared by the import wizard)
  hostContent: Record<string, unknown>; // host-entered card text, keyed `${moduleId}.${item}`
  optionalVariantId?: string;
  completedWorld?: { namedByPlayerId: PlayerId; completedAtGame: number };
  signatures: Record<PlayerId, number>;
  factionPowerChoices: Record<string, string>; // factionId -> selected starting power
  /** Present on campaigns created by the interactive pre-Game-1 ritual. Absence is a prepared legacy campaign. */
  preparation?: CampaignPreparationState;
  factionComebackPowers: Record<string, LegacyCard>;
  factionMissilePowers: Record<string, string>;
  factionWeaknesses: Record<string, string>;
  mutantEvolution?: GameState["mutantEvolution"];
  mutantEvolutionChoices: GameState["mutantEvolutionChoices"];
  bringerOfNuclearFireFactionId?: string;
  alienCollaboratorFactionId?: string;
  factionResults: Record<string, GameResult[]>;
  factionHistory: Record<string, FactionHistoryEntry[]>;
  foundedMinorCities: number; // Pack 1 trigger counter
  worldCapitalTerritoryId?: TerritoryId;
  leadFactionId?: string;
  factionPrivateMissions: Record<string, LegacyCard>;
  alienIsland?: { territoryId: TerritoryId; name: string; connections: [TerritoryId, TerritoryId] };
  board: {
    scars: { territoryId: TerritoryId; scarId: string }[];
    ruins: TerritoryId[];
    customConnections: [TerritoryId, TerritoryId][];
    cities: { territoryId: TerritoryId; type: "minor" | "major" | "world_capital"; name: string; foundedByPlayerId: PlayerId }[];
    fortifications: { territoryId: TerritoryId; durability: number }[];
    continentNames: Record<string, { name: string; namedBy: PlayerId }>; // namedBy carries the personal +1 (SPEC §7)
    continentBonusMarks: Record<string, number>;
    cardModifications: { cardId: string; destroyed?: boolean; resources?: number }[];
  };
  inventories: {
    cancelStickers: number;
    fortifyMarks: number;
    majorCities: number;
    minorCities: number;
    scarInstances: Record<string, number>; // physical scar instances remaining (played = consumed forever)
  };
}

export interface InitialCampaignCustomization {
  /** Optional physical-game import: exactly one legal green starting power for each base faction. */
  factionPowerChoices?: Record<string, string>;
  /** Twelve Territory card ids, one entry per resource sticker; a card may appear at most twice. */
  resourceStickerCardIds?: string[];
}

export const WORLD_RESOURCE_STICKER_COUNT = 12;

const worldResourceStickers = (): CampaignResourceSticker[] => Array.from(
  { length: WORLD_RESOURCE_STICKER_COUNT },
  (_, index) => ({ stickerId: `world-coin-${String(index + 1).padStart(2, "0")}` }),
);

function validatePreparationParticipants(participants: CampaignPreparationParticipant[]) {
  if (participants.length < 3 || participants.length > 5) throw new Error("Prepare the World requires 3-5 seated players");
  const ids = new Set<string>();
  const seats = new Set<number>();
  for (const participant of participants) {
    if (!participant.playerId || !participant.name.trim()) throw new Error("Every preparation participant needs an id and name");
    if (!Number.isInteger(participant.seat) || participant.seat < 0) throw new Error("Preparation seats must be non-negative integers");
    if (ids.has(participant.playerId) || seats.has(participant.seat)) throw new Error("Preparation participants and seats must be unique");
    ids.add(participant.playerId);
    seats.add(participant.seat);
  }
}

/** Create a fresh world whose permanent pre-Game-1 choices have not yet been made. */
export function createUnpreparedCampaign(worldName: string, participants: CampaignPreparationParticipant[] = []): CampaignState {
  if (participants.length) validatePreparationParticipants(participants);
  const campaign = initialCampaign(worldName);
  campaign.factionPowerChoices = {};
  campaign.board.cardModifications = [];
  campaign.preparation = {
    stage: "resource_stickers",
    participants: participants.map((participant) => ({ ...participant })),
    actorIndex: 0,
    factionPowerChoices: {},
    resourceStickers: worldResourceStickers(),
  };
  return campaign;
}

/** Snapshot the clockwise seats when LAN preparation begins. */
export function beginCampaignPreparation(campaign: CampaignState, participants: CampaignPreparationParticipant[]): CampaignState {
  if (campaign.gameNumber !== 0) throw new Error("Prepare the World is only available before Game 1");
  if (!campaign.preparation || campaign.preparation.stage === "complete") throw new Error("Campaign preparation is already complete");
  if (campaign.preparation.participants.length) throw new Error("Campaign preparation has already begun");
  validatePreparationParticipants(participants);
  const next = structuredClone(campaign);
  next.preparation!.participants = participants
    .map((participant) => ({ ...participant }))
    .sort((a, b) => a.seat - b.seat);
  next.preparation!.actorIndex = 0;
  next.preparation!.stage = "resource_stickers";
  return next;
}

/** Legacy/imported campaigns have no preparation object and are normalized as complete. */
export function campaignPreparationStatus(campaign: CampaignState): "not_started" | CampaignPreparationStage {
  if (!campaign.preparation) return "complete";
  if (!campaign.preparation.participants.length && campaign.preparation.stage !== "complete") return "not_started";
  return campaign.preparation.stage;
}

export function isCampaignPrepared(campaign: CampaignState) {
  return campaignPreparationStatus(campaign) === "complete";
}

/** Apply one durable, irreversible preparation action. Pure: returns a cloned campaign. */
export function applyCampaignPreparationAction(campaign: CampaignState, action: CampaignPreparationAction, now = new Date().toISOString()): CampaignState {
  if (campaign.gameNumber !== 0) throw new Error("Prepare the World is only legal before Game 1");
  if (!campaign.preparation || campaign.preparation.stage === "complete") throw new Error("Campaign preparation is already complete");
  const next = structuredClone(campaign);
  const preparation = next.preparation!;
  const participant = preparation.participants.find((candidate) => candidate.playerId === action.playerId);
  if (!participant) throw new Error("Only a seated preparation participant may act");

  if (action.type === "preparation.chooseFactionPower") {
    throw new Error("Faction powers are chosen by the first player to select that faction during game setup");
  }

  if (action.type === "preparation.randomizeResourceStickers") {
    if (preparation.stage !== "resource_stickers") throw new Error("Resource stickers are not being placed now");
    const remaining = preparation.resourceStickers.filter((sticker) => !sticker.cardId);
    if (action.placements.length !== remaining.length) throw new Error("The admin override must place every remaining world Coin sticker");
    const knownCardIds = new Set(contentPack.cards.territoryCards.map((card) => card.id));
    for (let index = 0; index < action.placements.length; index++) {
      const placement = action.placements[index];
      const sticker = remaining[index];
      if (placement.stickerId !== sticker.stickerId) throw new Error("The admin override must place stickers in sheet order");
      if (!knownCardIds.has(placement.cardId)) throw new Error("World Coin stickers may only target base Territory cards");
      const slots = preparation.resourceStickers.filter((candidate) => candidate.cardId === placement.cardId);
      if (slots.some((candidate) => candidate.slot === placement.slot)) throw new Error("That resource sticker slot is already filled");
      if (placement.slot === 2 && !slots.some((candidate) => candidate.slot === 1)) throw new Error("Fill resource sticker slot 1 before slot 2");
      sticker.cardId = placement.cardId;
      sticker.slot = placement.slot;
      sticker.placedBy = action.playerId;
      sticker.sequence = preparation.resourceStickers.filter((candidate) => candidate.cardId).length;
      preparation.actorIndex = (preparation.actorIndex + 1) % preparation.participants.length;
    }
    preparation.stage = "review";
    return next;
  }

  const currentActor = preparation.participants[preparation.actorIndex]?.playerId;
  if (currentActor !== action.playerId) throw new Error("It is not this player's preparation turn");

  if (action.type === "preparation.placeResourceSticker") {
    if (preparation.stage !== "resource_stickers") throw new Error("Resource stickers are not being placed now");
    const sticker = preparation.resourceStickers.find((candidate) => candidate.stickerId === action.stickerId);
    if (!sticker) throw new Error("Unknown world Coin sticker");
    if (sticker.cardId) throw new Error("That world Coin sticker was already placed");
    const nextSticker = preparation.resourceStickers.find((candidate) => !candidate.cardId);
    if (nextSticker?.stickerId !== action.stickerId) throw new Error("Place the next sticker from the sheet");
    if (!contentPack.cards.territoryCards.some((card) => card.id === action.cardId)) throw new Error("World Coin stickers may only target base Territory cards");
    const slots = preparation.resourceStickers.filter((candidate) => candidate.cardId === action.cardId);
    if (slots.some((candidate) => candidate.slot === action.slot)) throw new Error("That resource sticker slot is already filled");
    if (action.slot === 2 && !slots.some((candidate) => candidate.slot === 1)) throw new Error("Fill resource sticker slot 1 before slot 2");
    sticker.cardId = action.cardId;
    sticker.slot = action.slot;
    sticker.placedBy = action.playerId;
    sticker.sequence = preparation.resourceStickers.filter((candidate) => candidate.cardId).length;
    preparation.actorIndex = (preparation.actorIndex + 1) % preparation.participants.length;
    if (preparation.resourceStickers.every((candidate) => candidate.cardId)) preparation.stage = "review";
    return next;
  }

  if (action.type === "preparation.confirmReview") {
    if (preparation.stage !== "review") throw new Error("The prepared Resource deck is not ready to review");
    preparation.reviewConfirmedBy = action.playerId;
    return next;
  }

  if (preparation.stage !== "review" || preparation.reviewConfirmedBy !== action.playerId) {
    throw new Error("Review and confirm the completed Resource deck before sealing it");
  }
  if (preparation.resourceStickers.filter((sticker) => sticker.cardId).length !== WORLD_RESOURCE_STICKER_COUNT) {
    throw new Error("Place exactly 12 world Coin stickers before sealing");
  }
  const stickerCounts = new Map<string, number>();
  for (const sticker of preparation.resourceStickers) stickerCounts.set(sticker.cardId!, (stickerCounts.get(sticker.cardId!) ?? 0) + 1);
  next.board.cardModifications = [...stickerCounts].map(([cardId, stickers]) => {
    const card = contentPack.cards.territoryCards.find((candidate) => candidate.id === cardId)!;
    return { cardId, resources: card.resources + stickers };
  });
  preparation.stage = "complete";
  preparation.sealedAt = now;
  return next;
}

const defaultResourceStickerCardIds = () => contentPack.cards.territoryCards.slice(0, 12).map((card) => card.id);

function validateInitialCustomization(customization: InitialCampaignCustomization) {
  const factionPowerChoices = customization.factionPowerChoices ?? {};
  if (customization.factionPowerChoices !== undefined) {
    for (const faction of contentPack.factions) {
      const chosen = factionPowerChoices[faction.id];
      if (!chosen || !faction.startingPowers.includes(chosen)) {
        throw new Error(`Choose one legal starting power for ${faction.name} before Game 1`);
      }
    }
  }
  const knownFactionIds = new Set(contentPack.factions.map((faction) => faction.id));
  if (Object.keys(factionPowerChoices).some((factionId) => !knownFactionIds.has(factionId))) {
    throw new Error("Initial faction power choices contain an unknown faction");
  }

  const resourceStickerCardIds = customization.resourceStickerCardIds ?? defaultResourceStickerCardIds();
  if (resourceStickerCardIds.length !== 12) throw new Error("Place exactly 12 resource stickers before Game 1");
  const territoryCards = new Map(contentPack.cards.territoryCards.map((card) => [card.id, card]));
  const stickerCounts = new Map<string, number>();
  for (const cardId of resourceStickerCardIds) {
    if (!territoryCards.has(cardId)) throw new Error(`Initial resource sticker target '${cardId}' is not a Territory card`);
    const count = (stickerCounts.get(cardId) ?? 0) + 1;
    if (count > 2) throw new Error("A Territory card cannot start above 3 resources");
    stickerCounts.set(cardId, count);
  }

  return { factionPowerChoices: { ...factionPowerChoices }, stickerCounts };
}

/** A fresh campaign before Game 1: full inventories from pack data, empty board. */
export function initialCampaign(worldName: string, customization: InitialCampaignCustomization = {}): CampaignState {
  const inv = ruleValue<{ cancelStickers: number; fortifyMarks: number; majorCities: number; minorCities: number }>("rewardInventories");
  const initial = validateInitialCustomization(customization);
  const scarInstances: Record<string, number> = {};
  for (const sc of contentPack.scars) {
    if ((sc as any).starterPlayable) scarInstances[sc.id] = (sc as any).instances ?? 0;
  }
  return {
    worldName,
    gameNumber: 0,
    unlockedModules: [],
    contentRequired: [],
    hostContent: {},
    signatures: {},
    factionPowerChoices: initial.factionPowerChoices,
    factionComebackPowers: {},
    factionMissilePowers: {},
    factionWeaknesses: {},
    mutantEvolutionChoices: [],
    factionPrivateMissions: {},
    factionResults: {},
    factionHistory: {},
    foundedMinorCities: 0,
    board: {
      scars: [], ruins: [], customConnections: [], cities: [], fortifications: [], continentNames: {}, continentBonusMarks: {},
      cardModifications: [...initial.stickerCounts].map(([cardId, stickers]) => {
        const card = contentPack.cards.territoryCards.find((candidate) => candidate.id === cardId)!;
        return { cardId, resources: card.resources + stickers };
      }),
    },
    inventories: { ...inv, scarInstances },
  };
}

/**
 * Fold a finished game's legacy outputs into the campaign. Pure: returns a new CampaignState.
 * Board legacy (scars/cities/fortifications/continents) is read from the final state; scar
 * instances are consumed by ScarPlayed events (unplayed dealt scars return to the inventory).
 */
export function applyGameToCampaign(campaign: CampaignState, finished: GameState): CampaignState {
  if (!finished.winner) throw new Error("Cannot fold an unfinished game into the campaign");
  if (finished.gameNumber === 15 && !finished.worldCompletion?.name) {
    throw new Error("Game 15 is not complete until the selected player names the world");
  }
  const next = structuredClone(campaign);
  next.gameNumber = finished.gameNumber;
  if (finished.worldCompletion?.name) {
    next.worldName = finished.worldCompletion.name;
    next.completedWorld = { namedByPlayerId: finished.worldCompletion.namingPlayerId, completedAtGame: finished.gameNumber };
  }

  // Signatures: the finished game's map was seeded from this campaign and includes the winner's new signature.
  for (const [pid, n] of Object.entries(finished.signatures)) next.signatures[pid] = n;

  // Faction results: every pack faction gets an entry per game (unused factions recorded too).
  // Selected factions also add the physical-card row: player signature, start, and result.
  next.factionHistory ??= {}; // older persisted campaigns predate the faction-card ledger
  for (const f of factionDefinitions(finished.unlockedModules)) {
    const result = finished.results?.[f.id] ?? "unused";
    (next.factionResults[f.id] ??= []).push(result);
    const player = Object.values(finished.players).find((candidate) => candidate.factionId === f.id);
    if (player?.startingTerritoryId && result !== "unused") {
      (next.factionHistory[f.id] ??= []).push({
        gameNumber: finished.gameNumber,
        playerId: player.id,
        playerName: player.name,
        startingTerritoryId: player.startingTerritoryId,
        result,
      });
    }
  }

  // Power choices attach to factions permanently (first-play selections made this game).
  next.factionPowerChoices = { ...next.factionPowerChoices, ...finished.factionPowers };
  next.factionComebackPowers = { ...(next.factionComebackPowers ?? {}), ...(finished.comebackPowers ?? {}) };
  next.factionMissilePowers = { ...(next.factionMissilePowers ?? {}), ...(finished.factionMissilePowers ?? {}) };
  next.factionWeaknesses = { ...(next.factionWeaknesses ?? {}), ...(finished.factionWeaknesses ?? {}) };
  next.mutantEvolution = finished.mutantEvolution;
  next.mutantEvolutionChoices = [...(finished.mutantEvolutionChoices ?? [])];
  next.bringerOfNuclearFireFactionId = finished.bringerOfNuclearFireFactionId;
  next.alienCollaboratorFactionId = finished.alienCollaboratorFactionId;
  next.factionPrivateMissions = { ...(next.factionPrivateMissions ?? {}), ...(finished.capturedPrivateMissions ?? {}) };

  // Modules revealed this game: unlock flag, module scar instances, content-required pauses.
  next.contentRequired ??= []; // older persisted campaigns
  for (const moduleId of finished.unlockedModules) {
    if (next.unlockedModules.includes(moduleId)) continue;
    next.unlockedModules.push(moduleId);
    const mod = contentPack.unlockModules.find((m) => m.id === moduleId) as any;
    if (mod?.scarSource && (typeof mod.cardsAdded?.scars === "number" || Array.isArray(mod.cardsAdded?.scars))) { // module scar cards enter the persistent inventory
      for (const sc of contentPack.scars) {
        if ((sc as any).source !== mod.scarSource) continue;
        const count = typeof mod.cardsAdded.scars === "number" ? mod.cardsAdded.scars : (sc as any).instances ?? 0;
        next.inventories.scarInstances[sc.id] = (next.inventories.scarInstances[sc.id] ?? 0) + count;
      }
    }
    const items = (mod?.contentRequired ?? []) as string[];
    if (items.length && !next.contentRequired.some((c) => c.moduleId === moduleId)) next.contentRequired.push({ moduleId, items: [...items] });
  }
  next.hostContent = { ...(next.hostContent ?? {}), ...(finished.hostContent ?? {}) };
  next.contentRequired = structuredClone(finished.contentRequired ?? []);
  next.worldCapitalTerritoryId = finished.worldCapitalTerritoryId;
  next.leadFactionId = finished.leadFactionId;
  next.alienIsland = structuredClone(finished.alienIsland);
  next.board.customConnections = structuredClone(finished.customConnections ?? []);

  // Board legacy from the final territories.
  next.board.scars = [];
  next.board.ruins = [];
  next.board.cities = [];
  next.board.fortifications = [];
  for (const [tid, t] of Object.entries(finished.territories)) {
    for (const scarId of t.scars) next.board.scars.push({ territoryId: tid, scarId });
    if (t.ruin) next.board.ruins.push(tid);
    if (t.city) next.board.cities.push({ territoryId: tid, type: t.city.type, name: t.city.name ?? "", foundedByPlayerId: t.city.foundedByPlayerId ?? "" });
    if (t.fortification) next.board.fortifications.push({ territoryId: tid, durability: t.fortification.remaining });
  }
  next.board.continentNames = {};
  next.board.continentBonusMarks = {};
  for (const [cid, c] of Object.entries(finished.continents)) {
    if (c.name) next.board.continentNames[cid] = { name: c.name, namedBy: c.namedBy ?? "" };
    if (c.bonusMark) next.board.continentBonusMarks[cid] = c.bonusMark;
  }

  // Cards: merge upgrades and destroyed flags into the modification list.
  const mods = new Map<string, { cardId: string; destroyed?: boolean; resources?: number }>();
  for (const m of campaign.board.cardModifications) mods.set(m.cardId, { ...m });
  for (const [cardId, m] of Object.entries(finished.cardModifications)) {
    if (m.resources !== undefined) mods.set(cardId, { ...(mods.get(cardId) ?? { cardId }), resources: m.resources });
  }
  for (const cardId of finished.sideboard.destroyed) {
    mods.set(cardId, { ...(mods.get(cardId) ?? { cardId }), destroyed: true });
  }
  next.board.cardModifications = [...mods.values()];

  // Inventories: reward inventories carry as-is; played scar instances are consumed forever.
  next.inventories.cancelStickers = finished.inventories.cancelStickers;
  next.inventories.fortifyMarks = finished.inventories.fortifyMarks;
  next.inventories.majorCities = finished.inventories.majorCities;
  next.inventories.minorCities = finished.inventories.minorCities;
  for (const e of finished.log) {
    if (e.type !== "ScarPlayed") continue;
    const scarId = e.data?.scarId as string;
    next.inventories.scarInstances[scarId] = Math.max(0, (next.inventories.scarInstances[scarId] ?? 0) - 1);
  }

  next.foundedMinorCities = next.board.cities.filter((c) => c.type === "minor").length;
  next.worldCapitalTerritoryId ??= next.board.cities.find((c) => c.type === "world_capital")?.territoryId;
  return next;
}

/**
 * Import wizard: the host supplies card text for a paused `contentRequired` item.
 * Pure — returns a new CampaignState with the content stored under `${moduleId}.${item}`
 * and the item cleared from the pause list (the module's entry drops when empty).
 */
export function supplyModuleContent(campaign: CampaignState, moduleId: string, item: string, content: unknown): CampaignState {
  const entry = campaign.contentRequired?.find((c) => c.moduleId === moduleId);
  if (!entry || !entry.items.includes(item)) {
    throw new Error(`No pending content requirement '${item}' for module '${moduleId}'`);
  }
  const next = structuredClone(campaign);
  next.hostContent ??= {};
  next.hostContent[`${moduleId}.${item}`] = structuredClone(content);
  const e = next.contentRequired.find((c) => c.moduleId === moduleId)!;
  e.items = e.items.filter((i) => i !== item);
  if (e.items.length === 0) next.contentRequired = next.contentRequired.filter((c) => c.moduleId !== moduleId);
  return next;
}

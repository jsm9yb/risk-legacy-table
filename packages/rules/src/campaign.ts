// new: task 10b — canonical cross-game CampaignState (SPEC §7, §10).
// Carry: board scars, cities, fortifications, continent names/bonus marks, destroyed/upgraded
// cards, signatures, faction-power choices/results, scar + reward inventories, unlock flags,
// world name. Do NOT carry: troops, control, hands, unplayed missiles, Red-Star tokens,
// or transient turn/combat state.
import { contentPack, ruleValue } from "@risk/content";
import type { GameState, PlayerId, TerritoryId } from "./types.ts";

export type GameResult = "won" | "held_on" | "eliminated" | "unused";

export interface CampaignState {
  worldName: string;
  gameNumber: number; // completed games so far; starter reward changes stop after Game 15
  unlockedModules: string[];
  contentRequired: { moduleId: string; items: string[] }[]; // new (11): unlocks paused on host-entered card text (cleared by the import wizard, task 12)
  hostContent: Record<string, unknown>; // new (12): host-entered card text, keyed `${moduleId}.${item}`
  optionalVariantId?: string;
  signatures: Record<PlayerId, number>;
  factionPowerChoices: Record<string, string>; // factionId -> selected starting power (task 9)
  factionResults: Record<string, GameResult[]>;
  foundedMinorCities: number; // Pack 1 trigger counter
  worldCapitalTerritoryId?: TerritoryId;
  leadFactionId?: string;
  board: {
    scars: { territoryId: TerritoryId; scarId: string }[];
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

/** A fresh campaign before Game 1: full inventories from pack data, empty board. */
export function initialCampaign(worldName: string): CampaignState {
  const inv = ruleValue<{ cancelStickers: number; fortifyMarks: number; majorCities: number; minorCities: number }>("rewardInventories");
  const scarInstances: Record<string, number> = {};
  for (const sc of contentPack.scars) {
    if ((sc as any).starterPlayable) scarInstances[sc.id] = (sc as any).instances ?? 0;
  }
  return {
    worldName,
    gameNumber: 0,
    unlockedModules: [],
    contentRequired: [], // new (11)
    hostContent: {}, // new (12)
    signatures: {},
    factionPowerChoices: {},
    factionResults: {},
    foundedMinorCities: 0,
    board: { scars: [], cities: [], fortifications: [], continentNames: {}, continentBonusMarks: {}, cardModifications: [] },
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
  const next = structuredClone(campaign);
  next.gameNumber = finished.gameNumber;

  // Signatures: the finished game's map was seeded from this campaign and includes the winner's new signature.
  for (const [pid, n] of Object.entries(finished.signatures)) next.signatures[pid] = n;

  // Faction results: every pack faction gets an entry per game (unused factions recorded too).
  for (const f of contentPack.factions) {
    (next.factionResults[f.id] ??= []).push(finished.results?.[f.id] ?? "unused");
  }

  // Power choices attach to factions permanently (first-play selections made this game). // new (9)
  next.factionPowerChoices = { ...next.factionPowerChoices, ...finished.factionPowers }; // new

  // Modules revealed this game: unlock flag, module scar instances, content-required pauses. // new (11)
  next.contentRequired ??= []; // new: older persisted campaigns
  for (const moduleId of finished.unlockedModules) { // new
    if (next.unlockedModules.includes(moduleId)) continue; // new
    next.unlockedModules.push(moduleId); // new
    const mod = contentPack.unlockModules.find((m) => m.id === moduleId) as any; // new
    if (mod?.scarSource && typeof mod.cardsAdded?.scars === "number") { // new: e.g. Pack 1 -> 3 Biohazard, Pack 2 -> 3 Mercenary
      for (const sc of contentPack.scars) { // new
        if ((sc as any).source === mod.scarSource) next.inventories.scarInstances[sc.id] = (next.inventories.scarInstances[sc.id] ?? 0) + mod.cardsAdded.scars; // new
      } // new
    } // new
    const items = (mod?.contentRequired ?? []) as string[]; // new
    if (items.length && !next.contentRequired.some((c) => c.moduleId === moduleId)) next.contentRequired.push({ moduleId, items: [...items] }); // new
  } // new

  // Board legacy from the final territories.
  next.board.scars = [];
  next.board.cities = [];
  next.board.fortifications = [];
  for (const [tid, t] of Object.entries(finished.territories)) {
    for (const scarId of t.scars) next.board.scars.push({ territoryId: tid, scarId });
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
  return next;
}

/**
 * Import wizard (task 12): the host supplies card text for a paused `contentRequired` item.
 * Pure — returns a new CampaignState with the content stored under `${moduleId}.${item}`
 * and the item cleared from the pause list (the module's entry drops when empty).
 */ // new (12): whole function
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

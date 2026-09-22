import type { GameEvent, GameState, PlayerState } from "@risk/rules";
import { filterStateFor } from "@risk/rules";
import type { SceneCommand } from "../presentation/types.ts";
import { territoryName } from "../labels.ts";

type PublicPlayer = Pick<PlayerState, "id" | "name" | "factionId" | "redStarTokens" | "missiles" | "knockedOut" | "eliminated" | "startingTerritoryId">;
export interface PublicBoardSnapshot {
  territories: GameState["territories"];
  players: Record<string, PublicPlayer>;
  worldName: string;
  gameNumber: number;
  turnNumber: number;
  turnOrder: string[];
  activeIdx: number;
  continents: GameState["continents"];
  signatures: GameState["signatures"];
  cardModifications: GameState["cardModifications"];
  destroyedCards: string[];
  unlockedModules: string[];
  factionPowers: GameState["factionPowers"];
  alienIsland?: GameState["alienIsland"];
  customConnections: GameState["customConnections"];
}

export interface HistoryFrame {
  id: string;
  seq: number;
  startSeq?: number;
  title: string;
  detail: string;
  provenance: "captured" | "permanent" | "current";
  view?: "board" | "resources";
  before: PublicBoardSnapshot;
  after: PublicBoardSnapshot;
  focus?: { from?: string; to?: string };
  weight: number;
  commands?: SceneCommand[];
}

export interface HistoryPlaybackOptions { hold?: boolean; side?: "before" | "after" }

export interface TableHistoryControls {
  skip: () => void;
  playHistory: (frames: readonly HistoryFrame[], options?: HistoryPlaybackOptions) => Promise<void>;
  history: () => HistoryFrame[];
  opening: () => HistoryFrame[];
  order: () => HistoryFrame[];
}

/** Explicit public allowlist. No hands, decks, RNG, missions, or raw log payloads. */
export function publicBoardSnapshot(state: GameState): PublicBoardSnapshot {
  return structuredClone({
    territories: state.territories,
    players: Object.fromEntries(Object.values(state.players).map(p => [p.id, {
      id: p.id, name: p.name, factionId: p.factionId, redStarTokens: p.redStarTokens,
      missiles: p.missiles, knockedOut: p.knockedOut, eliminated: p.eliminated,
      startingTerritoryId: p.startingTerritoryId,
    }])),
    worldName: state.worldName, gameNumber: state.gameNumber, turnNumber: state.turnNumber,
    turnOrder: state.turnOrder, activeIdx: state.activeIdx, continents: state.continents,
    signatures: state.signatures, cardModifications: state.cardModifications,
    destroyedCards: state.sideboard.destroyed, unlockedModules: state.unlockedModules,
    factionPowers: state.factionPowers, alienIsland: state.alienIsland, customConnections: state.customConnections,
  });
}

/** Materialize a renderer-only state; public history never becomes game authority. */
export function historyRenderState(current: GameState, board: PublicBoardSnapshot): GameState {
  const state = filterStateFor(current, null);
  state.log = [];
  state.capturedPrivateMissions = {};
  state.combat = undefined;
  state.recruit = undefined;
  const { destroyedCards, players, ...rest } = structuredClone(board);
  Object.assign(state, rest);
  state.players = Object.fromEntries(Object.values(players).map(player => [player.id, {
    ...player, hand: [], scarHand: [], scarCardCount: 0, conqueredEnemyThisTurn: false,
  }]));
  state.sideboard.destroyed = destroyedCards;
  return state;
}

const text = (event: GameEvent, key: string) => typeof event.data?.[key] === "string" ? event.data[key] as string : undefined;
const weight: Partial<Record<GameEvent["type"], number>> = {
  TerritoryConquered: 3, GameWon: 100, PlayerEliminated: 8, PlayerKnockedOut: 7,
  NuclearOpeningResolved: 9, ScarPlayed: 5, MajorCityFounded: 5, MinorCityFounded: 5,
  WorldCapitalFounded: 8, CityFortified: 4, ContinentNamed: 5, ContinentBonusChanged: 4,
  TerritoryCardDestroyed: 5, TerritoryCardUpgraded: 4, ModuleRevealed: 8, AlienIslandPlaced: 8,
  WorldNamed: 9, BoardSigned: 5, RedStarPurchased: 6, AlienRuinsPlaced: 5,
};

function eventTitle(event: GameEvent) {
  return event.type === "TerritoryConquered" && event.data?.hqCaptured ? "Headquarters captured"
    : event.type.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/** Retain exact observed action boundaries, rather than pretending each event had its own snapshot. */
export class PublicBoardHistory {
  private frames: HistoryFrame[] = [];
  private readonly key: string;
  constructor(private readonly gameId: string, private readonly storage?: Pick<Storage, "getItem" | "setItem">) {
    this.key = `risk.public-history.v1:${gameId}`;
    try {
      const saved = JSON.parse(storage?.getItem(this.key) ?? "null") as {version?: number; gameId?: string; frames?: HistoryFrame[]} | null;
      if (saved?.version === 1 && saved.gameId === gameId && Array.isArray(saved.frames)) {
        // Stored state is never a command source. Keep only structurally valid public boards.
        this.frames = saved.frames.filter(f => typeof f.id === "string" && Number.isInteger(f.seq)
          && f.provenance === "captured" && f.before?.territories && f.after?.territories
          && f.before.players && f.after.players).slice(-16).map(f => ({...f, commands: undefined}));
      }
    } catch { /* Missing or invalid local history leaves the live game unaffected. */ }
  }
  capture(previous: GameState, next: GameState) {
    if (next.gameId !== this.gameId || previous.gameId !== this.gameId) return;
    if (next.eventSeq < previous.eventSeq) {
      this.frames = this.frames.filter(f => f.seq <= next.eventSeq);
      this.persist(); return;
    }
    const events = next.log.filter(e => e.seq > previous.eventSeq && e.seq <= next.eventSeq && weight[e.type]);
    if (!events.length) return;
    const important = [...events].sort((a, b) => (weight[b.type] ?? 0) - (weight[a.type] ?? 0))[0];
    const spatial = [...events].reverse().find(e => text(e, "territory")) ?? important;
    const territory = text(spatial, "territory");
    const who = important.playerId ? next.players[important.playerId]?.name : undefined;
    const title = eventTitle(important);
    const frame: HistoryFrame = {
      id: `captured:${previous.eventSeq}:${next.eventSeq}`, seq: next.eventSeq, startSeq: previous.eventSeq, title,
      detail: `${who ? `${who} · ` : ""}${territory ? territoryName(territory) : title} · turn ${next.turnNumber}`,
      view: important.type === "TerritoryCardUpgraded" || important.type === "TerritoryCardDestroyed" ? "resources" : "board",
      provenance: "captured", before: publicBoardSnapshot(previous), after: publicBoardSnapshot(next),
      focus: territory ? {from: text(spatial, "from"), to: territory} : undefined,
      weight: events.some(e => e.type === "TerritoryConquered" && e.data?.hqCaptured) ? Math.max(9, weight[important.type] ?? 0) : weight[important.type] ?? 1,
    };
    this.frames = [...this.frames.filter(f => f.id !== frame.id && f.seq <= next.eventSeq), frame]
      .sort((a, b) => b.weight - a.weight || b.seq - a.seq).slice(0, 16).sort((a, b) => a.seq - b.seq);
    this.persist();
  }
  list(state: GameState): HistoryFrame[] {
    const captured = this.frames.filter(f => f.seq <= state.eventSeq).map(frame => ({...frame, commands: historyCommands(state.log.filter(event => event.seq > (frame.startSeq ?? frame.seq - 1) && event.seq <= frame.seq))}));
    const permanent = permanentHistoryFrames(state, captured).filter(f => !captured.some(c => c.seq === f.seq));
    return [...captured, ...permanent].sort((a, b) => b.weight - a.weight || b.seq - a.seq)
      .slice(0, 16).sort((a, b) => a.seq - b.seq);
  }
  private persist() {
    try {
      let body = JSON.stringify({version: 1, gameId: this.gameId, frames: this.frames});
      while (body.length > 700_000 && this.frames.length > 1) {
        this.frames.shift(); body = JSON.stringify({version: 1, gameId: this.gameId, frames: this.frames});
      }
      this.storage?.setItem(this.key, body);
    } catch { /* A full or disabled browser store must not block play. */ }
  }
}

/** Reverse only permanent changes whose events prove the previous value.
 * Troops and ownership deliberately remain current in this fallback. */
export function permanentHistoryFrames(state: GameState, captured: readonly HistoryFrame[] = []): HistoryFrame[] {
  let board = publicBoardSnapshot(state);
  const frames: HistoryFrame[] = [];
  const handled = new Set<string>();
  const exact = captured.filter(frame => frame.provenance === "captured" && frame.seq <= state.eventSeq && frame.startSeq !== undefined);
  for (const event of [...state.log].reverse()) {
    const recorded = exact.find(frame => event.seq > frame.startSeq! && event.seq <= frame.seq);
    if (recorded) {
      if (!handled.has(recorded.id)) {
        handled.add(recorded.id);
        const before = reverseCapturedPermanentFields(board, recorded);
        if (before) {
          frames.push({...recorded, id: `permanent:${recorded.id}`, provenance: "permanent",
            detail: "Permanent changes from recorded public boards. Army positions are current.",
            before, after: board, commands: undefined});
          board = before;
        }
      }
      continue;
    }
    const territory = text(event, "territory"), cardId = text(event, "cardId");
    const before = structuredClone(board);
    const tile = territory ? before.territories[territory] : undefined;
    let changed = false;
    if (event.type === "ScarPlayed" && tile && text(event, "scarId") && tile.scars.includes(text(event, "scarId")!)) {
      tile.scars = tile.scars.filter(id => id !== text(event, "scarId")); changed = true;
    } else if (event.type === "ScarCancelled" && tile && text(event, "scarId")) {
      tile.scars = [text(event, "scarId")!, ...tile.scars]; changed = true;
    } else if ((event.type === "MajorCityFounded" && tile?.city?.type === "major"
      || event.type === "MinorCityFounded" && tile?.city?.type === "minor")
      && (!text(event, "name") || tile!.city!.name === text(event, "name"))) {
      tile!.city = undefined; changed = true;
    } else if (event.type === "TerritoryCardUpgraded" && cardId && typeof event.data?.resources === "number") {
      before.cardModifications[cardId] = {resources: event.data.resources - 1}; changed = true;
    } else if (event.type === "TerritoryCardDestroyed" && cardId && before.destroyedCards.includes(cardId)) {
      before.destroyedCards = before.destroyedCards.filter(id => id !== cardId); changed = true;
    } else if (event.type === "ContinentNamed" && text(event, "continentId")) {
      const id = text(event, "continentId")!;
      if (before.continents[id]?.name === text(event, "name")) {
        before.continents[id] = {...before.continents[id], name: undefined, namedBy: undefined}; changed = true;
      }
    } else if (event.type === "ContinentBonusChanged" && text(event, "continentId") && typeof event.data?.delta === "number") {
      const id = text(event, "continentId")!;
      before.continents[id] = {...before.continents[id], bonusMark: undefined}; changed = true;
    } else if (event.type === "BoardSigned" && event.playerId && typeof event.data?.signatures === "number") {
      before.signatures[event.playerId] = event.data.signatures - 1; changed = true;
    }
    if (changed) {
      frames.push({id: `permanent:${event.seq}`, seq: event.seq, title: eventTitle(event),
        detail: "Permanent marks reconstructed from the public record. Army positions are current.",
        view: event.type === "TerritoryCardUpgraded" || event.type === "TerritoryCardDestroyed" ? "resources" : "board",
        provenance: "permanent", before, after: board, focus: territory ? {to: territory} : undefined, weight: 4});
      board = before;
    }
  }
  return frames.reverse();
}

/** Restore exact permanent values while keeping ordinary armies/HQs at their current positions. */
function reverseCapturedPermanentFields(board: PublicBoardSnapshot, captured: HistoryFrame): PublicBoardSnapshot | undefined {
  const result = structuredClone(board);
  let changed = false;
  const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const {before, after} = captured;
  for (const key of ["worldName", "continents", "signatures", "cardModifications", "destroyedCards", "unlockedModules", "factionPowers", "alienIsland", "customConnections"] as const) {
    if (!equal(before[key], after[key])) {
      Object.assign(result, {[key]: structuredClone(before[key])});
      changed = true;
    }
  }
  for (const id of new Set([...Object.keys(before.territories), ...Object.keys(after.territories)])) {
    const earlier = before.territories[id], later = after.territories[id];
    if (!earlier && later && after.alienIsland?.territoryId === id) {
      delete result.territories[id]; changed = true; continue;
    }
    if (!earlier || !later || !result.territories[id]) continue;
    for (const key of ["city", "scars", "fortification", "ruin"] as const) {
      if (!equal(earlier[key], later[key])) {
        Object.assign(result.territories[id], {[key]: structuredClone(earlier[key])});
        changed = true;
      }
    }
  }
  return changed ? result : undefined;
}

export function openingTour(state: GameState): HistoryFrame[] {
  const board = publicBoardSnapshot(state);
  return Object.entries(state.territories).filter(([, tile]) => tile.city || tile.scars.length || tile.fortification || tile.ruin)
    .slice(0, 6).map(([id, tile], index) => ({
      id: `opening:${id}`, seq: state.eventSeq, title: territoryName(id),
      detail: [tile.city?.name ?? tile.city?.type, ...tile.scars.map(s => s.replaceAll("_", " ")), tile.fortification ? "Fortified" : undefined, tile.ruin ? "Alien ruins" : undefined].filter(Boolean).join(" · "),
      provenance: "current", before: board, after: board, focus: {to: id}, weight: 6 - index,
    }));
}

export function openingOrder(state: GameState): HistoryFrame[] {
  if (!state.setup) return [];
  const board = publicBoardSnapshot(state);
  return [{id: "opening:order", seq: state.eventSeq, title: "Opening chooser order",
    detail: "The recorded setup roll determines who chooses first.", provenance: "current", before: board, after: board,
    weight: 1, commands: [{type: "setup.order", order: state.setup.chooserOrder,
      rolls: Object.entries(state.setup.rolls).map(([playerId, value]) => ({playerId, value})),
      rounds: state.log.filter(event => event.type === "SetupOrderRoll").map(event => Array.isArray(event.data?.round)
        ? event.data.round.flatMap(value => {
          const roll = value as {id?: unknown; roll?: unknown};
          return typeof roll.id === "string" && typeof roll.roll === "number" ? [{playerId: roll.id, value: roll.roll}] : [];
        }) : []).filter(round => round.length),
    }]}];
}

/** Reconstruct only explicitly public semantic effects, never arbitrary stored commands. */
function historyCommands(events: GameEvent[]): SceneCommand[] {
  return events.flatMap((event): SceneCommand[] => {
    const territory = text(event, "territory"), from = text(event, "from");
    const playerId = event.playerId;
    if (event.type === "TerritoryConquered" && territory && from && playerId && typeof event.data?.moved === "number") {
      return [{type: "army.move", from, to: territory, count: event.data.moved, tone: "conquest"}, {type: "territory.conquest", territoryId: territory, playerId}];
    }
    if (event.type === "ScarPlayed" && territory && text(event, "scarId")) return [{type: "scar.apply", territoryId: territory, scarId: text(event, "scarId")!}];
    if ((event.type === "MajorCityFounded" || event.type === "MinorCityFounded" || event.type === "WorldCapitalFounded") && territory) return [{type: "city.place", territoryId: territory, cityType: event.type === "MajorCityFounded" ? "major" : event.type === "MinorCityFounded" ? "minor" : "world_capital", name: text(event, "name") ?? "City"}];
    if (event.type === "GameWon" && playerId) return [{type: "game.victory", playerId, reason: text(event, "reason") ?? "Victory"}];
    return [];
  });
}

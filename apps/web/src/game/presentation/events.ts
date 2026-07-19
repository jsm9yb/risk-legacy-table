import type { GameEvent, GameState, PlayerId, TerritoryId } from "@risk/rules";
import type { PresentationEvent, StateTransition, TransitionSource } from "./types.ts";

const str = (event: GameEvent, key: string) => typeof event.data?.[key] === "string" ? event.data[key] as string : undefined;
const num = (event: GameEvent, key: string) => typeof event.data?.[key] === "number" ? event.data[key] as number : undefined;
const player = (event: GameEvent) => event.playerId as PlayerId | undefined;

function spatialCombat(state: GameState, event: GameEvent) {
  return {
    from: str(event, "from") ?? state.combat?.from,
    to: str(event, "to") ?? state.combat?.to,
  };
}

function mapEvent(previous: GameState, next: GameState, event: GameEvent): PresentationEvent {
  const p = player(event);
  const territory = str(event, "territory") as TerritoryId | undefined;
  const { from, to } = spatialCombat(next, event);
  switch (event.type) {
    case "TroopsPlaced":
    case "FactionChosen":
    case "JoinedTheWar":
    case "LeadFactionCapitalBonus":
    case "AlienReinforcementsPlaced":
      if (p && territory) return { type: "troops.placed", seq: event.seq, playerId: p, territoryId: territory, count: num(event, "count") ?? num(event, "troops") ?? 0 };
      break;
    case "TerritoryExpanded":
      if (p && from && to) return { type: "territory.expanded", seq: event.seq, playerId: p, from, to, moved: num(event, "troops") ?? 0, losses: num(event, "resistanceLosses") ?? 0 };
      break;
    case "AttackDeclared": {
      const defender = str(event, "defender") ?? (to ? previous.territories[to]?.controller : undefined);
      if (p && defender && from && to) return { type: "battle.declared", seq: event.seq, attackerId: p, defenderId: defender, from, to };
      break;
    }
    case "DiceRolled": {
      const attack = Array.isArray(event.data?.att) ? event.data.att.filter((v): v is number => typeof v === "number") : [];
      const defense = Array.isArray(event.data?.def) ? event.data.def.filter((v): v is number => typeof v === "number") : [];
      if (from && to) return { type: "dice.rolled", seq: event.seq, from, to, attack, defense };
      break;
    }
    case "CombatResolved":
      if (from && to) return { type: "battle.resolved", seq: event.seq, from, to, attackerLosses: num(event, "attackerLosses") ?? 0, defenderLosses: num(event, "defenderLosses") ?? 0 };
      break;
    case "TerritoryConquered":
      if (p && from && territory) return { type: "territory.conquered", seq: event.seq, playerId: p, from, to: territory, moved: num(event, "moved") ?? 0, capturedHqFactionId: str(event, "hqCaptured") };
      break;
    case "Maneuvered":
      if (p && from && to) return { type: "army.maneuvered", seq: event.seq, playerId: p, from, to, count: num(event, "count") ?? 0 };
      break;
    case "ScarPlayed":
      if (p && territory) return { type: "scar.applied", seq: event.seq, playerId: p, territoryId: territory, scarId: str(event, "scarId") ?? "unknown" };
      break;
    case "ScarAttrition":
    case "ScarReinforcement":
    case "FalloutLosses":
    case "FalloutEventLosses":
      if (p && territory) {
        const before = previous.territories[territory]?.troops ?? 0;
        const after = next.territories[territory]?.troops ?? before;
        const explicitLosses = num(event, "losses");
        return { type: "scar.attrition", seq: event.seq, playerId: p, territoryId: territory, delta: explicitLosses ? -explicitLosses : after - before };
      }
      break;
    case "MinorCityFounded":
    case "MajorCityFounded":
    case "WorldCapitalFounded":
      if (p && territory) return { type: "city.founded", seq: event.seq, playerId: p, territoryId: territory, cityType: event.type.replace("CityFounded", "").toLowerCase() || "world_capital", name: str(event, "name") ?? next.territories[territory]?.city?.name ?? "Unnamed" };
      break;
    case "CityFortified":
      if (p && territory) return { type: "city.fortified", seq: event.seq, playerId: p, territoryId: territory };
      break;
    case "FactionPowerApplied":
      if (p && str(event, "powerId") === "mobile" && from && to) return { type: "hq.moved", seq: event.seq, playerId: p, from, to, factionId: str(event, "hqFaction") ?? next.players[p]?.factionId ?? "unknown" };
      break;
    case "RedStarGained":
    case "EventRedStarGained":
    case "CoinDepletionRedStar":
      if (p) return { type: "redStar.gained", seq: event.seq, playerId: p, source: str(event, "source") ?? event.type, territoryId: territory };
      break;
    case "MissileCommitted":
      if (p && from && to) return { type: "missile.committed", seq: event.seq, playerId: p, from, to, side: str(event, "side") === "def" ? "def" : "att" };
      break;
    case "ModuleRevealed":
      return { type: "module.revealed", seq: event.seq, moduleId: str(event, "moduleId") ?? "unknown", timing: "mid_game" };
    case "NuclearOpeningResolved": {
      const territories = Array.isArray(event.data?.territories) ? event.data.territories.filter((v): v is string => typeof v === "string") : [];
      return { type: "nuclear.resolved", seq: event.seq, territories };
    }
    case "AlienIslandPlaced": {
      const connections = Array.isArray(event.data?.connections) ? event.data.connections.filter((v): v is string => typeof v === "string") : [];
      if (p && territory && connections.length >= 2) return { type: "alienIsland.placed", seq: event.seq, playerId: p, territoryId: territory, connections: [connections[0], connections[1]] };
      break;
    }
    case "PhaseChanged": {
      const phase = str(event, "phase") as GameState["phase"] | undefined;
      if (phase) return { type: "phase.changed", seq: event.seq, phase };
      break;
    }
    case "GameWon":
      if (p) return { type: "game.won", seq: event.seq, playerId: p, reason: str(event, "reason") ?? next.winReason ?? "victory" };
      break;
    case "BoardSigned": return { type: "legacy.ritual", seq: event.seq, ritual: "board.signed", playerId: p };
    case "ContinentNamed": return { type: "legacy.ritual", seq: event.seq, ritual: "continent.named", playerId: p };
    case "TerritoryCardUpgraded": return { type: "legacy.ritual", seq: event.seq, ritual: "card.upgraded", playerId: p, territoryId: territory };
    case "WorldNamed": return { type: "legacy.ritual", seq: event.seq, ritual: "world.named", playerId: p };
    case "AlienRuinsPlaced": return { type: "legacy.ritual", seq: event.seq, ritual: "ruins.placed", playerId: p, territoryId: territory };
    case "SetupOrderAcknowledged":
    case "SetupStageChanged":
    case "StartingCoinCardTaken":
      return { type: "presentation.none", seq: event.seq, sourceType: event.type };
  }
  return { type: "presentation.unknown", seq: event.seq, sourceType: event.type };
}

export function translatePresentationEvents(previous: GameState, next: GameState, gameEvents: readonly GameEvent[] = next.log): PresentationEvent[] {
  if (next.eventSeq < previous.eventSeq) throw new Error(`Event sequence moved backwards (${previous.eventSeq} -> ${next.eventSeq})`);
  const relevant = gameEvents.filter((event) => event.seq > previous.eventSeq && event.seq <= next.eventSeq).sort((a, b) => a.seq - b.seq);
  let expected = previous.eventSeq + 1;
  for (const event of relevant) {
    if (event.seq !== expected) throw new Error(`Event gap: expected ${expected}, received ${event.seq}`);
    expected++;
  }
  if (expected - 1 !== next.eventSeq) throw new Error(`Event gap: transition ends at ${next.eventSeq}, events end at ${expected - 1}`);
  return relevant.map((event) => mapEvent(previous, next, event));
}

export function createStateTransition(previous: GameState, next: GameState, source: TransitionSource, receivedAt: number): StateTransition {
  return { previous, next, source, receivedAt, events: translatePresentationEvents(previous, next) };
}

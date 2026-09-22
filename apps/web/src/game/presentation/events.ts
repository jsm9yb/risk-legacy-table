import type { GameEvent, GameState, PlayerId, TerritoryId } from "@risk/rules";
import type { GameplayCommand, PresentationEvent, StateTransition, TransitionSource } from "./types.ts";

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
  const { from, to } = spatialCombat(next.combat ? next : previous, event);
  const present = (command: GameplayCommand): PresentationEvent => ({ type: "gameplay.present", seq: event.seq, command });
  switch (event.type) {
    case "TroopsPlaced":
      if (p && territory) return { type: "troops.placed", seq: event.seq, playerId: p, territoryId: territory, count: num(event, "count") ?? 0 };
      break;
    case "FactionChosen":
      if (p && territory) return present({ type: "setup.claim", playerId: p, territoryId: territory, factionId: str(event, "factionId") ?? "unknown", count: num(event, "troops") ?? 0 });
      break;
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
    case "AttackersChosen":
    case "DefenderDiceChosen":
      if (from && to) return present({ type: "battle.prepare", from, to,
        ...(event.type === "AttackersChosen" ? { attackCount: num(event, "count") } : { defenseCount: num(event, "count") }) });
      break;
    case "CombatResolved": {
      const final = event.data?.final as { att?: number[]; def?: number[] } | undefined;
      const scarModifiers = (event.data?.scarModifiers ?? []) as {scarId: string; dieIndex: number; delta: number}[];
      const natural = event.data?.natural as {att: number[]; def: number[]} | undefined;
      const powerModifiers = (event.data?.powerModifiers ?? []) as {powerId: string; side: "att" | "def"; dieIndex: number; delta: number}[];
      const values = {att: [...(natural?.att ?? [])], def: [...(natural?.def ?? [])]};
      for (const missile of (event.data?.modifiers ?? []) as {side: "att" | "def"; dieIndex: number}[]) values[missile.side][missile.dieIndex] = 6;
      const modifiers: Extract<GameplayCommand, {type: "battle.modify"}>[] = [];
      if (from && to) for (const m of [...scarModifiers.map(m => ({...m, side: "def" as const, source: m.scarId})), ...powerModifiers.map(m => ({...m, source: m.powerId}))]) {
        const naturalValue = values[m.side][m.dieIndex];
        if (typeof naturalValue !== "number") continue;
        const finalValue = Math.max(1, Math.min(6, naturalValue + m.delta));
        modifiers.push({type: "battle.modify", from, to, side: m.side, dieIndex: m.dieIndex, naturalValue, finalValue, source: m.source});
        values[m.side][m.dieIndex] = finalValue;
      }
      const comparisons = event.data?.comparisons as Extract<GameplayCommand, {type: "battle.compare"}>["comparisons"] | undefined;
      if (from && to) return { type: "battle.resolved", seq: event.seq, from, to, attackerLosses: num(event, "attackerLosses") ?? 0, defenderLosses: num(event, "defenderLosses") ?? 0, modifiers, comparison: final && comparisons ? { type: "battle.compare", from, to, attack: [...(final.att ?? [])].sort((a, b) => b - a), defense: [...(final.def ?? [])].sort((a, b) => b - a), comparisons } : undefined };
      break;
    }
    case "TerritoryConquered":
      if (p && from && territory) return { type: "territory.conquered", seq: event.seq, playerId: p, from, to: territory, moved: num(event, "moved") ?? 0, capturedHqFactionId: str(event, "hqCaptured"), drawEarned: !previous.players[p]?.conqueredEnemyThisTurn };
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
        return { type: "scar.attrition", sourceType: event.type, seq: event.seq, playerId: p, territoryId: territory, delta: explicitLosses ? -explicitLosses : after - before };
      }
      break;
    case "MinorCityFounded":
    case "MajorCityFounded":
    case "WorldCapitalFounded":
      if (p && territory) return { type: "city.founded", seq: event.seq, playerId: p, territoryId: territory, cityType: event.type === "WorldCapitalFounded" ? "world_capital" : event.type.replace("CityFounded", "").toLowerCase(), name: str(event, "name") ?? next.territories[territory]?.city?.name ?? "Unnamed" };
      break;
    case "CityFortified":
      if (p && territory) return { type: "city.fortified", seq: event.seq, playerId: p, territoryId: territory };
      break;
    case "FactionPowerApplied":
      if (p && str(event, "powerId") === "mobile" && from && to) return { type: "hq.moved", seq: event.seq, playerId: p, from, to, factionId: str(event, "hqFaction") ?? next.players[p]?.factionId ?? "unknown" };
      if (p) return present({ type: "power.activate", playerId: p, powerId: str(event, "powerId") ?? "Faction power", territoryId: territory, from, to, dieIndex: num(event, "dieIndex"), delta: num(event, "delta"), side: str(event, "side") === "att" ? "att" : "def" });
      break;
    case "RedStarGained":
    case "EventRedStarGained":
    case "CoinDepletionRedStar":
      if (p) return { type: "redStar.gained", seq: event.seq, playerId: p, source: str(event, "source") ?? event.type, territoryId: territory };
      break;
    case "MissileCommitted":
      if (p && from && to) return { type: "missile.committed", seq: event.seq, playerId: p, from, to, side: str(event, "side") === "def" ? "def" : "att", dieIndex: num(event, "dieIndex"), naturalValue: num(event, "naturalValue") };
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
    case "ContinentNamed": return { type: "legacy.ritual", seq: event.seq, ritual: "continent.named", playerId: p, text: str(event, "name") };
    case "TerritoryCardUpgraded": return { type: "legacy.ritual", seq: event.seq, ritual: "card.upgraded", playerId: p, cardId: str(event, "cardId"), resources: num(event, "resources"), text: `${num(event, "resources") ?? ""} resources`, territoryId: territory };
    case "WorldNamed": return { type: "legacy.ritual", seq: event.seq, ritual: "world.named", playerId: p, text: str(event, "name") };
    case "AlienRuinsPlaced": return { type: "legacy.ritual", seq: event.seq, ritual: "ruins.placed", playerId: p, territoryId: territory };
    case "RecruitCalculated": {
      const b = event.data?.breakdown as {total?: number; fromTerritories?: number; population?: number; continents?: {id: string; total: number}[]} | undefined;
      if (p && b) return present({ type: "recruitment.show", playerId: p, total: b.total ?? 0, fromTerritories: b.fromTerritories ?? 0, population: b.population ?? 0, continents: b.continents ?? [] });
      break;
    }
    case "ResourceCardsTraded":
    case "RedStarPurchased":
    case "ResourceCardDrawn":
    case "EventResourceCardTaken":
    case "StartingCoinCardTaken":
      if (p) {
        const spending = event.type === "ResourceCardsTraded" || event.type === "RedStarPurchased";
        // Resolve exact DOM cards only from this viewer's visible hand, never raw private payloads.
        const visible = spending ? previous.players[p]?.hand ?? [] : next.players[p]?.hand ?? [];
        const cards = spending && Array.isArray(event.data?.cards) ? event.data.cards : visible.filter(id => !previous.players[p]?.hand.includes(id));
        const cardIds = visible.filter(id => cards.includes(id));
        return present({ type: "cards.transfer", playerId: p, kind: event.type === "ResourceCardsTraded" ? "trade" : event.type === "RedStarPurchased" ? "purchase" : "draw", count: Array.isArray(event.data?.cards) ? event.data.cards.length : 1, resources: num(event, "resources"), troops: num(event, "troops"), slot: num(event, "slot"), source: str(event, "kind") === "coin" ? "coin" : "territory", ...(cardIds.length ? {cardIds} : {}) });
      }
      break;
    case "TurnStarted":
    case "TurnEnded":
      if (p) return present({ type: "turn.handoff", playerId: p, stage: event.type === "TurnStarted" ? "start" : "end", turn: num(event, "turn") });
      break;
    case "SetupChooserOrder":
    case "SetupOrderAcknowledged":
      return present({ type: "setup.order", order: Array.isArray(event.data?.order) ? event.data.order.filter((v): v is string => typeof v === "string") : [],
        rolls: Object.entries(next.setup?.rolls ?? {}).map(([playerId, value]) => ({playerId, value})),
        rounds: next.log.filter(e => e.type === "SetupOrderRoll").map(e => Array.isArray(e.data?.round) ? e.data.round.flatMap(r => typeof r?.id === "string" && typeof r?.roll === "number" ? [{playerId: r.id, value: r.roll}] : []) : []) });
    case "FortificationDurabilityMarked":
    case "FortificationExpired":
      if (territory) return present({ type: "city.damage", territoryId: territory, remaining: num(event, "remaining") ?? 0 });
      break;
    case "PlayerKnockedOut":
    case "PlayerEliminated":
    case "NuclearKnockout":
      if (p) return present({ type: "player.eliminate", playerId: p, kind: event.type === "PlayerEliminated" ? "eliminated" : "knocked_out", by: str(event, "by") });
      break;
    case "TerritoryCardDestroyed": return { type: "legacy.ritual", seq: event.seq, ritual: "card.destroyed", playerId: p, cardId: str(event, "cardId"), territoryId: territory };
    case "ContinentBonusChanged": return { type: "legacy.ritual", seq: event.seq, ritual: "continent.bonus", playerId: p };
    case "ScarCancelled": return { type: "legacy.ritual", seq: event.seq, ritual: "scar.cancelled", playerId: p, territoryId: territory };
    case "CampaignLegacyApplied":
      return present({ type: "campaign.recap", title: "The world you left behind", items: ["scars", "cities", "fortifications"].map(key => `${num(event, key) ?? 0} ${key}`) });
    case "EndGameRewardsCommitted":
      return present({ type: "campaign.recap", title: "This war changed the world", items: next.log.filter(e => ["MinorCityFounded", "MajorCityFounded", "ScarPlayed", "ContinentNamed", "TerritoryCardDestroyed", "TerritoryCardUpgraded", "CityFortified"].includes(e.type)).map(e => `${e.type.replace(/([a-z])([A-Z])/g, "$1 $2")}${str(e, "territory") ? `: ${str(e, "territory")}` : ""}`).slice(-5) });
    case "SetupStageChanged":
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
  const drawEarned = new Set(Object.values(previous.players).filter(p => p.conqueredEnemyThisTurn).map(p => p.id));
  let from = previous.combat?.from;
  let to = previous.combat?.to;
  let lastDraw: Extract<GameplayCommand, {type: "cards.transfer"}> | undefined;
  return relevant.map(event => {
    if (event.type === "AttackDeclared" || event.type === "CombatResolved") {
      from = str(event, "from") ?? from;
      to = str(event, "to") ?? to;
    }
    // A network batch may contain an entire battle whose final state has no combat.
    const spatial = ["DiceRolled", "MissileCommitted", "AttackersChosen", "DefenderDiceChosen", "FactionPowerApplied"].includes(event.type) && from && to
      ? {...event, data: {...event.data, from, to}} as GameEvent : event;
    const mapped: PresentationEvent = event.type === "SideboardRefilled" && lastDraw
      ? {type: "gameplay.present", seq: event.seq, command: {...lastDraw, type: "cards.transfer", kind: "refill", cardIds: undefined, slot: lastDraw.source === "coin" ? 3 : lastDraw.slot}}
      : mapEvent(previous, next, spatial);
    if (mapped.type === "gameplay.present" && mapped.command.type === "cards.transfer" && mapped.command.kind === "draw") lastDraw = mapped.command;
    if (mapped.type === "territory.conquered") {
      mapped.drawEarned = !drawEarned.has(mapped.playerId);
      drawEarned.add(mapped.playerId);
    }
    if (event.type === "TurnStarted" && event.playerId) drawEarned.delete(event.playerId);
    return mapped;
  });
}

export function createStateTransition(previous: GameState, next: GameState, source: TransitionSource, receivedAt: number): StateTransition {
  return { previous, next, source, receivedAt, events: translatePresentationEvents(previous, next) };
}

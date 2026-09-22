import { neighborsOf, redStars, type GameState } from "@risk/rules";
import { manifest } from "@risk/map";
import type { MotionPreference, PresentationEvent, SceneCommand, StateTransition, VisualBeat, VisualSequence } from "./types.ts";

const duration = (full: number, preference: MotionPreference) => preference === "instant" ? 0 : preference === "reduced" ? Math.min(120, Math.max(80, full * 0.2)) : full;

function commandsFor(event: PresentationEvent): SceneCommand[][] {
  switch (event.type) {
    case "gameplay.present": return [...(event.command.type === "setup.claim" ? [[{type: "setup.faction", playerId: event.command.playerId, factionId: event.command.factionId} as SceneCommand]] : []), [event.command], ...(event.command.type === "cards.transfer" && event.command.kind === "purchase" ? [[{type: "redStar.gain", playerId: event.command.playerId} as SceneCommand]] : [])];
    case "troops.placed": return [[{ type: "army.place", territoryId: event.territoryId, playerId: event.playerId, count: event.count }]];
    case "territory.expanded": return [[{ type: "camera.frame", from: event.from, to: event.to }], [{ type: "army.move", from: event.from, to: event.to, count: event.moved, tone: "expand" }], ...(event.losses ? [[{ type: "army.remove", territoryId: event.to, count: event.losses, side: "attrition" } as SceneCommand]] : []), [{type: "territory.conquest", territoryId: event.to, playerId: event.playerId}]];
    case "battle.declared": return [[{ type: "camera.frame", from: event.from, to: event.to }, { type: "army.anticipate", territoryId: event.from }, {type: "battle.prepare", from: event.from, to: event.to}]];
    case "dice.rolled": return [[{ type: "battle.dice", from: event.from, to: event.to, attack: event.attack, defense: event.defense }]];
    case "battle.resolved": return [...(event.modifiers?.map(modifier => [modifier]) ?? []), ...(event.comparison ? [[event.comparison]] : []), [{ type: "battle.impact", from: event.from, to: event.to }], [{ type: "army.remove", territoryId: event.from, count: event.attackerLosses, side: "attacker" }, { type: "army.remove", territoryId: event.to, count: event.defenderLosses, side: "defender" }]];
    case "territory.conquered": return [[{ type: "army.move", from: event.from, to: event.to, count: event.moved, tone: "conquest" }], [{ type: "territory.conquest", territoryId: event.to, playerId: event.playerId }], ...(event.capturedHqFactionId ? [[{ type: "hq.capture", playerId: event.playerId, territoryId: event.to, factionId: event.capturedHqFactionId } as SceneCommand]] : []), ...(event.drawEarned ? [[{type: "reward.eligible", playerId: event.playerId, territoryId: event.to} as SceneCommand]] : [])];
    case "army.maneuvered": return [[{ type: "camera.frame", from: event.from, to: event.to }], [{ type: "army.move", from: event.from, to: event.to, count: event.count, tone: "maneuver" }]];
    case "scar.applied": return [[{ type: "scar.apply", territoryId: event.territoryId, scarId: event.scarId }]];
    case "scar.attrition": return event.delta < 0 ? [[{ type: "army.remove", territoryId: event.territoryId, count: -event.delta, side: "attrition" }]] : [[{ type: "army.place", territoryId: event.territoryId, playerId: event.playerId, count: event.delta }]];
    case "city.founded": return [[{ type: "city.place", territoryId: event.territoryId, cityType: event.cityType, name: event.name }]];
    case "city.fortified": return [[{ type: "city.fortify", territoryId: event.territoryId }]];
    case "hq.moved": return [[{ type: "hq.move", from: event.from, to: event.to, factionId: event.factionId }]];
    case "redStar.gained": return [[{ type: "redStar.gain", playerId: event.playerId, territoryId: event.territoryId }]];
    case "missile.committed": return [[{ type: "missile.commit", from: event.from, to: event.to, side: event.side, playerId: event.playerId, dieIndex: event.dieIndex, naturalValue: event.naturalValue }]];
    case "module.revealed": return [[{ type: "module.reveal", moduleId: event.moduleId }]];
    case "nuclear.resolved": return [[{ type: "nuclear.resolve", territories: event.territories }]];
    case "alienIsland.placed": return [[{ type: "alienIsland.place", territoryId: event.territoryId, connections: event.connections }]];
    case "phase.changed": return [[{ type: "phase.change", phase: event.phase }]];
    case "game.won": return [[{ type: "game.victory", playerId: event.playerId, reason: event.reason }]];
    case "legacy.ritual": return [[{ type: "legacy.ritual", ritual: event.ritual, territoryId: event.territoryId, text: event.text, cardId: event.cardId, playerId: event.playerId, resources: event.resources }]];
    case "presentation.none": return [];
    case "presentation.unknown": return [];
  }
}

const timingFor = (command: SceneCommand) => {
  switch (command.type) {
    case "recruitment.show": return 1200 + command.continents.length * 320;
    case "setup.faction": return 720;
    case "battle.prepare": return 340;
    case "score.change": return 850;
    case "setup.claim": return 900;
    case "setup.order": return 1100 + Math.max(0, (command.rounds?.length ?? 1) - 1) * 450;
    case "battle.compare": return 720;
    case "battle.modify": return 520;
    case "reward.eligible": return 320;
    case "hq.capture": return 1000;
    case "campaign.recap": return 1800;
    case "cards.transfer": return 520;
    case "turn.handoff": return 400;
    case "power.activate": return 420;
    case "continent.control": return 600;
    case "camera.frame": return 220;
    case "army.place": return 360;
    case "army.move": return command.tone === "conquest" ? 650 : 540;
    case "battle.dice": return 620;
    case "battle.impact": return 140;
    case "army.remove": return 340;
    case "scar.apply": return 760;
    case "city.place": return 820;
    case "module.reveal": return 2200;
    case "game.victory": return 2800;
    case "legacy.ritual": return command.ritual === "board.signed" || command.ritual === "world.named" ? 1800 : 720;
    case "nuclear.resolve": return 1500;
    default: return 180;
  }
};

/** Build a legal friendly path, including dynamic sea lines and the island. */
function routeFor(state: GameState, from: string, to: string): string[] {
  const owner = state.territories[from]?.controller;
  const pending = [[from]];
  const seen = new Set([from]);
  while (pending.length) {
    const route = pending.shift()!;
    if (route.at(-1) === to) return route;
    for (const neighbor of neighborsOf(state, route.at(-1)!)) {
      if (!seen.has(neighbor) && state.territories[neighbor]?.controller === owner) {
        seen.add(neighbor); pending.push([...route, neighbor]);
      }
    }
  }
  return [from, to]; // Powers may legally bypass ordinary connectivity.
}

/** Projection is presentation-only; the authoritative state settles once at the end. */
function project(state: GameState, command: SceneCommand, next: GameState): GameState {
  const territories = { ...state.territories };
  const update = (id: string, change: Partial<GameState["territories"][string]>) => {
    if (territories[id]) territories[id] = { ...territories[id], ...change };
  };
  const playerPatch = (id: string, change: Partial<GameState["players"][string]>) => state.players[id] ? {...state, players: {...state.players, [id]: {...state.players[id], ...change}}} : state;
  switch (command.type) {
    case "legacy.ritual":
      if (command.ritual === "card.upgraded") return {...state, cardModifications: next.cardModifications};
      if (command.ritual === "card.destroyed") return {...state, sideboard: {...state.sideboard, destroyed: next.sideboard.destroyed}};
      return state;
    case "recruitment.show": return {...state, recruit: {remaining: command.total, breakdown: {
      territories: Object.values(state.territories).filter(t => t.controller === command.playerId).length,
      population: command.population, fromTerritories: command.fromTerritories,
      continents: command.continents.map(c => ({...c, base: c.total, globalModifier: 0, namedBonus: 0})),
      tradeIns: 0, total: command.total,
    }}};
    case "cards.transfer": {
      if (command.kind === "refill") return {...state, sideboard: next.sideboard};
      const current = state.players[command.playerId], target = next.players[command.playerId];
      if (!current || !target) return state;
      const sideboard = command.kind === "draw" ? {...state.sideboard, slots: state.sideboard.slots.map((id, index) => index === (command.source === "coin" ? 3 : command.slot) ? null : id)} : state.sideboard;
      return {...playerPatch(command.playerId, {hand: target.hand, ...("handCount" in target ? {handCount: target.handCount} : {})}), sideboard, recruit: command.kind === "trade" && state.recruit ? {...state.recruit, remaining: state.recruit.remaining + (command.troops ?? 0), breakdown: {...state.recruit.breakdown, tradeIns: state.recruit.breakdown.tradeIns + (command.troops ?? 0), total: state.recruit.breakdown.total + (command.troops ?? 0)}} : state.recruit};
    }
    case "redStar.gain": return playerPatch(command.playerId, {redStarTokens: next.players[command.playerId]?.redStarTokens ?? state.players[command.playerId]?.redStarTokens});
    case "missile.commit": return command.playerId ? playerPatch(command.playerId, {missiles: Math.max(0, (state.players[command.playerId]?.missiles ?? 0) - 1)}) : state;
    case "player.eliminate": return playerPatch(command.playerId, {knockedOut: next.players[command.playerId]?.knockedOut, eliminated: next.players[command.playerId]?.eliminated});
    case "hq.move": update(command.from, {hqFaction: undefined}); update(command.to, {hqFaction: command.factionId}); break;
    case "army.place": update(command.territoryId, {troops: (territories[command.territoryId]?.troops ?? 0) + command.count, controller: command.playerId}); break;
    case "army.remove": update(command.territoryId, {troops: Math.max(0, (territories[command.territoryId]?.troops ?? 0) - command.count)}); break;
    case "army.move":
      update(command.from, {troops: Math.max(0, (territories[command.from]?.troops ?? 0) - command.count)});
      update(command.to, {troops: (territories[command.to]?.troops ?? 0) + command.count}); break;
    case "territory.conquest": update(command.territoryId, {controller: command.playerId}); break;
    case "setup.claim": update(command.territoryId, {troops: command.count, controller: command.playerId, hqFaction: command.factionId}); break;
    case "city.place": update(command.territoryId, {city: next.territories[command.territoryId]?.city}); break;
    case "city.fortify": update(command.territoryId, {fortification: next.territories[command.territoryId]?.fortification}); break;
    case "city.damage": update(command.territoryId, {fortification: command.remaining > 0 ? {max: territories[command.territoryId]?.fortification?.max ?? 10, remaining: command.remaining} : undefined}); break;
    case "scar.apply": update(command.territoryId, {scars: [...(territories[command.territoryId]?.scars ?? []), command.scarId]}); break;
    default: return state;
  }
  return {...state, territories, ...(command.type === "army.place" && state.recruit ? {recruit: {...state.recruit, remaining: Math.max(0, state.recruit.remaining - command.count)}} : {})};
}

export function planTransition(transition: StateTransition, preference: MotionPreference): VisualSequence {
  const beats: VisualBeat[] = [];
  let visualState = transition.previous;
  // The rules log fallout while computing arrival; visually arrive before taking those losses.
  const deferred = new Set<PresentationEvent>();
  const ordered: PresentationEvent[] = [];
  for (let i = 0; i < transition.events.length; i++) {
    const event = transition.events[i];
    if (deferred.has(event)) continue;
    if (event.type === "scar.attrition" && event.sourceType === "FalloutLosses" && event.delta < 0) {
      const arrival = transition.events[i + 1];
      if (arrival && (arrival.type === "territory.expanded" || arrival.type === "territory.conquered") && arrival.to === event.territoryId) { ordered.push(arrival, event); deferred.add(arrival); continue; }
    }
    ordered.push(event);
  }
  for (const event of ordered) {
    const scoresBefore = Object.fromEntries(Object.keys(visualState.players).map(id => [id, redStars(visualState, id).total]));
    if (event.type === "game.won") {
      const cause = transition.next.log.findLast(e => e.seq < event.seq && e.playerId === event.playerId && ["TerritoryConquered", "RedStarPurchased", "RedStarGained", "PrivateMissionActivated", "MissionClaimed", "EventRedStarGained", "CoinDepletionRedStar"].includes(e.type));
      const territory = typeof cause?.data?.territory === "string" ? cause.data.territory : undefined;
      const commands: SceneCommand[] = [
        ...(territory && preference === "full" ? [{type: "camera.frame" as const, to: territory}] : []),
        {type: "campaign.recap", title: `${transition.next.players[event.playerId]?.name ?? "Winner"} · THE WINNING MOMENT`, items: [event.reason, ...(territory ? [territory.replaceAll("_", " ")] : [])]},
      ];
      beats.push({label: "victory.cause", commands, durationMs: duration(1000, preference)});
    }
    // A siege retains its framing; later rolls shorten anticipation, never the explanation of modifiers/losses.
    const prior = transition.next.log.filter(e => e.seq < event.seq);
    const declaration = prior.findLast(e => e.type === "AttackDeclared");
    const repeatRoll = event.type === "dice.rolled" && prior.some(e => e.type === "DiceRolled" && e.seq > (declaration?.seq ?? Infinity));
    const groups = commandsFor(event)
      .map(commands => commands.map(command => command.type === "army.move" && command.tone === "maneuver" ? {...command, route: routeFor(visualState, command.from, command.to)} : command))
      .map((commands) => preference === "reduced" ? commands.filter((command) => command.type !== "camera.frame") : commands)
      .filter((commands) => commands.length > 0);
    groups.forEach((commands, index) => {
      const full = Math.max(0, ...commands.map(command => repeatRoll && command.type === "battle.dice" ? 380 : timingFor(command)));
      const before = visualState;
      for (const command of commands) visualState = project(visualState, command, transition.next);
      beats.push({ visualState: before !== visualState ? visualState : undefined, label: `${event.type}.${index + 1}`, commands, durationMs: duration(full, preference), commit: index === groups.length - 1 ? "event" : undefined });
    });
    const scoresAfter = Object.fromEntries(Object.keys(visualState.players).map(id => [id, redStars(visualState, id).total]));
    const changes = Object.keys(scoresAfter).filter(id => scoresBefore[id] !== scoresAfter[id]).map(playerId => ({playerId, before: scoresBefore[playerId], after: scoresAfter[playerId]}));
    if (changes.length && event.type !== "game.won") {
      const leaders = (scores: Record<string, number>) => { const max = Math.max(...Object.values(scores)); return max > 0 ? Object.keys(scores).filter(id => scores[id] === max) : []; };
      beats.push({label: "score.change", commands: [{type: "score.change", changes, leadersBefore: leaders(scoresBefore), leadersAfter: leaders(scoresAfter), territoryId: event.type === "territory.conquered" ? event.to : undefined}], durationMs: duration(850, preference)});
    }
  }
  // Ownership bonuses are public consequences of the complete action.
  for (const continent of manifest.continents) {
    const ids = manifest.territories.filter(t => t.continent === continent.id).map(t => t.id);
    const owner = (state: GameState) => {
      const first = state.territories[ids[0]]?.controller;
      return first && ids.every(id => state.territories[id]?.controller === first) ? first : undefined;
    };
    const before = owner(transition.previous), after = owner(transition.next);
    if (before === after) continue;
    const commands: SceneCommand[] = [];
    if (before) commands.push({type: "continent.control", playerId: before, continentId: continent.id, territories: ids, gained: false});
    if (after) commands.push({type: "continent.control", playerId: after, continentId: continent.id, territories: ids, gained: true});
    beats.push({label: "continent.control", commands, durationMs: duration(600, preference)});
  }
  if (beats.length) beats[beats.length - 1] = { ...beats[beats.length - 1], commit: "transition" };
  return { eventSeq: transition.next.eventSeq, beats, estimatedDurationMs: beats.reduce((sum, beat) => sum + beat.durationMs, 0) };
}

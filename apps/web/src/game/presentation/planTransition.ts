import type { MotionPreference, PresentationEvent, SceneCommand, StateTransition, VisualBeat, VisualSequence } from "./types.ts";

const duration = (full: number, preference: MotionPreference) => preference === "instant" ? 0 : preference === "reduced" ? Math.min(120, Math.max(80, full * 0.2)) : full;

function commandsFor(event: PresentationEvent): SceneCommand[][] {
  switch (event.type) {
    case "troops.placed": return [[{ type: "army.place", territoryId: event.territoryId, playerId: event.playerId, count: event.count }]];
    case "territory.expanded": return [[{ type: "camera.frame", from: event.from, to: event.to }], [{ type: "army.move", from: event.from, to: event.to, count: event.moved, tone: "expand" }], ...(event.losses ? [[{ type: "army.remove", territoryId: event.to, count: event.losses, side: "attrition" } as SceneCommand]] : [])];
    case "battle.declared": return [[{ type: "camera.frame", from: event.from, to: event.to }, { type: "army.anticipate", territoryId: event.from }]];
    case "dice.rolled": return [[{ type: "battle.dice", from: event.from, to: event.to, attack: event.attack, defense: event.defense }]];
    case "battle.resolved": return [[{ type: "battle.impact", from: event.from, to: event.to }], [{ type: "army.remove", territoryId: event.from, count: event.attackerLosses, side: "attacker" }, { type: "army.remove", territoryId: event.to, count: event.defenderLosses, side: "defender" }]];
    case "territory.conquered": return [[{ type: "army.move", from: event.from, to: event.to, count: event.moved, tone: "conquest" }], [{ type: "territory.conquest", territoryId: event.to, playerId: event.playerId }]];
    case "army.maneuvered": return [[{ type: "camera.frame", from: event.from, to: event.to }], [{ type: "army.move", from: event.from, to: event.to, count: event.count, tone: "maneuver" }]];
    case "scar.applied": return [[{ type: "scar.apply", territoryId: event.territoryId, scarId: event.scarId }]];
    case "scar.attrition": return event.delta < 0 ? [[{ type: "army.remove", territoryId: event.territoryId, count: -event.delta, side: "attrition" }]] : [[{ type: "army.place", territoryId: event.territoryId, playerId: event.playerId, count: event.delta }]];
    case "city.founded": return [[{ type: "city.place", territoryId: event.territoryId, cityType: event.cityType, name: event.name }]];
    case "city.fortified": return [[{ type: "city.fortify", territoryId: event.territoryId }]];
    case "hq.moved": return [[{ type: "hq.move", from: event.from, to: event.to, factionId: event.factionId }]];
    case "redStar.gained": return [[{ type: "redStar.gain", playerId: event.playerId, territoryId: event.territoryId }]];
    case "missile.committed": return [[{ type: "missile.commit", from: event.from, to: event.to, side: event.side }]];
    case "module.revealed": return [[{ type: "module.reveal", moduleId: event.moduleId }]];
    case "nuclear.resolved": return [[{ type: "nuclear.resolve", territories: event.territories }]];
    case "alienIsland.placed": return [[{ type: "alienIsland.place", territoryId: event.territoryId, connections: event.connections }]];
    case "phase.changed": return [[{ type: "phase.change", phase: event.phase }]];
    case "game.won": return [[{ type: "game.victory", playerId: event.playerId, reason: event.reason }]];
    case "legacy.ritual": return [[{ type: "legacy.ritual", ritual: event.ritual, territoryId: event.territoryId }]];
    case "presentation.unknown": return [];
  }
}

const timingFor = (command: SceneCommand) => {
  switch (command.type) {
    case "camera.frame": return 320;
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

export function planTransition(transition: StateTransition, preference: MotionPreference): VisualSequence {
  const beats: VisualBeat[] = [];
  for (const event of transition.events) {
    const groups = commandsFor(event)
      .map((commands) => preference === "reduced" ? commands.filter((command) => command.type !== "camera.frame") : commands)
      .filter((commands) => commands.length > 0);
    groups.forEach((commands, index) => {
      const full = Math.max(0, ...commands.map(timingFor));
      beats.push({ label: `${event.type}.${index + 1}`, commands, durationMs: duration(full, preference), commit: index === groups.length - 1 ? "event" : undefined });
    });
  }
  if (beats.length) beats[beats.length - 1] = { ...beats[beats.length - 1], commit: "transition" };
  return { eventSeq: transition.next.eventSeq, beats, estimatedDurationMs: beats.reduce((sum, beat) => sum + beat.durationMs, 0) };
}

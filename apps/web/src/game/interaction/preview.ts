import { applyAction, hasFactionPower, joinWarTroops, neighborsOf, startingTroops, type GameState } from "@risk/rules";
import type { InteractionModel } from "./InteractionPolicy.ts";

/** A hypothetical action, never a second source of committed board state. */
export interface TableActionPreview {
  kind: "setup" | "join" | "recruit" | "expand" | "maneuver" | "attack";
  from?: string;
  to: string;
  count: number;
  sourceBefore?: number;
  sourceAfter?: number;
  targetBefore: number;
  targetAfter: number;
  reserveAfter?: number;
  factionId?: string;
  playerId: string;
  route: string[];
  label: string;
}

export interface PreviewConfiguration {
  actorId?: string;
  setupFactionId?: string;
  placeCount: number;
  expandCount: number;
  moveCount: number;
  destination?: string;
}

/** A real friendly path, including campaign sea links; a power may bypass it. */
export function friendlyRoute(state: GameState, playerId: string, from: string, to: string): string[] {
  const queue: string[][] = [[from]];
  const seen = new Set([from]);
  for (let i = 0; i < queue.length; i++) {
    const path = queue[i];
    if (path.at(-1) === to) return path;
    for (const next of neighborsOf(state, path.at(-1)!)) {
      if (seen.has(next) || state.territories[next]?.controller !== playerId) continue;
      seen.add(next);
      queue.push([...path, next]);
    }
  }
  return hasFactionPower(state, playerId, "unconnected_maneuver") ? [from, to] : [];
}

export function actionPreview(state: GameState, interaction: InteractionModel, config: PreviewConfiguration, hovered?: string): TableActionPreview | undefined {
  const to = config.destination ?? hovered;
  const playerId = config.actorId;
  if (!to || !playerId || !state.players[playerId] || state.combat || interaction.mode === "spectator" || interaction.mode === "scar" || interaction.mode === "reward") return;
  const target = state.territories[to];
  if (!target) return;
  const intent = interaction.territories[to];
  const factionId = config.setupFactionId ?? state.players[playerId].factionId;
  const base = { to, playerId, factionId, targetBefore: target.troops, route: [to] };
  if (intent === "start" && (interaction.mode === "setup" || interaction.mode === "recruit")) {
    const count = interaction.mode === "setup" ? state.players[playerId].startingTroops ?? startingTroops() : joinWarTroops(state, playerId);
    return { ...base, kind: interaction.mode === "setup" ? "setup" : "join", count, targetAfter: count, label: interaction.mode === "setup" ? `Preview · HQ and ${count} troops` : `Preview · join with ${count} troops` };
  }
  if (intent === "recruit" && state.recruit?.remaining) {
    const count = Math.min(state.recruit.remaining, Math.max(1, Math.floor(config.placeCount)));
    return { ...base, kind: "recruit", count, targetAfter: target.troops + count, reserveAfter: state.recruit.remaining - count, label: `Preview · ${target.troops} → ${target.troops + count} troops · ${state.recruit.remaining - count} in reserve` };
  }
  const from = interaction.selectedTerritoryId;
  const source = from ? state.territories[from] : undefined;
  if (!from || from === to || !source || source.controller !== playerId || source.troops < 2) return;
  if (intent === "attack") return { ...base, kind: "attack", from, count: 0, sourceBefore: source.troops, sourceAfter: source.troops, targetAfter: target.troops, route: [from, to], label: `Preview · attack from ${source.troops} troops against ${target.troops} · outcome decided by dice` };
  if (intent !== "start" && intent !== "maneuver") return;
  const kind = intent === "maneuver" ? "maneuver" : "expand";
  const requested = kind === "maneuver" ? config.moveCount : config.expandCount;
  if (!Number.isFinite(requested) || requested < 1) return;
  const count = Math.min(source.troops - 1, Math.max(1, Math.floor(requested)));
  const route = kind === "maneuver" ? friendlyRoute(state, playerId, from, to) : [from, to];
  if (!route.length) return;
  // Ask the deterministic reducer for resistance, fallout and power effects.
  // It clones its input; no action is dispatched or added to the real ledger.
  try {
    const result = applyAction(state, kind === "maneuver"
      ? { type: "maneuver.move", playerId, from, to, count }
      : { type: "attack.expand", playerId, from, to, troops: count });
    const targetAfter = result.territories[to].troops;
    const sourceAfter = result.territories[from].troops;
    return { ...base, kind, from, count, sourceBefore: source.troops, sourceAfter, targetAfter, route,
      label: `Preview · move ${count} · source ${source.troops} → ${sourceAfter} · destination ${target.troops} → ${targetAfter}${targetAfter < target.troops + count ? ` · ${target.troops + count - targetAfter} lost on entry` : ""}` };
  } catch { return; }
}

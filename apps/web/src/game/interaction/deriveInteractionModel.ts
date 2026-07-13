import { hasFactionPower, isLegalStart, maneuverDecision, neighborsOf, territoryIds } from "@risk/rules";
import { isManeuverSource, maneuverDestinations } from "../maneuverUi.ts";
import type { InteractionInput, InteractionModel, InteractionPolicy, InteractionResult, TerritoryIntent } from "./InteractionPolicy.ts";

const clamp = (value: number | undefined, min: number, max: number) => Math.max(min, Math.min(max, value ?? min));
const canAct = (input: InteractionInput) => !!input.actorId && (!input.viewerId || input.viewerId === input.actorId);

export function deriveInteractionModel(input: InteractionInput): InteractionModel {
  const { state, actorId, selectedTerritoryId } = input;
  const territories: Record<string, TerritoryIntent> = {};
  if (input.overrideMode) return { mode: input.overrideMode, territories, selectedTerritoryId, instruction: input.overrideMode === "scar" ? "Choose a territory for the Scar" : "Choose a reward target" };
  if (!canAct(input)) {
    for (const territoryId of territoryIds(state)) territories[territoryId] = "spectator";
    if (state.combat) { territories[state.combat.from] = "selected"; territories[state.combat.to] = "attack"; }
    return { mode: "spectator", territories, instruction: "Inspect the table while waiting for the active player" };
  }
  const actor = actorId!;
  if (state.phase === "setup" && input.setupFactionId) {
    for (const territoryId of territoryIds(state)) territories[territoryId] = isLegalStart(state, territoryId, true, input.setupFactionId, actor) ? "start" : "inspect";
    return { mode: "setup", territories, instruction: "Choose a highlighted starting territory" };
  }
  if (state.phase === "join_or_recruit") {
    const ownsTerritory = territoryIds(state).some((id) => state.territories[id].controller === actor);
    for (const territoryId of territoryIds(state)) {
      const territory = state.territories[territoryId];
      if (!ownsTerritory) territories[territoryId] = isLegalStart(state, territoryId, false, state.players[actor].factionId, actor) ? "start" : "inspect";
      else if (state.recruit?.remaining && territory.controller === actor) territories[territoryId] = "recruit";
      else if (state.recruit?.remaining && hasFactionPower(state, actor, "stealthy") && !territory.controller && territory.troops === 0 && !territory.city && !territory.fortification && territory.scars.length === 0 && (!state.stealthRecruitTerritory || state.stealthRecruitTerritory === territoryId)) territories[territoryId] = "recruit";
      else territories[territoryId] = "inspect";
    }
    return { mode: "recruit", territories, instruction: ownsTerritory ? "Place all recruited troops" : "Choose a Join the War territory" };
  }
  if (state.phase === "expand_attack" && !state.combat) {
    for (const territoryId of territoryIds(state)) territories[territoryId] = "inspect";
    if (!selectedTerritoryId) {
      for (const territoryId of territoryIds(state)) if (state.territories[territoryId].controller === actor && state.territories[territoryId].troops >= 2) territories[territoryId] = "selected";
    } else if (state.territories[selectedTerritoryId]?.controller === actor) {
      territories[selectedTerritoryId] = "selected";
      for (const neighbor of neighborsOf(state, selectedTerritoryId)) {
        const target = state.territories[neighbor];
        territories[neighbor] = !target.controller && target.troops === 0 ? "start" : target.controller !== actor ? "attack" : "inspect";
      }
    }
    return { mode: "expand_attack", territories, selectedTerritoryId, instruction: selectedTerritoryId ? "Choose an adjacent territory" : "Choose an army to move or attack with" };
  }
  const maneuver = maneuverDecision(state, actor);
  if ((state.phase === "maneuver" || maneuver.available) && maneuver.available) {
    for (const territoryId of territoryIds(state)) territories[territoryId] = "inspect";
    if (!selectedTerritoryId) {
      for (const territoryId of territoryIds(state)) if (isManeuverSource(state, actor, territoryId)) territories[territoryId] = "maneuver";
    } else {
      territories[selectedTerritoryId] = "selected";
      for (const destination of maneuverDestinations(state, actor, selectedTerritoryId)) territories[destination] = "maneuver";
    }
    return { mode: "maneuver", territories, selectedTerritoryId, instruction: selectedTerritoryId ? "Choose a connected destination" : "Choose an army to maneuver" };
  }
  for (const territoryId of territoryIds(state)) territories[territoryId] = "inspect";
  if (state.combat) { territories[state.combat.from] = "selected"; territories[state.combat.to] = "attack"; }
  return { mode: "inspect", territories, instruction: "Inspect a territory" };
}

export const interactionPolicy: InteractionPolicy = {
  derive: deriveInteractionModel,
  activate(territoryId, input): InteractionResult {
    const model = deriveInteractionModel(input);
    const intent = model.territories[territoryId];
    const { state, actorId, selectedTerritoryId } = input;
    if (!actorId || !canAct(input)) return { kind: "explanation", message: "You are viewing this decision" };
    if (model.mode === "setup" && intent === "start" && input.setupFactionId) {
      return { kind: "action", action: { type: "setup.choose", playerId: actorId, factionId: input.setupFactionId, territoryId, powerId: input.setupPowerId } };
    }
    if (model.mode === "recruit") {
      const ownsTerritory = territoryIds(state).some((id) => state.territories[id].controller === actorId);
      if (!ownsTerritory && intent === "start") return { kind: "action", action: { type: "join.enter", playerId: actorId, territoryId } };
      if (intent === "recruit" && state.recruit) return { kind: "action", action: { type: "recruit.place", playerId: actorId, territoryId, count: clamp(input.placeCount, 1, state.recruit.remaining) } };
    }
    if (model.mode === "expand_attack") {
      if (!selectedTerritoryId && state.territories[territoryId].controller === actorId && state.territories[territoryId].troops >= 2) return { kind: "selection", selection: territoryId };
      if (selectedTerritoryId === territoryId) return { kind: "selection", selection: undefined };
      if (selectedTerritoryId && intent === "start") {
        const max = state.territories[selectedTerritoryId].troops - 1;
        return { kind: "action", action: { type: "attack.expand", playerId: actorId, from: selectedTerritoryId, to: territoryId, troops: clamp(input.expandCount, 1, max) } };
      }
      if (selectedTerritoryId && intent === "attack") return { kind: "action", action: { type: "attack.declare", playerId: actorId, from: selectedTerritoryId, to: territoryId } };
    }
    if (model.mode === "maneuver") {
      if (!selectedTerritoryId && intent === "maneuver") return { kind: "selection", selection: territoryId };
      if (selectedTerritoryId === territoryId) return { kind: "selection", selection: undefined };
      if (selectedTerritoryId && intent === "maneuver") {
        const max = state.territories[selectedTerritoryId].troops - 1;
        return { kind: "action", action: { type: "maneuver.move", playerId: actorId, from: selectedTerritoryId, to: territoryId, count: clamp(input.moveCount, 1, max) } };
      }
    }
    return intent === "inspect" || intent === "spectator" ? { kind: "explanation", message: "Open territory details" } : { kind: "none" };
  },
};


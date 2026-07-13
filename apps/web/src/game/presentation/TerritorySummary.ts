import { factionDefinitionById } from "@risk/content";
import { manifest } from "@risk/map";
import type { GameState, TerritoryId } from "@risk/rules";

export interface TerritorySummary {
  territoryId: TerritoryId;
  name: string;
  controller: string;
  faction?: string;
  troops: number;
  denomination: string;
  marks: string[];
}

export function territorySummary(state: GameState, territoryId: TerritoryId): TerritorySummary {
  const territory = state.territories[territoryId];
  if (!territory) throw new Error(`Missing territory state: ${territoryId}`);
  const definition = manifest.territories.find((candidate) => candidate.id === territoryId);
  const player = territory.controller ? state.players[territory.controller] : undefined;
  const faction = player?.factionId ? factionDefinitionById(player.factionId, state.unlockedModules)?.name ?? player.factionId.replace(/_/g, " ") : undefined;
  const hq = territory.hqFaction ? factionDefinitionById(territory.hqFaction, state.unlockedModules)?.name ?? territory.hqFaction.replace(/_/g, " ") : undefined;
  const threes = Math.floor(territory.troops / 3);
  const ones = territory.troops % 3;
  const marks = [
    hq ? `${hq} HQ` : "",
    territory.city ? `${territory.city.type.replace(/_/g, " ")}${territory.city.name ? ` · ${territory.city.name}` : ""}` : "",
    territory.fortification ? `Fortification ${territory.fortification.remaining}/${territory.fortification.max}` : "",
    territory.ruin ? "Ruins" : "",
    ...territory.scars.map((scar) => `Scar · ${scar.replace(/_/g, " ")}`),
  ].filter(Boolean);
  return {
    territoryId,
    name: definition?.name ?? (state.alienIsland?.territoryId === territoryId ? state.alienIsland.name : territoryId.replace(/_/g, " ")),
    controller: player?.name ?? "Uncontrolled",
    faction,
    troops: territory.troops,
    denomination: `${threes} × 3 + ${ones} × 1`,
    marks,
  };
}

export function territoryAccessibleLabel(state: GameState, territoryId: TerritoryId, intent?: string) {
  const summary = territorySummary(state, territoryId);
  const ownership = summary.faction ? `Controlled by ${summary.controller}, ${summary.faction}` : summary.controller;
  const marks = summary.marks.length ? ` ${summary.marks.join("; ")}.` : "";
  return `${summary.name}. ${ownership}. ${summary.troops} troops: ${summary.denomination}.${marks}${intent ? ` ${intent}.` : ""}`;
}

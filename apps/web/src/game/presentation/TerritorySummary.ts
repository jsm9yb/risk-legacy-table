import { contentPack, factionDefinitionById } from "@risk/content";
import { manifest } from "@risk/map";
import type { GameState, TerritoryId } from "@risk/rules";
import { projectTerritoryLayers } from "./ArchitecturePresentation.ts";

export interface TerritorySummary {
  territoryId: TerritoryId;
  name: string;
  controller: string;
  faction?: string;
  troops: number;
  denomination: string;
  marks: string[];
}

export interface CityEffectSummary {
  territoryId: TerritoryId;
  name: string;
  typeLabel: string;
  population: number;
  recruitmentEffect: string;
  unoccupiedEntryEffect: string;
  founderEffect?: string;
  fortificationEffect?: string;
}

const CITY_TYPE_LABELS = {
  minor: "Minor City",
  major: "Major City",
  world_capital: "World Capital",
} as const;

/** Rules-facing copy for the city-only hover target. */
export function cityEffectSummary(state: GameState, territoryId: TerritoryId): CityEffectSummary | undefined {
  const territory = state.territories[territoryId];
  const city = territory?.city;
  if (!city) return undefined;
  const population = city.population;
  const fortification = territory.fortification;
  return {
    territoryId,
    name: city.name || CITY_TYPE_LABELS[city.type],
    typeLabel: CITY_TYPE_LABELS[city.type],
    population,
    recruitmentEffect: `Counts as +${population} in territories + population before dividing by 3.`,
    unoccupiedEntryEffect: `An enemy expanding into this unoccupied city loses ${population} troop${population === 1 ? "" : "s"}.`,
    founderEffect: city.type === "major" && city.foundedByPlayerId
      ? "Its founder may start here when it is unoccupied."
      : undefined,
    fortificationEffect: fortification
      ? `Fortified: +2 more troops to enter unoccupied; +1 to each defense die (${fortification.remaining}/${fortification.max} uses).`
      : undefined,
  };
}

export function territorySummary(state: GameState, territoryId: TerritoryId): TerritorySummary {
  const territory = state.territories[territoryId];
  if (!territory) throw new Error(`Missing territory state: ${territoryId}`);
  const definition = manifest.territories.find((candidate) => candidate.id === territoryId);
  const player = territory.controller ? state.players[territory.controller] : undefined;
  const faction = player?.factionId ? factionDefinitionById(player.factionId, state.unlockedModules)?.name ?? player.factionId.replace(/_/g, " ") : undefined;
  const hq = territory.hqFaction ? factionDefinitionById(territory.hqFaction, state.unlockedModules)?.name ?? territory.hqFaction.replace(/_/g, " ") : undefined;
  const projected = projectTerritoryLayers(territory);
  const threes = Math.floor(territory.troops / 3);
  const ones = territory.troops % 3;
  const architecture = projected.architecture?.kind === "fallout"
    ? "Fallout zone"
    : projected.architecture?.kind === "ruin"
      ? "Ruins"
      : projected.architecture?.kind === "city" && territory.city
        ? `${CITY_TYPE_LABELS[territory.city.type]}${territory.city.name ? ` · ${territory.city.name}` : ""} · population +${territory.city.population}`
        : "";
  const marks = [
    hq ? `${hq} HQ` : "",
    architecture,
    projected.architecture?.kind === "city" && projected.architecture.fortificationRemaining
      ? `Fortification ${projected.architecture.fortificationRemaining}/${territory.fortification?.max ?? 10}`
      : "",
    projected.scarId ? (() => {
      const scar = contentPack.scars.find((candidate) => candidate.id === projected.scarId);
      return `Scar · ${scar?.name ?? projected.scarId.replace(/_/g, " ")}${scar?.text ? ` — ${scar.text}` : ""}`;
    })() : "",
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

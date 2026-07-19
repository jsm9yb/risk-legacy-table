import { useMemo, useState } from "react";
import { anchor, manifest, territoryPath } from "@risk/map";
import type { GameState, TerritoryId } from "@risk/rules";
import type { InteractionModel } from "../interaction/InteractionPolicy.ts";
import { territoryAccessibleLabel } from "../presentation/TerritorySummary.ts";
import { alienIslandRouteModels, alienIslandRoutePath } from "../presentation/AlienIslandRoutes.ts";

export default function AccessibleBoard({ state, interaction, onActivate, emphasizedTerritoryId, resourceValues }: {
  state: GameState;
  interaction: InteractionModel;
  onActivate: (territoryId: TerritoryId) => void;
  emphasizedTerritoryId?: TerritoryId;
  resourceValues?: Readonly<Partial<Record<TerritoryId, number>>>;
}) {
  const territoryIds = useMemo(() => Object.keys(state.territories), [state.territories]);
  const [focused, setFocused] = useState<TerritoryId>(() => interaction.selectedTerritoryId ?? territoryIds[0]);

  const highlightClass = (intent?: string) => ({
    selected: "selected",
    attack: "highlight-attack",
    maneuver: "highlight-move",
    start: "highlight-start",
    recruit: "highlight-recruit",
    illegal: "dimmed",
  })[intent ?? ""] ?? "";

  const moveFocus = (direction: 1 | -1) => {
    const definition = manifest.territories.find((territory) => territory.id === focused);
    const candidates = definition?.neighbors.filter((id) => state.territories[id]) ?? [];
    const next = candidates[direction > 0 ? 0 : Math.max(0, candidates.length - 1)] ?? territoryIds[(territoryIds.indexOf(focused) + direction + territoryIds.length) % territoryIds.length];
    setFocused(next);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-accessible-territory="${next}"]`)?.focus());
  };

  return (
    <div role="region" aria-label="Game board" aria-description={interaction.instruction} className="absolute inset-0 pointer-events-none">
      <svg id="risk-board-modern" viewBox="0 0 749.819 519.068" aria-hidden="true"
        className="absolute left-0 top-0 size-px overflow-hidden opacity-0">
        <title>Stylized Risk-inspired campaign board</title>
        {state.alienIsland && (
          <g id="alien-sea-routes">
            {alienIslandRouteModels(state.alienIsland.connections).map((route) => (
              <path key={route.territoryId} data-alien-route={route.territoryId} d={alienIslandRoutePath(route)} />
            ))}
          </g>
        )}
        <g transform="translate(-167.99651 -118.55507)">
          {manifest.territories.map((territory) => (
            <path key={territory.id} id={territory.id} d={territoryPath(territory.id)?.d}
              className={`territory-border territory ${highlightClass(interaction.territories[territory.id])} ${emphasizedTerritoryId === territory.id ? "resource-card-hover" : ""}`}
              onClick={() => onActivate(territory.id)} />
          ))}
        </g>
        <g id="territory-haloes" />
        {manifest.territories.map((territory) => {
          const point = anchor(territory);
          return <text key={territory.id} className="territory-label" x={point.x} y={point.y} fontSize="6.2">{territory.name}</text>;
        })}
        {resourceValues && manifest.territories.map((territory) => {
          const point = anchor(territory);
          return <text key={territory.id} data-resource-value={territory.id} x={point.x} y={point.y + 8}>{resourceValues[territory.id]}</text>;
        })}
        {manifest.continents.map((continent, index) => (
          <g key={continent.id} data-continent={continent.id} className="continent-callout" transform={`translate(${20 + index * 20} 500)`}>
            <rect className="continent-callout-box" width="16" height="8" />
          </g>
        ))}
        {state.alienIsland && (
          <g id={state.alienIsland.territoryId} transform="translate(565 440)" onClick={() => onActivate(state.alienIsland!.territoryId)}>
            <circle r="30" />
          </g>
        )}
      </svg>
      {territoryIds.map((territoryId) => {
        const selected = interaction.selectedTerritoryId === territoryId;
        return (
          <button
            key={territoryId}
            type="button"
            data-accessible-territory={territoryId}
            tabIndex={focused === territoryId ? 0 : -1}
            aria-label={`${territoryAccessibleLabel(state, territoryId, interaction.territories[territoryId])}${resourceValues?.[territoryId] !== undefined ? `, ${resourceValues[territoryId]} coins` : ""}`}
            aria-current={selected ? "true" : undefined}
            aria-pressed={selected}
            onFocus={() => setFocused(territoryId)}
            onClick={() => onActivate(territoryId)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); moveFocus(1); }
              if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); moveFocus(-1); }
            }}
            className="pointer-events-auto absolute size-px overflow-hidden opacity-0 focus:opacity-100 focus:size-auto focus:left-3 focus:top-3 focus:z-40 focus:bg-panel focus:border focus:border-signal focus:text-text focus:px-3 focus:py-2 focus:font-mono focus:text-xs"
          >
            {territoryAccessibleLabel(state, territoryId, interaction.territories[territoryId])}
          </button>
        );
      })}
    </div>
  );
}

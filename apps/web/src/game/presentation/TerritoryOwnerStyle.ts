export interface TerritoryOwnerStyle {
  fill: number;
  fillAlpha: number;
  stroke: { color: number; width: number; alpha: number };
}

/** Preserve the printed continent palette; ownership reads from pieces and a fine faction-color keyline. */
export function territoryOwnerStyle(factionColor: number): TerritoryOwnerStyle {
  return {
    fill: factionColor,
    fillAlpha: 0,
    stroke: { color: factionColor, width: 1.35, alpha: 0.72 },
  };
}

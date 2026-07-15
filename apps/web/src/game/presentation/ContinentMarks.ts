import { continentPresentationDefinitions } from "@risk/map";
import type { GameState } from "@risk/rules";

export interface ContinentMarkModel {
  continentId: string;
  name?: string;
  bonusMark?: number;
  nameSlot: [number, number];
  bonusSlot: [number, number];
}

/** Permanent legacy writing is absent on a fresh board and appears only after reward resolution. */
export function continentMarkModels(state: Pick<GameState, "continents">): ContinentMarkModel[] {
  return continentPresentationDefinitions.flatMap((definition) => {
    const legacy = state.continents[definition.continentId];
    if (!legacy?.name && legacy?.bonusMark === undefined) return [];
    return [{ ...definition, name: legacy.name, bonusMark: legacy.bonusMark }];
  });
}

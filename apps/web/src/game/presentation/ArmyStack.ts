export type ArmyPieceDenomination = 1 | 3;

export interface ArmyPieceModel {
  id: string;
  denomination: ArmyPieceDenomination;
  slot: number;
  yaw: -1 | 0 | 1;
}

export interface ArmyStackModel {
  total: number;
  pieces: ArmyPieceModel[];
  /** Troops reported by hover detail but not repeated as miniatures. */
  reserve: number;
  accessibleLabel: string;
}

function hash(value: string) {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return result >>> 0;
}

export function composeArmyStack(total: number, identitySeed: string): ArmyStackModel {
  const safeTotal = Math.max(0, Math.floor(total));
  let unrepresented = safeTotal;
  const denominations: ArmyPieceDenomination[] = [];
  while (unrepresented >= 3 && denominations.length < 3) {
    denominations.push(3);
    unrepresented -= 3;
  }
  while (unrepresented > 0 && denominations.filter((denomination) => denomination === 1).length < 2) {
    denominations.push(1);
    unrepresented--;
  }

  let threeSlot = 0;
  let oneSlot = 3;
  const pieces = denominations.map((denomination, index) => {
    const slot = denomination === 3 ? threeSlot++ : oneSlot++;
    return {
      id: `${identitySeed}:${denomination}:${index}`,
      denomination,
      slot,
      yaw: [-1, 0, 1][hash(`${identitySeed}:${index}`) % 3] as -1 | 0 | 1,
    };
  });
  const represented = denominations.reduce((sum, denomination) => sum + denomination, 0);
  const reserve = Math.max(0, safeTotal - represented);
  const threes = Math.floor(safeTotal / 3);
  const ones = safeTotal % 3;
  return {
    total: safeTotal,
    pieces,
    reserve,
    accessibleLabel: `${safeTotal} troops: ${threes} three-troop ${threes === 1 ? "piece" : "pieces"} and ${ones} one-troop ${ones === 1 ? "piece" : "pieces"}`,
  };
}

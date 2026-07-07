import { useEffect, useRef } from "react";
import type { GameState } from "@risk/rules";

/** Comms-style monospace action ledger (append-only mirror of the engine event log). */
export default function Ledger({ gs }: { gs: GameState }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [gs.log.length]);

  return (
    <div className="border-t border-line min-h-0 grid grid-rows-[auto_1fr]">
      <h3 className="font-display font-bold tracking-widest text-xs text-muted px-4 pt-2 pb-1">LEDGER</h3>
      <div ref={ref} className="overflow-y-auto px-4 pb-2 font-mono text-[11px] leading-relaxed text-muted">
        {gs.log.map((e) => (
          <div key={e.seq}>
            <span className="text-line">{String(e.seq).padStart(3, "0")}</span>{" "}
            <span className={e.type === "GameWon" ? "text-signal" : e.type.includes("Combat") || e.type.includes("Dice") ? "text-text" : ""}>
              {e.type}
            </span>
            {e.playerId && <span> · {gs.players[e.playerId]?.name ?? e.playerId}</span>}
            {renderDetail(e.type, e.data)}
          </div>
        ))}
      </div>
    </div>
  );
}

function renderDetail(type: string, data?: Record<string, unknown>) {
  if (!data) return null;
  if (type === "DiceRolled") return <span> · A[{(data.att as number[]).join(",")}] D[{(data.def as number[]).join(",")}]</span>;
  if (type === "CombatResolved") return <span> · A-{data.attackerLosses as number} D-{data.defenderLosses as number}</span>;
  if (type === "TerritoryConquered") return <span> · {(data.territory as string).replace(/_/g, " ")} ({data.moved as number} in)</span>;
  if (type === "FactionChosen") return <span> · {(data.territory as string).replace(/_/g, " ")} +{data.troops as number}</span>;
  if (type === "TroopsPlaced") return <span> · {(data.territory as string).replace(/_/g, " ")} +{data.count as number}</span>;
  if (type === "GameWon") return <span> · {data.reason as string}</span>;
  return null;
}

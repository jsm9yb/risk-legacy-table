import { useEffect, useRef, useState } from "react";
import type { GameState } from "@risk/rules";
import { territoryName } from "./labels.ts"; // new (UI-1)

const WINDOW = 50; // new (UI-2): render the latest ~50 events; older ones expand lazily

/** Comms-style monospace action ledger — a collapsible BATTLE LOG tab in the rail (UI-2). */
export default function Ledger({ gs }: { gs: GameState }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [gs.log.length, open]);

  const events = expanded ? gs.log : gs.log.slice(-WINDOW);
  const hidden = gs.log.length - events.length;

  return (
    <div className="border-t border-line">
      <button onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-2 font-display font-bold tracking-widest text-xs text-muted hover:text-text">
        <span>BATTLE LOG</span>
        <span className="font-mono">{gs.log.length} {open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div ref={ref} data-testid="ledger-log" className="h-52 overflow-y-auto px-4 pb-2 font-mono text-[11px] leading-relaxed text-muted">
          {hidden > 0 && (
            <button onClick={() => setExpanded(true)} className="text-line hover:text-muted block">
              — earlier {hidden} events —
            </button>
          )}
          {events.map((e) => (
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
      )}
    </div>
  );
}

function renderDetail(type: string, data?: Record<string, unknown>) {
  if (!data) return null;
  if (type === "DiceRolled") return <span> · A[{(data.att as number[]).join(",")}] D[{(data.def as number[]).join(",")}]</span>;
  if (type === "CombatResolved") return <span> · A-{data.attackerLosses as number} D-{data.defenderLosses as number}</span>;
  if (type === "TerritoryConquered") return <span> · {territoryName(data.territory as string)} ({data.moved as number} in)</span>;
  if (type === "FactionChosen") return <span> · {territoryName(data.territory as string)} +{data.troops as number}</span>;
  if (type === "TroopsPlaced") return <span> · {territoryName(data.territory as string)} +{data.count as number}</span>;
  if (type === "GameWon") return <span> · {data.reason as string}</span>;
  return null;
}

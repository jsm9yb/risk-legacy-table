// new (UI-2): the rail is purely ambient — the table, not you: sideboard mat (UI-9) →
// Quick Look roster (emblem tiles, UI-10) → battle log as a tab (in GameScreen). All
// phase controls live in the bottom action bar; blocking decisions on the UI-8 overlays.
import { redStars, type GameState } from "@risk/rules";
import { factionById } from "./labels.ts";
import SideboardMat from "./cards/SideboardMat.tsx"; // new (UI-9)
import FactionEmblem from "./FactionEmblem.tsx"; // new (UI-10)

type Props = {
  gs: GameState;
  actor?: string;
  playerFaction: (pid?: string) => string | undefined;
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="px-4 py-3 border-b border-line">
      <h3 className="font-display font-bold tracking-widest text-xs text-muted mb-2">{title}</h3>
      {children}
    </section>
  );
}

export default function SidePanel({ gs, actor, playerFaction }: Props) {
  return (
    <div>
      {gs.phase === "game_over" && (
        <Section title="RESULT">
          <p className="text-sm mb-2">
            <span className="text-signal font-semibold">{gs.players[gs.winner!]?.name}</span> wins — {gs.winReason}. Board is locked.
          </p>
          <div className="font-mono text-xs space-y-0.5">
            {Object.entries(gs.results ?? {}).map(([fid, r]) => (
              <div key={fid}><span className="text-muted">{factionById(fid)?.name}:</span> {r.replace("_", " ")}</div>
            ))}
          </div>
        </Section>
      )}

      {/* Sideboard — the table's shared mat (UI-9) */}
      <Section title="SIDEBOARD">
        <SideboardMat gs={gs} />
      </Section>

      {/* Quick look (Q48): stars as tokens + board + total; counts public */}
      <Section title="QUICK LOOK">
        <div className="space-y-1.5">
          {gs.turnOrder.map((pid) => {
            const pl = gs.players[pid];
            const rs = redStars(gs, pid);
            const active = pid === actor;
            return (
              <div key={pid} className={`flex items-center gap-2 font-mono text-xs ${pl.eliminated ? "opacity-40 line-through" : ""}`}>
                {pl.factionId
                  ? <FactionEmblem factionId={pl.factionId} size="xs" />
                  : <span className="w-2 h-2 rounded-full" style={{ background: playerFaction(pid) ?? "#5a6578" }} />}{/* new (UI-10) */}
                <span className={active ? "text-signal" : ""}>{pl.name}</span>
                <span className="ml-auto text-muted">★{rs.tokens}+{rs.board}={rs.total}</span>
                <span title="resource cards">🂠{(pl as any).handCount ?? pl.hand.length}</span>{/* new (1-web-b): filtered payloads carry counts */}
                <span title="missiles">▲{pl.missiles}</span>
                {pl.knockedOut && <span className="text-danger">KO</span>}
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

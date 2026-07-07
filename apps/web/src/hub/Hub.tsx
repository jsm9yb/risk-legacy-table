import { useState } from "react";
import type { LocalConfig } from "../App.tsx";

/**
 * Campaign hub — first screen is the usable game hub (plan: no marketing page).
 * v1 ships the local hot-seat sandbox; LAN campaign lobby wires into @risk/server next slice.
 */
export default function Hub({ onStart, onLan }: { onStart: (cfg: LocalConfig) => void; onLan: () => void }) { // new (1-web-a)
  const [names, setNames] = useState<string[]>(["Player 1", "Player 2", "Player 3"]);
  const [seed, setSeed] = useState<string>(() => String(Math.floor(Math.random() * 1e9)));

  const setName = (i: number, v: string) => setNames((n) => n.map((x, j) => (j === i ? v : x)));

  return (
    <div className="min-h-full flex flex-col">
      <header className="border-b border-line px-8 py-5 flex items-baseline gap-4">
        <h1 className="font-display font-extrabold tracking-wide text-3xl text-signal">WAR ROOM</h1>
        <span className="font-mono text-xs text-muted uppercase tracking-widest">Risk Legacy · private campaign table</span>
      </header>

      <main className="flex-1 grid grid-cols-[1fr_360px] gap-8 p-8 max-w-5xl w-full mx-auto">
        <section className="bg-panel border border-line rounded-sm p-6">
          <h2 className="font-display font-bold text-xl tracking-wide mb-1">LOCAL HOT-SEAT GAME</h2>
          <p className="text-muted text-sm mb-5">One screen, pass control. Full rules engine, seeded dice, complete action ledger.</p>

          <div className="space-y-2 mb-5">
            {names.map((n, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted w-14">SEAT {i + 1}</span>
                <input
                  value={n}
                  onChange={(e) => setName(i, e.target.value)}
                  className="flex-1 bg-ink border border-line rounded-sm px-3 py-1.5 text-sm focus:border-signal outline-none"
                />
                {names.length > 2 && (
                  <button onClick={() => setNames((x) => x.filter((_, j) => j !== i))}
                    className="text-muted hover:text-danger text-sm px-2" aria-label={`Remove seat ${i + 1}`}>✕</button>
                )}
              </div>
            ))}
          </div>
          {names.length < 5 && (
            <button onClick={() => setNames((n) => [...n, `Player ${n.length + 1}`])}
              className="text-sm text-signal hover:underline mb-5 block">+ Add seat ({names.length}/5)</button>
          )}

          <div className="flex items-center gap-2 mb-6">
            <span className="font-mono text-xs text-muted w-14">SEED</span>
            <input value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ""))}
              className="w-40 bg-ink border border-line rounded-sm px-3 py-1.5 font-mono text-sm focus:border-signal outline-none" />
            <button onClick={() => setSeed(String(Math.floor(Math.random() * 1e9)))}
              className="text-xs text-muted hover:text-text">reroll</button>
          </div>

          <button
            onClick={() => onStart({ seed: Number(seed) || 1, players: names.map((n, i) => ({ id: `seat${i + 1}`, name: n.trim() || `Player ${i + 1}` })) })}
            className="font-display font-bold tracking-widest text-lg bg-signal text-ink px-8 py-2.5 rounded-sm hover:brightness-110"
          >
            START GAME
          </button>
        </section>

        <aside className="space-y-4">
          <div className="bg-panel border border-line rounded-sm p-5">
            <h3 className="font-display font-bold tracking-wide mb-1">LAN CAMPAIGNS</h3>
            <p className="text-sm text-muted mb-3">
              Run <code className="font-mono text-xs">npm run dev:server</code> on the Mac mini, then connect every laptop on the
              house network. Accounts, invite codes, and lobbies are live; the synced multi-client game screen lands next (1-web-b).
            </p>
            <button onClick={onLan}
              className="font-display font-bold tracking-widest text-sm border border-signal text-signal px-4 py-1.5 rounded-sm hover:bg-signal hover:text-ink">
              CONNECT
            </button>{/* new (1-web-a) */}
          </div>
          <div className="bg-panel border border-line rounded-sm p-5">
            <h3 className="font-display font-bold tracking-wide mb-1">BOARD ASSET</h3>
            <p className="text-sm text-muted">
              Rendering the generated placeholder board. Drop <code className="font-mono text-xs">risk_board_modern_web.svg</code> into{" "}
              <code className="font-mono text-xs">packages/map/assets/</code> to swap in the real map.
            </p>
          </div>
        </aside>
      </main>
    </div>
  );
}

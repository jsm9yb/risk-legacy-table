// new (UI-6): game-first hub — the first screen is the game table, not a status page.
// Dimmed board art backdrop, the world name in display type, the five faction emblems,
// and two player-facing entries: PLAY AT THIS TABLE (hot-seat) and JOIN THE WAR ROOM (LAN).
import { useState } from "react";
import { contentPack } from "@risk/content";
import type { LocalConfig } from "../App.tsx";
import boardSvg from "../../../../packages/map/assets/board.svg?raw";
import FactionEmblem from "../game/FactionEmblem.tsx";

export default function Hub({ onStart, onLan }: { onStart: (cfg: LocalConfig) => void; onLan: () => void }) { // new (1-web-a)
  const [names, setNames] = useState<string[]>(["Player 1", "Player 2", "Player 3"]);
  const [seed, setSeed] = useState<string>(() => String(Math.floor(Math.random() * 1e9)));

  const setName = (i: number, v: string) => setNames((n) => n.map((x, j) => (j === i ? v : x)));

  return (
    <div className="relative min-h-full flex flex-col overflow-hidden">
      {/* dimmed full-bleed board backdrop — the table under everything */}
      <div aria-hidden className="board-backdrop absolute inset-0 opacity-[0.13] pointer-events-none select-none"
        dangerouslySetInnerHTML={{ __html: boardSvg }} />

      <header className="relative border-b border-line px-8 py-5 flex items-baseline gap-4">
        <h1 className="font-display font-extrabold tracking-wide text-3xl text-signal">WAR ROOM</h1>
        <span className="font-mono text-xs text-muted uppercase tracking-widest">Risk Legacy · private campaign table</span>
      </header>

      <main className="relative flex-1 w-full max-w-5xl mx-auto px-8 py-10">
        <div className="text-center mb-10">
          <p className="font-mono text-[10px] text-muted uppercase tracking-widest mb-2">This world is yours to scar</p>
          <h2 className="font-display font-extrabold tracking-widest text-4xl lg:text-5xl">AN UNNAMED WORLD</h2>
          <div className="flex justify-center gap-3 mt-5">
            {contentPack.factions.map((f) => <FactionEmblem key={f.id} factionId={f.id} size="md" />)}
          </div>
        </div>

        <div className="grid lg:grid-cols-[1fr_360px] gap-6">
          <section className="bg-panel/95 border border-line rounded-sm p-6">
            <h2 className="font-display font-bold text-xl tracking-wide mb-1">PLAY AT THIS TABLE</h2>
            <p className="text-muted text-sm mb-5">One screen, pass the device — everyone fights for the same board.</p>

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
              <span className="font-mono text-xs text-muted w-14">DICE</span>
              <input value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ""))}
                aria-label="Dice seed"
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

          <section className="bg-panel/95 border border-line rounded-sm p-6 h-fit">
            <h2 className="font-display font-bold text-xl tracking-wide mb-1">JOIN THE WAR ROOM</h2>
            <p className="text-sm text-muted mb-4">
              Your group's campaign lives on the house network — sign in from any laptop to join
              the lobby, take your faction, and play on a synced board.
            </p>
            <button onClick={onLan}
              className="font-display font-bold tracking-widest text-sm border border-signal text-signal px-4 py-1.5 rounded-sm hover:bg-signal hover:text-ink">
              CONNECT
            </button>{/* new (1-web-a) */}
          </section>
        </div>
      </main>
    </div>
  );
}

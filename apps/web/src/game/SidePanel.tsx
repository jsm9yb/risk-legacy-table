// new (UI-8): the rail is ambient status + non-blocking phase controls. Blocking decisions
// (setup takeover, combat overlay, start/end-of-turn dock) moved to the shared overlay layer;
// the old CombatTray is retired. UI-1: labels come from the content pack, never raw ids.
import { contentPack } from "@risk/content";
import { redStars, type GameState, type Action } from "@risk/rules";
import type { UiState } from "./GameScreen.tsx"; // new (1-web-b)
import { cardLabel, continentName, factionById } from "./labels.ts";
import { Btn, Num } from "./overlays.tsx";

type Props = {
  gs: GameState;
  ui: UiState;
  setUi: (fn: (u: UiState) => UiState) => void;
  dispatch: (a: Action) => void;
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

export default function SidePanel({ gs, ui, setUi, dispatch, actor, playerFaction }: Props) {
  const p = actor ? gs.players[actor] : undefined;

  return (
    <div>
      {/* Quick look (Q48): stars as tokens + board + total; counts public */}
      <Section title="QUICK LOOK">
        <div className="space-y-1.5">
          {gs.turnOrder.map((pid) => {
            const pl = gs.players[pid];
            const rs = redStars(gs, pid);
            const active = pid === actor;
            return (
              <div key={pid} className={`flex items-center gap-2 font-mono text-xs ${pl.eliminated ? "opacity-40 line-through" : ""}`}>
                <span className="w-2 h-2 rounded-full" style={{ background: playerFaction(pid) ?? "#5a6578" }} />
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

      {gs.phase === "join_or_recruit" && actor && p && (
        Object.values(gs.territories).some((t) => t.controller === actor) ? (
          gs.recruit && (
            <Section title="RECRUIT">
              <div className="font-mono text-xs space-y-0.5 mb-2">
                <div><span className="text-muted">(territories {gs.recruit.breakdown.territories}{gs.recruit.breakdown.population > 0 ? ` + pop ${gs.recruit.breakdown.population}` : ""}) / 3 →</span> {gs.recruit.breakdown.fromTerritories}</div>{/* new (9): population counts inside the division */}
                {gs.recruit.breakdown.continents.map((c) => (
                  <div key={c.id}><span className="text-muted">{continentName(c.id)} ({c.base}+{c.globalModifier}+{c.namedBonus}) →</span> {c.total}</div>
                ))}
                {gs.recruit.breakdown.tradeIns > 0 && <div><span className="text-muted">trade-ins →</span> {gs.recruit.breakdown.tradeIns}</div>}
                <div className="text-signal">to place → {gs.recruit.remaining}</div>
              </div>
              {p.hand.length >= 2 && (
                <details className="mb-2">
                  <summary className="text-xs text-muted cursor-pointer">Trade in Resource cards</summary>
                  <div className="space-y-1 mt-1">
                    {p.hand.map((id) => (
                      <label key={id} className="flex items-center gap-2 font-mono text-xs">
                        <input type="checkbox" checked={ui.selectedCards.includes(id)}
                          onChange={(e) => setUi((u) => ({ ...u, selectedCards: e.target.checked ? [...u.selectedCards, id] : u.selectedCards.filter((x) => x !== id) }))} />
                        {cardLabel(id)}
                      </label>
                    ))}
                    {ui.selectedCards.length >= 2 && (
                      <Btn onClick={() => dispatch({ type: "recruit.trade", playerId: actor, cardIds: ui.selectedCards })}>Trade {ui.selectedCards.length} cards</Btn>
                    )}
                  </div>
                </details>
              )}
              <div className="flex items-center gap-2 mb-2 text-sm">
                Place <Num value={ui.placeCount} min={1} max={Math.max(1, gs.recruit.remaining)} onChange={(n) => setUi((u) => ({ ...u, placeCount: n }))} /> per click
              </div>
              {gs.recruit.remaining === 0 && (
                <Btn tone="primary" onClick={() => dispatch({ type: "recruit.done", playerId: actor })}>To Attack Phase</Btn>
              )}
            </Section>
          )
        ) : (
          <Section title="JOIN THE WAR">
            <p className="text-xs text-muted">You hold no territory. Click a highlighted territory to re-enter with {String((contentPack.ruleConstants.minRecruit as any).value)} troops.</p>
          </Section>
        )
      )}

      {gs.phase === "expand_attack" && actor && !gs.combat && (
        <Section title="EXPAND & ATTACK">
          <p className="text-xs text-muted mb-2">Select your territory, then click an adjacent target: empty = expand, enemy = attack.</p>
          <div className="flex items-center gap-2 mb-2 text-sm">
            Expand with <Num value={ui.expandCount} min={1} max={99} onChange={(n) => setUi((u) => ({ ...u, expandCount: n }))} /> troops
          </div>
          <Btn onClick={() => dispatch({ type: "phase.endAttacks", playerId: actor })}>End Attacks</Btn>
        </Section>
      )}

      {gs.phase === "maneuver" && actor && (
        <Section title="MANEUVER">
          <p className="text-xs text-muted mb-2">{gs.maneuverUsed ? "Maneuver used." : "Select a source, then a connected territory."}</p>
          {!gs.maneuverUsed && (
            <div className="flex items-center gap-2 mb-2 text-sm">
              Move <Num value={ui.moveCount} min={1} max={99} onChange={(n) => setUi((u) => ({ ...u, moveCount: n }))} /> troops
            </div>
          )}
          <Btn tone="primary" onClick={() => dispatch({ type: "phase.endManeuver", playerId: actor })}>End Turn Phase</Btn>
        </Section>
      )}

      {/* Sideboard always visible: exactly 4 face-up slots + coin pile (Q? slot-4 coin-draw discard) */}
      <Section title="SIDEBOARD">
        <div className="font-mono text-xs space-y-0.5">
          {gs.sideboard.slots.map((id, i) => (
            <div key={i}><span className="text-muted">slot {i + 1}:</span> {id ? cardLabel(id) : "—"}</div>
          ))}
          <div><span className="text-muted">deck:</span> {(gs.sideboard as any).territoryDeckCount ?? gs.sideboard.territoryDeck.length} · <span className="text-muted">coins:</span> {(gs.sideboard as any).coinCount ?? gs.sideboard.coinPile.length} · <span className="text-muted">discard:</span> {gs.sideboard.discard.length}</div>{/* new (1-web-b) */}
        </div>
      </Section>
    </div>
  );
}

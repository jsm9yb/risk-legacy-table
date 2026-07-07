import { useState } from "react";
import { contentPack } from "@risk/content";
import { redStars, type GameState, type Action } from "@risk/rules";
import type { UiState } from "./GameScreen.tsx"; // new (1-web-b)

type Props = {
  gs: GameState;
  ui: UiState;
  setUi: (fn: (u: UiState) => UiState) => void;
  dispatch: (a: Action) => void;
  actor?: string;
  playerFaction: (pid?: string) => string | undefined;
};

const cardDef = (id: string) =>
  contentPack.cards.territoryCards.find((c) => c.id === id) ??
  contentPack.cards.coinCards.find((c) => c.id === id)!;

const cardLabel = (id: string) => {
  const c = cardDef(id);
  return c.kind === "territory"
    ? `${c.territoryId.replace(/_/g, " ")} (${c.resources})`
    : `coin (${c.resources})`;
};

function Num({ value, onChange, min, max }: { value: number; onChange: (n: number) => void; min: number; max: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      <button className="w-6 h-6 bg-panel-2 border border-line rounded-sm hover:border-signal" onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <span className="font-mono w-8 text-center">{Math.min(Math.max(value, min), max)}</span>
      <button className="w-6 h-6 bg-panel-2 border border-line rounded-sm hover:border-signal" onClick={() => onChange(Math.min(max, value + 1))}>+</button>
    </span>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="px-4 py-3 border-b border-line">
      <h3 className="font-display font-bold tracking-widest text-xs text-muted mb-2">{title}</h3>
      {children}
    </section>
  );
}

function Btn({ onClick, children, tone = "default" }: { onClick: () => void; children: React.ReactNode; tone?: "default" | "primary" | "danger" }) {
  const cls = tone === "primary" ? "bg-signal text-ink hover:brightness-110"
    : tone === "danger" ? "border border-danger text-danger hover:bg-danger hover:text-ink"
    : "border border-line hover:border-signal";
  return <button onClick={onClick} className={`px-3 py-1.5 rounded-sm text-sm font-medium ${cls}`}>{children}</button>;
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
              <div key={fid}><span className="text-muted">{contentPack.factions.find((f) => f.id === fid)?.name}:</span> {r.replace("_", " ")}</div>
            ))}
          </div>
        </Section>
      )}

      {gs.phase === "setup" && actor && (
        <Section title={`FACTION PICK — ${gs.players[actor].name}`}>
          <div className="space-y-1 mb-2">
            {contentPack.factions.map((f) => {
              const taken = Object.values(gs.players).some((x) => x.factionId === f.id);
              const picked = ui.pickedFaction === f.id;
              return (
                <button key={f.id} disabled={taken}
                  onClick={() => setUi((u) => ({ ...u, pickedFaction: f.id, pickedPower: undefined }))}
                  className={`w-full text-left px-2 py-1.5 rounded-sm border text-sm flex items-center gap-2 ${
                    taken ? "opacity-35 border-line" : picked ? "border-signal" : "border-line hover:border-muted"}`}>
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: f.color }} />
                  {f.name}
                  <span className="ml-auto font-mono text-[10px] text-muted">{f.startingPowers.join(" · ")}</span>
                </button>
              );
            })}
          </div>
          {ui.pickedFaction && ( // new (9): first play requires a starting-power pick; later games show the permanent choice
            gs.factionPowers[ui.pickedFaction] ? (
              <p className="text-xs text-muted mb-2">
                Power (permanent): <span className="text-text">{contentPack.powers.find((x) => x.id === gs.factionPowers[ui.pickedFaction!])?.name}</span>
              </p>
            ) : (
              <div className="space-y-1 mb-2">
                <p className="font-mono text-[10px] text-muted uppercase tracking-widest">Starting power — permanent for this faction</p>
                {contentPack.factions.find((f) => f.id === ui.pickedFaction)!.startingPowers.map((pwId) => {
                  const pw = contentPack.powers.find((x) => x.id === pwId)!;
                  const picked = ui.pickedPower === pwId;
                  return (
                    <button key={pwId} onClick={() => setUi((u) => ({ ...u, pickedPower: pwId }))}
                      className={`w-full text-left px-2 py-1.5 rounded-sm border ${picked ? "border-signal" : "border-line hover:border-muted"}`}>
                      <span className="text-sm block">{pw.name}</span>
                      <span className="text-xs text-muted">{pw.text}</span>
                    </button>
                  );
                })}
              </div>
            )
          )}
          <p className="text-xs text-muted">Then click a highlighted territory. HQ and starting troops place automatically.</p>
        </Section>
      )}

      {gs.phase === "start_turn" && actor && p && (
        <Section title="START OF TURN">
          <p className="text-xs text-muted mb-2">Buy Red Stars before recruiting. Cost: {String((contentPack.ruleConstants.redStarPurchaseCost as any).value)} Resource cards.</p>
          {p.hand.length > 0 && (
            <div className="space-y-1 mb-2">
              {p.hand.map((id) => (
                <label key={id} className="flex items-center gap-2 font-mono text-xs">
                  <input type="checkbox" checked={ui.selectedCards.includes(id)}
                    onChange={(e) => setUi((u) => ({ ...u, selectedCards: e.target.checked ? [...u.selectedCards, id] : u.selectedCards.filter((x) => x !== id) }))} />
                  {cardLabel(id)}
                </label>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            {ui.selectedCards.length === 4 && (
              <Btn tone="primary" onClick={() => dispatch({ type: "start.buyRedStar", playerId: actor, cardIds: ui.selectedCards })}>Buy Red Star</Btn>
            )}
            <Btn onClick={() => dispatch({ type: "start.done", playerId: actor })}>Continue</Btn>
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
                  <div key={c.id}><span className="text-muted">{c.id.replace(/_/g, " ")} ({c.base}+{c.globalModifier}+{c.namedBonus}) →</span> {c.total}</div>
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

      {gs.combat && <CombatTray gs={gs} dispatch={dispatch} playerFaction={playerFaction} />}

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

      {gs.phase === "end_turn" && actor && p && (
        <Section title="END OF TURN">
          {p.conqueredEnemyThisTurn ? (
            <>
              <p className="text-xs text-muted mb-2">You conquered enemy territory — draw one Resource card. Matching face-up territory cards are mandatory before coins.</p>
              <div className="space-y-1 mb-2">
                {gs.sideboard.slots.map((id, i) => {
                  if (!id) return <div key={i} className="font-mono text-xs text-muted">slot {i + 1}: —</div>;
                  const c = cardDef(id);
                  const mine = c.kind === "territory" && gs.territories[c.territoryId].controller === actor;
                  return (
                    <div key={i} className="flex items-center gap-2 font-mono text-xs">
                      <span className={mine ? "text-signal" : "text-muted"}>slot {i + 1}: {cardLabel(id)}</span>
                      {mine && <Btn tone="primary" onClick={() => dispatch({ type: "end.draw", playerId: actor, choice: { slot: i } })}>Take</Btn>}
                    </div>
                  );
                })}
                <div className="flex items-center gap-2 font-mono text-xs">
                  <span className="text-muted">coin pile: {(gs.sideboard as any).coinCount ?? gs.sideboard.coinPile.length}</span>{/* new (1-web-b) */}
                  <Btn onClick={() => dispatch({ type: "end.draw", playerId: actor, choice: { coin: true } })}>Take coin</Btn>
                </div>
              </div>
            </>
          ) : (
            <Btn tone="primary" onClick={() => dispatch({ type: "end.turn", playerId: actor })}>End Turn</Btn>
          )}
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

function CombatTray({ gs, dispatch, playerFaction }: { gs: GameState; dispatch: (a: Action) => void; playerFaction: (pid?: string) => string | undefined }) {
  const c = gs.combat!;
  const att = gs.players[c.attacker];
  const def = gs.players[c.defender];
  const fromT = gs.territories[c.from];
  const toT = gs.territories[c.to];

  const Die = ({ v, final, mod }: { v: number; final: number; mod: boolean }) => (
    <span className={`inline-flex items-center justify-center w-7 h-7 rounded-sm border font-mono text-sm ${
      mod ? "border-signal text-signal" : "border-line"}`} title={mod ? `natural ${v} → missile 6` : undefined}>
      {final}
    </span>
  );

  const finals = c.natural
    ? {
        att: c.natural.att.map((v, i) => ({ v, final: c.modifiers.some((m) => m.side === "att" && m.dieIndex === i) ? 6 : v, mod: c.modifiers.some((m) => m.side === "att" && m.dieIndex === i) })),
        def: c.natural.def.map((v, i) => ({ v, final: c.modifiers.some((m) => m.side === "def" && m.dieIndex === i) ? 6 : v, mod: c.modifiers.some((m) => m.side === "def" && m.dieIndex === i) })),
      }
    : null;

  const windowActor = c.natural && c.window
    ? [c.attacker, c.defender].find((pid) => gs.players[pid].missiles > 0 && !c.window!.passed.includes(pid))
    : undefined;

  return (
    <Section title="COMBAT TRAY">
      <div className="font-mono text-xs mb-2">
        <span style={{ color: playerFaction(c.attacker) }}>{att.name}</span> {c.from.replace(/_/g, " ")} ({fromT.troops})
        <span className="text-danger"> ⚔ </span>
        <span style={{ color: playerFaction(c.defender) }}>{def.name}</span> {c.to.replace(/_/g, " ")} ({toT.troops})
      </div>

      {!c.natural && !c.awaitingMoveIn && (
        <div className="space-y-2">
          {c.attackerDice === undefined ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted text-xs">{att.name}: attackers</span>
              {[1, 2, 3].filter((n) => n <= fromT.troops - 1).map((n) => (
                <Btn key={n} onClick={() => dispatch({ type: "attack.chooseAttackers", playerId: c.attacker, count: n })}>{n}</Btn>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted text-xs">{def.name}: defense dice</span>
              {[1, 2].filter((n) => n <= toT.troops).map((n) => (
                <Btn key={n} onClick={() => dispatch({ type: "attack.defenderDice", playerId: c.defender, count: n })}>{n}</Btn>
              ))}
            </div>
          )}
          {c.attackerDice === undefined && (
            <Btn onClick={() => dispatch({ type: "attack.cancel", playerId: c.attacker })}>Cancel attack</Btn>
          )}
        </div>
      )}

      {finals && c.window && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] text-muted w-8">ATT</span>
            {finals.att.map((d, i) => <Die key={i} {...d} />)}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[10px] text-muted w-8">DEF</span>
            {finals.def.map((d, i) => <Die key={i} {...d} />)}
          </div>
          {windowActor && (
            <div className="border border-signal rounded-sm p-2">
              <p className="font-mono text-xs text-signal mb-1.5">MODIFIER WINDOW — {gs.players[windowActor].name} (missiles: {gs.players[windowActor].missiles})</p>
              <div className="flex flex-wrap gap-1.5">
                {(windowActor === c.attacker ? finals.att : finals.def).map((d, i) =>
                  d.mod ? null : (
                    <Btn key={i} onClick={() => dispatch({ type: "combat.useMissile", playerId: windowActor, dieIndex: i })}>
                      ▲ die {i + 1} → 6
                    </Btn>
                  )
                )}
                <Btn onClick={() => dispatch({ type: "combat.pass", playerId: windowActor })}>Pass</Btn>
              </div>
            </div>
          )}
        </div>
      )}

      {c.awaitingMoveIn && (
        <MoveIn min={c.awaitingMoveIn.min} max={c.awaitingMoveIn.max}
          onCommit={(n) => dispatch({ type: "attack.moveIn", playerId: c.attacker, count: n })} />
      )}
    </Section>
  );
}

function MoveIn({ min, max, onCommit }: { min: number; max: number; onCommit: (n: number) => void }) {
  const [n, setN] = useState(max);
  return (
    <div className="space-y-2">
      <p className="font-mono text-xs text-signal">Territory taken — move in {min}–{max} troops.</p>
      <input type="range" min={min} max={max} value={n} onChange={(e) => setN(Number(e.target.value))} className="w-full accent-(--color-signal)" />
      <Btn tone="primary" onClick={() => onCommit(n)}>Move in {n}</Btn>
    </div>
  );
}

// new (UI-8): the combat modal — replaces the rail CombatTray. A large centered overlay
// drives dice choice → roll → missile window (explicit interrupt) → casualties → move-in
// through the real action API, with a per-roll battle log for sieges, explanatory
// scar/power badges, an ATTACK AGAIN re-arm, and a per-player auto-defend toggle.
import { useEffect, useState } from "react";
import type { Action, GameState } from "@risk/rules";
import { factionById, scarName, territoryName } from "./labels.ts";
import { Btn, CenterOverlay, DecisionChip } from "./overlays.tsx";

const SCAR_COMBAT_NOTES: Record<string, string> = {
  bunker: "+1 to the defender's highest die",
  ammo_shortage: "−1 to the defender's highest die",
};

interface RollRecord {
  natural: { att: number[]; def: number[] };
  final: { att: number[]; def: number[] };
  attackerLosses: number;
  defenderLosses: number;
}

function Die({ natural, final, mod }: { natural: number; final: number; mod: boolean }) {
  return (
    <span className={`die-tumble inline-flex flex-col items-center justify-center w-12 h-12 rounded-sm border-2 ${
      mod ? "border-signal text-signal" : "border-line"}`}>
      <span className="font-display font-bold text-2xl leading-none">{final}</span>
      {mod && <span className="font-mono text-[8px] leading-none mt-0.5">{natural !== final ? `was ${natural}` : "▲"}</span>}
    </span>
  );
}

function DiceRow({ label, dice, rollKey }: { label: string; dice: { natural: number; final: number; mod: boolean }[]; rollKey: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] text-muted w-8">{label}</span>
      {dice.map((d, i) => <Die key={`${rollKey}-${i}`} {...d} />)}
    </div>
  );
}

export default function CombatOverlay({ gs, dispatch, canActFor, autoDefend, onAutoDefend }: {
  gs: GameState;
  dispatch: (a: Action) => void;
  canActFor: (pid: string) => boolean;
  autoDefend: Record<string, boolean>;
  onAutoDefend: (pid: string, on: boolean) => void;
}) {
  const c = gs.combat!;
  const att = gs.players[c.attacker];
  const def = gs.players[c.defender];
  const fromT = gs.territories[c.from];
  const toT = gs.territories[c.to];
  const attFaction = factionById(att.factionId);
  const defFaction = factionById(def.factionId);

  // Per-roll history since this battle was declared (siege support).
  let openSeq = 0;
  for (let i = gs.log.length - 1; i >= 0; i--) {
    const e = gs.log[i];
    if (e.type === "AttackDeclared" && e.data?.from === c.from && e.data?.to === c.to) { openSeq = e.seq; break; }
  }
  const rolls = gs.log
    .filter((e) => e.seq > openSeq && e.type === "CombatResolved")
    .map((e) => e.data as unknown as RollRecord);
  const lastRoll = rolls[rolls.length - 1];

  const [rearm, setRearm] = useState(false);
  useEffect(() => setRearm(false), [rolls.length]);

  const windowActor = c.natural && c.window
    ? [c.attacker, c.defender].find((pid) => gs.players[pid].missiles > 0 && !c.window!.passed.includes(pid))
    : undefined;

  const stage = c.awaitingMoveIn ? "movein"
    : c.natural ? "window"
    : c.attackerDice === undefined ? (rolls.length > 0 && !rearm ? "aftermath" : "attackers")
    : "defenders";

  const decider = stage === "defenders" ? c.defender : stage === "window" ? windowActor ?? c.attacker : c.attacker;

  // Explanatory badges: scar/power effects that will shape this roll's dice.
  const hasPower = (pid: string, powerId: string) => {
    const fid = gs.players[pid].factionId;
    return !!fid && gs.factionPowers[fid] === powerId;
  };
  const fortActive = !!toT.fortification && toT.fortification.remaining > 0;
  const badges: { label: string; note: string }[] = [];
  for (const sid of toT.scars) if (SCAR_COMBAT_NOTES[sid]) badges.push({ label: scarName(sid), note: SCAR_COMBAT_NOTES[sid] });
  if (fortActive) badges.push({ label: "Fortification", note: `+1 to each defense die · ${toT.fortification!.remaining}/${toT.fortification!.max} durability` });
  if (hasPower(c.defender, "fortified_hq") && toT.hqFaction === def.factionId && !fortActive)
    badges.push({ label: "Fortified HQ", note: "+1 to each defense die (defender power)" });
  if (hasPower(c.attacker, "lower_die_intimidation") && gs.intimidation && !gs.intimidation.broken && gs.intimidation.territory === c.to)
    badges.push({ label: "Intimidation", note: "−1 to the defender's lowest die (attacker power)" });
  if (hasPower(c.defender, "defensive_stand"))
    badges.push({ label: "Defensive Stand", note: "a natural 6-6 defense locks this territory for the turn" });

  const missileDice = (side: "att" | "def") => {
    const naturals = side === "att" ? c.natural!.att : c.natural!.def;
    return naturals.map((v, i) => {
      const mod = c.modifiers.some((m) => m.side === side && m.dieIndex === i);
      return { natural: v, final: mod ? 6 : v, mod };
    });
  };
  const rollDice = (r: RollRecord, side: "att" | "def") =>
    r.final[side].map((f, i) => ({ natural: r.natural[side][i], final: f, mod: f !== r.natural[side][i] }));

  return (
    <CenterOverlay label="Combat">
      {/* header: attacker vs defender panels in faction colors */}
      <div className="px-5 pt-4 pb-3 border-b border-line">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display font-bold tracking-widest text-sm text-muted">COMBAT</h3>
          {decider && <DecisionChip name={gs.players[decider].name}
            color={factionById(gs.players[decider].factionId)?.color} />}
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-center">
          <div className="border-l-4 pl-3" style={{ borderColor: attFaction?.color ?? "var(--color-line)" }}>
            <div className="font-display font-bold tracking-widest">{att.name}</div>
            <div className="text-xs text-muted">{attFaction?.name}</div>
            <div className="font-mono text-xs mt-1">{territoryName(c.from)} · {fromT.troops} troops</div>
          </div>
          <div className="font-display font-bold text-2xl text-danger">VS</div>
          <div className="border-r-4 pr-3 text-right" style={{ borderColor: defFaction?.color ?? "var(--color-line)" }}>
            <div className="font-display font-bold tracking-widest">{def.name}</div>
            <div className="text-xs text-muted">{defFaction?.name}</div>
            <div className="font-mono text-xs mt-1">{territoryName(c.to)} · {toT.troops} troops</div>
          </div>
        </div>
        {badges.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {badges.map((b) => (
              <span key={b.label} className="font-mono text-[10px] bg-panel-2 border border-line rounded-sm px-2 py-0.5"
                title={b.note}>
                <span className="text-signal">{b.label}</span> <span className="text-muted">{b.note}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="px-5 py-4">
        {stage === "attackers" && (
          <div>
            <p className="text-xs text-muted mb-2">{att.name} chooses how many dice to attack with (each die risks one troop).</p>
            <div className="flex items-center gap-2">
              {[1, 2, 3].filter((n) => n <= fromT.troops - 1).map((n) => (
                <Btn key={n} ariaLabel={`Attack with ${n} ${n === 1 ? "die" : "dice"}`} disabled={!canActFor(c.attacker)}
                  onClick={() => dispatch({ type: "attack.chooseAttackers", playerId: c.attacker, count: n })}>{n}</Btn>
              ))}
              <Btn disabled={!canActFor(c.attacker)} onClick={() => dispatch({ type: "attack.cancel", playerId: c.attacker })}>WITHDRAW</Btn>
            </div>
          </div>
        )}

        {stage === "defenders" && (
          <div>
            <p className="text-xs text-muted mb-2">{def.name} chooses how many dice to defend with (defender wins ties).</p>
            <div className="flex items-center gap-2 mb-2">
              {[1, 2].filter((n) => n <= toT.troops).map((n) => (
                <Btn key={n} ariaLabel={`Defend with ${n} ${n === 1 ? "die" : "dice"}`} disabled={!canActFor(c.defender)}
                  onClick={() => dispatch({ type: "attack.defenderDice", playerId: c.defender, count: n })}>{n}</Btn>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-muted">
              <input type="checkbox" checked={!!autoDefend[c.defender]} disabled={!canActFor(c.defender)}
                onChange={(e) => onAutoDefend(c.defender, e.target.checked)} />
              Auto-defend with max dice
            </label>
          </div>
        )}

        {stage === "window" && c.natural && (
          <div className="space-y-2">
            <DiceRow label="ATT" dice={missileDice("att")} rollKey={rolls.length} />
            <DiceRow label="DEF" dice={missileDice("def")} rollKey={rolls.length} />
            {windowActor && (
              <div className="border border-signal rounded-sm p-3 mt-2">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-mono text-xs text-signal tracking-widest">MISSILE WINDOW</p>
                  <DecisionChip name={gs.players[windowActor].name} color={factionById(gs.players[windowActor].factionId)?.color} />
                </div>
                <p className="text-xs text-muted mb-2">
                  {gs.players[windowActor].name} may spend a missile to set one of their own dice to an
                  unmodifiable 6 ({gs.players[windowActor].missiles} left) — or pass.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {missileDice(windowActor === c.attacker ? "att" : "def").map((d, i) =>
                    d.mod ? null : (
                      <Btn key={i} disabled={!canActFor(windowActor)}
                        ariaLabel={`Missile: set ${windowActor === c.attacker ? "attack" : "defense"} die ${i + 1} to 6`}
                        onClick={() => dispatch({ type: "combat.useMissile", playerId: windowActor, dieIndex: i })}>
                        ▲ {d.natural} → 6
                      </Btn>
                    )
                  )}
                  <Btn disabled={!canActFor(windowActor)} onClick={() => dispatch({ type: "combat.pass", playerId: windowActor })}>PASS</Btn>
                </div>
              </div>
            )}
          </div>
        )}

        {stage === "aftermath" && lastRoll && (
          <div className="space-y-2">
            <DiceRow label="ATT" dice={rollDice(lastRoll, "att")} rollKey={rolls.length} />
            <DiceRow label="DEF" dice={rollDice(lastRoll, "def")} rollKey={rolls.length} />
            <p className="font-mono text-xs">
              <span className="text-muted">casualties:</span>{" "}
              <span className={lastRoll.attackerLosses > 0 ? "text-danger" : "text-muted"}>{att.name} −{lastRoll.attackerLosses}</span>
              {" · "}
              <span className={lastRoll.defenderLosses > 0 ? "text-danger" : "text-muted"}>{def.name} −{lastRoll.defenderLosses}</span>
            </p>
            <div className="flex gap-2 pt-1">
              <Btn tone="primary" disabled={!canActFor(c.attacker)} onClick={() => setRearm(true)}>ATTACK AGAIN</Btn>
              <Btn disabled={!canActFor(c.attacker)} onClick={() => dispatch({ type: "attack.cancel", playerId: c.attacker })}>WITHDRAW</Btn>
            </div>
          </div>
        )}

        {stage === "movein" && c.awaitingMoveIn && (
          <MoveIn min={c.awaitingMoveIn.min} max={c.awaitingMoveIn.max} disabled={!canActFor(c.attacker)}
            onCommit={(n) => dispatch({ type: "attack.moveIn", playerId: c.attacker, count: n })} />
        )}

        {rolls.length > 0 && stage !== "aftermath" && (
          <div className="mt-3 pt-2 border-t border-line">
            <p className="font-mono text-[10px] text-muted tracking-widest mb-1">BATTLE LOG</p>
            <div className="font-mono text-[10px] text-muted space-y-0.5 max-h-24 overflow-y-auto">
              {rolls.map((r, i) => (
                <div key={i}>
                  #{i + 1} A[{r.final.att.join(" ")}] D[{r.final.def.join(" ")}] → {att.name} −{r.attackerLosses} · {def.name} −{r.defenderLosses}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </CenterOverlay>
  );
}

function MoveIn({ min, max, disabled, onCommit }: { min: number; max: number; disabled?: boolean; onCommit: (n: number) => void }) {
  const [n, setN] = useState(max);
  return (
    <div className="space-y-2">
      <p className="font-mono text-xs text-signal">Territory taken — move in {min}–{max} troops.</p>
      <input type="range" min={min} max={max} value={n} disabled={disabled}
        onChange={(e) => setN(Number(e.target.value))} className="w-full accent-(--color-signal)" />
      <Btn tone="primary" disabled={disabled} onClick={() => onCommit(Math.min(Math.max(n, min), max))}>MOVE IN {Math.min(Math.max(n, min), max)}</Btn>
    </div>
  );
}

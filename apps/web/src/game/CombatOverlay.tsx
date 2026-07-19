// new (UI-8): the combat modal — replaces the rail CombatTray. A large centered overlay
// drives dice choice → roll → missile window (explicit interrupt) → casualties → move-in
// through the real action API, with a per-roll battle log for sieges, explanatory
// scar/power badges, an ATTACK AGAIN re-arm, and a per-player auto-defend toggle.
import { useEffect, useRef, useState } from "react";
import { hasFactionPower, waitingOn, type Action, type CombatModifier, type GameState } from "@risk/rules";
import { factionById, scarName, territoryName } from "./labels.ts";
import FactionEmblem from "./FactionEmblem.tsx"; // new (UI-10)
import { Btn, CenterOverlay, DecisionChip, TroopPicker } from "./overlays.tsx";

const SCAR_COMBAT_NOTES: Record<string, string> = {
  bunker: "+1 to the defender's highest die",
  ammo_shortage: "−1 to the defender's highest die",
};

interface RollRecord {
  natural: { att: number[]; def: number[] };
  final: { att: number[]; def: number[] };
  modifiers?: CombatModifier[];
  scarModifiers?: { scarId: string; dieIndex: number; delta: number }[];
  powerModifiers?: { powerId: string; playerId: string; side?: "att" | "def"; dieIndex: number; delta: number }[];
  comparisons?: { att: number; def: number; winner: "att" | "def" }[];
  attackerLosses: number;
  defenderLosses: number;
}

type CombatSide = "att" | "def";
type DieView = { natural: number; final: number; mod: boolean; modLabel?: string };

const PIPS: Record<number, number[]> = {
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
};

function PipDie({ natural, final, mod, modLabel, side }: DieView & { side: CombatSide }) {
  const value = clampDie(final);
  const title = mod ? `${side === "att" ? "Attack" : "Defense"} die ${natural} to ${value}: ${modLabel ?? "modified"}`
    : `${side === "att" ? "Attack" : "Defense"} die ${value}`;
  return (
    <span
      data-die-face
      data-side={side}
      data-final={value}
      title={title}
      className={`die-tumble dice-face ${side === "att" ? "dice-attack" : "dice-defense"} ${mod ? "dice-modified" : ""}`}
    >
      <span className="sr-only">{title}</span>
      {Array.from({ length: 9 }, (_, i) => {
        const cell = i + 1;
        return (
          <span key={cell} className="dice-cell">
            {PIPS[value].includes(cell) && <span className="dice-pip" />}
          </span>
        );
      })}
      {mod && <span className="dice-mod-badge">{modLabel ?? "MOD"}</span>}
    </span>
  );
}

function clampDie(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(Math.round(value), 1), 6);
}

function resolvedModLabels(r: RollRecord, side: CombatSide, dieIndex: number) {
  const labels: string[] = [];
  if (r.modifiers?.some((m) => m.side === side && m.dieIndex === dieIndex)) labels.push("MISSILE");
  if (side === "def" && r.scarModifiers?.some((m) => m.dieIndex === dieIndex)) labels.push("SCAR");
  if (r.powerModifiers?.some((m) => (m.side ?? "def") === side && m.dieIndex === dieIndex)) labels.push("POWER");
  return labels;
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

function DiceRow({ label, side, dice, rollKey, large = false }: {
  label: string;
  side: CombatSide;
  dice: DieView[];
  rollKey: number;
  large?: boolean;
}) {
  return (
    <div data-dice-row={side} className={`flex items-center gap-2 ${large ? "flex-wrap" : ""}`}>
      <span className="font-mono text-[10px] text-muted w-8">{label}</span>
      {dice.map((d, i) => <PipDie key={`${rollKey}-${side}-${i}-${d.final}-${d.modLabel ?? ""}`} side={side} {...d} />)}
    </div>
  );
}

function RollOutcome({
  roll,
  attName,
  defName,
  attDice,
  defDice,
  fromTroops,
  toTroops,
  rollKey,
}: {
  roll: RollRecord;
  attName: string;
  defName: string;
  attDice: DieView[];
  defDice: DieView[];
  fromTroops: number;
  toTroops: number;
  rollKey: number;
}) {
  const attackerWins = roll.comparisons?.filter((c) => c.winner === "att").length ?? roll.defenderLosses;
  const defenderWins = roll.comparisons?.filter((c) => c.winner === "def").length ?? roll.attackerLosses;
  const headline = roll.defenderLosses > 0 && roll.attackerLosses > 0
    ? "Both sides take losses"
    : roll.defenderLosses > 0
      ? `${attName} breaks through`
      : `${defName} holds`;

  return (
    <div data-roll-outcome className="rounded-sm border border-signal/45 bg-panel-2/80 p-4 shadow-xl shadow-black/20">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <p className="font-mono text-[10px] text-signal tracking-[0.22em]">ROLL RESULT</p>
          <h4 className="font-display font-bold tracking-widest text-2xl">{headline}</h4>
        </div>
        <p className="font-mono text-[10px] text-muted text-right">
          ATT wins {attackerWins}<br />
          DEF holds {defenderWins}
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <DiceRow label="ATT" side="att" dice={attDice} rollKey={rollKey} large />
        <DiceRow label="DEF" side="def" dice={defDice} rollKey={rollKey} large />
      </div>
      <div className="grid gap-2 md:grid-cols-2 mt-4">
        <CasualtyDelta side="att" label={attName} before={fromTroops + roll.attackerLosses} loss={roll.attackerLosses} />
        <CasualtyDelta side="def" label={defName} before={toTroops + roll.defenderLosses} loss={roll.defenderLosses} />
      </div>
    </div>
  );
}

function CasualtyDelta({ side, label, before, loss }: {
  side: CombatSide;
  label: string;
  before: number;
  loss: number;
}) {
  const after = Math.max(0, before - loss);
  return (
    <div data-casualty-delta={side} className={`rounded-sm border px-3 py-2 ${
      loss > 0 ? "border-danger/70 bg-danger/10" : "border-line bg-panel/70"}`}>
      <p className="font-mono text-[10px] text-muted tracking-widest">{side === "att" ? "ATTACKER" : "DEFENDER"}</p>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm truncate">{label}</span>
        <span className={`font-mono text-sm whitespace-nowrap ${loss > 0 ? "text-danger" : "text-muted"}`}>
          {before} -&gt; {after} ({loss > 0 ? `-${loss}` : "0"})
        </span>
      </div>
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

  // Missile priority includes observers, not only the two combatants.
  const windowActor = c.natural && c.window ? waitingOn(gs) : undefined;

  const stage = c.awaitingMoveIn ? "movein"
    : c.natural ? "window"
    : c.attackerDice === undefined ? (rolls.length > 0 && !rearm ? "aftermath" : "attackers")
    : "defenders";

  const decider = stage === "defenders" ? c.defender : stage === "window" ? windowActor ?? c.attacker : c.attacker;
  const empPlayers = !c.natural && !gs.empTerritories.includes(c.to)
    ? Object.values(gs.players).filter((player) => player.factionId && gs.factionMissilePowers[player.factionId] === "emp"
      && player.missiles > 0 && !gs.missilePowersUsedThisTurn.includes(player.id))
    : [];
  const showResolvedRoll = !!lastRoll && (stage === "aftermath" || stage === "movein");

  // Explanatory badges: scar/power effects that will shape this roll's dice.
  const hasPower = (pid: string, powerId: string) => hasFactionPower(gs, pid, powerId);
  const fortActive = !!toT.fortification && toT.fortification.remaining > 0;
  const badges: { label: string; note: string }[] = [];
  for (const sid of toT.scars) {
    if (sid === "ammo_shortage" && hasPower(c.defender, "well_supplied")) continue;
    if (SCAR_COMBAT_NOTES[sid]) badges.push({ label: scarName(sid), note: SCAR_COMBAT_NOTES[sid] });
  }
  if (fortActive) badges.push({ label: "Fortification", note: `+1 to each defense die · ${toT.fortification!.remaining}/${toT.fortification!.max} durability` });
  if (hasPower(c.defender, "fortified_hq") && toT.hqFaction === def.factionId && !fortActive)
    badges.push({ label: "Fortified HQ", note: "+1 to each defense die (defender power)" });
  if (hasPower(c.attacker, "lower_die_intimidation") && gs.intimidation && !gs.intimidation.broken && gs.intimidation.territory === c.to)
    badges.push({ label: "Intimidation", note: "−1 to the defender's lowest die (attacker power)" });
  if (hasPower(c.attacker, "well_armed") && toT.hqFaction)
    badges.push({ label: "Well-Armed", note: "+1 to every attack die against an HQ" });
  if (hasPower(c.defender, "defensive_stand"))
    badges.push({ label: "Defensive Stand", note: "a natural 6-6 defense locks this territory for the turn" });

  const missileDice = (side: "att" | "def") => {
    const naturals = side === "att" ? c.natural!.att : c.natural!.def;
    return naturals.map((v, i) => {
      const mod = c.modifiers.some((m) => m.side === side && m.dieIndex === i);
      return { natural: v, final: mod ? 6 : v, mod, modLabel: mod ? "MISSILE" : undefined };
    });
  };
  const rollDice = (r: RollRecord, side: "att" | "def") =>
    r.final[side].map((f, i) => {
      const labels = resolvedModLabels(r, side, i);
      const natural = r.natural[side][i];
      return {
        natural,
        final: f,
        mod: labels.length > 0 || f !== natural,
        modLabel: labels.join("+") || (f !== natural ? "MOD" : undefined),
      };
    });

  return (
    <CenterOverlay label="Combat">
      {/* header: attacker vs defender panels in faction colors */}
      <div className="px-5 pt-4 pb-3 border-b border-line">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display font-bold tracking-widest text-sm text-muted">COMBAT</h3>
          {decider && <DecisionChip name={gs.players[decider].name}
            color={factionById(gs.players[decider].factionId)?.color} factionId={gs.players[decider].factionId} />}
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] gap-4 items-center">
          <div className="border-l-4 pl-3 flex items-center gap-2.5" style={{ borderColor: attFaction?.color ?? "var(--color-line)" }}>
            <FactionEmblem
              key={`att-${rolls.length}-${lastRoll?.attackerLosses ?? 0}`}
              factionId={att.factionId}
              size="sm"
            />{/* new (UI-10) */}
            <div>
              <div className="font-display font-bold tracking-widest">{att.name}</div>
              <div className="text-xs text-muted">{attFaction?.name}</div>
              <div className="font-mono text-xs mt-1">{territoryName(c.from)} · {fromT.troops} troops</div>
            </div>
          </div>
          <div className="font-display font-bold text-2xl text-danger">VS</div>
          <div className="border-r-4 pr-3 text-right flex items-center justify-end gap-2.5" style={{ borderColor: defFaction?.color ?? "var(--color-line)" }}>
            <div>
              <div className="font-display font-bold tracking-widest">{def.name}</div>
              <div className="text-xs text-muted">{defFaction?.name}</div>
              <div className="font-mono text-xs mt-1">{territoryName(c.to)} · {toT.troops} troops</div>
            </div>
            <FactionEmblem
              key={`def-${rolls.length}-${lastRoll?.defenderLosses ?? 0}`}
              factionId={def.factionId}
              size="sm"
            />{/* new (UI-10) */}
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
        {empPlayers.length > 0 && (stage === "attackers" || stage === "defenders") && (
          <div className="border border-signal/50 rounded-sm p-3 mb-3">
            <p className="font-mono text-[10px] text-signal tracking-widest mb-2">EMP · BEFORE THE ROLL</p>
            <div className="flex flex-wrap gap-2">
              {empPlayers.map((player) => (
                <Btn key={player.id} disabled={!canActFor(player.id)}
                  onClick={() => dispatch({ type: "missilePower.emp", playerId: player.id })}>
                  {player.name} · SPEND 1 MISSILE
                </Btn>
              ))}
            </div>
          </div>
        )}
        {stage === "attackers" && (
          <div className="space-y-2">
            <p className="text-xs text-muted">{att.name} chooses how many troops to attack with (one die per troop).</p>
            <div className="flex flex-wrap items-end gap-2">
              <AttackerChoice
                max={Math.min(3, fromT.troops - 1)}
                disabled={!canActFor(c.attacker)}
                onCommit={(count) => dispatch({ type: "attack.chooseAttackers", playerId: c.attacker, count })}
              />
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
            <DiceRow label="ATT" side="att" dice={missileDice("att")} rollKey={rolls.length} />
            <DiceRow label="DEF" side="def" dice={missileDice("def")} rollKey={rolls.length} />
            {windowActor && (
              <div className="border border-signal rounded-sm p-3 mt-2">
                <div className="flex items-center justify-between mb-2">
                  <p className="font-mono text-xs text-signal tracking-widest">MISSILE WINDOW</p>
                  <DecisionChip name={gs.players[windowActor].name} color={factionById(gs.players[windowActor].factionId)?.color}
                    factionId={gs.players[windowActor].factionId} />
                </div>
                <p className="text-xs text-muted mb-2">
                  {gs.players[windowActor].name} may spend a missile to set any combat die to an
                  unmodifiable 6 ({gs.players[windowActor].missiles} left) — or pass.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {(["att", "def"] as const).flatMap((side) => missileDice(side).map((d, i) =>
                    d.mod ? null : (
                      <Btn key={`${side}-${i}`} disabled={!canActFor(windowActor)}
                        ariaLabel={`Missile: set ${side === "att" ? "attack" : "defense"} die ${i + 1} to 6`}
                        onClick={() => dispatch({ type: "combat.useMissile", playerId: windowActor, side, dieIndex: i })}>
                        {side === "att" ? "ATT" : "DEF"} ▲ {d.natural} → 6
                      </Btn>
                    )
                  ))}
                  <Btn disabled={!canActFor(windowActor)} onClick={() => dispatch({ type: "combat.pass", playerId: windowActor })}>PASS</Btn>
                </div>
              </div>
            )}
          </div>
        )}

        {stage === "aftermath" && lastRoll && (
          <div className="space-y-3">
            <RollOutcome
              roll={lastRoll}
              attName={att.name}
              defName={def.name}
              attDice={rollDice(lastRoll, "att")}
              defDice={rollDice(lastRoll, "def")}
              fromTroops={fromT.troops}
              toTroops={toT.troops}
              rollKey={rolls.length}
            />
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
          <div className="space-y-3">
            {lastRoll && (
              <RollOutcome
                roll={lastRoll}
                attName={att.name}
                defName={def.name}
                attDice={rollDice(lastRoll, "att")}
                defDice={rollDice(lastRoll, "def")}
                fromTroops={fromT.troops}
                toTroops={toT.troops}
                rollKey={rolls.length}
              />
            )}
            <MoveIn min={c.awaitingMoveIn.min} max={c.awaitingMoveIn.max} disabled={!canActFor(c.attacker)}
              onCommit={(n) => dispatch({ type: "attack.moveIn", playerId: c.attacker, count: n })} />
          </div>
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

function AttackerChoice({ max, disabled, onCommit }: {
  max: number;
  disabled?: boolean;
  onCommit: (count: number) => void;
}) {
  const safeMax = Math.max(1, max);
  const [draft, setDraft] = useState(`${safeMax}`);
  const inputRef = useRef<HTMLInputElement>(null);
  const count = clampAttackers(Number(draft), safeMax);

  useEffect(() => {
    setDraft((current) => `${clampAttackers(Number(current), safeMax)}`);
    if (disabled) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [disabled, safeMax]);

  const commit = () => {
    if (disabled) return;
    onCommit(count);
  };

  return (
    <form
      aria-label="Choose attacking troops"
      onSubmit={(event) => { event.preventDefault(); commit(); }}
      className="flex flex-wrap items-end gap-2"
    >
      <label className="grid gap-1">
        <span className="font-mono text-[10px] text-muted tracking-widest">ATTACKERS · 1–{safeMax}</span>
        <input
          ref={inputRef}
          aria-label="Attacking troops"
          type="number"
          inputMode="numeric"
          min={1}
          max={safeMax}
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => setDraft(`${count}`)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            commit();
          }}
          className="h-9 w-20 rounded-sm border border-signal bg-ink px-2 font-mono text-lg text-signal outline-none focus:ring-2 focus:ring-signal/40 disabled:opacity-40"
        />
      </label>
      <button
        type="button"
        aria-label="Use minimum attackers"
        disabled={disabled}
        onClick={() => { setDraft("1"); inputRef.current?.focus(); inputRef.current?.select(); }}
        className="h-9 rounded-sm border border-line px-3 font-mono text-xs hover:border-signal disabled:opacity-40"
      >
        MIN · 1
      </button>
      <button
        type="button"
        aria-label="Use maximum attackers"
        disabled={disabled}
        onClick={() => { setDraft(`${safeMax}`); inputRef.current?.focus(); inputRef.current?.select(); }}
        className="h-9 rounded-sm border border-line px-3 font-mono text-xs hover:border-signal disabled:opacity-40"
      >
        MAX · {safeMax}
      </button>
      <button
        type="submit"
        aria-label={`Attack with ${count} ${count === 1 ? "die" : "dice"}`}
        disabled={disabled}
        className="h-9 rounded-sm bg-signal px-4 text-sm font-medium text-ink hover:brightness-110 disabled:opacity-40"
      >
        ATTACK
      </button>
      <span className="self-center font-mono text-[10px] text-muted">ENTER TO ATTACK</span>
    </form>
  );
}

function clampAttackers(value: number, max: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(Math.round(value), 1), max);
}

function MoveIn({ min, max, disabled, onCommit }: { min: number; max: number; disabled?: boolean; onCommit: (n: number) => void }) {
  return (
    <div className="space-y-2">
      <p className="font-mono text-xs text-signal">Territory taken — move in {min}–{max} troops.</p>
      <TroopPicker
        label="Move-in troops"
        value={min}
        min={min}
        max={max}
        disabled={disabled}
        confirmLabel="MOVE IN"
        onChange={(n) => onCommit(Math.min(Math.max(Math.round(n), min), max))}
      />
    </div>
  );
}

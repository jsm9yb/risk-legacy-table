// new (UI-12): the end-game legacy ritual — victory beat (winner emblem takeover) →
// signing moment (handwriting onto the signature rail; engine already auto-signed) →
// reward sequence (sticker-sheet modal walking the engine's claim order; board-targeted
// rewards drop to the board via ui.rewardTarget) → envelope tear-open reveal for module
// unlocks → aftermath (per-faction results + world-change recap).
import { useState } from "react";
import { manifest } from "@risk/map";
import { contentPack, ruleValue } from "@risk/content";
import type { Action, GameState } from "@risk/rules";
import type { UiState } from "./GameScreen.tsx";
import { cardResources, continentName, factionById, scarName, territoryName } from "./labels.ts";
import FactionEmblem from "./FactionEmblem.tsx";
import ResourceCard from "./cards/ResourceCard.tsx";
import { Btn, CenterOverlay, DecisionChip, TakeoverOverlay } from "./overlays.tsx";

export default function VictoryFlow({ gs, dispatch, canActFor, ui, setUi }: {
  gs: GameState;
  dispatch: (a: Action) => void;
  canActFor: (pid: string) => boolean;
  ui: UiState;
  setUi: (fn: (u: UiState) => UiState) => void;
}) {
  const [step, setStep] = useState<"victory" | "signing" | "rewards">("victory");
  const [envelopeDone, setEnvelopeDone] = useState(false);
  const [torn, setTorn] = useState(false);
  const [closed, setClosed] = useState(false);

  const winner = gs.winner!;
  const winnerP = gs.players[winner];
  const rewardsOpen = !!gs.rewards && !gs.rewards.committed;

  // Everything after the win is the ritual's material: recap + module reveals.
  const wonSeq = gs.log.find((e) => e.type === "GameWon")?.seq ?? 0;
  const postWin = gs.log.filter((e) => e.seq > wonSeq);
  const revealed = postWin.filter((e) => e.type === "ModuleRevealed");

  if (closed) {
    return (
      <button onClick={() => setClosed(false)}
        className="absolute bottom-4 right-[356px] z-30 bg-panel border border-signal rounded-sm px-3 py-1.5 font-mono text-xs text-signal hover:brightness-110">
        AFTERMATH ▴
      </button>
    );
  }

  // Reward targeting dropped to the board — get out of the way entirely.
  if (ui.rewardTarget) return null;

  if (step === "victory") {
    return (
      <TakeoverOverlay label="Victory">
        <div className="flex flex-col items-center text-center gap-4 pt-8">
          <FactionEmblem factionId={winnerP.factionId} size="lg" />
          <h2 className="font-display font-bold tracking-widest text-4xl text-signal">VICTORY</h2>
          <p className="text-lg">
            <span className="font-semibold" style={{ color: factionById(winnerP.factionId)?.color }}>{winnerP.name}</span>
            {" "}— {factionById(winnerP.factionId)?.name}
          </p>
          <p className="font-mono text-xs text-muted">{gs.winReason}</p>
          <div className="pt-4">
            {gs.rewards ? (
              <Btn tone="primary" onClick={() => setStep("signing")}>SIGN THE BOARD</Btn>
            ) : (
              <Btn tone="primary" onClick={() => setStep("rewards")}>AFTERMATH</Btn>
            )}
          </div>
        </div>
      </TakeoverOverlay>
    );
  }

  if (step === "signing") {
    return (
      <TakeoverOverlay label="Signing">
        <div className="flex flex-col items-center text-center gap-5 pt-10">
          <p className="font-mono text-[10px] text-muted uppercase tracking-widest">The winner signs the board — permanently</p>
          <div className="w-full max-w-md border-b-2 border-line pb-2">
            <span data-testid="signature" className="signature-script text-5xl text-text">{winnerP.name}</span>
          </div>
          <p className="font-mono text-xs text-muted">
            signature #{gs.signatures[winner] ?? 1} · this mark carries into every future game of this world
          </p>
          <div className="pt-4">
            <Btn tone="primary" onClick={() => setStep("rewards")}>
              {rewardsOpen ? "CLAIM THE SPOILS" : "CONTINUE"}
            </Btn>
          </div>
        </div>
      </TakeoverOverlay>
    );
  }

  // step === "rewards": modal sequence while open, then envelope reveal, then aftermath.
  if (rewardsOpen) {
    return <RewardModal gs={gs} dispatch={dispatch} canActFor={canActFor} setUi={setUi} />;
  }

  if (revealed.length > 0 && !envelopeDone) {
    return (
      <TakeoverOverlay label="Sealed pack">
        <div className="flex flex-col items-center text-center gap-4 pt-8">
          <Envelope torn={torn} />
          {!torn ? (
            <>
              <h2 className="font-display font-bold tracking-widest text-2xl text-signal">THE WORLD HAS CHANGED</h2>
              <p className="text-sm text-muted">A sealed pack has been unlocked.</p>
              <Btn tone="primary" onClick={() => setTorn(true)}>TEAR OPEN</Btn>
            </>
          ) : (
            <>
              {revealed.map((e, i) => (
                <p key={i} className="font-display font-bold tracking-widest text-xl text-signal">
                  {(e.data?.name as string) ?? (e.data?.moduleId as string)}
                </p>
              ))}
              <p className="text-sm text-muted max-w-md">
                New rules and materials join the world from the next game on. The host may need to
                supply sealed card text before the next game begins.
              </p>
              <Btn tone="primary" onClick={() => setEnvelopeDone(true)}>CONTINUE</Btn>
            </>
          )}
        </div>
      </TakeoverOverlay>
    );
  }

  return (
    <TakeoverOverlay label="Aftermath">
      <h2 className="font-display font-bold tracking-widest text-2xl mb-6">AFTERMATH</h2>
      <div className="grid gap-2 mb-8">
        {Object.entries(gs.results ?? {}).map(([fid, result]) => {
          const player = Object.values(gs.players).find((p) => p.factionId === fid);
          return (
            <div key={fid} className="flex items-center gap-3 border border-line rounded-sm px-3 py-2">
              <FactionEmblem factionId={fid} size="sm" />
              <span>
                <span className="block text-sm">{factionById(fid)?.name}</span>
                {player && <span className="block font-mono text-[10px] text-muted">{player.name}</span>}
              </span>
              <span className={`ml-auto font-display font-bold tracking-widest text-sm ${
                result === "won" ? "text-signal" : result === "eliminated" ? "text-danger" : "text-muted"}`}>
                {result.replace("_", " ").toUpperCase()}
              </span>
            </div>
          );
        })}
      </div>
      <h3 className="font-display font-bold tracking-widest text-xs text-muted mb-2">HOW THE WORLD CHANGED</h3>
      <div className="font-mono text-xs text-muted space-y-1 mb-8">
        {(() => {
          const recap = postWin.map((e) => recapLine(gs, e.type, e.playerId, e.data)).filter((x): x is string => !!x);
          return recap.length === 0
            ? <p>The board survives unchanged.</p>
            : recap.map((line, i) => <p key={i}>{line}</p>);
        })()}
      </div>
      <Btn onClick={() => setClosed(true)}>VIEW THE BOARD</Btn>
    </TakeoverOverlay>
  );
}

function recapLine(gs: GameState, type: string, playerId?: string, data?: Record<string, unknown>): string | null {
  const who = playerId ? gs.players[playerId]?.name ?? playerId : "";
  switch (type) {
    case "BoardSigned": return `${who} signed the board (signature #${data?.signatures}).`;
    case "ContinentNamed": return `${continentName(data?.continentId as string)} is now named “${data?.name}” by ${who}.`;
    case "MajorCityFounded": return `${who} founded the Major City “${data?.name}” in ${territoryName(data?.territory as string)}.`;
    case "MinorCityFounded": return `${who} founded the Minor City “${data?.name}” in ${territoryName(data?.territory as string)}.`;
    case "ScarCancelled": return `${who} cancelled the ${scarName(data?.scarId as string)} scar on ${territoryName(data?.territory as string)}.`;
    case "ContinentBonusChanged": return `${continentName(data?.continentId as string)} bonus permanently ${(data?.delta as number) > 0 ? "+1" : "−1"} (${who}).`;
    case "CityFortified": return `${who} fortified the city in ${territoryName(data?.territory as string)}.`;
    case "TerritoryCardUpgraded": return `${who} upgraded a Resource card to ${data?.resources} resources.`;
    case "ModuleRevealed": return `SEALED PACK OPENED — ${data?.name ?? data?.moduleId}.`;
    case "EndGameRewardsSkipped": return `Starter rewards have ended (game ${data?.gameNumber}).`;
    default: return null;
  }
}

function Envelope({ torn }: { torn: boolean }) {
  return (
    <svg viewBox="0 0 120 80" className="w-52" aria-hidden="true">
      <rect x="8" y="16" width="104" height="56" rx="3" fill="#1a2132" stroke="#7d8aa3" strokeWidth="1.5" />
      {torn ? (
        <>
          <path d="M 8 16 L 24 4 L 40 14 L 58 2 L 76 13 L 94 5 L 112 16" fill="none" stroke="#c9504a" strokeWidth="2" strokeLinejoin="round" />
          <text x="60" y="50" textAnchor="middle" style={{ font: "800 11px var(--font-display)", fill: "#e0a93c", letterSpacing: 2 }}>OPENED</text>
        </>
      ) : (
        <>
          <path d="M 8 16 L 60 48 L 112 16" fill="none" stroke="#7d8aa3" strokeWidth="1.5" />
          <text x="60" y="66" textAnchor="middle" style={{ font: "800 8px var(--font-mono)", fill: "#c9504a", letterSpacing: 1 }}>DO NOT OPEN…YET</text>
        </>
      )}
    </svg>
  );
}

// ---------- Reward modal (sticker sheet) ----------

interface RewardDef {
  kind: NonNullable<UiState["rewardTarget"]>["kind"] | "upgrade_territory_card" | "pass";
  title: string;
  desc: string;
  left?: number;
  reason?: string; // why it's unavailable (dimmed)
}

function RewardModal({ gs, dispatch, canActFor, setUi }: {
  gs: GameState;
  dispatch: (a: Action) => void;
  canActFor: (pid: string) => boolean;
  setUi: (fn: (u: UiState) => UiState) => void;
}) {
  const [pickingUpgrade, setPickingUpgrade] = useState(false);
  const r = gs.rewards!;
  const claimant = r.order[r.nextIdx];
  const p = gs.players[claimant];
  const isWinner = r.nextIdx === 0;
  const live = canActFor(claimant);
  const terrs = Object.values(gs.territories);

  const unnamed = manifest.continents.filter((c) => !gs.continents[c.id]?.name).length;
  const marks = Object.values(gs.continents).map((c) => c.bonusMark);
  const bonusLeft = Number(!marks.includes(1)) + Number(!marks.includes(-1));
  const unmarkedContinents = manifest.continents.filter((c) => gs.continents[c.id]?.bonusMark === undefined).length;
  const scarred = terrs.some((t) => t.scars.length > 0);
  const anyCity = terrs.some((t) => !!t.city);
  const cityless = terrs.some((t) => !t.city);
  const maxRes = ruleValue<number>("cardUpgradeMaxResources");
  const upgradable = contentPack.cards.territoryCards.filter((c) =>
    gs.territories[c.territoryId].controller === claimant &&
    !gs.sideboard.destroyed.includes(c.id) &&
    cardResources(gs, c.id) < maxRes);
  const ownCityless = terrs.some((t) => t.controller === claimant && !t.city);

  const winnerRewards: RewardDef[] = [
    { kind: "name_continent", title: "Name a Continent", desc: "Permanently name an unnamed continent. +1 recruit there whenever you control it.", left: unnamed, reason: unnamed === 0 ? "all continents are named" : undefined },
    { kind: "found_major_city", title: "Found a Major City", desc: "Place a Major City in any territory without a city — even enemy-held.", left: gs.inventories.majorCities, reason: gs.inventories.majorCities === 0 ? "no Major Cities left" : !cityless ? "every territory has a city" : undefined },
    { kind: "cancel_scar", title: "Cancel a Scar", desc: "Destroy a scar on the board, permanently.", left: gs.inventories.cancelStickers, reason: gs.inventories.cancelStickers === 0 ? "no cancel stickers left" : !scarred ? "no scars on the board" : undefined },
    { kind: "change_continent_bonus", title: "Change a Continent Bonus", desc: "Mark a continent +1 or −1, permanently. Each mark exists once; each continent changes once.", left: bonusLeft, reason: bonusLeft === 0 ? "both bonus marks are used" : unmarkedContinents === 0 ? "every continent already changed" : undefined },
    { kind: "fortify_city", title: "Fortify a City", desc: "Set (or reset) a city's Fortification at full durability: +1 to each defense die.", left: gs.inventories.fortifyMarks, reason: gs.inventories.fortifyMarks === 0 ? "no Fortification marks left" : !anyCity ? "no cities on the board" : undefined },
  ];
  const heldOnRewards: RewardDef[] = [
    { kind: "found_minor_city", title: "Found a Minor City", desc: "Place a Minor City in a territory you control at game end.", left: gs.inventories.minorCities, reason: gs.inventories.minorCities === 0 ? "no Minor Cities left" : !ownCityless ? "no eligible territory under your control" : undefined },
    { kind: "upgrade_territory_card", title: "Upgrade a Territory Card", desc: "Add one coin to a territory card you control (never coins, max 6).", left: upgradable.length, reason: upgradable.length === 0 ? "no eligible card under your control" : undefined },
  ];
  const winnerRewardAvailable = winnerRewards.some((d) => !d.reason);
  const sheet = isWinner ? winnerRewards : heldOnRewards;

  const choose = (def: RewardDef) => {
    if (def.kind === "pass") return dispatch({ type: "reward.choose", playerId: claimant, reward: { kind: "pass" } });
    if (def.kind === "upgrade_territory_card") return setPickingUpgrade(true);
    setUi((u) => ({ ...u, rewardTarget: { kind: def.kind as NonNullable<UiState["rewardTarget"]>["kind"], playerId: claimant, delta: 1 } }));
  };

  return (
    <CenterOverlay label="Rewards">
      <div className="px-5 pt-4 pb-3 border-b border-line flex items-center justify-between">
        <h3 className="font-display font-bold tracking-widest text-sm">
          SPOILS OF WAR — {isWinner ? "WINNER" : "HELD ON"} ({r.nextIdx + 1}/{r.order.length})
        </h3>
        <DecisionChip name={p.name} color={factionById(p.factionId)?.color} />
      </div>
      <div className="px-5 py-4">
        {!pickingUpgrade ? (
          <div className="grid grid-cols-1 gap-2">
            {sheet.map((def) => (
              <button key={def.kind} disabled={!live || !!def.reason} onClick={() => choose(def)}
                className={`text-left border rounded-sm p-3 ${!live || def.reason ? "opacity-40 border-line" : "border-line hover:border-signal"}`}>
                <span className="flex items-center gap-2">
                  <span className="font-display font-bold tracking-widest text-sm">{def.title}</span>
                  {def.left !== undefined && <span className="font-mono text-[10px] text-muted ml-auto">×{def.left} left</span>}
                </span>
                <span className="block text-xs text-muted mt-0.5">{def.desc}</span>
                {def.reason && <span className="block font-mono text-[10px] text-danger mt-0.5">unavailable — {def.reason}</span>}
              </button>
            ))}
            <div className="flex justify-end pt-1">
              <Btn disabled={!live || (isWinner && winnerRewardAvailable)}
                onClick={() => dispatch({ type: "reward.choose", playerId: claimant, reward: { kind: "pass" } })}>PASS</Btn>
            </div>
            {isWinner && winnerRewardAvailable && (
              <p className="font-mono text-[10px] text-muted text-right">the winner must resolve one reward</p>
            )}
          </div>
        ) : (
          <div>
            <p className="text-xs text-muted mb-2">Pick a territory card you control — the new coin is added permanently.</p>
            <div className="flex flex-wrap gap-2 max-h-72 overflow-y-auto">
              {upgradable.map((c) => (
                <ResourceCard key={c.id} size="md" cardId={c.id} resources={cardResources(gs, c.id)}
                  onClick={live ? () => {
                    dispatch({ type: "reward.choose", playerId: claimant, reward: { kind: "upgrade_territory_card", cardId: c.id } });
                    setPickingUpgrade(false);
                  } : undefined} />
              ))}
            </div>
            <div className="pt-3">
              <Btn onClick={() => setPickingUpgrade(false)}>BACK</Btn>
            </div>
          </div>
        )}
      </div>
    </CenterOverlay>
  );
}

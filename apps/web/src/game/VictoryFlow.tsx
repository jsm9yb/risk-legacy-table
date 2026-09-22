// the end-game legacy ritual — victory beat (winner emblem takeover) →
// signing moment (handwriting onto the signature rail; engine already auto-signed) →
// reward sequence (sticker-sheet modal walking the engine's claim order; board-targeted
// rewards drop to the board via ui.rewardTarget) → envelope tear-open reveal for module
// unlocks → aftermath (per-faction results + world-change recap).
import { useState } from "react";
import { manifest } from "@risk/map";
import { ruleValue } from "@risk/content";
import { territoryCardDefinitions, type Action, type GameState } from "@risk/rules";
import type { UiState } from "./GameScreen.tsx";
import { cardResources, continentName, factionById, powerName, scarName, territoryName } from "./labels.ts";
import FactionEmblem from "./FactionEmblem.tsx";
import ResourceCard from "./cards/ResourceCard.tsx";
import { Btn, CenterOverlay, DecisionChip, TakeoverOverlay } from "./overlays.tsx";
import { modulePacketDetail } from "./LegacyVault.tsx";
import type { HistoryFrame, HistoryPlaybackOptions } from "./history/PublicBoardHistory.ts";
import WarChronicle, { decisivePublicMoment, permanentDeltas } from "./WarChronicle.tsx";

export default function VictoryFlow({ gs, dispatch, canActFor, ui, setUi, historyFrames, onPlayHistory }: {
  gs: GameState;
  historyFrames?: HistoryFrame[];
  onPlayHistory?: (frames: readonly HistoryFrame[], options?: HistoryPlaybackOptions) => void;
  dispatch: (a: Action) => void;
  canActFor: (pid: string) => boolean;
  ui: UiState;
  setUi: (fn: (u: UiState) => UiState) => void;
}) {
  // A sealed-content pause temporarily unmounts this flow. Rewards are already
  // committed at that point, so resume after the ritual instead of replaying it.
  const [step, setStep] = useState<"victory" | "signing" | "rewards">(
    () => gs.rewards?.committed ? "rewards" : "victory",
  );
  const [envelopeDone, setEnvelopeDone] = useState(false);
  const [torn, setTorn] = useState(false);
  const [closed, setClosed] = useState(false);
  const [completedWorldName, setCompletedWorldName] = useState("");

  const winner = gs.winner!;
  const winnerP = gs.players[winner];
  const rewardsOpen = !!gs.rewards && !gs.rewards.committed;

  // Permanent changes can happen at any point in the game. The aftermath must
  // recover them all, including mid-game Scars, packets, powers, and topology.
  const revealed = gs.log.filter((e) => e.type === "ModuleRevealed");
  const decisive = decisivePublicMoment(gs);
  const deltas = permanentDeltas(gs.log);

  if (closed) {
    return (
      <button onClick={() => setClosed(false)}
        className="fixed left-3 top-24 z-30 w-44 bg-panel border border-signal rounded-sm px-4 py-3 text-left shadow-xl hover:brightness-110">
        <span className="block font-mono text-[9px] uppercase tracking-widest text-muted">Game complete</span>
        <span className="block font-display font-bold tracking-widest text-sm text-signal">VIEW AFTERMATH</span>
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
          {decisive && <p data-victory-cause className="max-w-md border-l-2 border-signal bg-panel-2/60 px-4 py-3 text-sm text-left">{decisive.detail}</p>}
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

  if (gs.worldCompletion && !gs.worldCompletion.name) {
    const namingPlayer = gs.players[gs.worldCompletion.namingPlayerId];
    const canName = canActFor(gs.worldCompletion.namingPlayerId) && completedWorldName.trim().length > 0;
    return (
      <TakeoverOverlay label="Name the completed world">
        <div className="flex flex-col items-center text-center gap-4 pt-8 max-w-lg mx-auto">
          <p className="font-mono text-[10px] text-muted uppercase tracking-widest">The fifteenth war is complete</p>
          <h2 className="font-display font-bold tracking-widest text-3xl text-signal">NAME THE WORLD</h2>
          <DecisionChip name={namingPlayer.name} color={factionById(namingPlayer.factionId)?.color}
            factionId={namingPlayer.factionId} />
          <p className="text-sm text-muted">
            The player with the most victories names the completed world. This replaces its campaign name permanently.
          </p>
          <input aria-label="Completed world name" placeholder="enter the world's final name"
            value={completedWorldName} onChange={(event) => setCompletedWorldName(event.target.value)}
            disabled={!canActFor(gs.worldCompletion.namingPlayerId)}
            className="w-full max-w-sm bg-ink border border-line rounded-sm px-3 py-2 text-center" />
          <Btn tone="primary" disabled={!canName} onClick={() => dispatch({
            type: "world.name",
            playerId: gs.worldCompletion!.namingPlayerId,
            name: completedWorldName,
          })}>SEAL THE NAME</Btn>
        </div>
      </TakeoverOverlay>
    );
  }

  if (revealed.length > 0 && !envelopeDone) {
    const firstModuleId = typeof revealed[0]?.data?.moduleId === "string" ? revealed[0].data.moduleId : "";
    const firstPacket = modulePacketDetail(firstModuleId);
    return (
      <TakeoverOverlay label="Sealed pack">
        <div className="flex flex-col items-center text-center gap-4 pt-8">
          <Envelope torn={torn} label={firstPacket?.label} />
          {!torn ? (
            <>
              <p className="font-mono text-[10px] uppercase tracking-widest text-danger">Instruction fulfilled</p>
              <h2 className="font-display font-bold tracking-widest text-2xl text-signal">
                {firstPacket ? `${firstPacket.label} IS READY` : "THE WORLD HAS CHANGED"}
              </h2>
              <p className="text-sm text-muted max-w-md">{firstPacket?.condition ?? "A sealed packet has been unlocked."}</p>
              <Btn tone="primary" onClick={() => setTorn(true)}>TEAR OPEN</Btn>
            </>
          ) : (
            <>
              {revealed.map((e, i) => {
                const moduleId = typeof e.data?.moduleId === "string" ? e.data.moduleId : "";
                const packet = modulePacketDetail(moduleId);
                return (
                  <div key={i}>
                    <p className="font-display font-bold tracking-widest text-xl text-signal">
                      {(e.data?.name as string) ?? packet?.label ?? moduleId}
                    </p>
                    {packet && <p className="text-sm text-text mt-1">Now active: {packet.contents}.</p>}
                  </div>
                );
              })}
              <p className="text-sm text-muted max-w-md">
                This is a permanent campaign change. Every future game on this world will use the opened packet's rules and materials.
              </p>
              <Btn tone="primary" onClick={() => setEnvelopeDone(true)}>ACKNOWLEDGE NEW RULES</Btn>
            </>
          )}
        </div>
      </TakeoverOverlay>
    );
  }

  return (
    <TakeoverOverlay label="Aftermath">
      <h2 className="font-display font-bold tracking-widest text-2xl mb-6">AFTERMATH</h2>
      <WarChronicle gs={gs} frames={historyFrames} onPlay={onPlayHistory} />
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
      {deltas.length > 0 && <div className="overflow-x-auto mb-4">
        <table aria-label="Permanent changes before and after" className="w-full text-xs border-collapse">
          <thead><tr className="text-left font-mono text-[10px] text-muted"><th className="p-2">WORLD RECORD</th><th className="p-2">BEFORE</th><th className="p-2">AFTER</th></tr></thead>
          <tbody>{deltas.map((delta) => <tr key={delta.seq} className="border-t border-line"><th className="p-2 text-left font-normal">{delta.label}</th><td className="p-2 text-muted">{delta.before}</td><td className="p-2 text-signal">{delta.after}</td></tr>)}</tbody>
        </table>
      </div>}
      <div className="font-mono text-xs text-muted space-y-1 mb-8">
        {(() => {
          const recap = gs.log.filter((event) => event.type === "ModuleRevealed" || !deltas.some((delta) => delta.seq === event.seq))
            .map((e) => recapLine(gs, e.type, e.playerId, e.data)).filter((x): x is string => !!x);
          return recap.length === 0
            ? deltas.length === 0 ? <p>The board survives unchanged.</p> : null
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
    case "TerritoryCardDestroyed": return `${who} permanently destroyed the ${territoryName(data?.territory as string)} Territory card.`;
    case "ModuleRevealed": return `SEALED PACK OPENED — ${data?.name ?? data?.moduleId}.`;
    case "ScarPlayed": return data?.territory
      ? `${who} permanently placed ${scarName(data?.scarId as string)} on ${territoryName(data.territory as string)}.`
      : `${who} permanently attached ${scarName(data?.scarId as string)} to ${factionById(data?.factionId as string)?.name ?? data?.factionId}.`;
    case "ComebackPowerChosen": return `${factionById(data?.factionId as string)?.name ?? data?.factionId} gained the permanent Comeback Power “${data?.title ?? "new power"}”.`;
    case "MissilePowerChosen": return `${factionById(data?.factionId as string)?.name ?? data?.factionId} gained the permanent Missile Power ${powerName(data?.powerId as string)}.`;
    case "PrivateMissionCaptured": return `${factionById(data?.factionId as string)?.name ?? data?.factionId} permanently captured a Private Mission.`;
    case "AlienCollaboratorNamed": return `${factionById(data?.factionId as string)?.name ?? data?.factionId} became the Alien Collaborator.`;
    case "AlienIslandPlaced": return `Alien Island “${data?.name}” permanently joined the board.`;
    case "BringerOfNuclearFireNamed": return `${factionById(data?.factionId as string)?.name ?? data?.factionId} became the Bringer of Nuclear Fire.`;
    case "MutantEvolutionApplied": return `The Mutants permanently advanced ${String(data?.evolution ?? "their evolution").replaceAll("_", " ")}.`;
    case "WorldCapitalFounded": return `${who} permanently founded the World Capital “${data?.name}” in ${territoryName(data?.territory as string)}.`;
    case "WorldNamed": return `${who} completed and named the world “${data?.name}”.`;
    case "EndGameRewardsSkipped": return `Starter rewards have ended (game ${data?.gameNumber}).`;
    default: return null;
  }
}

function Envelope({ torn, label }: { torn: boolean; label?: string }) {
  return (
    <svg viewBox="0 0 120 80" className="w-52" aria-hidden="true">
      <rect x="8" y="16" width="104" height="56" rx="3" fill="#1a2132" stroke="#7d8aa3" strokeWidth="1.5" />
      {torn ? (
        <>
          <path d="M 8 16 L 24 4 L 40 14 L 58 2 L 76 13 L 94 5 L 112 16" fill="none" stroke="#c9504a" strokeWidth="2" strokeLinejoin="round" />
          <text x="60" y="46" textAnchor="middle" style={{ font: "800 11px var(--font-display)", fill: "#e0a93c", letterSpacing: 2 }}>OPENED</text>
          {label && <text x="60" y="60" textAnchor="middle" style={{ font: "800 7px var(--font-mono)", fill: "#e0a93c", letterSpacing: 1 }}>{label}</text>}
        </>
      ) : (
        <>
          <path d="M 8 16 L 60 48 L 112 16" fill="none" stroke="#7d8aa3" strokeWidth="1.5" />
          <text x="60" y="58" textAnchor="middle" style={{ font: "800 8px var(--font-mono)", fill: "#c9504a", letterSpacing: 1 }}>{label ?? "SEALED"}</text>
          <text x="60" y="68" textAnchor="middle" style={{ font: "800 6px var(--font-mono)", fill: "#7d8aa3", letterSpacing: 0.8 }}>DO NOT OPEN…YET</text>
        </>
      )}
    </svg>
  );
}

// ---------- Reward modal (sticker sheet) ----------

interface RewardDef {
  kind: NonNullable<UiState["rewardTarget"]>["kind"] | "upgrade_territory_card" | "destroy_territory_card" | "pass";
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
  const [pickingCards, setPickingCards] = useState<"upgrade" | "destroy" | null>(null);
  const r = gs.rewards!;
  const claimant = r.order[r.nextIdx];
  const p = gs.players[claimant];
  const isWinner = r.nextIdx === 0;
  const live = canActFor(claimant);
  const terrs = manifest.territories.map((territory) => gs.territories[territory.id]);

  const unnamed = manifest.continents.filter((c) => !gs.continents[c.id]?.name).length;
  const marks = Object.values(gs.continents).map((c) => c.bonusMark);
  const bonusLeft = Number(!marks.includes(1)) + Number(!marks.includes(-1));
  const unmarkedContinents = manifest.continents.filter((c) => gs.continents[c.id]?.bonusMark === undefined).length;
  const scarred = terrs.some((t) => t.scars.length > 0);
  const anyCity = terrs.some((t) => !!t.city);
  const cityless = terrs.some((t) => !t.city);
  const maxRes = ruleValue<number>("cardUpgradeMaxResources");
  const territoryCards = territoryCardDefinitions(!!gs.alienIsland);
  const upgradable = territoryCards.filter((c) =>
    gs.territories[c.territoryId].controller === claimant &&
    !gs.sideboard.destroyed.includes(c.id) &&
    cardResources(gs, c.id) < maxRes);
  const ownCityless = terrs.some((t) => t.controller === claimant && !t.city);
  const destroyable = territoryCards.filter((card) => !gs.sideboard.destroyed.includes(card.id));

  const winnerRewards: RewardDef[] = [
    { kind: "name_continent", title: "Name a Continent", desc: "Permanently name an unnamed continent. +1 recruit there whenever you control it.", left: unnamed, reason: unnamed === 0 ? "all continents are named" : undefined },
    { kind: "found_major_city", title: "Found a Major City", desc: "Place a Major City in any territory without a city — even enemy-held.", left: gs.inventories.majorCities, reason: gs.inventories.majorCities === 0 ? "no Major Cities left" : !cityless ? "every territory has a city" : undefined },
    { kind: "cancel_scar", title: "Cancel a Scar", desc: "Destroy a scar on the board, permanently.", left: gs.inventories.cancelStickers, reason: gs.inventories.cancelStickers === 0 ? "no cancel stickers left" : !scarred ? "no scars on the board" : undefined },
    { kind: "change_continent_bonus", title: "Change a Continent Bonus", desc: "Mark a continent +1 or −1, permanently. Each mark exists once; each continent changes once.", left: bonusLeft, reason: bonusLeft === 0 ? "both bonus marks are used" : unmarkedContinents === 0 ? "every continent already changed" : undefined },
    { kind: "fortify_city", title: "Fortify a City", desc: "Set (or reset) a city's Fortification at full durability: +1 to each defense die.", left: gs.inventories.fortifyMarks, reason: gs.inventories.fortifyMarks === 0 ? "no Fortification marks left" : !anyCity ? "no cities on the board" : undefined },
    { kind: "destroy_territory_card", title: "Destroy a Territory Card", desc: "Permanently remove one Territory card from this campaign. That territory can never provide a matching face-up card again.", left: destroyable.length, reason: destroyable.length === 0 ? "all Territory cards are already destroyed" : undefined },
  ];
  const heldOnRewards: RewardDef[] = [
    { kind: "found_minor_city", title: "Found a Minor City", desc: "Place a Minor City in a territory you control at game end.", left: gs.inventories.minorCities, reason: gs.inventories.minorCities === 0 ? "no Minor Cities left" : !ownCityless ? "no eligible territory under your control" : undefined },
    { kind: "upgrade_territory_card", title: "Upgrade a Territory Card", desc: "Add one coin to a territory card you control (never coins, max 6).", left: upgradable.length, reason: upgradable.length === 0 ? "no eligible card under your control" : undefined },
  ];
  const winnerRewardAvailable = winnerRewards.some((d) => !d.reason);
  const sheet = isWinner ? winnerRewards : heldOnRewards;

  const choose = (def: RewardDef) => {
    if (def.kind === "pass") return dispatch({ type: "reward.choose", playerId: claimant, reward: { kind: "pass" } });
    if (def.kind === "upgrade_territory_card") return setPickingCards("upgrade");
    if (def.kind === "destroy_territory_card") return setPickingCards("destroy");
    setUi((u) => ({ ...u, rewardTarget: { kind: def.kind as NonNullable<UiState["rewardTarget"]>["kind"], playerId: claimant, delta: 1 } }));
  };

  return (
    <CenterOverlay label="Rewards">
      <div className="px-5 pt-4 pb-3 border-b border-line flex items-center justify-between">
        <h3 className="font-display font-bold tracking-widest text-sm">
          SPOILS OF WAR — {isWinner ? "WINNER" : "HELD ON"} ({r.nextIdx + 1}/{r.order.length})
        </h3>
        <DecisionChip name={p.name} color={factionById(p.factionId)?.color} factionId={p.factionId} />
      </div>
      <div className="px-5 py-4">
        {!pickingCards ? (
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
            <p className="text-xs text-muted mb-2">
              {pickingCards === "upgrade"
                ? "Pick a Territory card you control. One coin is added permanently."
                : "Pick any Territory card. It is permanently removed from this campaign and cannot return."}
            </p>
            <div className="flex flex-wrap gap-2 max-h-72 overflow-y-auto">
              {(pickingCards === "upgrade" ? upgradable : destroyable).map((c) => (
                <span key={c.id} data-table-anchor="card" data-player-id={claimant} data-anchor-id={c.id} data-anchor-priority="3" className="inline-flex shrink-0">
                <ResourceCard size="md" cardId={c.id} resources={cardResources(gs, c.id)}
                  onClick={live ? () => {
                    dispatch({ type: "reward.choose", playerId: claimant, reward: {
                      kind: pickingCards === "upgrade" ? "upgrade_territory_card" : "destroy_territory_card",
                      cardId: c.id,
                    } });
                    setPickingCards(null);
                  } : undefined} />
                </span>
              ))}
            </div>
            <div className="pt-3">
              <Btn onClick={() => setPickingCards(null)}>BACK</Btn>
            </div>
          </div>
        )}
      </div>
    </CenterOverlay>
  );
}

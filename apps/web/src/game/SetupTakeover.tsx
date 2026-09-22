import { useEffect } from "react";
import { factionDefinitions } from "@risk/content";
import type { GameState } from "@risk/rules";
import type { UiState } from "./GameScreen.tsx";
import { powerById, powerName } from "./labels.ts";
import FactionCard from "./FactionCard.tsx";
import SetupDecisionBanner from "./SetupDecisionBanner.tsx";
import { TakeoverOverlay } from "./overlays.tsx";

export default function SetupTakeover({ gs, ui, setUi, actor, you, readOnly = false }: {
  gs: GameState;
  ui: UiState;
  setUi: (fn: (u: UiState) => UiState) => void;
  actor: string;
  you?: boolean;
  readOnly?: boolean;
}) {
  const player = gs.players[actor];
  const factions = factionDefinitions(gs.unlockedModules);
  const draftedFactionId = gs.advancedDraft?.completed ? gs.advancedDraft.picks[actor]?.factionId : undefined;
  const pickedId = readOnly ? undefined : draftedFactionId ?? ui.pickedFaction;
  const picked = pickedId ? factions.find((f) => f.id === pickedId) : undefined;
  const storedPower = picked ? gs.factionPowers[picked.id] : undefined;
  const bannerAction = !picked
    ? "Choose a faction"
    : ui.powerTear
      ? "Review permanent power"
    : picked?.startingPowers.length === 0
      ? "Choose a starting territory"
    : storedPower
        ? "Review permanent power"
        : "Choose a starting power";
  const shownPower = ui.powerTear?.chosenPowerId ?? storedPower ?? ui.pickedPower;

  useEffect(() => {
    if (!ui.powerTear) return;
    const id = window.setTimeout(() => {
      setUi((u) => ({ ...u, powerTear: undefined }));
    }, 1150);
    return () => window.clearTimeout(id);
  }, [setUi, ui.powerTear]);

  return (
    <TakeoverOverlay label="Faction setup" wide>
      <div className="mb-7 max-w-3xl mx-auto">
        <SetupDecisionBanner
          actorName={player.name}
          actorColor={picked?.color}
          you={you}
          action={readOnly ? `${player.name} is choosing. Explore the factions while you wait.` : bannerAction}
          factionId={picked?.id}
          factionName={picked?.name}
          powerName={shownPower ? powerName(shownPower) : undefined}
          onChange={picked && !draftedFactionId ? () => clearPick(setUi) : undefined}
        />
      </div>

      {!picked ? (
        <>
          <div className="faction-card-grid" aria-label="Available factions">
            {factions.map((f) => {
              const takenBy = Object.values(gs.players).find((candidate) => candidate.factionId === f.id)?.name;
              return (
                <FactionCard
                  key={f.id}
                  faction={f}
                  powerId={gs.factionPowers[f.id]}
                  history={gs.factionHistory?.[f.id] ?? []}
                  currentGame={gs.gameNumber}
                  takenBy={takenBy}
                  onSelect={takenBy || readOnly ? undefined : () => setUi((u) => ({
                    ...u,
                    pickedFaction: f.id,
                    pickedPower: undefined,
                    powerTear: undefined,
                  }))}
                />
              );
            })}
          </div>
          <p className="mt-5 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
            Inherit a faction shaped by earlier wars. Your power choice and campaign victories become its lasting story. Flip any card to inspect its record.
          </p>
        </>
      ) : ui.powerTear ? (
        <div className="min-h-[360px] flex flex-col items-center justify-center text-center">
          <p className="font-mono text-[10px] text-muted uppercase tracking-widest mb-4">Permanent faction power chosen</p>
          <div className="grid sm:grid-cols-2 gap-4 w-full max-w-2xl">
            <PowerCeremonyCard title="Chosen" powerId={ui.powerTear.chosenPowerId} tone="kept" />
            <PowerCeremonyCard title="Destroyed" powerId={ui.powerTear.destroyedPowerId} tone="torn" />
          </div>
        </div>
      ) : (
        <div className="grid lg:grid-cols-[minmax(360px,1fr)_minmax(340px,0.82fr)] gap-8 max-w-6xl mx-auto items-start">
          <FactionCard
            faction={picked}
            powerId={storedPower ?? ui.pickedPower}
            history={gs.factionHistory?.[picked.id] ?? []}
            currentGame={gs.gameNumber}
            selected
            detail
          />

          <div className="bg-panel/80 border border-line rounded-sm p-5 shadow-2xl">
            <div className="flex items-start gap-4 mb-5">
              <span>
                <span className="font-display font-black tracking-widest text-2xl block">{picked.name}</span>
                <span className="font-mono text-[10px] text-muted uppercase tracking-widest">
                  Permanent for this faction in every future game
                </span>
              </span>
              {!draftedFactionId && <button onClick={() => clearPick(setUi)}
                className="ml-auto font-mono text-xs text-muted hover:text-text whitespace-nowrap">← ALL FACTIONS</button>}
            </div>

            <div className="grid gap-3">
              {picked.startingPowers.map((pwId) => {
                const pw = powerById(pwId)!;
                return (
                  <button key={pwId} onClick={() => {
                    const destroyedPowerId = picked.startingPowers.find((id) => id !== pwId) ?? pwId;
                    setUi((u) => ({ ...u, pickedPower: pwId, powerTear: { chosenPowerId: pwId, destroyedPowerId } }));
                  }}
                    className="text-left border border-line hover:border-signal rounded-sm p-4 bg-panel-2/70 group">
                    <span className="font-display font-bold tracking-widest block mb-2 text-xl text-signal group-hover:text-white">{pw.name}</span>
                    <span className="text-sm text-text leading-relaxed">{pw.text}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </TakeoverOverlay>
  );
}

function clearPick(setUi: (fn: (u: UiState) => UiState) => void) {
  setUi((u) => ({
    ...u,
    pickedFaction: undefined,
    pickedPower: undefined,
    powerTear: undefined,
  }));
}

function PowerCeremonyCard({ title, powerId, tone }: { title: string; powerId: string; tone: "kept" | "torn" }) {
  const power = powerById(powerId)!;
  return (
    <div className={`power-ceremony-card ${tone === "torn" ? "power-card-tear" : "power-card-keep"} border rounded-sm p-5 text-left bg-panel-2`}>
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted mb-2">{title}</div>
      <div className="font-display font-bold tracking-widest text-2xl text-signal mb-2">{power.name}</div>
      <p className="text-sm text-text leading-relaxed">{power.text}</p>
      {tone === "torn" && <div className="tear-slash" aria-hidden="true" />}
    </div>
  );
}

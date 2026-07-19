import { useState } from "react";
import { contentPack } from "@risk/content";
import type { LocalConfig } from "../App.tsx";
import boardSvg from "../../../../packages/map/assets/board.svg?raw";
import FactionEmblem from "../game/FactionEmblem.tsx";
import LegacyVault from "../game/LegacyVault.tsx";
import { clearLocalCampaign, loadLocalCampaign } from "../local/campaignStore.ts";

export default function Hub({ onStart, onResume, onLan }: {
  onStart: (cfg: LocalConfig) => void;
  onResume: () => void;
  onLan: () => void;
}) {
  const [stage, setStage] = useState<"select" | "configure">("select");
  const [worldName, setWorldName] = useState("An Unnamed World");
  const [names, setNames] = useState(["Player 1", "Player 2", "Player 3"]);
  const [seed, setSeed] = useState(() => String(Math.floor(Math.random() * 1e9)));
  const [localSave, setLocalSave] = useState(() => loadLocalCampaign());
  const [pending, setPending] = useState<"replace" | "delete" | null>(null);
  const normalizedNames = names.map((name) => name.trim());
  const configIssue = normalizedNames.some((name) => !name)
    ? "Every seat needs a player name."
    : new Set(normalizedNames.map((name) => name.toLocaleLowerCase())).size !== normalizedNames.length
      ? "Player names must be unique so decisions are never ambiguous."
      : null;
  const unlockedModules = [...new Set([
    ...(localSave?.campaignState.unlockedModules ?? []),
    ...(localSave?.activeGame?.unlockedModules ?? []),
  ])];

  const config = (): LocalConfig => ({
    seed: Number(seed) || 1,
    worldName: worldName.trim() || "An Unnamed World",
    players: names.map((name, index) => ({ id: `seat${index + 1}`, name: name.trim() || `Player ${index + 1}` })),
  });
  const start = () => {
    if (configIssue) return;
    localSave ? setPending("replace") : onStart(config());
  };

  return (
    <div className="relative min-h-full flex flex-col overflow-hidden">
      <div aria-hidden className="board-backdrop absolute inset-0 opacity-[0.13] pointer-events-none select-none"
        dangerouslySetInnerHTML={{ __html: boardSvg }} />
      <header className="relative border-b border-line px-8 py-5 flex items-baseline gap-4">
        <h1 className="font-display font-extrabold tracking-wide text-3xl text-signal">WAR ROOM</h1>
        <span className="font-mono text-xs text-muted uppercase tracking-widest">Risk Legacy · private campaign table</span>
      </header>

      <main className="relative flex-1 w-full max-w-5xl mx-auto px-6 lg:px-8 py-10">
        <div className="text-center mb-9">
          <p className="font-mono text-[10px] text-muted uppercase tracking-widest mb-2">This world is yours to scar</p>
          <h2 className="font-display font-extrabold tracking-widest text-4xl lg:text-5xl">
            {stage === "select" ? "SELECT A CAMPAIGN" : "MUSTER THE TABLE"}
          </h2>
          <div className="flex justify-center gap-3 mt-5">
            {contentPack.factions.map((faction) => <FactionEmblem key={faction.id} factionId={faction.id} size="md" />)}
          </div>
        </div>

        {stage === "select" ? (
          <div className="grid md:grid-cols-2 gap-5">
            {localSave && (
              <section className="md:col-span-2 bg-panel/95 border border-signal/60 rounded-sm p-6">
                <p className="font-mono text-[10px] text-signal uppercase tracking-widest">Saved campaign</p>
                <div className="flex flex-wrap items-center gap-4 mt-1">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-display font-black tracking-widest text-2xl">{localSave.metadata.worldName}</h3>
                    <p className="font-mono text-xs text-muted">Game {localSave.activeGame?.gameNumber ?? localSave.campaignState.gameNumber + 1} · {localSave.players.length} seats</p>
                  </div>
                  <button type="button" onClick={onResume} className="font-display font-bold tracking-widest text-sm bg-signal text-ink px-5 py-2 rounded-sm">
                    {localSave.activeGame ? "RESUME" : "NEXT GAME"}
                  </button>
                  <button type="button" onClick={() => setPending("delete")} className="font-mono text-xs text-muted hover:text-danger">DELETE SAVE</button>
                </div>
              </section>
            )}
            <button type="button" onClick={() => setStage("configure")}
              className="bg-panel/95 border border-line rounded-sm p-6 text-left hover:border-signal min-h-44">
              <span className="font-mono text-[10px] text-muted uppercase tracking-widest">Local · pass this device</span>
              <span className="block font-display font-black tracking-widest text-2xl mt-2">NEW CAMPAIGN</span>
              <span className="block text-sm text-muted mt-2">Name the world, fill three to five seats, then begin Game 1.</span>
              <span className="block font-display font-bold tracking-widest text-signal mt-5">SET UP →</span>
            </button>
            <button type="button" onClick={onLan}
              className="bg-panel/95 border border-line rounded-sm p-6 text-left hover:border-signal min-h-44">
              <span className="font-mono text-[10px] text-muted uppercase tracking-widest">LAN · one screen per player</span>
              <span className="block font-display font-black tracking-widest text-2xl mt-2">JOIN THE WAR ROOM</span>
              <span className="block text-sm text-muted mt-2">Select a shared campaign, take an explicit seat, and ready up.</span>
              <span className="block font-display font-bold tracking-widest text-signal mt-5">CONNECT →</span>
            </button>
            <div className="md:col-span-2">
              <LegacyVault unlockedModules={unlockedModules} compact />
            </div>
          </div>
        ) : (
          <div className="space-y-5 max-w-3xl mx-auto">
          <section className="bg-panel/95 border border-line rounded-sm p-6">
            <div className="flex items-center gap-3 mb-6">
              <button type="button" onClick={() => setStage("select")} className="font-mono text-xs text-muted hover:text-text">← CAMPAIGNS</button>
              <h3 className="font-display font-black tracking-widest text-xl ml-auto">PLAY AT THIS TABLE</h3>
            </div>
            <label className="block mb-6">
              <span className="font-mono text-[10px] uppercase tracking-widest text-muted">Campaign name</span>
              <input aria-label="World name" value={worldName} onChange={(event) => setWorldName(event.target.value)}
                className="mt-1 w-full bg-ink border border-line rounded-sm px-4 py-2 font-display font-bold tracking-wide text-xl focus:border-signal outline-none" />
              <span className="block text-xs text-muted mt-1">This identifies the save. After Game 15, the campaign's top winner names the completed world permanently.</span>
            </label>
            <div className="mb-6">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted mb-2">Seat order</div>
              <div className="space-y-2">
                {names.map((name, index) => (
                  <div key={index} className="grid grid-cols-[72px_1fr_auto] items-center gap-2">
                    <label htmlFor={`seat-${index + 1}-name`} className="font-display font-bold tracking-widest text-sm text-signal">SEAT {index + 1}</label>
                    <input id={`seat-${index + 1}-name`} value={name}
                      onChange={(event) => setNames((current) => current.map((entry, candidate) => candidate === index ? event.target.value : entry))}
                      className="bg-ink border border-line rounded-sm px-3 py-2 text-sm focus:border-signal outline-none" />
                    <button type="button" aria-label={`Remove seat ${index + 1}`} disabled={names.length <= 3}
                      onClick={() => setNames((current) => current.filter((_, candidate) => candidate !== index))}
                      className="w-8 text-muted hover:text-danger disabled:opacity-20">×</button>
                  </div>
                ))}
              </div>
              {names.length < 5 && <button type="button" onClick={() => setNames((current) => [...current, `Player ${current.length + 1}`])}
                className="font-mono text-xs text-signal mt-3">+ ADD SEAT ({names.length}/5)</button>}
              {configIssue && <p id="campaign-config-error" role="alert" className="font-mono text-xs text-danger mt-3">{configIssue}</p>}
            </div>
            <div className="flex flex-wrap items-end gap-3 border-t border-line pt-5">
              <details className="min-w-48">
                <summary className="font-mono text-[10px] text-muted uppercase tracking-widest cursor-pointer">Advanced: deterministic dice</summary>
                <div className="flex items-center gap-2 mt-2">
                  <label htmlFor="dice-seed" className="font-mono text-xs text-muted">SEED</label>
                  <input id="dice-seed" value={seed} onChange={(event) => setSeed(event.target.value.replace(/\D/g, ""))}
                    className="w-32 bg-ink border border-line rounded-sm px-3 py-1.5 font-mono text-sm focus:border-signal outline-none" />
                  <button type="button" onClick={() => setSeed(String(Math.floor(Math.random() * 1e9)))} className="text-xs text-muted">reroll</button>
                </div>
              </details>
              <button type="button" onClick={start} disabled={!!configIssue} aria-describedby={configIssue ? "campaign-config-error" : undefined}
                className="ml-auto font-display font-black tracking-widest text-lg bg-signal text-ink px-7 py-2.5 rounded-sm disabled:opacity-40 disabled:cursor-not-allowed">PREPARE THE WORLD</button>
            </div>
          </section>
          <LegacyVault unlockedModules={unlockedModules} compact />
          </div>
        )}

        {pending && (
          <div role="dialog" aria-modal="true" aria-label="Confirm campaign change" className="fixed inset-0 z-50 bg-ink/80 grid place-items-center p-5">
            <div className="bg-panel border border-danger rounded-sm p-6 max-w-md w-full">
              <h3 className="font-display font-black tracking-widest text-xl text-danger">{pending === "delete" ? "DELETE CAMPAIGN?" : "REPLACE CAMPAIGN?"}</h3>
              <p className="text-sm text-muted mt-2">The existing local campaign and its permanent board history will be removed. This cannot be undone.</p>
              <div className="flex gap-2 justify-end mt-5">
                <button type="button" onClick={() => setPending(null)} className="border border-line rounded-sm px-3 py-1.5 text-sm">CANCEL</button>
                <button type="button" onClick={() => {
                  clearLocalCampaign();
                  setLocalSave(null);
                  const action = pending;
                  setPending(null);
                  if (action === "replace") onStart(config());
                }} className="bg-danger text-ink rounded-sm px-3 py-1.5 font-display font-bold tracking-widest text-sm">
                  {pending === "delete" ? "DELETE PERMANENTLY" : "REPLACE LOCAL SAVE"}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

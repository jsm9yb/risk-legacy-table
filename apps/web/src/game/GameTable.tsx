import { useEffect, useRef, useState } from "react";
import type { GameState, TerritoryId } from "@risk/rules";
import AccessibleBoard from "./accessibility/AccessibleBoard.tsx";
import PresentationSettings from "./settings/PresentationSettings.tsx";
import type { InteractionModel } from "./interaction/InteractionPolicy.ts";
import { createStateTransition } from "./presentation/events.ts";
import { RafPresentationClock } from "./presentation/PresentationClock.ts";
import { createPresentationDirector, type PresentationDirector } from "./presentation/PresentationDirector.ts";
import { WebAudioTableAudioAdapter, type TableAudio } from "./presentation/TableAudio.ts";
import { territorySummary } from "./presentation/TerritorySummary.ts";
import type { MotionPreference, PresentationSnapshot, TransitionSource } from "./presentation/types.ts";

export default function GameTable({
  authoritativeState,
  interaction,
  onTerritoryActivate,
  onPresentationStateChange,
  source = "local",
}: {
  authoritativeState: GameState;
  viewerId?: string;
  interaction: InteractionModel;
  onTerritoryActivate: (territoryId: TerritoryId) => void;
  onPresentationStateChange?: (snapshot: PresentationSnapshot) => void;
  source?: TransitionSource;
}) {
  const tableRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const directorRef = useRef<PresentationDirector>();
  const audioRef = useRef<TableAudio>();
  const previousRef = useRef(authoritativeState);
  const [snapshot, setSnapshot] = useState<PresentationSnapshot>({ status: "loading", queuedTransitions: 0, canSkip: false, inputBlocked: true });
  const [failure, setFailure] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [hovered, setHovered] = useState<{ territoryId: TerritoryId; clientX: number; clientY: number }>();
  const [motion, setMotion] = useState<MotionPreference>(() => (localStorage.getItem("risk.table.motion") as MotionPreference | null) ?? (matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduced" : "full"));
  const [quality, setQuality] = useState<"high" | "balanced" | "low">(() => (localStorage.getItem("risk.table.quality") as "high" | "balanced" | "low" | null) ?? "balanced");
  const [muted, setMuted] = useState(() => localStorage.getItem("risk.table.muted") === "true");
  const [volume, setVolume] = useState(() => {
    const saved = Number(localStorage.getItem("risk.table.volume") ?? "0.7");
    return Number.isFinite(saved) ? Math.max(0, Math.min(1, saved)) : 0.7;
  });
  const stateRef = useRef(authoritativeState);
  const activationRef = useRef(onTerritoryActivate);
  stateRef.current = authoritativeState;
  activationRef.current = onTerritoryActivate;

  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | undefined;
    const clock = new RafPresentationClock();
    const audio = new WebAudioTableAudioAdapter();
    audio.setMuted(muted);
    audio.setVolume(volume);
    audioRef.current = audio;
    const start = async () => {
      try {
        const { PixiTableSceneAdapter } = await import("./presentation/PixiTableSceneAdapter.ts");
        if (disposed || !hostRef.current) return;
        const scene = new PixiTableSceneAdapter({
          clock,
          quality,
          onTerritoryActivate: (id) => activationRef.current(id),
          onTerritoryHover: (territoryId, point) => setHovered(territoryId && point ? { territoryId, ...point } : undefined),
          onContextRestored: () => directorRef.current?.settleImmediately(stateRef.current, "context_loss"),
        });
        await scene.mount(hostRef.current, { state: stateRef.current, revision: stateRef.current.eventSeq });
        if (disposed) { scene.dispose(); return; }
        const director = createPresentationDirector(scene, clock, audio);
        directorRef.current = director;
        director.mount(stateRef.current);
        setSnapshot({ status: "idle", queuedTransitions: 0, canSkip: false, inputBlocked: false });
        director.setMotionPreference(motion);
        director.setInteractionState({ selectedTerritoryId: interaction.selectedTerritoryId, intents: interaction.territories });
        const unsubscribe = director.subscribe((next) => { setSnapshot(next); onPresentationStateChange?.(next); });
        observer = new ResizeObserver(([entry]) => scene.resize({ width: entry.contentRect.width, height: entry.contentRect.height, devicePixelRatio }));
        observer.observe(hostRef.current);
        setFailure(undefined);
        return unsubscribe;
      } catch (error) {
        if (!disposed) setFailure(error instanceof Error ? error.message : String(error));
      }
    };
    let unsubscribe: (() => void) | undefined;
    void start().then((cleanup) => { unsubscribe = cleanup; });
    return () => {
      disposed = true;
      observer?.disconnect();
      unsubscribe?.();
      directorRef.current?.dispose();
      directorRef.current = undefined;
      audioRef.current = undefined;
    };
    // A retry intentionally remounts the full GPU scene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  useEffect(() => { directorRef.current?.setMotionPreference(motion); localStorage.setItem("risk.table.motion", motion); }, [motion]);
  useEffect(() => { audioRef.current?.setMuted(muted); localStorage.setItem("risk.table.muted", String(muted)); }, [muted]);
  useEffect(() => { audioRef.current?.setVolume(volume); localStorage.setItem("risk.table.volume", String(volume)); }, [volume]);

  useEffect(() => {
    directorRef.current?.setInteractionState({ selectedTerritoryId: interaction.selectedTerritoryId, intents: interaction.territories });
  }, [interaction]);

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = authoritativeState;
    if (previous === authoritativeState || !directorRef.current) return;
    try {
      const transition = createStateTransition(previous, authoritativeState, source, performance.now());
      if (source === "reconnect" && transition.events.length === 0) directorRef.current.settleImmediately(authoritativeState, "reconnect");
      else directorRef.current.submit(transition);
    } catch {
      directorRef.current.settleImmediately(authoritativeState, source === "rewind" ? "rewind" : "gap");
    }
  }, [authoritativeState, source]);

  const hoverSummary = hovered ? territorySummary(authoritativeState, hovered.territoryId) : undefined;
  const tableBounds = tableRef.current?.getBoundingClientRect();
  const tooltipPosition = hovered && tableBounds ? {
    left: Math.max(8, Math.min(tableBounds.width - 272, hovered.clientX - tableBounds.left + 12)),
    top: Math.max(8, Math.min(tableBounds.height - 176, hovered.clientY - tableBounds.top + 12)),
  } : undefined;

  return (
    <div ref={tableRef} className="game-table relative h-full w-full overflow-hidden rounded-lg bg-[#080c12] shadow-2xl shadow-black/40"
      data-presentation-status={snapshot.status} data-presentation-seq={snapshot.activeEventSeq ?? "idle"}>
      <div ref={hostRef} className="absolute inset-0" data-testid="pixi-table-host" />
      <AccessibleBoard state={authoritativeState} interaction={interaction} onActivate={onTerritoryActivate} />
      {hoverSummary && tooltipPosition && (
        <div role="tooltip" data-testid="territory-tooltip" style={tooltipPosition}
          className="pointer-events-none absolute z-40 w-64 rounded-md border border-white/20 bg-[#080d14]/95 p-3 text-left shadow-2xl shadow-black/70 backdrop-blur-sm">
          <div className="font-display text-sm font-bold uppercase tracking-[0.14em] text-[#f4e6c8]">{hoverSummary.name}</div>
          <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-[#9eabba]">
            {hoverSummary.controller}{hoverSummary.faction ? ` · ${hoverSummary.faction}` : ""}
          </div>
          <div className="mt-2 flex items-baseline gap-2 border-t border-white/10 pt-2">
            <span className="font-mono text-2xl font-black leading-none text-white">{hoverSummary.troops}</span>
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-[#d5ba76]">troops</span>
            <span className="ml-auto font-mono text-[10px] text-[#aeb8c5]">{hoverSummary.denomination}</span>
          </div>
          {hoverSummary.marks.length > 0 && (
            <div className="mt-2 border-t border-white/10 pt-2 font-mono text-[9px] uppercase leading-4 tracking-wide text-[#c6ced7]">
              {hoverSummary.marks.join(" · ")}
            </div>
          )}
        </div>
      )}
      <PresentationSettings motion={motion} quality={quality} muted={muted} volume={volume}
        onMotion={setMotion}
        onQuality={(value) => { setQuality(value); localStorage.setItem("risk.table.quality", value); setAttempt((current) => current + 1); }}
        onMuted={setMuted} onVolume={setVolume} />
      {snapshot.canSkip && (
        <button type="button" data-testid="presentation-skip" onClick={() => directorRef.current?.skipCurrentSequence()}
          className="absolute right-3 top-3 z-30 rounded border border-white/20 bg-black/70 px-3 py-1.5 font-mono text-[10px] tracking-widest text-white hover:border-signal">
          SKIP
        </button>
      )}
      {failure && (
        <div role="alert" className="absolute inset-0 z-20 grid place-items-center bg-[#0b1119] p-6 text-center">
          <div className="max-w-md rounded border border-danger bg-panel p-5">
            <div className="font-display font-bold tracking-widest text-danger">TABLE RENDERER UNAVAILABLE</div>
            <p className="mt-2 text-sm text-muted">The accessible board remains active. {failure}</p>
            <button type="button" onClick={() => setAttempt((value) => value + 1)} className="mt-4 rounded bg-signal px-4 py-2 font-display font-bold text-ink">RETRY PIXI</button>
          </div>
        </div>
      )}
    </div>
  );
}

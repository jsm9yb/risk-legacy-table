import { useEffect, useMemo, useRef, useState } from "react";
import { territoryCardDefinitions, type GameState, type TerritoryId } from "@risk/rules";
import AccessibleBoard from "./accessibility/AccessibleBoard.tsx";
import PresentationSettings from "./settings/PresentationSettings.tsx";
import { PublicBoardHistory, openingTour, openingOrder, type TableHistoryControls } from "./history/PublicBoardHistory.ts";
import type { DomAnchorRegistry } from "./presentation/DomAnchorRegistry.ts";
import type { InteractionModel } from "./interaction/InteractionPolicy.ts";
import { actionPreview, type PreviewConfiguration } from "./interaction/preview.ts";
import { createStateTransition } from "./presentation/events.ts";
import { RafPresentationClock } from "./presentation/PresentationClock.ts";
import { createPresentationDirector, type PresentationDirector } from "./presentation/PresentationDirector.ts";
import { WebAudioTableAudioAdapter, type TableAudio } from "./presentation/TableAudio.ts";
import { cityEffectSummary, territorySummary } from "./presentation/TerritorySummary.ts";
import type { MotionPreference, PresentationSnapshot, TransitionSource } from "./presentation/types.ts";

export default function GameTable({
  authoritativeState,
  viewerId,
  anchors,
  interaction,
  onTerritoryActivate,
  onPresentationStateChange,
  onVisualStateChange,
  onPresentationReady,
  emphasizedTerritoryId,
  previewConfiguration,
  source = "local",
}: {
  authoritativeState: GameState;
  viewerId?: string;
  anchors?: DomAnchorRegistry;
  interaction: InteractionModel;
  emphasizedTerritoryId?: TerritoryId;
  previewConfiguration?: PreviewConfiguration;
  onTerritoryActivate: (territoryId: TerritoryId) => void;
  onPresentationStateChange?: (snapshot: PresentationSnapshot) => void;
  onVisualStateChange?: (state: GameState | undefined) => void;
  onPresentationReady?: (controls: TableHistoryControls | undefined) => void;
  source?: TransitionSource;
}) {
  const tableRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const directorRef = useRef<PresentationDirector>();
  const audioRef = useRef<TableAudio>();
  const previousRef = useRef(authoritativeState);
  const history = useMemo(() => new PublicBoardHistory(authoritativeState.gameId, localStorage), [authoritativeState.gameId]);
  const [snapshot, setSnapshot] = useState<PresentationSnapshot>({ status: "loading", queuedTransitions: 0, canSkip: false, inputBlocked: true });
  const [failure, setFailure] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [hovered, setHovered] = useState<{ territoryId: TerritoryId; target: "territory" | "city"; clientX: number; clientY: number }>();
  const [resourceView, setResourceView] = useState(false);
  const [focusedTerritory, setFocusedTerritory] = useState<TerritoryId>();
  const [motion, setMotion] = useState<MotionPreference>(() => (localStorage.getItem("risk.table.motion") as MotionPreference | null) ?? (matchMedia("(prefers-reduced-motion: reduce)").matches ? "reduced" : "full"));
  const [quality, setQuality] = useState<"high" | "balanced" | "low">(() => (localStorage.getItem("risk.table.quality") as "high" | "balanced" | "low" | null) ?? "balanced");
  const [muted, setMuted] = useState(() => localStorage.getItem("risk.table.muted") === "true");
  const [volume, setVolume] = useState(() => {
    const saved = Number(localStorage.getItem("risk.table.volume") ?? "0.7");
    return Number.isFinite(saved) ? Math.max(0, Math.min(1, saved)) : 0.7;
  });
  const stateRef = useRef(authoritativeState);
  const activationRef = useRef(onTerritoryActivate);
  const visualCallbackRef = useRef(onVisualStateChange);
  const viewerRef = useRef(viewerId);
  visualCallbackRef.current = onVisualStateChange;
  viewerRef.current = viewerId;
  stateRef.current = authoritativeState;
  activationRef.current = onTerritoryActivate;

  const resourceValues = useMemo(() => Object.fromEntries(
    territoryCardDefinitions(!!authoritativeState.alienIsland).map((card) => [
      card.territoryId,
      authoritativeState.sideboard.destroyed.includes(card.id)
        ? 0
        : authoritativeState.cardModifications[card.id]?.resources ?? card.resources,
    ]),
  ) as Partial<Record<TerritoryId, number>>, [authoritativeState.alienIsland, authoritativeState.cardModifications, authoritativeState.sideboard.destroyed]);
  const preview = useMemo(() => !resourceView && snapshot.status === "idle" && previewConfiguration
    ? actionPreview(authoritativeState, interaction, previewConfiguration, hovered?.territoryId ?? focusedTerritory)
    : undefined, [authoritativeState, interaction, previewConfiguration, hovered?.territoryId, focusedTerritory, resourceView, snapshot.status]);
  const tableInteraction = useMemo(() => ({
    selectedTerritoryId: interaction.selectedTerritoryId,
    intents: interaction.territories,
    emphasizedTerritoryId,
    resourceValues: resourceView ? resourceValues : undefined,
    preview,
  }), [emphasizedTerritoryId, interaction, resourceValues, resourceView, preview]);

  useEffect(() => {
    let disposed = false;
    const mountedGameId = authoritativeState.gameId;
    const mountedViewerId = viewerId;
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
          anchors,
          onTerritoryActivate: (id) => activationRef.current(id),
          onTerritoryHover: (territoryId, point) => setHovered(territoryId && point ? { territoryId, target: "territory", ...point } : undefined),
          onCityHover: (territoryId, point) => setHovered(territoryId && point ? { territoryId, target: "city", ...point } : undefined),
          onContextRestored: () => directorRef.current?.settleImmediately(stateRef.current, "context_loss"),
        });
        await scene.mount(hostRef.current, { state: stateRef.current, revision: stateRef.current.eventSeq });
        if (disposed) { scene.dispose(); return; }
        const director = createPresentationDirector(scene, clock, audio, (state) => {
          if (!disposed && stateRef.current.gameId === mountedGameId && viewerRef.current === mountedViewerId) visualCallbackRef.current?.(state);
        });
        directorRef.current = director;
        onPresentationReady?.({ skip: () => director.skipCurrentSequence(),
          playHistory: (frames, options) => director.playHistory(frames, options),
          history: () => history.list(stateRef.current),
          opening: () => openingTour(stateRef.current), order: () => openingOrder(stateRef.current),
        });
        director.mount(stateRef.current);
        setSnapshot({ status: "idle", queuedTransitions: 0, canSkip: false, inputBlocked: false });
        director.setMotionPreference(motion);
        director.setInteractionState(tableInteraction);
        const unsubscribe = director.subscribe((next) => { setSnapshot(next); onPresentationStateChange?.(next); });
        observer = new ResizeObserver(([entry]) => scene.resize({ width: entry.contentRect.width, height: entry.contentRect.height, devicePixelRatio }));
        observer.observe(hostRef.current);
        setFailure(undefined);
        return unsubscribe;
      } catch (error) {
        if (!disposed) {
          const message = error instanceof Error ? error.message : String(error);
          const failed: PresentationSnapshot = { status: "failed", queuedTransitions: 0, canSkip: false, inputBlocked: false, failure: message };
          directorRef.current?.dispose();
          directorRef.current = undefined;
          onPresentationReady?.(undefined);
          audio.dispose();
          visualCallbackRef.current?.(undefined);
          setSnapshot(failed);
          onPresentationStateChange?.(failed);
          setFailure(message);
        }
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
      visualCallbackRef.current?.(undefined);
      onPresentationReady?.(undefined);
      audioRef.current = undefined;
    };
    // A retry intentionally remounts the full GPU scene.
  }, [attempt, authoritativeState.gameId, viewerId]);

  useEffect(() => { directorRef.current?.setMotionPreference(motion); localStorage.setItem("risk.table.motion", motion); }, [motion]);
  useEffect(() => { audioRef.current?.setMuted(muted); localStorage.setItem("risk.table.muted", String(muted)); }, [muted]);
  useEffect(() => { audioRef.current?.setVolume(volume); localStorage.setItem("risk.table.volume", String(volume)); }, [volume]);

  useEffect(() => {
    directorRef.current?.setInteractionState(tableInteraction);
  }, [tableInteraction]);

  useEffect(() => {
    const previous = previousRef.current;
    history.capture(previous, authoritativeState);
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

  const hoverSummary = hovered?.target === "territory" ? territorySummary(authoritativeState, hovered.territoryId) : undefined;
  const citySummary = hovered?.target === "city" ? cityEffectSummary(authoritativeState, hovered.territoryId) : undefined;
  const tableBounds = tableRef.current?.getBoundingClientRect();
  const tooltipPosition = hovered && tableBounds ? {
    left: Math.max(8, Math.min(tableBounds.width - 272, hovered.clientX - tableBounds.left + 12)),
    top: Math.max(8, Math.min(tableBounds.height - (citySummary ? 244 : 176), hovered.clientY - tableBounds.top + 12)),
  } : undefined;

  return (
    <div ref={tableRef} className="game-table relative h-full w-full overflow-hidden rounded-lg bg-[#080c12] shadow-2xl shadow-black/40"
      data-history-mode={snapshot.replay ? "replay" : "live"} data-history-title={snapshot.replay?.title} data-history-side={snapshot.replay?.side}
      data-presentation-status={snapshot.status} data-presentation-seq={snapshot.activeEventSeq ?? "idle"}>
      <div ref={hostRef} className="absolute inset-0" data-testid="pixi-table-host" />
      <AccessibleBoard state={authoritativeState} interaction={interaction} onActivate={onTerritoryActivate}
        onTerritoryFocus={setFocusedTerritory} previewLabel={preview?.label}
        emphasizedTerritoryId={emphasizedTerritoryId} resourceValues={resourceView ? resourceValues : undefined} />
      {preview && (
        <div role="status" data-testid="action-preview" className="pointer-events-none absolute left-1/2 top-3 z-30 max-w-[65%] -translate-x-1/2 rounded border border-dashed border-signal/60 bg-panel/95 px-3 py-2 text-center font-mono text-[10px] text-text shadow-lg">
          {preview.label}
        </div>
      )}
      <button type="button" aria-label={resourceView ? "Return to tactical board" : "Show territory resource values"}
        aria-pressed={resourceView} data-testid="resource-view-toggle" onClick={() => setResourceView((current) => !current)}
        className={`absolute left-3 top-12 z-30 flex items-center gap-1.5 rounded border px-2.5 py-1.5 font-mono text-[10px] font-bold tracking-wider shadow-lg backdrop-blur-sm ${
          resourceView ? "border-[#f3cf6a] bg-[#6d4a12]/95 text-[#fff1bd]" : "border-white/20 bg-black/70 text-white hover:border-signal"
        }`}>
        <span aria-hidden="true" className="grid size-4 place-items-center rounded-full border border-current text-[9px]">●</span>
        {resourceView ? "COINS ON" : "COINS"}
      </button>
      {citySummary && tooltipPosition && (
        <div role="tooltip" data-testid="city-tooltip" style={tooltipPosition}
          className="pointer-events-none absolute z-40 w-64 rounded-md border border-[#77cbea]/45 bg-[#071522]/95 p-3 text-left shadow-2xl shadow-black/70 backdrop-blur-sm">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="font-display text-sm font-bold uppercase tracking-[0.14em] text-[#f4e6c8]">{citySummary.name}</div>
              <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-[#85cce5]">{citySummary.typeLabel}</div>
            </div>
            <div className="rounded border border-[#a9e5f6]/60 bg-[#0d3550] px-2 py-1 text-center shadow-inner">
              <div className="font-mono text-[8px] font-bold uppercase tracking-widest text-[#a9e5f6]">Population</div>
              <div className="font-mono text-xl font-black leading-none text-white">+{citySummary.population}</div>
            </div>
          </div>
          <div className="mt-2 border-t border-white/10 pt-2 font-mono text-[10px] leading-4 text-[#d7e0e8]">
            <div><span className="font-bold uppercase text-[#d5ba76]">Recruit</span> · {citySummary.recruitmentEffect}</div>
            <div className="mt-1"><span className="font-bold uppercase text-[#d5ba76]">Unoccupied</span> · {citySummary.unoccupiedEntryEffect}</div>
            {citySummary.founderEffect && <div className="mt-1 text-[#a9e5f6]">{citySummary.founderEffect}</div>}
            {citySummary.fortificationEffect && <div className="mt-1 text-[#a9e5f6]">{citySummary.fortificationEffect}</div>}
          </div>
        </div>
      )}
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

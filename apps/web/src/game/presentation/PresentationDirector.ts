import { historyRenderState, type HistoryFrame, type HistoryPlaybackOptions } from "../history/PublicBoardHistory.ts";
import { territoryCardDefinitions, type GameState } from "@risk/rules";
import type { TableScene } from "./TableScene.ts";
import type { PresentationClock } from "./PresentationClock.ts";
import type { TableAudio } from "./TableAudio.ts";
import { planTransition } from "./planTransition.ts";
import type { MotionPreference, PresentationSnapshot, SettleReason, StateTransition, TableInteractionModel } from "./types.ts";

const cueFor = (command: import("./types.ts").SceneCommand): import("./TableAudio.ts").TableAudioCue | undefined => {
  switch (command.type) {
    case "army.place": return "piece.place";
    case "army.move": return "piece.move";
    case "battle.dice": return "dice.tumble";
    case "battle.impact": return "battle.impact";
    case "army.remove": return "piece.casualty";
    case "territory.conquest": return "territory.conquered";
    case "scar.apply": return "scar.apply";
    case "redStar.gain": return "redStar.gained";
    case "missile.commit": return "missile.commit";
    case "module.reveal": return "module.reveal";
    case "game.victory": return "game.victory";
    default: return undefined;
  }
};

export interface PresentationDirector {
  mount(initial: GameState): void;
  submit(transition: StateTransition): void;
  playHistory(frames: readonly HistoryFrame[], options?: HistoryPlaybackOptions): Promise<void>;
  setInteractionState(state: TableInteractionModel): void;
  setMotionPreference(preference: MotionPreference): void;
  skipCurrentSequence(): void;
  settleImmediately(state: GameState, reason: SettleReason): void;
  subscribe(listener: (snapshot: PresentationSnapshot) => void): () => void;
  dispose(): void;
}

export function createPresentationDirector(scene: TableScene, clock: PresentationClock, audio: TableAudio, onVisualStateChange?: (state: GameState) => void): PresentationDirector {
  let mounted = false;
  let disposed = false;
  let preference: MotionPreference = "full";
  let active: AbortController | undefined;
  let activeTransition: StateTransition | undefined;
  let authoritative: GameState | undefined;
  let replaying = false;
  let interaction: TableInteractionModel = {intents: {}};
  const queue: StateTransition[] = [];
  const listeners = new Set<(snapshot: PresentationSnapshot) => void>();
  let snapshot: PresentationSnapshot = { status: "loading", queuedTransitions: 0, canSkip: false, inputBlocked: true };

  const publish = (patch: Partial<PresentationSnapshot>) => {
    snapshot = { ...snapshot, ...patch, queuedTransitions: queue.length };
    listeners.forEach((listener) => listener(snapshot));
  };

  const applyVisual = (state: GameState, revision = state.eventSeq, notify = true) => {
    scene.apply({state, revision});
    if (notify) onVisualStateChange?.(state);
  };
  const settle = (state: GameState, reason?: SettleReason) => {
    applyVisual(state);
    if (reason && reason !== "initial") void scene.execute({ type: "table.resync", reason }, new AbortController().signal, 200);
  };

  const placementOnly = (t: StateTransition) => t.events.every(e => e.type === "troops.placed" || e.type === "presentation.none");

  const run = async () => {
    if (activeTransition || replaying || disposed) return;
    const transition = queue.shift();
    if (!transition) { publish({ status: "idle", activeEventSeq: undefined, activeBeat: undefined, canSkip: false, inputBlocked: false }); return; }
    activeTransition = transition;
    const sequence = planTransition(transition, preference);
    const catchingUp = queue.length >= 8 || sequence.estimatedDurationMs > 12000;
    const scale = catchingUp ? 0.35 : 1;
    const controller = new AbortController();
    active = controller;
    publish({ status: catchingUp ? "catching_up" : "presenting", activeEventSeq: sequence.eventSeq, canSkip: sequence.estimatedDurationMs * scale > 900, inputBlocked: !placementOnly(transition) });
    try {
      for (const beat of sequence.beats) {
        if (controller.signal.aborted) break;
        publish({ activeBeat: beat.label });
        if (beat.commands.length) await Promise.all(beat.commands.map((command) => {
          const cue = cueFor(command);
          if (cue) audio.play(cue);
          return scene.execute(command, controller.signal, beat.durationMs * scale);
        }));
        else await clock.wait(beat.durationMs * scale, controller.signal);
        if (beat.visualState && !controller.signal.aborted && active === controller && !disposed) applyVisual(beat.visualState, transition.previous.eventSeq);
      }
    } catch (error) {
      if (!disposed && active === controller) publish({ status: "failed", failure: error instanceof Error ? error.message : String(error), inputBlocked: false, canSkip: false });
    } finally {
      // A resync can replace this run while an aborted command is still settling.
      if (!disposed && active === controller) {
        settle(transition.next);
        active = undefined;
        activeTransition = undefined;
        void run();
      }
    }
  };

  return {
    mount(initial) {
      if (mounted) throw new Error("Presentation Director may only mount once");
      mounted = true;
      authoritative = initial;
      settle(initial, "initial");
      publish({ status: "idle", inputBlocked: false });
    },
    submit(transition) {
      if (!mounted || disposed) throw new Error("Presentation Director is not available");
      authoritative = transition.next;
      if (replaying) {
        this.settleImmediately(transition.next, "reconnect");
        return;
      }
      if (transition.next.eventSeq < transition.previous.eventSeq) return this.settleImmediately(transition.next, "gap");
      const pending = queue.at(-1);
      if (pending && placementOnly(pending) && placementOnly(transition) && pending.next.eventSeq === transition.previous.eventSeq) {
        const events = pending.events.map(event => ({...event}));
        for (const event of transition.events) {
          const existing = event.type === "troops.placed" ? events.find(e => e.type === "troops.placed" && e.playerId === event.playerId && e.territoryId === event.territoryId) : undefined;
          if (existing?.type === "troops.placed" && event.type === "troops.placed") existing.count += event.count;
          else events.push({...event});
        }
        queue[queue.length - 1] = {...pending, next: transition.next, events};
      } else queue.push(transition);
      if (queue.length > 20) {
        const newest = queue.at(-1)!;
        queue.splice(0);
        this.settleImmediately(newest.next, "queue_overflow");
        return;
      }
      publish({ queuedTransitions: queue.length });
      void run();
    },
    async playHistory(frames, options = {}) {
      if (!mounted || disposed || !authoritative || activeTransition || !frames.length) return;
      // Replacing a held historical view must not allow its old finally block to restore over us.
      active?.abort();
      audio.stopTransient();
      const controller = new AbortController();
      active = controller;
      replaying = true;
      scene.setInteraction({intents: {}});
      const milliseconds = (full: number) => preference === "instant" ? 0 : preference === "reduced" ? 120 : full;
      const execute = async (command: import("./types.ts").SceneCommand, ms: number) => {
        if (command.type === "camera.frame" && preference !== "full") return;
        if (!controller.signal.aborted) await scene.execute(command, controller.signal, milliseconds(ms));
      };
      try {
        for (let index = 0; index < frames.length && !controller.signal.aborted; index++) {
          const frame = frames[index];
          const sides = options.side ? [options.side] : ["before", "after"] as const;
          for (const side of sides) {
            if (controller.signal.aborted) break;
            publish({status: "presenting", inputBlocked: true, canSkip: true,
              replay: {title: frame.title, detail: frame.detail, index, total: frames.length, side, provenance: frame.provenance}});
            scene.setInteraction({intents: {}, resourceValues: frame.view === "resources" ? Object.fromEntries(
              territoryCardDefinitions(!!frame[side].alienIsland).map(card => [card.territoryId,
                frame[side].destroyedCards.includes(card.id) ? 0 : frame[side].cardModifications[card.id]?.resources ?? card.resources]),
            ) : undefined});
            if (side === "before" || options.side) applyVisual(historyRenderState(authoritative, frame[side]), frame.seq, false);
            if (side === sides[0]) await execute({type: "camera.frame", ...frame.focus}, 350);
            if (side === "after" && frame.commands) for (const command of frame.commands) await execute(command, command.type === "setup.order" ? 1700 : 650);
            if (side === "after") applyVisual(historyRenderState(authoritative, frame.after), frame.seq, false);
            await execute({type: "campaign.recap", title: `${side.toUpperCase()} · ${frame.title}`, items: [frame.detail]}, 1200);
          }
        }
        if (options.hold && !controller.signal.aborted) {
          await new Promise<void>(resolve => controller.signal.addEventListener("abort", () => resolve(), {once: true}));
        }
      } catch (error) {
        if (!disposed && active === controller) publish({failure: error instanceof Error ? error.message : String(error)});
      } finally {
        if (!disposed && active === controller) {
          replaying = false;
          active = undefined;
          scene.setInteraction(interaction);
          settle(authoritative);
          void scene.execute({type: "camera.frame"}, new AbortController().signal, 0);
          publish({status: "idle", replay: undefined, canSkip: false, inputBlocked: false, activeBeat: undefined});
          void run();
        }
      }
    },
    setInteractionState(state) { interaction = state; if (!replaying) scene.setInteraction(state); },
    setMotionPreference(next) { preference = next; },
    skipCurrentSequence() { active?.abort(); audio.stopTransient(); },
    settleImmediately(state, reason) {
      const wasReplaying = replaying;
      authoritative = state;
      replaying = false;
      active?.abort();
      active = undefined;
      activeTransition = undefined;
      queue.splice(0);
      audio.stopTransient();
      scene.setInteraction(interaction);
      settle(state, reason);
      if (wasReplaying) void scene.execute({type: "camera.frame"}, new AbortController().signal, 0);
      publish({ status: "resyncing", activeEventSeq: state.eventSeq, canSkip: false, inputBlocked: false });
      publish({ status: "idle", activeEventSeq: undefined, activeBeat: undefined, replay: undefined });
    },
    subscribe(listener) { listeners.add(listener); listener(snapshot); return () => listeners.delete(listener); },
    dispose() { disposed = true; active?.abort(); queue.splice(0); audio.dispose(); scene.dispose(); listeners.clear(); },
  };
}

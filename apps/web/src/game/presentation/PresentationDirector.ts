import type { GameState } from "@risk/rules";
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
  setInteractionState(state: TableInteractionModel): void;
  setMotionPreference(preference: MotionPreference): void;
  skipCurrentSequence(): void;
  settleImmediately(state: GameState, reason: SettleReason): void;
  subscribe(listener: (snapshot: PresentationSnapshot) => void): () => void;
  dispose(): void;
}

export function createPresentationDirector(scene: TableScene, clock: PresentationClock, audio: TableAudio): PresentationDirector {
  let mounted = false;
  let disposed = false;
  let preference: MotionPreference = "full";
  let active: AbortController | undefined;
  let activeTransition: StateTransition | undefined;
  const queue: StateTransition[] = [];
  const listeners = new Set<(snapshot: PresentationSnapshot) => void>();
  let snapshot: PresentationSnapshot = { status: "loading", queuedTransitions: 0, canSkip: false, inputBlocked: true };

  const publish = (patch: Partial<PresentationSnapshot>) => {
    snapshot = { ...snapshot, ...patch, queuedTransitions: queue.length };
    listeners.forEach((listener) => listener(snapshot));
  };

  const settle = (state: GameState, reason?: SettleReason) => {
    scene.apply({ state, revision: state.eventSeq });
    if (reason && reason !== "initial") void scene.execute({ type: "table.resync", reason }, new AbortController().signal, 200);
  };

  const run = async () => {
    if (activeTransition || disposed) return;
    const transition = queue.shift();
    if (!transition) { publish({ status: "idle", activeEventSeq: undefined, canSkip: false, inputBlocked: false }); return; }
    activeTransition = transition;
    const sequence = planTransition(transition, preference);
    const catchingUp = queue.length >= 8 || sequence.estimatedDurationMs > 12000;
    const scale = catchingUp ? 0.35 : 1;
    active = new AbortController();
    publish({ status: catchingUp ? "catching_up" : "presenting", activeEventSeq: sequence.eventSeq, canSkip: sequence.estimatedDurationMs * scale > 900, inputBlocked: true });
    try {
      for (const beat of sequence.beats) {
        if (active.signal.aborted) break;
        if (beat.commands.length) await Promise.all(beat.commands.map((command) => {
          const cue = cueFor(command);
          if (cue) audio.play(cue);
          return scene.execute(command, active!.signal, beat.durationMs * scale);
        }));
        else await clock.wait(beat.durationMs * scale, active.signal);
      }
    } catch (error) {
      publish({ status: "failed", failure: error instanceof Error ? error.message : String(error), inputBlocked: false, canSkip: false });
    } finally {
      settle(transition.next);
      active = undefined;
      activeTransition = undefined;
      if (!disposed) void run();
    }
  };

  return {
    mount(initial) {
      if (mounted) throw new Error("Presentation Director may only mount once");
      mounted = true;
      settle(initial, "initial");
      publish({ status: "idle", inputBlocked: false });
    },
    submit(transition) {
      if (!mounted || disposed) throw new Error("Presentation Director is not available");
      if (transition.next.eventSeq < transition.previous.eventSeq) return this.settleImmediately(transition.next, "gap");
      queue.push(transition);
      if (queue.length > 20) {
        const newest = queue.at(-1)!;
        queue.splice(0);
        this.settleImmediately(newest.next, "queue_overflow");
        return;
      }
      publish({ queuedTransitions: queue.length });
      void run();
    },
    setInteractionState(state) { scene.setInteraction(state); },
    setMotionPreference(next) { preference = next; },
    skipCurrentSequence() { active?.abort(); audio.stopTransient(); },
    settleImmediately(state, reason) {
      active?.abort();
      queue.splice(0);
      audio.stopTransient();
      settle(state, reason);
      publish({ status: "resyncing", activeEventSeq: state.eventSeq, canSkip: false, inputBlocked: false });
      publish({ status: "idle", activeEventSeq: undefined });
    },
    subscribe(listener) { listeners.add(listener); listener(snapshot); return () => listeners.delete(listener); },
    dispose() { disposed = true; active?.abort(); queue.splice(0); audio.dispose(); scene.dispose(); listeners.clear(); },
  };
}

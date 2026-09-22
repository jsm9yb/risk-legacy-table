// Local hot-seat wrapper: the real engine runs in React state; control passes to
// whoever the game waits on. UI lives in GameScreen, shared with network play.
import { useEffect, useRef, useState } from "react";
import { applyAction, locksRewind, RuleViolation, type GameState, type Action } from "@risk/rules";
import type { LocalConfig } from "../App.tsx";
import GameScreen from "./GameScreen.tsx";
import type { TransitionSource } from "./presentation/types.ts";
import {
  createNextLocalGame,
  foldCompletedLocalGame,
  loadLocalCampaign,
  localLegacyDone,
  persistActiveGame,
  startLocalCampaign,
  type LocalCampaignSave,
} from "../local/campaignStore.ts";


export default function SandboxGame({ config, onExit }: { config: LocalConfig; onExit: () => void }) {
  const [initial] = useState(() => {
    try {
      return { session: initializeLocalSession(config), error: null };
    } catch (error) {
      return { session: null, error: error instanceof Error ? error.message : String(error) };
    }
  });
  const [session, setSession] = useState(initial.session);
  const sessionRef = useRef(session);
  const [error, setError] = useState<string | null>(null);
  const errTimer = useRef<number | undefined>(undefined);
  const checkpoints = useRef<GameState[]>(session
    ? structuredClone(session.save.rewind?.checkpoints ?? [session.gs])
    : []);
  const [rewindLocked, setRewindLocked] = useState(session?.save.rewind?.locked ?? false);
  const [presentationSource, setPresentationSource] = useState<TransitionSource>("local");

  useEffect(() => () => window.clearTimeout(errTimer.current), []);

  if (!session) {
    return (
      <div className="min-h-full grid place-items-center p-8">
        <div role="alert" className="max-w-lg bg-panel border border-danger rounded-sm p-6">
          <h1 className="font-display font-bold tracking-widest text-xl text-danger">LOCAL GAME COULD NOT START</h1>
          <p className="text-sm text-muted mt-2 mb-4">{initial.error}</p>
          <button type="button" onClick={onExit}
            className="font-display font-bold tracking-widest text-sm bg-signal text-ink px-4 py-2 rounded-sm">
            RETURN TO HUB
          </button>
        </div>
      </div>
    );
  }

  const dispatch = (a: Action) => {
    try {
      setPresentationSource("local");
      const current = sessionRef.current!;
      const next = applyAction(current.gs, a);
      const turnChanged = next.turnNumber !== current.gs.turnNumber || next.activeIdx !== current.gs.activeIdx;
      let nextLocked = rewindLocked;
      if (turnChanged) {
        checkpoints.current = [structuredClone(next)];
        nextLocked = false;
      } else if (next.phase !== current.gs.phase) {
        checkpoints.current.push(structuredClone(next));
      }
      if (locksRewind(current.gs, next, a)) nextLocked = true;
      setRewindLocked(nextLocked);
      let nextSave = persistActiveGame({
        ...current.save,
        rewind: { checkpoints: structuredClone(checkpoints.current), locked: nextLocked },
      }, next);
      if (localLegacyDone(next) && !localLegacyDone(current.gs)) {
        nextSave = foldCompletedLocalGame(nextSave, next);
      }
      const nextSession = { save: nextSave, gs: next };
      sessionRef.current = nextSession;
      setSession(nextSession);
      setError(null);
    } catch (e) {
      if (e instanceof RuleViolation) {
        setError(e.message);
        window.clearTimeout(errTimer.current);
        errTimer.current = window.setTimeout(() => setError(null), 4000);
      } else throw e;
    }
  };

  const restore = (back: boolean) => {
    if (rewindLocked || session.gs.phase === "game_over") return;
    if (back) {
      if (checkpoints.current.length < 2) return;
      checkpoints.current.pop();
    }
    const target = checkpoints.current.at(-1);
    if (!target) return;
    const next = structuredClone(target);
    setPresentationSource("replay");
    const nextSave = persistActiveGame({
      ...session.save,
      rewind: { checkpoints: structuredClone(checkpoints.current), locked: false },
    }, next);
    const nextSession = { save: nextSave, gs: next };
    sessionRef.current = nextSession;
    setSession(nextSession);
    setRewindLocked(false);
    setError(null);
  };

  const phaseStart = checkpoints.current.at(-1);
  const canRewind = !rewindLocked && session.gs.phase !== "game_over";
  const rewind = {
    canReset: canRewind && !!phaseStart && phaseStart.eventSeq !== session.gs.eventSeq,
    canBack: canRewind && checkpoints.current.length > 1,
    reason: rewindLocked
      ? "Rewind is locked after an attack, Scar play, or hidden card draw."
      : "Reset this phase or return to the start of the previous phase.",
    onReset: () => restore(false),
    onBack: () => restore(true),
  };

  return <GameScreen gs={session.gs} dispatch={dispatch} onExit={onExit} error={error} rewind={rewind} presentationSource={presentationSource} />;
}

function initializeLocalSession(config: LocalConfig): { save: LocalCampaignSave; gs: GameState } {
  let save = config.resume ? loadLocalCampaign() : null;
  if (!save) save = startLocalCampaign(config);
  if (!save.activeGame) save = createNextLocalGame(save);
  if (!save.activeGame) throw new Error("Local campaign did not create an active game");
  return { save, gs: save.activeGame };
}

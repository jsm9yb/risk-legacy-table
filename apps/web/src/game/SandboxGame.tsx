// Local hot-seat wrapper: the real engine runs in React state; control passes to
// whoever the game waits on. UI itself lives in GameScreen (shared with 1-web-b). // new (1-web-b): slimmed to a wrapper
import { useRef, useState } from "react";
import { createGame, applyAction, RuleViolation, type GameState, type Action } from "@risk/rules";
import type { LocalConfig } from "../App.tsx";
import GameScreen from "./GameScreen.tsx";

export type { UiState } from "./GameScreen.tsx"; // new: UiState moved with the screen

export default function SandboxGame({ config, onExit }: { config: LocalConfig; onExit: () => void }) {
  const [gs, setGs] = useState<GameState>(() =>
    createGame({ gameId: `local-${config.seed}`, seed: config.seed, players: config.players })
  );
  const [error, setError] = useState<string | null>(null);
  const errTimer = useRef<number | undefined>(undefined);

  const dispatch = (a: Action) => {
    try {
      setGs(applyAction(gs, a));
      setError(null);
    } catch (e) {
      if (e instanceof RuleViolation) {
        setError(e.message);
        window.clearTimeout(errTimer.current);
        errTimer.current = window.setTimeout(() => setError(null), 4000);
      } else throw e;
    }
  };

  return <GameScreen gs={gs} dispatch={dispatch} onExit={onExit} error={error} />;
}

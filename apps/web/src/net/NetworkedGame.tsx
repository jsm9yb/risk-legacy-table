// new (1-web-b): networked game screen — renders per-viewer filtered `game:state`
// payloads and sends `game:action`; the shared GameScreen drives all interaction.
import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import type { GameState, Action } from "@risk/rules";
import GameScreen from "../game/GameScreen.tsx";

/** Minimal socket surface so tests can inject a fake. */
export interface GameSocket {
  emit: Socket["emit"] | ((event: string, payload: unknown, ack?: (res: any) => void) => unknown);
  on: (event: string, handler: (...args: any[]) => void) => unknown;
  off?: (event: string, handler: (...args: any[]) => void) => unknown;
}

export default function NetworkedGame({ socket, sessionId, viewerId, onExit }: {
  socket: GameSocket;
  sessionId: string;
  viewerId: string;
  onExit: () => void;
}) {
  const [gs, setGs] = useState<GameState | null>(null);
  const [seated, setSeated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const onState = (state: GameState) => setGs(state);
    socket.on("game:state", onState);
    socket.emit("game:join", { sessionId }, (res: any) => {
      if (res?.error) return setError(res.error);
      setGs(res.state as GameState);
      setSeated(!!res.seated);
    });
    return () => { socket.off?.("game:state", onState); };
  }, [socket, sessionId]);

  const dispatch = (a: Action) => {
    socket.emit("game:action", { sessionId, action: a }, (res: any) => {
      if (res?.error) {
        setError(res.error); // server-side RuleViolation — authoritative rejection
        window.clearTimeout(errTimer.current);
        errTimer.current = window.setTimeout(() => setError(null), 4000);
      } else {
        setError(null);
      }
    });
  };

  if (!gs) {
    return (
      <div className="min-h-full grid place-items-center">
        <p className="font-mono text-xs text-muted">{error ?? `joining session ${sessionId}…`}</p>
      </div>
    );
  }
  // Spectators get a viewer id that never matches the actor -> view-only.
  return <GameScreen gs={gs} dispatch={dispatch} onExit={onExit} error={error} viewer={seated ? viewerId : "__spectator__"} />;
}

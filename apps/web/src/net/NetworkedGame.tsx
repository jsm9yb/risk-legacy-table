// new (1-web-b): networked game screen — renders per-viewer filtered `game:state`
// payloads and sends `game:action`; the shared GameScreen drives all interaction.
import { useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import type { GameState, Action } from "@risk/rules";
import GameScreen, { type RewindControls } from "../game/GameScreen.tsx";
import type { TransitionSource } from "../game/presentation/types.ts";

/** Minimal socket surface so tests can inject a fake. */
export interface GameSocket {
  emit: Socket["emit"] | ((event: string, payload: unknown, ack?: (res: any) => void) => unknown);
  on: (event: string, handler: (...args: any[]) => void) => unknown;
  off?: (event: string, handler: (...args: any[]) => void) => unknown;
}

export interface GameStateEnvelope {
  sessionId: string;
  state: GameState;
  rewind?: Pick<RewindControls, "canReset" | "canBack" | "reason">;
}

export default function NetworkedGame({ socket, sessionId, viewerId, onExit }: {
  socket: GameSocket;
  sessionId: string;
  viewerId: string;
  onExit: () => void;
}) {
  const [gs, setGs] = useState<GameState | null>(null);
  const [seated, setSeated] = useState(false);
  const [contentHost, setContentHost] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionMessage, setConnectionMessage] = useState<string | null>(null);
  const [rewindStatus, setRewindStatus] = useState<GameStateEnvelope["rewind"]>();
  const errTimer = useRef<number | undefined>(undefined);
  const latestState = useRef<GameState | null>(null);
  const pendingRewind = useRef(false);
  const [presentationSource, setPresentationSource] = useState<TransitionSource>("network");

  useEffect(() => {
    setGs(null);
    setSeated(false);
    setContentHost(false);
    setError(null);
    setRewindStatus(undefined);
    latestState.current = null;
    pendingRewind.current = false;
    setPresentationSource("network");
    const onState = (message: GameStateEnvelope) => {
      if (message.sessionId === sessionId) {
        const previous = latestState.current;
        const hasGap = !!previous && message.state.eventSeq > previous.eventSeq
          && !message.state.log.some((event) => event.seq === previous.eventSeq + 1);
        const rewound = pendingRewind.current && !!previous && message.state.eventSeq <= previous.eventSeq;
        pendingRewind.current = false;
        setPresentationSource(rewound ? "rewind" : previous && (message.state.eventSeq <= previous.eventSeq || hasGap) ? "reconnect" : "network");
        latestState.current = message.state;
        setGs(message.state);
        setRewindStatus(message.rewind);
      }
    };
    const joinSession = () => socket.emit("game:join", { sessionId }, (res: any) => {
      if (res?.error) return setError(res.error);
      latestState.current = res.state as GameState;
      setGs(res.state as GameState);
      setSeated(!!res.seated);
      setContentHost(!!res.contentHost);
      setRewindStatus(res.rewind);
      setConnectionMessage(null);
    });
    const onDisconnect = () => setConnectionMessage("Connection lost — decisions are paused while the table reconnects.");
    const onConnect = () => {
      setConnectionMessage("Reconnected — synchronizing the latest table state…");
      joinSession();
    };
    socket.on("game:state", onState);
    socket.on("disconnect", onDisconnect);
    socket.on("connect", onConnect);
    joinSession();
    return () => {
      window.clearTimeout(errTimer.current);
      socket.emit("game:leave", { sessionId });
      socket.off?.("game:state", onState);
      socket.off?.("disconnect", onDisconnect);
      socket.off?.("connect", onConnect);
    };
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

  const rewind = (mode: "reset" | "back") => {
    pendingRewind.current = true;
    socket.emit("game:rewind", { sessionId, mode }, (res: any) => {
      if (res?.error) { pendingRewind.current = false; setError(res.error); }
      else setError(null);
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
  return <GameScreen key={sessionId} gs={gs} dispatch={dispatch} onExit={onExit} error={error ?? connectionMessage} viewer={seated ? viewerId : "__spectator__"}
    canManageContent={contentHost}
    presentationSource={presentationSource}
    rewind={seated && rewindStatus ? {
      ...rewindStatus,
      onReset: () => rewind("reset"),
      onBack: () => rewind("back"),
    } : undefined} />;
}

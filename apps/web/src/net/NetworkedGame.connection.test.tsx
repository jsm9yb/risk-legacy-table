// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { createGame } from "@risk/rules";
import NetworkedGame from "./NetworkedGame.tsx";

const screen = vi.hoisted(() => ({ props: null as any }));
vi.mock("../game/GameScreen.tsx", () => ({ default: (props: unknown) => { screen.props = props; return null; } }));
afterEach(cleanup);

describe("network decision synchronization", () => {
  it("blocks actions, host controls, and rewinds until the current join is acknowledged", () => {
    const handlers = new Map<string, (...args: any[]) => void>();
    const joins: ((response: unknown) => void)[] = [];
    const socket = {
      connected: true,
      on: (event: string, handler: (...args: any[]) => void) => handlers.set(event, handler),
      off: (event: string) => handlers.delete(event),
      emit: vi.fn((event: string, _payload: unknown, ack?: (response: any) => void) => {
        if (event === "game:join" && ack) joins.push(ack);
      }),
    };
    const state = createGame({ gameId: "net", seed: 42, players: [
      { id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" },
    ] });
    const response = { state, seated: true, contentHost: true, rewind: { canReset: true, canBack: true } };
    render(<NetworkedGame socket={socket} sessionId="net" viewerId="a" onExit={() => {}} />);
    act(() => joins[0](response));
    expect(screen.props.viewer).toBe("a");
    const dispatch = screen.props.dispatch;
    const rewind = screen.props.rewind.onReset;
    act(() => { socket.connected = false; handlers.get("disconnect")!(); });
    socket.emit.mockClear();
    act(() => { dispatch({ type: "start.done", playerId: "a" }); rewind(); });
    expect(socket.emit).not.toHaveBeenCalled();
    expect(screen.props.viewer).toBe("__spectator__");
    expect(screen.props.canManageContent).toBe(false);
    expect(screen.props.rewind).toBeUndefined();
    act(() => { socket.connected = true; handlers.get("connect")!(); });
    act(() => dispatch({ type: "start.done", playerId: "a" }));
    expect(socket.emit.mock.calls.map(([event]) => event)).toEqual(["game:join"]);
    // A delayed acknowledgement from the previous connection cannot unlock input.
    act(() => joins[0](response));
    expect(screen.props.viewer).toBe("__spectator__");
    act(() => joins[1](response));
    expect(screen.props.viewer).toBe("a");
    expect(screen.props.presentationSource).toBe("reconnect");
    act(() => screen.props.dispatch({ type: "start.done", playerId: "a" }));
    expect(socket.emit).toHaveBeenLastCalledWith("game:action", {
      sessionId: "net", action: { type: "start.done", playerId: "a" },
    }, expect.any(Function));
  });
});

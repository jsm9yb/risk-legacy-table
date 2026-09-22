// @vitest-environment jsdom
import "../test-shims.ts";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { createGame } from "@risk/rules";
import type { PresentationSnapshot } from "./presentation/types.ts";
import GameScreen from "./GameScreen.tsx";

let publish: (snapshot: PresentationSnapshot) => void;
vi.mock("./GameTable.tsx", () => ({ default: (props: { onPresentationStateChange: typeof publish }) => { publish = props.onPresentationStateChange; return <div>Table</div>; } }));
afterEach(cleanup);

it("keeps the next takeover out of the way until its board animation settles", () => {
  const gs = createGame({ gameId: "presentation-order", seed: 7, players: [{ id: "p1", name: "Ada" }, { id: "p2", name: "Lin" }, { id: "p3", name: "Rex" }] });
  render(<GameScreen gs={gs} dispatch={vi.fn()} onExit={vi.fn()} error={null} />);
  const modal = screen.getByRole("dialog", { name: "Faction setup" });
  act(() => publish({ status: "presenting", queuedTransitions: 0, inputBlocked: true, canSkip: true }));
  expect(screen.queryByRole("dialog", { name: "Faction setup" })).toBeNull();
  expect(modal.isConnected).toBe(true);
  act(() => publish({ status: "idle", queuedTransitions: 0, inputBlocked: false, canSkip: false }));
  expect(screen.getByRole("dialog", { name: "Faction setup" })).toBe(modal);
});

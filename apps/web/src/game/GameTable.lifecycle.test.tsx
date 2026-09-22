// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { GameState } from "@risk/rules";
import { atExpandAttack } from "./test-fixtures.ts";
import type { PresentationSnapshot } from "./presentation/types.ts";

const mocks = vi.hoisted(() => ({mount: vi.fn(), dispose: vi.fn(), audioDispose: vi.fn(), visualCallbacks: [] as ((state: GameState) => void)[]}));
vi.mock("./presentation/PixiTableSceneAdapter.ts", () => ({PixiTableSceneAdapter: class {
  mount = mocks.mount;
  dispose = mocks.dispose;
  resize() {}
}}));
vi.mock("./presentation/PresentationDirector.ts", () => ({createPresentationDirector: (_scene: unknown, _clock: unknown, _audio: unknown, onVisual: (state: GameState) => void) => {
  mocks.visualCallbacks.push(onVisual);
  return ({
  mount() {}, setMotionPreference() {}, setInteractionState() {}, skipCurrentSequence() {},
  dispose: mocks.dispose,
  subscribe(listener: (s: PresentationSnapshot) => void) {
    listener({status: "presenting", queuedTransitions: 0, canSkip: true, inputBlocked: true});
    return () => {};
  },
}); }}));
vi.mock("./presentation/TableAudio.ts", () => ({WebAudioTableAudioAdapter: class {
  setMuted() {} setVolume() {} dispose = mocks.audioDispose;
}}));
vi.mock("./settings/PresentationSettings.tsx", () => ({default: ({onQuality}: {onQuality: (quality: string) => void}) => <button onClick={() => onQuality("low")}>Change quality</button>}));
vi.mock("./accessibility/AccessibleBoard.tsx", () => ({default: () => <div>Accessible board</div>}));
import GameTable from "./GameTable.tsx";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.visualCallbacks.length = 0;
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({matches: false}));
  vi.stubGlobal("ResizeObserver", class {observe() {} disconnect() {}});
});

it("releases gameplay blocking when a renderer remount fails during animation", async () => {
  mocks.mount.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("GPU unavailable"));
  const onState = vi.fn(), onReady = vi.fn();
  const state = atExpandAttack(917).gs;
  const view = render(<GameTable authoritativeState={state} interaction={{mode: "inspect", territories: {}, instruction: "Inspect"}} onTerritoryActivate={() => {}} onPresentationStateChange={onState} onPresentationReady={onReady} />);
  await waitFor(() => expect(onState).toHaveBeenLastCalledWith(expect.objectContaining({inputBlocked: true})));
  fireEvent.click(screen.getByText("Change quality"));
  await waitFor(() => expect(onState).toHaveBeenLastCalledWith(expect.objectContaining({status: "failed", inputBlocked: false, canSkip: false})));
  expect(onReady).toHaveBeenLastCalledWith(undefined);
  expect(screen.getByRole("alert").textContent).toContain("GPU unavailable");
  expect(mocks.audioDispose).toHaveBeenCalled();
  await act(async () => view.unmount());
});

it("uses the current visual callback and rejects callbacks from a replaced viewer", async () => {
  mocks.mount.mockResolvedValue(undefined);
  const state = atExpandAttack(918).gs;
  const first = vi.fn(), current = vi.fn();
  const props = {authoritativeState: state, interaction: {mode: "inspect" as const, territories: {}, instruction: "Inspect"}, onTerritoryActivate: () => {}};
  const view = render(<GameTable {...props} viewerId="u1" onVisualStateChange={first} />);
  await waitFor(() => expect(mocks.visualCallbacks).toHaveLength(1));
  view.rerender(<GameTable {...props} viewerId="u1" onVisualStateChange={current} />);
  act(() => mocks.visualCallbacks[0](state));
  expect(current).toHaveBeenLastCalledWith(state);
  expect(first).not.toHaveBeenCalledWith(state);
  view.rerender(<GameTable {...props} viewerId="u2" onVisualStateChange={current} />);
  await waitFor(() => expect(mocks.visualCallbacks).toHaveLength(2));
  current.mockClear();
  act(() => mocks.visualCallbacks[0](state));
  expect(current).not.toHaveBeenCalled();
  act(() => mocks.visualCallbacks[1](state));
  expect(current).toHaveBeenLastCalledWith(state);
  view.unmount();
});

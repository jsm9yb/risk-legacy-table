import { describe, expect, it, vi } from "vitest";
import { PixiTableSceneAdapter } from "./PixiTableSceneAdapter.ts";
import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { atExpandAttack } from "../test-fixtures.ts";

/** Exercise the actual renderer scheduler without creating a WebGL context. */
function harness() {
  let now = 0;
  const ticks = new Set<() => void>();
  const scene = Object.create(PixiTableSceneAdapter.prototype);
  scene.options = { clock: { now: () => now } };
  scene.app = { ticker: { add: (tick: () => void) => ticks.add(tick), remove: (tick: () => void) => ticks.delete(tick) } };
  return { scene, ticks, advance: (time: number) => { now = time; for (const tick of [...ticks]) tick(); } };
}

describe("Pixi animation lifecycle", () => {
  it("releases owned graphics contexts when replacing nested previews, preserving shared atlas textures", () => {
    const scene = Object.create(PixiTableSceneAdapter.prototype);
    scene.previewLayer = new Container();
    scene.interaction = {intents: {}};
    const group = new Container();
    const graphic = new Graphics().circle(0, 0, 5).fill(0xffffff);
    const context = graphic.context;
    const atlas = Texture.EMPTY;
    group.addChild(graphic, new Sprite(atlas)); scene.previewLayer.addChild(group);
    scene.renderPreview();
    expect(context.destroyed).toBe(true);
    expect(atlas.destroyed).toBe(false);
    expect(scene.previewLayer.children).toHaveLength(0);
  });

  it("releases every transient nuclear graphic context when the director skips", async () => {
    const {scene} = harness(); scene.effectsLayer = new Container();
    const controller = new AbortController();
    const done = scene.animateNuclear(["alaska", "alberta"], 800, controller.signal);
    const effects = scene.effectsLayer.children[0] as Container;
    const contexts = effects.children.map((child) => (child as Graphics).context);
    controller.abort(); await done;
    expect(contexts.length).toBeGreaterThan(0);
    expect(contexts.every((context) => context.destroyed)).toBe(true);
    expect(scene.effectsLayer.children).toHaveLength(0);
  });
  it("flies to exact client endpoints and removes the screen overlay on skip", async () => {
    const {scene, advance, ticks} = harness();
    const context = Object.fromEntries(["setTransform", "clearRect", "beginPath", "moveTo", "quadraticCurveTo", "stroke", "save", "translate", "rotate", "roundRect", "fill", "restore", "fillRect", "fillText"].map((name) => [name, vi.fn()]));
    context.measureText = vi.fn(() => ({width: 70}));
    const canvas = {dataset: {}, style: {}, setAttribute: vi.fn(), getContext: () => context, remove: vi.fn()};
    vi.stubGlobal("window", {innerWidth: 1000, innerHeight: 700, devicePixelRatio: 1});
    vi.stubGlobal("document", {createElement: () => canvas, body: {appendChild: vi.fn()}});
    scene.flightCanvases = new Set();
    const controller = new AbortController();
    try {
      const done = scene.animateScreenFlight({clientX: 100, clientY: 120, width: 20, height: 20}, {clientX: 850, clientY: 600, width: 30, height: 30}, "card", "DRAW", 1000, controller.signal);
      advance(800);
      expect(context.translate).toHaveBeenLastCalledWith(850, 600);
      expect(scene.flightCanvases.size).toBe(1);
      controller.abort(); await done;
      expect(canvas.remove).toHaveBeenCalledTimes(1);
      expect(scene.flightCanvases.size).toBe(0);
      expect(ticks.size).toBe(0);
    } finally { vi.unstubAllGlobals(); }
  });
  it("does not restore an older visual beat when its faction atlas loads late", async () => {
    const scene = Object.create(PixiTableSceneAdapter.prototype);
    scene.pieceTextures = new Map();
    const finishes: (() => void)[] = [];
    scene.loadFactionAtlases = () => new Promise<void>(resolve => finishes.push(resolve));
    for (const method of ["renderOwners", "renderMarks", "renderArmies", "renderPlacementOcclusion", "renderInteraction"]) scene[method] = vi.fn();
    const state = atExpandAttack(915).gs;
    const first = { state, revision: state.eventSeq };
    const second = { state: { ...state, territories: { ...state.territories } }, revision: state.eventSeq };
    scene.apply(first);
    scene.apply(second);
    expect(finishes.length).toBe(2);
    scene.renderArmies.mockClear();
    finishes[0]();
    await Promise.resolve();
    expect(scene.renderArmies).not.toHaveBeenCalled();
    finishes[1]();
    await Promise.resolve();
    expect(scene.renderArmies).toHaveBeenCalledWith(second.state);
  });
  it("does not redraw destroyed layers when an atlas finishes after disposal", async () => {
    const scene = Object.create(PixiTableSceneAdapter.prototype);
    scene.pieceTextures = new Map();
    let finish!: () => void;
    scene.loadFactionAtlases = () => new Promise<void>(resolve => { finish = resolve; });
    for (const method of ["renderOwners", "renderMarks", "renderArmies", "renderPlacementOcclusion", "renderInteraction"]) scene[method] = vi.fn();
    scene.cleanup = [];
    scene.app = {destroy: vi.fn()};
    const state = atExpandAttack(916).gs;
    scene.apply({state, revision: state.eventSeq});
    scene.renderArmies.mockClear();
    scene.renderMarks.mockClear();
    scene.dispose();
    finish();
    await Promise.resolve();
    expect(scene.current).toBeUndefined();
    expect(scene.renderArmies).not.toHaveBeenCalled();
    expect(scene.renderMarks).not.toHaveBeenCalled();
  });

  it("releases ticker and transient objects once on skip", async () => {
    const { scene, ticks, advance } = harness();
    const controller = new AbortController(), update = vi.fn(), destroy = vi.fn();
    const done = scene.animate(600, controller.signal, update, destroy);
    advance(200);
    expect(update).toHaveBeenLastCalledWith(1 / 3);
    controller.abort();
    await done;
    advance(800);
    expect(ticks.size).toBe(0);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it("holds short reduced-motion beats still for their director-owned duration", async () => {
    const { scene, ticks, advance } = harness();
    const update = vi.fn(), destroy = vi.fn();
    const done = scene.animate(120, new AbortController().signal, update, destroy);
    advance(60);
    expect(ticks.size).toBe(1);
    advance(120);
    await done;
    expect(new Set(update.mock.calls.map(([progress]) => progress))).toEqual(new Set([0.7]));
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(ticks.size).toBe(0);
  });

  it("settles instant beats without scheduling a frame", async () => {
    const { scene, ticks } = harness();
    const update = vi.fn(), destroy = vi.fn();
    await scene.animate(0, new AbortController().signal, update, destroy);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(1);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(ticks.size).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { Container, Sprite, Texture } from "pixi.js";
import { PixiTableSceneAdapter } from "./PixiTableSceneAdapter.ts";
import { atExpandAttack } from "../test-fixtures.ts";

function harness() {
  let now = 0;
  const ticks = new Set<() => void>();
  const scene = Object.create(PixiTableSceneAdapter.prototype);
  scene.options = {clock: {now: () => now}};
  scene.app = {ticker: {add: (tick: () => void) => ticks.add(tick), remove: (tick: () => void) => ticks.delete(tick)}};
  scene.current = {state: atExpandAttack(915).gs};
  scene.effectsLayer = new Container();
  scene.armyLayer = new Container();
  scene.atlasSprite = () => { const sprite = new Sprite(Texture.EMPTY); sprite.scale.set(0.15); return sprite; };
  return {scene, ticks, advance: (time: number) => { now = time; for (const tick of [...ticks]) tick(); }};
}

describe("expressive table motion", () => {
  it("staggers moving miniatures without losing their atlas scale and cleans up on skip", async () => {
    const {scene, ticks, advance} = harness();
    const controller = new AbortController();
    const done = scene.animateMove("alaska", "alberta", 8, 650, controller.signal);
    const formation = scene.effectsLayer.children.at(-1) as Container;
    expect(formation.children.length).toBeGreaterThan(1);
    advance(100);
    const pieces = formation.children;
    expect(pieces.every(piece => piece.scale.y <= 0.15)).toBe(true);
    // At the start of travel the later miniature still trails the first.
    expect(pieces[0].rotation).not.toBe(pieces[1].rotation);
    controller.abort(); await done;
    expect(scene.effectsLayer.children).toHaveLength(0);
    expect(ticks.size).toBe(0);
    expect(Texture.EMPTY.destroyed).toBe(false);
  });

  it("topples casualties individually while reduced motion retains readable upright pieces", async () => {
    for (const duration of [340, 120]) {
      const {scene, advance} = harness();
      const controller = new AbortController();
      const done = scene.animateRemoval("alaska", 8, duration, controller.signal);
      const group = scene.effectsLayer.children[0] as Container;
      advance(duration / 2);
      if (duration > 120) expect(group.children[0].rotation * group.children[1].rotation).toBeLessThan(0);
      else expect(group.children.every(piece => piece.rotation === 0)).toBe(true);
      controller.abort(); await done;
      expect(scene.effectsLayer.children).toHaveLength(0);
    }
  });

  it("releases the decision trace and its graphics contexts when the next action interrupts", async () => {
    const {scene, ticks, advance} = harness();
    const controller = new AbortController();
    const miniature = new Sprite(Texture.EMPTY); miniature.label = "army:alaska"; miniature.y = 25; miniature.rotation = 0.1; scene.armyLayer.addChild(miniature);
    const done = scene.animateDecision({type: "decision.feedback", territoryId: "alaska", targetId: "alberta"}, 900, controller.signal);
    const group = scene.effectsLayer.children[0] as Container;
    const contexts = group.children.map((child: any) => child.context);
    advance(300);
    expect(group.alpha).toBeGreaterThan(0);
    expect(miniature.y).toBeLessThan(25);
    controller.abort(); await done;
    expect(contexts.every((context: any) => context.destroyed)).toBe(true);
    expect(miniature.y).toBe(25); expect(miniature.rotation).toBe(0.1);
    expect(scene.effectsLayer.children).toHaveLength(0);
    expect(ticks.size).toBe(0);
  });
});

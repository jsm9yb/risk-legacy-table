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
  scene.marksLayer = new Container();
  scene.tableText = (options: {text: string}) => Object.assign(new Sprite(Texture.EMPTY), {text:options.text});
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

  it("reconstructs named worlds and signature tallies from state without accumulating stale inscriptions", () => {
    const {scene} = harness();
    const playerId = Object.keys(scene.current.state.players)[0];
    const state = {...scene.current.state, territories:{}, continents:{}, worldName:"The Last Republic", signatures:{[playerId]:2}};
    scene.current = {state}; scene.renderMarks(state);
    const world = scene.marksLayer.children.find((mark: Container) => mark.label === "legacy:world.name") as Container;
    const signature = scene.marksLayer.children.find((mark: Container) => mark.label === `legacy:signature:${playerId}`) as Container;
    expect((world.getChildByLabel("legacy:inscription") as any).text).toBe("The Last Republic");
    // Keep the world-name underline above Europe's permanent name/bonus box.
    expect(world.y + 17).toBeLessThan(44);
    expect((signature.getChildByLabel("legacy:inscription") as any).text).toBe(state.players[playerId].name);
    expect((signature.getChildByLabel("legacy:tally") as any).text).toBe("×2");
    expect(signature.getChildByLabel("legacy:tally")!.y).toBeLessThan(0);
    expect([signature.x,signature.y]).toEqual(scene.playerStation(playerId));
    const revised = {...state,worldName:"A New Republic",signatures:{[playerId]:3}};
    scene.current = {state:revised}; scene.renderMarks(revised);
    expect(world.destroyed).toBe(true); expect(signature.destroyed).toBe(true);
    expect(scene.marksLayer.children).toHaveLength(2);
    expect((scene.marksLayer.children[1].getChildByLabel("legacy:tally") as any).text).toBe("×3");
    scene.renderMarks({...revised,worldName:"   ",signatures:{[playerId]:0}});
    expect(scene.marksLayer.children).toHaveLength(0);
    scene.renderMarks({...revised,worldName:"An Unnamed World",signatures:{[playerId]:0}});
    expect(scene.marksLayer.children).toHaveLength(0);
  });

  it("restores prior ink when interrupted and settles new ink at the same place in reduced motion", async () => {
    const {scene,advance} = harness();
    const state = {...scene.current.state,territories:{},continents:{},worldName:"Old World",signatures:{}};
    scene.current = {state}; scene.renderMarks(state);
    const prior = scene.marksLayer.children[0] as Container;
    const controller = new AbortController();
    const done = scene.animateLegacyRitual({type:"legacy.ritual",ritual:"world.named",text:"New World"},1800,controller.signal);
    expect(prior.visible).toBe(false);
    controller.abort(); await done;
    expect(prior.visible).toBe(true); expect(scene.effectsLayer.children).toHaveLength(0);
    const reduced = scene.animateLegacyRitual({type:"legacy.ritual",ritual:"world.named",text:"New World"},120,new AbortController().signal);
    const animated = scene.effectsLayer.children[0] as Container;
    const position = [animated.x,animated.y];
    advance(120); await reduced;
    const next = {...state,worldName:"New World"}; scene.current = {state:next}; scene.renderMarks(next);
    expect([scene.marksLayer.children[0].x,scene.marksLayer.children[0].y]).toEqual(position);
    expect((scene.marksLayer.children[0].getChildByLabel("legacy:inscription") as any).text).toBe("New World");
    expect(scene.effectsLayer.children).toHaveLength(0);
  });

});

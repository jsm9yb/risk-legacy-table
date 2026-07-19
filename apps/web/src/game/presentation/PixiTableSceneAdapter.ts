import {
  Application,
  Assets,
  type CanvasTextOptions,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
  type FederatedPointerEvent,
} from "pixi.js";
import { factionDefinitionById } from "@risk/content";
import { manifest, presentationFor, territoryPath } from "@risk/map";
import type { FactionId, GameState, TerritoryId } from "@risk/rules";
import boardSvg from "../../../../../packages/map/assets/board.svg?raw";
import {
  ARCHITECTURE_ATLAS,
  type ArchitectureAtlasFrame,
  type ArchitectureAtlasKey,
} from "../../assets/table/architecture/catalog.ts";
import { FACTION_PIECE_ATLASES, type FactionPieceAtlas } from "../../assets/table/catalog.ts";
import { composeArmyStack } from "./ArmyStack.ts";
import { projectTerritoryLayers } from "./ArchitecturePresentation.ts";
import { splitBoardArtwork } from "./BoardArtwork.ts";
import { continentMarkModels } from "./ContinentMarks.ts";
import type { PresentationClock } from "./PresentationClock.ts";
import type { TableScene } from "./TableScene.ts";
import {
  MAX_TABLE_ZOOM,
  requiredFactionAtlasIds,
  tableMiniatureTextureSourceOptions,
  tableTextTextureResolution,
  territoryLabelAlpha,
} from "./TableAssetPolicy.ts";
import { scarMarkAsset } from "./ScarPresentation.ts";
import { alienIslandRouteModels } from "./AlienIslandRoutes.ts";
import {
  ARMY_PIECE_HEIGHT,
  architecturePieceHeight,
  hqPieceHeight,
  scarDisplaySlot,
  territoryDisplayLayout,
  territoryPlacementBounds,
  type LayoutBounds,
} from "./TerritoryPieceLayout.ts";
import { territoryOwnerStyle } from "./TerritoryOwnerStyle.ts";
import type {
  SceneCommand,
  TableInteractionModel,
  TableRenderModel,
  TableSceneDiagnostics,
  TableViewport,
} from "./types.ts";

const WORLD_WIDTH = 749.819;
const WORLD_HEIGHT = 519.068;
const SOURCE_OFFSET = { x: -167.99651, y: -118.55507 };
const INTENT_COLORS: Record<string, number> = {
  selected: 0xe0a93c,
  attack: 0xd34f4f,
  maneuver: 0x55a7dc,
  recruit: 0x47b998,
  start: 0x47b998,
  inspect: 0xf0ead8,
  illegal: 0x566171,
  spectator: 0xe9edf3,
};
const SCAR_VISUALS: Record<string, { color: number; glyph: string }> = {
  ammo_shortage: { color: 0x9a632b, glyph: "AM" },
  biohazard: { color: 0x718d36, glyph: "BIO" },
  bunker: { color: 0x4e6574, glyph: "BNK" },
  fallout: { color: 0xb38835, glyph: "F/O" },
  fortification: { color: 0x6c5d49, glyph: "FRT" },
  mercenary: { color: 0x7b3846, glyph: "MRC" },
  weakness: { color: 0x673d73, glyph: "WK" },
};

function scarAssetGraphic(svg: string, diameter: number) {
  const graphic = new Graphics().svg(svg);
  graphic.position.set(-diameter / 2, -diameter / 2);
  graphic.scale.set(diameter / 128);
  return graphic;
}

export interface PixiTableSceneOptions {
  clock: PresentationClock;
  onTerritoryActivate: (territoryId: TerritoryId) => void;
  onTerritoryHover?: (territoryId: TerritoryId | undefined, point?: { clientX: number; clientY: number }) => void;
  onCityHover?: (territoryId: TerritoryId | undefined, point?: { clientX: number; clientY: number }) => void;
  onContextRestored?: () => void;
  quality?: "high" | "balanced" | "low";
}

function colorNumber(value?: string) {
  return Number.parseInt((value ?? "#667080").replace("#", ""), 16);
}

function factionColor(state: GameState, territoryId: string) {
  const controller = state.territories[territoryId]?.controller;
  const factionId = controller ? state.players[controller]?.factionId : undefined;
  return colorNumber(factionId ? factionDefinitionById(factionId, state.unlockedModules)?.color : undefined);
}

function pathGraphic(territoryId: string, fill: number, alpha: number, stroke?: { color: number; width: number; alpha?: number }) {
  const path = territoryPath(territoryId);
  const graphic = new Graphics();
  if (!path) return graphic;
  const strokeAttribute = stroke ? ` stroke="#${stroke.color.toString(16).padStart(6, "0")}" stroke-width="${stroke.width}" stroke-opacity="${stroke.alpha ?? 1}"` : "";
  graphic.svg(`<svg xmlns="http://www.w3.org/2000/svg"><path d="${path.d}" fill="#${fill.toString(16).padStart(6, "0")}" fill-opacity="${alpha}"${strokeAttribute}/></svg>`);
  graphic.position.set(SOURCE_OFFSET.x, SOURCE_OFFSET.y);
  return graphic;
}

function pieceGraphic(denomination: 1 | 3, color: number, scale: number) {
  const group = new Container();
  const shadow = new Graphics().ellipse(0, 5.5, denomination === 3 ? 8 : 5.8, denomination === 3 ? 3.2 : 2.4).fill({ color: 0x020306, alpha: 0.48 });
  const piece = new Graphics();
  if (denomination === 1) {
    piece.roundRect(-4.6, -2.5, 9.2, 8.5, 2).fill({ color }).stroke({ color: 0x101318, width: 1.1 });
    piece.circle(0, -5, 3.2).fill({ color: 0xe8d9af }).stroke({ color: 0x101318, width: 1 });
    piece.moveTo(-1.5, -1).lineTo(5.8, -6).stroke({ color: 0x202733, width: 1.8 });
  } else {
    piece.poly([-7, 4, -6, -4, -2, -8, 4, -7, 7, -2, 6, 5, 0, 8]).fill({ color }).stroke({ color: 0x101318, width: 1.3 });
    piece.roundRect(-3.5, -10, 7, 5, 1.5).fill({ color: 0x2d333b }).stroke({ color: 0x101318, width: 1 });
    piece.moveTo(2, -7).lineTo(9, -9).stroke({ color: 0xd5b56b, width: 2.2 });
  }
  const highlight = new Graphics().moveTo(-3, -4).lineTo(0, -6).stroke({ color: 0xfff0be, width: 1, alpha: 0.55 });
  group.addChild(shadow, piece, highlight);
  group.scale.set(scale);
  return group;
}

export class PixiTableSceneAdapter implements TableScene {
  private readonly app = new Application();
  private readonly world = new Container();
  private readonly backdrop = new Container();
  private readonly ownerLayer = new Container();
  private readonly boundaryLayer = new Container();
  private readonly boundaryMask = new Graphics();
  private readonly labelLayer = new Container();
  private readonly marksLayer = new Container();
  private readonly armyLayer = new Container();
  private readonly interactionLayer = new Container();
  private readonly effectsLayer = new Container();
  private host?: HTMLElement;
  private current?: TableRenderModel;
  private interaction: TableInteractionModel = { intents: {} };
  private contextLosses = 0;
  private fitScale = 1;
  private textResolution = 1;
  private zoom = 1;
  private pan = { x: 0, y: 0 };
  private mounted = false;
  private boardTexture?: Texture;
  private readonly territoryLabels = new Map<string, Text>();
  private readonly pieceTextures = new Map<string, { one: Texture; three: Texture; hq: Texture }>();
  private readonly architectureTextures = new Map<ArchitectureAtlasKey, Texture>();
  private placementBounds: LayoutBounds[] = [];
  private pointerStart?: { x: number; y: number; panX: number; panY: number };
  private readonly cleanup: Array<() => void> = [];
  readonly quality: "high" | "balanced" | "low";

  constructor(private readonly options: PixiTableSceneOptions) {
    this.quality = options.quality ?? "balanced";
  }

  async mount(host: HTMLElement, initial: TableRenderModel) {
    if (this.mounted) throw new Error("Pixi table scene may only mount once");
    this.host = host;
    const resolution = this.quality === "high" ? Math.min(devicePixelRatio, 2) : this.quality === "balanced" ? Math.min(devicePixelRatio, 1.5) : 1;
    await this.app.init({
      width: Math.max(1, host.clientWidth),
      height: Math.max(1, host.clientHeight),
      backgroundAlpha: 0,
      antialias: this.quality !== "low",
      autoDensity: true,
      resolution,
      preference: "webgl",
      powerPreference: "high-performance",
    });
    this.fitScale = Math.min(host.clientWidth / WORLD_WIDTH, host.clientHeight / WORLD_HEIGHT) * 0.96;
    this.textResolution = tableTextTextureResolution(this.quality, this.app.renderer.resolution, this.fitScale);
    this.app.canvas.className = "absolute inset-0 h-full w-full";
    this.app.canvas.setAttribute("aria-label", "Risk Legacy game table");
    this.app.canvas.style.touchAction = "none";
    host.appendChild(this.app.canvas);
    this.app.stage.addChild(this.world);
    this.world.addChild(
      this.backdrop,
      this.ownerLayer,
      this.boundaryLayer,
      this.labelLayer,
      this.interactionLayer,
      this.marksLayer,
      this.armyLayer,
      this.effectsLayer,
      this.boundaryMask,
    );

    const table = new Graphics().roundRect(-12, -12, WORLD_WIDTH + 24, WORLD_HEIGHT + 24, 18).fill({ color: 0x121821 }).stroke({ color: 0x38404b, width: 2 });
    const inner = new Graphics().rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT).fill({ color: 0x080c12 });
    this.backdrop.addChild(table, inner);
    const artwork = splitBoardArtwork(boardSvg, manifest.territories.map(({ id }) => id));
    const boardUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(artwork.boardSvg)}`;
    const boardResolution = this.quality === "high" ? 4 : this.quality === "balanced" ? 3 : 2;
    this.boardTexture = await Assets.load<Texture>({ src: boardUrl, data: { width: WORLD_WIDTH, height: WORLD_HEIGHT, resolution: boardResolution } });
    const board = new Sprite(this.boardTexture);
    board.width = WORLD_WIDTH;
    board.height = WORLD_HEIGHT;
    this.backdrop.addChild(board);
    for (const territory of manifest.territories) {
      this.boundaryLayer.addChild(pathGraphic(territory.id, 0xffffff, 0, {
        color: 0xf2ecd9,
        width: 0.86,
        alpha: 1,
      }));
    }
    this.boundaryLayer.mask = this.boundaryMask;
    for (const definition of artwork.labels) {
      const label = this.tableText({
        text: definition.text,
        style: {
          fill: 0xfff1cf,
          fontFamily: '"Arial Narrow", "Roboto Condensed", "Segoe UI", sans-serif',
          fontSize: definition.fontSize,
          fontWeight: "900",
          lineHeight: definition.lineHeight,
          align: "center",
          stroke: { color: 0x07131a, width: 1.6 },
        },
      });
      label.anchor.set(0.5);
      label.position.set(definition.x, definition.centerY);
      label.label = definition.territoryId;
      this.territoryLabels.set(definition.territoryId, label);
      this.labelLayer.addChild(label);
    }
    await Promise.all([this.loadArchitectureAtlas(), this.loadFactionAtlases(initial.state)]);

    this.installInput();
    const gl = this.app.canvas;
    const onLost = (event: Event) => {
      event.preventDefault();
      this.contextLosses++;
    };
    const onRestored = () => {
      if (this.current) this.apply(this.current);
      this.options.onContextRestored?.();
    };
    gl.addEventListener("webglcontextlost", onLost);
    gl.addEventListener("webglcontextrestored", onRestored);
    this.cleanup.push(() => gl.removeEventListener("webglcontextlost", onLost), () => gl.removeEventListener("webglcontextrestored", onRestored));
    this.mounted = true;
    this.resize({ width: host.clientWidth, height: host.clientHeight, devicePixelRatio: resolution });
    this.apply(initial);
    (globalThis as any).__riskTableDiagnostics = {
      benchmarkFrames: (count: number) => this.benchmarkFrames(count),
      capture: () => this.captureDiagnostics(),
      territoryClientPoint: (territoryId: string) => {
        const point = this.world.toGlobal({ x: presentationFor(territoryId).cameraFocus[0], y: presentationFor(territoryId).cameraFocus[1] });
        const rect = this.app.canvas.getBoundingClientRect();
        return { x: rect.left + point.x, y: rect.top + point.y };
      },
      cityClientPoint: (territoryId: string) => {
        const [x, y] = presentationFor(territoryId).architectureSlot;
        const point = this.world.toGlobal({ x, y });
        const rect = this.app.canvas.getBoundingClientRect();
        return { x: rect.left + point.x, y: rect.top + point.y };
      },
    };
  }

  private benchmarkFrames(count: number) {
    const durations: number[] = [];
    this.app.ticker.stop();
    for (let index = 0; index < count; index++) {
      const start = performance.now();
      this.app.renderer.render(this.app.stage);
      durations.push(performance.now() - start);
    }
    this.app.ticker.start();
    const sorted = [...durations].sort((a, b) => a - b);
    return {
      median: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      max: sorted.at(-1) ?? 0,
      frames: count,
    };
  }

  private tableText(options: CanvasTextOptions) {
    return new Text({ ...options, resolution: this.textResolution, roundPixels: true });
  }

  private async loadFactionAtlases(state: GameState) {
    const factionIds = requiredFactionAtlasIds(state, new Set(Object.keys(FACTION_PIECE_ATLASES)));
    await Promise.all(factionIds.map(async (factionId) => {
      const atlas = FACTION_PIECE_ATLASES[factionId];
      if (!atlas || this.pieceTextures.has(factionId)) return;
      const texture = await Assets.load<Texture>({
        src: atlas.src,
        data: tableMiniatureTextureSourceOptions(),
      });
      this.pieceTextures.set(factionId, {
        one: this.frameTexture(texture, atlas.one),
        three: this.frameTexture(texture, atlas.three),
        hq: this.frameTexture(texture, atlas.hq),
      });
    }));
  }

  private async loadArchitectureAtlas() {
    if (this.architectureTextures.size) return;
    const texture = await Assets.load<Texture>(ARCHITECTURE_ATLAS.src);
    for (const [key, frame] of Object.entries(ARCHITECTURE_ATLAS.frames) as Array<[ArchitectureAtlasKey, ArchitectureAtlasFrame]>) {
      this.architectureTextures.set(key, this.frameTexture(texture, frame));
    }
  }

  private frameTexture(texture: Texture, frame: FactionPieceAtlas["one"] | ArchitectureAtlasFrame) {
    return new Texture({ source: texture.source, frame: new Rectangle(frame.x, frame.y, frame.width, frame.height) });
  }

  private atlasSprite(factionId: string | undefined, kind: "one" | "three" | "hq", height: number) {
    const texture = factionId ? this.pieceTextures.get(factionId)?.[kind] : undefined;
    if (!texture) return undefined;
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 1);
    sprite.height = height;
    sprite.scale.x = sprite.scale.y;
    return sprite;
  }

  private architectureSprite(key: ArchitectureAtlasKey, profile: "tiny" | "normal" | "wide") {
    const texture = this.architectureTextures.get(key);
    if (!texture) throw new Error(`Missing architecture texture: ${key}`);
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.height = architecturePieceHeight(profile);
    sprite.scale.x = sprite.scale.y;
    sprite.label = key;
    return sprite;
  }

  private cityPopulationBadge(population: number, profile: "tiny" | "normal" | "wide") {
    const scale = profile === "tiny" ? 0.86 : profile === "wide" ? 1.08 : 1;
    const badge = new Container();
    const plate = new Graphics()
      .roundRect(-5.7, -4.7, 11.4, 9.4, 2.2)
      .fill({ color: 0x0b3047, alpha: 0.98 })
      .stroke({ color: 0xdff5fb, width: 0.8, alpha: 0.95 });
    const label = this.tableText({
      text: "POP",
      style: { fill: 0x8ed7ed, fontFamily: "monospace", fontSize: 2.6, fontWeight: "900", letterSpacing: 0.25 },
    });
    label.anchor.set(0.5);
    label.position.set(0, -2.3);
    const value = this.tableText({
      text: `+${population}`,
      style: { fill: 0xffffff, fontFamily: "monospace", fontSize: 5.5, fontWeight: "900" },
    });
    value.anchor.set(0.5);
    value.position.set(0, 1.2);
    badge.addChild(plate, label, value);
    badge.scale.set(scale);
    badge.label = `population:+${population}`;
    return badge;
  }

  private cityNameplate(name: string | undefined, profile: "tiny" | "normal" | "wide") {
    const size = architecturePieceHeight(profile);
    const nameplate = new Container();
    const width = size * 0.72;
    const height = size * 0.22;
    const paper = new Graphics()
      .roundRect(-width / 2, -height / 2, width, height, height * 0.16)
      .fill({ color: 0xf4ecd6, alpha: 0.98 })
      .stroke({ color: 0x123754, width: 0.55, alpha: 0.95 });
    nameplate.addChild(paper);
    if (name) {
      const label = this.tableText({
        text: name.toUpperCase(),
        style: {
          fill: 0x102c43,
          fontFamily: '"Segoe Print", "Bradley Hand", cursive',
          fontSize: 3.1,
          fontWeight: "800",
          letterSpacing: 0.08,
        },
      });
      label.anchor.set(0.5);
      if (label.width > width - 1.2) label.scale.set((width - 1.2) / label.width);
      nameplate.addChild(label);
    }
    nameplate.label = name ? `city-name:${name}` : "city-name:blank";
    return nameplate;
  }

  apply(model: TableRenderModel) {
    this.current = model;
    this.renderOwners(model.state);
    this.renderMarks(model.state);
    this.renderArmies(model.state);
    this.renderPlacementOcclusion(model.state);
    this.renderInteraction();
    const missing = requiredFactionAtlasIds(model.state, new Set(Object.keys(FACTION_PIECE_ATLASES)))
      .some((factionId) => !this.pieceTextures.has(factionId));
    if (missing) void this.loadFactionAtlases(model.state).then(() => {
      if (this.current?.revision === model.revision) {
        this.renderMarks(model.state);
        this.renderArmies(model.state);
        this.renderPlacementOcclusion(model.state);
      }
    });
  }

  private renderOwners(state: GameState) {
    this.ownerLayer.removeChildren().forEach((child) => child.destroy());
    for (const territory of manifest.territories) {
      const territoryState = state.territories[territory.id];
      if (!territoryState?.controller) continue;
      const style = territoryOwnerStyle(factionColor(state, territory.id));
      this.ownerLayer.addChild(pathGraphic(territory.id, style.fill, style.fillAlpha, style.stroke));
    }
  }

  private renderArmies(state: GameState) {
    this.armyLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    for (const [territoryId, territory] of Object.entries(state.territories)) {
      if (territory.troops <= 0 && !territory.hqFaction) continue;
      const definition = presentationFor(territoryId);
      const layout = territoryDisplayLayout(definition, {
        army: territory.troops > 0,
        hq: !!territory.hqFaction,
        scars: territory.scars.length > 0,
        city: !!territory.city || !!territory.ruin,
        fortification: !!territory.fortification,
      });
      if (territory.troops > 0) {
        const factionId = territory.controller ? state.players[territory.controller]?.factionId : undefined;
        const color = colorNumber(factionId ? factionDefinitionById(factionId, state.unlockedModules)?.color : undefined);
        const stack = composeArmyStack(territory.troops, `${state.gameId}:${territoryId}`);
        stack.pieces.forEach((piece) => {
          const slot = layout.pieceSlots[piece.slot];
          const graphic = this.atlasSprite(factionId, piece.denomination === 3 ? "three" : "one", ARMY_PIECE_HEIGHT[piece.denomination] * slot[2])
            ?? pieceGraphic(piece.denomination, color, slot[2]);
          graphic.position.set(slot[0], slot[1]);
          graphic.rotation = piece.yaw * 0.06;
          graphic.zIndex = slot[1] * 10 + piece.denomination;
          this.armyLayer.addChild(graphic);
        });
      }
      if (territory.hqFaction) {
        const hq = this.hqMark(territory.hqFaction, layout.hqSlot, layout.profile);
        hq.zIndex = layout.hqSlot[1] * 10 + 4;
        this.armyLayer.addChild(hq);
      }
    }
    this.armyLayer.sortableChildren = true;
    this.armyLayer.sortChildren();
  }

  private renderPlacementOcclusion(state: GameState) {
    const placementBounds: LayoutBounds[] = [];
    for (const territoryDefinition of manifest.territories) {
      const territoryId = territoryDefinition.id;
      const territory = state.territories[territoryId];
      if (!territory) continue;
      const definition = presentationFor(territoryId);
      const projected = projectTerritoryLayers(territory);
      const pieces = territory.troops > 0
        ? composeArmyStack(territory.troops, `${state.gameId}:${territoryId}`).pieces
        : [];
      placementBounds.push(...territoryPlacementBounds(definition, {
        army: territory.troops > 0,
        hq: !!territory.hqFaction,
        scars: !!projected.scarId,
        city: !!projected.architecture,
        fortification: !!territory.fortification,
      }, pieces));
    }
    this.placementBounds = placementBounds;

    this.boundaryMask.clear().rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT).fill({ color: 0xffffff });
    for (const bounds of placementBounds) {
      const padding = bounds.kind === "scars" ? 1.25 : 1.5;
      this.boundaryMask
        .roundRect(
          bounds.left - padding,
          bounds.top - padding,
          bounds.right - bounds.left + padding * 2,
          bounds.bottom - bounds.top + padding * 2,
          2.5,
        )
        .cut();
    }

    for (const label of this.territoryLabels.values()) label.alpha = territoryLabelAlpha();
  }

  private renderMarks(state: GameState) {
    this.marksLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    for (const model of continentMarkModels(state)) {
      if (model.name) {
        const name = this.tableText({
          text: model.name.toUpperCase(),
          style: {
            fill: 0xfff3ce,
            fontFamily: '"Segoe Print", "Bradley Hand", cursive',
            fontSize: 6.2,
            fontWeight: "700",
            letterSpacing: 0.25,
            stroke: { color: 0x14202a, width: 1.6 },
          },
        });
        name.anchor.set(0.5);
        name.position.set(...model.nameSlot);
        if (name.width > 66) name.scale.set(66 / name.width);
        name.rotation = -0.018;
        this.marksLayer.addChild(name);
      }
      if (model.bonusMark !== undefined) {
        const sticker = new Container();
        const paper = new Graphics().roundRect(-7.5, -5.5, 15, 11, 2).fill({ color: 0xf1dfb8 }).stroke({ color: 0x6a302d, width: 1.1 });
        const value = this.tableText({
          text: model.bonusMark > 0 ? "+1" : "−1",
          style: { fill: 0x421e1c, fontFamily: "monospace", fontSize: 7.5, fontWeight: "900" },
        });
        value.anchor.set(0.5);
        sticker.addChild(paper, value);
        sticker.position.set(model.bonusSlot[0] + 9, model.bonusSlot[1] + 8);
        sticker.rotation = model.bonusMark > 0 ? 0.08 : -0.08;
        this.marksLayer.addChild(sticker);
      }
    }
    if (state.alienIsland) {
      const definition = presentationFor(state.alienIsland.territoryId);
      const routes = new Graphics();
      for (const route of alienIslandRouteModels(state.alienIsland.connections)) {
        routes.moveTo(...route.start).quadraticCurveTo(...route.control, ...route.end);
      }
      routes.stroke({ color: 0x75d6d7, width: 1.8, alpha: 0.72 });
      const island = new Container();
      const land = new Graphics().poly([-25, 8, -20, -12, -8, -20, 3, -14, 13, -20, 25, -5, 18, 13, 4, 19, -11, 15])
        .fill({ color: 0x467d7a }).stroke({ color: 0xb9f0df, width: 2 });
      const inner = new Graphics().poly([-15, 5, -11, -8, -2, -12, 7, -8, 14, 2, 8, 10, -5, 12])
        .fill({ color: 0x91b467, alpha: 0.9 });
      const label = this.tableText({ text: state.alienIsland.name.toUpperCase(), style: { fill: 0xe7f7e9, fontFamily: "monospace", fontSize: 5, fontWeight: "800", stroke: { color: 0x102a2d, width: 1.5 } } });
      label.anchor.set(0.5);
      label.position.set(0, 2);
      island.addChild(land, inner, label);
      island.position.set(...definition.cameraFocus);
      this.marksLayer.addChild(routes, island);
    }
    for (const [territoryId, territory] of Object.entries(state.territories)) {
      const definition = presentationFor(territoryId);
      const projected = projectTerritoryLayers(territory);
      const layout = territoryDisplayLayout(definition, {
        army: territory.troops > 0,
        hq: !!territory.hqFaction,
        scars: !!projected.scarId,
        city: !!projected.architecture,
        fortification: !!territory.fortification,
      });
      if (projected.architecture) {
        const architecture = this.architectureSprite(projected.architecture.assetKey, layout.profile);
        architecture.position.set(...layout.architectureSlot);
        this.marksLayer.addChild(architecture);
        if (projected.architecture.kind === "city" && territory.city) {
          const size = architecturePieceHeight(layout.profile);
          const nameplate = this.cityNameplate(territory.city.name, layout.profile);
          nameplate.position.set(layout.architectureSlot[0], layout.architectureSlot[1] + size * 0.23);
          const badge = this.cityPopulationBadge(territory.city.population, layout.profile);
          badge.position.set(layout.architectureSlot[0] - size * 0.55, layout.architectureSlot[1] + size * 0.2);
          this.marksLayer.addChild(nameplate, badge);
        }
      }
      if (projected.scarId) {
        const scarId = projected.scarId;
        const scar = new Container();
        const asset = scarMarkAsset(scarId);
        if (asset) {
          scar.addChild(scarAssetGraphic(asset, 10));
        } else {
          const visual = SCAR_VISUALS[scarId] ?? { color: 0x622928, glyph: "!" };
          const chip = new Graphics().circle(0, 0, 5).fill({ color: visual.color }).stroke({ color: 0xf0d5ae, width: 0.9 });
          const glyph = this.tableText({ text: visual.glyph, style: { fill: 0xffedca, fontFamily: "monospace", fontSize: visual.glyph.length > 2 ? 3 : 4, fontWeight: "900" } });
          glyph.anchor.set(0.5);
          scar.addChild(chip, glyph);
        }
        scar.rotation = (territoryId.length % 24 - 12) * Math.PI / 180;
        scar.position.set(...scarDisplaySlot(layout));
        scar.label = scarId;
        this.marksLayer.addChild(scar);
      }
    }
  }

  private hqMark(factionId: FactionId, [x, y]: [number, number], profile: "tiny" | "normal" | "wide") {
    const height = hqPieceHeight(profile);
    const atlas = this.atlasSprite(factionId, "hq", height);
    if (atlas) {
      atlas.position.set(x, y);
      atlas.label = `hq:${factionId}`;
      return atlas;
    }
    const color = colorNumber(factionDefinitionById(factionId, this.current?.state.unlockedModules ?? [])?.color);
    const hq = new Container();
    const base = new Graphics().poly([-7, 5, -6, -4, 0, -9, 6, -4, 7, 5, 0, 9]).fill({ color }).stroke({ color: 0xf4d889, width: 1.3 });
    const glyph = this.tableText({ text: "HQ", style: { fill: 0x0a0d12, fontFamily: "monospace", fontSize: 5.5, fontWeight: "900" } });
    glyph.anchor.set(0.5);
    hq.addChild(base, glyph);
    hq.position.set(x, y);
    hq.scale.set(height / 18);
    hq.label = `hq-fallback:${factionId}`;
    return hq;
  }

  setInteraction(model: TableInteractionModel) {
    this.interaction = model;
    this.renderInteraction();
  }

  private resourceValueBadge(territoryId: string, value: number) {
    const definition = presentationFor(territoryId);
    const diameter = definition.profile === "tiny" ? 9 : definition.profile === "wide" ? 12 : 10.5;
    const badge = new Container();
    const shadow = new Graphics().circle(0.8, 1.1, diameter * 0.54).fill({ color: 0x020304, alpha: 0.55 });
    const coin = new Graphics()
      .circle(0, 0, diameter * 0.52)
      .fill({ color: 0xe0b73b, alpha: 0.98 })
      .stroke({ color: 0xffefad, width: 1.15, alpha: 1 })
      .circle(0, 0, diameter * 0.37)
      .stroke({ color: 0x7b431f, width: 0.75, alpha: 0.72 });
    const label = this.tableText({
      text: String(value),
      style: {
        fill: 0x2b1b08,
        fontFamily: "monospace",
        fontSize: diameter * 0.62,
        fontWeight: "900",
        stroke: { color: 0xffe893, width: 0.45 },
      },
    });
    label.anchor.set(0.5);
    badge.addChild(shadow, coin, label);
    badge.position.set(...definition.cameraFocus);
    badge.label = `resource-value:${territoryId}:${value}`;
    return badge;
  }

  private renderInteraction() {
    this.interactionLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    const resourceView = !!this.interaction.resourceValues;
    this.ownerLayer.visible = !resourceView;
    this.marksLayer.visible = !resourceView;
    this.armyLayer.visible = !resourceView;
    this.effectsLayer.visible = !resourceView;
    for (const label of this.territoryLabels.values()) label.alpha = resourceView ? 0.88 : territoryLabelAlpha();

    if (this.interaction.resourceValues) {
      for (const territory of manifest.territories) {
        const value = this.interaction.resourceValues[territory.id];
        if (value === undefined) continue;
        this.interactionLayer.addChild(
          pathGraphic(territory.id, 0x07101a, 0.32, { color: 0xb99135, width: 0.8, alpha: 0.72 }),
          this.resourceValueBadge(territory.id, value),
        );
      }
      const islandValue = this.interaction.resourceValues.alien_island;
      if (islandValue !== undefined && this.current?.state.alienIsland) {
        const definition = presentationFor(this.current.state.alienIsland.territoryId);
        const island = new Container();
        island.addChild(
          new Graphics().circle(0, 0, 25).fill({ color: 0x17383b, alpha: 0.95 }).stroke({ color: 0x75d6d7, width: 1.5 }),
        );
        island.position.set(...definition.cameraFocus);
        island.label = "resource-island";
        this.interactionLayer.addChild(island, this.resourceValueBadge("alien_island", islandValue));
      }
    }
    for (const territory of manifest.territories) {
      const intent = this.interaction.intents[territory.id];
      const selected = this.interaction.selectedTerritoryId === territory.id;
      const emphasized = this.interaction.emphasizedTerritoryId === territory.id;
      const color = emphasized ? 0xffd75e : INTENT_COLORS[selected ? "selected" : intent] ?? INTENT_COLORS.inspect;
      const visible = emphasized || (!resourceView && (selected || !!intent));
      const graphic = pathGraphic(territory.id, color, emphasized ? 0.2 : visible ? 0.08 : 0.001,
        visible ? { color, width: emphasized ? 3.4 : selected ? 2.8 : 1.8, alpha: 0.98 } : undefined);
      graphic.eventMode = "static";
      graphic.cursor = resourceView ? "help" : "pointer";
      graphic.label = territory.name;
      if (!resourceView) graphic.on("pointertap", () => this.options.onTerritoryActivate(territory.id));
      graphic.on("pointerover", (event: FederatedPointerEvent) => {
        graphic.alpha = 1;
        if (!resourceView) this.options.onTerritoryHover?.(territory.id, { clientX: event.clientX, clientY: event.clientY });
      });
      graphic.on("pointerout", () => {
        graphic.alpha = visible ? 1 : 0.8;
        if (!resourceView) this.options.onTerritoryHover?.(undefined);
      });
      this.interactionLayer.addChild(graphic);
    }
    for (const [territoryId, territory] of resourceView ? [] : Object.entries(this.current?.state.territories ?? {})) {
      if (!territory.city || projectTerritoryLayers(territory).architecture?.kind !== "city") continue;
      const definition = presentationFor(territoryId);
      const size = architecturePieceHeight(definition.profile);
      const graphic = new Graphics()
        .circle(0, 0, size * 0.5)
        .roundRect(-size * 0.93, -size * 0.08, size * 0.65, size * 0.55, size * 0.18)
        .fill({ color: 0x8ed7ed, alpha: 0.001 });
      graphic.position.set(...definition.architectureSlot);
      graphic.eventMode = "static";
      graphic.cursor = "help";
      graphic.label = `${territory.city.type} city, population ${territory.city.population}`;
      graphic.on("pointertap", () => this.options.onTerritoryActivate(territoryId));
      graphic.on("pointerover", (event: FederatedPointerEvent) => this.options.onCityHover?.(territoryId, { clientX: event.clientX, clientY: event.clientY }));
      graphic.on("pointermove", (event: FederatedPointerEvent) => this.options.onCityHover?.(territoryId, { clientX: event.clientX, clientY: event.clientY }));
      graphic.on("pointerout", () => this.options.onCityHover?.(undefined));
      this.interactionLayer.addChild(graphic);
    }
    if (this.current?.state.alienIsland) {
      const territoryId = this.current.state.alienIsland.territoryId;
      const definition = presentationFor(territoryId);
      const emphasized = this.interaction.emphasizedTerritoryId === territoryId;
      const graphic = new Graphics().circle(0, 0, 27)
        .fill({ color: emphasized ? 0xffd75e : 0x75d6d7, alpha: emphasized ? 0.2 : 0.001 });
      if (emphasized) graphic.stroke({ color: 0xffd75e, width: 3.4, alpha: 0.98 });
      graphic.position.set(...definition.cameraFocus);
      graphic.eventMode = "static";
      graphic.cursor = resourceView ? "help" : "pointer";
      graphic.label = this.current.state.alienIsland.name;
      if (!resourceView) graphic.on("pointertap", () => this.options.onTerritoryActivate(territoryId));
      graphic.on("pointerover", (event: FederatedPointerEvent) => {
        if (!resourceView) this.options.onTerritoryHover?.(territoryId, { clientX: event.clientX, clientY: event.clientY });
      });
      graphic.on("pointerout", () => { if (!resourceView) this.options.onTerritoryHover?.(undefined); });
      this.interactionLayer.addChild(graphic);
    }
  }

  async execute(command: SceneCommand, signal: AbortSignal, durationMs: number) {
    if (!this.current || signal.aborted) return;
    if ((globalThis as any).__riskTableDiagnostics) (globalThis as any).__riskTableDiagnostics.lastCommand = { ...command, durationMs };
    switch (command.type) {
      case "camera.frame": return this.animateCamera(command.from, command.to, durationMs, signal);
      case "army.place": return this.animatePlacement(command.territoryId, command.playerId, durationMs, signal);
      case "army.move": return this.animateMove(command.from, command.to, command.count, durationMs, signal);
      case "army.remove": return this.animateRemoval(command.territoryId, command.count, durationMs, signal);
      case "battle.impact": return this.animateImpact(command.from, command.to, durationMs, signal);
      case "battle.dice": return this.animatePulse(command.to, 0xe8d084, durationMs, signal);
      case "territory.conquest": return this.animatePulse(command.territoryId, factionColor(this.current.state, command.territoryId), durationMs, signal);
      case "scar.apply": return this.animateScar(command.territoryId, command.scarId, durationMs, signal);
      case "city.place": return this.animatePulse(command.territoryId, 0xe8d084, durationMs, signal);
      case "city.fortify": return this.animatePulse(command.territoryId, 0xd8c074, durationMs, signal);
      case "hq.move": return this.animateMove(command.from, command.to, 1, durationMs, signal, 0xe0a93c);
      case "redStar.gain": return command.territoryId ? this.animatePulse(command.territoryId, 0xe0a93c, durationMs, signal) : this.options.clock.wait(durationMs, signal);
      case "missile.commit": return this.animateMove(command.from, command.to, 1, durationMs, signal, 0xf0c15b);
      case "module.reveal": return this.animateModuleReveal(command.moduleId, durationMs, signal);
      case "nuclear.resolve": return this.animateNuclear(command.territories, durationMs, signal);
      case "alienIsland.place": return this.animatePulse(command.territoryId, 0x6dced1, durationMs, signal);
      case "phase.change": return this.options.clock.wait(durationMs, signal);
      case "game.victory": return this.animateVictory(command.playerId, command.reason, durationMs, signal);
      case "legacy.ritual": return this.animateLegacyRitual(command.ritual, command.territoryId, durationMs, signal);
      case "table.resync": return this.animateCurtain(0x91a4bb, durationMs, signal);
      case "army.anticipate": return this.animatePulse(command.territoryId, 0xe0a93c, durationMs, signal);
    }
  }

  private animate(durationMs: number, signal: AbortSignal, update: (progress: number) => void, done?: () => void) {
    if (durationMs <= 0 || signal.aborted) { update(1); done?.(); return Promise.resolve(); }
    return new Promise<void>((resolve) => {
      const start = this.options.clock.now();
      const finish = () => { this.app.ticker.remove(tick); done?.(); resolve(); };
      const tick = () => {
        const progress = Math.min(1, (this.options.clock.now() - start) / durationMs);
        update(progress);
        if (progress >= 1 || signal.aborted) finish();
      };
      signal.addEventListener("abort", finish, { once: true });
      this.app.ticker.add(tick);
      tick();
    });
  }

  private animateCamera(from: string | undefined, to: string | undefined, durationMs: number, signal: AbortSignal) {
    const points = [from, to].filter(Boolean).map((id) => presentationFor(id!).cameraFocus);
    if (!points.length) return this.options.clock.wait(durationMs, signal);
    const targetX = points.reduce((sum, point) => sum + point[0], 0) / points.length;
    const targetY = points.reduce((sum, point) => sum + point[1], 0) / points.length;
    const startPan = { ...this.pan };
    const targetPan = { x: WORLD_WIDTH / 2 - targetX, y: WORLD_HEIGHT / 2 - targetY };
    const startZoom = this.zoom;
    return this.animate(durationMs, signal, (p) => {
      const eased = 1 - Math.pow(1 - p, 3);
      this.pan.x = startPan.x + (targetPan.x - startPan.x) * eased;
      this.pan.y = startPan.y + (targetPan.y - startPan.y) * eased;
      this.zoom = startZoom + (1.18 - startZoom) * eased;
      this.applyCamera();
    });
  }

  private animatePlacement(territoryId: string, playerId: string, durationMs: number, signal: AbortSignal) {
    const territory = this.current!.state.territories[territoryId];
    const definition = presentationFor(territoryId);
    const layout = territoryDisplayLayout(definition, {
      army: true,
      hq: !!territory?.hqFaction,
      scars: (territory?.scars.length ?? 0) > 0,
      city: !!territory?.city || !!territory?.ruin,
      fortification: !!territory?.fortification,
    });
    const [x, y] = layout.pieceSlots[0];
    const factionId = this.current!.state.players[playerId]?.factionId;
    const token = this.atlasSprite(factionId, "one", 25) ?? pieceGraphic(1, factionColor(this.current!.state, territoryId), 1);
    token.position.set(x, y - 28);
    this.effectsLayer.addChild(token);
    return this.animate(durationMs, signal, (p) => {
      const bounce = 1 - Math.pow(1 - p, 3);
      token.y = y - 28 * (1 - bounce);
      token.scale.set(0.7 + 0.3 * bounce, 0.7 + 0.3 * bounce);
    }, () => token.destroy({ children: true }));
  }

  private animateMove(from: string, to: string, count: number, durationMs: number, signal: AbortSignal, overrideColor?: number) {
    const start = presentationFor(from).cameraFocus;
    const end = presentationFor(to).cameraFocus;
    const group = new Container();
    const controller = this.current!.state.territories[from]?.controller;
    const factionId = controller ? this.current!.state.players[controller]?.factionId : undefined;
    for (let i = 0; i < Math.min(5, Math.max(1, count)); i++) {
      const denomination = i % 3 === 0 ? 3 : 1;
      const token = overrideColor === undefined
        ? (this.atlasSprite(factionId, denomination === 3 ? "three" : "one", denomination === 3 ? 25 : 20)
          ?? pieceGraphic(denomination, factionColor(this.current!.state, from), 0.72))
        : pieceGraphic(denomination, overrideColor, 0.72);
      token.position.set((i - 2) * 3, (i % 2) * 2);
      group.addChild(token);
    }
    group.position.set(...start);
    this.effectsLayer.addChild(group);
    return this.animate(durationMs, signal, (p) => {
      const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      group.x = start[0] + (end[0] - start[0]) * eased;
      group.y = start[1] + (end[1] - start[1]) * eased - Math.sin(Math.PI * p) * 10;
      group.rotation = Math.sin(Math.PI * p) * 0.08;
    }, () => group.destroy({ children: true }));
  }

  private animateRemoval(territoryId: string, count: number, durationMs: number, signal: AbortSignal) {
    const point = presentationFor(territoryId).cameraFocus;
    const group = new Container();
    for (let i = 0; i < Math.min(5, Math.max(1, count)); i++) {
      const shard = new Graphics().poly([0, -4, 3, 3, -3, 2]).fill({ color: 0xe9d4b3 }).stroke({ color: 0x3a2422, width: 0.7 });
      shard.position.set((i - 2) * 3, (i % 2) * 2);
      group.addChild(shard);
    }
    group.position.set(...point);
    this.effectsLayer.addChild(group);
    return this.animate(durationMs, signal, (p) => {
      group.y = point[1] - p * 12;
      group.alpha = 1 - p;
      group.rotation = p * 0.35;
    }, () => group.destroy({ children: true }));
  }

  private animateImpact(from: string, to: string, durationMs: number, signal: AbortSignal) {
    const start = presentationFor(from).cameraFocus;
    const end = presentationFor(to).cameraFocus;
    const flash = new Graphics().moveTo(...start).lineTo(...end).stroke({ color: 0xf6df9a, width: 3, alpha: 0.9 });
    const ring = new Graphics().circle(0, 0, 7).stroke({ color: 0xf0b058, width: 2.5 });
    ring.position.set(...end);
    this.effectsLayer.addChild(flash, ring);
    return this.animate(durationMs, signal, (p) => {
      flash.alpha = 1 - p;
      ring.scale.set(0.6 + p * 2.3);
      ring.alpha = 1 - p;
    }, () => { flash.destroy(); ring.destroy(); });
  }

  private animatePulse(territoryId: string, color: number, durationMs: number, signal: AbortSignal) {
    const definition = presentationFor(territoryId);
    const ring = new Graphics().circle(0, 0, 12).stroke({ color, width: 2.5, alpha: 0.9 });
    ring.position.set(...definition.cameraFocus);
    this.effectsLayer.addChild(ring);
    return this.animate(durationMs, signal, (p) => {
      ring.scale.set(0.7 + p * 1.6);
      ring.alpha = Math.sin(Math.PI * p);
    }, () => ring.destroy());
  }

  private animateScar(territoryId: string, scarId: string, durationMs: number, signal: AbortSignal) {
    const definition = presentationFor(territoryId);
    const point = scarId === "fallout" ? definition.architectureSlot : scarDisplaySlot(definition);
    const sticker = new Container();
    if (scarId === "fallout") {
      sticker.addChild(this.architectureSprite("fallout", definition.profile));
    } else {
      const asset = scarMarkAsset(scarId);
      if (asset) {
        sticker.addChild(scarAssetGraphic(asset, 16));
      } else {
        const visual = SCAR_VISUALS[scarId] ?? { color: 0x8a3936, glyph: "!" };
        const chip = new Graphics().circle(0, 0, 8).fill({ color: visual.color }).stroke({ color: 0xffe1af, width: 1.2 });
        const glyph = this.tableText({ text: visual.glyph, style: { fill: 0xffedca, fontFamily: "monospace", fontSize: 5, fontWeight: "900" } });
        glyph.anchor.set(0.5);
        sticker.addChild(chip, glyph);
      }
    }
    sticker.position.set(point[0], point[1] - 34);
    this.effectsLayer.addChild(sticker);
    return this.animate(durationMs, signal, (p) => {
      const settle = 1 - Math.pow(1 - p, 3);
      sticker.y = point[1] - 34 * (1 - settle);
      sticker.rotation = (1 - settle) * -0.28;
      sticker.scale.set(0.85 + Math.sin(Math.min(1, p * 2) * Math.PI) * 0.18);
    }, () => sticker.destroy({ children: true }));
  }

  private animateModuleReveal(moduleId: string, durationMs: number, signal: AbortSignal) {
    const group = new Container();
    const veil = new Graphics().rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT).fill({ color: 0x05070a, alpha: 0.72 });
    const envelope = new Container();
    const paper = new Graphics().roundRect(-92, -48, 184, 96, 4).fill({ color: 0xd6c29a }).stroke({ color: 0xf0ddad, width: 2 });
    const flap = new Graphics().poly([-88, -43, 0, 16, 88, -43]).fill({ color: 0xbda77e }).stroke({ color: 0x8c7654, width: 1.2 });
    const seal = new Graphics().circle(0, 10, 13).fill({ color: 0x872e2c }).stroke({ color: 0xe1a55d, width: 1.5 });
    const title = this.tableText({ text: "DO NOT OPEN...YET", style: { fill: 0x241d17, fontFamily: "monospace", fontSize: 12, fontWeight: "900", letterSpacing: 2 } });
    title.anchor.set(0.5);
    title.position.set(0, -18);
    const subtitle = this.tableText({ text: moduleId.replace(/_/g, " ").toUpperCase(), style: { fill: 0x5f4a32, fontFamily: "monospace", fontSize: 7, fontWeight: "700", letterSpacing: 1 } });
    subtitle.anchor.set(0.5);
    subtitle.position.set(0, 34);
    envelope.addChild(paper, flap, seal, title, subtitle);
    envelope.position.set(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
    group.addChild(veil, envelope);
    this.effectsLayer.addChild(group);
    return this.animate(durationMs, signal, (p) => {
      const reveal = 1 - Math.pow(1 - Math.min(1, p * 2.2), 3);
      group.alpha = Math.min(1, p * 5) * Math.min(1, (1 - p) * 5);
      envelope.scale.set(0.74 + reveal * 0.26);
      envelope.rotation = (1 - reveal) * -0.04;
      seal.scale.set(p > 0.45 ? Math.max(0.1, 1 - (p - 0.45) * 3) : 1);
      flap.y = p > 0.45 ? -(p - 0.45) * 34 : 0;
    }, () => group.destroy({ children: true }));
  }

  private animateNuclear(territories: readonly string[], durationMs: number, signal: AbortSignal) {
    const group = new Container();
    const flash = new Graphics().rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT).fill({ color: 0xffe7a2, alpha: 0.75 });
    group.addChild(flash);
    const rings = territories.map((territoryId) => {
      const ring = new Graphics().circle(0, 0, 12).stroke({ color: 0xffd56a, width: 4 });
      ring.position.set(...presentationFor(territoryId).cameraFocus);
      group.addChild(ring);
      return ring;
    });
    this.effectsLayer.addChild(group);
    return this.animate(durationMs, signal, (p) => {
      flash.alpha = Math.max(0, 0.78 - p * 2.4);
      rings.forEach((ring, index) => {
        const local = Math.max(0, Math.min(1, p * 1.5 - index * 0.08));
        ring.scale.set(0.35 + local * 4.2);
        ring.alpha = 1 - local;
      });
    }, () => group.destroy({ children: true }));
  }

  private animateVictory(playerId: string, reason: string, durationMs: number, signal: AbortSignal) {
    const factionId = this.current?.state.players[playerId]?.factionId;
    const group = new Container();
    const veil = new Graphics().rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT).fill({ color: 0x090b10, alpha: 0.7 });
    const halo = new Graphics().circle(0, 0, 74).fill({ color: 0xe0a93c, alpha: 0.14 }).stroke({ color: 0xf2d17b, width: 3 });
    halo.position.set(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
    const title = this.tableText({ text: "VICTORY", style: { fill: 0xf4d989, fontFamily: "monospace", fontSize: 30, fontWeight: "900", letterSpacing: 7, stroke: { color: 0x382a14, width: 3 } } });
    title.anchor.set(0.5);
    title.position.set(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 - 10);
    const subtitle = this.tableText({ text: `${(factionId ?? playerId).replace(/_/g, " ").toUpperCase()}  ·  ${reason.toUpperCase()}`, style: { fill: 0xf3e8cc, fontFamily: "monospace", fontSize: 8, fontWeight: "700", letterSpacing: 1 } });
    subtitle.anchor.set(0.5);
    subtitle.position.set(WORLD_WIDTH / 2, WORLD_HEIGHT / 2 + 27);
    group.addChild(veil, halo, title, subtitle);
    this.effectsLayer.addChild(group);
    return this.animate(durationMs, signal, (p) => {
      const enter = 1 - Math.pow(1 - Math.min(1, p * 2), 3);
      group.alpha = Math.min(1, p * 5) * Math.min(1, (1 - p) * 5);
      halo.scale.set(0.7 + enter * 0.3 + Math.sin(p * Math.PI * 4) * 0.025);
      title.scale.set(0.82 + enter * 0.18);
    }, () => group.destroy({ children: true }));
  }

  private animateLegacyRitual(ritual: string, territoryId: string | undefined, durationMs: number, signal: AbortSignal) {
    if (territoryId) return this.animatePulse(territoryId, 0xe0a93c, durationMs, signal);
    const group = new Container();
    const veil = new Graphics().rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT).fill({ color: 0x080a0d, alpha: 0.5 });
    const card = new Container();
    const paper = new Graphics().roundRect(-76, -36, 152, 72, 3).fill({ color: 0xe1d2b2 }).stroke({ color: 0xb69b6b, width: 2 });
    const label = this.tableText({ text: ritual.replace(/\./g, " ").toUpperCase(), style: { fill: 0x332819, fontFamily: "monospace", fontSize: 12, fontWeight: "900", letterSpacing: 2 } });
    label.anchor.set(0.5);
    label.position.set(0, -9);
    const stroke = new Graphics().moveTo(-45, 15).bezierCurveTo(-12, -2, 8, 27, 47, 10).stroke({ color: 0x5c3c27, width: 2.2 });
    card.addChild(paper, label, stroke);
    card.position.set(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
    group.addChild(veil, card);
    this.effectsLayer.addChild(group);
    return this.animate(durationMs, signal, (p) => {
      group.alpha = Math.min(1, p * 5) * Math.min(1, (1 - p) * 5);
      card.scale.set(0.88 + Math.min(1, p * 3) * 0.12);
      stroke.alpha = Math.min(1, Math.max(0, p - 0.2) * 3);
    }, () => group.destroy({ children: true }));
  }

  private animateCurtain(color: number, durationMs: number, signal: AbortSignal) {
    const curtain = new Graphics().rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT).fill({ color, alpha: 0.22 });
    this.effectsLayer.addChild(curtain);
    return this.animate(durationMs, signal, (p) => { curtain.alpha = Math.sin(Math.PI * p) * 0.85; }, () => curtain.destroy());
  }

  resize(viewport: TableViewport) {
    if (!this.mounted && !this.host) return;
    this.app.renderer.resize(Math.max(1, viewport.width), Math.max(1, viewport.height));
    this.fitScale = Math.min(viewport.width / WORLD_WIDTH, viewport.height / WORLD_HEIGHT) * 0.96;
    const textResolution = tableTextTextureResolution(this.quality, this.app.renderer.resolution, this.fitScale);
    if (textResolution !== this.textResolution) {
      this.textResolution = textResolution;
      this.updateTextResolution(this.world);
    }
    this.applyCamera();
  }

  private updateTextResolution(container: Container) {
    for (const child of container.children) {
      if (child instanceof Text) {
        child.resolution = this.textResolution;
        child.roundPixels = true;
      } else if (child instanceof Container) {
        this.updateTextResolution(child);
      }
    }
  }

  private applyCamera() {
    const width = this.app.renderer.width / this.app.renderer.resolution;
    const height = this.app.renderer.height / this.app.renderer.resolution;
    const scale = this.fitScale * this.zoom;
    this.world.scale.set(scale);
    this.world.position.set(width / 2 - (WORLD_WIDTH / 2 - this.pan.x) * scale, height / 2 - (WORLD_HEIGHT / 2 - this.pan.y) * scale);
  }

  private installInput() {
    const canvas = this.app.canvas;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      this.zoom = Math.max(1, Math.min(MAX_TABLE_ZOOM, this.zoom * (event.deltaY > 0 ? 0.9 : 1.1)));
      this.applyCamera();
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      this.pointerStart = { x: event.clientX, y: event.clientY, panX: this.pan.x, panY: this.pan.y };
      canvas.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!this.pointerStart) return;
      const scale = this.fitScale * this.zoom;
      this.pan.x = this.pointerStart.panX + (event.clientX - this.pointerStart.x) / scale;
      this.pan.y = this.pointerStart.panY + (event.clientY - this.pointerStart.y) / scale;
      this.applyCamera();
    };
    const up = (event: PointerEvent) => { this.pointerStart = undefined; canvas.releasePointerCapture?.(event.pointerId); };
    canvas.addEventListener("wheel", wheel, { passive: false });
    canvas.addEventListener("pointerdown", down);
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", up);
    canvas.addEventListener("pointercancel", up);
    this.cleanup.push(
      () => canvas.removeEventListener("wheel", wheel),
      () => canvas.removeEventListener("pointerdown", down),
      () => canvas.removeEventListener("pointermove", move),
      () => canvas.removeEventListener("pointerup", up),
      () => canvas.removeEventListener("pointercancel", up),
    );
  }

  async captureDiagnostics(): Promise<TableSceneDiagnostics> {
    const missingHqAtlasIds = [...new Set(
      Object.values(this.current?.state.territories ?? {})
        .map((territory) => territory.hqFaction)
        .filter((factionId): factionId is FactionId => !!factionId && !this.pieceTextures.has(factionId)),
    )].sort();
    return {
      renderer: "pixi-webgl",
      quality: this.quality,
      texturesBytes: this.boardTexture ? 3072 * 2126 * 4 : 0,
      activeSprites: this.armyLayer.children.length + this.marksLayer.children.length,
      activeParticles: this.effectsLayer.children.length,
      contextLosses: this.contextLosses,
      textResolution: this.textResolution,
      minimumTerritoryLabelAlpha: Math.min(...[...this.territoryLabels.values()].map((label) => label.alpha)),
      maximumTerritoryLabelAlpha: Math.max(...[...this.territoryLabels.values()].map((label) => label.alpha)),
      missingHqAtlasIds,
      hqFallbacks: this.armyLayer.children.filter((child) => child.label.startsWith("hq-fallback:")).length,
      boundaryOcclusions: this.placementBounds.length,
      placedContentAboveTerritoryLines: this.world.getChildIndex(this.marksLayer) > this.world.getChildIndex(this.interactionLayer)
        && this.world.getChildIndex(this.armyLayer) > this.world.getChildIndex(this.interactionLayer),
      resourceValueBadges: this.interactionLayer.children.filter((child) => child.label.startsWith("resource-value:")).length,
      emphasizedTerritoryId: this.interaction.emphasizedTerritoryId,
    };
  }

  dispose() {
    delete (globalThis as any).__riskTableDiagnostics;
    this.cleanup.splice(0).forEach((cleanup) => cleanup());
    this.app.destroy({ removeView: true }, { children: true, texture: false, textureSource: false });
    this.mounted = false;
  }
}

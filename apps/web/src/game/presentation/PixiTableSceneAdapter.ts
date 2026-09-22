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
import { contentPack, factionDefinitionById } from "@risk/content";
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
import { cameraPanForFocus } from "./CameraFraming.ts";
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
import { printedMovementRoute, movementRoutePoint } from "./PrintedMovementRoutes.ts";
import { DomAnchorRegistry, type UIAnchorKind, type UIAnchorPoint } from "./DomAnchorRegistry.ts";
import { FACTION_CARD_ART, FACTION_EMBLEMS } from "../factionAssets.ts";
import {
  ARMY_PIECE_HEIGHT,
  ARMY_PIECE_MAX_ASPECT,
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
const FACTION_MARK_ART = import.meta.glob<string>("../../assets/factions/*-mark.svg", {query: "?raw", import: "default", eager: true});
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
  anchors?: DomAnchorRegistry;
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
  private readonly previewLayer = new Container();
  private anchors?: DomAnchorRegistry;
  private readonly flightCanvases = new Set<HTMLCanvasElement>();
  private reserveCanvas?: HTMLCanvasElement;
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
    this.anchors = this.options.anchors ?? new DomAnchorRegistry(document);
    this.anchors.capture();
    const updateReserve = () => this.renderReserve();
    window.addEventListener("scroll", updateReserve, true);
    window.addEventListener("resize", updateReserve);
    this.cleanup.push(() => window.removeEventListener("scroll", updateReserve, true), () => window.removeEventListener("resize", updateReserve));
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
      this.previewLayer,
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
        color: 0xe4ddc5,
        width: 0.65,
        alpha: 1,
      }));
    }
    this.boundaryLayer.mask = this.boundaryMask;
    for (const definition of artwork.labels) {
      const label = this.tableText({
        text: definition.text,
        style: {
          fill: 0x24332e,
          fontFamily: '"Arial Narrow", "Roboto Condensed", "Segoe UI", sans-serif',
          fontSize: definition.fontSize,
          fontWeight: "700",
          lineHeight: definition.lineHeight,
          align: "center",
          stroke: { color: 0xe9e1cc, width: 0.8 },
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
    const maxAspect = kind === "hq" ? 1.2 : ARMY_PIECE_MAX_ASPECT[kind === "one" ? 1 : 3];
    sprite.scale.set(Math.min(height / texture.height, height * maxAspect / texture.width));
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
      if (this.current === model) {
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
    this.armyLayer.removeChildren().forEach((child) => child.destroy({ children: true, context: true }));
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
          graphic.label = `army:${territoryId}`;
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

    for (const label of this.territoryLabels.values()) label.alpha = this.mapLabelAlpha(label);
  }

  private mapLabelAlpha(label: Text) {
    const halfWidth = label.width / 2 + 1;
    const halfHeight = label.height / 2 + 1;
    const overlaps = this.placementBounds.some((bounds) =>
      label.x + halfWidth > bounds.left && label.x - halfWidth < bounds.right
      && label.y + halfHeight > bounds.top && label.y - halfHeight < bounds.bottom);
    return territoryLabelAlpha(overlaps);
  }

  private renderMarks(state: GameState) {
    this.marksLayer.removeChildren().forEach((child) => child.destroy({ children: true, context: true }));
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
    const previous = this.interaction;
    this.interaction = model;
    if (previous.intents !== model.intents || previous.selectedTerritoryId !== model.selectedTerritoryId
      || previous.emphasizedTerritoryId !== model.emphasizedTerritoryId || previous.resourceValues !== model.resourceValues) this.renderInteraction();
    else this.renderPreview();
  }

  private renderPreview() {
    this.previewLayer.removeChildren().forEach((child) => child.destroy({ children: true, context: true }));
    this.previewLayer.eventMode = "none";
    const preview = this.interaction.preview;
    if (!preview || this.interaction.resourceValues) return;
    const color = preview.kind === "attack" ? 0xf08d7b : 0x9ee4d3;
    const route = preview.route.length ? preview.route : preview.from ? [preview.from, preview.to] : [preview.to];
    const line = new Graphics();
    route.slice(1).forEach((id, index) => printedMovementRoute(boardSvg, route[index], id).forEach((points) => points.forEach((point, i) => { if (i) line.lineTo(...point); else line.moveTo(...point); })));
    line.stroke({ color, width: 2, alpha: 0.65 });
    this.previewLayer.addChild(line);
    const point = presentationFor(preview.to).cameraFocus;
    const token = this.atlasSprite(preview.factionId, preview.kind === "setup" ? "hq" : "one", 24) ?? pieceGraphic(1, color, 1);
    token.position.set(point[0], point[1] - 8);
    token.alpha = 0.5;
    this.previewLayer.addChild(token);
    const badge = this.effectLabel(`${preview.targetBefore} → ${preview.targetAfter}${preview.reserveAfter === undefined ? "" : `  ·  ${preview.reserveAfter} reserve`}`, color);
    badge.position.set(point[0], point[1] + 17);
    this.previewLayer.addChild(badge);
    if (preview.from && preview.sourceBefore !== undefined && preview.sourceAfter !== undefined) {
      const source = this.effectLabel(`${preview.sourceBefore} → ${preview.sourceAfter}`, color);
      const origin = presentationFor(preview.from).cameraFocus;
      source.position.set(origin[0], origin[1] + 17);
      this.previewLayer.addChild(source);
    }
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
    this.renderReserve();
    this.renderPreview();
    // Pixi only auto-destroys an owned GraphicsContext for zero-argument
    // destroy(). Recursive option objects must explicitly opt into context
    // disposal; atlas textures remain shared and must survive these rebuilds.
    this.interactionLayer.removeChildren().forEach((child) => child.destroy({ children: true, context: true }));
    const resourceView = !!this.interaction.resourceValues;
    this.ownerLayer.visible = !resourceView;
    this.marksLayer.visible = !resourceView;
    this.armyLayer.visible = !resourceView;
    this.effectsLayer.visible = !resourceView;
    for (const label of this.territoryLabels.values()) label.alpha = resourceView ? 0.88 : this.mapLabelAlpha(label);

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
      let preview: Sprite | undefined;
      graphic.on("pointerover", (event: FederatedPointerEvent) => {
        const projected = projectTerritoryLayers(territory).architecture;
        if (projected && !preview) {
          preview = this.architectureSprite(projected.assetKey, definition.profile);
          preview.scale.set(preview.scale.x * 2, preview.scale.y * 2);
          preview.position.set(definition.architectureSlot[0], definition.architectureSlot[1] - size);
          preview.eventMode = "none";
          this.interactionLayer.addChild(preview);
        }
        this.options.onCityHover?.(territoryId, { clientX: event.clientX, clientY: event.clientY });
      });
      graphic.on("pointermove", (event: FederatedPointerEvent) => this.options.onCityHover?.(territoryId, { clientX: event.clientX, clientY: event.clientY }));
      graphic.on("pointerout", () => {
        preview?.destroy();
        preview = undefined;
        this.options.onCityHover?.(undefined);
      });
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
    this.anchors?.capture();
    if ((globalThis as any).__riskTableDiagnostics) (globalThis as any).__riskTableDiagnostics.lastCommand = { ...command, durationMs };
    switch (command.type) {
      case "camera.frame": return this.animateCamera(command.from, command.to, durationMs <= 120 ? 0 : durationMs, signal);
      case "army.place": return this.animatePlacement(command.territoryId, command.playerId, durationMs, signal, command.count);
      case "army.move": return this.animateMove(command.from, command.to, command.count, durationMs, signal, "army", undefined, command.route);
      case "army.remove": return this.animateRemoval(command.territoryId, command.count, durationMs, signal);
      case "battle.impact": return this.animateImpact(command.from, command.to, durationMs, signal);
      case "battle.dice": return this.animateDice(command, durationMs, signal);
      case "battle.prepare": return this.animatePreparation(command, durationMs, signal);
      case "territory.conquest": return this.animateConquest(command.territoryId, command.playerId, durationMs, signal);
      case "scar.apply": return this.animateScar(command.territoryId, command.scarId, durationMs, signal);
      case "city.place": return this.animateCity(command.territoryId, command.cityType, command.name, durationMs, signal);
      case "city.fortify": return this.animateFortification(command.territoryId, 10, durationMs, signal);
      case "hq.move": return this.animateMove(command.from, command.to, 1, durationMs, signal, "hq", command.factionId);
      case "redStar.gain": return this.animateAward(command.playerId, command.territoryId, "+1 RED STAR", durationMs, signal);
      case "missile.commit": return this.animateMissile(command, durationMs, signal);
      case "module.reveal": return this.animateModuleReveal(command.moduleId, durationMs, signal);
      case "nuclear.resolve": return this.animateNuclear(command.territories, durationMs, signal);
      case "alienIsland.place": return this.animateIsland(command, durationMs, signal);
      case "phase.change": return this.animateNotice(command.phase.replace(/_/g, " ").toUpperCase(), [], durationMs, signal);
      case "game.victory": return this.animateVictory(command.playerId, command.reason, durationMs, signal);
      case "legacy.ritual":
        if (command.playerId && (command.ritual === "card.upgraded" || command.ritual === "card.destroyed")) return this.animateCards({type: "cards.transfer", playerId: command.playerId, kind: command.ritual === "card.upgraded" ? "upgrade" : "destroy", count: 1, cardIds: command.cardId ? [command.cardId] : undefined, resources: command.resources, territoryId: command.territoryId}, durationMs, signal);
        return this.animateLegacyRitual(command.ritual, command.territoryId, durationMs, signal, command.text);
      case "recruitment.show": return this.animateRecruitment(command, durationMs, signal);
      case "cards.transfer": return this.animateCards(command, durationMs, signal);
      case "turn.handoff": return this.animateHandoff(command, durationMs, signal);
      case "setup.claim": return this.animateClaim(command, durationMs, signal);
      case "setup.order": return this.animateOrder(command, durationMs, signal);
      case "setup.faction": return this.animateFaction(command, durationMs, signal);
      case "battle.compare": return this.animateDice(command, durationMs, signal);
      case "battle.modify": return this.animateDieModifier(command, durationMs, signal);
      case "reward.eligible": return this.animateNotice("RESOURCE DRAW EARNED", [this.playerName(command.playerId)], durationMs, signal, command.territoryId);
      case "power.activate": return this.animatePower(command, durationMs, signal);
      case "score.change": return this.animateScore(command, durationMs, signal);
      case "hq.capture": return this.animateAward(command.playerId, command.territoryId, `${command.factionId.replace(/_/g, " ")} HQ CAPTURED`, durationMs, signal);
      case "city.damage": return this.animateFortification(command.territoryId, command.remaining, durationMs, signal, true);
      case "player.eliminate": return this.animateNotice(`${this.playerName(command.playerId)} ${command.kind === "knocked_out" ? "KNOCKED OUT" : "ELIMINATED"}`, command.by ? [`${this.playerName(command.by)} claimed the final territory`] : [], durationMs, signal);
      case "campaign.recap": return this.animateNotice(command.title, command.items, durationMs, signal);
      case "continent.control": return Promise.all([
        this.animateNotice(`${command.continentId.replace(/_/g, " ")} · ${command.gained ? "CONTROL SECURED" : "CONTROL BROKEN"}`, [this.playerName(command.playerId)], durationMs, signal),
        ...command.territories.map((id) => this.animatePulse(id, command.gained ? 0x9ee4d3 : 0xe7a383, durationMs, signal)),
      ]).then(() => undefined);
      case "table.resync": return this.animateCurtain(0x91a4bb, durationMs, signal);
      case "army.anticipate": return this.animateAnticipation(command.territoryId, durationMs, signal);
    }
  }

  private animate(durationMs: number, signal: AbortSignal, update: (progress: number) => void, done?: () => void) {
    if (durationMs <= 0 || signal.aborted) { update(1); done?.(); return Promise.resolve(); }
    return new Promise<void>((resolve) => {
      const start = this.options.clock.now();
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        this.app.ticker.remove(tick);
        signal.removeEventListener("abort", finish);
        done?.();
        resolve();
      };
      const tick = () => {
        const progress = Math.min(1, (this.options.clock.now() - start) / durationMs);
        // Reduced-motion beats are <=120 ms. Keep their information visible
        // without spatial travel; the director still controls their lifetime.
        update(durationMs <= 120 ? 0.7 : progress);
        if (progress >= 1 || signal.aborted) finish();
      };
      signal.addEventListener("abort", finish, { once: true });
      this.app.ticker.add(tick);
      tick();
    });
  }

  private animateCamera(from: string | undefined, to: string | undefined, durationMs: number, signal: AbortSignal) {
    const points = [from, to].filter(Boolean).map((id) => presentationFor(id!).cameraFocus);
    const targetX = points.length ? points.reduce((sum, point) => sum + point[0], 0) / points.length : WORLD_WIDTH / 2;
    const targetY = points.length ? points.reduce((sum, point) => sum + point[1], 0) / points.length : WORLD_HEIGHT / 2;
    const startPan = { ...this.pan };
    const targetZoom = points.length ? 1.18 : 1;
    const targetPan = points.length ? cameraPanForFocus([targetX, targetY], { width: WORLD_WIDTH, height: WORLD_HEIGHT }, {
      width: this.app.renderer.width / this.app.renderer.resolution,
      height: this.app.renderer.height / this.app.renderer.resolution,
    }, this.fitScale * targetZoom) : {x: 0, y: 0};
    const startZoom = this.zoom;
    return this.animate(durationMs, signal, (p) => {
      const eased = p * p * (3 - 2 * p);
      this.pan.x = startPan.x + (targetPan.x - startPan.x) * eased;
      this.pan.y = startPan.y + (targetPan.y - startPan.y) * eased;
      this.zoom = startZoom + (targetZoom - startZoom) * eased;
      this.applyCamera();
    });
  }

  private animatePlacement(territoryId: string, playerId: string, durationMs: number, signal: AbortSignal, count = 1) {
    const reserveAnchor = this.uiAnchor("reserve", playerId);
    if (reserveAnchor) return this.animateScreenFlight(reserveAnchor, this.boardClient(presentationFor(territoryId).cameraFocus), "army", `+${count} TROOPS`, durationMs, signal, composeArmyStack(count, "reserve").pieces.length);
    const territory = this.current!.state.territories[territoryId];
    const definition = presentationFor(territoryId);
    const layout = territoryDisplayLayout(definition, {
      army: true,
      hq: !!territory?.hqFaction,
      scars: (territory?.scars.length ?? 0) > 0,
      city: !!territory?.city || !!territory?.ruin,
      fortification: !!territory?.fortification,
    });
    const [x, y, slotScale] = layout.pieceSlots[0];
    const factionId = this.current!.state.players[playerId]?.factionId;
    const token = new Container();
    composeArmyStack(count, `${territoryId}:recruit`).pieces.forEach((piece, index) => {
      const miniature = this.atlasSprite(factionId, piece.denomination === 3 ? "three" : "one", 17 * slotScale) ?? pieceGraphic(piece.denomination, factionColor(this.current!.state, territoryId), slotScale);
      miniature.position.set((index % 3) * 5, Math.floor(index / 3) * 3); token.addChild(miniature);
    });
    const reserve = this.playerStation(playerId);
    const badge = this.effectLabel(`+${count} TROOPS`, 0xa9e4d4);
    badge.position.set(x, y + 15);
    this.effectsLayer.addChild(token, badge);
    return this.animate(durationMs, signal, (p) => {
      const bounce = 1 - Math.pow(1 - p, 3);
      token.position.set(reserve[0] + (x - reserve[0]) * bounce, reserve[1] + (y - reserve[1]) * bounce - Math.sin(p * Math.PI) * 10);
      token.alpha = 0.5 + 0.5 * bounce;
      badge.alpha = Math.min(1, p * 4);
    }, () => { token.destroy({ children: true, context: true }); badge.destroy({ children: true, context: true }); });
  }

  private animateMove(from: string, to: string, count: number, durationMs: number, signal: AbortSignal, kind: "army" | "hq" | "missile" = "army", movingFaction?: string, route?: readonly string[]) {
    const start = presentationFor(from).cameraFocus;
    const end = presentationFor(to).cameraFocus;
    const group = new Container();
    const stops = route && route.length > 1 ? route : [from, to];
    const movement = stops.slice(1).flatMap((stop, index) => printedMovementRoute(boardSvg, stops[index], stop));
    const path = new Graphics();
    movement.forEach((points) => points.forEach((point, index) => { if (index) path.lineTo(...point); else path.moveTo(...point); }));
    path.stroke({ color: 0xbadbd4, width: 1, alpha: 0.5 });
    this.effectsLayer.addChild(path);
    const controller = this.current!.state.territories[from]?.controller;
    const factionId = movingFaction ?? (controller ? this.current!.state.players[controller]?.factionId : undefined);
    const pieces = composeArmyStack(count, `${from}:${to}:move`).pieces;
    const shadow = new Graphics().ellipse(0, 4, 9 + pieces.length * 2, 3).fill({ color: 0x161b18, alpha: 0.28 });
    shadow.position.set(...start);
    this.effectsLayer.addChild(shadow);
    for (let i = 0; i < (kind === "army" ? pieces.length : 1); i++) {
      const denomination = pieces[i]?.denomination ?? 1;
      const token = kind === "missile"
        ? new Graphics().poly([0, -13, 3, -5, 3, 5, 6, 10, 2, 9, 0, 12, -2, 9, -6, 10, -3, 5, -3, -5]).fill({ color: 0xd9d2ba }).stroke({ color: 0x34372f, width: 1 })
        : (this.atlasSprite(factionId, kind === "hq" ? "hq" : denomination === 3 ? "three" : "one", kind === "hq" ? 25 : denomination === 3 ? 22 : 17)
          ?? pieceGraphic(denomination, factionColor(this.current!.state, from), 0.72));
      token.position.set(kind === "army" ? (i - (pieces.length - 1) / 2) * 9 : 0, (i % 2) * 3);
      if (kind === "missile") token.rotation = Math.atan2(end[1] - start[1], end[0] - start[0]) + Math.PI / 2;
      group.addChild(token);
    }
    group.position.set(...start);
    this.effectsLayer.addChild(group);
    return this.animate(durationMs, signal, (p) => {
      const eased = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      const position = movementRoutePoint(movement, eased);
      group.x = position[0];
      const groundY = position[1];
      const lift = Math.sin(Math.PI * p);
      shadow.position.set(group.x, groundY + 4);
      shadow.scale.set(1 - lift * 0.15);
      shadow.alpha = 1 - lift * 0.4;
      group.y = groundY - lift * (kind === "missile" ? 16 : 5);
      group.rotation = kind === "army" ? lift * 0.025 : 0;
    }, () => { path.destroy(); shadow.destroy(); group.destroy({ children: true, context: true }); });
  }

  private animateRemoval(territoryId: string, count: number, durationMs: number, signal: AbortSignal) {
    if (count <= 0) return this.options.clock.wait(durationMs, signal);
    const point = presentationFor(territoryId).cameraFocus;
    const group = new Container();
    const controller = this.current!.state.territories[territoryId]?.controller;
    const factionId = controller ? this.current!.state.players[controller]?.factionId : undefined;
    const pieces = composeArmyStack(count, `${territoryId}:loss`).pieces;
    for (const [i, piece] of pieces.entries()) {
      const token = this.atlasSprite(factionId, piece.denomination === 3 ? "three" : "one", piece.denomination === 3 ? 22 : 17)
        ?? pieceGraphic(piece.denomination, factionColor(this.current!.state, territoryId), 0.72);
      token.position.set((i - (pieces.length - 1) / 2) * 8, (i % 2) * 3);
      group.addChild(token);
    }
    group.position.set(...point);
    this.effectsLayer.addChild(group);
    return this.animate(durationMs, signal, (p) => {
      const fall = p * p;
      group.y = point[1] + fall * 5;
      group.alpha = 1 - p * p;
      group.rotation = fall * 0.28;
    }, () => group.destroy({ children: true, context: true }));
  }

  private animateImpact(from: string, to: string, durationMs: number, signal: AbortSignal) {
    const start = presentationFor(from).cameraFocus;
    const end = presentationFor(to).cameraFocus;
    // A short directional strike and dust burst, kept local to the defender.
    const dx = end[0] - start[0], dy = end[1] - start[1];
    const distance = Math.max(1, Math.hypot(dx, dy));
    const flash = new Graphics().moveTo(end[0] - dx / distance * 18, end[1] - dy / distance * 18).lineTo(...end).stroke({ color: 0xe3c18a, width: 1.6, alpha: 0.9 });
    const ring = new Graphics().ellipse(0, 0, 8, 4).fill({ color: 0xb59b70, alpha: 0.2 }).stroke({ color: 0xd1b17c, width: 1 });
    for (let i = 0; i < 7; i++) {
      const angle = i * Math.PI * 2 / 7;
      ring.moveTo(Math.cos(angle) * 5, Math.sin(angle) * 3).lineTo(Math.cos(angle) * 11, Math.sin(angle) * 7).stroke({ color: 0xd1b17c, width: 1 });
    }
    ring.position.set(...end);
    this.effectsLayer.addChild(flash, ring);
    return this.animate(durationMs, signal, (p) => {
      flash.alpha = Math.pow(1 - p, 3);
      ring.scale.set(0.6 + (1 - Math.pow(1 - p, 3)) * 1.5);
      ring.alpha = Math.pow(1 - p, 2);
    }, () => { flash.destroy(); ring.destroy(); });
  }

  private animatePulse(territoryId: string, color: number, durationMs: number, signal: AbortSignal) {
    const definition = presentationFor(territoryId);
    const ring = new Graphics().ellipse(0, 0, 12, 7).stroke({ color, width: 1.2, alpha: 0.75 });
    ring.position.set(...definition.cameraFocus);
    this.effectsLayer.addChild(ring);
    return this.animate(durationMs, signal, (p) => {
      ring.scale.set(0.9 + p * 0.45);
      ring.alpha = Math.sin(Math.PI * p);
    }, () => ring.destroy());
  }

  private animateScar(territoryId: string, scarId: string, durationMs: number, signal: AbortSignal) {
    const definition = presentationFor(territoryId);
    const point = scarId === "fallout" ? definition.architectureSlot : scarDisplaySlot(definition);
    const sticker = new Container();
    const backing = new Graphics().roundRect(-7, -7, 14, 14, 2).fill(0xf0e4c8).stroke({ color: 0xad9874, width: 0.6 });
    backing.position.set(point[0], point[1] - 34);
    if (scarId === "fallout") {
      sticker.addChild(this.architectureSprite("fallout", definition.profile));
    } else {
      const asset = scarMarkAsset(scarId);
      if (asset) {
        sticker.addChild(scarAssetGraphic(asset, 10));
      } else {
        const visual = SCAR_VISUALS[scarId] ?? { color: 0x8a3936, glyph: "!" };
        const chip = new Graphics().circle(0, 0, 8).fill({ color: visual.color }).stroke({ color: 0xffe1af, width: 1.2 });
        const glyph = this.tableText({ text: visual.glyph, style: { fill: 0xffedca, fontFamily: "monospace", fontSize: 5, fontWeight: "900" } });
        glyph.anchor.set(0.5);
        sticker.addChild(chip, glyph);
      }
    }
    sticker.position.set(point[0], point[1] - 34);
    this.effectsLayer.addChild(backing, sticker);
    return this.animate(durationMs, signal, (p) => {
      const settle = 1 - Math.pow(1 - Math.min(1, p / 0.72), 3);
      sticker.y = point[1] - 34 * (1 - settle);
      sticker.rotation = (1 - settle) * -0.28;
      sticker.scale.set(1 + (1 - settle) * 0.12);
      backing.x = point[0] + p * 20;
      backing.y = point[1] - 34 - p * 6;
      backing.rotation = p * 0.6;
      backing.alpha = Math.max(0, 1 - p * 2);
    }, () => { backing.destroy(); sticker.destroy({ children: true, context: true }); });
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
    }, () => group.destroy({ children: true, context: true }));
  }

  private animateNuclear(territories: readonly string[], durationMs: number, signal: AbortSignal) {
    const group = new Container();
    const flash = new Graphics();
    for (const territoryId of territories) {
      const [x, y] = presentationFor(territoryId).cameraFocus;
      flash.ellipse(x, y, 27, 18).fill({ color: 0xe6cea0, alpha: 0.32 });
    }
    group.addChild(flash);
    const rings = territories.map((territoryId) => {
      const ring = new Graphics().ellipse(0, 0, 12, 8).fill({ color: 0x75664f, alpha: 0.24 }).stroke({ color: 0xc6ad7e, width: 1.5 });
      ring.position.set(...presentationFor(territoryId).cameraFocus);
      group.addChild(ring);
      return ring;
    });
    this.effectsLayer.addChild(group);
    return this.animate(durationMs, signal, (p) => {
      flash.alpha = Math.max(0, 1 - p * 4);
      rings.forEach((ring, index) => {
        const local = Math.max(0, Math.min(1, p * 1.5 - index * 0.08));
        ring.scale.set(0.5 + (1 - Math.pow(1 - local, 3)) * 3.2);
        ring.alpha = Math.pow(1 - local, 2);
      });
    }, () => group.destroy({ children: true, context: true }));
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
      halo.scale.set(0.9 + enter * 0.1);
      title.scale.set(0.82 + enter * 0.18);
    }, () => group.destroy({ children: true, context: true }));
  }

  private animateLegacyRitual(ritual: string, territoryId: string | undefined, durationMs: number, signal: AbortSignal, text?: string) {
    if (territoryId && ritual === "ruins.placed") return this.animateCity(territoryId, "ruin", text ?? "RUINS", durationMs, signal);
    const group = new Container();
    const veil = new Graphics().rect(0, 0, WORLD_WIDTH, WORLD_HEIGHT).fill({ color: 0x080a0d, alpha: 0.5 });
    const card = new Container();
    const paper = new Graphics().roundRect(-76, -36, 152, 72, 3).fill({ color: 0xe1d2b2 }).stroke({ color: 0xb69b6b, width: 2 });
    const label = this.tableText({ text: text ?? ritual.replace(/\./g, " ").toUpperCase(), style: { fill: 0x332819, fontFamily: "monospace", fontSize: 9, fontWeight: "900", letterSpacing: 1, wordWrap: true, wordWrapWidth: 140, align: "center" } });
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
    }, () => group.destroy({ children: true, context: true }));
  }

  private playerName(playerId: string) {
    const player = this.current?.state.players[playerId];
    return (player?.factionId ?? playerId).replace(/_/g, " ").toUpperCase();
  }

  private boardClient(point: readonly [number, number]): UIAnchorPoint {
    const screen = this.world.toGlobal({x: point[0], y: point[1]});
    const rect = this.app.canvas.getBoundingClientRect();
    return {clientX: rect.left + screen.x, clientY: rect.top + screen.y, width: 32, height: 32};
  }

  private uiAnchor(kind: UIAnchorKind, playerId?: string, anchorId?: string) {
    return this.anchors?.resolveSource(kind, playerId, anchorId);
  }

  private uiDestination(kind: UIAnchorKind, playerId?: string, anchorId?: string) {
    return this.anchors?.resolveLive(kind, playerId, anchorId);
  }

  private renderReserve() {
    this.reserveCanvas?.remove(); this.reserveCanvas = undefined;
    const state = this.current?.state;
    if (!state?.recruit || state.phase !== "join_or_recruit" || state.recruit.remaining <= 0) return;
    const playerId = state.turnOrder[state.activeIdx];
    const anchor = this.uiDestination("reserve", playerId);
    if (!anchor) return;
    const canvas = document.createElement("canvas"); canvas.dataset.tableReservePieces = String(state.recruit.remaining); canvas.setAttribute("aria-hidden", "true");
    canvas.width = 48; canvas.height = 48;
    Object.assign(canvas.style, {position: "fixed", left: `${anchor.clientX - 12}px`, top: `${anchor.clientY - 12}px`, width: "24px", height: "24px", pointerEvents: "none", zIndex: "51"});
    const context = canvas.getContext("2d");
    if (!context) return;
    const factionId = state.players[playerId]?.factionId;
    const color = factionId ? factionDefinitionById(factionId, state.unlockedModules)?.color : undefined;
    context.fillStyle = "#102326"; context.fillRect(0, 0, 48, 48);
    const pieces = composeArmyStack(state.recruit.remaining, "reserve").pieces.slice(0, 3);
    pieces.forEach((piece, index) => {
      const x = 9 + index * 14, y = 23 - index % 2 * 5;
      context.fillStyle = color ?? "#9cdbc8"; context.strokeStyle = "#e4dfbb"; context.lineWidth = 1.5;
      context.beginPath(); context.roundRect(x - 5, y, 10, 14, 2); context.fill(); context.stroke();
      context.beginPath(); context.arc(x, y - 5, piece.denomination === 3 ? 6 : 4, 0, Math.PI * 2); context.fill(); context.stroke();
    });
    context.fillStyle = "#102326"; context.fillRect(0, 36, 48, 12); context.fillStyle = "#e2f2df"; context.font = "bold 11px monospace"; context.textAlign = "center"; context.fillText(String(state.recruit.remaining), 24, 46);
    this.reserveCanvas = canvas; document.body.appendChild(canvas);
  }

  /** Cross-surface flights share the director's clock and are removed on every exit. */
  private animateScreenFlight(start: UIAnchorPoint, end: UIAnchorPoint, kind: "card" | "die" | "faction" | "tear" | "star" | "army" | "seal" | "power", label: string, durationMs: number, signal: AbortSignal, count = 1, color = "#f1d48c", face?: string, artwork?: {card: HTMLImageElement; emblem: HTMLImageElement}) {
    const canvas = document.createElement("canvas");
    canvas.dataset.tableFlight = kind;
    canvas.setAttribute("aria-hidden", "true");
    Object.assign(canvas.style, {position: "fixed", inset: "0", width: "100vw", height: "100vh", pointerEvents: "none", zIndex: "90"});
    const resolution = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.ceil(window.innerWidth * resolution); canvas.height = Math.ceil(window.innerHeight * resolution);
    const context = canvas.getContext("2d");
    if (!context) return Promise.resolve();
    document.body.appendChild(canvas);
    this.flightCanvases.add(canvas);
    return this.animate(durationMs, signal, (p) => {
      context.setTransform(resolution, 0, 0, resolution, 0, 0);
      context.clearRect(0, 0, window.innerWidth, window.innerHeight);
      const travel = Math.min(1, p / 0.78), t = travel * travel * (3 - 2 * travel);
      const x = start.clientX + (end.clientX - start.clientX) * t;
      const y = start.clientY + (end.clientY - start.clientY) * t - Math.sin(Math.PI * travel) * 45;
      context.globalAlpha = Math.min(1, p * 8) * Math.min(1, (1 - p) * 8);
      context.strokeStyle = color; context.lineWidth = 2;
      context.beginPath(); context.moveTo(start.clientX, start.clientY); context.quadraticCurveTo((start.clientX + x) / 2, Math.min(start.clientY, y) - 30, x, y); context.stroke();
      for (let index = 0; index < Math.min(5, Math.max(1, count)); index++) {
        context.save(); context.translate(x + index * 7, y + index * 3); context.rotate((1 - t) * -0.12);
        context.fillStyle = kind === "star" ? "#af4337" : kind === "army" ? color : "#e9dab8";
        context.beginPath();
        if (kind === "star") {
          for (let vertex = 0; vertex < 10; vertex++) { const a = -Math.PI / 2 + vertex * Math.PI / 5, r = vertex % 2 ? 9 : 22; if (vertex) context.lineTo(Math.cos(a) * r, Math.sin(a) * r); else context.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
          context.closePath();
        } else if (kind === "tear") {
          for (const direction of [-1, 1]) {
            context.save(); context.translate(direction * p * 20, p * p * 14); context.rotate(direction * p * 0.35);
            context.beginPath(); context.moveTo(0, -25); context.lineTo(direction * 17, -25); context.lineTo(direction * 17, 25); context.lineTo(0, 25); context.lineTo(direction * 4, 13); context.lineTo(0, 2); context.lineTo(direction * 4, -10); context.closePath(); context.fill(); context.stroke(); context.restore();
          }
          context.beginPath();
        } else if (kind === "die") context.roundRect(-13, -13, 26, 26, 4);
        else if (kind === "faction") context.roundRect(-25, -33, 50, 66, 4);
        else if (kind === "card") context.roundRect(-17, -25, 34, 50, 4);
        else if (kind === "army") { context.roundRect(-8, -4, 16, 18, 3); context.moveTo(8, -11); context.arc(0, -11, 8, 0, Math.PI * 2); }
        else context.arc(0, 0, 21, 0, Math.PI * 2);
        if (kind === "faction") { context.save(); context.globalAlpha *= 1 - Math.max(0, Math.min(1, (p - 0.5) / 0.25)); context.fill(); context.stroke(); context.restore(); }
        else { context.fill(); context.stroke(); }
        if (kind === "die" && face) { context.fillStyle = "#22313c"; context.font = "bold 19px monospace"; context.textAlign = "center"; context.fillText(face, 0, 7); }
        if (kind === "faction" && artwork) {
          const stamp = Math.max(0, Math.min(1, (p - 0.5) / 0.25));
          if (artwork.card.complete && artwork.card.naturalWidth > 0) { context.save(); context.globalAlpha *= 1 - stamp; context.drawImage(artwork.card, -25, -33, 50, 66); context.restore(); }
          if (artwork.emblem.complete && artwork.emblem.naturalWidth > 0) { context.save(); context.globalAlpha *= stamp; const size = 50 + (1 - stamp) * 16; context.drawImage(artwork.emblem, -size / 2, -size / 2, size, size); context.restore(); }
        }
        if (kind === "card") {
          context.fillStyle = "#34454a"; context.font = "bold 7px monospace"; context.textAlign = "center";
          const words = (face ?? "RISK LEGACY").toUpperCase().split(/\s+/);
          words.slice(0, 4).forEach((word, row) => context.fillText(word, 0, -8 + row * 9, 30));
        }
        context.restore();
      }
      context.font = "bold 13px monospace"; context.textAlign = "center";
      const width = Math.min(window.innerWidth - 24, context.measureText(label).width + 20);
      const labelX = Math.max(width / 2 + 8, Math.min(window.innerWidth - width / 2 - 8, x));
      const labelY = Math.max(24, Math.min(window.innerHeight - 24, y + 47));
      if (label) {
        context.fillStyle = "#101b23"; context.fillRect(labelX - width / 2, labelY - 15, width, 24);
        context.fillStyle = color; context.fillText(label, labelX, labelY + 2, width - 12);
      }
      const scoreChange = kind === "star" ? label.match(/(\d+) → (\d+)$/) : undefined;
      if (scoreChange) {
        context.globalAlpha = 1;
        context.fillStyle = "#101b23"; context.fillRect(end.clientX - end.width / 2, end.clientY - end.height / 2, end.width, end.height);
        context.fillStyle = color; context.font = "bold 15px monospace";
        context.fillText(p < 0.78 ? scoreChange[1] : scoreChange[2], end.clientX, end.clientY + 5);
      }
      if (p > 0.72) { context.beginPath(); context.roundRect(end.clientX - end.width / 2 - 4, end.clientY - end.height / 2 - 4, end.width + 8, end.height + 8, 6); context.stroke(); }
    }, () => { canvas.remove(); this.flightCanvases.delete(canvas); });
  }

  private animateFaction(command: Extract<SceneCommand, {type: "setup.faction"}>, durationMs: number, signal: AbortSignal) {
    const start = this.uiAnchor("faction", undefined, command.factionId);
    const end = this.uiDestination("player", command.playerId);
    const color = factionDefinitionById(command.factionId, this.current!.state.unlockedModules)?.color ?? "#f1d48c";
    if (start && end) {
      const card = new Image(), emblem = new Image();
      card.src = FACTION_CARD_ART[command.factionId]; emblem.src = FACTION_EMBLEMS[command.factionId];
      return this.animateScreenFlight(start, end, "faction", command.factionId.replace(/_/g, " ").toUpperCase(), durationMs, signal, 1, color, undefined, {card, emblem});
    }
    return this.animateNotice(this.playerName(command.playerId), ["FACTION COMMITTED"], durationMs, signal);
  }

  private animatePreparation(command: Extract<SceneCommand, {type: "battle.prepare"}>, durationMs: number, signal: AbortSignal) {
    const defenders = this.armyLayer.children.filter((child) => child.label === `army:${command.to}`).map((token) => ({token, x: token.x, y: token.y, rotation: token.rotation}));
    const focus = presentationFor(command.to).cameraFocus;
    const tray = this.diceTrayPoint(command.from, command.to);
    const group = new Container();
    const dice: {token: Container; start: readonly [number, number]; end: readonly [number, number]}[] = [];
    const flights: Promise<void>[] = [];
    for (const side of ["att", "def"] as const) {
      const count = side === "att" ? command.attackCount : command.defenseCount;
      for (let index = 0; index < Math.min(3, count ?? 0); index++) {
        const chosenDie = this.uiAnchor("die", undefined, `${side}:${index}`);
        const destination: [number, number] = [tray[0] + (side === "att" ? -35 : 35), tray[1] - 8 + index * 21];
        if (chosenDie) { flights.push(this.animateScreenFlight(chosenDie, this.boardClient(destination), "die", index === 0 ? `${count} ${side === "att" ? "ATTACK" : "DEFENSE"} DICE` : "", durationMs, signal, 1, side === "att" ? "#eea38a" : "#a9d9eb")); continue; }
        const token = new Graphics().roundRect(-9, -9, 18, 18, 3).fill(side === "att" ? 0xa8473e : 0xd9e1df).stroke({color: 0xf1d48c, width: 1});
        dice.push({token, start: presentationFor(side === "att" ? command.from : command.to).cameraFocus, end: [tray[0] + (side === "att" ? -35 : 35), tray[1] - 8 + index * 21]});
        group.addChild(token);
      }
    }
    const line = new Graphics().moveTo(...presentationFor(command.from).cameraFocus).lineTo(...focus).stroke({color: 0xdd8e73, width: 1.5, alpha: 0.65}); group.addChild(line); this.effectsLayer.addChild(group);
    const formation = this.animate(durationMs, signal, (p) => {
      const settle = Math.min(1, p * 1.8);
      defenders.forEach(({token, x, y, rotation}, index) => { token.x = x + (focus[0] + (index - (defenders.length - 1) / 2) * 5 - x) * settle * 0.45; token.y = y + (focus[1] - y) * settle * 0.25; token.rotation = rotation * (1 - settle); });
      dice.forEach(({token, start, end}, index) => { const slide = Math.max(0, Math.min(1, p * 1.7 - index * 0.04)); token.position.set(start[0] + (end[0] - start[0]) * slide, start[1] + (end[1] - start[1]) * slide); token.rotation = (1 - slide) * -0.22; });
    }, () => { defenders.forEach(({token, x, y, rotation}) => { if (!token.destroyed) { token.position.set(x, y); token.rotation = rotation; } }); group.destroy({children: true, context: true}); });
    return Promise.all([formation, ...flights]).then(() => undefined);
  }

  private animateOrder(command: Extract<SceneCommand, {type: "setup.order"}>, durationMs: number, signal: AbortSignal) {
    const group = new Container();
    const original = Object.keys(this.current!.state.players);
    const rows = command.order.map((playerId, index) => {
      const roll = command.rolls?.find((entry) => entry.playerId === playerId)?.value;
      const factionId = this.current!.state.players[playerId]?.factionId;
      const factionColor = factionId ? colorNumber(factionDefinitionById(factionId, this.current!.state.unlockedModules)?.color) : 0xf1d48c;
      const label = this.effectLabel(this.playerName(playerId), factionColor, 260);
      group.addChild(label);
      const diceBody = new Container(); diceBody.position.set(-155, 0);
      diceBody.addChild(new Graphics().roundRect(-11, -11, 22, 22, 4).fill(0xeae1c8).stroke({color: factionColor, width: 1.4}));
      const die = this.tableText({text: roll === undefined ? "" : String(roll), style: {fill: 0xf1d48c, fontFamily: "monospace", fontSize: 12, fontWeight: "900"}});
      die.style.fill = 0x23313b; die.anchor.set(0.5); diceBody.addChild(die); label.addChild(diceBody);
      const emblem = new Container(); emblem.position.set(155, 0);
      const mark = factionId ? FACTION_MARK_ART[`../../assets/factions/${factionId}-mark.svg`] : undefined;
      if (mark) { const art = new Graphics().svg(mark); art.scale.set(22 / 128); art.position.set(-11, -11); emblem.addChild(art); }
      else {
        emblem.addChild(new Graphics().poly([0, -11, 10, -5, 8, 7, 0, 12, -8, 7, -10, -5]).fill(factionColor).stroke({color: 0xf4e4be, width: 1}));
        const initials = this.tableText({text: String(index + 1), style: {fill: 0x15222a, fontSize: 10, fontFamily: "monospace", fontWeight: "900"}}); initials.anchor.set(0.5); emblem.addChild(initials);
      }
      label.addChild(emblem);
      return {label, die, diceBody, playerId, from: Math.max(0, original.indexOf(playerId)), to: index};
    });
    group.position.set(WORLD_WIDTH / 2, 100); this.effectsLayer.addChild(group);
    return this.animate(durationMs, signal, (p) => {
      const reorder = Math.max(0, Math.min(1, (p - 0.55) / 0.3));
      const rounds = command.rounds?.length ? command.rounds : command.rolls ? [command.rolls] : [];
      const round = rounds[Math.min(rounds.length - 1, Math.floor(p / 0.55 * rounds.length))];
      rows.forEach(({label, die, diceBody, playerId, from, to}) => {
        const value = round?.find((entry) => entry.playerId === playerId)?.value;
        if (value !== undefined && die.text !== String(value)) die.text = String(value);
        diceBody.rotation = p < 0.5 ? Math.sin(p * 40) * 0.25 : 0;
        label.y = (from + (to - from) * reorder) * 30; label.x = Math.sin(Math.PI * reorder) * (to < from ? -20 : 20); label.alpha = Math.min(1, p * 6) * Math.min(1, (1 - p) * 6);
      });
    }, () => group.destroy({children: true, context: true}));
  }

  private animatePower(command: Extract<SceneCommand, {type: "power.activate"}>, durationMs: number, signal: AbortSignal) {
    const palette = /bunker|defen|fortif/.test(command.powerId) ? "#91cee6" : /mutant|bio|toxic/.test(command.powerId) ? "#c2e071" : /move|mobil|maneuver/.test(command.powerId) ? "#90ded4" : "#ed9d78";
    const source = this.uiAnchor("faction", command.playerId) ?? this.uiAnchor("player", command.playerId) ?? (command.from ? this.boardClient(presentationFor(command.from).cameraFocus) : undefined);
    const targetId = command.territoryId ?? command.to;
    const target = (command.dieIndex === undefined ? undefined : this.uiDestination("die", undefined, `${command.side ?? "att"}:${command.dieIndex}`)) ?? (targetId ? this.boardClient(presentationFor(targetId).cameraFocus) : this.uiDestination("player", command.playerId));
    if (source && target) return this.animateScreenFlight(source, target, "power", `${command.powerId.replace(/_/g, " ")}${command.delta === undefined ? "" : ` ${command.delta > 0 ? "+" : ""}${command.delta}`}`, durationMs, signal, 1, palette);
    return this.animateNotice(this.playerName(command.playerId), [command.powerId.replace(/_/g, " ")], durationMs, signal, targetId);
  }

  private animateScore(command: Extract<SceneCommand, {type: "score.change"}>, durationMs: number, signal: AbortSignal) {
    const flights = command.changes.map((change) => {
      const end = this.uiDestination("score", change.playerId);
      const start = command.territoryId ? this.boardClient(presentationFor(command.territoryId).cameraFocus) : this.uiAnchor("player", change.playerId);
      return start && end ? this.animateScreenFlight(start, end, "star", `${this.playerName(change.playerId)} ${change.before} → ${change.after}`, durationMs, signal) : this.animateNotice(this.playerName(change.playerId), [`SCORE ${change.before} → ${change.after}`], durationMs, signal);
    });
    const changedLead = command.leadersAfter.length > 0 && [...command.leadersAfter].sort().join("|") !== [...command.leadersBefore].sort().join("|");
    if (changedLead) flights.push(this.animateNotice(command.leadersAfter.length > 1 ? "LEAD SHARED" : "TAKES THE LEAD", command.leadersAfter.map((id) => this.playerName(id)), durationMs, signal));
    return Promise.all(flights).then(() => undefined);
  }

  private playerStation(playerId: string): [number, number] {
    const players = Object.keys(this.current?.state.players ?? {});
    return [120 + Math.max(0, players.indexOf(playerId)) * ((WORLD_WIDTH - 240) / Math.max(1, players.length - 1)), WORLD_HEIGHT - 18];
  }

  private diceTrayPoint(fromId: string, toId: string): [number, number] {
    const from = presentationFor(fromId).cameraFocus, to = presentationFor(toId).cameraFocus;
    return [Math.max(82, Math.min(WORLD_WIDTH - 82, (from[0] + to[0]) / 2)), Math.max(54, Math.min(WORLD_HEIGHT - 54, (from[1] + to[1]) / 2 - 38))];
  }

  private animateAnticipation(territoryId: string, durationMs: number, signal: AbortSignal) {
    const state = this.current!.state, territory = state.territories[territoryId];
    const pieces = this.armyLayer.children.filter((child) => child.label === `army:${territoryId}`)
      .map((token) => ({ token, x: token.x, y: token.y, rotation: token.rotation }));
    const point = presentationFor(territoryId).cameraFocus;
    const garrison = this.effectLabel(`${territory?.troops ?? 0} READY · KEEP A GARRISON`, 0xf1d48c, 130);
    garrison.position.set(point[0], point[1] + 22); this.effectsLayer.addChild(garrison);
    return this.animate(durationMs, signal, (p) => {
      const lift = Math.sin(p * Math.PI);
      pieces.forEach(({ token, x, y, rotation }, index) => { if (pieces.length > 1 && index === 0) return; token.position.set(x + lift * 2, y - lift * 3); token.rotation = rotation + lift * 0.12; });
    }, () => { pieces.forEach(({ token, x, y, rotation }) => { if (!token.destroyed) { token.position.set(x, y); token.rotation = rotation; } }); garrison.destroy({ children: true, context: true }); });
  }

  private async animateRecruitment(command: Extract<SceneCommand, {type: "recruitment.show"}>, durationMs: number, signal: AbortSignal) {
    const sources = Object.entries(this.current!.state.territories).filter(([, territory]) => territory.controller === command.playerId);
    const contributions = [
      {label: `${sources.length} TERRITORIES + ${command.population} POPULATION → ${command.fromTerritories} TROOPS`, amount: command.fromTerritories, ids: sources.map(([id]) => id)},
      ...command.continents.map((continent) => ({label: `${continent.id.replace(/_/g, " ").toUpperCase()} +${continent.total}`, amount: continent.total, ids: manifest.territories.filter((territory) => territory.continent === continent.id).map((territory) => territory.id)})),
    ];
    let accumulated = 0;
    for (const contribution of contributions) {
      if (signal.aborted) break;
      const group = new Container();
      contribution.ids.forEach((id) => group.addChild(pathGraphic(id, 0x96d4b8, 0.23, {color: 0xa9e4cf, width: 1.2, alpha: 0.9})));
      const point = contribution.ids.length ? presentationFor(contribution.ids[0]).cameraFocus : [WORLD_WIDTH / 2, WORLD_HEIGHT / 2] as const;
      accumulated += contribution.amount;
      const label = this.effectLabel(`${contribution.label} · RESERVE ${accumulated}`, 0xa9e4cf, 300);
      label.position.set(WORLD_WIDTH / 2, 32); group.addChild(label); this.effectsLayer.addChild(group);
      const stageDuration = durationMs / contributions.length;
      const highlight = this.animate(stageDuration, signal, (p) => { group.alpha = Math.min(1, p * 5) * Math.min(1, (1 - p) * 5); }, () => group.destroy({children: true, context: true}));
      const reserve = this.uiDestination("reserve", command.playerId);
      await Promise.all([highlight, ...(reserve ? [this.animateScreenFlight(this.boardClient(point), reserve, "army", `+${contribution.amount} · RESERVE ${accumulated}`, stageDuration, signal)] : [])]);
    }
  }

  private animateHandoff(command: Extract<SceneCommand, {type: "turn.handoff"}>, durationMs: number, signal: AbortSignal) {
    const playerAnchor = this.uiDestination("player", command.playerId);
    if (playerAnchor) return this.animateScreenFlight(playerAnchor, playerAnchor, "seal", `${this.playerName(command.playerId)} · ${command.stage === "start" ? "YOUR TURN" : "TURN COMPLETE"}`, durationMs, signal);
    const station = this.playerStation(command.playerId);
    const marker = this.effectLabel(`${this.playerName(command.playerId)} · ${command.stage === "start" ? "YOUR TURN" : "TURN COMPLETE"}`, 0xf2d48f, 180);
    this.effectsLayer.addChild(marker);
    return this.animate(durationMs, signal, (p) => { const travel = Math.min(1, p * 2); marker.position.set(WORLD_WIDTH / 2 + (station[0] - WORLD_WIDTH / 2) * travel, WORLD_HEIGHT - 46 + (station[1] - WORLD_HEIGHT + 46) * travel); marker.alpha = Math.min(1, p * 5) * Math.min(1, (1 - p) * 5); }, () => marker.destroy({ children: true, context: true }));
  }

  private animateClaim(command: Extract<SceneCommand, { type: "setup.claim" }>, durationMs: number, signal: AbortSignal) {
    const definition = presentationFor(command.territoryId);
    const hq = this.hqMark(command.factionId, definition.hqSlot, definition.profile);
    const baseScale = hq.scale.x;
    this.effectsLayer.addChild(hq);
    const stamp = this.animate(durationMs, signal, (p) => {
      const settle = Math.min(1, p / 0.6);
      hq.y = definition.hqSlot[1] - (1 - settle) * 35;
      hq.scale.set(baseScale * (1 + (1 - settle) * 0.25));
      hq.alpha = Math.min(1, p * 4);
    }, () => hq.destroy({ children: true, context: true }));
    return Promise.all([stamp, this.animatePlacement(command.territoryId, command.playerId, durationMs, signal, command.count), this.animateConquest(command.territoryId, command.playerId, durationMs, signal)]).then(() => undefined);
  }

  private effectLabel(text: string, color = 0xf1dfb4, maxWidth = 220) {
    const group = new Container();
    group.eventMode = "none";
    const label = this.tableText({ text, style: { fill: color, fontFamily: "monospace", fontSize: 7, fontWeight: "800", align: "center", wordWrap: true, wordWrapWidth: maxWidth } });
    label.anchor.set(0.5);
    const plate = new Graphics().roundRect(-label.width / 2 - 6, -label.height / 2 - 4, label.width + 12, label.height + 8, 3).fill({ color: 0x111b23, alpha: 0.96 }).stroke({ color, width: 0.65, alpha: 0.7 });
    group.addChild(plate, label);
    return group;
  }

  private animateNotice(title: string, lines: string[], durationMs: number, signal: AbortSignal, territoryId?: string) {
    const group = new Container();
    group.eventMode = "none";
    const titleLabel = this.effectLabel(title.toUpperCase(), 0xf1d48c, 310);
    group.addChild(titleLabel);
    lines.slice(0, 6).forEach((line, index) => {
      const label = this.effectLabel(line, 0xdae2df, 310);
      label.y = 24 + index * 22;
      group.addChild(label);
    });
    const point = territoryId ? presentationFor(territoryId).cameraFocus : [WORLD_WIDTH / 2, 32];
    group.position.set(point[0], point[1]);
    this.effectsLayer.addChild(group);
    return this.animate(durationMs, signal, (p) => {
      group.alpha = Math.min(1, p * 6) * Math.min(1, (1 - p) * 6);
      group.y = point[1] - (1 - Math.min(1, p * 4)) * 6;
    }, () => group.destroy({ children: true, context: true }));
  }

  private animateConquest(territoryId: string, playerId: string, durationMs: number, signal: AbortSignal) {
    const factionId = this.current!.state.players[playerId]?.factionId;
    const color = colorNumber(factionId ? factionDefinitionById(factionId, this.current!.state.unlockedModules)?.color : undefined);
    const ink = pathGraphic(territoryId, color, 0.45, { color, width: 2, alpha: 0.9 });
    const mask = new Graphics();
    const point = presentationFor(territoryId).cameraFocus;
    ink.mask = mask;
    this.effectsLayer.addChild(ink, mask);
    return this.animate(durationMs, signal, (p) => {
      mask.clear().ellipse(point[0], point[1], 1 + p * 170, 1 + p * 120).fill(0xffffff);
      ink.alpha = Math.min(1, p * 5);
    }, () => { ink.destroy(); mask.destroy(); });
  }

  private animateCity(territoryId: string, cityType: string, name: string, durationMs: number, signal: AbortSignal) {
    const definition = presentationFor(territoryId);
    const key = (cityType === "ruin" ? "ruin" : `city.${cityType}.base`) as ArchitectureAtlasKey;
    if (!this.architectureTextures.has(key)) return this.animateNotice(name || cityType, [], durationMs, signal, territoryId);
    const city = this.architectureSprite(key, definition.profile);
    const point = definition.architectureSlot;
    const label = this.effectLabel(name || cityType.toUpperCase(), 0xa8dded, 120);
    label.position.set(point[0], point[1] + 24);
    this.effectsLayer.addChild(city, label);
    return this.animate(durationMs, signal, (p) => {
      const settle = 1 - Math.pow(1 - Math.min(1, p / 0.6), 3);
      city.position.set(point[0], point[1] - (1 - settle) * 28);
      city.rotation = (1 - settle) * -0.1;
      label.alpha = Math.max(0, Math.min(1, (p - 0.55) * 4));
    }, () => { city.destroy(); label.destroy({ children: true, context: true }); });
  }

  private animateFortification(territoryId: string, remaining: number, durationMs: number, signal: AbortSignal, damage = false) {
    const group = new Container();
    group.position.set(...presentationFor(territoryId).architectureSlot);
    const walls = Array.from({ length: 8 }, (_, index) => {
      const wall = new Graphics().roundRect(-4, -2, 8, 4, 1).fill(remaining > 0 ? 0xc5b28b : 0x62584a).stroke({ color: 0xf3dcac, width: 0.5 });
      const angle = index * Math.PI / 4;
      wall.position.set(Math.cos(angle) * 20, Math.sin(angle) * 13);
      wall.rotation = angle + Math.PI / 2;
      group.addChild(wall);
      return wall;
    });
    const label = this.effectLabel(remaining > 0 ? `DEFENSE ${remaining}` : "DEFENSE EXHAUSTED", 0xe5cea0);
    label.y = 29;
    group.addChild(label);
    this.effectsLayer.addChild(group);
    return this.animate(durationMs, signal, (p) => {
      walls.forEach((wall, index) => {
        const local = Math.max(0, Math.min(1, p * 2 - index * 0.09));
        if (damage) {
          const prior = this.current!.state.territories[territoryId]?.fortification?.remaining ?? remaining + 1;
          const lost = index >= Math.floor(8 * remaining / Math.max(1, prior));
          wall.alpha = lost ? 1 - local : 1;
          wall.rotation = index * Math.PI / 4 + Math.PI / 2 + (lost ? local * 0.7 : 0);
          wall.y = Math.sin(index * Math.PI / 4) * 13 + (lost ? local * local * 10 : 0);
        } else { wall.alpha = local; wall.scale.set(1.8 - local * 0.8); }
      });
      label.alpha = Math.min(1, p * 3);
    }, () => group.destroy({ children: true, context: true }));
  }

  private animateDice(command: Extract<SceneCommand, { type: "battle.dice" | "battle.compare" }>, durationMs: number, signal: AbortSignal) {
    const group = new Container();
    group.position.set(...this.diceTrayPoint(command.from, command.to));
    group.addChild(new Graphics().roundRect(-72, -40, 144, 84, 7).fill({ color: 0x101821, alpha: 0.97 }).stroke({ color: 0xcab48a, width: 1 }));
    const dice: Container[] = [];
    [command.attack, command.defense].forEach((values, side) => {
      const sideLabel = this.effectLabel(side === 0 ? "ATTACK" : "DEFEND", side === 0 ? 0xf4a28d : 0x96cce9);
      sideLabel.position.set(side === 0 ? -35 : 35, -29);
      group.addChild(sideLabel);
      values.slice(0, 3).forEach((value, index) => {
        const die = new Container();
        die.addChild(new Graphics().roundRect(-9, -9, 18, 18, 3).fill(side === 0 ? 0xa8473e : 0xd9e1df).stroke({ color: 0xf8e8c7, width: 0.8 }));
        const number = this.tableText({ text: String(value), style: { fill: side === 0 ? 0xfff4db : 0x132c3e, fontFamily: "monospace", fontSize: 12, fontWeight: "900" } });
        number.anchor.set(0.5);
        die.addChild(number);
        die.position.set(side === 0 ? -35 : 35, -8 + index * 21);
        dice.push(die);
        group.addChild(die);
        if (command.type === "battle.compare" && side === 0 && command.comparisons[index]) {
          const comparison = command.comparisons[index];
          const label = this.tableText({ text: comparison.att === comparison.def ? `= ${comparison.winner === "att" ? "ATT" : "DEF"}` : comparison.winner === "att" ? "→" : "←", style: { fill: comparison.winner === "att" ? 0xffaa92 : 0x99d4ef, fontFamily: "monospace", fontSize: 8, fontWeight: "900" } });
          label.anchor.set(0.5); label.y = -8 + index * 21; group.addChild(label);
        }
      });
    });
    this.effectsLayer.addChild(group);
    return this.animate(durationMs, signal, (p) => {
      group.alpha = Math.min(1, p * 8) * Math.min(1, (1 - p) * 8);
      dice.forEach((die, index) => { const tumble = command.type === "battle.dice" ? Math.max(0, 1 - p / 0.65) : 0; die.rotation = Math.sin(p * 22 + index) * tumble * 0.65; die.scale.set(1 + tumble * 0.2); });
    }, () => group.destroy({ children: true, context: true }));
  }

  private animateDieModifier(command: Extract<SceneCommand, {type: "battle.modify"}>, durationMs: number, signal: AbortSignal) {
    const actualDie = this.uiDestination("die", undefined, `${command.side}:${command.dieIndex}`);
    if (actualDie) return this.animateScreenFlight(this.boardClient(presentationFor(command.side === "att" ? command.from : command.to).cameraFocus), actualDie, "power", `${command.source.replace(/_/g, " ")} · ${command.naturalValue} → ${command.finalValue}`, durationMs, signal);
    const tray = this.diceTrayPoint(command.from, command.to);
    const point = [tray[0] + (command.side === "att" ? -35 : 35), tray[1] - 8 + command.dieIndex * 21];
    const source = presentationFor(command.side === "att" ? command.from : command.to).cameraFocus;
    const group = new Container();
    const line = new Graphics().moveTo(...source).lineTo(point[0], point[1]).stroke({ color: 0xf1d48c, width: 1.3, alpha: 0.8 });
    const die = new Graphics().roundRect(-11, -11, 22, 22, 3).fill(0x293d47).stroke({ color: 0xffd87b, width: 2 });
    die.position.set(point[0], point[1]);
    const value = this.tableText({ text: String(command.naturalValue), style: { fill: 0xffedc2, fontFamily: "monospace", fontSize: 13, fontWeight: "900" } });
    value.anchor.set(0.5); value.position.set(point[0], point[1]);
    const label = this.effectLabel(`${command.source.replace(/_/g, " ")} · ${command.naturalValue} → ${command.finalValue}`, 0xf1d48c, 170);
    label.position.set(point[0], point[1] + 26);
    group.addChild(line, die, value, label); this.effectsLayer.addChild(group);
    return this.animate(durationMs, signal, (p) => { if (p >= 0.45 && value.text !== String(command.finalValue)) value.text = String(command.finalValue); group.alpha = Math.min(1, p * 5) * Math.min(1, (1 - p) * 5); die.scale.set(1 + Math.sin(p * Math.PI) * 0.12); }, () => group.destroy({ children: true, context: true }));
  }

  private animateAward(playerId: string, territoryId: string | undefined, text: string, durationMs: number, signal: AbortSignal) {
    const score = this.uiDestination("score", playerId);
    const origin = territoryId ? this.boardClient(presentationFor(territoryId).cameraFocus) : this.uiAnchor("player", playerId);
    if (score && origin) return this.animateScreenFlight(origin, score, "star", text, durationMs, signal);
    const group = new Container();
    const points: number[] = [];
    for (let index = 0; index < 10; index++) { const angle = -Math.PI / 2 + index * Math.PI / 5, radius = index % 2 ? 8 : 18; points.push(Math.cos(angle) * radius, Math.sin(angle) * radius); }
    const star = new Graphics().poly(points).fill(0xb54535).stroke({ color: 0xffd87b, width: 2 });
    const label = this.effectLabel(`${this.playerName(playerId)} · ${text}`, 0xffd87b);
    label.y = 32; group.addChild(star, label);
    const start = territoryId ? presentationFor(territoryId).cameraFocus : [WORLD_WIDTH / 2, WORLD_HEIGHT / 2];
    this.effectsLayer.addChild(group);
    const station = this.playerStation(playerId); label.y = -32;
    return this.animate(durationMs, signal, (p) => { const arrive = Math.min(1, p * 2); group.position.set(start[0] + (station[0] - start[0]) * arrive, start[1] + (station[1] - start[1]) * arrive); star.rotation = (1 - arrive) * -0.35; group.alpha = Math.min(1, p * 5) * Math.min(1, (1 - p) * 5); }, () => group.destroy({ children: true, context: true }));
  }

  private animateMissile(command: Extract<SceneCommand, { type: "missile.commit" }>, durationMs: number, signal: AbortSignal) {
    const attribution = `${command.playerId ? this.playerName(command.playerId) : "MISSILE"} INTERVENED`;
    const dieAnchor = this.uiDestination("die", undefined, `${command.side}:${command.dieIndex ?? 0}`);
    const stationAnchor = command.playerId ? this.uiAnchor("player", command.playerId) : undefined;
    if (dieAnchor && stationAnchor) return this.animateScreenFlight(stationAnchor, dieAnchor, "power", `${attribution} · ${command.naturalValue ?? "?"} → 6`, durationMs, signal, 1, "#ffbc75");
    const group = new Container();
    const tray = this.diceTrayPoint(command.from, command.to);
    const end = [tray[0] + (command.side === "att" ? -35 : 35), tray[1] - 8 + (command.dieIndex ?? 0) * 21];
    const start = command.playerId ? this.playerStation(command.playerId) : [WORLD_WIDTH / 2, WORLD_HEIGHT - 20];
    const rocket = new Graphics().poly([0, -8, 3, 2, 0, 0, -3, 2]).fill(0xffe5ae);
    rocket.rotation = Math.atan2(end[1] - start[1], end[0] - start[0]) + Math.PI / 2;
    const trail = new Graphics();
    const die = this.effectLabel(`${command.side === "att" ? "ATT" : "DEF"} DIE ${(command.dieIndex ?? 0) + 1} · ${command.naturalValue ?? "?"} → 6`, 0xffcc7c);
    die.position.set(end[0], end[1] - 22);
    group.addChild(trail, rocket, die); this.effectsLayer.addChild(group);
    const flight = this.animate(durationMs, signal, (p) => {
      const travel = Math.min(1, p / 0.55), x = start[0] + (end[0] - start[0]) * travel, y = start[1] + (end[1] - start[1]) * travel;
      rocket.position.set(x, y);
      trail.clear().moveTo(start[0], start[1]).quadraticCurveTo((start[0] + x) / 2, y + 18, x, y).stroke({ color: 0xffcd79, width: 1.5, alpha: (1 - p) * 0.8 });
      rocket.alpha = p < 0.6 ? 1 : 0; die.alpha = Math.max(0, Math.min(1, (p - 0.45) * 6));
    }, () => group.destroy({ children: true, context: true }));
    return Promise.all([flight, this.animateNotice(attribution, [], durationMs, signal)]).then(() => undefined);
  }

  private animateCards(command: Extract<SceneCommand, { type: "cards.transfer" }>, durationMs: number, signal: AbortSignal) {
    if (command.kind === "refill") {
      const flights: Promise<void>[] = [];
      for (let slot = command.slot ?? 3; slot > 0; slot--) {
        const from = this.uiAnchor("sideboard", undefined, String(slot - 1)), to = this.uiDestination("sideboard", undefined, String(slot));
        if (from && to) flights.push(this.animateScreenFlight(from, to, "card", "SIDEBOARD", durationMs, signal));
      }
      const draw = this.uiAnchor("draw"), first = this.uiDestination("sideboard", undefined, "0");
      if (draw && first) flights.push(this.animateScreenFlight(draw, first, "card", "REFILL", durationMs, signal));
      if (flights.length) return Promise.all(flights).then(() => undefined);
    } else {
      const source = command.kind === "draw" ? this.uiAnchor(command.source === "coin" ? "coin" : "sideboard", undefined, command.slot === undefined ? undefined : String(command.slot)) ?? this.uiAnchor("draw") : this.uiAnchor("card", command.playerId, command.cardIds?.[0]) ?? this.uiAnchor("hand", command.playerId);
      const destination = command.kind === "draw" ? this.uiDestination("hand", command.playerId) : command.kind === "upgrade" ? source : this.uiDestination("discard") ?? (command.kind === "destroy" ? source : undefined);
      if (source && destination) {
        const ids = command.cardIds?.length ? command.cardIds.slice(0, 5) : [undefined];
        return Promise.all(ids.map((id, index) => {
          const origin = command.kind !== "draw" && id ? this.uiAnchor("card", command.playerId, id) ?? source : source;
          const definition = id ? contentPack.cards.territoryCards.find((card) => card.id === id) : undefined;
          const face = definition ? manifest.territories.find((territory) => territory.id === definition.territoryId)?.name : id && contentPack.cards.coinCards.some((card) => card.id === id) ? "COIN" : undefined;
          return this.animateScreenFlight(origin, destination, command.kind === "destroy" ? "tear" : "card", index === 0 ? `${command.kind.toUpperCase()}${command.troops === undefined ? "" : ` · +${command.troops} TROOPS`}${command.resources === undefined ? "" : ` · VALUE ${command.resources}`}` : "", durationMs, signal, id ? 1 : command.count, "#f1d48c", command.kind === "upgrade" ? `VALUE ${command.resources ?? "+1"}` : face);
        })).then(() => undefined);
      }
    }
    const group = new Container();
    const tornHalves: Graphics[] = [];
    const cards = Array.from({ length: Math.min(5, Math.max(1, command.count)) }, (_, index) => {
      const card = new Graphics().roundRect(-15, -23, 30, 46, 3).fill(0xd7c8a7).stroke({ color: 0x7a6140, width: 1.4 }).roundRect(-10, -18, 20, 36, 2).stroke({ color: 0x7a6140, width: 1 });
      card.position.set(index * 16, 0); card.rotation = (index - 1) * 0.08; group.addChild(card); return card;
    });
    group.position.set(WORLD_WIDTH / 2 - cards.length * 8, WORLD_HEIGHT / 2);
    if (command.kind === "destroy") {
      for (const direction of [-1, 1]) {
        const half = new Graphics().poly([0, -23, direction * 15, -23, direction * 15, 23, 0, 23, direction * 3, 13, 0, 4, direction * 3, -5, 0, -13]).fill(0xd7c8a7).stroke({ color: 0x7a6140, width: 0.8 });
        group.addChild(half); tornHalves.push(half);
      }
    }
    const detail = command.troops === undefined ? command.resources === undefined ? `${command.count} card${command.count === 1 ? "" : "s"}` : `${command.resources} resources` : `+${command.troops} reinforcements`;
    const label = this.effectLabel(`${command.kind.toUpperCase()} · ${detail}`, 0xf2d48f);
    label.position.set(0, 45); group.addChild(label); this.effectsLayer.addChild(group);
    const stamp = command.kind === "upgrade" ? this.effectLabel(`VALUE ${command.resources ?? "+1"}`, 0xc76a47) : undefined;
    if (stamp) group.addChild(stamp);
    const station = this.playerStation(command.playerId);
    return this.animate(durationMs, signal, (p) => {
      const travel = command.kind === "draw" ? p : 1 - p;
      group.position.set(WORLD_WIDTH / 2 + (station[0] - WORLD_WIDTH / 2) * travel, WORLD_HEIGHT / 2 + (station[1] - 42 - WORLD_HEIGHT / 2) * travel);
      cards.forEach((card, index) => { const local = Math.max(0, Math.min(1, p * 1.4 - index * 0.06)); card.y = command.kind === "draw" ? (1 - local) * -50 : local * 24; card.x = index * 16 * (1 - local * 0.7); card.rotation = command.kind === "destroy" ? local * (index % 2 ? 0.7 : -0.7) : (index - 1) * 0.08 * (1 - local); card.alpha = command.kind === "destroy" ? 1 - local : 1; });
      group.alpha = Math.min(1, p * 5) * Math.min(1, (1 - p) * 5);
      if (command.kind === "destroy") {
        cards.forEach((card) => { card.visible = false; });
        tornHalves.forEach((half, index) => { const direction = index ? 1 : -1; half.x = direction * p * 26; half.y = p * p * 30; half.rotation = direction * p * 0.35; });
      }
      if (stamp) { const settled = Math.min(1, p * 2); stamp.scale.set(1.6 - settled * 0.6); stamp.rotation = -0.1; stamp.alpha = settled; }
    }, () => group.destroy({ children: true, context: true }));
  }

  private animateIsland(command: Extract<SceneCommand, { type: "alienIsland.place" }>, durationMs: number, signal: AbortSignal) {
    const group = new Container();
    const point = presentationFor(command.territoryId).cameraFocus;
    const island = new Graphics().poly([-25, 8, -20, -12, -8, -20, 3, -14, 13, -20, 25, -5, 18, 13, 4, 19, -11, 15]).fill(0x467d7a).stroke({ color: 0xb9f0df, width: 2 });
    island.position.set(...point); group.addChild(island);
    const routes = new Graphics();
    for (const route of alienIslandRouteModels(command.connections)) routes.moveTo(...route.start).quadraticCurveTo(...route.control, ...route.end);
    routes.stroke({ color: 0x8de5dc, width: 2, alpha: 0.8 }); group.addChild(routes); this.effectsLayer.addChild(group);
    return this.animate(durationMs, signal, (p) => { island.scale.set(0.5 + Math.min(1, p * 2) * 0.5); island.alpha = Math.min(1, p * 3); island.y = point[1] + (1 - Math.min(1, p * 2)) * 18; routes.alpha = Math.max(0, (p - 0.4) / 0.6); }, () => group.destroy({ children: true, context: true }));
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
      activeParticles: this.effectsLayer.children.length + this.flightCanvases.size,
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
      displayedRevision: this.current?.revision,
      displayedWorldName: this.current?.state.worldName,
      displayedTerritories: Object.fromEntries(Object.entries(this.current?.state.territories ?? {}).map(([id, territory]) => [id, {troops: territory.troops, controller: territory.controller}])),
    };
  }

  dispose() {
    this.reserveCanvas?.remove(); this.reserveCanvas = undefined;
    this.flightCanvases?.forEach((canvas) => canvas.remove());
    this.flightCanvases?.clear();
    // Invalidate pending atlas callbacks before destroying their target layers.
    this.current = undefined;
    delete (globalThis as any).__riskTableDiagnostics;
    this.cleanup.splice(0).forEach((cleanup) => cleanup());
    this.app.destroy({ removeView: true }, { children: true, context: true, texture: false, textureSource: false });
    this.mounted = false;
  }
}

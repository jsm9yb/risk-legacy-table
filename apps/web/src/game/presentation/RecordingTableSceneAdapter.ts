import type { GameState } from "@risk/rules";
import type { PresentationClock } from "./PresentationClock.ts";
import type { TableScene } from "./TableScene.ts";
import type { SceneCommand, TableInteractionModel, TableRenderModel, TableSceneDiagnostics, TableViewport } from "./types.ts";

const describe = (command: SceneCommand): string => {
  switch (command.type) {
    case "camera.frame": return `camera.frame ${command.from ?? "board"} -> ${command.to ?? "board"}`;
    case "army.anticipate": return `army.anticipate ${command.territoryId}`;
    case "army.place": return `army.place ${command.territoryId} count=${command.count}`;
    case "army.move": return `army.move ${command.from} -> ${command.to} count=${command.count} tone=${command.tone}`;
    case "army.remove": return `army.remove ${command.territoryId} count=${command.count} side=${command.side}`;
    case "battle.dice": return `battle.dice ${command.from} -> ${command.to} att=${command.attack.join(",")} def=${command.defense.join(",")}`;
    case "battle.impact": return `battle.impact ${command.from} -> ${command.to}`;
    case "territory.conquest": return `territory.conquest ${command.territoryId} player=${command.playerId}`;
    case "scar.apply": return `scar.apply ${command.territoryId} scar=${command.scarId}`;
    case "city.place": return `city.place ${command.territoryId} type=${command.cityType}`;
    case "city.fortify": return `city.fortify ${command.territoryId}`;
    case "hq.move": return `hq.move ${command.from} -> ${command.to} faction=${command.factionId}`;
    case "redStar.gain": return `redStar.gain player=${command.playerId}`;
    case "missile.commit": return `missile.commit ${command.from} -> ${command.to} side=${command.side}`;
    case "module.reveal": return `module.reveal ${command.moduleId}`;
    case "nuclear.resolve": return `nuclear.resolve ${command.territories.join(",")}`;
    case "alienIsland.place": return `alienIsland.place ${command.territoryId}`;
    case "phase.change": return `phase.change ${command.phase}`;
    case "game.victory": return `game.victory ${command.playerId}`;
    case "legacy.ritual": return `legacy.ritual ${command.ritual}${command.territoryId ? ` ${command.territoryId}` : ""}`;
    case "table.resync": return `table.resync ${command.reason}`;
  }
};

export class RecordingTableSceneAdapter implements TableScene {
  readonly records: string[] = [];
  current?: GameState;
  constructor(private readonly clock?: PresentationClock) {}
  async mount(_host: HTMLElement, initial: TableRenderModel) { this.current = initial.state; this.records.push(`mount seq=${initial.revision}`); }
  apply(model: TableRenderModel) { this.current = model.state; this.records.push(`apply seq=${model.revision}`); }
  async execute(command: SceneCommand, signal: AbortSignal, durationMs: number) {
    if (!signal.aborted) this.records.push(describe(command));
    if (this.clock) await this.clock.wait(durationMs, signal);
  }
  setInteraction(model: TableInteractionModel) {
    this.records.push(`interaction selected=${model.selectedTerritoryId ?? "none"} emphasized=${model.emphasizedTerritoryId ?? "none"} resources=${Object.keys(model.resourceValues ?? {}).length}`);
  }
  resize(viewport: TableViewport) { this.records.push(`resize ${viewport.width}x${viewport.height}@${viewport.devicePixelRatio}`); }
  async captureDiagnostics(): Promise<TableSceneDiagnostics> { return { renderer: "recording", quality: "balanced", texturesBytes: 0, activeSprites: 0, activeParticles: 0, contextLosses: 0 }; }
  dispose() { this.records.push("dispose"); }
}

import type {
  SceneCommand,
  TableInteractionModel,
  TableRenderModel,
  TableSceneDiagnostics,
  TableViewport,
} from "./types.ts";

export interface TableScene {
  mount(host: HTMLElement, initial: TableRenderModel): Promise<void>;
  apply(model: TableRenderModel): void;
  execute(command: SceneCommand, signal: AbortSignal, durationMs: number): Promise<void>;
  setInteraction(model: TableInteractionModel): void;
  resize(viewport: TableViewport): void;
  captureDiagnostics(): Promise<TableSceneDiagnostics>;
  dispose(): void;
}


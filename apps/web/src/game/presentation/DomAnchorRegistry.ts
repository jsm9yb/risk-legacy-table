export type UIAnchorKind = "player" | "hand" | "card" | "discard" | "score" | "reserve" | "faction" | "sideboard" | "draw" | "coin" | "die" | "setup-order";
export interface UIAnchorPoint { clientX: number; clientY: number; width: number; height: number }

/** DOM rectangles stay in client coordinates. The renderer converts board points
 * to the same space; UI endpoints must never be approximated as board stations. */
export class DomAnchorRegistry {
  private retained = new Map<string, { point: UIAnchorPoint; priority: number }>();
  private attached = false;
  private readonly captureBeforeInput = () => this.capture();
  private readonly invalidateGeometry = () => this.clear();
  private viewport = viewportKey();
  constructor(private readonly root: ParentNode = document) {}

  /** Capture before local decisions remove a source card from the DOM. */
  attach(): void {
    if (this.attached) return;
    this.attached = true;
    const target = this.root as Node;
    target.addEventListener("pointerdown", this.captureBeforeInput, true);
    target.addEventListener("keydown", this.captureBeforeInput, true);
    target.addEventListener("scroll", this.invalidateGeometry, true);
    window.addEventListener("resize", this.invalidateGeometry);
    this.capture();
  }

  dispose(): void {
    const target = this.root as Node;
    target.removeEventListener("pointerdown", this.captureBeforeInput, true);
    target.removeEventListener("keydown", this.captureBeforeInput, true);
    target.removeEventListener("scroll", this.invalidateGeometry, true);
    window.removeEventListener("resize", this.invalidateGeometry);
    this.attached = false;
    this.clear();
  }

  capture(): void {
    this.checkViewport();
    for (const [key, entry] of this.measureLive()) {
      // Keep the actual interactive source when a priority-2 decision disappears
      // and its less prominent sidebar duplicate remains mounted afterward.
      if ((this.retained.get(key)?.priority ?? -Infinity) <= entry.priority) this.retained.set(key, entry);
    }
  }

  private measureLive() {
    const live = new Map<string, { point: UIAnchorPoint; priority: number }>();
    for (const element of this.root.querySelectorAll<HTMLElement>("[data-table-anchor]")) {
      const point = visibleAnchor(element);
      if (!point) continue;
      const key = anchorKey(element.dataset.tableAnchor!, element.dataset.playerId, element.dataset.anchorId);
      const priority = Number(element.dataset.anchorPriority ?? 0);
      if ((live.get(key)?.priority ?? -Infinity) <= priority) live.set(key, { point, priority });
    }
    return live;
  }

  /** Neutral/default lookup is always a currently visible destination. */
  resolve(kind: UIAnchorKind, playerId?: string, anchorId?: string): UIAnchorPoint | undefined {
    return this.resolveLive(kind, playerId, anchorId);
  }

  resolveLive(kind: UIAnchorKind, playerId?: string, anchorId?: string): UIAnchorPoint | undefined {
    this.checkViewport();
    return this.measureLive().get(anchorKey(kind, playerId, anchorId))?.point;
  }

  /** Explicitly opt into a captured origin for a card/die/faction just removed
   * by the accepted action. Never use this to locate an arrival destination. */
  resolveSource(kind: UIAnchorKind, playerId?: string, anchorId?: string): UIAnchorPoint | undefined {
    this.checkViewport();
    return this.retained.get(anchorKey(kind, playerId, anchorId))?.point ?? this.resolveLive(kind, playerId, anchorId);
  }

  private checkViewport(): void {
    if (this.viewport !== viewportKey()) this.clear();
  }

  /** A new game/viewer must not inherit another player's old hand endpoints. */
  clear(): void { this.retained.clear(); this.viewport = viewportKey(); }
}

function viewportKey() { return `${window.innerWidth}:${window.innerHeight}:${window.scrollX}:${window.scrollY}`; }

function anchorKey(kind: string, playerId?: string, anchorId?: string) {
  return JSON.stringify([kind, playerId ?? "", anchorId ?? ""]);
}

function visibleAnchor(element: HTMLElement): UIAnchorPoint | undefined {
  if (!element.isConnected) return undefined;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return undefined;
  let left = Math.max(0, rect.left), top = Math.max(0, rect.top);
  let right = Math.min(window.innerWidth, rect.right), bottom = Math.min(window.innerHeight, rect.bottom);
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.hidden) return undefined;
    const style = getComputedStyle(ancestor);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return undefined;
    if (ancestor !== element && /(auto|scroll|hidden|clip)/.test(`${style.overflow} ${style.overflowX} ${style.overflowY}`)) {
      const clip = ancestor.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(`${style.overflow} ${style.overflowX}`)) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); }
      if (/(auto|scroll|hidden|clip)/.test(`${style.overflow} ${style.overflowY}`)) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
    }
  }
  if (right <= left || bottom <= top) return undefined;
  return { clientX: (left + right) / 2, clientY: (top + bottom) / 2, width: right - left, height: bottom - top };
}

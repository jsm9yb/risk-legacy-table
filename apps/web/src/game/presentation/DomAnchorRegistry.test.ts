// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { DomAnchorRegistry } from "./DomAnchorRegistry.ts";

afterEach(() => document.body.replaceChildren());

function rect(element: HTMLElement, left: number, top: number, width: number, height: number) {
  element.getBoundingClientRect = () => ({ left, top, right: left + width, bottom: top + height, width, height, x: left, y: top, toJSON() {} });
}

function anchor(kind: string, playerId?: string, id?: string) {
  const element = document.createElement("div");
  element.dataset.tableAnchor = kind;
  if (playerId) element.dataset.playerId = playerId;
  if (id) element.dataset.anchorId = id;
  document.body.append(element);
  rect(element, 100, 200, 60, 80);
  return element;
}

describe("actual DOM presentation endpoints", () => {
  it("uses visible prioritized UI bounds and retains removed card origins", () => {
    const station = anchor("hand", "p1");
    const hand = anchor("hand", "p1");
    hand.dataset.anchorPriority = "2";
    rect(hand, 300, 400, 100, 40);
    const card = anchor("card", "p1", "alaska");
    const registry = new DomAnchorRegistry(document);
    registry.capture();
    expect(registry.resolve("hand", "p1")).toEqual({ clientX: 350, clientY: 420, width: 100, height: 40 });
    card.remove();
    expect(registry.resolve("card", "p1", "alaska")).toBeUndefined();
    expect(registry.resolveSource("card", "p1", "alaska")).toEqual({ clientX: 130, clientY: 240, width: 60, height: 80 });
    hand.hidden = true;
    expect(registry.resolve("hand", "p1")?.clientX).toBe(130);
    station.remove();
    registry.clear();
    expect(registry.resolve("card", "p1", "alaska")).toBeUndefined();
  });

  it("clips to the real scrolling viewport and never fabricates unseen endpoints", () => {
    const scroll = document.createElement("div");
    scroll.style.overflow = "auto";
    document.body.append(scroll);
    rect(scroll, 90, 190, 50, 50);
    const card = anchor("card", "p1", "alaska");
    scroll.append(card);
    const registry = new DomAnchorRegistry(document);
    expect(registry.resolve("card", "p1", "alaska")).toEqual({ clientX: 120, clientY: 220, width: 40, height: 40 });
    const unseen = anchor("card", "p1", "brazil");
    unseen.hidden = true;
    expect(registry.resolve("card", "p1", "brazil")).toBeUndefined();
    expect(registry.resolve("score", "p2")).toBeUndefined();
  });

  it("captures a source before local input removes it and disconnects cleanly", () => {
    const faction = anchor("faction", undefined, "enclave");
    const registry = new DomAnchorRegistry(document);
    registry.attach();
    rect(faction, 450, 300, 200, 120);
    faction.addEventListener("pointerdown", () => faction.remove());
    faction.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(registry.resolveSource("faction", undefined, "enclave")).toEqual({ clientX: 550, clientY: 360, width: 200, height: 120 });
    registry.dispose();
    expect(registry.resolve("faction", undefined, "enclave")).toBeUndefined();
  });

  it("never uses a closed drawer's score as a destination and invalidates origins after scroll/resize", () => {
    const score = anchor("score", "p2");
    const card = anchor("card", "p1", "alaska");
    const registry = new DomAnchorRegistry(document);
    registry.attach();
    score.hidden = true;
    card.remove();
    expect(registry.resolveLive("score", "p2")).toBeUndefined();
    expect(registry.resolveSource("card", "p1", "alaska")).toBeDefined();
    document.body.dispatchEvent(new Event("scroll"));
    expect(registry.resolveSource("card", "p1", "alaska")).toBeUndefined();
    score.hidden = false;
    registry.capture();
    score.hidden = true;
    window.dispatchEvent(new Event("resize"));
    expect(registry.resolveSource("score", "p2")).toBeUndefined();
    registry.dispose();
  });

  it("retains the clicked high-priority source while resolving a visible sidebar destination", () => {
    const sidebar = anchor("sideboard", undefined, "0");
    const decision = anchor("sideboard", undefined, "0");
    decision.dataset.anchorPriority = "2";
    rect(decision, 300, 400, 100, 40);
    const registry = new DomAnchorRegistry(document);
    registry.capture();
    decision.hidden = true;
    registry.capture();
    expect(registry.resolveSource("sideboard", undefined, "0")?.clientX).toBe(350);
    expect(registry.resolveLive("sideboard", undefined, "0")?.clientX).toBe(130);
    sidebar.remove();
  });
});

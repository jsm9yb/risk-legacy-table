// new (13): PixiJS effects overlay at the stable EffectsLayer seam (same props, no
// game-component changes). Flashes an attack beam on dice rolls and a pulse on conquest.
// When Pixi can't initialize (no WebGL/WebGPU — jsdom tests, old machines) the layer
// degrades to nothing: effects are cosmetic and never gate play.
import { useEffect, useRef } from "react";
import { Application, Graphics } from "pixi.js";
import { manifest, anchor } from "@risk/map";
import type { GameState } from "@risk/rules";

const VIEW_W = 749.819, VIEW_H = 519.068; // board viewBox (SPEC §11 contract)

export default function EffectsLayer({ gs }: { gs: GameState }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const lastSeq = useRef(0);

  // Mount Pixi once; destroy on unmount. Init is async and may fail — that's the fallback.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    const app = new Application();
    app.init({ backgroundAlpha: 0, resizeTo: host, antialias: true })
      .then(() => {
        if (cancelled) { app.destroy(true); return; }
        app.canvas.style.width = "100%";
        app.canvas.style.height = "100%";
        host.appendChild(app.canvas);
        appRef.current = app;
      })
      .catch(() => { /* no renderer available: cosmetic layer stays empty */ });
    return () => {
      cancelled = true;
      if (appRef.current) { appRef.current.destroy(true); appRef.current = null; }
    };
  }, []);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fresh = gs.log.filter((e) => e.seq > lastSeq.current);
    lastSeq.current = gs.log[gs.log.length - 1]?.seq ?? 0;
    const app = appRef.current;
    if (reduced || !app) return;

    const pt = (tid: string) => {
      const t = manifest.territories.find((x) => x.id === tid)!;
      const a = anchor(t);
      // map viewBox coords -> renderer pixels
      return { x: (a.x / VIEW_W) * app.screen.width, y: (a.y / VIEW_H) * app.screen.height };
    };

    for (const e of fresh) {
      if (e.type === "DiceRolled" && gs.combat) {
        beam(app, pt(gs.combat.from), pt(gs.combat.to));
      } else if (e.type === "TerritoryConquered" && e.data?.territory) {
        pulse(app, pt(e.data.territory as string));
      }
    }
  }, [gs]);

  return <div ref={hostRef} className="absolute inset-0 pointer-events-none overflow-hidden" />;
}

function beam(app: Application, a: { x: number; y: number }, b: { x: number; y: number }) {
  const g = new Graphics();
  app.stage.addChild(g);
  const start = performance.now();
  const tick = () => {
    const k = (performance.now() - start) / 450;
    g.clear();
    if (k >= 1) { app.ticker.remove(tick); g.destroy(); return; }
    g.moveTo(a.x, a.y)
      .lineTo(a.x + (b.x - a.x) * Math.min(1, k * 2), a.y + (b.y - a.y) * Math.min(1, k * 2))
      .stroke({ color: 0xc9504a, alpha: 1 - k, width: 2.5 });
  };
  app.ticker.add(tick);
}

function pulse(app: Application, p: { x: number; y: number }) {
  const g = new Graphics();
  app.stage.addChild(g);
  const start = performance.now();
  const tick = () => {
    const k = (performance.now() - start) / 600;
    g.clear();
    if (k >= 1) { app.ticker.remove(tick); g.destroy(); return; }
    g.circle(p.x, p.y, 8 + k * 26).stroke({ color: 0xe0a93c, alpha: 1 - k, width: 2 });
  };
  app.ticker.add(tick);
}

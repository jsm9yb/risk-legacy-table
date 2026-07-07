// new (TEST-web): jsdom lacks matchMedia and a canvas 2D context; shim the minimal
// surface the app touches (EffectsLayer) so components mount in tests unchanged.
if (typeof window !== "undefined") {
  window.matchMedia ??= ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;

  // jsdom's getContext returns null; hand back a permissive no-op 2D context, but keep
  // WebGL/WebGPU null so PixiJS fails init cleanly and EffectsLayer takes its fallback. // new (13)
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    value: (type: string) => (type === "2d" ? new Proxy({}, { get: () => () => {} }) : null),
  });

  (globalThis as any).requestAnimationFrame ??= (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16);

  (Element.prototype as any).scrollTo ??= () => {}; // Ledger auto-scroll
}

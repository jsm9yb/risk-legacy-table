// new (TEST-web): jsdom lacks matchMedia and a canvas 2D context; shim the minimal
// surface the app touches so components mount in tests while real-browser verification owns Pixi coverage.
if (typeof window !== "undefined") {
  // jsdom acts as a 1280px desktop: min-width queries up to 1280 match (UI-5 responsive
  // layout reads them); feature queries like prefers-reduced-motion stay false.
  window.matchMedia ??= ((query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    return {
      matches: !!min && Number(min[1]) <= 1280, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {},
      dispatchEvent: () => false,
    };
  }) as typeof window.matchMedia;

  // jsdom's getContext returns null; hand back a permissive no-op 2D context, but keep
  // WebGL/WebGPU stay unavailable in jsdom; the synchronized DOM adapter remains testable. // new (13)
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    value: (type: string) => (type === "2d" ? new Proxy({}, { get: () => () => {} }) : null),
  });

  (globalThis as any).requestAnimationFrame ??= (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16);

  (Element.prototype as any).scrollTo ??= () => {}; // Ledger auto-scroll
}

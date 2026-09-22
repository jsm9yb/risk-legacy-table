export interface PresentationClock {
  now(): number;
  wait(durationMs: number, signal: AbortSignal): Promise<void>;
}

export class RafPresentationClock implements PresentationClock {
  now() { return performance.now(); }
  wait(durationMs: number, signal: AbortSignal) {
    if (durationMs <= 0 || signal.aborted) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const start = this.now();
      let frame = 0;
      const finish = () => { if (frame) cancelAnimationFrame(frame); signal.removeEventListener("abort", finish); resolve(); };
      const tick = (now: number) => now - start >= durationMs || signal.aborted ? finish() : (frame = requestAnimationFrame(tick), undefined);
      signal.addEventListener("abort", finish, { once: true });
      frame = requestAnimationFrame(tick);
    });
  }
}

export class ManualPresentationClock implements PresentationClock {
  private time = 0;
  private waits: { at: number; signal: AbortSignal; resolve: () => void }[] = [];
  now() { return this.time; }
  wait(durationMs: number, signal: AbortSignal) {
    if (durationMs <= 0 || signal.aborted) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const finish = () => {
        signal.removeEventListener("abort", finish);
        this.waits = this.waits.filter((wait) => wait !== pending);
        resolve();
      };
      const pending = { at: this.time + durationMs, signal, resolve: finish };
      this.waits.push(pending);
      signal.addEventListener("abort", finish, { once: true });
    });
  }
  advance(ms: number) {
    this.time += ms;
    const ready = this.waits.filter((wait) => wait.at <= this.time || wait.signal.aborted);
    this.waits = this.waits.filter((wait) => !ready.includes(wait));
    ready.forEach((wait) => wait.resolve());
  }
  flush() { this.advance(Number.MAX_SAFE_INTEGER / 2); }
}

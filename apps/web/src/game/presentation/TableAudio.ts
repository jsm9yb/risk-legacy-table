export type TableAudioCue = "piece.place" | "piece.move" | "dice.tumble" | "battle.impact" | "piece.casualty" | "territory.conquered" | "scar.apply" | "redStar.gained" | "missile.commit" | "module.reveal" | "game.victory";

export interface TableAudio {
  play(cue: TableAudioCue, options?: { gain?: number; rate?: number }): void;
  stopTransient(): void;
  setMuted(muted: boolean): void;
  setVolume(volume: number): void;
  dispose(): void;
}

export class SilentTableAudioAdapter implements TableAudio {
  play() {}
  stopTransient() {}
  setMuted() {}
  setVolume() {}
  dispose() {}
}

export class RecordingTableAudioAdapter implements TableAudio {
  readonly records: string[] = [];
  play(cue: TableAudioCue) { this.records.push(`play ${cue}`); }
  stopTransient() { this.records.push("stop transient"); }
  setMuted(muted: boolean) { this.records.push(`muted ${muted}`); }
  setVolume(volume: number) { this.records.push(`volume ${volume}`); }
  dispose() { this.records.push("dispose"); }
}

export class WebAudioTableAudioAdapter implements TableAudio {
  private context?: AudioContext;
  private muted = false;
  private volume = 0.7;
  private readonly active = new Set<AudioScheduledSourceNode>();
  private readonly onVisibilityChange = () => {
    if (!this.context || document.visibilityState !== "hidden") return;
    this.stopTransient();
    void this.context.suspend();
  };

  constructor() { document.addEventListener("visibilitychange", this.onVisibilityChange); }

  private getContext() {
    this.context ??= new AudioContext();
    if (this.context.state === "suspended") void this.context.resume();
    return this.context;
  }

  play(cue: TableAudioCue, options: { gain?: number; rate?: number } = {}) {
    if (this.muted) return;
    const context = this.getContext();
    const now = context.currentTime;
    const gain = context.createGain();
    const baseGain = (options.gain ?? 1) * this.volume * 0.075;
    gain.gain.setValueAtTime(baseGain, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (cue === "module.reveal" || cue === "game.victory" ? 0.75 : 0.24));
    gain.connect(context.destination);

    if (cue === "dice.tumble" || cue === "battle.impact" || cue === "piece.casualty") {
      const length = Math.floor(context.sampleRate * (cue === "dice.tumble" ? 0.36 : 0.18));
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let index = 0; index < length; index++) data[index] = (Math.random() * 2 - 1) * Math.pow(1 - index / length, cue === "dice.tumble" ? 1.2 : 3);
      const source = context.createBufferSource();
      source.buffer = buffer;
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = cue === "battle.impact" ? 240 : 1250;
      source.connect(filter).connect(gain);
      this.track(source);
      source.start(now);
      return;
    }

    const oscillator = context.createOscillator();
    oscillator.type = cue === "game.victory" ? "triangle" : "sine";
    const frequencies: Record<TableAudioCue, number> = {
      "piece.place": 180, "piece.move": 120, "dice.tumble": 420, "battle.impact": 90,
      "piece.casualty": 150, "territory.conquered": 220, "scar.apply": 105,
      "redStar.gained": 740, "missile.commit": 280, "module.reveal": 196, "game.victory": 392,
    };
    oscillator.frequency.setValueAtTime(frequencies[cue] * (options.rate ?? 1), now);
    if (cue === "redStar.gained" || cue === "game.victory") oscillator.frequency.exponentialRampToValueAtTime(frequencies[cue] * 1.5, now + 0.45);
    oscillator.connect(gain);
    this.track(oscillator);
    oscillator.start(now);
    oscillator.stop(now + (cue === "module.reveal" || cue === "game.victory" ? 0.75 : 0.25));
  }

  private track(source: AudioScheduledSourceNode) {
    this.active.add(source);
    source.addEventListener("ended", () => this.active.delete(source), { once: true });
  }

  stopTransient() {
    this.active.forEach((source) => { try { source.stop(); } catch {} });
    this.active.clear();
  }
  setMuted(muted: boolean) { this.muted = muted; if (muted) this.stopTransient(); }
  setVolume(volume: number) { this.volume = Math.max(0, Math.min(1, volume)); }
  dispose() { document.removeEventListener("visibilitychange", this.onVisibilityChange); this.stopTransient(); void this.context?.close(); this.context = undefined; }
}

import { useState } from "react";
import type { MotionPreference } from "../presentation/types.ts";

export default function PresentationSettings({ motion, quality, muted, volume, onMotion, onQuality, onMuted, onVolume }: {
  motion: MotionPreference;
  quality: "high" | "balanced" | "low";
  muted: boolean;
  volume: number;
  onMotion: (value: MotionPreference) => void;
  onQuality: (value: "high" | "balanced" | "low") => void;
  onMuted: (value: boolean) => void;
  onVolume: (value: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="absolute left-3 top-3 z-40">
      <button type="button" aria-label="Presentation settings" onClick={() => setOpen((value) => !value)}
        className="rounded border border-white/15 bg-black/70 px-2.5 py-1.5 font-mono text-[10px] tracking-widest text-white hover:border-signal">
        TABLE
      </button>
      {open && (
        <div role="dialog" aria-label="Presentation settings" className="mt-1 grid min-w-48 gap-2 rounded border border-white/15 bg-black/90 p-3 font-mono text-[10px] text-white backdrop-blur">
          <label className="grid gap-1">MOTION
            <select aria-label="Motion" value={motion} onChange={(event) => onMotion(event.target.value as MotionPreference)} className="rounded bg-panel p-1.5">
              <option value="full">Full</option><option value="reduced">Reduced</option><option value="instant">Instant</option>
            </select>
          </label>
          <label className="grid gap-1">QUALITY
            <select aria-label="Quality" value={quality} onChange={(event) => onQuality(event.target.value as "high" | "balanced" | "low")} className="rounded bg-panel p-1.5">
              <option value="high">High</option><option value="balanced">Balanced</option><option value="low">Low</option>
            </select>
          </label>
          <label className="grid gap-1">VOLUME
            <input aria-label="Table audio volume" type="range" min="0" max="1" step="0.05" value={volume} onChange={(event) => onVolume(Number(event.target.value))} />
          </label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={muted} onChange={(event) => onMuted(event.target.checked)} /> MUTE TABLE AUDIO</label>
        </div>
      )}
    </div>
  );
}

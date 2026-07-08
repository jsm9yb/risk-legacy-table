// new (UI-8): shared modal/overlay layer for blocking decisions. Three surfaces —
// full-screen takeover (setup), centered overlay (combat), bottom dock (card/hand
// decisions) — each carrying an explicit "whose decision" chip.
import type { ReactNode } from "react";

export function DecisionChip({ name, color, you }: { name: string; color?: string; you?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest bg-panel-2 border border-line rounded-full px-2.5 py-1">
      <span className="w-2 h-2 rounded-full" style={{ background: color ?? "var(--color-signal)" }} />
      <span className="text-muted">decides</span>
      <span className="text-text">{name}{you ? " (you)" : ""}</span>
    </span>
  );
}

export function TakeoverOverlay({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="dialog" aria-label={label} className="absolute inset-0 z-50 bg-ink/95 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-10">{children}</div>
    </div>
  );
}

export function CenterOverlay({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="absolute inset-0 z-40 bg-ink/70 flex items-center justify-center p-6">
      <div role="dialog" aria-label={label}
        className="bg-panel border border-line rounded-sm shadow-2xl w-full max-w-2xl max-h-full overflow-y-auto">
        {children}
      </div>
    </div>
  );
}

export function BottomDock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="absolute bottom-0 inset-x-0 z-30 flex justify-center pointer-events-none">
      <div role="dialog" aria-label={label}
        className="pointer-events-auto bg-panel border border-line border-b-0 rounded-t-sm shadow-2xl px-5 py-4 w-full max-w-2xl">
        {children}
      </div>
    </div>
  );
}

export function Btn({ onClick, children, tone = "default", disabled, ariaLabel }: {
  onClick: () => void;
  children: ReactNode;
  tone?: "default" | "primary" | "danger";
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const cls = tone === "primary" ? "bg-signal text-ink hover:brightness-110"
    : tone === "danger" ? "border border-danger text-danger hover:bg-danger hover:text-ink"
    : "border border-line hover:border-signal";
  return (
    <button onClick={onClick} disabled={disabled} aria-label={ariaLabel}
      className={`px-3 py-1.5 rounded-sm text-sm font-medium disabled:opacity-40 disabled:pointer-events-none ${cls}`}>
      {children}
    </button>
  );
}

export function Num({ value, onChange, min, max }: { value: number; onChange: (n: number) => void; min: number; max: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      <button className="w-6 h-6 bg-panel-2 border border-line rounded-sm hover:border-signal" onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <span className="font-mono w-8 text-center">{Math.min(Math.max(value, min), max)}</span>
      <button className="w-6 h-6 bg-panel-2 border border-line rounded-sm hover:border-signal" onClick={() => onChange(Math.min(max, value + 1))}>+</button>
    </span>
  );
}

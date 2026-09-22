// shared modal/overlay layer for blocking decisions. Three surfaces —
// full-screen takeover (setup), centered overlay (combat), bottom dock (card/hand
// decisions) — each carrying an explicit "whose decision" chip.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import FactionEmblem from "./FactionEmblem.tsx";

const FOCUSABLE = "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex='-1'])";

function isVisibleForFocus(element: HTMLElement): boolean {
  for (let ancestor: HTMLElement | null = element; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.hidden || ancestor.hasAttribute("inert") || ancestor.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle(ancestor);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
  }
  return element.isConnected;
}

function useModalFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const modal = ref.current;
    if (!modal) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusables = () => [...modal.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(isVisibleForFocus);
    // Keep a decision input's deliberate initial focus when a child already set it.
    const focusDecision = () => {
      if (!modal.contains(document.activeElement)) (focusables()[0] ?? modal).focus();
    };
    let visible = isVisibleForFocus(modal);
    if (visible) focusDecision();
    // Presentation may hide a mounted decision to preserve its draft state.
    // Reacquire focus when its ancestor is revealed, without remounting the
    // decision or introducing a timer alongside the presentation director.
    const visibilityObserver = new MutationObserver(() => {
      const nextVisible = isVisibleForFocus(modal);
      if (nextVisible && !visible) focusDecision();
      visible = nextVisible;
    });
    for (let ancestor: HTMLElement | null = modal; ancestor; ancestor = ancestor.parentElement) {
      visibilityObserver.observe(ancestor, { attributes: true, attributeFilter: ["hidden", "inert", "aria-hidden", "style", "class"] });
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !isVisibleForFocus(modal)) return;
      const candidates = focusables();
      if (candidates.length === 0) {
        event.preventDefault();
        modal.focus();
        return;
      }
      const first = candidates[0];
      const last = candidates[candidates.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    modal.addEventListener("keydown", onKeyDown);
    return () => {
      visibilityObserver.disconnect();
      modal.removeEventListener("keydown", onKeyDown);
      if (previous && isVisibleForFocus(previous)) previous.focus();
    };
  }, []);
  return ref;
}

export function DecisionChip({ name, color, factionId, you }: { name: string; color?: string; factionId?: string; you?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-3 bg-panel-2 border border-line border-l-4 rounded-sm px-3 py-2 shadow-lg shadow-black/25"
      style={{ borderLeftColor: color ?? "var(--color-signal)" }}
    >
      <FactionEmblem factionId={factionId} size="sm" />
      <span className="flex flex-col leading-tight text-left">
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-signal">Decision</span>
        <span className="font-display font-bold tracking-wide text-lg text-text">
          {name}{you ? " (you)" : ""}
        </span>
      </span>
    </span>
  );
}

export function TakeoverOverlay({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  const modalRef = useModalFocus<HTMLDivElement>();
  return (
    <div ref={modalRef} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
      className="absolute inset-0 z-50 bg-ink/95 overflow-y-auto">
      <div className={`${wide ? "max-w-[min(96vw,1800px)]" : "max-w-3xl"} mx-auto px-6 py-10`}>{children}</div>
    </div>
  );
}

export function CenterOverlay({ label, children, front = false }: { label: string; children: ReactNode; front?: boolean }) {
  const modalRef = useModalFocus<HTMLDivElement>();
  return (
    <div className={`absolute inset-0 ${front ? "z-[80]" : "z-40"} bg-ink/70 flex items-center justify-center p-6`}>
      <div ref={modalRef} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
        className="bg-panel border border-line rounded-sm shadow-2xl w-full max-w-2xl max-h-full overflow-y-auto">
        {children}
      </div>
    </div>
  );
}

/** A blocking decision with an unobscured board. The transparent outer layer
 * catches board clicks; the compact tray retains keyboard focus during battle. */
export function BattleTray({ children }: { children: ReactNode }) {
  const modalRef = useModalFocus<HTMLDivElement>();
  return (
    <div data-battle-tray className="absolute inset-0 z-40 flex items-end justify-end p-2 sm:p-3 lg:items-center">
      <div ref={modalRef} role="dialog" aria-modal="true" aria-label="Combat" tabIndex={-1}
        className="bg-[#10151e] border border-signal/45 rounded-sm shadow-2xl w-full max-w-[460px] max-h-[65%] lg:max-h-[92%] overflow-y-auto overscroll-contain">
        {children}
      </div>
    </div>
  );
}

export function BottomDock({ label, children }: { label: string; children: ReactNode }) {
  // Flows above the hand strip at the bottom of the board column (UI-9) rather than
  // overlaying it, so hand-card selection stays reachable while the dock is open.
  return (
    <div className="flex justify-center px-4 pb-2">
      <div role="dialog" aria-label={label}
        className="bg-panel border border-signal/40 rounded-sm shadow-2xl px-5 py-4 w-full max-w-2xl">
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

export function TroopPicker({
  value,
  onChange,
  min,
  max,
  label,
  disabled,
  confirmLabel = "SET",
  preview,
}: {
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  label: string;
  disabled?: boolean;
  confirmLabel?: string;
  preview?: (count: number) => ReactNode;
}) {
  const safeMin = Math.max(1, min);
  const safeMax = Math.max(safeMin, max);
  const shown = clamp(value, safeMin, safeMax);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(`${safeMin}`);
  const inputRef = useRef<HTMLInputElement>(null);
  const pickerId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    const id = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setDraft((current) => `${clamp(Number(current || shown), safeMin, safeMax)}`);
  }, [safeMin, safeMax, shown, open]);

  const openPicker = () => {
    setDraft(`${safeMin}`);
    setOpen(true);
  };
  const commit = () => {
    onChange(clamp(Number(draft), safeMin, safeMax));
    setOpen(false);
  };
  const sliderValue = clamp(Number(draft), safeMin, safeMax);

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={openPicker}
        aria-label={`Choose ${label}`}
        className="min-w-12 h-8 px-3 bg-panel-2 border border-line rounded-sm font-mono text-sm text-signal hover:border-signal disabled:opacity-40"
      >
        {shown}
      </button>
      {open && (
        <div className="fixed inset-0 z-50 bg-ink/55 flex items-center justify-center p-4"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <form role="dialog" aria-modal="true" aria-label={label}
            onSubmit={(e) => { e.preventDefault(); commit(); }}
            className="w-full max-w-xs bg-panel border border-signal rounded-sm shadow-2xl p-4">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <h3 className="font-display font-bold tracking-widest text-lg">{label}</h3>
                <p className="font-mono text-[10px] text-muted">Range {safeMin}-{safeMax}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="font-mono text-xs text-muted hover:text-text">CLOSE</button>
            </div>
            <input
              type="range"
              aria-label={`${label} slider`}
              min={safeMin}
              max={safeMax}
              value={sliderValue}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full accent-(--color-signal)"
            />
            {preview?.(sliderValue)}
            <div className="flex items-center gap-2 mt-3">
              <input
                ref={inputRef}
                id={`${pickerId}-number`}
                aria-label={`${label} number`}
                type="number"
                min={safeMin}
                max={safeMax}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => setDraft((current) => `${clamp(Number(current), safeMin, safeMax)}`)}
                className="w-20 bg-ink border border-line rounded-sm px-2 py-1 font-mono text-lg focus:border-signal outline-none"
              />
              <button type="submit"
                className="px-3 py-1.5 rounded-sm text-sm font-medium bg-signal text-ink hover:brightness-110">
                {confirmLabel}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.round(value), min), max);
}

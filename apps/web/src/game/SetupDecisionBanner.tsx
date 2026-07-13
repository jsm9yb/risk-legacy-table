import { DecisionChip } from "./overlays.tsx";

export default function SetupDecisionBanner({
  actorName,
  actorColor,
  you,
  action,
  factionId,
  factionName,
  powerName,
  onChange,
}: {
  actorName: string;
  actorColor?: string;
  you?: boolean;
  action: string;
  factionId?: string;
  factionName?: string;
  powerName?: string;
  onChange?: () => void;
}) {
  return (
    <div className="w-full bg-panel border border-signal/60 rounded-sm px-4 py-3 shadow-xl shadow-black/25">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <DecisionChip name={actorName} color={actorColor} factionId={factionId} you={you} />
        <div className="min-w-0 flex-1 flex items-center gap-3">
          <div className="min-w-0">
            <div className="font-display font-extrabold tracking-widest text-2xl text-signal break-words">
              {action}
            </div>
            {(factionName || powerName) && (
              <div className="text-sm text-text leading-relaxed break-words">
                {factionName && <span className="font-semibold">{factionName}</span>}
                {factionName && powerName && <span className="text-muted"> - </span>}
                {powerName && <span>{powerName}</span>}
              </div>
            )}
          </div>
        </div>
        {onChange && (
          <button type="button" onClick={onChange}
            className="self-start md:self-center font-mono text-xs text-muted hover:text-text">
            CHANGE
          </button>
        )}
      </div>
    </div>
  );
}

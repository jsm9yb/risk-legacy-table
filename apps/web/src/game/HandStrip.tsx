// new (UI-9): always-visible strip along the bottom of the board — YOUR hand as rendered
// cards plus a personal HUD (recruit estimate, red stars, missiles, scars). The strip only
// ever renders its own player's faces; other players stay as counts in the rail Quick Look.
// Cards become selectable during hand decisions (Red Star buy, recruit trade-in).
import { redStars, waitingOn, type GameState } from "@risk/rules";
import type { UiState } from "./GameScreen.tsx";
import { cardResources, factionById } from "./labels.ts";
import ResourceCard from "./cards/ResourceCard.tsx";
import ScarCard from "./cards/ScarCard.tsx"; // new (UI-12)
import FactionEmblem from "./FactionEmblem.tsx"; // new (UI-10)

export default function HandStrip({ gs, player, ui, setUi, selectable, scarPlayable, actions }: {
  gs: GameState;
  player?: string;
  ui: UiState;
  setUi: (fn: (u: UiState) => UiState) => void;
  selectable: boolean;
  /** new (UI-12): held scars can be played (any turn, stable boundary). */
  scarPlayable?: boolean;
  /** new (UI-2): the slim per-phase action bar renders beside the hand/HUD. */
  actions?: React.ReactNode;
}) {
  const p = player ? gs.players[player] : undefined;
  if (!p) return null;
  const faction = factionById(p.factionId);
  const rs = redStars(gs, player!);
  const actor = waitingOn(gs);
  const recruitRemaining = actor === player && gs.phase === "join_or_recruit" ? gs.recruit?.remaining : undefined;

  const toggle = (id: string) =>
    setUi((u) => ({
      ...u,
      selectedCards: u.selectedCards.includes(id) ? u.selectedCards.filter((x) => x !== id) : [...u.selectedCards, id],
    }));

  return (
    <div className="border-t border-line bg-panel px-4 py-2 flex flex-wrap sm:flex-nowrap items-center gap-4 min-h-[104px] min-w-0 w-full overflow-hidden">
      <div className="font-mono text-xs space-y-0.5 shrink-0">
        <div className="flex items-center gap-1.5">
          {faction
            ? <FactionEmblem factionId={faction.id} size="xs" />
            : <span className="w-2.5 h-2.5 rounded-full bg-[#5a6578]" />}{/* new (UI-10) */}
          <span className="text-text">{p.name}</span>
        </div>
        <div className="text-muted">★ {rs.tokens}+{rs.board}={rs.total} · ▲ {p.missiles} · scars {p.scarCardCount}</div>
        {recruitRemaining !== undefined && <div className="text-signal">to place: {recruitRemaining}</div>}
        {selectable && <div className="text-signal">selected: {ui.selectedCards.length}</div>}
      </div>
      <div className="flex flex-1 min-w-0 items-center gap-2 overflow-x-auto py-1">
        {p.hand.length === 0 ? (
          <span className="font-mono text-[10px] text-muted">no resource cards</span>
        ) : (
          p.hand.map((id) => (
            <ResourceCard key={id} size="sm" cardId={id} resources={cardResources(gs, id)}
              selected={ui.selectedCards.includes(id)}
              onClick={selectable ? () => toggle(id) : undefined} />
          ))
        )}
        {p.scarHand.map((h) => ( // new (UI-12): held scars as full-art cards; click to play
          <ScarCard key={h.instanceId} scarId={h.scarId} size="sm"
            selected={ui.scarTarget?.instanceId === h.instanceId}
            onClick={player
              ? () => setUi((u) => ({
                ...u,
                scarDialog: { playerId: player!, instanceId: h.instanceId, scarId: h.scarId },
                scarTarget: undefined,
              }))
              : undefined} />
        ))}
      </div>
      {actions && <div className="w-full sm:w-auto sm:ml-auto sm:shrink-0 sm:max-w-[55%] min-w-0 overflow-x-auto pt-1 sm:pt-0">{actions}</div>}{/* new (UI-2) */}
    </div>
  );
}

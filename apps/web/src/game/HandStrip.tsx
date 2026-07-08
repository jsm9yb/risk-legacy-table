// new (UI-9): always-visible strip along the bottom of the board — YOUR hand as rendered
// cards plus a personal HUD (recruit estimate, red stars, missiles, scars). The strip only
// ever renders its own player's faces; other players stay as counts in the rail Quick Look.
// Cards become selectable during hand decisions (Red Star buy, recruit trade-in).
import { redStars, waitingOn, type GameState } from "@risk/rules";
import type { UiState } from "./GameScreen.tsx";
import { cardResources, factionById } from "./labels.ts";
import ResourceCard from "./cards/ResourceCard.tsx";

export default function HandStrip({ gs, player, ui, setUi, selectable }: {
  gs: GameState;
  player?: string;
  ui: UiState;
  setUi: (fn: (u: UiState) => UiState) => void;
  selectable: boolean;
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
    <div className="border-t border-line bg-panel px-4 py-2 flex items-center gap-4 min-h-[104px]">
      <div className="font-mono text-xs space-y-0.5 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: faction?.color ?? "#5a6578" }} />
          <span className="text-text">{p.name}</span>
        </div>
        <div className="text-muted">★ {rs.tokens}+{rs.board}={rs.total} · ▲ {p.missiles} · scars {p.scarCardCount}</div>
        {recruitRemaining !== undefined && <div className="text-signal">to place: {recruitRemaining}</div>}
        {selectable && <div className="text-signal">selected: {ui.selectedCards.length}</div>}
      </div>
      <div className="flex items-center gap-2 overflow-x-auto py-1">
        {p.hand.length === 0 ? (
          <span className="font-mono text-[10px] text-muted">no resource cards</span>
        ) : (
          p.hand.map((id) => (
            <ResourceCard key={id} size="sm" cardId={id} resources={cardResources(gs, id)}
              selected={ui.selectedCards.includes(id)}
              onClick={selectable ? () => toggle(id) : undefined} />
          ))
        )}
      </div>
    </div>
  );
}

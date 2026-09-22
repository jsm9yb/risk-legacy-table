// always-visible strip along the bottom of the board — YOUR hand as rendered
// cards plus a personal HUD (recruit estimate, red stars, missiles, scars). The strip only
// ever renders its own player's faces; other players stay as counts in the rail Quick Look.
// Cards become selectable during hand decisions (Red Star buy, recruit trade-in).
import { redStars, waitingOn, type GameState } from "@risk/rules";
import type { UiState } from "./GameScreen.tsx";
import { cardResources, continentName, factionById, territoryName } from "./labels.ts";
import ResourceCard from "./cards/ResourceCard.tsx";
import ScarCard from "./cards/ScarCard.tsx";
import FactionEmblem from "./FactionEmblem.tsx";
import { troopsForResources } from "@risk/content";

export default function HandStrip({ gs, player, ui, setUi, selectable, actions }: {
  gs: GameState;
  player?: string;
  ui: UiState;
  setUi: (fn: (u: UiState) => UiState) => void;
  selectable: boolean;
  /** the slim per-phase action bar renders beside the hand/HUD. */
  actions?: React.ReactNode;
}) {
  const p = player ? gs.players[player] : undefined;
  if (!p) return null;
  const faction = factionById(p.factionId);
  const rs = redStars(gs, player!);
  const actor = waitingOn(gs);
  const recruitRemaining = actor === player && gs.phase === "join_or_recruit" ? gs.recruit?.remaining : undefined;
  const resources = ui.selectedCards.reduce((sum, id) => sum + cardResources(gs, id), 0)
    + (p.factionId === gs.alienCollaboratorFactionId && ui.selectedCards.length > 0 ? 1 : 0);
  const selectedTerritory = ui.selected ? gs.territories[ui.selected] : undefined;
  const placement = recruitRemaining !== undefined && selectedTerritory?.controller === player
    ? Math.min(Math.max(1, ui.placeCount), recruitRemaining) : undefined;
  const breakdown = recruitRemaining !== undefined ? gs.recruit?.breakdown : undefined;

  const toggle = (id: string) =>
    setUi((u) => ({
      ...u,
      selectedCards: u.selectedCards.includes(id) ? u.selectedCards.filter((x) => x !== id) : [...u.selectedCards, id],
    }));

  return (
    <div className="border-t border-line bg-panel px-4 py-2 flex flex-wrap sm:flex-nowrap items-center gap-4 min-h-[104px] min-w-0 w-full overflow-hidden">
      <div data-table-anchor="player" data-player-id={player} data-anchor-priority="2" className="font-mono text-xs space-y-0.5 shrink-0">
        <div data-table-anchor="faction" data-player-id={player} data-anchor-priority="2" className="flex items-center gap-1.5">
          {faction
            ? <FactionEmblem factionId={faction.id} size="xs" />
            : <span className="w-2.5 h-2.5 rounded-full bg-[#5a6578]" />}
          <span className="text-text">{p.name}</span>
        </div>
        <div className="text-muted"><span data-table-anchor="score" data-player-id={player} data-anchor-priority="2">★ {rs.tokens}+{rs.board}={rs.total}</span> · ▲ {p.missiles} · scars {p.scarCardCount}</div>
        <div data-reinforcement-reserve className="border-l-2 border-signal pl-2 my-1">
          <div className="text-signal" role="status" aria-label="Reinforcement reserve">RESERVE · {recruitRemaining ?? 0}{recruitRemaining !== undefined ? " to place" : " uncommitted"}</div>
          <div data-table-anchor="reserve" data-player-id={player} data-anchor-priority="2" aria-hidden="true" className="h-6 min-w-28 border-b border-line/50" />
          {placement !== undefined && placement > 0 && selectedTerritory && <div data-placement-preview className="text-[10px] text-muted">
            <span className="block">Preview · {territoryName(ui.selected!)} {selectedTerritory.troops} → {selectedTerritory.troops + placement}</span>
            <span>Reserve {recruitRemaining} → {(recruitRemaining ?? 0) - placement}</span>
          </div>}
          {breakdown && <details className="text-[10px] text-muted">
            <summary className="cursor-pointer">Where these troops came from</summary>
            <ul aria-label="Recruitment breakdown" className="space-y-1 py-1">
              <li>{breakdown.territories} territories + {breakdown.population} population → {breakdown.fromTerritories} troops</li>
              {breakdown.continents.map((continent) => <li key={continent.id}>{continentName(continent.id)} +{continent.total}</li>)}
              {breakdown.tradeIns > 0 && <li>Resource trades +{breakdown.tradeIns}</li>}
              {breakdown.total !== breakdown.fromTerritories + breakdown.continents.reduce((sum, continent) => sum + continent.total, 0) + breakdown.tradeIns &&
                <li>Other recruitment effects {breakdown.total - breakdown.fromTerritories - breakdown.continents.reduce((sum, continent) => sum + continent.total, 0) - breakdown.tradeIns}</li>}
              <li className="text-signal">Recruited {breakdown.total} · placed {Math.max(0, breakdown.total - (recruitRemaining ?? 0))}</li>
            </ul>
          </details>}
        </div>
        {selectable && <div className="text-signal">selected: {ui.selectedCards.length}</div>}
        {selectable && gs.phase === "join_or_recruit" && <div className="text-signal" role="status">{resources} resources → {resources >= 2 && resources <= 10 ? `${troopsForResources(resources)} troops` : "select 2–10 resources"}
          {resources >= 2 && resources <= 10 && recruitRemaining !== undefined && <span className="block text-[10px] text-muted">Trade preview · reserve {recruitRemaining} → {recruitRemaining + troopsForResources(resources)}</span>}
        </div>}
        <details className="text-muted"><summary className="cursor-pointer">Resource trade values</summary><div className="grid grid-cols-3 gap-1 mt-1">{Array.from({ length: 9 }, (_, i) => i + 2).map((n) => <span key={n}>{n} → {troopsForResources(n)} troops</span>)}</div><p>Combine Coin and Territory card resources during recruitment.</p></details>
      </div>
      <div data-table-anchor="hand" data-player-id={player} data-anchor-priority="2" className="flex flex-1 min-w-0 items-center gap-2 overflow-x-auto py-1">
        {p.hand.length === 0 ? (
          <span className="font-mono text-[10px] text-muted">no resource cards</span>
        ) : (
          p.hand.map((id) => (
            <span key={id} data-table-anchor="card" data-player-id={player} data-anchor-id={id} className="inline-flex shrink-0"><ResourceCard size="sm" cardId={id} resources={cardResources(gs, id)}
              selected={ui.selectedCards.includes(id)}
              onClick={selectable ? () => toggle(id) : undefined} /></span>
          ))
        )}
        {p.scarHand.map((h) => ( // held scars as full-art cards; click to play
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
      <div className="grid gap-1 shrink-0 border-l border-line pl-2 font-mono text-[9px] text-muted" aria-label="Resource piles">
        <div data-table-anchor="draw" className="min-w-12 border border-line/60 rounded-sm p-1 text-center">
          DRAW <span className="block text-text">{(gs.sideboard as GameState["sideboard"] & { territoryDeckCount?: number }).territoryDeckCount ?? gs.sideboard.territoryDeck.length}</span>
        </div>
        <div data-table-anchor="discard" className="min-w-12 border border-line/60 rounded-sm p-1 text-center">
          DISCARD <span className="block text-text">{gs.sideboard.discard.length + gs.sideboard.coinDiscard.length}</span>
        </div>
      </div>
      {actions && <div className="w-full sm:w-auto sm:ml-auto sm:shrink-0 sm:max-w-[55%] min-w-0 overflow-x-auto pt-1 sm:pt-0">{actions}</div>}
    </div>
  );
}

import { useState } from "react";
import { factionDefinitions } from "@risk/content";
import type { Action, DraftCategory, GameState } from "@risk/rules";
import { TakeoverOverlay } from "./overlays.tsx";
import DraftCard from "./cards/DraftCard.tsx";
import ResourceCard from "./cards/ResourceCard.tsx";
import FactionCard from "./FactionCard.tsx";

const labels: Record<DraftCategory, string> = {
  faction: "Faction",
  turnOrder: "Turn order",
  placementOrder: "Starting placement",
  startingTroops: "Starting troops",
  startingCoinCards: "Starting Coin cards",
};

const categories: DraftCategory[] = ["faction", "turnOrder", "placementOrder", "startingTroops", "startingCoinCards"];

export default function AdvancedDraftTakeover({ gs, actor, dispatch, you }: {
  gs: GameState;
  actor: string;
  dispatch: (action: Action) => void;
  you?: boolean;
}) {
  const draft = gs.advancedDraft!;
  const factions = factionDefinitions(gs.unlockedModules);
  const [selected, setSelected] = useState<{ category: DraftCategory; value: string | number }>();
  const playerCount = Object.keys(gs.players).length;
  const round = Math.floor(draft.nextPickIdx / playerCount) + 1;
  const pick = draft.nextPickIdx % playerCount + 1;
  const clockwise = round % 2 === 1;
  const claim = draft.pendingCoinClaim;
  const lastCoin = [...gs.log].reverse().find((event) => event.type === "StartingCoinCardTaken");
  const name = (factionId: string) => factions.find((faction) => faction.id === factionId)?.name ?? factionId;
  const values = (category: DraftCategory): (string | number)[] => category === "faction"
    ? draft.available.factions
    : draft.available[category];

  return (
    <TakeoverOverlay label="Advanced setup draft" wide>
      <div className="max-w-[1500px] mx-auto">
        <header className="flex flex-wrap items-center justify-between gap-3 mb-4 border-b border-line pb-3">
          <div><p className="font-mono text-[10px] uppercase tracking-[0.25em] text-signal">Pack 1 · physical snake draft</p><h2 className="font-display font-black tracking-widest text-2xl">{gs.players[actor].name}{you ? " · YOUR PICK" : ""}</h2></div>
          <div className="text-right"><p className="font-display font-bold tracking-widest text-lg">{clockwise ? "CLOCKWISE →" : "← COUNTER-CLOCKWISE"}</p><p className="font-mono text-[10px] text-muted">ROUND {round} OF 5 · PICK {pick} OF {playerCount}</p></div>
        </header>
        {lastCoin && <p role="status" className="border border-signal bg-signal/10 p-3 mb-3">{gs.players[lastCoin.playerId!]?.name} took a starting Coin. {gs.players[actor].name}{you ? ", it is your turn" : " is choosing now"}.</p>}
        <details className="mb-4">
          <summary className="cursor-pointer text-signal">Explore all factions and their stories</summary>
          <p className="my-3 text-sm">Choose the faction whose strengths fit your plans. Its history carries forward: this war adds your victories, defeats and permanent choices to its story.</p>
          <div className="faction-card-grid">{factions.map((faction) => <FactionCard key={faction.id} faction={faction} powerId={gs.factionPowers[faction.id]} history={gs.factionHistory[faction.id] ?? []} currentGame={gs.gameNumber} detail />)}</div>
        </details>

        {claim ? (
          <section className="grid lg:grid-cols-[1fr_220px_1fr] gap-5 items-center min-h-[420px]" aria-label="Claim starting Coin cards">
            <div className="text-center"><h3 className="font-display font-black tracking-widest text-2xl">COIN PILE</h3><p className="text-sm text-muted mt-1">{(gs.sideboard as typeof gs.sideboard & { coinCount?: number }).coinCount ?? gs.sideboard.coinPile.length} public cards remain</p><div className="flex flex-wrap justify-center gap-2 mt-5">
              {gs.sideboard.coinPile.map((cardId) => <ResourceCard key={cardId} cardId={cardId} size="sm" title="Take this Coin card"
                onClick={you ? () => dispatch({ type: "draft.takeStartingCoin", playerId: actor, cardId }) : undefined} />)}
            </div></div>
            <div className="text-center border border-signal rounded-sm bg-signal/10 p-4"><p className="font-display font-black tracking-widest text-xl">TAKE {claim.remaining}</p><p className="font-mono text-[10px] text-muted mt-1">OF {claim.total} DRAFTED</p><p className="text-3xl mt-3">→</p></div>
            <div className="text-center"><h3 className="font-display font-black tracking-widest text-2xl">{gs.players[actor].name.toUpperCase()}'S HAND</h3><p className="text-sm text-muted mt-1">Private identities · {gs.players[actor].hand.length} cards now</p><div className="min-h-36 border-2 border-dashed border-ok/60 rounded-sm mt-5 grid place-items-center text-ok font-display font-bold tracking-widest">DROP / SELECT COIN HERE</div></div>
          </section>
        ) : (
          <>
            <div className="space-y-2" aria-label="Remaining setup cards">
              {categories.map((category) => (
                <section key={category} className="grid grid-cols-[145px_1fr] items-center gap-3 border border-line bg-panel/55 rounded-sm p-2">
                  <h3 className="font-display font-bold tracking-widest text-sm text-signal">{labels[category]}</h3>
                  <div className="flex gap-2 overflow-x-auto py-1">
                    {values(category).map((value, index) => <DraftCard key={`${category}-${value}-${index}`} category={category} value={value}
                      factionName={category === "faction" ? name(String(value)) : undefined}
                      selected={selected?.category === category && selected.value === value}
                      disabled={draft.picks[actor][category === "faction" ? "factionId" : category] !== undefined}
                      onSelect={you ? () => setSelected({ category, value }) : undefined} compact />)}
                  </div>
                </section>
              ))}
            </div>

            {selected && <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[85] bg-panel border border-signal shadow-2xl rounded-sm px-4 py-3 flex items-center gap-4"><span className="font-display font-bold tracking-wide">Commit this {labels[selected.category]} card?</span><button type="button" onClick={() => setSelected(undefined)} className="text-xs text-muted">CANCEL</button><button type="button" onClick={() => { dispatch({ type: "draft.pick", playerId: actor, ...selected }); setSelected(undefined); }} className="bg-signal text-ink px-4 py-2 rounded-sm font-display font-black tracking-widest text-sm">DRAFT CARD</button></div>}
          </>
        )}

        <section className="mt-4 border-t border-line pt-3" aria-label="Public draft tableaux">
          <h3 className="sr-only">Player draft tableaux</h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-2">
            {Object.values(gs.players).map((player) => {
              const picks = draft.picks[player.id];
              const cards: { category: DraftCategory; value: string | number }[] = [];
              if (picks.factionId) cards.push({ category: "faction", value: picks.factionId });
              for (const category of categories.slice(1)) {
                const value = picks[category as Exclude<DraftCategory, "faction">];
                if (value !== undefined) cards.push({ category, value });
              }
              return <div key={player.id} className={`rounded-sm border p-2 ${player.id === actor ? "border-signal bg-signal/5" : "border-line bg-panel/40"}`}><p className="font-display font-bold tracking-widest text-xs mb-2">{player.name}</p><div className="flex gap-1 overflow-x-auto min-h-28">{cards.map((card) => <DraftCard key={card.category} {...card} factionName={card.category === "faction" ? name(String(card.value)) : undefined} compact />)}</div></div>;
            })}
          </div>
        </section>
      </div>
    </TakeoverOverlay>
  );
}

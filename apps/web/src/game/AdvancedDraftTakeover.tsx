import { factionDefinitions } from "@risk/content";
import type { Action, DraftCategory, GameState } from "@risk/rules";
import { TakeoverOverlay } from "./overlays.tsx";

const labels: Record<DraftCategory, string> = {
  faction: "Faction",
  turnOrder: "Turn order",
  placementOrder: "Starting placement",
  startingTroops: "Starting troops",
  startingCoinCards: "Starting Coin cards",
};

export default function AdvancedDraftTakeover({ gs, actor, dispatch, you }: {
  gs: GameState;
  actor: string;
  dispatch: (action: Action) => void;
  you?: boolean;
}) {
  const draft = gs.advancedDraft!;
  const factions = factionDefinitions(gs.unlockedModules);
  const picks = draft.picks[actor];
  const categories: { category: DraftCategory; values: (string | number)[]; picked?: string | number }[] = [
    { category: "faction", values: draft.available.factions, picked: picks.factionId },
    { category: "turnOrder", values: draft.available.turnOrder, picked: picks.turnOrder },
    { category: "placementOrder", values: draft.available.placementOrder, picked: picks.placementOrder },
    { category: "startingTroops", values: draft.available.startingTroops, picked: picks.startingTroops },
    { category: "startingCoinCards", values: draft.available.startingCoinCards, picked: picks.startingCoinCards },
  ];
  const chosen = categories.filter((category) => category.picked !== undefined);

  const display = (category: DraftCategory, value: string | number) => {
    if (category === "faction") return factions.find((faction) => faction.id === value)?.name ?? value;
    if (category === "turnOrder") return `Turn ${value}`;
    if (category === "placementOrder") return `Place ${value}`;
    if (category === "startingTroops") return `${value} troops`;
    return `${value} Coin card${value === 1 ? "" : "s"}`;
  };

  return (
    <TakeoverOverlay label="Advanced setup draft" wide>
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-7">
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-signal">Pack 1 · snake draft</p>
          <h2 className="font-display font-black tracking-widest text-3xl mt-2">
            {gs.players[actor].name}{you ? " · YOUR PICK" : ""}
          </h2>
          <p className="text-sm text-muted mt-2">Choose one card from a category you have not chosen yet.</p>
        </div>

        {chosen.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2 mb-6" aria-label="Drafted cards">
            {chosen.map(({ category, picked }) => (
              <span key={category} className="border border-ok/50 bg-ok/10 rounded-sm px-3 py-2 font-mono text-xs">
                <span className="text-muted">{labels[category]}:</span> {display(category, picked!)}
              </span>
            ))}
          </div>
        )}

        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
          {categories.filter((category) => category.picked === undefined).map(({ category, values }) => (
            <section key={category} className="bg-panel/80 border border-line rounded-sm p-4">
              <h3 className="font-display font-bold tracking-widest text-lg text-signal mb-3">{labels[category]}</h3>
              <div className="grid gap-2">
                {values.map((value, index) => (
                  <button key={`${category}-${value}-${index}`} type="button"
                    onClick={() => dispatch({ type: "draft.pick", playerId: actor, category, value })}
                    className="border border-line hover:border-signal bg-panel-2 rounded-sm px-4 py-3 text-left font-display font-bold tracking-wide">
                    {display(category, value)}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </TakeoverOverlay>
  );
}

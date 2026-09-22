import type { Action, GameState } from "@risk/rules";
import { TakeoverOverlay } from "./overlays.tsx";
import { territoryName } from "./labels.ts";

export default function SetupOrderTakeover({ gs, actor, dispatch, you, onTour, onReplayOrder }: {
  gs: GameState;
  actor: string;
  dispatch: (action: Action) => void;
  you?: boolean;
  onTour?: () => void;
  onReplayOrder?: () => void;
}) {
  const setup = gs.setup!;
  const inherited = Object.entries(gs.territories).filter(([, territory]) => territory.city || territory.scars.length > 0 || territory.fortification);
  return <TakeoverOverlay label="Setup order reveal" wide>
    <div className="max-w-3xl mx-auto text-center">
      <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-signal">Every game begins with the high roll</p>
      <h2 className="font-display font-black tracking-widest text-3xl mt-2">SETUP ORDER</h2>
      {gs.gameNumber > 1 && <details className="text-left mt-5 border border-line bg-panel/60 rounded-sm p-3" open>
        <summary className="cursor-pointer font-display font-bold tracking-widest text-sm">THE WORLD YOU INHERIT · WAR {gs.gameNumber}</summary>
        <p className="font-mono text-[10px] text-muted mt-2">{inherited.length} territories carry cities, scars or defenses from earlier wars.</p>
        <div className="grid sm:grid-cols-2 gap-2 mt-3 max-h-32 overflow-y-auto" aria-label="Inherited world changes">
          {inherited.map(([id, territory]) => <div key={id} className="border-l-2 border-signal/50 pl-2 text-xs">
            <strong>{territoryName(id)}</strong><span className="block text-muted">{[
              territory.city?.name,
              ...territory.scars.map((scar) => scar.replaceAll("_", " ")),
              territory.fortification ? `Fortification ${territory.fortification.remaining}/${territory.fortification.max}` : undefined,
            ].filter(Boolean).join(" · ")}</span>
          </div>)}
        </div>
      </details>}
      <div className="grid sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-7">
        {setup.chooserOrder.map((playerId, index) => <div key={playerId} data-table-anchor="setup-order" data-player-id={playerId} data-setup-order={index + 1} className={`border rounded-sm p-4 ${index === 0 ? "border-signal bg-signal/10" : "border-line bg-panel/60"}`}>
          <p className="font-mono text-[10px] text-muted">ROLL</p><p className="font-display font-black text-4xl text-signal my-2">{setup.rolls[playerId]}</p><p className="font-display font-bold tracking-wide text-sm">{gs.players[playerId].name}</p><p className="font-mono text-[9px] text-muted mt-1">{index === 0 ? "HIGH ROLLER" : `ORDER ${index + 1}`}</p>
        </div>)}
      </div>
      <p className="text-sm text-muted mt-6">{gs.advancedDraft ? "The high roller takes the first setup card. The direction reverses after every draft round." : "The high roller chooses first; setup continues clockwise."}</p>
      {(onTour || onReplayOrder) && <div className="flex flex-wrap justify-center gap-2 mt-4">
        {onTour && <button type="button" onClick={onTour} className="border border-signal/50 rounded-sm px-4 py-2 font-mono text-xs text-signal">TOUR INHERITED WORLD</button>}
        {onReplayOrder && <button type="button" onClick={onReplayOrder} className="border border-signal/50 rounded-sm px-4 py-2 font-mono text-xs text-signal">WATCH ORDER ROLL</button>}
      </div>}
      {you && <button type="button" onClick={() => dispatch({ type: "setup.acknowledgeOrder", playerId: actor })} className="mt-6 bg-signal text-ink rounded-sm px-6 py-3 font-display font-black tracking-widest">BEGIN SETUP</button>}
    </div>
  </TakeoverOverlay>;
}

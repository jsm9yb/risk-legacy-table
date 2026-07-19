import type { Action, GameState } from "@risk/rules";
import { TakeoverOverlay } from "./overlays.tsx";

export default function SetupOrderTakeover({ gs, actor, dispatch, you }: {
  gs: GameState;
  actor: string;
  dispatch: (action: Action) => void;
  you?: boolean;
}) {
  const setup = gs.setup!;
  return <TakeoverOverlay label="Setup order reveal" wide>
    <div className="max-w-3xl mx-auto text-center">
      <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-signal">Every game begins with the high roll</p>
      <h2 className="font-display font-black tracking-widest text-3xl mt-2">SETUP ORDER</h2>
      <div className="grid sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-7">
        {setup.chooserOrder.map((playerId, index) => <div key={playerId} className={`border rounded-sm p-4 ${index === 0 ? "border-signal bg-signal/10" : "border-line bg-panel/60"}`}>
          <p className="font-mono text-[10px] text-muted">ROLL</p><p className="font-display font-black text-4xl text-signal my-2">{setup.rolls[playerId]}</p><p className="font-display font-bold tracking-wide text-sm">{gs.players[playerId].name}</p><p className="font-mono text-[9px] text-muted mt-1">{index === 0 ? "HIGH ROLLER" : `ORDER ${index + 1}`}</p>
        </div>)}
      </div>
      <p className="text-sm text-muted mt-6">{gs.advancedDraft ? "The high roller takes the first setup card. The direction reverses after every draft round." : "The high roller chooses first; setup continues clockwise."}</p>
      {you && <button type="button" onClick={() => dispatch({ type: "setup.acknowledgeOrder", playerId: actor })} className="mt-6 bg-signal text-ink rounded-sm px-6 py-3 font-display font-black tracking-widest">BEGIN SETUP</button>}
    </div>
  </TakeoverOverlay>;
}

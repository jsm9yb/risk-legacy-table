// new (UI-8): full-screen faction + starting-power takeover during setup.
// UI-1 folded in: only player-facing names/descriptions from the content pack — never raw ids.
import { contentPack } from "@risk/content";
import type { GameState } from "@risk/rules";
import type { UiState } from "./GameScreen.tsx";
import { powerById, powerName } from "./labels.ts";
import { DecisionChip, TakeoverOverlay } from "./overlays.tsx";

export default function SetupTakeover({ gs, ui, setUi, actor, you }: {
  gs: GameState;
  ui: UiState;
  setUi: (fn: (u: UiState) => UiState) => void;
  actor: string;
  you?: boolean;
}) {
  const player = gs.players[actor];
  const picked = ui.pickedFaction ? contentPack.factions.find((f) => f.id === ui.pickedFaction) : undefined;

  return (
    <TakeoverOverlay label="Faction setup">
      <div className="flex items-center justify-between gap-4 mb-8">
        <h2 className="font-display font-bold tracking-widest text-2xl">
          {picked ? "CHOOSE YOUR STARTING POWER" : "CHOOSE YOUR FACTION"}
        </h2>
        <DecisionChip name={player.name} color={picked?.color} you={you} />
      </div>

      {!picked ? (
        <div className="grid gap-3">
          {contentPack.factions.map((f) => {
            const taken = Object.values(gs.players).some((x) => x.factionId === f.id);
            const permanent = gs.factionPowers[f.id];
            return (
              <button key={f.id} disabled={taken}
                onClick={() => setUi((u) => ({ ...u, pickedFaction: f.id, pickedPower: undefined }))}
                className={`text-left border rounded-sm p-4 ${taken ? "opacity-35 border-line" : "border-line hover:border-signal"}`}>
                <span className="flex items-center gap-2.5 mb-1.5">
                  <span className="w-3 h-3 rounded-full" style={{ background: f.color }} />
                  <span className="font-display font-bold tracking-widest text-lg">{f.name}</span>
                  {taken && <span className="font-mono text-[10px] text-muted ml-auto">TAKEN</span>}
                </span>
                <span className="block text-xs text-muted">
                  {permanent
                    ? <>Power (permanent): <span className="text-text">{powerName(permanent)}</span></>
                    : <>Starting powers: <span className="text-text">{f.startingPowers.map(powerName).join(" or ")}</span></>}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div>
          <div className="flex items-center gap-2.5 mb-4">
            <span className="w-3 h-3 rounded-full" style={{ background: picked.color }} />
            <span className="font-display font-bold tracking-widest text-lg">{picked.name}</span>
            <button onClick={() => setUi((u) => ({ ...u, pickedFaction: undefined, pickedPower: undefined }))}
              className="ml-auto font-mono text-xs text-muted hover:text-text">← ALL FACTIONS</button>
          </div>
          <p className="font-mono text-[10px] text-muted uppercase tracking-widest mb-3">
            Permanent for this faction — every future game in this world
          </p>
          <div className="grid gap-3">
            {picked.startingPowers.map((pwId) => {
              const pw = powerById(pwId)!;
              return (
                <button key={pwId} onClick={() => setUi((u) => ({ ...u, pickedPower: pwId }))}
                  className="text-left border border-line hover:border-signal rounded-sm p-4">
                  <span className="font-display font-bold tracking-widest block mb-1">{pw.name}</span>
                  <span className="text-xs text-muted">{pw.text}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </TakeoverOverlay>
  );
}

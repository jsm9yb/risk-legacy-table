import { useMemo, useState } from "react";
import { createGame, type GameEvent, type GameState } from "@risk/rules";
import GameTable from "./GameTable.tsx";
import type { InteractionModel } from "./interaction/InteractionPolicy.ts";

const factions = ["die_mechaniker", "enclave_of_the_bear", "imperial_balkania", "khan_industries", "saharan_republic", "mutants", "aliens"];
const scarIds = ["ammo_shortage", "biohazard", "bunker", "fallout", "fortification", "mercenary", "weakness"];

function fixture(options: { players: number; empty: boolean; allMarks: boolean; clutter: boolean }): GameState {
  const playerDefinitions = ["Ada", "Lin", "Rex", "Sol", "Mara"].slice(0, options.players).map((name, index) => ({ id: `u${index + 1}`, name }));
  const state = createGame({ gameId: "presentation-demo", seed: 424242, players: playerDefinitions });
  if (options.empty) return state;
  state.phase = "expand_attack";
  state.setup = undefined;
  state.turnOrder = playerDefinitions.map(({ id }) => id);
  state.activeIdx = 0;
  playerDefinitions.forEach(({ id }, index) => { state.players[id].factionId = factions[index]; });
  const ids = Object.keys(state.territories);
  ids.forEach((id, index) => {
    state.territories[id] = { controller: playerDefinitions[index % playerDefinitions.length].id, troops: [1, 2, 3, 5, 8, 14, 23, 99][index % 8], scars: [] };
  });
  state.territories.alaska.hqFaction = "die_mechaniker";
  state.territories.northwest_territory.hqFaction = "enclave_of_the_bear";
  state.territories.alberta.city = { type: "minor", population: 1, name: "Northgate" };
  state.territories.ontario.city = { type: "major", population: 2, name: "Forge" };
  state.territories.ontario.fortification = { max: 10, remaining: 7 };
  state.territories.quebec.scars = ["bunker", "ammo_shortage"];
  state.territories.iceland.ruin = true;
  if (options.allMarks) {
    scarIds.forEach((scarId, index) => { state.territories[ids[index + 8]].scars = [scarId]; });
    state.territories.middle_east.city = { type: "world_capital", population: 5, name: "Last Bastion" };
    state.alienIsland = { territoryId: "alien_island", name: "New Eden", connections: ["indonesia", "eastern_australia"] };
    state.territories.alien_island = { controller: "u1", troops: 10, scars: [] };
  }
  if (options.clutter) {
    ids.forEach((id, index) => {
      const territory = state.territories[id];
      territory.hqFaction = factions[index % factions.length];
      territory.fortification = { max: 10, remaining: (index % 10) + 1 };
      territory.scars = [scarIds[index % scarIds.length], scarIds[(index + 2) % scarIds.length], scarIds[(index + 4) % scarIds.length]];
      if (index % 4 === 0) territory.ruin = true;
      else territory.city = { type: index % 5 === 0 ? "world_capital" : index % 2 === 0 ? "major" : "minor", population: index % 5 === 0 ? 5 : index % 2 === 0 ? 2 : 1, name: `Audit ${index + 1}` };
    });
    state.alienIsland = { territoryId: "alien_island", name: "New Eden", connections: ["indonesia", "eastern_australia"] };
    state.territories.alien_island = { controller: "u1", troops: 99, hqFaction: "aliens", city: { type: "major", population: 2, name: "Arrival" }, fortification: { max: 10, remaining: 10 }, scars: ["fallout", "bunker", "biohazard"] };
  }
  return state;
}

export default function TableDemo() {
  const query = useMemo(() => new URLSearchParams(location.search), []);
  const playerCount = Math.max(3, Math.min(5, Number(query.get("players")) || 3));
  const fixtureName = query.get("fixture");
  const [state, setState] = useState(() => fixture({ players: playerCount, empty: fixtureName === "empty", allMarks: fixtureName === "marks", clutter: fixtureName === "clutter" }));
  const [selected, setSelected] = useState("alaska");
  const [intentView, setIntentView] = useState<"battle" | "matrix">("battle");
  const interaction = useMemo<InteractionModel>(() => ({
    mode: "expand_attack",
    selectedTerritoryId: selected,
    instruction: "Presentation runtime visual fixture",
    territories: Object.fromEntries(Object.keys(state.territories).map((id, index) => [id, intentView === "matrix"
      ? (["start", "recruit", "attack", "maneuver", "illegal", "inspect"] as const)[index % 6]
      : id === selected ? "selected" : id === "northwest_territory" ? "attack" : "inspect"])),
  }), [intentView, selected, state.territories]);

  const transition = (events: Omit<GameEvent, "seq">[], change?: (next: GameState) => void) => setState((current) => {
    const next = structuredClone(current);
    for (const event of events) next.log.push({ ...event, seq: ++next.eventSeq } as GameEvent);
    change?.(next);
    return next;
  });

  const setFaction = (factionId: string) => setState((current) => {
    const next = structuredClone(current);
    next.players.u1.factionId = factionId;
    for (const [id, territory] of Object.entries(next.territories)) if (territory.controller === "u1" && id === "alaska") territory.hqFaction = factionId;
    return next;
  });

  const battle = (attackerLosses: number, defenderLosses: number) => transition([
    { type: "AttackDeclared", playerId: "u1", data: { from: "alaska", to: "northwest_territory", defender: "u2" } },
    { type: "DiceRolled", playerId: "u1", data: { from: "alaska", to: "northwest_territory", att: [6, 4, 2], def: [5, 3] } },
    { type: "CombatResolved", playerId: "u1", data: { from: "alaska", to: "northwest_territory", attackerLosses, defenderLosses } },
  ]);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-ink p-3">
      <GameTable authoritativeState={state} interaction={interaction} onTerritoryActivate={setSelected} source="replay" />
      <div className="absolute bottom-4 left-1/2 z-50 flex max-w-[95vw] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 rounded border border-white/15 bg-black/80 p-2 backdrop-blur">
        <label className="sr-only" htmlFor="demo-faction">Faction</label>
        <select id="demo-faction" aria-label="Demo faction" value={state.players.u1.factionId ?? factions[0]} onChange={(event) => setFaction(event.target.value)} className="rounded bg-panel px-2 py-1 font-mono text-xs text-text">
          {factions.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
        <select aria-label="Demo intents" value={intentView} onChange={(event) => setIntentView(event.target.value as "battle" | "matrix")} className="rounded bg-panel px-2 py-1 font-mono text-xs text-text">
          <option value="battle">Battle intents</option><option value="matrix">All intents</option>
        </select>
        <DemoButton label="RECRUIT" onClick={() => transition([{ type: "TroopsPlaced", playerId: "u1", data: { territory: "alaska", count: 3 } }], (next) => { next.territories.alaska.troops += 3; })} />
        <DemoButton label="MANEUVER" onClick={() => transition([{ type: "Maneuvered", playerId: "u1", data: { from: "alaska", to: "alberta", count: 3 } }], (next) => { next.territories.alaska.troops -= 3; next.territories.alberta.troops += 3; })} />
        <DemoButton label="BATTLE" onClick={() => battle(1, 2)} />
        <DemoButton label="ATTACKER LOSS" onClick={() => battle(1, 0)} />
        <DemoButton label="DEFENDER LOSS" onClick={() => battle(0, 2)} />
        <DemoButton label="MISSILE" onClick={() => transition([
          { type: "AttackDeclared", playerId: "u1", data: { from: "alaska", to: "northwest_territory", defender: "u2" } },
          { type: "MissileCommitted", playerId: "u1", data: { side: "att", dieIndex: 0, naturalValue: 5, from: "alaska", to: "northwest_territory" } } as any,
          { type: "DiceRolled", playerId: "u1", data: { from: "alaska", to: "northwest_territory", att: [6, 4, 2], def: [5, 3] } },
        ])} />
        <DemoButton label="CONQUEST" onClick={() => transition([{ type: "TerritoryConquered", playerId: "u1", data: { from: "alaska", territory: "northwest_territory", moved: 3, hqCaptured: "enclave_of_the_bear" } }], (next) => { next.territories.northwest_territory.controller = "u1"; next.territories.northwest_territory.troops = 3; })} />
        <DemoButton label="SCAR" onClick={() => transition([{ type: "ScarPlayed", playerId: "u1", data: { territory: "greenland", scarId: "fallout" } }], (next) => next.territories.greenland.scars.push("fallout"))} />
        <DemoButton label="MODULE" onClick={() => transition([{ type: "ModuleRevealed", data: { moduleId: "pocket_demo" } }])} />
        <DemoButton label="NUCLEAR" onClick={() => transition([{ type: "NuclearOpeningResolved", data: { territories: ["alaska", "northwest_territory", "alberta"] } }], (next) => { next.territories.alaska.troops = Math.max(0, next.territories.alaska.troops - 3); next.territories.northwest_territory.troops = 0; })} />
        <DemoButton label="VICTORY" onClick={() => transition([{ type: "GameWon", playerId: "u1", data: { reason: "4 Red Stars" } }], (next) => { next.winner = "u1"; next.winReason = "4 Red Stars"; })} />
        <DemoButton label="SIGNING" onClick={() => transition([{ type: "BoardSigned", playerId: "u1", data: { signatures: 1 } }])} />
      </div>
    </main>
  );
}

function DemoButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="rounded border border-white/15 bg-panel px-2 py-1 font-mono text-[10px] text-text hover:border-signal">{label}</button>;
}

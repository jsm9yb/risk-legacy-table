import { isLegalStart, neighborsOf, type GameState } from "@risk/rules";
import { manifest } from "@risk/map";
import type { UiState } from "./GameScreen.tsx";
import { continentName, factionById, scarById, scarName, territoryName } from "./labels.ts";
import FactionEmblem from "./FactionEmblem.tsx";
import { ignoresManeuverConnectivity, maneuverDestinations } from "./maneuverUi.ts";

export default function Inspector({ gs, tid, actor, canAct, ui }: {
  gs: GameState;
  tid: string;
  actor?: string;
  canAct: boolean;
  ui: UiState;
}) {
  const t = gs.territories[tid];
  if (!t) return null;
  const def = manifest.territories.find((territory) => territory.id === tid);
  const owner = t.controller ? gs.players[t.controller] : undefined;

  return (
    <section data-testid="inspector" className="px-5 py-4 border-b border-line">
      <h3 className="font-display font-bold tracking-widest text-sm text-muted mb-3">TERRITORY</h3>
      <div className="mb-3">
        <span className="font-display font-bold tracking-widest text-lg block">{territoryName(tid)}</span>
        <span className="font-mono text-xs text-muted">{def ? continentName(def.continent) : "Off-board territory"}</span>
      </div>
      <div className="font-mono text-sm space-y-1.5 mb-3">
        <div className="flex items-center gap-2">
          {owner ? (
            <>
              <FactionEmblem factionId={owner.factionId} size="xs" />
              <span>{owner.name}</span>
              <span className="text-muted ml-auto">{t.troops} troops</span>
            </>
          ) : (
            <span className="text-muted">unclaimed{t.troops > 0 ? ` / ${t.troops} troops` : ""}</span>
          )}
        </div>
        {t.hqFaction && <div className="text-muted">HQ: <span className="text-text">{factionById(t.hqFaction)?.name}</span> (worth a Red Star to its holder)</div>}
        {t.city && <div className="text-muted">{t.city.type === "major" ? "Major" : t.city.type === "minor" ? "Minor" : "World"} City{t.city.name ? ` "${t.city.name}"` : ""} / population {t.city.population}</div>}
        {t.scars.map((sid) => (
          <div key={sid} className="text-danger">
            Scar: {scarName(sid)}
            {!!scarById(sid)?.text && <span className="block pl-3 text-xs text-muted">{String(scarById(sid)!.text)}</span>}
          </div>
        ))}
        {t.fortification && <div className="text-muted">Fortification {t.fortification.remaining}/{t.fortification.max} (+1 each defense die)</div>}
      </div>
      {actor && canAct && <NextClick gs={gs} tid={tid} actor={actor} ui={ui} />}
    </section>
  );
}

function startReason(gs: GameState, tid: string): string {
  const t = gs.territories[tid];
  if (t.controller) return `already claimed by ${gs.players[t.controller].name}`;
  if (t.city) return "marked by a city";
  if (t.scars.length > 0) return "marked by a scar";
  if (neighborsOf(gs, tid).some((n) => gs.territories[n].hqFaction)) return "adjacent to another HQ";
  return "not a legal start";
}

function NextClick({ gs, tid, actor, ui }: { gs: GameState; tid: string; actor: string; ui: UiState }) {
  const t = gs.territories[tid];
  const mine = t.controller === actor;

  let line: React.ReactNode = null;
  let targets: { id: string; verdict: string; tone: "attack" | "expand" | "move" | "muted" }[] = [];

  if (gs.phase === "setup" && ui.pickedFaction) {
    const legal = isLegalStart(gs, tid, true, ui.pickedFaction, actor);
    line = legal
      ? <>Next click here: <span className="text-signal">place your HQ and starting troops</span>.</>
      : <>Cannot start here: <span className="text-danger">{startReason(gs, tid)}</span>.</>;
  } else if (gs.phase === "join_or_recruit") {
    const owned = Object.values(gs.territories).some((x) => x.controller === actor);
    if (!owned) {
      const legal = isLegalStart(gs, tid, false, gs.players[actor].factionId, actor);
      line = legal
        ? <>Next click here: <span className="text-signal">re-enter the war</span>.</>
        : <>Cannot re-enter here: <span className="text-danger">{startReason(gs, tid)}</span>.</>;
    } else if (gs.recruit) {
      line = mine
        ? <>Next click here: <span className="text-signal">place {Math.min(ui.placeCount, gs.recruit.remaining)} troops</span> ({gs.recruit.remaining} left).</>
        : <>Not yours: recruits land only on your territories.</>;
    }
  } else if (gs.phase === "expand_attack" && !gs.combat) {
    if (mine) {
      line = ui.selected === tid
        ? <>Attack source. Click an adjacent target:</>
        : <>Next click here: <span className="text-signal">select as your attack source</span>.</>;
      const canAttack = t.troops >= 2;
      targets = neighborsOf(gs, tid).map((n) => {
        const nt = gs.territories[n];
        if (!nt.controller && nt.troops === 0) return { id: n, verdict: `expand (${ui.expandCount} troops in)`, tone: "expand" as const };
        if (nt.controller && nt.controller !== actor) {
          if (gs.blockedAttackTargets.includes(n)) return { id: n, verdict: "locked this turn (Defensive Stand)", tone: "muted" as const };
          if (!canAttack) return { id: n, verdict: "cannot attack: needs 2+ troops here", tone: "muted" as const };
          return { id: n, verdict: `attack ${gs.players[nt.controller].name} (${nt.troops} defending)`, tone: "attack" as const };
        }
        if (nt.controller === actor) return { id: n, verdict: "yours", tone: "muted" as const };
        return { id: n, verdict: "occupied ground", tone: "muted" as const };
      });
    } else if (ui.selected && neighborsOf(gs, ui.selected).includes(tid)) {
      line = t.controller
        ? <>Next click here: <span className="text-danger">declare the attack from {territoryName(ui.selected)}</span>: {t.troops} defending.</>
        : <>Next click here: <span className="text-ok">expand from {territoryName(ui.selected)}</span> with {ui.expandCount} troops.</>;
    } else {
      line = <>Select one of your territories first to attack or expand.</>;
    }
  } else if (gs.phase === "maneuver" && !gs.maneuverUsed) {
    if (mine) {
      const network = maneuverDestinations(gs, actor, tid);
      const ignoresConnectivity = ignoresManeuverConnectivity(gs, actor);
      line = ui.selected === tid
        ? <>Maneuver source. Legal destinations:</>
        : t.troops < 2
          ? <>Cannot maneuver from here: <span className="text-danger">source needs 2+ troops</span>.</>
          : <>Next click here: <span className="text-signal">select as your maneuver source</span>.</>;
      targets = t.troops >= 2
        ? network.map((n) => ({ id: n, verdict: `move ${Math.min(ui.moveCount, Math.max(1, t.troops - 1))} troops${ignoresConnectivity ? " (connectivity ignored)" : ""}`, tone: "move" as const }))
        : [];
      if (t.troops >= 2 && network.length === 0) line = <>No legal destination from here.</>;
    } else if (ui.selected) {
      const reachable = maneuverDestinations(gs, actor, ui.selected).includes(tid);
      const ignoresConnectivity = ignoresManeuverConnectivity(gs, actor);
      line = reachable
        ? <>Next click here: <span className="text-ok">move {ui.moveCount} troops from {territoryName(ui.selected)}</span>.</>
        : ignoresConnectivity
          ? <>Not yours: this power ignores connectivity, but the destination must still be owned by you.</>
          : <>Unreachable: maneuvers travel only through territory you control.</>;
    }
  }

  if (!line && !targets.length) return null;
  const toneCls = { attack: "text-danger", expand: "text-ok", move: "text-ok", muted: "text-muted" };
  return (
    <div className="text-sm border-t border-line pt-3">
      <p className="mb-2">{line}</p>
      {targets.length > 0 && (
        <div className="font-mono text-xs space-y-1 max-h-40 overflow-y-auto">
          {targets.map((x) => (
            <div key={x.id}>
              <span className="text-muted">{territoryName(x.id)}:</span>{" "}
              <span className={toneCls[x.tone]}>{x.verdict}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

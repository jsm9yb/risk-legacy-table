import { redStars, type GameState, type TerritoryId } from "@risk/rules";
import { factionById, powerName, scarName, titleCase } from "./labels.ts";
import SideboardMat from "./cards/SideboardMat.tsx";
import FactionEmblem from "./FactionEmblem.tsx";

type Props = {
  gs: GameState;
  actor?: string;
  playerFaction: (pid?: string) => string | undefined;
  onTerritoryCardHover?: (territoryId: TerritoryId | undefined) => void;
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="px-5 py-4 border-b border-line">
      <h3 className="font-display font-bold tracking-widest text-sm text-muted mb-3">{title}</h3>
      {children}
    </section>
  );
}

export default function SidePanel({ gs, actor, playerFaction, onTerritoryCardHover }: Props) {
  return (
    <div>
      {gs.phase === "game_over" && (
        <Section title="RESULT">
          <p className="text-sm mb-2 flex items-center gap-2">
            <FactionEmblem factionId={gs.players[gs.winner!]?.factionId} size="xs" />
            <span><span className="text-signal font-semibold">{gs.players[gs.winner!]?.name}</span> wins: {gs.winReason}. Board is locked.</span>
          </p>
          <div className="font-mono text-xs space-y-0.5">
            {Object.entries(gs.results ?? {}).map(([fid, r]) => (
              <div key={fid}><span className="text-muted">{factionById(fid)?.name}:</span> {r.replace("_", " ")}</div>
            ))}
          </div>
        </Section>
      )}

      <RailStatus gs={gs} actor={actor} />

      <Section title="QUICK LOOK">
        <div className="space-y-2.5">
          {gs.turnOrder.map((pid) => {
            const pl = gs.players[pid];
            const rs = redStars(gs, pid);
            const active = pid === actor;
            const faction = factionById(pl.factionId);
            return (
              <div key={pid} className={`rounded-sm border border-line/70 bg-panel-2/60 px-3 py-2 ${active ? "ring-1 ring-signal/50" : ""} ${pl.eliminated ? "opacity-45" : ""}`}>
                <div className="flex items-center gap-2.5 min-w-0">
                  {pl.factionId
                    ? <FactionEmblem factionId={pl.factionId} size="sm" />
                    : <span className="w-3 h-3 rounded-full" style={{ background: playerFaction(pid) ?? "#5a6578" }} />}
                  <div className="min-w-0 flex-1">
                    <div className={`font-display font-bold tracking-wide text-lg leading-tight truncate ${active ? "text-signal" : "text-text"}`}>
                      {pl.name}
                    </div>
                    <div className="text-xs text-muted leading-tight truncate">
                      {faction?.name ?? "Faction unchosen"}{pl.knockedOut ? " / KO" : ""}{pl.eliminated ? " / Eliminated" : ""}
                    </div>
                    {pl.factionId && factionAttachments(gs, pl.factionId).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1" aria-label={`${faction?.name ?? pl.factionId} permanent attachments`}>
                        {factionAttachments(gs, pl.factionId).map((attachment) => (
                          <span key={attachment} className="font-mono text-[9px] border border-line rounded-full px-1.5 py-0.5 text-muted">{attachment}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2 font-mono">
                  <Metric label="Stars" value={`${rs.total}`} detail={`${rs.tokens} token + ${rs.board} board`} />
                  <Metric label="Cards" value={`${(pl as any).handCount ?? pl.hand.length}`} />
                  <Metric label="Missiles" value={`${pl.missiles}`} />
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="SIDEBOARD">
        <SideboardMat gs={gs} onTerritoryCardHover={onTerritoryCardHover} />
      </Section>
    </div>
  );
}

function factionAttachments(gs: GameState, factionId: string) {
  return [
    gs.factionPowers[factionId] ? `Power: ${powerName(gs.factionPowers[factionId])}` : undefined,
    gs.comebackPowers[factionId] ? `Comeback: ${gs.comebackPowers[factionId].title}` : undefined,
    gs.factionMissilePowers[factionId] ? `Missile: ${titleCase(gs.factionMissilePowers[factionId])}` : undefined,
    gs.factionWeaknesses[factionId] ? `Weakness: ${scarName(`weakness_${gs.factionWeaknesses[factionId]}`)}` : undefined,
    factionId === "mutants" && gs.mutantEvolution ? `Evolution: ${titleCase(gs.mutantEvolution)}` : undefined,
    gs.leadFactionId === factionId ? "Lead faction" : undefined,
    gs.alienCollaboratorFactionId === factionId ? "Alien collaborator" : undefined,
    gs.bringerOfNuclearFireFactionId === factionId ? "Bringer of Nuclear Fire" : undefined,
    gs.capturedPrivateMissions[factionId] ? "Private Mission attached" : undefined,
  ].filter((value): value is string => !!value);
}

function RailStatus({ gs, actor }: { gs: GameState; actor?: string }) {
  const player = actor ? gs.players[actor] : undefined;
  const phase = gs.phase === "join_or_recruit" ? "Recruitment" : gs.phase.replace(/_/g, " ");
  return (
    <Section title="STATUS">
      <div className="rounded-sm border border-signal/35 bg-panel-2/70 px-4 py-3">
        <div className="font-mono text-xs uppercase tracking-widest text-muted">Turn {gs.turnNumber}</div>
        <div className="font-display font-extrabold tracking-widest text-2xl text-signal capitalize">{phase}</div>
        {player && (
          <div className="mt-1 flex items-center gap-2">
            <FactionEmblem factionId={player.factionId} size="xs" />
            <span className="text-base font-semibold">{player.name}</span>
          </div>
        )}
        <p className="mt-2 text-sm leading-snug text-text">{instructionFor(gs, actor)}</p>
      </div>
    </Section>
  );
}

function instructionFor(gs: GameState, actor?: string) {
  if (gs.phase === "game_over") return "Resolve post-game rewards and review the final board.";
  if (!actor) return "Waiting for the next table decision.";
  if (gs.phase === "setup") return "Choose setup options, then place the starting HQ.";
  if (gs.phase === "start_turn") return "Buy Red Stars or begin recruitment.";
  if (gs.phase === "join_or_recruit") {
    if (!gs.recruit) return "Join the war on a legal starting territory.";
    return gs.recruit.remaining > 0 ? "Place generated troops on owned territories." : "All troops placed. Advance to Attack.";
  }
  if (gs.phase === "expand_attack") return "Select a source territory, attack or expand, then end attacks.";
  if (gs.phase === "maneuver") return gs.maneuverUsed ? "Maneuver used. End the phase." : "Move troops once, or skip maneuver.";
  if (gs.phase === "end_turn") return "Draw if eligible, then end the turn.";
  return "Review the table state.";
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
      <div data-metric={label.toLowerCase()} className="text-base font-bold text-text leading-tight">{value}</div>
      {detail && <div className="text-[10px] text-muted truncate">{detail}</div>}
    </div>
  );
}

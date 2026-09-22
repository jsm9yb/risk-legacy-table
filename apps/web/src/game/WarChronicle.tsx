import { useState } from "react";
import type { GameEvent, GameState } from "@risk/rules";
import { continentName, factionById, scarName, territoryName } from "./labels.ts";
import { permanentHistoryFrames, type HistoryFrame, type HistoryPlaybackOptions } from "./history/PublicBoardHistory.ts";
import FactionEmblem from "./FactionEmblem.tsx";

export interface WarMoment {
  seq: number;
  title: string;
  detail: string;
  playerId?: string;
  territory?: string;
  weight: number;
}

/** Only explicitly public event fields become a highlight. Never stringify log
 * payloads: private mission text, held cards and deck order do not belong here. */
export function publicWarMoments(gs: GameState): WarMoment[] {
  const moments = gs.log.flatMap((event): WarMoment[] => {
    const data = event.data;
    const who = event.playerId ? gs.players[event.playerId]?.name ?? "A player" : "The world";
    const territory = typeof data?.territory === "string" ? data.territory : undefined;
    const place = territory ? territoryName(territory) : "the board";
    const base = { seq: event.seq, playerId: event.playerId, territory };
    switch (event.type) {
      case "TerritoryConquered": return [{ ...base, weight: data?.hqCaptured ? 8 : 2,
        title: data?.hqCaptured ? "HEADQUARTERS CAPTURED" : "BORDER BROKEN",
        detail: `${who} took ${place}${data?.hqCaptured ? ` and captured ${factionById(String(data.hqCaptured))?.name ?? "an enemy"} HQ` : ""}.` }];
      case "PlayerEliminated": return [{ ...base, weight: 7, title: "FACTION ELIMINATED", detail: `${who} was eliminated from this war.` }];
      case "NuclearKnockout": return [{ ...base, weight: 9, title: "NUCLEAR TURNING POINT", detail: `${who} was knocked out by nuclear fire.` }];
      case "ModuleRevealed": return [{ ...base, weight: 8, title: "A SEAL WAS BROKEN", detail: `${String(data?.name ?? data?.moduleId ?? "A new packet")} joined this world's history.` }];
      case "RedStarPurchased": return [{ ...base, weight: 4, title: "RESOURCES BECAME VICTORY", detail: `${who} purchased a Red Star.` }];
      case "ScarPlayed": return territory ? [{ ...base, weight: 3, title: "A LASTING MARK", detail: `${who} scarred ${place}.` }] : [];
      case "GameWon": return [{ ...base, weight: 100, title: "THE DECISIVE MOMENT", detail: `${who} won: ${String(data?.reason ?? gs.winReason ?? "victory")}.` }];
      default: return [];
    }
  });
  // Keep the most consequential events, then restore the actual historical order.
  return moments.sort((a, b) => b.weight - a.weight || b.seq - a.seq).slice(0, 5).sort((a, b) => a.seq - b.seq);
}

export function decisivePublicMoment(gs: GameState): WarMoment | undefined {
  const won = gs.log.findLast((event) => event.type === "GameWon");
  if (!won) return undefined;
  return publicWarMoments(gs).filter((moment) => moment.seq < won.seq && moment.playerId === gs.winner).at(-1);
}

/** Player-paced history cards launch recorded public board views through the director. */
export default function WarChronicle({ gs, frames = [], onPlay }: { gs: GameState; frames?: HistoryFrame[]; onPlay?: (frames: readonly HistoryFrame[], options?: HistoryPlaybackOptions) => void }) {
  const moments = publicWarMoments(gs);
  const [index, setIndex] = useState(0);
  if (moments.length === 0) return null;
  const shown = Math.min(index, moments.length - 1);
  const moment = moments[shown];
  const recorded = frames.find(frame => (frame.startSeq ?? frame.seq - 1) < moment.seq && frame.seq >= moment.seq);
  const highlights = [...frames].sort((a, b) => b.weight - a.weight || b.seq - a.seq).slice(0, 5).sort((a, b) => a.seq - b.seq);
  const permanent = permanentHistoryFrames(gs, frames);
  const comparison = permanent.length ? {...permanent.at(-1)!, id: "whole-world-comparison", title: "How this war changed the world", view: "board" as const, before: permanent[0].before, after: permanent.at(-1)!.after} : undefined;
  const player = moment.playerId ? gs.players[moment.playerId] : undefined;
  return <section aria-label="History of this war" className="border border-signal/45 bg-panel-2/60 rounded-sm p-4 mb-6">
    <div className="flex items-center justify-between gap-3 mb-3">
      <h3 className="font-display font-bold tracking-widest text-sm">HISTORY OF THIS WAR</h3>
      <span className="font-mono text-[10px] text-muted">{shown + 1} / {moments.length}</span>
    </div>
    <div aria-live="polite" aria-atomic="true" className="flex items-center gap-3 min-h-20">
      {player && <FactionEmblem factionId={player.factionId} size="sm" />}
      <div><p className="font-mono text-[10px] text-signal tracking-widest">{moment.title}</p>
        <p className="text-sm mt-1">{moment.detail}</p></div>
    </div>
    {onPlay && <div className="flex flex-wrap gap-2 mt-3">
      <button disabled={!highlights.length} className="border border-signal text-signal px-3 py-2 text-xs disabled:opacity-30" onClick={() => onPlay(highlights)}>PLAY BOARD HIGHLIGHTS</button>
      <button disabled={!recorded} className="border border-line px-3 py-2 text-xs disabled:opacity-30" onClick={() => recorded && onPlay([recorded])}>SHOW THIS MOMENT ON BOARD</button>
      {comparison && <button className="border border-line px-3 py-2 text-xs" onClick={() => onPlay([comparison], {hold: true, side: "before"})}>COMPARE PERMANENT BOARD</button>}
      {comparison && permanent.some(frame => frame.view === "resources") && <button className="border border-line px-3 py-2 text-xs" onClick={() => onPlay([{...comparison, view: "resources", title: "Permanent resource values"}], {hold: true, side: "before"})}>COMPARE CARD VALUES</button>}
      {!recorded && <p className="text-xs text-muted w-full">Historical army positions were not recorded for this moment. Its public event remains in the chronicle.</p>}
    </div>}
    <div className="flex items-center gap-2 mt-3">
      <button disabled={shown === 0} onClick={() => setIndex(shown - 1)} className="border border-line px-3 py-1 rounded-sm text-xs disabled:opacity-30">PREVIOUS MOMENT</button>
      <button disabled={shown === moments.length - 1} onClick={() => setIndex(shown + 1)} className="border border-signal px-3 py-1 rounded-sm text-xs text-signal disabled:opacity-30">NEXT MOMENT</button>
      <button disabled={shown === moments.length - 1} onClick={() => setIndex(moments.length - 1)} className="ml-auto text-xs text-muted disabled:opacity-30">SKIP TO VICTORY</button>
    </div>
  </section>;
}

export interface PermanentDelta { seq: number; label: string; before: string; after: string }

/** Before values are reconstructed only where the committed event proves them. */
export function permanentDeltas(events: GameEvent[]): PermanentDelta[] {
  return events.flatMap((event): PermanentDelta[] => {
    const data = event.data;
    const territory = typeof data?.territory === "string" ? territoryName(data.territory) : "Territory";
    const row = (label: string, before: string, after: string) => [{ seq: event.seq, label, before, after }];
    switch (event.type) {
      case "ContinentNamed": return row(continentName(String(data?.continentId ?? "")), "Unnamed", String(data?.name ?? "Named"));
      case "ContinentBonusChanged": return row(continentName(String(data?.continentId ?? "")), "Unmarked bonus", `${Number(data?.delta) > 0 ? "+1" : "−1"} permanent bonus mark`);
      case "BoardSigned": return typeof data?.signatures === "number"
        ? row("Winner's signatures", String(data.signatures - 1), String(data.signatures)) : [];
      case "MajorCityFounded": case "MinorCityFounded":
        return row(territory, "No city", `${String(data?.name ?? "New city")} · ${event.type === "MajorCityFounded" ? "major" : "minor"} city`);
      case "TerritoryCardUpgraded": return typeof data?.resources === "number"
        ? row(String(data.cardId ?? "Resource card").replaceAll("_", " "), `${data.resources - 1} resources`, `${data.resources} resources`) : [];
      case "TerritoryCardDestroyed": return row(`${territory} card`, "In campaign", "Permanently destroyed");
      case "ScarCancelled": return row(territory, scarName(String(data?.scarId ?? "Scar")), "Scar removed");
      case "ModuleRevealed": return row(String(data?.name ?? data?.moduleId ?? "Packet"), "Sealed", "Open for future games");
      case "AlienIslandPlaced": return row(String(data?.name ?? "Alien Island"), "Outside the board", "Connected to the world");
      default: return [];
    }
  });
}

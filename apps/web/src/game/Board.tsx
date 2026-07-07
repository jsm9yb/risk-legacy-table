import type { ReactElement } from "react";
import { manifest, anchor } from "@risk/map";
import { contentPack } from "@risk/content";
import type { GameState } from "@risk/rules";

const CONTINENT_FILL: Record<string, string> = {
  north_america: "#27384c", south_america: "#3c3527", europe: "#283c30",
  africa: "#43352a", asia: "#352c44", australia: "#40262d",
};
const W = 56, H = 42;

function shape(cx: number, cy: number): string {
  const x = cx - W / 2, y = cy - H / 2, r = 9;
  return `M ${x + r} ${y} h ${W - 2 * r} a ${r} ${r} 0 0 1 ${r} ${r} v ${H - 2 * r} a ${r} ${r} 0 0 1 -${r} ${r} h -${W - 2 * r} a ${r} ${r} 0 0 1 -${r} -${r} v -${H - 2 * r} a ${r} ${r} 0 0 1 ${r} -${r} Z`;
}

export type Highlight = "selected" | "highlight-attack" | "highlight-move" | "highlight-start" | "dimmed";

export default function Board({
  gs, playerFaction, highlights, onTerritoryClick,
}: {
  gs: GameState;
  playerFaction: (pid?: string) => string | undefined;
  highlights: Record<string, Highlight>;
  onTerritoryClick: (tid: string) => void;
}) {
  // Routes (drawn once; wrap route dashed to both edges)
  const routes: ReactElement[] = [];
  const drawn = new Set<string>();
  for (const t of manifest.territories) {
    const a = anchor(t);
    for (const n of t.neighbors) {
      const key = [t.id, n].sort().join("|");
      if (drawn.has(key)) continue;
      drawn.add(key);
      const b = anchor(manifest.territories.find((x) => x.id === n)!);
      if (key === "alaska|kamchatka") {
        routes.push(<path key={key + "a"} d={`M ${a.x} ${a.y} H 6`} stroke="#232c3d" strokeDasharray="3 3" fill="none" />);
        routes.push(<path key={key + "b"} d={`M ${b.x} ${b.y} H 744`} stroke="#232c3d" strokeDasharray="3 3" fill="none" />);
      } else {
        routes.push(<path key={key} d={`M ${a.x} ${a.y} L ${b.x} ${b.y}`} stroke="#232c3d" fill="none" />);
      }
    }
  }

  return (
    // Placeholder board rendered from the manifest. Real-asset swap point: load
    // packages/map/assets/board.svg and bind handlers to its .territory-border ids.
    <svg id="risk-board-modern" viewBox="0 0 749.819 519.068" className="w-full h-full select-none">
      <g>{routes}</g>
      <g>
        {manifest.territories.map((t) => {
          const a = anchor(t);
          const st = gs.territories[t.id];
          const cls = highlights[t.id] ?? "";
          const owner = st.controller;
          const color = owner ? playerFaction(owner) : undefined;
          return (
            <g key={t.id} onClick={() => onTerritoryClick(t.id)}>
              <path
                id={t.id}
                className={`territory-border territory ${cls}`}
                d={shape(a.x, a.y)}
                fill={CONTINENT_FILL[t.continent]}
                stroke={color ?? "#0b0e13"}
                strokeWidth={color ? 2 : 1.2}
              />
              <text x={a.x} y={a.y + H / 2 + 9} textAnchor="middle"
                style={{ font: "600 6.5px var(--font-body)", fill: "var(--color-muted)", pointerEvents: "none" }}>
                {t.name}
              </text>
              {st.hqFaction && (
                <g pointerEvents="none">
                  <rect x={a.x + W / 2 - 14} y={a.y - H / 2 + 3} width={11} height={11} rx={2}
                    fill="#0c0f15" stroke={factionColorSafe(st.hqFaction)} strokeWidth={1.6} />
                  <text x={a.x + W / 2 - 8.5} y={a.y - H / 2 + 11.5} textAnchor="middle"
                    style={{ font: "700 7px var(--font-mono)", fill: factionColorSafe(st.hqFaction) }}>★</text>
                </g>
              )}
              {st.troops > 0 && (
                <g pointerEvents="none">
                  <circle cx={a.x - W / 2 + 10} cy={a.y - H / 2 + 9} r={8.5}
                    fill={color ?? "#5a6578"} stroke="#0b0e13" strokeWidth={1.2} />
                  <text x={a.x - W / 2 + 10} y={a.y - H / 2 + 12} textAnchor="middle"
                    style={{ font: "700 8.5px var(--font-mono)", fill: "#0c0f15" }}>{st.troops}</text>
                </g>
              )}
              {st.city && (
                <text pointerEvents="none" x={a.x} y={a.y + 4} textAnchor="middle"
                  style={{ font: "700 8px var(--font-mono)", fill: "var(--color-text)" }}>⌂{st.city.population}</text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function factionColorSafe(id?: string) {
  return contentPack.factions.find((f) => f.id === id)?.color ?? "#5a6578";
}

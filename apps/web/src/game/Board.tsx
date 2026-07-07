import { useLayoutEffect, useRef } from "react";
import { manifest, anchor } from "@risk/map";
import { contentPack } from "@risk/content";
import type { GameState } from "@risk/rules";
import boardSvg from "../../../../packages/map/assets/board.svg?raw";

export type Highlight = "selected" | "highlight-attack" | "highlight-move" | "highlight-start" | "dimmed";

const TERRITORY_IDS = new Set(manifest.territories.map((t) => t.id));

export default function Board({
  gs, playerFaction, highlights, onTerritoryClick,
}: {
  gs: GameState;
  playerFaction: (pid?: string) => string | undefined;
  highlights: Record<string, Highlight>;
  onTerritoryClick: (tid: string) => void;
}) {
  const artRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = artRef.current?.querySelector<SVGSVGElement>("#risk-board-modern");
    if (!root) return;

    for (const territory of manifest.territories) {
      const path = root.querySelector<SVGPathElement>(`path#${territory.id}`);
      if (!path) continue;

      const st = gs.territories[territory.id];
      const ownerColor = st.controller ? playerFaction(st.controller) : undefined;
      const highlight = highlights[territory.id];
      path.setAttribute("class", ["territory-border", "territory", highlight].filter(Boolean).join(" "));
      if (ownerColor) {
        path.setAttribute("stroke", ownerColor);
        path.setAttribute("stroke-width", "2.2");
      } else {
        path.removeAttribute("stroke");
        path.removeAttribute("stroke-width");
      }
      path.setAttribute("tabindex", "0");
      if (st.controller) path.dataset.owner = st.controller;
      else delete path.dataset.owner;
    }
  }, [gs.territories, highlights, playerFaction]);

  const handleClick = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return;
    const path = target.closest("path.territory-border");
    const id = path?.id;
    if (id && TERRITORY_IDS.has(id)) onTerritoryClick(id);
  };

  return (
    <div className="board-art-frame relative w-full h-full select-none" onClick={(e) => handleClick(e.target)}>
      <div ref={artRef} className="absolute inset-0" dangerouslySetInnerHTML={{ __html: boardSvg }} />
      <svg
        aria-hidden="true"
        viewBox={manifest.viewBox}
        preserveAspectRatio="xMidYMin meet"
        className="absolute inset-0 w-full h-full pointer-events-none overflow-visible"
      >
        {manifest.territories.map((t) => {
          const a = anchor(t);
          const st = gs.territories[t.id];
          const owner = st.controller;
          const color = owner ? playerFaction(owner) : undefined;
          return (
            <g key={t.id}>
              {st.hqFaction && (
                <g transform={`translate(${a.x + 21} ${a.y - 18})`}>
                  <path d="M 0 -8 L 8 0 L 0 8 L -8 0 Z" fill="#0c0f15" stroke={factionColorSafe(st.hqFaction)} strokeWidth={1.8} />
                  <text y="3" textAnchor="middle" style={{ font: "800 7px var(--font-mono)", fill: factionColorSafe(st.hqFaction) }}>H</text>
                </g>
              )}
              {st.troops > 0 && (
                <g transform={`translate(${a.x - 23} ${a.y - 17})`}>
                  <circle r={10.5} fill={color ?? "#5a6578"} stroke="#071018" strokeWidth={1.7} />
                  <circle r={7.1} fill="#f2e8bd" opacity={0.18} />
                  <text y="3.4" textAnchor="middle" style={{ font: "800 9.5px var(--font-mono)", fill: "#080c12" }}>{st.troops}</text>
                </g>
              )}
              {st.city && (
                <g transform={`translate(${a.x - 12} ${a.y + 5})`}>
                  <rect x="0" y="6" width="24" height="12" rx="1.5" fill="#151b24" stroke="#d8c074" strokeWidth="1.3" />
                  <path d="M 3 6 V 1 H 8 V 6 M 10 6 V -2 H 15 V 6 M 17 6 V 3 H 21 V 6" fill="none" stroke="#d8c074" strokeWidth="1.2" />
                  <text x="12" y="15.2" textAnchor="middle" style={{ font: "800 7.5px var(--font-mono)", fill: "#f1e6b7" }}>{st.city.population}</text>
                </g>
              )}
              {st.scars.length > 0 && (
                <g transform={`translate(${a.x + 18} ${a.y + 17})`}>
                  <rect x="-9" y="-6" width="18" height="12" rx="2" fill="#c9504a" stroke="#12080a" strokeWidth="1.1" />
                  <text y="3.1" textAnchor="middle" style={{ font: "900 8px var(--font-mono)", fill: "#1a0708" }}>!</text>
                </g>
              )}
              {st.fortification && (
                <g transform={`translate(${a.x + 1} ${a.y - 18})`}>
                  <path d="M -8 -7 H 8 V -1 C 8 5 4 8 0 10 C -4 8 -8 5 -8 -1 Z" fill="#1c2631" stroke="#d8c074" strokeWidth="1.2" />
                  <text y="2.8" textAnchor="middle" style={{ font: "800 7px var(--font-mono)", fill: "#f1e6b7" }}>F</text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function factionColorSafe(id?: string) {
  return contentPack.factions.find((f) => f.id === id)?.color ?? "#5a6578";
}

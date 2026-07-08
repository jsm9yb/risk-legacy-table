import { useLayoutEffect, useRef } from "react";
import { manifest, anchor } from "@risk/map";
import { contentPack } from "@risk/content";
import type { GameState } from "@risk/rules";
import boardSvg from "../../../../packages/map/assets/board.svg?raw";
import { FACTION_EMBLEMS, FACTION_TROOP_SHAPES, SCAR_ART, type TroopShape } from "./factionAssets.ts"; // new (UI-10)

// new (UI-10): distinct troop-marker silhouettes per faction (~r10.5 footprint)
const TROOP_SHAPE_PATHS: Record<TroopShape, string> = {
  circle: "M 0 -10.5 A 10.5 10.5 0 1 1 -0.01 -10.5 Z",
  square: "M -9 -9 H 9 V 9 H -9 Z",
  diamond: "M 0 -11.5 L 11.5 0 L 0 11.5 L -11.5 0 Z",
  hex: "M 0 -11 L 9.5 -5.5 L 9.5 5.5 L 0 11 L -9.5 5.5 L -9.5 -5.5 Z",
  shield: "M -9 -9 H 9 V 1 C 9 6.5 4.5 9.5 0 11.5 C -4.5 9.5 -9 6.5 -9 1 Z",
};

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
      // Owner tint via inline style so it beats the board's `.territory-border` stylesheet rule
      // (a presentation attribute would lose to it); defer to the `.territory.<highlight>` class
      // while a highlight is active so interaction feedback reads clearly. // new
      if (ownerColor && !highlight) {
        path.style.stroke = ownerColor;
        path.style.strokeWidth = "2.8"; // new (UI-4): stronger owner tint
      } else {
        path.style.stroke = "";
        path.style.strokeWidth = "";
      }
      path.removeAttribute("stroke");
      path.removeAttribute("stroke-width");
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
          const ownerFactionId = owner ? gs.players[owner]?.factionId : undefined; // new (UI-10)
          const troopShape = TROOP_SHAPE_PATHS[(ownerFactionId && FACTION_TROOP_SHAPES[ownerFactionId]) || "circle"]; // new (UI-10)
          return (
            <g key={t.id}>
              {st.hqFaction && ( // new (UI-10): HQ renders as a circular emblem shield in the HQ faction's color
                <g transform={`translate(${a.x + 21} ${a.y - 18})`} data-hq-emblem={st.hqFaction}>
                  <circle r={10.6} fill="#0c0f15" stroke={factionColorSafe(st.hqFaction)} strokeWidth={2.3} />{/* new (UI-4): larger shield */}
                  {FACTION_EMBLEMS[st.hqFaction] ? (
                    <>
                      <clipPath id={`hq-clip-${t.id}`}><circle r={9} /></clipPath>
                      <image href={FACTION_EMBLEMS[st.hqFaction]} x={-9} y={-9} width={18} height={18}
                        clipPath={`url(#hq-clip-${t.id})`} preserveAspectRatio="xMidYMid slice" />
                    </>
                  ) : (
                    <text y="3" textAnchor="middle" style={{ font: "800 8px var(--font-mono)", fill: factionColorSafe(st.hqFaction) }}>H</text>
                  )}
                </g>
              )}
              {st.troops > 0 && (
                <g transform={`translate(${a.x - 23} ${a.y - 17})`} data-troop-shape={(ownerFactionId && FACTION_TROOP_SHAPES[ownerFactionId]) || "circle"}>
                  <g transform="scale(1.15)">{/* new (UI-4): bigger troop counters, readable at 1280x720 */}
                    <path d={troopShape} fill={color ?? "#5a6578"} stroke="#071018" strokeWidth={1.7} strokeLinejoin="round" />{/* new (UI-10): faction silhouette */}
                    <circle r={6.6} fill="#f2e8bd" opacity={0.18} />
                  </g>
                  <text y="3.8" textAnchor="middle" style={{ font: "800 10.5px var(--font-mono)", fill: "#080c12" }}>{st.troops}</text>
                </g>
              )}
              {st.city && (
                <g transform={`translate(${a.x - 12} ${a.y + 5})`}>
                  <rect x="-1" y="5.5" width="26" height="13.5" rx="1.5" fill="#151b24" stroke="#e8d084" strokeWidth="1.6" />{/* new (UI-4): stronger city marker */}
                  <path d="M 3 6 V 1 H 8 V 6 M 10 6 V -2 H 15 V 6 M 17 6 V 3 H 21 V 6" fill="none" stroke="#e8d084" strokeWidth="1.4" />
                  <text x="12" y="15.6" textAnchor="middle" style={{ font: "800 8.5px var(--font-mono)", fill: "#f6ecc2" }}>{st.city.population}</text>
                </g>
              )}
              {st.scars.length > 0 && ( // new (UI-10): scar art as a circular board chip
                <g transform={`translate(${a.x + 18} ${a.y + 17})`} data-scar-chip={st.scars[0]}>
                  <circle r={8.4} fill="#1a0708" stroke="#c9504a" strokeWidth={1.5} />
                  {SCAR_ART[st.scars[0]] ? (
                    <>
                      <clipPath id={`scar-clip-${t.id}`}><circle r={7.2} /></clipPath>
                      <image href={SCAR_ART[st.scars[0]]} x={-7.2} y={-7.2} width={14.4} height={14.4}
                        clipPath={`url(#scar-clip-${t.id})`} preserveAspectRatio="xMidYMid slice" />
                    </>
                  ) : (
                    <text y="3.1" textAnchor="middle" style={{ font: "900 8px var(--font-mono)", fill: "#c9504a" }}>!</text>
                  )}
                  {st.scars.length > 1 && (
                    <text x="8" y="-8" textAnchor="middle" style={{ font: "800 6.5px var(--font-mono)", fill: "#c9504a" }}>×{st.scars.length}</text>
                  )}
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

/**
 * Generates the placeholder board SVG from the manifest.
 * Contract matches the private asset risk_board_modern_web.svg:
 *  - 42 paths with class "territory-border", id = territory id
 *  - viewBox 0 0 749.819 519.068, root id "risk-board-modern"
 * Swap in the real SVG at packages/map/assets/board.svg when available.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { manifest, anchor, validateManifest } from "./index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const errors = validateManifest();
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }

const CONTINENT_HUE: Record<string, string> = {
  north_america: "#3b5b7a", south_america: "#6a5a3b", europe: "#4a6a52",
  africa: "#7a5a45", asia: "#5d4a72", australia: "#73424d",
};

const W = 56, H = 42;
function roundedPath(cx: number, cy: number): string {
  const x = cx - W / 2, y = cy - H / 2, r = 9;
  return `M ${x + r} ${y} h ${W - 2 * r} a ${r} ${r} 0 0 1 ${r} ${r} v ${H - 2 * r} a ${r} ${r} 0 0 1 -${r} ${r} h -${W - 2 * r} a ${r} ${r} 0 0 1 -${r} -${r} v -${H - 2 * r} a ${r} ${r} 0 0 1 ${r} -${r} Z`;
}

let connectors = "";
const drawn = new Set<string>();
for (const t of manifest.territories) {
  const a = anchor(t);
  for (const n of t.neighbors) {
    const key = [t.id, n].sort().join("|");
    if (drawn.has(key)) continue;
    drawn.add(key);
    const b = anchor(manifest.territories.find((x) => x.id === n)!);
    const sea = key === "alaska|kamchatka";
    if (sea) {
      // wrap-around route drawn to both edges
      connectors += `<path class="route sea" d="M ${a.x} ${a.y} H 6" /><path class="route sea" d="M ${b.x} ${b.y} H 744" />`;
    } else {
      connectors += `<path class="route" d="M ${a.x} ${a.y} L ${b.x} ${b.y}" />`;
    }
  }
}

let territories = "";
let labels = "";
for (const t of manifest.territories) {
  const a = anchor(t);
  territories += `<path id="${t.id}" class="territory-border" data-continent="${t.continent}" d="${roundedPath(a.x, a.y)}" fill="${CONTINENT_HUE[t.continent]}" />\n`;
  labels += `<text class="territory-label" x="${a.x}" y="${a.y + H / 2 + 9}" text-anchor="middle">${t.name}</text>\n`;
}

const svg = `<svg id="risk-board-modern" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 749.819 519.068">
<title>Risk Legacy private board (placeholder)</title>
<desc>Generated placeholder board. 42 territory-border paths keyed by canonical territory ids.</desc>
<style>
  .territory-border { stroke: #0b0e13; stroke-width: 1.5; }
  .route { stroke: #2a3242; stroke-width: 1.2; fill: none; }
  .route.sea { stroke-dasharray: 3 3; }
  .territory-label { font: 600 6.5px ui-sans-serif, system-ui; fill: #c8d2e0; pointer-events: none; }
</style>
<rect x="0" y="0" width="749.819" height="519.068" fill="#10141c" />
<g id="routes">${connectors}</g>
<g id="territories">
${territories}</g>
<g id="labels">
${labels}</g>
</svg>
`;

mkdirSync(join(here, "../assets"), { recursive: true });
writeFileSync(join(here, "../assets/board.svg"), svg);
console.log(`board.svg generated: ${manifest.territories.length} territories, ${drawn.size} routes`);

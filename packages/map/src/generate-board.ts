/**
 * Generates the web board SVG from normalized real-board territory paths.
 * Contract:
 *  - root id "risk-board-modern"
 *  - viewBox "0 0 749.819 519.068"
 *  - 42 paths with class "territory-border" and id = canonical territory id
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { anchor, continentColors, manifest, validateManifest, visualConnections, type TerritoryDef } from "./index.ts";
import territoryPathJson from "../data/territory-paths.json" with { type: "json" };

const here = dirname(fileURLToPath(import.meta.url));
const errors = validateManifest();
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }

const BOARD_W = 749.819;
const BOARD_H = 519.068;

const territoryPathData = territoryPathJson as unknown as {
  sourceTransform: readonly [number, number];
  territories: Record<string, {
    d: string;
    anchor: readonly [number, number];
    bbox: readonly [number, number, number, number];
  }>;
};

const TERRITORY_FILL: Record<string, string> = {
  alaska: "#fff100",
  northwest_territory: "#8cc63f",
  greenland: "#19aaa3",
  alberta: "#8cc63f",
  ontario: "#8cc63f",
  quebec: "#8cc63f",
  western_united_states: "#fff100",
  eastern_united_states: "#fff100",
  central_america: "#f15a24",
  venezuela: "#f89a1c",
  peru: "#f89a1c",
  brazil: "#f89a1c",
  argentina: "#f89a1c",
  iceland: "#8293c4",
  great_britain: "#8293c4",
  scandinavia: "#8293c4",
  ukraine: "#8293c4",
  northern_europe: "#8293c4",
  southern_europe: "#8293c4",
  western_europe: "#8293c4",
  north_africa: "#a66a2a",
  egypt: "#a66a2a",
  east_africa: "#a66a2a",
  congo: "#a66a2a",
  south_africa: "#a66a2a",
  madagascar: "#a66a2a",
  ural: "#5b8038",
  siberia: "#5b8038",
  yakutsk: "#5b8038",
  kamchatka: "#5b8038",
  irkutsk: "#5b8038",
  mongolia: "#a91663",
  japan: "#b21768",
  afghanistan: "#68bd45",
  china: "#a91663",
  middle_east: "#68bd45",
  india: "#ec008c",
  siam: "#755b65",
  indonesia: "#755b65",
  new_guinea: "#755b65",
  western_australia: "#755b65",
  eastern_australia: "#755b65",
};

type LabelTweak = {
  dx?: number;
  dy?: number;
  size?: number;
  maxWidth?: number;
  lines?: string[];
};

const LABEL_TWEAKS: Record<string, LabelTweak> = {
  alaska: { dx: 2, dy: 2 },
  northwest_territory: { dy: -3, size: 5.8, lines: ["Northwest", "Territory"], maxWidth: 58 },
  western_united_states: { dy: 7, size: 5.8, lines: ["Western", "United States"], maxWidth: 60 },
  eastern_united_states: { dy: 9, size: 5.8, lines: ["Eastern", "United States"], maxWidth: 60 },
  central_america: { dx: -2, dy: 8, size: 5.6, lines: ["Central", "America"], maxWidth: 47 },
  greenland: { dy: -2 },
  great_britain: { dx: -2, dy: 4, size: 5.6, lines: ["Great", "Britain"], maxWidth: 39 },
  scandinavia: { size: 5.6, maxWidth: 54 },
  northern_europe: { dy: 4, size: 5.6, lines: ["Northern", "Europe"], maxWidth: 53 },
  southern_europe: { dy: 7, size: 5.6, lines: ["Southern", "Europe"], maxWidth: 55 },
  western_europe: { dx: -3, dy: 6, size: 5.6, lines: ["Western", "Europe"], maxWidth: 50 },
  north_africa: { dx: -3, dy: 3, lines: ["North", "Africa"] },
  east_africa: { dy: 8, lines: ["East", "Africa"] },
  south_africa: { dy: 10, lines: ["South", "Africa"] },
  madagascar: { dx: 3, dy: 8, size: 5.4, maxWidth: 44 },
  ukraine: { dx: 0, dy: -8, maxWidth: 56 },
  ural: { dx: -6, dy: -2 },
  siberia: { dy: -17, maxWidth: 48 },
  yakutsk: { dy: -8 },
  kamchatka: { dx: 2, dy: -7, size: 5.8, maxWidth: 58 },
  irkutsk: { dy: 2 },
  mongolia: { dy: 2 },
  japan: { dx: 4, dy: 6, size: 5.3, maxWidth: 28 },
  afghanistan: { dy: 4, size: 5.8 },
  middle_east: { dy: 12, size: 5.7, lines: ["Middle", "East"] },
  china: { dy: 0, maxWidth: 58 },
  india: { dx: -3, dy: 5 },
  siam: { dy: 4 },
  indonesia: { dy: 2, size: 5.6, maxWidth: 52 },
  new_guinea: { dy: 3, size: 5.5, lines: ["New", "Guinea"], maxWidth: 42 },
  western_australia: { dy: 13, size: 5.4, lines: ["Western", "Australia"], maxWidth: 58 },
  eastern_australia: { dy: 8, size: 5.4, lines: ["Eastern", "Australia"], maxWidth: 56 },
};

const CONTINENT_MARKER_COLORS = continentColors; // shared palette (also fills card silhouettes, UI-9)

const CONTINENT_CALLOUTS: Record<string, {
  x: number;
  y: number;
  target: string;
  leadFrom: readonly [number, number];
  numberSide?: "left" | "right";
}> = {
  north_america: { x: 86, y: 35, target: "alberta", leadFrom: [158, 53] },
  south_america: { x: 188, y: 249, target: "brazil", leadFrom: [216, 265], numberSide: "left" },
  europe: { x: 310, y: 44, target: "scandinavia", leadFrom: [385, 62] },
  africa: { x: 494, y: 377, target: "east_africa", leadFrom: [502, 389], numberSide: "left" },
  asia: { x: 474, y: 28, target: "ural", leadFrom: [558, 46] },
  australia: { x: 528, y: 482, target: "western_australia", leadFrom: [612, 482] },
};

function fmt(n: number): string {
  return n.toFixed(2).replace(/\.?0+$/, "");
}

function esc(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function territory(id: string): TerritoryDef {
  const t = manifest.territories.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown territory: ${id}`);
  return t;
}

function routePath(fromId: string, toId: string): string {
  const from = anchor(territory(fromId));
  const to = anchor(territory(toId));
  if (fromId === "alaska" && toId === "kamchatka") {
    return `M ${fmt(from.x - 16)} ${fmt(from.y + 10)} C 38 91 17 92 4 91 M ${fmt(to.x + 23)} ${fmt(to.y - 3)} C 710 101 729 101 746 101`;
  }
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy) || 1;
  const bend = Math.min(26, distance * 0.22);
  const nx = -dy / distance;
  const ny = dx / distance;
  const cx = (from.x + to.x) / 2 + nx * bend;
  const cy = (from.y + to.y) / 2 + ny * bend;
  return `M ${fmt(from.x)} ${fmt(from.y)} Q ${fmt(cx)} ${fmt(cy)} ${fmt(to.x)} ${fmt(to.y)}`;
}

function routeNodes(fromId: string, toId: string): string {
  if (fromId === "alaska" && toId === "kamchatka") {
    const from = anchor(territory(fromId));
    const to = anchor(territory(toId));
    return `<circle class="route-node" cx="${fmt(from.x - 16)}" cy="${fmt(from.y + 10)}" r="3.4" /><circle class="route-node" cx="${fmt(to.x + 23)}" cy="${fmt(to.y - 3)}" r="3.4" />`;
  }
  const from = anchor(territory(fromId));
  const to = anchor(territory(toId));
  return `<circle class="route-node" cx="${fmt(from.x)}" cy="${fmt(from.y)}" r="3.4" /><circle class="route-node" cx="${fmt(to.x)}" cy="${fmt(to.y)}" r="3.4" />`;
}

function wrapName(name: string, maxChars = 12): string[] {
  const words = name.split(" ");
  if (name.length <= maxChars || words.length === 1) return [name];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length > 2 ? [words.slice(0, -1).join(" "), words.at(-1)!] : lines;
}

function lineTspan(line: string, x: number, y: number, size: number, maxWidth: number, first: boolean): string {
  const estimatedWidth = line.length * size * 0.56;
  const fit = estimatedWidth > maxWidth
    ? ` textLength="${fmt(maxWidth)}" lengthAdjust="spacingAndGlyphs"`
    : "";
  return `<tspan x="${fmt(x)}" ${first ? `y="${fmt(y)}"` : `dy="${fmt(size + 1)}"`}${fit}>${esc(line)}</tspan>`;
}

const LABEL_SCALE = 1.16; // new (UI-4): legibility pass — labels readable at 1280x720 without zoom

function territoryLabel(t: TerritoryDef): string {
  const a = anchor(t);
  const path = territoryPathData.territories[t.id];
  const tweak = LABEL_TWEAKS[t.id] ?? {};
  const lines = tweak.lines ?? wrapName(t.name);
  const bboxWidth = path.bbox[2] - path.bbox[0];
  const size = (tweak.size ?? (lines.some((line) => line.length > 13) ? 5.8 : 6.2)) * LABEL_SCALE;
  const maxWidth = tweak.maxWidth ?? Math.max(22, Math.min(72, bboxWidth - 8));
  const x = a.x + (tweak.dx ?? 0);
  const y = a.y + (tweak.dy ?? 0) + (lines.length === 1 ? 2.5 : -3);
  const tspans = lines.map((line, i) => lineTspan(line, x, y, size, maxWidth, i === 0)).join("");
  return `<text class="territory-label" text-anchor="middle" font-size="${fmt(size)}">${tspans}</text>`;
}

function continentCallout(continent: typeof manifest.continents[number]): string {
  const cfg = CONTINENT_CALLOUTS[continent.id];
  if (!cfg) return "";

  const count = manifest.territories.filter((t) => t.continent === continent.id).length;
  const target = anchor(territory(cfg.target));
  const color = CONTINENT_MARKER_COLORS[continent.id] ?? "#d8d8d8";
  const boxW = 86;
  const boxH = 16;
  const radius = 12;
  const numberSide = cfg.numberSide ?? "right";
  const boxX = numberSide === "left" ? radius * 2 + 4 : 0;
  const circleX = numberSide === "left" ? radius : boxW + radius + 4;
  const leadMidX = (cfg.leadFrom[0] + target.x) / 2;
  const leadMidY = (cfg.leadFrom[1] + target.y) / 2 - 18;

  return `<g class="continent-callout" data-continent="${continent.id}">
  <path class="continent-lead" d="M ${fmt(cfg.leadFrom[0])} ${fmt(cfg.leadFrom[1])} Q ${fmt(leadMidX)} ${fmt(leadMidY)} ${fmt(target.x)} ${fmt(target.y)}" stroke="${color}" />
  <g transform="translate(${fmt(cfg.x)} ${fmt(cfg.y)})">
    <rect class="continent-callout-box" x="${fmt(boxX)}" y="0" width="${boxW}" height="${boxH}" rx="1.5" fill="${color}" />
    <rect class="continent-callout-notch" x="${fmt(boxX + boxW - 9)}" y="3" width="6" height="10" fill="none" />
    <text class="continent-count" x="${fmt(boxX + boxW / 2 - 3)}" y="10.8" textLength="${fmt(boxW - 14)}" lengthAdjust="spacingAndGlyphs">${count} TERRITORIES</text>
    <circle class="continent-bonus-disc" cx="${fmt(circleX)}" cy="${fmt(boxH / 2)}" r="${radius}" fill="${color}" />
    <text class="continent-bonus" x="${fmt(circleX)}" y="15">${continent.baseBonus}</text>
  </g>
</g>`;
}

const [tx, ty] = territoryPathData.sourceTransform;
let haloes = "";
let territories = "";
let labels = "";

for (const t of manifest.territories) {
  const path = territoryPathData.territories[t.id];
  if (!path) throw new Error(`Missing path data for ${t.id}`);
  const fill = TERRITORY_FILL[t.id];
  haloes += `<path class="territory-halo" d="${path.d}" />\n`;
  territories += `<path id="${t.id}" class="territory-border territory" data-continent="${t.continent}" role="button" aria-label="${esc(t.name)}" d="${path.d}" fill="${fill}" />\n`;
  labels += `${territoryLabel(t)}\n`;
}

let routes = "";
for (const [from, to] of visualConnections) {
  const routeId = `${from}--${to}`;
  routes += `<path class="route-line" data-route="${routeId}" data-from="${from}" data-to="${to}" d="${routePath(from, to)}" />\n${routeNodes(from, to)}\n`;
}

const continentCallouts = manifest.continents.map((continent) => continentCallout(continent)).join("\n");

const signatureLines = Array.from({ length: 20 }, (_, i) => {
  const y = 301 + i * 9.2;
  return `<text class="signature-num" x="14" y="${fmt(y + 2.2)}">${i + 1}</text><path class="signature-line" d="M 22 ${fmt(y)} H 120" />`;
}).join("\n");

const topSlots = [14, 77, 140].map((x) =>
  `<path class="top-slot" d="M ${x} 14 h 16 M ${x} 14 q -8 0 -8 7 q 0 7 8 7 h 16 M ${x + 47} 14 h -16 M ${x + 47} 14 q 8 0 8 7 q 0 7 -8 7 h -16" />`
).join("\n");

const svg = `<svg id="risk-board-modern" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 749.819 519.068" preserveAspectRatio="xMidYMin meet">
<title>Risk Legacy campaign board</title>
<desc>Risk-board-inspired SVG game board using canonical 42-territory ids.</desc>
<defs>
  <linearGradient id="board-bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#929292" />
    <stop offset="0.5" stop-color="#d8d8d8" />
    <stop offset="1" stop-color="#858585" />
  </linearGradient>
  <radialGradient id="board-light" cx="50%" cy="44%" r="74%">
    <stop offset="0" stop-color="#ffffff" stop-opacity="0.35" />
    <stop offset="0.65" stop-color="#ffffff" stop-opacity="0.04" />
    <stop offset="1" stop-color="#000000" stop-opacity="0.18" />
  </radialGradient>
  <pattern id="table-grain" width="34" height="34" patternUnits="userSpaceOnUse">
    <path d="M0 10 H34 M10 0 V34" stroke="#ffffff" stroke-opacity="0.06" stroke-width="0.6" />
    <path d="M0 33 H34 M33 0 V34" stroke="#000000" stroke-opacity="0.05" stroke-width="0.6" />
  </pattern>
  <filter id="land-shadow" x="-8%" y="-8%" width="116%" height="116%">
    <feDropShadow dx="0" dy="2.2" stdDeviation="2.2" flood-color="#000000" flood-opacity="0.42" />
  </filter>
</defs>
<style>
  .signature-rail, .top-slot { pointer-events: none; }
  .continent-callout { pointer-events: auto; cursor: pointer; }
  .signature-title { font-family: Impact, "Arial Black", sans-serif; fill: #f5f5f5; stroke: #787878; stroke-width: 1.1; font-size: 10px; letter-spacing: 0.2px; opacity: 0.72; }
  .signature-num { font-family: "IBM Plex Mono", Consolas, monospace; font-weight: 800; fill: #ffffff; stroke: #7f7f7f; stroke-width: 0.35; font-size: 4.8px; opacity: 0.78; }
  .signature-line { stroke: #ffffff; stroke-width: 0.8; stroke-opacity: 0.68; }
  .top-slot { fill: none; stroke: #e8e8e8; stroke-width: 1.7; stroke-linecap: round; opacity: 0.78; }
  .route-line { fill: none; stroke: #1b2430; stroke-width: 2; stroke-linecap: round; stroke-opacity: 0.36; pointer-events: stroke; transition: stroke 120ms ease, stroke-opacity 120ms ease, stroke-width 120ms ease; }
  .route-line:hover, .route-line.route-hot { stroke: #f8f8f2; stroke-width: 3; stroke-opacity: 0.92; }
  .route-node { fill: #a8a8a8; stroke: #2c2c2c; stroke-width: 1.5; opacity: 0.58; pointer-events: none; }
  .territory-halo { fill: none; stroke: #f8f8f2; stroke-width: 4.15; stroke-linejoin: round; filter: url(#land-shadow); pointer-events: none; }
  .territory-border { stroke: #f8f8f2; stroke-width: 0.72; stroke-linejoin: round; cursor: pointer; transition: filter 120ms ease, stroke 120ms ease, opacity 120ms ease; }
  .territory-border:hover { filter: brightness(1.08); }
  .territory-label { font-family: "Arial Narrow", "IBM Plex Sans", "Segoe UI", sans-serif; font-weight: 900; fill: #050505; stroke: rgba(255,255,255,0.34); stroke-width: 1.15px; paint-order: stroke fill; pointer-events: none; }
  .continent-lead { fill: none; stroke-width: 1.35; stroke-linecap: round; stroke-opacity: 0.9; }
  .continent-callout-box { stroke: #ffffff; stroke-width: 1.45; filter: url(#land-shadow); }
  .continent-callout-notch { stroke: rgba(255,255,255,0.7); stroke-width: 0.9; }
  .continent-bonus-disc { stroke: #ffffff; stroke-width: 2; filter: url(#land-shadow); }
  .continent-count { font-family: "Arial Narrow", "IBM Plex Sans", "Segoe UI", sans-serif; font-size: 4.9px; font-weight: 950; fill: #050505; text-anchor: middle; dominant-baseline: middle; }
  .continent-bonus { font-family: Impact, "Arial Black", sans-serif; font-size: 20px; font-weight: 950; fill: #050505; text-anchor: middle; stroke: rgba(255,255,255,0.45); stroke-width: 0.85; paint-order: stroke fill; }
</style>
<rect x="0" y="0" width="${fmt(BOARD_W)}" height="${fmt(BOARD_H)}" fill="url(#board-bg)" />
<rect x="0" y="0" width="${fmt(BOARD_W)}" height="${fmt(BOARD_H)}" fill="url(#table-grain)" />
<rect x="0" y="0" width="${fmt(BOARD_W)}" height="${fmt(BOARD_H)}" fill="url(#board-light)" />
<g class="top-slots">
${topSlots}
</g>
<g class="signature-rail">
  <text class="signature-title" x="12" y="286">THE WORLD OF</text>
${signatureLines}
</g>
<g id="routes">
${routes}</g>
<g id="territory-haloes" transform="translate(${fmt(tx)} ${fmt(ty)})">
${haloes}</g>
<g id="territories" transform="translate(${fmt(tx)} ${fmt(ty)})">
${territories}</g>
<g id="continent-callouts">
${continentCallouts}
</g>
<g id="labels">
${labels}</g>
</svg>
`;

mkdirSync(join(here, "../assets"), { recursive: true });
// board.svg is the hand-authored production artwork. Keep this generator as a
// geometry/debugging aid without letting `npm run generate:board` overwrite it.
const outputPath = join(here, "../assets/board.generated-preview.svg");
writeFileSync(outputPath, svg);
console.log(`board.generated-preview.svg generated: ${manifest.territories.length} territories, ${visualConnections.length} visual routes`);

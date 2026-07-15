export interface BoardLabelDefinition {
  territoryId: string;
  text: string;
  x: number;
  centerY: number;
  fontSize: number;
  lineHeight: number;
}

function attribute(source: string, name: string) {
  return source.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1];
}

function decodeText(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'");
}

function suppressTerritoryBoundaryStrokes(svg: string) {
  return svg.replace(
    /<path\b(?=[^>]*class="territory-border territory")[^>]*\/>/g,
    (path) => path.replace(/\s*\/>$/, ' style="stroke: none" />'),
  );
}

/** Separates territory labels from the board SVG so individual labels can react to troop overlap. */
export function splitBoardArtwork(svg: string, territoryIds: readonly string[]) {
  const groupMatch = svg.match(/<g\s+id="labels"[^>]*>([\s\S]*?)<\/g>/);
  if (!groupMatch) throw new Error("Board artwork is missing its territory label group");

  const labels: BoardLabelDefinition[] = [];
  const textPattern = /<text\b([^>]*)class="territory-label"([^>]*)>([\s\S]*?)<\/text>/g;
  for (const match of groupMatch[1].matchAll(textPattern)) {
    const attributes = `${match[1]} ${match[2]}`;
    const fontSize = Number(attribute(attributes, "font-size"));
    const lines = [...match[3].matchAll(/<tspan\b([^>]*)>([\s\S]*?)<\/tspan>/g)].map((line) => ({
      attributes: line[1],
      text: decodeText(line[2].replace(/<[^>]+>/g, "")),
    }));
    const first = lines[0];
    if (!first || !Number.isFinite(fontSize)) throw new Error("Board artwork contains an invalid territory label");
    const x = Number(attribute(first.attributes, "x"));
    const firstBaseline = Number(attribute(first.attributes, "y"));
    const lineHeight = lines.length > 1 ? Number(attribute(lines[1].attributes, "dy")) : fontSize + 1;
    labels.push({
      territoryId: territoryIds[labels.length] ?? "",
      text: lines.map((line) => line.text).join("\n"),
      x,
      centerY: firstBaseline + (lines.length - 1) * lineHeight / 2 - fontSize * 0.34,
      fontSize,
      lineHeight,
    });
  }

  if (labels.length !== territoryIds.length || labels.some(({ territoryId }) => !territoryId)) {
    throw new Error(`Board artwork has ${labels.length} territory labels for ${territoryIds.length} territories`);
  }
  return {
    boardSvg: suppressTerritoryBoundaryStrokes(svg.replace(groupMatch[0], '<g id="labels"></g>')),
    labels,
  };
}

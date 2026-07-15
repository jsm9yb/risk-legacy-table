import { describe, expect, it } from "vitest";
import { manifest } from "@risk/map";
import boardSvg from "../../../../../packages/map/assets/board.svg?raw";
import { splitBoardArtwork } from "./BoardArtwork.ts";

describe("board artwork layers", () => {
  it("extracts one independently renderable label for every territory", () => {
    const result = splitBoardArtwork(boardSvg, manifest.territories.map(({ id }) => id));
    expect(result.labels).toHaveLength(42);
    expect(result.labels[0]).toMatchObject({ territoryId: "alaska", text: "Alaska", x: 59.94 });
    expect(result.labels[1]).toMatchObject({ territoryId: "northwest_territory", text: "Northwest\nTerritory" });
    expect(result.boardSvg).toContain('<g id="labels"></g>');
    expect(result.boardSvg).not.toContain('class="territory-label"');
  });

  it("refuses a label set that cannot be mapped one-to-one", () => {
    expect(() => splitBoardArtwork(boardSvg, ["alaska"])).toThrow(/42 territory labels for 1 territories/);
  });
});

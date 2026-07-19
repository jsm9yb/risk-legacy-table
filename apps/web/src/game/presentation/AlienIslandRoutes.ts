import { presentationFor } from "@risk/map";

const ALIEN_ISLAND_ID = "alien_island";
const BOARD_CENTER: Point = [749.819 / 2, 519.068 / 2];
const BOARD_MARGIN = 5;

type Point = [number, number];

export interface AlienIslandRouteModel {
  territoryId: string;
  start: Point;
  control: Point;
  end: Point;
}

function squaredDistance([x1, y1]: Point, [x2, y2]: Point) {
  return (x2 - x1) ** 2 + (y2 - y1) ** 2;
}

function fallbackPort(from: Point, toward: Point, inset: number): Point {
  const dx = toward[0] - from[0];
  const dy = toward[1] - from[1];
  const length = Math.hypot(dx, dy) || 1;
  return [from[0] + dx / length * inset, from[1] + dy / length * inset];
}

function outwardControl(start: Point, end: Point): Point {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy) || 1;
  const midpoint: Point = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  const bend = Math.min(55, Math.max(10, length * 0.5));
  const normal: Point = [-dy / length * bend, dx / length * bend];
  const candidates: [Point, Point] = [
    [midpoint[0] + normal[0], midpoint[1] + normal[1]],
    [midpoint[0] - normal[0], midpoint[1] - normal[1]],
  ];
  const outward = squaredDistance(candidates[0], BOARD_CENTER) >= squaredDistance(candidates[1], BOARD_CENTER)
    ? candidates[0]
    : candidates[1];
  return [
    Math.max(BOARD_MARGIN, Math.min(749.819 - BOARD_MARGIN, outward[0])),
    Math.max(BOARD_MARGIN, Math.min(519.068 - BOARD_MARGIN, outward[1])),
  ];
}

export function alienIslandRouteModels(connections: readonly string[]): AlienIslandRouteModel[] {
  const island = presentationFor(ALIEN_ISLAND_ID);
  return connections.map((territoryId) => {
    const target = presentationFor(territoryId);
    const start = island.preferredRoutePorts[territoryId]
      ?? fallbackPort(island.cameraFocus, target.cameraFocus, 20);
    const end = target.preferredRoutePorts[ALIEN_ISLAND_ID]
      ?? fallbackPort(target.cameraFocus, island.cameraFocus, target.profile === "wide" ? 14 : target.profile === "tiny" ? 7 : 10);
    return { territoryId, start, control: outwardControl(start, end), end };
  });
}

export function alienIslandRoutePath(route: AlienIslandRouteModel) {
  return `M ${route.start.join(" ")} Q ${route.control.join(" ")} ${route.end.join(" ")}`;
}

import { presentationFor, visualConnections } from "@risk/map";
import { alienIslandRouteModels } from "./AlienIslandRoutes.ts";

export type RoutePoint = readonly [number, number];
export type MovementRoute = RoutePoint[][];

/** The route artwork is authoritative, including the split Pacific crossing. */
export function printedMovementRoute(svg: string, from: string, to: string): MovementRoute {
  const start = presentationFor(from).cameraFocus, end = presentationFor(to).cameraFocus;
  if (from === "alien_island" || to === "alien_island") {
    const other = from === "alien_island" ? to : from;
    const route = alienIslandRouteModels([other])[0];
    const samples = sampleCurve(route.start, [route.control, route.end]);
    if (to === "alien_island") samples.reverse();
    return [[start, ...samples, end]];
  }
  const index = visualConnections.findIndex(([a, b]) => a === from && b === to || a === to && b === from);
  if (index < 0) return [[start, end]];
  const path = [...svg.matchAll(/<path\b[^>]*class="route-line"[^>]*\bd="([^"]+)"/g)][index]?.[1];
  if (!path) throw new Error(`Missing printed connection ${from}–${to}`);
  const parts = [...path.matchAll(/M\s*([\d.\-]+)[ ,]+([\d.\-]+)\s*([QC])\s*([\d.,\s\-]+)/g)].map((match) => {
    const numbers = match[4].trim().split(/[\s,]+/).map(Number);
    const controls: RoutePoint[] = [];
    for (let i = 0; i < numbers.length; i += 2) controls.push([numbers[i], numbers[i + 1]]);
    return sampleCurve([Number(match[1]), Number(match[2])], controls);
  });
  if (parts.length === 2) parts[1].reverse();
  if (visualConnections[index][0] !== from) { parts.reverse(); parts.forEach((part) => part.reverse()); }
  parts[0].unshift(start); parts.at(-1)!.push(end);
  return parts;
}

function sampleCurve(start: RoutePoint, controls: RoutePoint[]): RoutePoint[] {
  return Array.from({length: 25}, (_, index) => {
    const t = index / 24, u = 1 - t;
    if (controls.length === 2) return [u * u * start[0] + 2 * u * t * controls[0][0] + t * t * controls[1][0], u * u * start[1] + 2 * u * t * controls[0][1] + t * t * controls[1][1]];
    return [u ** 3 * start[0] + 3 * u * u * t * controls[0][0] + 3 * u * t * t * controls[1][0] + t ** 3 * controls[2][0], u ** 3 * start[1] + 3 * u * u * t * controls[0][1] + 3 * u * t * t * controls[1][1] + t ** 3 * controls[2][1]];
  });
}

export function movementRoutePoint(route: MovementRoute, progress: number): RoutePoint {
  const segments = route.flatMap((part) => part.slice(1).map((end, index) => ({start: part[index], end, length: Math.hypot(end[0] - part[index][0], end[1] - part[index][1])})));
  let distance = segments.reduce((sum, segment) => sum + segment.length, 0) * Math.max(0, Math.min(1, progress));
  for (const segment of segments) {
    if (distance <= segment.length) { const p = segment.length ? distance / segment.length : 0; return [segment.start[0] + (segment.end[0] - segment.start[0]) * p, segment.start[1] + (segment.end[1] - segment.start[1]) * p]; }
    distance -= segment.length;
  }
  return route.at(-1)!.at(-1)!;
}

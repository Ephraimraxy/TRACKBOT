import { haversineMetres } from "@/lib/services/etaService";

/** A new point closer than this to the last drawn one is GPS wobble, not movement. */
export const TRAIL_MIN_METRES = 12;

interface P {
  latitude: number;
  longitude: number;
  /** The phone's own estimate of how far off the fix may be, in metres. */
  accuracy?: number | null;
}

/** A very vague fix does not get to hide a real move: its wobble allowance is capped here. */
export const TRAIL_MAX_ALLOWANCE_METRES = 50;

/**
 * Tidy the route-driven line for drawing. A phone standing still still reports points a few metres apart, which draws as
 * a tangle at the same spot. A point is dropped when it is closer to the last kept point than TRAIL_MIN_METRES, or than
 * its own stated accuracy (capped), because inside that circle the phone cannot tell it has moved. The first and the last
 * point are always kept, so the line still starts and ends where the delivery person did.
 */
export function smoothTrail<T extends P>(points: T[], minMetres = TRAIL_MIN_METRES): T[] {
  if (points.length <= 2) return points;
  const out: T[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const allowance = Math.min(Math.max(points[i].accuracy ?? 0, 0), TRAIL_MAX_ALLOWANCE_METRES);
    if (haversineMetres(out[out.length - 1], points[i]) >= Math.max(minMetres, allowance)) out.push(points[i]);
  }
  out.push(points[points.length - 1]);
  return out;
}

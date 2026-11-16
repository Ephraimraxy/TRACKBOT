import { haversineMetres } from "@/lib/services/etaService";

/** A new point closer than this to the last drawn one is GPS wobble, not movement. */
export const TRAIL_MIN_METRES = 12;

interface P {
  latitude: number;
  longitude: number;
}

/**
 * Tidy the route-driven line for drawing. A phone standing still still reports points a few metres apart, which draws as
 * a tangle at the same spot. Points closer than TRAIL_MIN_METRES to the last kept point are dropped; the first and the
 * last point are always kept, so the line still starts and ends where the delivery person did.
 */
export function smoothTrail<T extends P>(points: T[], minMetres = TRAIL_MIN_METRES): T[] {
  if (points.length <= 2) return points;
  const out: T[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    if (haversineMetres(out[out.length - 1], points[i]) >= minMetres) out.push(points[i]);
  }
  out.push(points[points.length - 1]);
  return out;
}

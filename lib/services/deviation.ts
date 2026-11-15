import { distanceToLineMetres } from "@/lib/services/etaService";

/** A GPS fix with its reported accuracy (metres, a radius) and capture time. */
export interface Fix {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  /** Milliseconds since 1970. */
  at: number;
}

/** Base distance from the planned line beyond which a fix counts as "off the road". */
export const OFF_ROUTE_METRES = 60;
/** A fix less accurate than this says too little to judge the route either way, so it is ignored. */
export const MAX_USABLE_ACCURACY = 100;
/** Off the road must be seen in at least this many fixes in a row... */
export const DEVIATION_MIN_FIXES = 3;
/** ...spread over at least this long, so one bad fix or a quick swerve never triggers a new route. */
export const DEVIATION_MIN_SECONDS = 15;

/** How far from the line a fix must be to count as off it: the base distance plus the fix's own uncertainty. */
export const offRouteThreshold = (accuracy: number | null | undefined) => OFF_ROUTE_METRES + Math.max(0, accuracy ?? 0);

/**
 * Has the delivery person really left the planned road? Only if the newest usable fixes, all of them, are beyond the
 * threshold (which grows with the fix's inaccuracy), there are at least DEVIATION_MIN_FIXES of them, and they span at
 * least DEVIATION_MIN_SECONDS. A single fix back near the line, or a poor-accuracy fix, never counts as leaving.
 *
 * `fixes` may be in any order. Late (backfilled) points should not be passed in: they say where the phone WAS.
 */
export function isSustainedDeviation(fixes: Fix[], line: [number, number][]): boolean {
  if (line.length < 2) return false;
  const usable = fixes.filter((f) => (f.accuracy ?? 0) <= MAX_USABLE_ACCURACY).sort((a, b) => b.at - a.at); // newest first
  const run: Fix[] = [];
  for (const f of usable) {
    const away = distanceToLineMetres({ latitude: f.latitude, longitude: f.longitude }, line) > offRouteThreshold(f.accuracy);
    if (!away) break; // back on the road: the deviation is over
    run.push(f);
  }
  if (run.length < DEVIATION_MIN_FIXES) return false;
  return run[0].at - run[run.length - 1].at >= DEVIATION_MIN_SECONDS * 1000;
}

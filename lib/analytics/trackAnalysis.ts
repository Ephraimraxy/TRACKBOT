import { haversineMetres as distanceMetres } from "@/lib/services/etaService";
import { DEVIATION_MIN_FIXES, isSustainedDeviation, type Fix } from "@/lib/services/deviation";
import { distanceToLineMetres } from "@/lib/services/etaService";

/** One recorded GPS point of a delivery. `at` is when the phone captured it (milliseconds since 1970). */
export interface TrackPoint {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  at: number;
  /** Arrived late (sent from the offline queue). */
  backfilled: boolean;
}

export const GAP_SECONDS = 60;
export const STOP_RADIUS_METRES = 30;
export const STOP_MIN_SECONDS = 120;
export const POOR_ACCURACY_METRES = 100;
/** Faster than this between two fixes (144 km/h) is a GPS jump, not driving. */
export const MAX_PLAUSIBLE_MS = 40;

export interface Gap { from: number; to: number; seconds: number }
export interface Stop { from: number; to: number; seconds: number; latitude: number; longitude: number }
export interface Deviation { from: number; to: number; seconds: number; maxMetresFromRoute: number }
export interface Jump { at: number; metres: number; metresPerSecond: number }

export interface TrackAnalysis {
  points: number;
  firstAt: number | null;
  lastAt: number | null;
  durationSeconds: number;
  /** Distance driven, from plausible fixes only. */
  distanceMetres: number;
  averageSpeedKmh: number | null;
  /** Time actually moving (not stopped), so the average speed is not dragged down by waiting. */
  movingSpeedKmh: number | null;
  stops: Stop[];
  gaps: Gap[];
  jumps: Jump[];
  gps: { poorAccuracyShare: number; medianAccuracyMetres: number | null; backfilledPoints: number; longestGapSeconds: number; totalGapSeconds: number };
  /** Compared with the first planned road route; null when none was kept. */
  deviations: Deviation[] | null;
  /** Straight-line distance from first point to last, and driven distance divided by it (1 is a direct run). */
  directness: number | null;
}

const median = (xs: number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Reads a delivery's GPS track and says what happened: how far and how fast, where it stopped, where the signal dropped,
 * where it jumped, and when it left the planned road. Pure: no database, no clock.
 */
export function analyseTrack(input: TrackPoint[], plannedRoute: [number, number][] | null = null): TrackAnalysis {
  const points = [...input].sort((a, b) => a.at - b.at);
  const empty: TrackAnalysis = {
    points: points.length, firstAt: points[0]?.at ?? null, lastAt: points.at(-1)?.at ?? null, durationSeconds: 0, distanceMetres: 0,
    averageSpeedKmh: null, movingSpeedKmh: null, stops: [], gaps: [], jumps: [],
    gps: { poorAccuracyShare: 0, medianAccuracyMetres: null, backfilledPoints: 0, longestGapSeconds: 0, totalGapSeconds: 0 },
    deviations: plannedRoute ? [] : null, directness: null,
  };
  if (points.length === 0) return empty;

  const durationSeconds = Math.max(0, (points.at(-1)!.at - points[0].at) / 1000);
  const gaps: Gap[] = [];
  const jumps: Jump[] = [];
  let distance = 0;
  let movingMetres = 0;
  let movingSeconds = 0;
  let prevGood: TrackPoint | null = null;

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dt = (b.at - a.at) / 1000;
    if (dt > GAP_SECONDS) gaps.push({ from: a.at, to: b.at, seconds: dt });
  }
  for (const p of points) {
    if ((p.accuracy ?? 0) > POOR_ACCURACY_METRES) continue; // too vague to measure distance from
    if (!prevGood) { prevGood = p; continue; }
    const dt = (p.at - prevGood.at) / 1000;
    const d = distanceMetres({ latitude: prevGood.latitude, longitude: prevGood.longitude }, { latitude: p.latitude, longitude: p.longitude });
    if (dt > 0 && d / dt > MAX_PLAUSIBLE_MS) {
      jumps.push({ at: p.at, metres: d, metresPerSecond: d / dt });
      continue; // do not count a jump, and keep the last good fix as the reference
    }
    distance += d;
    if (d / Math.max(dt, 1) > 0.8) { movingMetres += d; movingSeconds += dt; } // faster than a slow walk
    prevGood = p;
  }

  // Stops: a run of fixes that stay within a small radius for a couple of minutes.
  const stops: Stop[] = [];
  let i = 0;
  while (i < points.length) {
    let j = i;
    while (j + 1 < points.length && distanceMetres(points[i], points[j + 1]) <= STOP_RADIUS_METRES) j++;
    const seconds = (points[j].at - points[i].at) / 1000;
    if (j > i && seconds >= STOP_MIN_SECONDS) {
      stops.push({ from: points[i].at, to: points[j].at, seconds, latitude: points[i].latitude, longitude: points[i].longitude });
      i = j + 1;
    } else i++;
  }

  // Deviation from the first planned road route: replay the same sustained-deviation rule the live screen uses.
  let deviations: Deviation[] | null = null;
  if (plannedRoute && plannedRoute.length >= 2) {
    deviations = [];
    const live = points.filter((p) => !p.backfilled);
    let open: { from: number; max: number } | null = null;
    for (let k = 0; k < live.length; k++) {
      const window: Fix[] = live.slice(Math.max(0, k - 7), k + 1).map((p) => ({ latitude: p.latitude, longitude: p.longitude, accuracy: p.accuracy, at: p.at }));
      const off = isSustainedDeviation(window, plannedRoute);
      const away = distanceToLineMetres(live[k], plannedRoute);
      if (off) {
        if (!open) open = { from: live[Math.max(0, k - (DEVIATION_MIN_FIXES - 1))].at, max: 0 };
        open.max = Math.max(open.max, away);
      } else if (open) {
        deviations.push({ from: open.from, to: live[k].at, seconds: (live[k].at - open.from) / 1000, maxMetresFromRoute: Math.round(open.max) });
        open = null;
      }
    }
    if (open) deviations.push({ from: open.from, to: live.at(-1)!.at, seconds: (live.at(-1)!.at - open.from) / 1000, maxMetresFromRoute: Math.round(open.max) });
  }

  const accs = points.map((p) => p.accuracy).filter((a): a is number => a !== null);
  const straight = points.length > 1 ? distanceMetres(points[0], points.at(-1)!) : 0;
  return {
    points: points.length,
    firstAt: points[0].at,
    lastAt: points.at(-1)!.at,
    durationSeconds,
    distanceMetres: Math.round(distance),
    averageSpeedKmh: durationSeconds > 0 ? Math.round(((distance / durationSeconds) * 3.6) * 10) / 10 : null,
    movingSpeedKmh: movingSeconds > 0 ? Math.round(((movingMetres / movingSeconds) * 3.6) * 10) / 10 : null,
    stops,
    gaps,
    jumps,
    gps: {
      poorAccuracyShare: accs.length ? accs.filter((a) => a > POOR_ACCURACY_METRES).length / accs.length : 0,
      medianAccuracyMetres: median(accs),
      backfilledPoints: points.filter((p) => p.backfilled).length,
      longestGapSeconds: Math.round(Math.max(0, ...gaps.map((g) => g.seconds))),
      totalGapSeconds: Math.round(gaps.reduce((n, g) => n + g.seconds, 0)),
    },
    deviations,
    directness: straight > 50 ? Math.round((distance / straight) * 100) / 100 : null,
  };
}

export type FindingKind = "gps_gap" | "gps_poor" | "gps_jump" | "late_points" | "deviation" | "long_stop" | "few_points";
export interface Finding { kind: FindingKind; severity: "info" | "warning"; text: string }

/** Plain-language findings for the owner, in order of importance. */
export function findingsFor(a: TrackAnalysis): Finding[] {
  const out: Finding[] = [];
  const min = (s: number) => Math.round(s / 60);
  if (a.points < 5) out.push({ kind: "few_points", severity: "warning", text: `Only ${a.points} GPS point${a.points === 1 ? "" : "s"} were recorded, too few to judge the route.` });
  if (a.gps.longestGapSeconds >= GAP_SECONDS) out.push({ kind: "gps_gap", severity: a.gps.longestGapSeconds >= 300 ? "warning" : "info", text: `GPS went quiet ${a.gaps.length} time${a.gaps.length === 1 ? "" : "s"} (longest ${a.gps.longestGapSeconds >= 120 ? `${min(a.gps.longestGapSeconds)} min` : `${a.gps.longestGapSeconds} s`}, ${min(a.gps.totalGapSeconds)} min in total).` });
  if (a.gps.poorAccuracyShare >= 0.2) out.push({ kind: "gps_poor", severity: "warning", text: `${Math.round(a.gps.poorAccuracyShare * 100)}% of the fixes were vague (worse than ±${POOR_ACCURACY_METRES} m). Distances may be off.` });
  if (a.jumps.length > 0) out.push({ kind: "gps_jump", severity: "warning", text: `${a.jumps.length} impossible jump${a.jumps.length === 1 ? "" : "s"} in position (faster than ${Math.round(MAX_PLAUSIBLE_MS * 3.6)} km/h) were ignored.` });
  if (a.gps.backfilledPoints > 0) out.push({ kind: "late_points", severity: "info", text: `${a.gps.backfilledPoints} point${a.gps.backfilledPoints === 1 ? "" : "s"} arrived late from the phone's offline queue and were placed at their real times.` });
  if (a.deviations && a.deviations.length > 0) out.push({ kind: "deviation", severity: "warning", text: `Left the planned road ${a.deviations.length} time${a.deviations.length === 1 ? "" : "s"} (furthest ${Math.max(...a.deviations.map((d) => d.maxMetresFromRoute))} m away).` });
  const longStop = a.stops.reduce((m, s) => Math.max(m, s.seconds), 0);
  if (longStop >= 600) out.push({ kind: "long_stop", severity: "info", text: `Stopped for ${min(longStop)} min in one place.` });
  return out;
}

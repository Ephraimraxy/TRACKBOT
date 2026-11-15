import { resolveRouting, routeUrl, type RoutingConfig } from "@/lib/config/routing";

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** Why a straight-line estimate was used instead of a road route. */
export type FallbackReason = "not_configured" | "unreachable" | "bad_response";

export interface Eta {
  distanceMetres: number;
  durationSeconds: number;
  /** "route" = worked out along real roads; "estimate" = straight-line distance at an assumed speed. */
  source: "route" | "estimate";
  /** Set when `source` is "estimate": why no road route was available. */
  fallbackReason?: FallbackReason;
}

/** Typical speed for a delivery in town, used only when no road route can be worked out. */
export const FALLBACK_SPEED_KMH = 25;
/** Roads are longer than the straight line between two points. */
export const DETOUR_FACTOR = 1.35;

const EARTH_RADIUS_M = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres between two points. */
export function haversineMetres(a: LatLng, b: LatLng): number {
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A rough estimate that needs no network: straight line, stretched for the roads, at a town speed. */
export function estimateStraightLine(from: LatLng, to: LatLng, fallbackReason?: FallbackReason): Eta {
  const distanceMetres = Math.round(haversineMetres(from, to) * DETOUR_FACTOR);
  const metresPerSecond = (FALLBACK_SPEED_KMH * 1000) / 3600;
  return { distanceMetres, durationSeconds: Math.round(distanceMetres / metresPerSecond), source: "estimate", ...(fallbackReason ? { fallbackReason } : {}) };
}


/**
 * Distance and driving time from `from` to `to` along real roads (OpenStreetMap data, through the public
 * OSRM routing server). That server is a free demo for light use, so callers must not ask often; the
 * delivery service refreshes it every few seconds per delivery, never per customer. If it cannot be
 * reached or answers badly, the straight-line estimate is returned instead, so there is always an answer.
 */
export async function estimateRoute(from: LatLng, to: LatLng, fetchImpl: typeof fetch = fetch, routing: RoutingConfig = resolveRouting()): Promise<Eta> {
  if (!routing.usable) return estimateStraightLine(from, to, "not_configured");
  try {
    const res = await fetchImpl(routeUrl(routing, from, to, false), {
      headers: { "User-Agent": "TrackBot/1.0 (delivery tracking)" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return estimateStraightLine(from, to, "unreachable");
    const body = (await res.json()) as { code?: string; routes?: { distance?: number; duration?: number }[] };
    const route = body.routes?.[0];
    if (body.code !== "Ok" || typeof route?.distance !== "number" || typeof route.duration !== "number") {
      return estimateStraightLine(from, to, "bad_response");
    }
    return { distanceMetres: Math.round(route.distance), durationSeconds: Math.round(route.duration), source: "route" };
  } catch {
    return estimateStraightLine(from, to, "unreachable");
  }
}

export interface RouteStep {
  instruction: string;
  /** Metres driven along this step, up to the next manoeuvre. */
  distanceMetres: number;
}

/** A road route with its line on the map and its turn-by-turn steps. */
export interface RoutePlan extends Eta {
  /** [longitude, latitude] points of the route, in driving order. */
  geometry: [number, number][];
  steps: RouteStep[];
}

interface OsrmStep {
  distance?: number;
  name?: string;
  maneuver?: { type?: string; modifier?: string };
}

/** One OSRM step in plain words: "Turn left onto Zaria Road". */
export function describeStep(step: OsrmStep): string {
  const type = step.maneuver?.type ?? "";
  const modifier = step.maneuver?.modifier ?? "";
  const road = step.name ? ` onto ${step.name}` : "";
  if (type === "arrive") return "You have arrived at the customer's spot";
  if (type === "depart") return step.name ? `Start on ${step.name}` : "Start driving";
  if (type === "roundabout" || type === "rotary" || type === "roundabout turn") return `At the roundabout, take the exit${road}`;
  const turn: Record<string, string> = {
    left: "Turn left",
    right: "Turn right",
    "slight left": "Bear left",
    "slight right": "Bear right",
    "sharp left": "Turn sharply left",
    "sharp right": "Turn sharply right",
    straight: "Continue straight",
    uturn: "Make a U-turn",
  };
  if (type === "new name" || type === "continue") return step.name ? `Continue on ${step.name}` : "Continue straight";
  return `${turn[modifier] ?? "Continue"}${road}`;
}

/** The straight-line fallback as a route, so callers always get a line to draw. */
function straightPlan(from: LatLng, to: LatLng, reason: FallbackReason): RoutePlan {
  const eta = estimateStraightLine(from, to, reason);
  return {
    ...eta,
    geometry: [
      [from.longitude, from.latitude],
      [to.longitude, to.latitude],
    ],
    // No steps: a straight line has no turns, and none must ever be read out as if it were a road.
    steps: [],
  };
}

/**
 * The road route from `from` to `to`, with the line to draw and the turns to follow. Same server and same
 * fallback as `estimateRoute`: if the routing server cannot be reached the straight line is returned.
 */
export async function planRoute(from: LatLng, to: LatLng, fetchImpl: typeof fetch = fetch, routing: RoutingConfig = resolveRouting()): Promise<RoutePlan> {
  if (!routing.usable) return straightPlan(from, to, "not_configured");
  try {
    const res = await fetchImpl(routeUrl(routing, from, to, true), {
      headers: { "User-Agent": "TrackBot/1.0 (delivery tracking)" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return straightPlan(from, to, "unreachable");
    const body = (await res.json()) as {
      code?: string;
      routes?: { distance?: number; duration?: number; geometry?: { coordinates?: [number, number][] }; legs?: { steps?: OsrmStep[] }[] }[];
    };
    const route = body.routes?.[0];
    const coords = route?.geometry?.coordinates;
    if (body.code !== "Ok" || typeof route?.distance !== "number" || typeof route.duration !== "number" || !coords || coords.length < 2) {
      return straightPlan(from, to, "bad_response");
    }
    const steps = (route.legs?.[0]?.steps ?? []).map((st) => ({ instruction: describeStep(st), distanceMetres: Math.round(st.distance ?? 0) }));
    return {
      distanceMetres: Math.round(route.distance),
      durationSeconds: Math.round(route.duration),
      source: "route",
      geometry: coords,
      // A road route without steps is still a road route; it simply has no turns to read out.
      steps,
    };
  } catch {
    return straightPlan(from, to, "unreachable");
  }
}

/** How far (metres) a point is from the nearest part of a line: used to notice a driver who left the planned route. */
export function distanceToLineMetres(point: LatLng, line: [number, number][]): number {
  if (line.length === 0) return Infinity;
  const kx = 111_320 * Math.cos(rad(point.latitude));
  const ky = 110_540;
  const px = point.longitude * kx;
  const py = point.latitude * ky;
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const ax = line[i][0] * kx;
    const ay = line[i][1] * ky;
    const bx = line[i + 1][0] * kx;
    const by = line[i + 1][1] * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return line.length === 1 ? Math.hypot(px - line[0][0] * kx, py - line[0][1] * ky) : best;
}

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

/** Where `to` lies from `from`, in words: "320 m to the north-east". */
export function describeApproach(from: LatLng, to: LatLng): { distanceMetres: number; direction: string } {
  const distanceMetres = Math.round(haversineMetres(from, to));
  const y = Math.sin(rad(to.longitude - from.longitude)) * Math.cos(rad(to.latitude));
  const x = Math.cos(rad(from.latitude)) * Math.sin(rad(to.latitude)) - Math.sin(rad(from.latitude)) * Math.cos(rad(to.latitude)) * Math.cos(rad(to.longitude - from.longitude));
  const bearing = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return { distanceMetres, direction: COMPASS[Math.round(bearing / 45) % 8] };
}

/** "4.3 km" or "350 m". */
export function formatDistance(metres: number): string {
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.max(10, Math.round(metres / 10) * 10)} m`;
}

/** Whole minutes, at least 1: "about 1 min", "about 12 min", "about 1 h 5 min". */
export function formatMinutes(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

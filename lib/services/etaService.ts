export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface Eta {
  distanceMetres: number;
  durationSeconds: number;
  /** "route" = worked out along real roads; "estimate" = straight-line distance at an assumed speed. */
  source: "route" | "estimate";
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
export function estimateStraightLine(from: LatLng, to: LatLng): Eta {
  const distanceMetres = Math.round(haversineMetres(from, to) * DETOUR_FACTOR);
  const metresPerSecond = (FALLBACK_SPEED_KMH * 1000) / 3600;
  return { distanceMetres, durationSeconds: Math.round(distanceMetres / metresPerSecond), source: "estimate" };
}

const OSRM = "https://router.project-osrm.org/route/v1/driving";

/**
 * Distance and driving time from `from` to `to` along real roads (OpenStreetMap data, through the public
 * OSRM routing server). That server is a free demo for light use, so callers must not ask often; the
 * delivery service refreshes it every few seconds per delivery, never per customer. If it cannot be
 * reached or answers badly, the straight-line estimate is returned instead, so there is always an answer.
 */
export async function estimateRoute(from: LatLng, to: LatLng, fetchImpl: typeof fetch = fetch): Promise<Eta> {
  try {
    const url = `${OSRM}/${from.longitude},${from.latitude};${to.longitude},${to.latitude}?overview=false`;
    const res = await fetchImpl(url, {
      headers: { "User-Agent": "TrackBot/1.0 (university project; delivery tracking)" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return estimateStraightLine(from, to);
    const body = (await res.json()) as { code?: string; routes?: { distance?: number; duration?: number }[] };
    const route = body.routes?.[0];
    if (body.code !== "Ok" || typeof route?.distance !== "number" || typeof route.duration !== "number") {
      return estimateStraightLine(from, to);
    }
    return { distanceMetres: Math.round(route.distance), durationSeconds: Math.round(route.duration), source: "route" };
  } catch {
    return estimateStraightLine(from, to);
  }
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

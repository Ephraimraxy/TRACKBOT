import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";

/**
 * Safe access to a MapLibre map.
 *
 * A map exists a moment before its style does. Until the style has loaded, `map.getSource()` and friends throw
 * ("Cannot read properties of null"), and a thrown error inside a React effect takes the whole page down.
 * Data that arrives in that moment (a route, a position) must therefore never touch the map directly: it is kept in a
 * ref and drawn when the style loads (`style.load`), and every direct call goes through these helpers.
 */
export function safeGetSource(map: MapLibreMap | null | undefined, id: string): GeoJSONSource | undefined {
  if (!map) return undefined;
  try {
    return (map.getSource(id) as GeoJSONSource | undefined) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Sets a GeoJSON source's data. Returns false (and does nothing) if the map or the source is not ready yet. */
export function safeSetData(map: MapLibreMap | null | undefined, id: string, data: GeoJSON.GeoJSON): boolean {
  const src = safeGetSource(map, id);
  if (!src) return false;
  try {
    src.setData(data);
    return true;
  } catch {
    return false;
  }
}

/** Runs a map call, returning `fallback` instead of throwing when the map is not ready or already removed. */
export function safely<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

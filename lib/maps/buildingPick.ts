import { distanceToLineMetres } from "@/lib/services/etaService";

type Ring = [number, number][];
export interface BuildingFeature {
  geometry: GeoJSON.Geometry;
  properties?: Record<string, unknown> | null;
}
export interface Picked<F extends BuildingFeature> {
  feature: F;
  /** "contains": the pin is inside this building. "nearest": the pin is outside every building; this one is the closest. */
  how: "contains" | "nearest";
  /** For "nearest": how far the pin is from the building's wall, in metres. 0 for "contains". */
  distanceMetres: number;
}

/** A pin farther than this from every building wall is not "on" any building. */
export const NEAREST_MAX_METRES = 12;

/** Is the point inside the ring? (Ray casting; ring coordinates are [longitude, latitude].) */
export function ringContains(ring: Ring, lng: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Polygon rings: the first is the outline, the rest are holes (a courtyard is not part of the building). */
export function polygonContains(rings: Ring[], lng: number, lat: number): boolean {
  if (rings.length === 0 || !ringContains(rings[0], lng, lat)) return false;
  return !rings.slice(1).some((hole) => ringContains(hole, lng, lat));
}

const polygonsOf = (f: BuildingFeature): Ring[][] =>
  f.geometry.type === "Polygon" ? [f.geometry.coordinates as Ring[]] : f.geometry.type === "MultiPolygon" ? (f.geometry.coordinates as Ring[][]) : [];

/** Rough footprint size (square degrees of the bounding box): used only to prefer the innermost of nested buildings. */
const boxArea = (rings: Ring[]) => {
  const xs = rings[0].map((p) => p[0]);
  const ys = rings[0].map((p) => p[1]);
  return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
};

/**
 * Which building is the customer's pin on? The one whose outline CONTAINS the pin (the smallest one if buildings are
 * nested). If the pin is just outside every building (a gate, a yard, a slightly misplaced pin) the nearest wall within
 * NEAREST_MAX_METRES wins. Beyond that nothing is picked: better no highlight than the wrong house.
 */
export function pickBuilding<F extends BuildingFeature>(features: F[], point: { latitude: number; longitude: number }, maxNearestMetres = NEAREST_MAX_METRES): Picked<F> | null {
  let inside: { feature: F; area: number } | null = null;
  let near: { feature: F; distance: number } | null = null;
  for (const feature of features) {
    for (const rings of polygonsOf(feature)) {
      if (rings.length === 0 || rings[0].length < 4) continue;
      if (polygonContains(rings, point.longitude, point.latitude)) {
        const area = boxArea(rings);
        if (!inside || area < inside.area) inside = { feature, area };
      } else {
        const d = distanceToLineMetres(point, rings[0]);
        if (d <= maxNearestMetres && (!near || d < near.distance)) near = { feature, distance: d };
      }
    }
  }
  if (inside) return { feature: inside.feature, how: "contains", distanceMetres: 0 };
  if (near) return { feature: near.feature, how: "nearest", distanceMetres: near.distance };
  return null;
}

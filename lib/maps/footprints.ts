/**
 * Building footprints for 3D houses where OpenStreetMap has none. Open datasets (Google Open Buildings, Microsoft building
 * footprints) cover whole Nigerian towns; this cuts one town out, drops shapes that are clearly wrong, and gives each
 * building a height so the map can stand it up. Pure functions; the script scripts/build-footprints.ts reads and writes files.
 */
export type Ring = [number, number][];
export interface Footprint {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] };
}

/** [minLng, minLat, maxLng, maxLat] */
export type BBox = [number, number, number, number];

const R = 6_371_000;

/** Area of a ring in square metres (small areas: a local flat approximation is accurate to well under 1%). */
export function ringAreaM2(ring: Ring): number {
  if (ring.length < 4) return 0;
  const lat0 = (ring.reduce((s, p) => s + p[1], 0) / ring.length) * (Math.PI / 180);
  const kx = (Math.PI / 180) * R * Math.cos(lat0);
  const ky = (Math.PI / 180) * R;
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * kx * (ring[i][1] * ky) - ring[i][0] * kx * (ring[j][1] * ky);
  }
  return Math.abs(a) / 2;
}

const polygonsOf = (f: Footprint): Ring[][] => (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates);

export function footprintAreaM2(f: Footprint): number {
  return polygonsOf(f).reduce((sum, rings) => sum + (rings[0] ? ringAreaM2(rings[0]) - rings.slice(1).reduce((h, r) => h + ringAreaM2(r), 0) : 0), 0);
}

export function centroidOf(f: Footprint): [number, number] | null {
  const ring = polygonsOf(f)[0]?.[0];
  if (!ring || ring.length < 3) return null;
  return [ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length];
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

export interface FilterOptions {
  bbox: BBox;
  minAreaM2?: number;
  maxAreaM2?: number;
  defaultHeight?: number;
  maxFeatures?: number;
}
export interface FilterResult {
  features: Footprint[];
  read: number;
  kept: number;
  outsideArea: number;
  tooSmall: number;
  tooLarge: number;
  invalid: number;
  cappedAt: number | null;
}

/** Keep the footprints inside `bbox` that are a plausible building size; give each a `height` (metres) and trim coordinates. */
export function filterFootprints(input: Footprint[], opts: FilterOptions): FilterResult {
  const { bbox, minAreaM2 = 15, maxAreaM2 = 5000, defaultHeight = 5, maxFeatures = 80_000 } = opts;
  const out: Footprint[] = [];
  const r: FilterResult = { features: out, read: input.length, kept: 0, outsideArea: 0, tooSmall: 0, tooLarge: 0, invalid: 0, cappedAt: null };
  for (const f of input) {
    if (!f?.geometry || (f.geometry.type !== "Polygon" && f.geometry.type !== "MultiPolygon")) { r.invalid++; continue; }
    const c = centroidOf(f);
    if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1])) { r.invalid++; continue; }
    if (c[0] < bbox[0] || c[0] > bbox[2] || c[1] < bbox[1] || c[1] > bbox[3]) { r.outsideArea++; continue; }
    const area = footprintAreaM2(f);
    if (area < minAreaM2) { r.tooSmall++; continue; }
    if (area > maxAreaM2) { r.tooLarge++; continue; }
    if (out.length >= maxFeatures) { r.cappedAt = maxFeatures; break; }
    const given = Number((f.properties ?? {}).height);
    const trim = (ring: Ring) => ring.map((p) => [round(p[0]), round(p[1])] as [number, number]);
    out.push({
      type: "Feature",
      properties: { height: Number.isFinite(given) && given > 0 && given < 200 ? given : defaultHeight },
      geometry: f.geometry.type === "Polygon" ? { type: "Polygon", coordinates: f.geometry.coordinates.map(trim) } : { type: "MultiPolygon", coordinates: f.geometry.coordinates.map((p) => p.map(trim)) },
    });
  }
  r.kept = out.length;
  return r;
}

/** Read a GeoJSON FeatureCollection, or one GeoJSON feature per line (the form Microsoft's footprints come in). */
export function parseFootprints(text: string): Footprint[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("{")) {
    try {
      const whole = JSON.parse(trimmed);
      if (whole.type === "FeatureCollection" && Array.isArray(whole.features)) return whole.features as Footprint[];
      if (whole.type === "Feature") return [whole as Footprint];
    } catch {
      // not one JSON document: try one feature per line
    }
  }
  const out: Footprint[] = [];
  for (const line of trimmed.split("\n")) {
    const l = line.trim().replace(/^\x1e/, "");
    if (!l.startsWith("{")) continue;
    try {
      const j = JSON.parse(l);
      if (j.type === "Feature") out.push(j as Footprint);
    } catch {
      // a damaged line is skipped
    }
  }
  return out;
}

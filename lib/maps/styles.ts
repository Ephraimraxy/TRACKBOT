import type { StyleSpecification } from "maplibre-gl";

import { currentLabels, currentSatellite, imageryFallback, SATELLITE, type BaseLayer } from "@/lib/config/mapLayers";

/**
 * Map styles for the tracking and pin maps (MapLibre GL, which draws maps in 3D with WebGL).
 *
 *  - "satellite": satellite pictures with place names and extruded 3D buildings on top, tilted so houses stand up.
 *  - "street": a vector street map (OpenFreeMap) with 3D buildings, roads, junctions and landmarks.
 *
 * No account is needed for either. A Mapbox token (NEXT_PUBLIC_MAPBOX_TOKEN) swaps in sharper satellite pictures.
 * The 3D buildings come from OpenStreetMap, so a house shows as a 3D block where it has been mapped there.
 */
export type MapMode = "satellite" | "street";

const OPENFREEMAP = "https://tiles.openfreemap.org";
export const STREET_STYLE_URL = `${OPENFREEMAP}/styles/liberty`;

/** Zoom at which buildings start to stand up. */
const BUILDINGS_FROM_ZOOM = 14;

/** The closest zoom worth showing for a satellite layer: one level past its real pictures (map zoom, so tile size is allowed for). */
export const zoomCapFor = (layer: BaseLayer): number => Math.min(22, layer.maxZoom + (layer.zoomOffset ?? 0));

export function satelliteStyle(): StyleSpecification {
  const SAT = currentSatellite();
  const LABELS = currentLabels();
  const tileSize = SAT.tileSize ?? 256;
  const maxzoom = SAT.maxNativeZoom + (SAT.zoomOffset ?? 0);
  const sources: StyleSpecification["sources"] = {
    imagery: { type: "raster", tiles: [SAT.url], tileSize, maxzoom, attribution: SAT.attribution },
    // Building shapes and heights, drawn in 3D over the picture.
    openmaptiles: { type: "vector", url: `${OPENFREEMAP}/planet`, attribution: "© OpenStreetMap contributors © OpenFreeMap" },
  };
  const layers: StyleSpecification["layers"] = [{ id: "imagery", type: "raster", source: "imagery" }];
  if (LABELS) {
    sources.labels = { type: "raster", tiles: [LABELS.url], tileSize: 256, maxzoom: LABELS.maxNativeZoom };
    layers.push({ id: "labels", type: "raster", source: "labels" });
  }
  layers.push({
    id: "buildings-3d",
    type: "fill-extrusion",
    source: "openmaptiles",
    "source-layer": "building",
    minzoom: BUILDINGS_FROM_ZOOM,
    paint: {
      "fill-extrusion-color": "#f5f0e6",
      "fill-extrusion-height": ["coalesce", ["get", "render_height"], 6],
      "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
      "fill-extrusion-opacity": 0.82,
    },
  });
  return { version: 8, sources, layers };
}

/** Plain raster satellite, used if the vector tile server cannot be reached, so the map is never blank. */
export function satelliteOnlyStyle(): StyleSpecification {
  const s = satelliteStyle();
  delete s.sources.openmaptiles;
  s.layers = s.layers.filter((l) => l.id !== "buildings-3d");
  return s;
}

export const STREET_FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 19, attribution: "© OpenStreetMap contributors" },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

export function styleFor(mode: MapMode): string | StyleSpecification {
  return mode === "satellite" ? satelliteStyle() : STREET_STYLE_URL;
}

/** What to show if the chosen style fails to load. */
export function fallbackFor(mode: MapMode): StyleSpecification {
  return mode === "satellite" ? satelliteOnlyStyle() : STREET_FALLBACK_STYLE;
}

/** A circle of `radiusM` metres around a point, as a GeoJSON polygon (for the accuracy halo). */
export function circlePolygon(lng: number, lat: number, radiusM: number, steps = 48): GeoJSON.Feature<GeoJSON.Polygon> {
  const coords: [number, number][] = [];
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    coords.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [coords] } };
}

export const DRIVER_PULSE_CSS = `
  .tb-driver { position: relative; width: 24px; height: 24px; }
  .tb-driver .dot { position: absolute; inset: 3px; border-radius: 9999px; background: #2563eb; border: 3px solid #fff; box-shadow: 0 1px 5px rgba(0,0,0,.5); }
  .tb-driver .ring { position: absolute; inset: -16px; border-radius: 9999px; background: rgba(37,99,235,.42); animation: tb-pulse 1.4s ease-out infinite; }
  .tb-driver .ring2 { position: absolute; inset: -16px; border-radius: 9999px; background: rgba(37,99,235,.32); animation: tb-pulse 1.4s ease-out .7s infinite; }
  .tb-home svg { filter: drop-shadow(0 2px 3px rgba(0,0,0,.45)); display: block; }
  @keyframes tb-pulse { 0% { transform: scale(.35); opacity: .95; } 100% { transform: scale(1.5); opacity: 0; } }
  .maplibregl-map { font-family: inherit; }
`;

export function ensureMapStyles() {
  if (typeof document === "undefined" || document.getElementById("tb-map-styles")) return;
  const style = document.createElement("style");
  style.id = "tb-map-styles";
  style.textContent = DRIVER_PULSE_CSS;
  document.head.appendChild(style);
}

export const HOME_PIN_SVG =
  '<svg width="34" height="44" viewBox="0 0 30 38" xmlns="http://www.w3.org/2000/svg"><path d="M15 1C7.8 1 2 6.6 2 13.6 2 23 15 37 15 37s13-14 13-23.4C28 6.6 22.2 1 15 1z" fill="#dc2626" stroke="#fff" stroke-width="2"/><path d="M8.5 14.2 15 8.5l6.5 5.7V21a1 1 0 0 1-1 1h-3.3v-5h-4.4v5H9.5a1 1 0 0 1-1-1z" fill="#fff"/></svg>';

/** The closest the map zooms: one level past the real pictures of the chosen provider, so nobody zooms into a blur. */
export const MAX_ZOOM = zoomCapFor(SATELLITE);
/** Same, for a map being created now (lower after the visit has switched to Esri). */
export const maxZoomNow = (): number => zoomCapFor(currentSatellite());
/** The closest the automatic framing goes; the person can always zoom closer by hand. */
export const AUTO_FIT_MAX_ZOOM = 18;
/** Camera tilt used by the 3D view, in degrees. */
export const TILT = 55;

/** Is this map error the satellite provider refusing us (bad or over-limit key)? Then the free Esri pictures should take over. */
export function imageryFailed(e: unknown): boolean {
  const ev = e as { sourceId?: string; error?: { status?: number } } | null | undefined;
  return ev?.sourceId === "imagery" && [401, 402, 403, 429].includes(ev?.error?.status ?? 0);
}

/**
 * Switch a map to the free Esri pictures after the chosen provider failed. Once per page visit; keeps the viewer where
 * they were and lowers the zoom limit to Esri's. Returns true if it switched.
 */
export function fallBackToEsri(map: { setStyle(style: StyleSpecification): unknown; setMaxZoom(z: number): unknown; getZoom(): number; setZoom(z: number): unknown }): boolean {
  const switched = imageryFallback.activate();
  const cap = zoomCapFor(currentSatellite());
  if (switched || imageryFallback.active()) {
    map.setStyle(satelliteStyle());
    map.setMaxZoom(cap);
    if (map.getZoom() > cap) map.setZoom(cap);
  }
  return switched;
}

/**
 * Optional 3D houses from an open building-footprint file (see scripts/build-footprints.ts), for towns where OpenStreetMap
 * has few buildings. Off unless NEXT_PUBLIC_BUILDINGS_URL is set (for example /data/keffi-buildings.geojson). Safe to call
 * after every style load; does nothing if the layer is already there or the map is not ready.
 */
export const FOOTPRINTS_URL = process.env.NEXT_PUBLIC_BUILDINGS_URL?.trim() || "";
export const FOOTPRINT_LAYER = "footprints-3d";

export function addFootprintsLayer(map: { getSource(id: string): unknown; addSource(id: string, s: unknown): unknown; addLayer(l: unknown): unknown }, url: string = FOOTPRINTS_URL): boolean {
  if (!url) return false;
  try {
    if (map.getSource("footprints")) return false;
    map.addSource("footprints", { type: "geojson", data: url });
    map.addLayer({
      id: FOOTPRINT_LAYER,
      type: "fill-extrusion",
      source: "footprints",
      minzoom: 15,
      paint: {
        "fill-extrusion-color": "#e8e1d4",
        "fill-extrusion-height": ["coalesce", ["get", "height"], 5],
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": 0.85,
      },
    });
    return true;
  } catch {
    return false;
  }
}

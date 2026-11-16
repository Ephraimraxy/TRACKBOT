import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";

import { pickBuilding } from "@/lib/maps/buildingPick";

export interface LngLatPoint {
  latitude: number;
  longitude: number;
}

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
/** The 3D building layers of the two styles (satellite and street). */
const BUILDING_LAYERS = ["buildings-3d", "building-3d"];

/**
 * Destination intelligence: colour the building that stands on the customer's pin red, in 3D, so the delivery person
 * (and the customer, when placing the pin) can see which building is meant and what its surroundings are.
 * It works where the map data has that building; where it has not, nothing is drawn and the pin alone marks the spot.
 */
export function highlightDestinationBuilding(map: MapLibreMap, destination: LngLatPoint | null | (() => LngLatPoint | null)) {
  const ensure = () => {
    if (map.getSource("dest-building")) return;
    map.addSource("dest-building", { type: "geojson", data: EMPTY });
    map.addLayer({
      id: "dest-building-3d",
      type: "fill-extrusion",
      source: "dest-building",
      paint: { "fill-extrusion-color": "#dc2626", "fill-extrusion-height": ["coalesce", ["get", "height"], 8], "fill-extrusion-base": 0, "fill-extrusion-opacity": 0.92 },
    });
  };
  const update = () => {
    if (!map.isStyleLoaded()) return;
    ensure();
    const src = map.getSource("dest-building") as GeoJSONSource | undefined;
    if (!src) return;
    const dest = typeof destination === "function" ? destination() : destination;
    if (!dest) return src.setData(EMPTY);
    const layers = BUILDING_LAYERS.filter((id) => map.getLayer(id));
    if (layers.length === 0) return;
    const p = map.project([dest.longitude, dest.latitude]);
    // Every building drawn near the pin, then the one that really holds the pin (point in polygon), not just the
    // first one the picture happens to hit.
    const nearby = map.queryRenderedFeatures([[p.x - 40, p.y - 40], [p.x + 40, p.y + 40]], { layers });
    const picked = pickBuilding(nearby.filter((f) => f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"), dest);
    if (!picked) return src.setData(EMPTY);
    const found = picked.feature;
    const props = (found.properties ?? {}) as { render_height?: number; height?: number };
    src.setData({ type: "FeatureCollection", features: [{ type: "Feature", properties: { height: (props.render_height ?? props.height ?? 8) + 0.5 }, geometry: found.geometry }] });
  };
  // Buildings are drawn from tiles that arrive a moment after the style: try again when the map goes idle.
  map.on("idle", update);
  update();
  return () => {
    map.off("idle", update);
  };
}

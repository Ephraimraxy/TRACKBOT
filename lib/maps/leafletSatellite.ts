import type { LayerGroup, Map as LeafletMap } from "leaflet";

import { currentLabels, currentSatellite, imageryFallback, SATELLITE_PROVIDER, STREET } from "@/lib/config/mapLayers";

/**
 * The chosen provider is treated as refusing us (key over its limit or invalid) after this many failed tiles in a row, or
 * after this many if not a single tile has loaded yet (a key that never worked fails at once, a network blip does not).
 */
export const TILE_ERRORS_BEFORE_FALLBACK = 4;
export const TILE_ERRORS_IF_NONE_LOADED = 2;

/**
 * Put the base pictures (satellite or street) of the flat map into `group`. The zoom limit follows the provider's real
 * pictures. If the chosen satellite provider keeps failing, the group is refilled with the free Esri pictures, so the
 * map never goes blank, and the same switch applies to every map for the rest of the visit.
 */
export function addBaseTiles(L: typeof import("leaflet"), group: LayerGroup, map: LeafletMap, mode: "satellite" | "street") {
  group.clearLayers();
  const sat = currentSatellite();
  map.setMaxZoom(sat.maxZoom);

  if (mode === "street") {
    L.tileLayer(STREET.url, { attribution: STREET.attribution, maxZoom: sat.maxZoom, maxNativeZoom: STREET.maxNativeZoom }).addTo(group);
    return;
  }

  const layer = L.tileLayer(sat.url, { attribution: sat.attribution, maxZoom: sat.maxZoom, maxNativeZoom: sat.maxNativeZoom, tileSize: sat.tileSize ?? 256, zoomOffset: sat.zoomOffset ?? 0 }).addTo(group);
  const labels = currentLabels();
  if (labels) L.tileLayer(labels.url, { maxZoom: sat.maxZoom, maxNativeZoom: labels.maxNativeZoom }).addTo(group);

  if (SATELLITE_PROVIDER !== "esri" && !imageryFallback.active()) {
    let failures = 0;
    let loaded = 0;
    layer.on("tileload", () => {
      failures = 0;
      loaded++;
    });
    layer.on("tileerror", () => {
      failures++;
      const limit = loaded === 0 ? TILE_ERRORS_IF_NONE_LOADED : TILE_ERRORS_BEFORE_FALLBACK;
      if (failures >= limit && imageryFallback.activate()) addBaseTiles(L, group, map, "satellite");
    });
  }
}

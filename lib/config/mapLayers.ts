/**
 * Map pictures used by the tracking map and by the address pin picker.
 *
 * Street view is OpenStreetMap. In many Nigerian towns it still shows few houses, so the default is a satellite
 * picture, which shows roofs, compounds and roads like Google Maps does.
 *
 *  - With NEXT_PUBLIC_MAPBOX_TOKEN set (free account at mapbox.com), the satellite picture comes from Mapbox,
 *    which has sharper imagery and lets you zoom in much closer.
 *  - With NEXT_PUBLIC_MAPTILER_KEY set (free plan at maptiler.com), MapTiler satellite pictures are used.
 *  - Without either, Esri World Imagery is used. It needs no account.
 *
 * `maxNativeZoom` is the closest level the provider really has pictures for. Zooming in further enlarges the last
 * picture instead of showing empty grey tiles.
 */
export interface BaseLayer {
  url: string;
  attribution: string;
  maxZoom: number;
  maxNativeZoom: number;
  tileSize?: number;
  zoomOffset?: number;
}

export type SatelliteName = "mapbox" | "maptiler" | "esri";

/** Esri World Imagery: free, no account. Real pictures down to zoom 18; closer than that is just enlarged. */
export const ESRI_SATELLITE: BaseLayer = {
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
  // One level past the real pictures: the closest view that is still worth looking at. Further just blurs.
  maxZoom: 19,
  maxNativeZoom: 18,
};

/** Place and road names drawn over the Esri picture. Mapbox's satellite style already includes them. */
export const ESRI_LABELS: BaseLayer = {
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
  attribution: "",
  maxZoom: 19,
  maxNativeZoom: 18,
};

/**
 * Which satellite source to use. `provider` (NEXT_PUBLIC_MAP_PROVIDER = mapbox | maptiler | esri) chooses explicitly, and is
 * honoured when that provider's key is set. Without it: Mapbox if its token is set, else MapTiler if its key is set, else Esri.
 * Every layer's `maxZoom` is one level past the provider's real pictures, so people cannot zoom into a blur.
 */
export function pickSatellite(input: { mapbox?: string; maptiler?: string; provider?: string }): { name: SatelliteName; layer: BaseLayer; labels: BaseLayer | null } {
  const mapbox = input.mapbox?.trim();
  const maptiler = input.maptiler?.trim();
  const wanted = input.provider?.trim().toLowerCase();
  const name: SatelliteName =
    wanted === "esri" ? "esri"
    : wanted === "mapbox" && mapbox ? "mapbox"
    : wanted === "maptiler" && maptiler ? "maptiler"
    : mapbox ? "mapbox"
    : maptiler ? "maptiler"
    : "esri";
  if (name === "mapbox") {
    return {
      name,
      layer: {
        url: `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/{z}/{x}/{y}@2x?access_token=${mapbox}`,
        attribution: "© Mapbox © OpenStreetMap © Maxar",
        tileSize: 512,
        zoomOffset: -1,
        maxZoom: 22,
        maxNativeZoom: 21,
      },
      labels: null,
    };
  }
  if (name === "maptiler") {
    return {
      name,
      layer: {
        url: `https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${maptiler}`,
        attribution: "© MapTiler © OpenStreetMap contributors",
        maxZoom: 21,
        maxNativeZoom: 20,
      },
      labels: ESRI_LABELS,
    };
  }
  return { name, layer: ESRI_SATELLITE, labels: ESRI_LABELS };
}

// NEXT_PUBLIC_* values are put into the page at build time only when written out like this.
const chosen = pickSatellite({
  mapbox: process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
  maptiler: process.env.NEXT_PUBLIC_MAPTILER_KEY,
  provider: process.env.NEXT_PUBLIC_MAP_PROVIDER,
});

export const STREET: BaseLayer = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: "© OpenStreetMap contributors",
  maxZoom: 21,
  maxNativeZoom: 19,
};

export const SATELLITE: BaseLayer = chosen.layer;
export const SATELLITE_PROVIDER: SatelliteName = chosen.name;
export const LABELS: BaseLayer | null = chosen.labels;

// If the chosen provider stops answering (a key over its limit or refused), the page switches to free Esri imagery for the
// rest of the visit instead of showing a blank map. Shared by the 3D and the flat maps.
let fallbackActive = false;
export const imageryFallback = {
  active: () => fallbackActive,
  /** Returns true if this call switched (false when already on Esri or already switched). */
  activate(): boolean {
    if (fallbackActive || SATELLITE_PROVIDER === "esri") return false;
    fallbackActive = true;
    return true;
  },
  /** Tests. */
  reset() {
    fallbackActive = false;
  },
};
/** The satellite layer in use right now (the chosen provider, or Esri after a failure). */
export const currentSatellite = (): BaseLayer => (fallbackActive ? ESRI_SATELLITE : SATELLITE);
export const currentLabels = (): BaseLayer | null => (fallbackActive ? ESRI_LABELS : LABELS);

/**
 * Map pictures used by the tracking map and by the address pin picker.
 *
 * Street view is OpenStreetMap. In many Nigerian towns it still shows few houses, so the default is a satellite
 * picture, which shows roofs, compounds and roads like Google Maps does.
 *
 *  - With NEXT_PUBLIC_MAPBOX_TOKEN set (free account at mapbox.com), the satellite picture comes from Mapbox,
 *    which has sharper imagery and lets you zoom in much closer.
 *  - Without it, Esri World Imagery is used. It needs no account.
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

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim();

export const STREET: BaseLayer = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: "© OpenStreetMap contributors",
  maxZoom: 21,
  maxNativeZoom: 19,
};

export const SATELLITE: BaseLayer = MAPBOX_TOKEN
  ? {
      url: `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/{z}/{x}/{y}@2x?access_token=${MAPBOX_TOKEN}`,
      attribution: "© Mapbox © OpenStreetMap © Maxar",
      tileSize: 512,
      zoomOffset: -1,
      maxZoom: 22,
      maxNativeZoom: 21,
    }
  : {
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
      maxZoom: 21,
      maxNativeZoom: 18,
    };

/** Place and road names drawn over the Esri picture. Mapbox's satellite style already includes them. */
export const LABELS: BaseLayer | null = MAPBOX_TOKEN
  ? null
  : {
      url: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      attribution: "",
      maxZoom: 21,
      maxNativeZoom: 18,
    };

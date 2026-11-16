/**
 * Street-level photographs from Mapillary (photos taken by volunteers and companies from cars, bikes and phones).
 * They let a delivery person recognise the road entrance, the junction and the landmarks before arriving.
 * Needs a free client token (mapillary.com/dashboard/developers) in NEXT_PUBLIC_MAPILLARY_TOKEN. Without it
 * nothing is shown. Photos are licensed CC BY-SA and must be credited to Mapillary.
 */
export const MAPILLARY_TOKEN = process.env.NEXT_PUBLIC_MAPILLARY_TOKEN?.trim() || "";
export const mapillaryEnabled = MAPILLARY_TOKEN !== "";

/** Vector tiles of every photo sequence (green lines) and photo (dots), drawn on the map when asked. */
export const MAPILLARY_TILES = `https://tiles.mapillary.com/maps/vtp/mly1_public/2/{z}/{x}/{y}?access_token=${MAPILLARY_TOKEN}`;

export interface StreetPhoto {
  id: string;
  url: string;
  capturedAt: string | null;
  distanceMetres: number;
  /** Opens the photo in Mapillary's own viewer, where it can be turned around. */
  viewerUrl: string;
}

const rad = (d: number) => (d * Math.PI) / 180;
const metresBetween = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** The photos taken closest to a point, nearest first. Returns [] without a token, or when anything goes wrong. */
export async function nearbyStreetPhotos(
  latitude: number,
  longitude: number,
  options: { limit?: number; radiusDegrees?: number; token?: string; fetchImpl?: typeof fetch } = {}
): Promise<StreetPhoto[]> {
  const token = options.token ?? MAPILLARY_TOKEN;
  if (!token) return [];
  const r = options.radiusDegrees ?? 0.0007; // about 75 m
  const bbox = [longitude - r, latitude - r, longitude + r, latitude + r].join(",");
  const url = `https://graph.mapillary.com/images?access_token=${encodeURIComponent(token)}&fields=id,thumb_1024_url,captured_at,computed_geometry&bbox=${bbox}&limit=60`;
  try {
    const res = await (options.fetchImpl ?? fetch)(url);
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: { id?: string; thumb_1024_url?: string; captured_at?: number; computed_geometry?: { coordinates?: [number, number] } }[] };
    const photos: StreetPhoto[] = [];
    for (const img of body.data ?? []) {
      const c = img.computed_geometry?.coordinates;
      if (!img.id || !img.thumb_1024_url || !c) continue;
      photos.push({
        id: img.id,
        url: img.thumb_1024_url,
        capturedAt: typeof img.captured_at === "number" ? new Date(img.captured_at).toISOString() : null,
        distanceMetres: Math.round(metresBetween(latitude, longitude, c[1], c[0])),
        viewerUrl: `https://www.mapillary.com/app/?pKey=${img.id}&focus=photo`,
      });
    }
    return photos.sort((a, b) => a.distanceMetres - b.distanceMetres).slice(0, options.limit ?? 4);
  } catch {
    return [];
  }
}

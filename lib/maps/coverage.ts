import { SATELLITE } from "@/lib/config/mapLayers";

/** Tile numbers (x, y) of the tile that holds a point at a given zoom. */
export function tileFor(latitude: number, longitude: number, zoom: number): { x: number; y: number } {
  const n = 2 ** zoom;
  const x = Math.floor(((longitude + 180) / 360) * n);
  const latRad = (latitude * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return { x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)) };
}

/**
 * How much fine detail a picture holds: the average brightness difference between neighbouring pixels, after the
 * picture is reduced to 64 by 64. Real aerial photographs (roofs, roads, trees) score high; a blank, blurred or
 * "map data not available" tile scores near zero. It is a guide, not a verdict: look at the picture too.
 */
export function detailScore(pixels: Uint8ClampedArray, size = 64): number {
  const luma = (i: number) => 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
  let sum = 0;
  let count = 0;
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const i = (y * size + x) * 4;
      sum += Math.abs(luma(i) - luma(i + 4)) + Math.abs(luma(i) - luma(i + size * 4));
      count += 2;
    }
  }
  return count === 0 ? 0 : sum / count;
}

export type TileVerdict = "sharp" | "soft" | "missing" | "unreachable";
export const SHARP_FROM = 6;
export const SOFT_FROM = 2.5;

export const verdictOf = (score: number): TileVerdict => (score >= SHARP_FROM ? "sharp" : score >= SOFT_FROM ? "soft" : "missing");

/** The highest zoom whose picture still has real detail; 0 if none does. */
export function maxUsableZoom(scores: { zoom: number; score: number | null }[]): number {
  return scores.filter((s) => s.score !== null && s.score >= SOFT_FROM).reduce((best, s) => Math.max(best, s.zoom), 0);
}

/** The satellite tile that covers a point, at the map zoom the person would see. */
export function satelliteTileUrl(latitude: number, longitude: number, mapZoom: number): string {
  const api = mapZoom + (SATELLITE.zoomOffset ?? 0);
  const { x, y } = tileFor(latitude, longitude, api);
  return SATELLITE.url.replace("{z}", String(api)).replace("{x}", String(x)).replace("{y}", String(y));
}

/** Loads a tile and measures it in the browser. Resolves to null if it cannot be loaded or read. */
export function measureTile(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, 64, 64);
        resolve(detailScore(ctx.getImageData(0, 0, 64, 64).data));
      } catch {
        resolve(null); // the picture came from a server that does not allow it to be read
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

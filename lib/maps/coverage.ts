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

export interface TileSample {
  zoom: number;
  /** null: the tile could not be fetched or read. */
  score: number | null;
  /** A fingerprint of the picture bytes, to spot a "no imagery here" placeholder repeated across tiles. */
  hash?: string;
}
export interface ZoomSummary {
  zoom: number;
  sampled: number;
  unreachable: number;
  sharp: number;
  soft: number;
  missing: number;
  /** True when most of the tiles are byte-identical: a placeholder, not real imagery. */
  placeholderSuspected: boolean;
  verdict: TileVerdict;
}

/** Per zoom level: how many sampled tiles were sharp, soft, blank or unreachable, and what that adds up to. */
export function summariseCoverage(samples: TileSample[]): ZoomSummary[] {
  const zooms = [...new Set(samples.map((s) => s.zoom))].sort((a, b) => a - b);
  return zooms.map((zoom) => {
    const at = samples.filter((s) => s.zoom === zoom);
    const real = at.filter((s) => s.score !== null);
    const sharp = real.filter((s) => (s.score as number) >= SHARP_FROM).length;
    const soft = real.filter((s) => (s.score as number) >= SOFT_FROM && (s.score as number) < SHARP_FROM).length;
    const missing = real.length - sharp - soft;
    const counts = new Map<string, number>();
    for (const s of real) if (s.hash) counts.set(s.hash, (counts.get(s.hash) ?? 0) + 1);
    const placeholderSuspected = real.length >= 4 && Math.max(0, ...counts.values()) / real.length > 0.6;
    const verdict: TileVerdict = real.length === 0 ? "unreachable" : placeholderSuspected ? "missing" : sharp / real.length >= 0.8 ? "sharp" : (sharp + soft) / real.length >= 0.8 ? "soft" : "missing";
    return { zoom, sampled: at.length, unreachable: at.length - real.length, sharp, soft, missing, placeholderSuspected, verdict };
  });
}

export interface ProviderZoomRow {
  zoom: number;
  byProvider: Record<string, ZoomSummary>;
  /** The provider with the sharpest imagery at this zoom, or null when none has any usable imagery. */
  best: string | null;
}

/** Side by side: for each zoom, how each provider did, and which looks best. A provider that was unreachable never wins. */
export function compareProviders(samples: Record<string, TileSample[]>): ProviderZoomRow[] {
  const summaries = Object.fromEntries(Object.entries(samples).map(([name, list]) => [name, summariseCoverage(list)]));
  const zooms = [...new Set(Object.values(summaries).flatMap((rows) => rows.map((r) => r.zoom)))].sort((a, b) => a - b);
  return zooms.map((zoom) => {
    const byProvider: Record<string, ZoomSummary> = {};
    for (const [name, rows] of Object.entries(summaries)) {
      const row = rows.find((r) => r.zoom === zoom);
      if (row) byProvider[name] = row;
    }
    const share = (r: ZoomSummary) => {
      const real = r.sampled - r.unreachable;
      return real === 0 || r.placeholderSuspected ? -1 : (r.sharp + 0.5 * r.soft) / real;
    };
    const ranked = Object.entries(byProvider).filter(([, r]) => share(r) > 0.1).sort((a, b) => share(b[1]) - share(a[1]));
    return { zoom, byProvider, best: ranked[0]?.[0] ?? null };
  });
}

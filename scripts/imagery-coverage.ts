/**
 * Does the satellite imagery really cover Keffi, and down to which zoom? Samples a grid of tiles over the town at each
 * zoom level, measures how much detail each holds, and prints a table (and a Markdown report with --report <file>).
 *
 *   npx tsx scripts/imagery-coverage.ts                          # the provider the app is configured to use
 *   npx tsx scripts/imagery-coverage.ts --provider esri|mapbox|maptiler|osm
 *   npx tsx scripts/imagery-coverage.ts --center 8.8465,7.8737 --span 0.04 --grid 7 --report docs/imagery-keffi.md
 *
 * Mapbox needs NEXT_PUBLIC_MAPBOX_TOKEN, MapTiler needs NEXT_PUBLIC_MAPTILER_KEY. This measures the PICTURES (are there
 * roofs, roads and compounds, or blur and blanks); look at a few tiles by eye too. It needs internet access.
 */
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import sharp from "sharp";

import { detailScore, summariseCoverage, tileFor, type TileSample } from "../lib/maps/coverage";

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const [lat0, lng0] = (arg("center", "8.8465,7.8737") as string).split(",").map(Number);
const span = Number(arg("span", "0.04"));
const grid = Number(arg("grid", "6"));
const zooms = (arg("zooms", "15,16,17,18,19,20") as string).split(",").map(Number);
const provider = arg("provider", "configured") as string;

const MAPBOX = process.env.NEXT_PUBLIC_MAPBOX_TOKEN?.trim();
const MAPTILER = process.env.NEXT_PUBLIC_MAPTILER_KEY?.trim();
const templates: Record<string, string | undefined> = {
  esri: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  mapbox: MAPBOX ? `https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=${MAPBOX}` : undefined,
  maptiler: MAPTILER ? `https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key=${MAPTILER}` : undefined,
  osm: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
};
let template = provider === "configured" ? (MAPBOX ? templates.mapbox : MAPTILER ? templates.maptiler : templates.esri) : templates[provider];
if (!template) {
  console.error(`No URL for provider "${provider}" (is its key set?)`);
  process.exit(2);
}

async function measure(url: string): Promise<{ score: number; hash: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { "user-agent": "trackbot-coverage-check" } });
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    const { data } = await sharp(bytes).resize(64, 64, { fit: "fill" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { score: detailScore(new Uint8ClampedArray(data), 64), hash: createHash("sha1").update(bytes).digest("hex") };
  } catch {
    return null;
  }
}

async function main() {
  const samples: TileSample[] = [];
  for (const zoom of zooms) {
    const seen = new Set<string>();
    for (let i = 0; i < grid; i++) {
      for (let j = 0; j < grid; j++) {
        const lat = lat0 - span / 2 + (span * i) / Math.max(1, grid - 1);
        const lng = lng0 - span / 2 + (span * j) / Math.max(1, grid - 1);
        const { x, y } = tileFor(lat, lng, zoom);
        if (seen.has(`${x}/${y}`)) continue; // low zooms: the grid falls on the same tile
        seen.add(`${x}/${y}`);
        const m = await measure((template as string).replace("{z}", String(zoom)).replace("{x}", String(x)).replace("{y}", String(y)));
        samples.push({ zoom, score: m?.score ?? null, hash: m?.hash });
      }
    }
  }

  const rows = summariseCoverage(samples);
  const lines = [
    `# Imagery coverage: ${provider} around ${lat0}, ${lng0} (±${span / 2}°)`,
    "",
    `Run ${new Date().toISOString()}. ${grid}×${grid} sample points per zoom (duplicates merged).`,
    "",
    "| Zoom | Tiles | Sharp | Soft | Blank | Unreachable | Placeholder? | Verdict |",
    "|---|---|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.zoom} | ${r.sampled} | ${r.sharp} | ${r.soft} | ${r.missing} | ${r.unreachable} | ${r.placeholderSuspected ? "yes" : "no"} | ${r.verdict} |`),
    "",
    "Sharp: real detail (roofs, roads, compounds). Soft: blurry or enlarged. Blank: no useful imagery. Check a few tiles by eye as well.",
  ];
  console.log(lines.join("\n"));
  const report = arg("report");
  if (report) writeFileSync(report, lines.join("\n") + "\n");
  if (rows.every((r) => r.verdict === "unreachable")) process.exit(3);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

/**
 * Cut one town's building footprints out of a big open dataset, so the map can show 3D houses where OpenStreetMap has none.
 *
 *   1. Download footprints that cover your town (free, open data):
 *        - Google Open Buildings (https://sites.research.google/open-buildings/): export the area as GeoJSON.
 *        - Microsoft building footprints (https://github.com/microsoft/GlobalMLBuildingFootprints): Nigeria, GeoJSON lines.
 *      Keep the licence and attribution of the dataset you use (both ask for attribution).
 *   2. Cut Keffi out:
 *        npx tsx scripts/build-footprints.ts --in nigeria.geojsonl --bbox 7.82,8.80,7.93,8.92 --out public/data/keffi-buildings.geojson
 *   3. Set NEXT_PUBLIC_BUILDINGS_URL=/data/keffi-buildings.geojson in Railway and redeploy.
 *
 * Options: --min-area 15 (m², drops sheds and noise)  --max-area 5000  --height 5 (metres when the data has none)  --max 80000
 * The footprints are machine-made: some are off by a few metres or merge neighbours. Check them on the map.
 */
import { readFileSync, statSync, writeFileSync } from "node:fs";

import { filterFootprints, parseFootprints, type BBox } from "../lib/maps/footprints";

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const input = arg("in");
const output = arg("out", "public/data/buildings.geojson") as string;
const bboxText = arg("bbox");
if (!input || !bboxText) {
  console.error("Usage: npx tsx scripts/build-footprints.ts --in <file> --bbox minLng,minLat,maxLng,maxLat [--out file] [--min-area 15] [--max-area 5000] [--height 5] [--max 80000]");
  process.exit(2);
}
const bbox = bboxText.split(",").map(Number) as BBox;
if (bbox.length !== 4 || bbox.some((n) => !Number.isFinite(n)) || bbox[0] >= bbox[2] || bbox[1] >= bbox[3]) {
  console.error("--bbox must be minLng,minLat,maxLng,maxLat (for example 7.82,8.80,7.93,8.92)");
  process.exit(2);
}

const features = parseFootprints(readFileSync(input, "utf8"));
const result = filterFootprints(features, {
  bbox,
  minAreaM2: Number(arg("min-area", "15")),
  maxAreaM2: Number(arg("max-area", "5000")),
  defaultHeight: Number(arg("height", "5")),
  maxFeatures: Number(arg("max", "80000")),
});
writeFileSync(output, JSON.stringify({ type: "FeatureCollection", features: result.features }));
console.log(`read ${result.read}, kept ${result.kept} (outside area ${result.outsideArea}, too small ${result.tooSmall}, too large ${result.tooLarge}, invalid ${result.invalid}${result.cappedAt ? `, stopped at the limit of ${result.cappedAt}` : ""})`);
console.log(`wrote ${output} (${Math.round(statSync(output).size / 1024)} KB)`);
if (result.kept === 0) {
  console.error("Nothing was kept: check that the file covers the --bbox area.");
  process.exit(3);
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import Link from "next/link";
import { Crosshair, RefreshCw } from "lucide-react";

import { T } from "@/components/i18n/T";
import { SATELLITE } from "@/lib/config/mapLayers";
import { maxUsableZoom, measureTile, satelliteTileUrl, verdictOf, type TileVerdict } from "@/lib/maps/coverage";
import { mapillaryEnabled, nearbyStreetPhotos } from "@/lib/maps/mapillary";
import { ensureMapStyles, fallbackFor, styleFor, TILT } from "@/lib/maps/styles";

const ZOOMS = [16, 17, 18, 19, 20];

interface Site {
  name: string;
  hint: string;
  latitude: number;
  longitude: number;
}

// Starting points. Replace the second and third with real places: stand there and press "Use my location".
const START_SITES: Site[] = [
  { name: "Town centre", hint: "Keffi town centre", latitude: 8.8465, longitude: 7.8737 },
  { name: "Residential area", hint: "A residential street where customers live. Enter its coordinates or use your location there.", latitude: 8.853, longitude: 7.865 },
  { name: "Outskirts", hint: "An edge-of-town or less developed area. Enter its coordinates or use your location there.", latitude: 8.87, longitude: 7.89 },
];

interface Result {
  tiles: { zoom: number; score: number | null }[];
  photos: number | null;
  buildings: number | null;
}

const badge: Record<TileVerdict, string> = {
  sharp: "bg-green-100 text-green-800",
  soft: "bg-amber-100 text-amber-800",
  missing: "bg-red-100 text-red-800",
  unreachable: "bg-gray-100 text-gray-600",
};

function SiteCard({ initial }: { initial: Site }) {
  const [site, setSite] = useState(initial);
  const [result, setResult] = useState<Result>({ tiles: [], photos: null, buildings: null });
  const [running, setRunning] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);

  // A 3D satellite map of the site, and a count of the buildings the map data has there.
  useEffect(() => {
    let cancelled = false;
    ensureMapStyles();
    (async () => {
      const ml = await import("maplibre-gl");
      if (cancelled || !box.current) return;
      map.current?.remove();
      const m = new ml.Map({ container: box.current, style: styleFor("satellite"), center: [site.longitude, site.latitude], zoom: 17, pitch: TILT, maxZoom: 21, attributionControl: { compact: true } });
      m.addControl(new ml.NavigationControl({ visualizePitch: true }), "bottom-left");
      let fellBack = false;
      m.on("error", () => {
        if (!fellBack && !m.isStyleLoaded()) {
          fellBack = true;
          m.setStyle(fallbackFor("satellite"));
        }
      });
      m.on("idle", () => {
        if (!m.getSource("openmaptiles")) return;
        const seen = new Set<string>();
        for (const f of m.querySourceFeatures("openmaptiles", { sourceLayer: "building" })) seen.add(JSON.stringify(f.geometry).slice(0, 120));
        setResult((r) => ({ ...r, buildings: seen.size }));
      });
      map.current = m;
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, [site.latitude, site.longitude]);

  const run = useCallback(async () => {
    setRunning(true);
    const tiles = await Promise.all(ZOOMS.map(async (zoom) => ({ zoom, score: await measureTile(satelliteTileUrl(site.latitude, site.longitude, zoom)) })));
    const photos = mapillaryEnabled ? (await nearbyStreetPhotos(site.latitude, site.longitude, { limit: 60, radiusDegrees: 0.0014 })).length : null;
    setResult((r) => ({ ...r, tiles, photos }));
    setRunning(false);
  }, [site.latitude, site.longitude]);

  useEffect(() => {
    run();
  }, [run]);

  const useHere = () =>
    navigator.geolocation?.getCurrentPosition((p) => setSite((s) => ({ ...s, latitude: Number(p.coords.latitude.toFixed(5)), longitude: Number(p.coords.longitude.toFixed(5)) })), undefined, { enableHighAccuracy: true, timeout: 15000 });

  const best = maxUsableZoom(result.tiles);
  const field = "w-28 rounded border px-2 py-1 text-sm";

  return (
    <section className="rounded-lg border bg-white p-4">
      <h2 className="text-lg font-semibold">{site.name}</h2>
      <p className="mb-2 text-xs text-gray-500">{site.hint}</p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input className={field} type="number" step="0.00001" value={site.latitude} onChange={(e) => setSite({ ...site, latitude: Number(e.target.value) })} aria-label="Latitude" />
        <input className={field} type="number" step="0.00001" value={site.longitude} onChange={(e) => setSite({ ...site, longitude: Number(e.target.value) })} aria-label="Longitude" />
        <button type="button" onClick={useHere} className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-gray-50"><Crosshair className="h-3.5 w-3.5" /><T>Use my location</T></button>
        <button type="button" onClick={run} disabled={running} className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${running ? "animate-spin" : ""}`} /><T>Measure again</T></button>
      </div>
      <div ref={box} className="h-64 w-full overflow-hidden rounded border" />
      <table className="mt-3 w-full text-left text-sm">
        <thead className="text-xs text-gray-500">
          <tr><th className="py-1">Zoom</th><th>Detail score</th><th>Verdict</th></tr>
        </thead>
        <tbody>
          {ZOOMS.map((z) => {
            const score = result.tiles.find((t) => t.zoom === z)?.score;
            const verdict: TileVerdict = score === undefined ? "unreachable" : score === null ? "unreachable" : verdictOf(score);
            return (
              <tr key={z} className="border-t">
                <td className="py-1">{z}</td>
                <td>{score === undefined ? "…" : score === null ? "–" : score.toFixed(1)}</td>
                <td><span className={`rounded px-2 py-0.5 text-xs ${badge[verdict]}`}>{score === undefined ? "measuring" : score === null ? "not readable" : verdict}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
        <div className="rounded bg-gray-50 p-2"><dt className="text-xs text-gray-500"><T>Closest sharp zoom</T></dt><dd className="text-lg font-semibold">{best || "–"}</dd></div>
        <div className="rounded bg-gray-50 p-2"><dt className="text-xs text-gray-500"><T>Buildings in 3D data</T></dt><dd className="text-lg font-semibold">{result.buildings ?? "…"}</dd></div>
        <div className="rounded bg-gray-50 p-2"><dt className="text-xs text-gray-500"><T>Street photos nearby</T></dt><dd className="text-lg font-semibold">{result.photos ?? (mapillaryEnabled ? "…" : "no token")}</dd></div>
      </dl>
    </section>
  );
}

/**
 * Map coverage check. Before relying on a map provider, measure what it really shows at the places you deliver to:
 * how sharp the satellite picture is at each zoom, how many buildings the 3D data holds, and how many street photos exist.
 * The measurements run in your browser, against the providers your site is set up to use.
 */
export default function MapCheckPage() {
  return (
    <div className="p-4 md:p-6">
      <Link href="/admin/deliveries" className="text-sm text-blue-600 underline"><T>← Deliveries</T></Link>
      <h1 className="mt-2 text-2xl font-semibold"><T>Map coverage check</T></h1>
      <p className="mb-4 max-w-3xl text-sm text-gray-600">
        <T>Check how well the maps cover the places you deliver to before relying on them. Satellite provider in use:</T> <strong>{SATELLITE.attribution}</strong>.{" "}
        <T>A detail score above 6 means a sharp picture, 2.5 to 6 a soft one, and below 2.5 a blank or missing one. Always look at the map as well: the score is a guide.</T>
      </p>
      <div className="grid gap-4 lg:grid-cols-3">
        {START_SITES.map((s) => (
          <SiteCard key={s.name} initial={s} />
        ))}
      </div>
    </div>
  );
}

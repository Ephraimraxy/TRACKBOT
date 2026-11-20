"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Box, Camera, Crosshair, Focus, Layers, Maximize2, Minimize2 } from "lucide-react";

import { useI18n } from "@/components/i18n/LocaleProvider";
import { highlightDestinationBuilding } from "@/lib/maps/destination";
import { safeSetData, safely } from "@/lib/maps/safe";
import { smoothTrail } from "@/lib/maps/trail";
import { MAPILLARY_TILES, mapillaryEnabled } from "@/lib/maps/mapillary";
import {
  AUTO_FIT_MAX_ZOOM,
  circlePolygon,
  ensureMapStyles,
  fallbackFor,
  HOME_PIN_SVG,
  addFootprintsLayer,
  maxZoomNow,
  fallBackToEsri,
  imageryFailed,
  styleFor,
  TILT,
  type MapMode,
} from "@/lib/maps/styles";

export interface MapPoint {
  latitude: number;
  longitude: number;
}
export interface MapPosition extends MapPoint {
  accuracy?: number | null;
  updatedAt: string | Date;
}

interface Props {
  position: MapPosition;
  /** Points driven so far, oldest first; drawn as the route. */
  trail?: MapPoint[];
  /** Where the order is going (the customer's pin). The view keeps it and the delivery person in frame. */
  destination?: MapPoint | null;
  /** The road route still to drive (from the routing service), drawn as a dashed line ahead of the marker. */
  plannedRoute?: [number, number][] | null;
  /** True for a few seconds after the delivery person left the planned road and the route was worked out again. */
  rerouted?: boolean;
  /** "road": a real road route. "estimate": a straight line, drawn dotted and labelled as an estimate. */
  routeKind?: "road" | "estimate" | null;
  /** Called if this 3D map cannot start (no WebGL), so the page can show the 2D map instead. */
  onUnsupported?: () => void;
  /** False once the delivery person has stopped sharing (delivered): the badge says where they stopped. */
  live?: boolean;
  className?: string;
}

/** A position newer than this counts as live; older ones are shown as "last seen". */
const LIVE_WITHIN_S = 30;
/** How long the marker glides from one reported point to the next. */
const GLIDE_MS = 1800;

/** A road route is a dashed sky-blue line; a straight-line estimate is thinner, grey and dotted, so it never passes for a road. */
const plannedPaint = (kind: "road" | "estimate" | null | undefined) =>
  kind === "estimate"
    ? { "line-color": "#9ca3af", "line-width": 3, "line-opacity": 0.95, "line-dasharray": [0.4, 2] }
    : { "line-color": "#38bdf8", "line-width": 5, "line-opacity": 0.9, "line-dasharray": [1.2, 1.6] };

const lngLat = (p: MapPoint): [number, number] => [p.longitude, p.latitude];

const routeData = (trail: MapPoint[], end: [number, number]): GeoJSON.Feature<GeoJSON.LineString> => ({
  type: "Feature",
  properties: {},
  geometry: { type: "LineString", coordinates: [...smoothTrail(trail).map(lngLat), end] },
});

/**
 * Live map of a delivery, drawn in 3D with MapLibre GL (WebGL), the same kind of map engine that powers modern
 * map apps. Satellite pictures with 3D buildings and place names, or a street map with 3D buildings.
 *
 *  - Tilt, rotate and zoom: drag to pan, two fingers (or right mouse button) to rotate and tilt, pinch or scroll to zoom.
 *  - The delivery person's marker pulses and glides between reported GPS points; the route driven is drawn behind it.
 *  - The map follows the delivery person until you move it yourself; "Follow" brings it back and "Full view" frames
 *    the delivery person and the destination together.
 *  - A badge says LIVE while positions keep arriving, or how long ago the last one was.
 */
export default function LiveMap({ position, trail = [], destination = null, plannedRoute = null, rerouted = false, routeKind = null, onUnsupported, live: sharing = true, className = "h-[24rem]" }: Props) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const lib = useRef<typeof import("maplibre-gl") | null>(null);
  const driver = useRef<Marker | null>(null);
  const home = useRef<Marker | null>(null);
  const shown = useRef<[number, number]>([position.longitude, position.latitude]);
  const frame = useRef<number | null>(null);
  const followRef = useRef(true);
  const modeRef = useRef<MapMode>("satellite");
  const latest = useRef({ position, trail, destination, plannedRoute, routeKind });
  latest.current = { position, trail, destination, plannedRoute, routeKind };
  const onUnsupportedRef = useRef(onUnsupported);
  onUnsupportedRef.current = onUnsupported;
  const photosRef = useRef(false);
  const [photos, setPhotos] = useState(false);

  const [follow, setFollowState] = useState(true);
  const [mode, setMode] = useState<MapMode>("satellite");
  const [tilted, setTilted] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [pointer, setPointer] = useState<[number, number] | null>(null);

  const setFollow = useCallback((value: boolean) => {
    followRef.current = value;
    setFollowState(value);
  }, []);

  /** (Re)create the route line and the accuracy halo. Runs after every style load, because a new style clears them. */
  const addCustomLayers = useCallback((m: MapLibreMap) => {
    addFootprintsLayer(m); // optional 3D houses from open footprint data, under the route lines
    const { position: p, trail: tr } = latest.current;
    const here = shown.current;
    if (!m.getSource("planned")) {
      m.addSource("planned", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: latest.current.plannedRoute ?? [] } } });
      m.addLayer({ id: "planned-line", type: "line", source: "planned", layout: { "line-cap": "round", "line-join": "round" }, paint: plannedPaint(latest.current.routeKind) });
    }
    if (mapillaryEnabled && !m.getSource("mapillary")) {
      m.addSource("mapillary", { type: "vector", tiles: [MAPILLARY_TILES], minzoom: 6, maxzoom: 14 });
      const vis = photosRef.current ? "visible" : "none";
      m.addLayer({ id: "mly-lines", type: "line", source: "mapillary", "source-layer": "sequence", layout: { visibility: vis }, paint: { "line-color": "#05cb63", "line-width": 2.5, "line-opacity": 0.9 } });
      m.addLayer({ id: "mly-points", type: "circle", source: "mapillary", "source-layer": "image", minzoom: 16, layout: { visibility: vis }, paint: { "circle-color": "#05cb63", "circle-radius": 4, "circle-stroke-color": "#fff", "circle-stroke-width": 1 } });
    }
    if (!m.getSource("route")) {
      m.addSource("route", { type: "geojson", data: routeData(tr, here) });
      m.addLayer({ id: "route-casing", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": 9, "line-opacity": 0.85 } });
      m.addLayer({ id: "route-line", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#2563eb", "line-width": 5.5 } });
    }
    if (!m.getSource("accuracy")) {
      m.addSource("accuracy", { type: "geojson", data: circlePolygon(here[0], here[1], p.accuracy ?? 0) });
      m.addLayer({ id: "accuracy-fill", type: "fill", source: "accuracy", paint: { "fill-color": "#2563eb", "fill-opacity": 0.12 } });
      m.addLayer({ id: "accuracy-line", type: "line", source: "accuracy", paint: { "line-color": "#2563eb", "line-width": 1 } });
    }
  }, []);

  // Build the map once.
  useEffect(() => {
    let cancelled = false;
    ensureMapStyles();

    (async () => {
      const ml = await import("maplibre-gl");
      if (cancelled || !box.current || map.current) return;
      lib.current = ml;
      const { position: p, trail: tr, destination: dest } = latest.current;

      let m: MapLibreMap;
      try {
        m = new ml.Map({
          container: box.current,
          style: styleFor("satellite"),
          center: [p.longitude, p.latitude],
          zoom: 16.5,
          pitch: TILT,
          maxPitch: 80,
          maxZoom: maxZoomNow(),
          attributionControl: { compact: true },
        });
      } catch {
        // No WebGL context (or the driver refused): hand over to the 2D map.
        onUnsupportedRef.current?.();
        return;
      }
      map.current = m;
      m.addControl(new ml.NavigationControl({ visualizePitch: true }), "bottom-left");
      m.on("style.load", () => safely(() => addCustomLayers(m), undefined));
      // Colour the building on the customer's pin red, so the delivery person can see which one is meant.
      if (dest) safely(() => highlightDestinationBuilding(m, dest), undefined);
      // If the chosen style cannot be loaded (network), fall back to plain pictures so the map is never blank.
      let fellBack = false;
      m.on("error", (e) => {
        const err = (e as unknown as { error?: { status?: number; message?: string } }).error;
        if (/webgl/i.test(err?.message ?? "")) return onUnsupportedRef.current?.();
        // The satellite provider refused us (key over its limit): carry on with the free Esri pictures.
        if (imageryFailed(e)) return void safely(() => fallBackToEsri(m), undefined);
        if (!fellBack && !safely(() => m.isStyleLoaded(), true) && !err?.status) {
          fellBack = true;
          safely(() => m.setStyle(fallbackFor(modeRef.current)), undefined);
        }
      });

      const dot = document.createElement("div");
      dot.className = "tb-driver";
      dot.innerHTML = '<span class="ring"></span><span class="ring2"></span><span class="dot"></span>';
      driver.current = new ml.Marker({ element: dot, anchor: "center" }).setLngLat([p.longitude, p.latitude]).addTo(m);

      if (dest) {
        const pin = document.createElement("div");
        pin.className = "tb-home";
        pin.innerHTML = HOME_PIN_SVG;
        pin.title = "Delivery address";
        home.current = new ml.Marker({ element: pin, anchor: "bottom" }).setLngLat(lngLat(dest)).addTo(m);
        m.fitBounds([[Math.min(p.longitude, dest.longitude), Math.min(p.latitude, dest.latitude)], [Math.max(p.longitude, dest.longitude), Math.max(p.latitude, dest.latitude)]], { padding: 70, maxZoom: AUTO_FIT_MAX_ZOOM, duration: 0 });
      } else if (tr.length > 1) {
        const lngs = tr.map((x) => x.longitude);
        const lats = tr.map((x) => x.latitude);
        m.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 60, maxZoom: AUTO_FIT_MAX_ZOOM, duration: 0 });
      }

      // Moving the map yourself means "let me look around": stop following until asked.
      m.on("dragstart", () => setFollow(false));
      m.on("rotatestart", () => setFollow(false));
      let last = 0;
      m.on("mousemove", (e) => {
        const nowMs = performance.now();
        if (nowMs - last < 100) return;
        last = nowMs;
        setPointer([e.lngLat.lat, e.lngLat.lng]);
      });
      m.on("mouseout", () => setPointer(null));
    })();

    return () => {
      cancelled = true;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      safely(() => map.current?.remove(), undefined);
      map.current = null;
      driver.current = null;
      home.current = null;
    };
  }, [addCustomLayers, setFollow]);

  // A new position (or route): glide the marker there and keep the picture in step.
  useEffect(() => {
    const m = map.current;
    const mk = driver.current;
    if (!m || !mk) return;

    const from = shown.current;
    const to: [number, number] = [position.longitude, position.latitude];
    if (frame.current !== null) cancelAnimationFrame(frame.current);

    const startedAt = performance.now();
    const step = (time: number) => {
      const k = Math.min(1, (time - startedAt) / GLIDE_MS);
      const eased = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const here: [number, number] = [from[0] + (to[0] - from[0]) * eased, from[1] + (to[1] - from[1]) * eased];
      shown.current = here;
      mk.setLngLat(here);
      safeSetData(m, "route", routeData(trail, here));
      safeSetData(m, "accuracy", circlePolygon(here[0], here[1], position.accuracy ?? 0));

      const dest = latest.current.destination;
      if (followRef.current) {
        if (!dest) m.jumpTo({ center: here });
        // With a destination, "follow" keeps the delivery person AND the address in view. If the viewer has zoomed in
        // closer than that, their zoom is respected: the map only keeps the delivery person in view.
        else if (k === 1 && lib.current) {
          const bounds: [[number, number], [number, number]] = [[Math.min(here[0], dest.longitude), Math.min(here[1], dest.latitude)], [Math.max(here[0], dest.longitude), Math.max(here[1], dest.latitude)]];
          const cam = m.cameraForBounds(bounds, { padding: 70, maxZoom: AUTO_FIT_MAX_ZOOM });
          if (cam && m.getZoom() > (cam.zoom ?? 0) + 0.5) {
            if (!m.getBounds().contains(here)) m.easeTo({ center: here, duration: 600 });
          } else {
            m.fitBounds(bounds, { padding: 70, maxZoom: AUTO_FIT_MAX_ZOOM, duration: 800 });
          }
        }
      }
      if (k < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  }, [position.longitude, position.latitude, position.accuracy, position.updatedAt, trail]);

  // The planned road ahead.
  // The route can arrive before the map's style has loaded (the page opened mid-delivery). Then there is no "planned"
  // source to fill yet: nothing is lost, because addCustomLayers draws the latest route when the style loads.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (plannedRoute) safeSetData(m, "planned", { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: plannedRoute } });
    safely(() => {
      if (m.getLayer("planned-line")) {
        const paint = plannedPaint(routeKind);
        for (const [k, v] of Object.entries(paint)) m.setPaintProperty("planned-line", k, v);
      }
    }, undefined);
  }, [plannedRoute, routeKind]);

  // Street-photo coverage (Mapillary) on or off.
  const togglePhotos = () => {
    const next = !photosRef.current;
    photosRef.current = next;
    setPhotos(next);
    const m = map.current;
    if (!m) return;
    safely(() => {
      for (const id of ["mly-lines", "mly-points"]) if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", next ? "visible" : "none");
    }, undefined);
  };

  // Satellite <-> street.
  const changeMode = (next: MapMode) => {
    const m = map.current;
    if (!m || next === modeRef.current) return;
    modeRef.current = next;
    setMode(next);
    safely(() => m.setStyle(styleFor(next)), undefined);
  };

  // Tilt (3D) <-> flat.
  const toggleTilt = () => {
    const next = !tilted;
    setTilted(next);
    map.current?.easeTo({ pitch: next ? TILT : 0, bearing: next ? map.current.getBearing() : 0, duration: 700 });
  };

  // Full screen: the map fills the window; the size is recalculated once the layout has changed. Esc closes it.
  useEffect(() => {
    const timer = setTimeout(() => map.current?.resize(), 150);
    if (!expanded) return () => clearTimeout(timer);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setExpanded(false);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [expanded]);

  // The "seconds ago" badge.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const age = Math.max(0, Math.round((now - new Date(position.updatedAt).getTime()) / 1000));
  const isLive = sharing && age <= LIVE_WITHIN_S;

  const fullView = () => {
    const m = map.current;
    if (!m) return;
    const pts: [number, number][] = [shown.current, ...(destination ? [lngLat(destination)] : []), ...trail.map(lngLat)];
    const lngs = pts.map((x) => x[0]);
    const lats = pts.map((x) => x[1]);
    m.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]], { padding: 80, maxZoom: AUTO_FIT_MAX_ZOOM, duration: 900 });
  };

  const recenter = () => {
    setFollow(true);
    const m = map.current;
    if (!m) return;
    if (destination) fullView();
    else m.easeTo({ center: shown.current, zoom: Math.max(m.getZoom(), 16), duration: 700 });
  };

  const btn = "flex items-center gap-1.5 rounded bg-white px-2.5 py-1.5 text-xs font-medium shadow hover:bg-gray-100";

  return (
    <div
      className={expanded ? "fixed inset-0 z-[3000] bg-white p-2" : `relative ${className}`}
      data-expanded={expanded ? "true" : "false"}
      data-live={isLive}
      data-map-engine="webgl"
      data-route-kind={routeKind ?? "none"}
      data-mode={mode}
      data-tilted={tilted}
      data-trail-points={trail.length}
      data-destination={destination ? "true" : "false"}
      data-planned={plannedRoute ? plannedRoute.length : 0}
      data-rerouted={rerouted}
    >
      <div ref={box} className="h-full w-full overflow-hidden rounded border" role="img" aria-label={t("Tracking map")} />

      <div className="pointer-events-none absolute left-2 top-11 z-[5] max-w-[85%] space-y-0.5 rounded bg-white/90 px-2 py-1 font-mono text-[11px] leading-tight text-gray-800 shadow">
        <p data-testid="coord-driver">
          <span className="font-sans font-semibold text-blue-700">{t("Delivery person")}</span> {position.latitude.toFixed(5)}, {position.longitude.toFixed(5)}
        </p>
        {destination && (
          <p data-testid="coord-destination">
            <span className="font-sans font-semibold text-red-600">{t("Delivery spot")}</span> {destination.latitude.toFixed(5)}, {destination.longitude.toFixed(5)}
          </p>
        )}
        {pointer && (
          <p data-testid="coord-pointer">
            <span className="font-sans font-semibold text-gray-600">{t("Pointer")}</span> {pointer[0].toFixed(5)}, {pointer[1].toFixed(5)}
          </p>
        )}
      </div>

      <div className="pointer-events-none absolute left-2 top-2 z-[5]">
        {rerouted && (
          <span className="mb-1 block w-fit rounded-full bg-sky-600 px-3 py-1 text-xs font-semibold text-white shadow">{t("Rerouted: new road worked out")}</span>
        )}
        {isLive ? (
          <span className="flex items-center gap-1.5 rounded-full bg-green-600 px-3 py-1 text-xs font-semibold text-white shadow">
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
            {t("LIVE")}
          </span>
        ) : sharing ? (
          <span className="rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white shadow">{t("Last seen {n}s ago", { n: age })}</span>
        ) : (
          <span className="rounded-full bg-teal-600 px-3 py-1 text-xs font-semibold text-white shadow">{t("Where the delivery person stopped")}</span>
        )}
      </div>

      <div className="absolute right-2 top-2 z-[5] flex flex-col gap-2">
        <button type="button" onClick={() => changeMode(mode === "satellite" ? "street" : "satellite")} className={btn} aria-pressed={mode === "satellite"}>
          <Layers size={14} />
          {mode === "satellite" ? t("Street map") : t("Satellite")}
        </button>
        <button type="button" onClick={toggleTilt} className={`${btn} ${tilted ? "!bg-gray-900 !text-white" : ""}`} aria-pressed={tilted}>
          <Box size={14} />
          {tilted ? t("3D view") : t("Flat view")}
        </button>
        {mapillaryEnabled && (
          <button type="button" onClick={togglePhotos} className={`${btn} ${photos ? "!bg-emerald-600 !text-white" : ""}`} aria-pressed={photos}>
            <Camera size={14} />
            {t("Street photos")}
          </button>
        )}
        <button type="button" onClick={fullView} className={btn}>
          <Focus size={14} />
          {t("Full view")}
        </button>
        <button type="button" onClick={recenter} className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium shadow ${follow ? "bg-blue-600 text-white" : "bg-white hover:bg-gray-100"}`} aria-pressed={follow}>
          <Crosshair size={14} />
          {t("Follow")}
        </button>
      </div>

      <button type="button" onClick={() => setExpanded((e) => !e)} className={`${btn} absolute bottom-8 right-2 z-[5]`} aria-pressed={expanded}>
        {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        {expanded ? t("Close full screen") : t("Full screen")}
      </button>
    </div>
  );
}

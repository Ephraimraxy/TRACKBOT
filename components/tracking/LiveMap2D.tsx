"use client";

import { useEffect, useRef, useState } from "react";
import type { Circle, LayerGroup, Map as LeafletMap, Marker, Polyline } from "leaflet";
import "leaflet/dist/leaflet.css";
import { Crosshair, Focus, Layers } from "lucide-react";

import { useI18n } from "@/components/i18n/LocaleProvider";
import type { MapPoint, MapPosition } from "@/components/tracking/LiveMap";
import { LABELS, SATELLITE, STREET } from "@/lib/config/mapLayers";
import { ensureMapStyles, HOME_PIN_SVG } from "@/lib/maps/styles";

interface Props {
  position: MapPosition;
  trail?: MapPoint[];
  destination?: MapPoint | null;
  plannedRoute?: [number, number][] | null;
  routeKind?: "road" | "estimate" | null;
  rerouted?: boolean;
  live?: boolean;
  className?: string;
}

const LIVE_WITHIN_S = 30;
const ll = (p: MapPoint): [number, number] => [p.latitude, p.longitude];

/**
 * The flat 2D live map (Leaflet). It needs no WebGL, so it works on phones, browsers and remote desktops where the 3D
 * map cannot start. It shows the same things: the delivery person, the route driven, the road ahead (or a dotted
 * straight line when only an estimate exists), the customer's spot, the accuracy circle, satellite or street pictures,
 * "Follow" and "Full view", and the LIVE badge.
 */
export default function LiveMap2D({ position, trail = [], destination = null, plannedRoute = null, routeKind = null, rerouted = false, live: sharing = true, className = "h-[24rem]" }: Props) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const lib = useRef<typeof import("leaflet") | null>(null);
  const layers = useRef<{ base: LayerGroup; driver: Marker; home?: Marker; trail: Polyline; planned: Polyline; accuracy: Circle } | null>(null);
  const followRef = useRef(true);
  const [follow, setFollowState] = useState(true);
  const [mode, setMode] = useState<"satellite" | "street">("satellite");
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const latest = useRef({ position, destination });
  latest.current = { position, destination };

  const setFollow = (v: boolean) => {
    followRef.current = v;
    setFollowState(v);
  };

  // Build the map once.
  useEffect(() => {
    let cancelled = false;
    ensureMapStyles();
    (async () => {
      const L = (await import("leaflet")).default as typeof import("leaflet");
      if (cancelled || !box.current || map.current) return;
      lib.current = L as typeof import("leaflet");
      const { position: p, destination: dest } = latest.current;
      const m = L.map(box.current, { center: [p.latitude, p.longitude], zoom: 17, maxZoom: 21, zoomControl: true });
      map.current = m;
      const base = L.layerGroup().addTo(m);
      const driverIcon = L.divIcon({ className: "tb-driver", html: '<span class="ring"></span><span class="ring2"></span><span class="dot"></span>', iconSize: [24, 24], iconAnchor: [12, 12] });
      const driver = L.marker([p.latitude, p.longitude], { icon: driverIcon, keyboard: false }).addTo(m);
      const home = dest ? L.marker(ll(dest), { icon: L.divIcon({ className: "tb-home", html: HOME_PIN_SVG, iconSize: [34, 44], iconAnchor: [17, 44] }), keyboard: false }).addTo(m) : undefined;
      layers.current = {
        base,
        driver,
        home,
        trail: L.polyline([], { color: "#2563eb", weight: 5, opacity: 0.95 }).addTo(m),
        planned: L.polyline([], { color: "#38bdf8", weight: 5, opacity: 0.9, dashArray: "6 8" }).addTo(m),
        accuracy: L.circle([p.latitude, p.longitude], { radius: 0, color: "#2563eb", weight: 1, fillOpacity: 0.12 }).addTo(m),
      };
      m.on("dragstart", () => setFollow(false));
      if (dest) m.fitBounds(L.latLngBounds([[p.latitude, p.longitude], ll(dest)]), { padding: [70, 70], maxZoom: 18, animate: false });
      setReady(true);
    })();
    return () => {
      cancelled = true;
      try {
        map.current?.remove();
      } catch {
        /* already gone */
      }
      map.current = null;
      layers.current = null;
    };
  }, []);

  // Satellite or street pictures.
  useEffect(() => {
    const L = lib.current as unknown as typeof import("leaflet") | null;
    const l = layers.current;
    if (!ready || !L || !l) return;
    l.base.clearLayers();
    const cfg = mode === "satellite" ? SATELLITE : STREET;
    const opts = { attribution: cfg.attribution, maxZoom: cfg.maxZoom, maxNativeZoom: cfg.maxNativeZoom, tileSize: cfg.tileSize ?? 256, zoomOffset: cfg.zoomOffset ?? 0 };
    L.tileLayer(cfg.url, opts).addTo(l.base);
    if (mode === "satellite" && LABELS) L.tileLayer(LABELS.url, { maxZoom: LABELS.maxZoom, maxNativeZoom: LABELS.maxNativeZoom }).addTo(l.base);
  }, [mode, ready]);

  // New position, trail, route.
  useEffect(() => {
    const m = map.current;
    const l = layers.current;
    if (!ready || !m || !l) return;
    const here: [number, number] = [position.latitude, position.longitude];
    l.driver.setLatLng(here);
    l.accuracy.setLatLng(here);
    l.accuracy.setRadius(position.accuracy ?? 0);
    l.trail.setLatLngs([...trail.map(ll), here]);
    if (followRef.current) {
      const L = lib.current as unknown as typeof import("leaflet");
      if (destination) m.fitBounds(L.latLngBounds([here, ll(destination)]), { padding: [70, 70], maxZoom: 18, animate: true });
      else m.setView(here, m.getZoom(), { animate: true });
    }
  }, [ready, position.latitude, position.longitude, position.accuracy, position.updatedAt, trail, destination]);

  useEffect(() => {
    const l = layers.current;
    if (!ready || !l) return;
    l.planned.setLatLngs((plannedRoute ?? []).map(([lng, lat]) => [lat, lng] as [number, number]));
    l.planned.setStyle(routeKind === "estimate" ? { color: "#9ca3af", weight: 3, dashArray: "2 8" } : { color: "#38bdf8", weight: 5, dashArray: "6 8" });
  }, [ready, plannedRoute, routeKind]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const age = Math.max(0, Math.round((now - new Date(position.updatedAt).getTime()) / 1000));
  const isLive = sharing && age <= LIVE_WITHIN_S;

  const fullView = () => {
    const m = map.current;
    const L = lib.current as unknown as typeof import("leaflet") | null;
    if (!m || !L) return;
    const pts = [[position.latitude, position.longitude] as [number, number], ...(destination ? [ll(destination)] : []), ...trail.map(ll)];
    m.fitBounds(L.latLngBounds(pts), { padding: [80, 80], maxZoom: 18 });
  };
  const recenter = () => {
    setFollow(true);
    if (destination) fullView();
    else map.current?.setView([position.latitude, position.longitude], Math.max(map.current.getZoom(), 16));
  };

  const btn = "flex items-center gap-1.5 rounded bg-white px-2.5 py-1.5 text-xs font-medium shadow hover:bg-gray-100";
  return (
    <div className={`relative ${className}`} data-map-engine="2d" data-live={isLive} data-mode={mode} data-trail-points={trail.length} data-destination={destination ? "true" : "false"} data-planned={plannedRoute ? plannedRoute.length : 0} data-rerouted={rerouted} data-route-kind={routeKind ?? "none"}>
      <div ref={box} className="relative z-0 h-full w-full overflow-hidden rounded border" role="img" aria-label={t("Tracking map")} />
      <div className="pointer-events-none absolute left-2 top-2 z-[500] max-w-[85%] space-y-1">
        {rerouted && <span className="block w-fit rounded-full bg-sky-600 px-3 py-1 text-xs font-semibold text-white shadow">{t("Rerouted: new road worked out")}</span>}
        {isLive ? (
          <span className="flex w-fit items-center gap-1.5 rounded-full bg-green-600 px-3 py-1 text-xs font-semibold text-white shadow">
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
            {t("LIVE")}
          </span>
        ) : sharing ? (
          <span className="block w-fit rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white shadow">{t("Last seen {n}s ago", { n: age })}</span>
        ) : (
          <span className="block w-fit rounded-full bg-teal-600 px-3 py-1 text-xs font-semibold text-white shadow">{t("Where the delivery person stopped")}</span>
        )}
        <p className="w-fit rounded bg-white/90 px-2 py-1 font-mono text-[11px] leading-tight text-gray-800 shadow" data-testid="coord-driver">
          <span className="font-sans font-semibold text-blue-700">{t("Delivery person")}</span> {position.latitude.toFixed(5)}, {position.longitude.toFixed(5)}
        </p>
      </div>
      <div className="absolute right-2 top-2 z-[500] flex flex-col gap-2">
        <button type="button" onClick={() => setMode(mode === "satellite" ? "street" : "satellite")} className={btn} aria-pressed={mode === "satellite"}>
          <Layers size={14} />
          {mode === "satellite" ? t("Street map") : t("Satellite")}
        </button>
        <button type="button" onClick={fullView} className={btn}>
          <Focus size={14} />
          {t("Full view")}
        </button>
        <button type="button" onClick={recenter} className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium shadow ${follow ? "bg-blue-600 text-white" : "bg-white hover:bg-gray-100"}`} aria-pressed={follow}>
          <Crosshair size={14} />
          {t("Follow")}
        </button>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker, Circle, Polyline, TileLayer, LayerGroup } from "leaflet";
import "leaflet/dist/leaflet.css";
import { Crosshair, Layers, Maximize2, Minimize2 } from "lucide-react";

import { useI18n } from "@/components/i18n/LocaleProvider";
import { AUTO_FIT_MAX_ZOOM, LABELS, SATELLITE, STREET } from "@/lib/config/mapLayers";

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
  className?: string;
}

/** A position newer than this counts as live; older ones are shown as "last seen". */
const LIVE_WITHIN_S = 30;
/** How long the marker glides from one reported point to the next. */
const GLIDE_MS = 1800;

/** The pulsing blue dot. Plain CSS so no marker image files are needed. */
function ensureStyles() {
  if (document.getElementById("tb-map-styles")) return;
  const style = document.createElement("style");
  style.id = "tb-map-styles";
  style.textContent = `
    .tb-driver { position: relative; }
    .tb-driver .dot { position: absolute; inset: 3px; border-radius: 9999px; background: #2563eb; border: 3px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,.4); }
    .tb-driver .ring { position: absolute; inset: -14px; border-radius: 9999px; background: rgba(37,99,235,.4); animation: tb-pulse 1.4s ease-out infinite; }
    .tb-driver .ring2 { position: absolute; inset: -14px; border-radius: 9999px; background: rgba(37,99,235,.3); animation: tb-pulse 1.4s ease-out .7s infinite; }
    .tb-home svg { filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
    @keyframes tb-pulse { 0% { transform: scale(.35); opacity: .9; } 100% { transform: scale(1.5); opacity: 0; } }
  `;
  document.head.appendChild(style);
}

const toLine = (trail: MapPoint[], end: MapPoint): [number, number][] => [
  ...trail.map((p) => [p.latitude, p.longitude] as [number, number]),
  [end.latitude, end.longitude],
];

/**
 * Live map of a delivery. Leaflet and OpenStreetMap, loaded on the client only (it needs `window`).
 *
 *  - The marker glides between reported GPS points instead of jumping.
 *  - The route driven so far is drawn behind it.
 *  - The map follows the delivery person until you drag it; "Follow" brings it back.
 *  - A badge says LIVE while positions keep arriving, or how long ago the last one was.
 *  - Street and satellite views.
 */
const HOME_PIN =
  '<svg width="30" height="38" viewBox="0 0 30 38" xmlns="http://www.w3.org/2000/svg"><path d="M15 1C7.8 1 2 6.6 2 13.6 2 23 15 37 15 37s13-14 13-23.4C28 6.6 22.2 1 15 1z" fill="#dc2626" stroke="#fff" stroke-width="2"/><path d="M8.5 14.2 15 8.5l6.5 5.7V21a1 1 0 0 1-1 1h-3.3v-5h-4.4v5H9.5a1 1 0 0 1-1-1z" fill="#fff"/></svg>';

export default function TrackingMap({ position, trail = [], destination = null, className = "h-[22rem]" }: Props) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const leaflet = useRef<typeof import("leaflet") | null>(null);
  const map = useRef<LeafletMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const halo = useRef<Circle | null>(null);
  const route = useRef<Polyline | null>(null);
  const tiles = useRef<TileLayer | null>(null);
  const shown = useRef<[number, number]>([position.latitude, position.longitude]);
  const frame = useRef<number | null>(null);
  const followRef = useRef(true);
  const home = useRef<Marker | null>(null);
  const latest = useRef({ position, trail, destination });
  latest.current = { position, trail, destination };

  const [follow, setFollowState] = useState(true);
  const [satellite, setSatellite] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const labels = useRef<TileLayer | null>(null);
  const dots = useRef<LayerGroup | null>(null);
  const lastMove = useRef(0);
  // Coordinates under the mouse (or the last tap on a phone).
  const [pointer, setPointer] = useState<[number, number] | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const drawDots = useCallback(() => {
    const L = leaflet.current;
    const group = dots.current;
    if (!L || !group) return;
    group.clearLayers();
    latest.current.trail.forEach((pt, i, all) => {
      const newest = i === all.length - 1;
      L.circleMarker([pt.latitude, pt.longitude], {
        radius: newest ? 5 : 3.5,
        color: "#1d4ed8",
        weight: 1.5,
        fillColor: newest ? "#ffffff" : "#60a5fa",
        fillOpacity: 1,
      })
        .bindTooltip(`#${i + 1}  ${pt.latitude.toFixed(5)}, ${pt.longitude.toFixed(5)}`, { direction: "top", offset: [0, -4] })
        .addTo(group);
    });
  }, []);

  const setFollow = useCallback((value: boolean) => {
    followRef.current = value;
    setFollowState(value);
  }, []);

  // Build the map once.
  useEffect(() => {
    let cancelled = false;
    ensureStyles();

    (async () => {
      const L = await import("leaflet");
      if (cancelled || !box.current || map.current) return;
      leaflet.current = L;
      const { position: p, trail: tr, destination: dest } = latest.current;

      // Zoom buttons bottom-left, so they never sit under the LIVE badge or the Satellite/Follow buttons.
      const m = L.map(box.current, { zoomControl: false }).setView([p.latitude, p.longitude], 16);
      L.control.zoom({ position: "bottomleft" }).addTo(m);
      map.current = m;
      tiles.current = L.tileLayer(SATELLITE.url, SATELLITE).addTo(m);
      if (LABELS) labels.current = L.tileLayer(LABELS.url, LABELS).addTo(m);
      route.current = L.polyline(toLine(tr, p), { color: "#2563eb", weight: 5, opacity: 0.75, lineCap: "round" }).addTo(m);
      halo.current = L.circle([p.latitude, p.longitude], { radius: p.accuracy ?? 0, color: "#2563eb", weight: 1, fillOpacity: 0.08 }).addTo(m);
      marker.current = L.marker([p.latitude, p.longitude], {
        icon: L.divIcon({ className: "tb-driver", html: '<span class="ring"></span><span class="ring2"></span><span class="dot"></span>', iconSize: [24, 24], iconAnchor: [12, 12] }),
        keyboard: false,
      }).addTo(m);

      if (dest) {
        home.current = L.marker([dest.latitude, dest.longitude], {
          icon: L.divIcon({ className: "tb-home", html: HOME_PIN, iconSize: [30, 38], iconAnchor: [15, 37] }),
          keyboard: false,
          title: "Delivery address",
        }).addTo(m);
        m.fitBounds(L.latLngBounds([[p.latitude, p.longitude], [dest.latitude, dest.longitude]]), { padding: [50, 50], maxZoom: AUTO_FIT_MAX_ZOOM });
      } else if (tr.length > 1) {
        m.fitBounds(route.current.getBounds(), { padding: [40, 40], maxZoom: AUTO_FIT_MAX_ZOOM });
      }
      // Dragging the map means "let me look around": stop following until asked.
      m.on("dragstart", () => setFollow(false));

      // Every reported point is a small dot you can hover or tap to read its coordinates.
      dots.current = L.layerGroup().addTo(m);
      drawDots();
      m.on("mousemove", (e) => {
        const t = performance.now();
        if (t - lastMove.current < 80) return;
        lastMove.current = t;
        setPointer([e.latlng.lat, e.latlng.lng]);
      });
      m.on("mouseout", () => setPointer(null));
      m.on("click", (e) => setPointer([e.latlng.lat, e.latlng.lng]));
    })();

    return () => {
      cancelled = true;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      map.current?.remove();
      map.current = null;
    };
  }, [setFollow, drawDots]);

  // Redraw the point dots whenever the route changes.
  useEffect(() => {
    drawDots();
  }, [trail, drawDots]);

  // A new position (or route): glide the marker there.
  useEffect(() => {
    const m = map.current;
    const mk = marker.current;
    if (!m || !mk) return;

    const from = shown.current;
    const to: [number, number] = [position.latitude, position.longitude];
    halo.current?.setRadius(position.accuracy ?? 0);
    if (frame.current !== null) cancelAnimationFrame(frame.current);

    const startedAt = performance.now();
    const step = (time: number) => {
      const k = Math.min(1, (time - startedAt) / GLIDE_MS);
      const eased = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const here: [number, number] = [from[0] + (to[0] - from[0]) * eased, from[1] + (to[1] - from[1]) * eased];
      shown.current = here;
      mk.setLatLng(here);
      halo.current?.setLatLng(here);
      route.current?.setLatLngs(toLine(trail, { latitude: here[0], longitude: here[1] }));
      const dest = latest.current.destination;
      if (followRef.current) {
        if (!dest) m.panTo(here, { animate: false });
        // With a destination, "follow" keeps the delivery person AND the address in view. If the viewer has zoomed in
        // closer than that, their zoom is respected: the map only keeps the delivery person in view.
        else if (k === 1 && leaflet.current) {
          const bounds = leaflet.current.latLngBounds([here, [dest.latitude, dest.longitude]]);
          const fitZoom = m.getBoundsZoom(bounds, false, leaflet.current.point(50, 50));
          if (m.getZoom() > fitZoom + 0.5) {
            if (!m.getBounds().pad(-0.2).contains(here)) m.panTo(here, { animate: true });
          } else {
            m.fitBounds(bounds, { padding: [50, 50], maxZoom: AUTO_FIT_MAX_ZOOM, animate: true });
          }
        }
      }
      if (k < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  }, [position.latitude, position.longitude, position.accuracy, position.updatedAt, trail]);

  // Street <-> satellite.
  useEffect(() => {
    const L = leaflet.current;
    const m = map.current;
    if (!L || !m) return;
    tiles.current?.remove();
    labels.current?.remove();
    labels.current = null;
    const source = satellite ? SATELLITE : STREET;
    tiles.current = L.tileLayer(source.url, source).addTo(m);
    tiles.current.bringToBack();
    if (satellite && LABELS) labels.current = L.tileLayer(LABELS.url, LABELS).addTo(m);
  }, [satellite]);

  // Full screen: the map fills the window; the size is recalculated once the layout has changed. Esc closes it.
  useEffect(() => {
    const t = setTimeout(() => map.current?.invalidateSize(), 120);
    if (!expanded) return () => clearTimeout(t);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setExpanded(false);
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [expanded]);

  // The "seconds ago" badge.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const age = Math.max(0, Math.round((now - new Date(position.updatedAt).getTime()) / 1000));
  const live = age <= LIVE_WITHIN_S;

  const recenter = () => {
    setFollow(true);
    const m = map.current;
    if (!m) return;
    if (destination && leaflet.current) {
      m.fitBounds(leaflet.current.latLngBounds([shown.current, [destination.latitude, destination.longitude]]), { padding: [50, 50], maxZoom: AUTO_FIT_MAX_ZOOM, animate: true });
    } else {
      m.setView(shown.current, Math.max(m.getZoom(), 15), { animate: true });
    }
  };

  return (
    <div className={expanded ? "fixed inset-0 z-[3000] bg-white p-2" : `relative ${className}`} data-expanded={expanded ? "true" : "false"} data-live={live} data-trail-points={trail.length} data-destination={destination ? "true" : "false"}>
      <div ref={box} className="h-full w-full rounded border" role="img" aria-label={t("Tracking map")} />
      <div className="pointer-events-none absolute left-2 top-11 z-[1000] max-w-[85%] space-y-0.5 rounded bg-white/90 px-2 py-1 font-mono text-[11px] leading-tight text-gray-800 shadow">
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
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="absolute bottom-6 right-4 z-[1000] flex items-center gap-1.5 rounded bg-white px-2.5 py-1.5 text-xs font-medium shadow hover:bg-gray-100"
        aria-pressed={expanded}
      >
        {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        {expanded ? t("Close full screen") : t("Full screen")}
      </button>

      <div className="pointer-events-none absolute left-2 top-2 z-[1000]">
        {live ? (
          <span className="flex items-center gap-1.5 rounded-full bg-green-600 px-3 py-1 text-xs font-semibold text-white shadow">
            <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
            {t("LIVE")}
          </span>
        ) : (
          <span className="rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white shadow">
            {t("Last seen {n}s ago", { n: age })}
          </span>
        )}
      </div>

      <div className="absolute right-2 top-2 z-[1000] flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setSatellite((s) => !s)}
          className="flex items-center gap-1.5 rounded bg-white px-2.5 py-1.5 text-xs font-medium shadow hover:bg-gray-100"
          aria-pressed={satellite}
        >
          <Layers size={14} />
          {satellite ? t("Street map") : t("Satellite")}
        </button>
        <button
          type="button"
          onClick={recenter}
          className={`flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium shadow ${
            follow ? "bg-blue-600 text-white" : "bg-white hover:bg-gray-100"
          }`}
          aria-pressed={follow}
        >
          <Crosshair size={14} />
          {t("Follow")}
        </button>
      </div>
    </div>
  );
}

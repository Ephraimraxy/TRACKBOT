"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";

import { LABELS, SATELLITE } from "@/lib/config/mapLayers";

const PIN_SVG =
  '<svg width="30" height="38" viewBox="0 0 30 38" xmlns="http://www.w3.org/2000/svg"><path d="M15 1C7.8 1 2 6.6 2 13.6 2 23 15 37 15 37s13-14 13-23.4C28 6.6 22.2 1 15 1z" fill="#dc2626" stroke="#fff" stroke-width="2"/><path d="M8.5 14.2 15 8.5l6.5 5.7V21a1 1 0 0 1-1 1h-3.3v-5h-4.4v5H9.5a1 1 0 0 1-1-1z" fill="#fff"/></svg>';

/** A satellite map with one pin: the delivery address the customer chose. Shown before the delivery starts. */
export default function DestinationMap({ latitude, longitude, className = "h-64" }: { latitude: number; longitude: number; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      if (cancelled || !box.current || map.current) return;
      const m = L.map(box.current, { zoomControl: true, maxZoom: 21 }).setView([latitude, longitude], 17);
      L.tileLayer(SATELLITE.url, SATELLITE).addTo(m);
      if (LABELS) L.tileLayer(LABELS.url, LABELS).addTo(m);
      L.marker([latitude, longitude], { icon: L.divIcon({ className: "tb-home", html: PIN_SVG, iconSize: [30, 38], iconAnchor: [15, 37] }), keyboard: false, title: "Delivery address" }).addTo(m);
      map.current = m;
      setTimeout(() => m.invalidateSize(), 200);
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, [latitude, longitude]);

  return <div ref={box} className={`relative z-0 w-full overflow-hidden rounded-xl border ${className}`} role="img" aria-label="Delivery address map" />;
}

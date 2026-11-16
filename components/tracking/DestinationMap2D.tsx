"use client";

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

import { SATELLITE, LABELS } from "@/lib/config/mapLayers";
import { HOME_PIN_SVG } from "@/lib/maps/styles";

/** Flat 2D version of the delivery-address map, for browsers without WebGL. */
export default function DestinationMap2D({ latitude, longitude, className = "h-72" }: { latitude: number; longitude: number; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    let map: import("leaflet").Map | null = null;
    (async () => {
      const L = (await import("leaflet")).default as typeof import("leaflet");
      if (cancelled || !box.current) return;
      map = L.map(box.current, { center: [latitude, longitude], zoom: 17, maxZoom: 21 });
      L.tileLayer(SATELLITE.url, { attribution: SATELLITE.attribution, maxZoom: SATELLITE.maxZoom, maxNativeZoom: SATELLITE.maxNativeZoom, tileSize: SATELLITE.tileSize ?? 256, zoomOffset: SATELLITE.zoomOffset ?? 0 }).addTo(map);
      if (LABELS) L.tileLayer(LABELS.url, { maxZoom: LABELS.maxZoom, maxNativeZoom: LABELS.maxNativeZoom }).addTo(map);
      L.marker([latitude, longitude], { icon: L.divIcon({ className: "tb-home", html: HOME_PIN_SVG, iconSize: [34, 44], iconAnchor: [17, 44] }) }).addTo(map);
    })();
    return () => {
      cancelled = true;
      try {
        map?.remove();
      } catch {
        /* gone */
      }
    };
  }, [latitude, longitude]);
  return <div ref={box} className={`relative z-0 w-full overflow-hidden rounded-xl border ${className}`} data-map-engine="2d" role="img" aria-label="Delivery address map" />;
}

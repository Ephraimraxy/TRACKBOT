"use client";

import { useEffect, useRef } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { ensureMapStyles, fallbackFor, HOME_PIN_SVG, MAX_ZOOM, styleFor, TILT } from "@/lib/maps/styles";

/** A 3D satellite map with one pin: the delivery address the customer chose. Shown before the delivery starts. */
export default function DestinationMap({ latitude, longitude, className = "h-72" }: { latitude: number; longitude: number; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);

  useEffect(() => {
    let cancelled = false;
    ensureMapStyles();
    (async () => {
      const ml = await import("maplibre-gl");
      if (cancelled || !box.current || map.current) return;
      const m = new ml.Map({ container: box.current, style: styleFor("satellite"), center: [longitude, latitude], zoom: 17.5, pitch: TILT, maxPitch: 80, maxZoom: MAX_ZOOM, attributionControl: { compact: true } });
      m.addControl(new ml.NavigationControl({ visualizePitch: true }), "bottom-left");
      let fellBack = false;
      m.on("error", (e) => {
        const status = (e as unknown as { error?: { status?: number } }).error?.status;
        if (!fellBack && !m.isStyleLoaded() && !status) {
          fellBack = true;
          m.setStyle(fallbackFor("satellite"));
        }
      });
      const pin = document.createElement("div");
      pin.className = "tb-home";
      pin.innerHTML = HOME_PIN_SVG;
      new ml.Marker({ element: pin, anchor: "bottom" }).setLngLat([longitude, latitude]).addTo(m);
      map.current = m;
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, [latitude, longitude]);

  return <div ref={box} className={`relative z-0 w-full overflow-hidden rounded-xl border ${className}`} role="img" aria-label="Delivery address map" />;
}

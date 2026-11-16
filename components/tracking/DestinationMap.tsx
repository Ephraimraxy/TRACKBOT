"use client";

import { useEffect, useRef } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { highlightDestinationBuilding } from "@/lib/maps/destination";
import { safely } from "@/lib/maps/safe";
import { ensureMapStyles, fallBackToEsri, fallbackFor, HOME_PIN_SVG, imageryFailed, maxZoomNow, styleFor, TILT } from "@/lib/maps/styles";

/** A 3D satellite map with one pin: the delivery address the customer chose. Shown before the delivery starts. */
export default function DestinationMap({ latitude, longitude, className = "h-72", onUnsupported }: { latitude: number; longitude: number; className?: string; onUnsupported?: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const unsupported = useRef(onUnsupported);
  unsupported.current = onUnsupported;

  useEffect(() => {
    let cancelled = false;
    ensureMapStyles();
    (async () => {
      const ml = await import("maplibre-gl");
      if (cancelled || !box.current || map.current) return;
      let m: MapLibreMap;
      try {
        m = new ml.Map({ container: box.current, style: styleFor("satellite"), center: [longitude, latitude], zoom: 17.5, pitch: TILT, maxPitch: 80, maxZoom: maxZoomNow(), attributionControl: { compact: true } });
      } catch {
        unsupported.current?.();
        return;
      }
      m.addControl(new ml.NavigationControl({ visualizePitch: true }), "bottom-left");
      let fellBack = false;
      m.on("error", (e) => {
        if (imageryFailed(e)) return void safely(() => fallBackToEsri(m), undefined);
        const status = (e as unknown as { error?: { status?: number } }).error?.status;
        if (!fellBack && !safely(() => m.isStyleLoaded(), true) && !status) {
          fellBack = true;
          safely(() => m.setStyle(fallbackFor("satellite")), undefined);
        }
      });
      const pin = document.createElement("div");
      pin.className = "tb-home";
      pin.innerHTML = HOME_PIN_SVG;
      new ml.Marker({ element: pin, anchor: "bottom" }).setLngLat([longitude, latitude]).addTo(m);
      safely(() => highlightDestinationBuilding(m, { latitude, longitude }), undefined);
      map.current = m;
    })();
    return () => {
      cancelled = true;
      safely(() => map.current?.remove(), undefined);
      map.current = null;
    };
  }, [latitude, longitude]);

  return <div ref={box} className={`relative z-0 w-full overflow-hidden rounded-xl border ${className}`} data-map-engine="webgl" role="img" aria-label="Delivery address map" />;
}

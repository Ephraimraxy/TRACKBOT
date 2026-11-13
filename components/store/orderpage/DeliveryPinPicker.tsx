"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";
import "leaflet/dist/leaflet.css";
import { Crosshair, X } from "lucide-react";

import { T } from "@/components/i18n/T";
import { useI18n } from "@/components/i18n/LocaleProvider";

export interface Pin {
  latitude: number;
  longitude: number;
}

/** Where the map opens when nothing is pinned yet (Keffi). */
const START: [number, number] = [8.8465, 7.8737];

const PIN_SVG =
  '<svg width="30" height="38" viewBox="0 0 30 38" xmlns="http://www.w3.org/2000/svg"><path d="M15 1C7.8 1 2 6.6 2 13.6 2 23 15 37 15 37s13-14 13-23.4C28 6.6 22.2 1 15 1z" fill="#dc2626" stroke="#fff" stroke-width="2"/><circle cx="15" cy="13.5" r="5" fill="#fff"/></svg>';

/**
 * Lets the customer drop a pin on their exact delivery spot. It is optional, but it is what lets the delivery
 * person navigate there and lets the customer see how many minutes are left. Tap the map, drag the pin, or use
 * the current location.
 */
export default function DeliveryPinPicker({ pin, onChange }: { pin: Pin | null; onChange: (pin: Pin | null) => void }) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const leaflet = useRef<typeof import("leaflet") | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [message, setMessage] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  // Build the map once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      if (cancelled || !box.current || map.current) return;
      leaflet.current = L;
      const m = L.map(box.current, { zoomControl: true }).setView(START, 13);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" }).addTo(m);
      m.on("click", (e) => onChangeRef.current({ latitude: e.latlng.lat, longitude: e.latlng.lng }));
      map.current = m;
      // The container may still be settling its size when the map is created.
      setTimeout(() => m.invalidateSize(), 200);
      // A pin that was already chosen (for example after coming back to the page) is drawn straight away.
      setPinState(pinRef.current);
    })();
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pinRef = useRef(pin);
  pinRef.current = pin;

  function setPinState(p: Pin | null) {
    const L = leaflet.current;
    const m = map.current;
    if (!L || !m) return;
    if (!p) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    if (!marker.current) {
      marker.current = L.marker([p.latitude, p.longitude], {
        draggable: true,
        icon: L.divIcon({ className: "tb-home", html: PIN_SVG, iconSize: [30, 38], iconAnchor: [15, 37] }),
        title: "Delivery spot",
      }).addTo(m);
      marker.current.on("dragend", () => {
        const at = marker.current!.getLatLng();
        onChangeRef.current({ latitude: at.lat, longitude: at.lng });
      });
    } else {
      marker.current.setLatLng([p.latitude, p.longitude]);
    }
  }

  // Keep the pin drawn in step with the chosen value.
  useEffect(() => {
    setPinState(pin);
    if (pin && map.current) map.current.setView([pin.latitude, pin.longitude], Math.max(map.current.getZoom(), 16), { animate: true });
  }, [pin]);

  const useMyLocation = () => {
    setMessage(null);
    if (!("geolocation" in navigator)) {
      setMessage(t("This browser cannot find your location. Tap the map instead."));
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        onChange({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      },
      () => {
        setLocating(false);
        setMessage(t("Could not get your location. Allow location access, or tap the map to place the pin."));
      },
      { enableHighAccuracy: true, timeout: 12_000 }
    );
  };

  return (
    <div className="p-6 sm:p-8 rounded-2xl border border-black/10 shadow-md bg-white">
      <h3 className="text-lg font-bold text-black">
        <T>Pin your exact spot (optional)</T>
      </h3>
      <p className="mt-1 text-sm text-gray-600">
        <T>With a pin, the delivery person can navigate straight to you and you will see how many minutes are left.</T>
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={useMyLocation}
          disabled={locating}
          className="inline-flex items-center gap-2 rounded-full border border-black px-4 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-60"
        >
          <Crosshair className="h-4 w-4" />
          {locating ? <T>Finding you…</T> : <T>Use my current location</T>}
        </button>
        {pin && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="inline-flex items-center gap-2 rounded-full border border-gray-300 px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            <X className="h-4 w-4" />
            <T>Remove pin</T>
          </button>
        )}
      </div>

      {message && <p className="mt-2 text-sm text-red-600">{message}</p>}

      <div
        ref={box}
        className="relative z-0 mt-4 h-64 w-full overflow-hidden rounded-xl border border-black/10"
        data-testid="pin-picker"
        data-pinned={pin ? "true" : "false"}
      />
      <p className="mt-2 text-xs text-gray-500">
        {pin ? <T>Pin placed. Drag it to adjust.</T> : <T>Tap the map to place the pin.</T>}
      </p>
    </div>
  );
}

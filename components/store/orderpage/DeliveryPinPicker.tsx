"use client";

import { useEffect, useRef, useState } from "react";
import type { Circle, Map as LeafletMap, Marker, TileLayer } from "leaflet";
import "leaflet/dist/leaflet.css";
import { Crosshair, Layers, X } from "lucide-react";

import { T } from "@/components/i18n/T";
import { useI18n } from "@/components/i18n/LocaleProvider";
import { LABELS, SATELLITE, STREET } from "@/lib/config/mapLayers";

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
  const [satellite, setSatellite] = useState(true);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const tiles = useRef<TileLayer | null>(null);
  const labels = useRef<TileLayer | null>(null);
  const halo = useRef<Circle | null>(null);

  // Build the map once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = await import("leaflet");
      if (cancelled || !box.current || map.current) return;
      leaflet.current = L;
      const m = L.map(box.current, { zoomControl: true, maxZoom: 21 }).setView(START, 15);
      tiles.current = L.tileLayer(SATELLITE.url, SATELLITE).addTo(m);
      if (LABELS) labels.current = L.tileLayer(LABELS.url, LABELS).addTo(m);
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
      halo.current = null;
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

  // Street <-> satellite.
  const firstLayer = useRef(true);
  useEffect(() => {
    if (firstLayer.current) {
      firstLayer.current = false;
      return;
    }
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

  // A circle showing how precise the phone says the position is.
  useEffect(() => {
    const L = leaflet.current;
    const m = map.current;
    if (!L || !m) return;
    halo.current?.remove();
    halo.current = null;
    if (pin && accuracy) {
      halo.current = L.circle([pin.latitude, pin.longitude], { radius: accuracy, color: "#2563eb", weight: 1, fillOpacity: 0.12 }).addTo(m);
    }
  }, [pin, accuracy]);

  const useMyLocation = () => {
    setMessage(null);
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setMessage(t("Your location only works on a secure (https) page. Tap the map to place the pin."));
      return;
    }
    if (!("geolocation" in navigator)) {
      setMessage(t("This browser cannot find your location. Tap the map instead."));
      return;
    }
    setLocating(true);
    const found = (pos: GeolocationPosition) => {
      setLocating(false);
      setAccuracy(pos.coords.accuracy);
      onChange({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      map.current?.setView([pos.coords.latitude, pos.coords.longitude], 18, { animate: true });
      if (pos.coords.accuracy > 200) {
        setMessage(t("Your device gave only an approximate position. Drag the pin onto your exact spot."));
      }
    };
    const failed = (err: GeolocationPositionError) => {
      setLocating(false);
      if (err.code === err.PERMISSION_DENIED) {
        setMessage(t("Location is blocked for this site. Tap the lock icon beside the web address, set Location to Allow, then try again. Or tap the map to place the pin."));
      } else if (err.code === err.POSITION_UNAVAILABLE) {
        setMessage(t("Your device cannot find your position right now. Turn on Location in your device settings, or tap the map to place the pin."));
      } else {
        setMessage(t("Finding your position took too long. Try again, or tap the map to place the pin."));
      }
    };
    // First the precise GPS fix. A laptop or a weak signal often cannot give one, so if that fails for any reason
    // other than "blocked", ask again for the approximate position from the network, which answers almost at once.
    navigator.geolocation.getCurrentPosition(
      found,
      (err) => {
        if (err.code === err.PERMISSION_DENIED) return failed(err);
        navigator.geolocation.getCurrentPosition(found, failed, { enableHighAccuracy: false, timeout: 20_000, maximumAge: 60_000 });
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 }
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
        <button
          type="button"
          onClick={() => setSatellite((v) => !v)}
          className="inline-flex items-center gap-2 rounded-full border border-gray-300 px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          aria-pressed={satellite}
        >
          <Layers className="h-4 w-4" />
          {satellite ? <T>Street map</T> : <T>Satellite</T>}
        </button>
        {pin && (
          <button
            type="button"
            onClick={() => { setAccuracy(null); onChange(null); }}
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
        className="relative z-0 mt-4 h-72 w-full overflow-hidden rounded-xl border border-black/10"
        data-testid="pin-picker"
        data-pinned={pin ? "true" : "false"}
      />
      <p className="mt-2 text-xs text-gray-500">
        {pin ? <T>Pin placed. Drag it to adjust.</T> : <T>Tap the map to place the pin.</T>}
      </p>
    </div>
  );
}

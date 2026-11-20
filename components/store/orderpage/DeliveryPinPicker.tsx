"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import type { Circle, Map as LeafletMap, Marker as LeafletMarker } from "leaflet";
import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import { Box, Crosshair, Layers, X } from "lucide-react";

import { T } from "@/components/i18n/T";
import { useI18n } from "@/components/i18n/LocaleProvider";
import { currentSatellite } from "@/lib/config/mapLayers";
import { addBaseTiles } from "@/lib/maps/leafletSatellite";
import { pickEngine } from "@/lib/maps/engine";
import { safeSetData, safely } from "@/lib/maps/safe";
import { highlightDestinationBuilding } from "@/lib/maps/destination";
import { addFootprintsLayer, circlePolygon, ensureMapStyles, fallBackToEsri, fallbackFor, HOME_PIN_SVG, imageryFailed, maxZoomNow, styleFor, TILT, type MapMode } from "@/lib/maps/styles";

export interface Pin {
  latitude: number;
  longitude: number;
}

/** Where the map opens when nothing is pinned yet (Keffi). [longitude, latitude] */
const START: [number, number] = [7.8737, 8.8465];

/**
 * Lets the customer drop a pin on their exact delivery spot. It is optional, but it is what lets the delivery
 * person navigate there and lets the customer see how many minutes are left. Tap the map, drag the pin, or use
 * the current location.
 */
export default function DeliveryPinPicker({ pin, onChange }: { pin: Pin | null; onChange: (pin: Pin | null) => void }) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const lib = useRef<typeof import("maplibre-gl") | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const pinRef = useRef(pin);
  pinRef.current = pin;
  // The flat 2D map (Leaflet), used where the browser has no WebGL.
  const [engine, setEngine] = useState<"webgl" | "2d">("webgl");
  const flat = useRef<{ L: typeof import("leaflet"); map: LeafletMap; marker: LeafletMarker | null; halo: Circle; tiles: import("leaflet").LayerGroup } | null>(null);
  const accuracyRef = useRef<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [mode, setMode] = useState<MapMode>("satellite");
  const modeRef = useRef<MapMode>("satellite");
  const [tilted, setTilted] = useState(true);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  accuracyRef.current = accuracy;

  /** The accuracy halo; recreated after every style load. */
  const addHalo = (m: MapLibreMap) => {
    const p = pinRef.current;
    if (!m.getSource("halo")) {
      m.addSource("halo", { type: "geojson", data: circlePolygon(p?.longitude ?? 0, p?.latitude ?? 0, p ? accuracyRef.current ?? 0 : 0) });
      m.addLayer({ id: "halo-fill", type: "fill", source: "halo", paint: { "fill-color": "#2563eb", "fill-opacity": 0.14 } });
      m.addLayer({ id: "halo-line", type: "line", source: "halo", paint: { "line-color": "#2563eb", "line-width": 1 } });
    }
  };

  // Build the map once.
  useEffect(() => {
    let cancelled = false;
    ensureMapStyles();
    const buildFlat = async () => {
      setEngine("2d");
      const L = (await import("leaflet")).default as typeof import("leaflet");
      if (cancelled || !box.current || flat.current) return;
      const start = pinRef.current ? ([pinRef.current.latitude, pinRef.current.longitude] as [number, number]) : ([START[1], START[0]] as [number, number]);
      const lm = L.map(box.current, { center: start, zoom: pinRef.current ? 18 : 15, maxZoom: currentSatellite().maxZoom });
      const tiles = L.layerGroup().addTo(lm);
      const halo = L.circle(start, { radius: 0, color: "#2563eb", weight: 1, fillOpacity: 0.14 }).addTo(lm);
      flat.current = { L, map: lm, marker: null, halo, tiles };
      lm.on("click", (e) => onChangeRef.current({ latitude: e.latlng.lat, longitude: e.latlng.lng }));
      drawFlatTiles("satellite");
      drawFlatPin(pinRef.current);
    };
    (async () => {
      if (pickEngine() === "2d") return buildFlat();
      const ml = await import("maplibre-gl");
      if (cancelled || !box.current || map.current) return;
      lib.current = ml;
      const start = pinRef.current ? ([pinRef.current.longitude, pinRef.current.latitude] as [number, number]) : START;
      let m: MapLibreMap;
      try {
        m = new ml.Map({ container: box.current, style: styleFor("satellite"), center: start, zoom: pinRef.current ? 18 : 15, pitch: TILT, maxPitch: 80, maxZoom: maxZoomNow(), attributionControl: { compact: true } });
      } catch {
        return buildFlat(); // no WebGL: use the flat map
      }
      map.current = m;
      m.addControl(new ml.NavigationControl({ visualizePitch: true }), "bottom-left");
      m.on("style.load", () => safely(() => { addFootprintsLayer(m); addHalo(m); }, undefined));
      let fellBack = false;
      m.on("error", (e) => {
        if (imageryFailed(e)) return void safely(() => fallBackToEsri(m), undefined);
        const status = (e as unknown as { error?: { status?: number } }).error?.status;
        if (!fellBack && !safely(() => m.isStyleLoaded(), true) && !status) {
          fellBack = true;
          safely(() => m.setStyle(fallbackFor(modeRef.current)), undefined);
        }
      });
      m.on("click", (e) => onChangeRef.current({ latitude: e.lngLat.lat, longitude: e.lngLat.lng }));
      // The building on the pin is coloured red in 3D, so the customer can confirm it is the right one.
      safely(() => highlightDestinationBuilding(m, () => pinRef.current), undefined);
      // A pin that was already chosen (for example after coming back to the page) is drawn straight away.
      drawPin(pinRef.current);
    })();
    return () => {
      cancelled = true;
      safely(() => map.current?.remove(), undefined);
      map.current = null;
      marker.current = null;
      safely(() => flat.current?.map.remove(), undefined);
      flat.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function drawFlatTiles(next: MapMode) {
    const f = flat.current;
    if (!f) return;
    addBaseTiles(f.L, f.tiles, f.map, next);
  }

  function drawFlatPin(p: Pin | null) {
    const f = flat.current;
    if (!f) return;
    if (!p) {
      f.marker?.remove();
      f.marker = null;
      return;
    }
    if (!f.marker) {
      f.marker = f.L.marker([p.latitude, p.longitude], { draggable: true, icon: f.L.divIcon({ className: "tb-home", html: HOME_PIN_SVG, iconSize: [34, 44], iconAnchor: [17, 44] }) }).addTo(f.map);
      f.marker.on("dragend", () => {
        const at = f.marker!.getLatLng();
        setAccuracy(null);
        onChangeRef.current({ latitude: at.lat, longitude: at.lng });
      });
    } else f.marker.setLatLng([p.latitude, p.longitude]);
  }

  function drawPin(p: Pin | null) {
    if (flat.current) return drawFlatPin(p);
    const ml = lib.current;
    const m = map.current;
    if (!ml || !m) return;
    if (!p) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    if (!marker.current) {
      const el = document.createElement("div");
      el.className = "tb-home";
      el.innerHTML = HOME_PIN_SVG;
      el.title = "Delivery spot";
      marker.current = new ml.Marker({ element: el, anchor: "bottom", draggable: true }).setLngLat([p.longitude, p.latitude]).addTo(m);
      marker.current.on("dragend", () => {
        const at = marker.current!.getLngLat();
        setAccuracy(null);
        onChangeRef.current({ latitude: at.lat, longitude: at.lng });
      });
    } else {
      marker.current.setLngLat([p.longitude, p.latitude]);
    }
  }

  // Keep the pin and the halo drawn in step with the chosen value.
  useEffect(() => {
    drawPin(pin);
    const f = flat.current;
    if (f) {
      if (pin) {
        f.map.setView([pin.latitude, pin.longitude], Math.max(f.map.getZoom(), 17));
        f.halo.setLatLng([pin.latitude, pin.longitude]);
      }
      f.halo.setRadius(pin && accuracy ? accuracy : 0);
      return;
    }
    const m = map.current;
    if (!m) return;
    if (pin) safely(() => m.easeTo({ center: [pin.longitude, pin.latitude], zoom: Math.max(m.getZoom(), 17), duration: 700 }), undefined);
    safeSetData(m, "halo", circlePolygon(pin?.longitude ?? 0, pin?.latitude ?? 0, pin && accuracy ? accuracy : 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, accuracy]);

  const changeMode = () => {
    const next: MapMode = mode === "satellite" ? "street" : "satellite";
    if (flat.current) {
      modeRef.current = next;
      setMode(next);
      return drawFlatTiles(next);
    }
    const m = map.current;
    if (!m) return;
    modeRef.current = next;
    setMode(next);
    safely(() => m.setStyle(styleFor(next)), undefined);
  };

  const toggleTilt = () => {
    const next = !tilted;
    setTilted(next);
    map.current?.easeTo({ pitch: next ? TILT : 0, bearing: 0, duration: 600 });
  };

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
      if (flat.current) flat.current.map.setView([pos.coords.latitude, pos.coords.longitude], 18);
      else safely(() => map.current?.flyTo({ center: [pos.coords.longitude, pos.coords.latitude], zoom: 18, duration: 900 }), undefined);
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
          onClick={changeMode}
          className="inline-flex items-center gap-2 rounded-full border border-gray-300 px-4 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          aria-pressed={mode === "satellite"}
        >
          <Layers className="h-4 w-4" />
          {mode === "satellite" ? <T>Street map</T> : <T>Satellite</T>}
        </button>
        {engine === "webgl" && (
        <button
          type="button"
          onClick={toggleTilt}
          className={`inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm ${tilted ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 text-gray-700 hover:bg-gray-50"}`}
          aria-pressed={tilted}
        >
          <Box className="h-4 w-4" />
          {tilted ? <T>3D view</T> : <T>Flat view</T>}
        </button>
        )}
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
        className="relative z-0 mt-4 h-80 w-full overflow-hidden rounded-xl border border-black/10"
        data-testid="pin-picker"
        data-pinned={pin ? "true" : "false"}
        data-map-engine={engine}
      />
      <p className="mt-2 text-xs text-gray-500">
        {pin ? <T>Pin placed. Drag it to adjust.</T> : <T>Tap the map to place the pin.</T>}
      </p>
    </div>
  );
}

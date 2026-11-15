"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ShieldAlert } from "lucide-react";

import { useI18n } from "@/components/i18n/LocaleProvider";
import type { MapPoint } from "@/components/tracking/LiveMap";
import { describeApproach, formatDistance, formatMinutes } from "@/lib/services/etaService";
import { useRoutePlan } from "@/components/tracking/useRoutePlan";

import StreetPhotos from "@/components/tracking/StreetPhotos";

import TrackingMap from "@/components/tracking/TrackingMap";

const SEND_EVERY_MS = 4000;
const TRAIL_KEPT = 60;

type Permission = "unknown" | "prompt" | "granted" | "denied";

/**
 * Lets a delivery person share their phone's GPS position for ONE order, so the customer can watch the
 * delivery move on a map.
 *
 * - Nothing is requested until sharing starts (the delivery person taps the button, or has just tapped
 *   "Start delivery", or already allowed location for this site). The browser then asks permission.
 * - While sharing, the screen is kept awake where the phone allows it: most phones stop reporting GPS to a
 *   web page when the screen turns off, which would freeze the customer's map.
 * - Sharing stops with the button, when the order leaves "out for delivery" (the server answers 409), or
 *   when this panel is removed from the page.
 */
export default function LocationSharer({ orderId, autoStart = false, destination = null, landmark = null }: { orderId: string; autoStart?: boolean; destination?: MapPoint | null; landmark?: string | null }) {
  const { t } = useI18n();
  const [sharing, setSharing] = useState(false);
  const [permission, setPermission] = useState<Permission>("unknown");
  const [message, setMessage] = useState<string | null>(null);
  const [last, setLast] = useState<{ latitude: number; longitude: number; accuracy: number; at: number } | null>(null);
  const [trail, setTrail] = useState<MapPoint[]>([]);
  // Time and distance left to the customer, as the server works it out from each position we send.
  const [eta, setEta] = useState<{ durationSeconds: number; distanceMetres: number; source?: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const watchId = useRef<number | null>(null);
  const lastSent = useRef(0);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const autoStarted = useRef(false);

  const holdScreenAwake = useCallback(async () => {
    try {
      if ("wakeLock" in navigator && !wakeLock.current) wakeLock.current = await navigator.wakeLock.request("screen");
      wakeLock.current?.addEventListener("release", () => (wakeLock.current = null));
    } catch {
      // Not supported, or refused (low battery). Sharing still works while the screen stays on.
    }
  }, []);

  const stop = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    void wakeLock.current?.release().catch(() => undefined);
    wakeLock.current = null;
    setSharing(false);
  }, []);

  // When this panel goes away, stop sharing and forget that it auto-started (so a re-mount can start again).
  useEffect(
    () => () => {
      autoStarted.current = false;
      stop();
    },
    [stop]
  );

  // Keep the screen awake again after the delivery person comes back to this page.
  useEffect(() => {
    if (!sharing) return;
    const onVisible = () => document.visibilityState === "visible" && void holdScreenAwake();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [sharing, holdScreenAwake]);

  // The "sent N seconds ago" line.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // What has this phone already decided about location for this site?
  useEffect(() => {
    let status: PermissionStatus | null = null;
    const apply = () => status && setPermission(status.state as Permission);
    navigator.permissions
      ?.query({ name: "geolocation" })
      .then((s) => {
        status = s;
        apply();
        s.addEventListener("change", apply);
      })
      .catch(() => undefined);
    return () => status?.removeEventListener("change", apply);
  }, []);

  const send = useCallback(
    async (pos: GeolocationPosition) => {
      const at = Date.now();
      if (at - lastSent.current < SEND_EVERY_MS) return;
      lastSent.current = at;
      try {
        const res = await fetch(`/api/delivery/orders/${orderId}/location`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }),
        });
        if (res.status === 409 || res.status === 403) {
          stop();
          setMessage(t("Tracking has ended for this order."));
        } else if (res.ok) {
          const json = await res.json().catch(() => null);
          if (json?.data?.eta) setEta({ durationSeconds: json.data.eta.durationSeconds, distanceMetres: json.data.eta.distanceMetres, source: json.data.eta.source });
          const point = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy, at };
          setLast(point);
          setTrail((tr) => [...tr, { latitude: point.latitude, longitude: point.longitude }].slice(-TRAIL_KEPT));
          setMessage(null);
        } else if (res.status !== 429) {
          setMessage(t("Could not send your position. Trying again…"));
        }
      } catch {
        setMessage(t("No connection. Trying again…"));
      }
    },
    [orderId, stop, t]
  );

  const start = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setMessage(t("Location is not available on this device."));
      return;
    }
    if (watchId.current !== null) return;
    setMessage(t("Allow location access in your browser…"));
    watchId.current = navigator.geolocation.watchPosition(
      send,
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          // The one error that ends sharing: the phone says no.
          stop();
          setPermission("denied");
          setMessage(null);
          return;
        }
        // A weak signal, a tunnel, a slow fix: not the end. The watcher keeps trying by itself.
        setMessage(t("Position unavailable for now. Still trying…"));
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 }
    );
    // Ask for a position right now too, so the customer sees the delivery person at once instead of
    // waiting for the first update to arrive from the watcher.
    navigator.geolocation.getCurrentPosition(send, () => undefined, {
      enableHighAccuracy: true,
      maximumAge: 15000,
      timeout: 15000,
    });
    setSharing(true);
    void holdScreenAwake();
  }, [send, stop, holdScreenAwake, t]);

  // Start by itself right after "Start delivery", or when location was already allowed for this site.
  useEffect(() => {
    if (autoStarted.current || sharing) return;
    if (autoStart || permission === "granted") {
      autoStarted.current = true;
      start();
    }
  }, [autoStart, permission, sharing, start]);

  const ago = last ? Math.max(0, Math.round((now - last.at) / 1000)) : null;
  // The road ahead and the next turn, worked out again from the latest position (so it follows a change of road).
  const plan = useRoutePlan(orderId, sharing);
  const approach = last && destination ? describeApproach(last, destination) : null;

  return (
    <div className="mt-3 rounded-lg border bg-white p-3 text-sm">
      {sharing ? (
        <>
          <div className="flex items-center gap-2 font-medium text-green-800">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-green-600" />
            </span>
            {t("Sharing your live location")}
          </div>
          <p className="mt-1 text-xs text-gray-600">
            {ago === null ? t("Getting your position…") : t("Last sent {n}s ago", { n: ago })}
            {last ? ` · ±${Math.round(last.accuracy)} m` : ""}
          </p>
          {eta ? (
            <div className="mt-2 rounded-lg bg-blue-50 p-3 text-blue-950">
              <p className="text-lg font-semibold">{t("About {time} to the customer", { time: formatMinutes(eta.durationSeconds) })}{eta.source === "estimate" ? ` (${t("estimate")})` : ""}</p>
              <p className="text-xs">{t("{distance} away. Updated as you move.", { distance: formatDistance(eta.distanceMetres) })}</p>
            </div>
          ) : (
            !destination && (
              <p className="mt-2 rounded bg-gray-50 p-2 text-xs text-gray-600">
                {t("No time estimate: the customer did not pin their spot on the map. Use the address above.")}
              </p>
            )
          )}
          {plan?.kind === "road" && plan.nextStep && (
            <div className="mt-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-sky-950">
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">{t("Next turn")}</p>
              <p className="text-base font-semibold">{plan.nextStep.instruction}</p>
              <p className="text-xs">{t("in {distance}", { distance: formatDistance(plan.nextStep.distanceMetres) })}</p>
              {plan.rerouted && <p className="mt-1 text-xs font-medium text-sky-800">{t("Rerouted: new road worked out from where you are.")}</p>}
            </div>
          )}
          {plan?.kind === "estimate" && (
            <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900" data-testid="estimate-notice">
              <p className="font-semibold">{t("Straight-line estimate only")}</p>
              <p>{t("Road directions are not available right now. The dotted line goes straight to the customer's spot and is not a road route: choose your own road.")}</p>
            </div>
          )}
          {(approach || landmark) && (
            <div className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-950">
              {approach && <p className="font-medium">{t("Customer's spot: {distance} to the {direction}", { distance: formatDistance(approach.distanceMetres), direction: t(approach.direction) })}</p>}
              {landmark && <p className="mt-1"><span className="font-semibold">{t("Landmark:")}</span> {landmark}</p>}
              <p className="mt-1 text-xs text-red-800">{t("The building on the customer's pin is coloured red on the map, where the map data has it.")}</p>
            </div>
          )}
          {last && <TrackingMap position={{ latitude: last.latitude, longitude: last.longitude, accuracy: last.accuracy, updatedAt: new Date(last.at) }} trail={trail} destination={destination} plannedRoute={plan?.available ? plan.geometry ?? null : null} rerouted={plan?.kind === "road" && (plan?.rerouted ?? false)} routeKind={plan?.available ? plan.kind ?? null : null} className="mt-2 h-72 md:h-96" />}
          {destination && <StreetPhotos latitude={destination.latitude} longitude={destination.longitude} />}
          <p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-900">
            {t("Keep this page open and your screen on. Phones pause location when the screen is off or you switch apps.")}
          </p>
        </>
      ) : (
        <p className="text-gray-700">
          {t("Share your location so the customer can follow this delivery on a map. It is shared for this delivery only and stops when you confirm the delivery.")}
        </p>
      )}

      {permission === "denied" && !sharing && (
        <div className="mt-2 flex gap-2 rounded bg-red-50 p-2 text-xs text-red-800">
          <ShieldAlert size={16} className="mt-0.5 shrink-0" />
          <span>
            {t("Location is blocked for this site. Tap the lock icon beside the web address, set Location to Allow, then press the button again.")}
          </span>
        </div>
      )}

      <button
        type="button"
        className={`mt-3 w-full rounded-lg py-3 font-medium text-white ${sharing ? "bg-gray-600" : "bg-blue-600"}`}
        onClick={sharing ? stop : start}
      >
        {sharing ? t("Stop sharing") : t("Share my location")}
      </button>
      {message && <p className="mt-2 text-xs text-gray-700">{message}</p>}
    </div>
  );
}

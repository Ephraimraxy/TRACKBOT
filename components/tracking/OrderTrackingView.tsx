"use client";

import { useCallback, useEffect, useState } from "react";

import { useConfirm } from "@/components/ui/confirm-dialog";
import { useRoutePlan } from "@/components/tracking/useRoutePlan";
import StreetPhotos from "@/components/tracking/StreetPhotos";
import dynamic from "next/dynamic";
import Link from "next/link";
import { CommandeStatut } from "@prisma/client";

import { getStatusColor } from "@/lib/helpers/orderStatus";
import { STATUS_LABELS_EN } from "@/lib/orders/workflow";
import { T } from "@/components/i18n/T";
import { useI18n } from "@/components/i18n/LocaleProvider";
import { formatDistance, formatMinutes } from "@/lib/services/etaService";

const DestinationMap = dynamic(() => import("@/components/tracking/DestinationMap"), {
  ssr: false,
  loading: () => <div className="h-64 w-full animate-pulse rounded-xl border bg-gray-100" />,
});

const TrackingMap = dynamic(() => import("@/components/tracking/LiveMap"), {
  ssr: false,
  loading: () => <div className="h-72 w-full animate-pulse rounded border bg-gray-100" />,
});

type Tracking = {
  orderId: string;
  status: CommandeStatut;
  statusLabel: string;
  destination: { rue: string; ville: string; wilaya: string; repere?: string | null; latitude: number | null; longitude: number | null } | null;
  eta: { seconds: number; metres: number; updatedAt: string } | null;
  driverFirstName: string | null;
  trackingActive: boolean;
  awaitingConfirmation: boolean;
  mapOpen: boolean;
  location: { latitude: number; longitude: number; accuracy: number | null; updatedAt: string } | null;
  trail: { latitude: number; longitude: number }[];
  history: { id: string; to: CommandeStatut; label: string; note: string | null; date: string }[];
};

const HAPPY_PATH: CommandeStatut[] = [
  CommandeStatut.EN_COURS,
  CommandeStatut.EN_PREPARATION,
  CommandeStatut.EXPEDIEE,
  CommandeStatut.EN_LIVRAISON,
  CommandeStatut.LIVREE,
  CommandeStatut.RECUE,
];
const POLL_MS = 5000;
// While the delivery person is on the road the map refreshes more often, so the dot keeps moving.
const LIVE_POLL_MS = 3000;

// A delivery is only finished once the customer confirms receipt (or the order was cancelled).
const isFinished = (s: CommandeStatut) => s === CommandeStatut.RECUE || s === CommandeStatut.ANNULEE;

/**
 * The tracking screen of one order: progress bar, live map with the time left, and the status history.
 * Used by the customer (their own order) and by the shop owner (any order, to watch a delivery live).
 */
export default function OrderTrackingView({
  orderId,
  audience = "customer",
}: {
  orderId: string;
  audience?: "customer" | "admin";
}) {
  const { t } = useI18n();
  const admin = audience === "admin";
  const [data, setData] = useState<Tracking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"map" | "timeline">("map");
  const [streaming, setStreaming] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/${orderId}/tracking`, { cache: "no-store" });
      if (res.status === 403 || res.status === 404) throw new Error("Order not found or access denied.");
      if (!res.ok) throw new Error("Unable to load tracking.");
      setData((await res.json()).data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [orderId]);

  // Poll while the order is still moving; stop once it is delivered or cancelled.
  useEffect(() => {
    load();
  }, [load]);
  const trackingActive = data?.trackingActive ?? false;
  const finished = data ? isFinished(data.status) : false;
  useEffect(() => {
    if (finished) return;
    const tick = () => {
      if (document.visibilityState === "visible") load();
    };
    // While the live stream is connected, new positions arrive by themselves; polling is only a slow safety net.
    const timer = setInterval(tick, streaming ? 20_000 : trackingActive ? LIVE_POLL_MS : POLL_MS);
    // Catch up straight away when the customer comes back to this tab.
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [finished, trackingActive, streaming, load]);

  // Live updates: the server pushes each new position, status and estimate as it is stored (Server-Sent Events).
  useEffect(() => {
    if (finished || typeof EventSource === "undefined") return;
    const es = new EventSource(`/api/orders/${orderId}/live`);
    es.addEventListener("tracking", (e) => {
      try {
        setData(JSON.parse((e as MessageEvent).data));
        setError(null);
        setStreaming(true);
      } catch {
        // ignore a malformed message; the next one replaces it
      }
    });
    es.onerror = () => setStreaming(false); // the browser reconnects by itself; polling covers the gap
    return () => {
      es.close();
      setStreaming(false);
    };
  }, [orderId, finished]);

  const plan = useRoutePlan(orderId, trackingActive);

  const reached = new Set(data?.history.map((h) => h.to));
  // A step counts as reached once the order is at it or beyond it.
  if (data && data.status !== CommandeStatut.ANNULEE) {
    const at = HAPPY_PATH.indexOf(data.status);
    HAPPY_PATH.forEach((step, i) => i <= at && reached.add(step));
  }

  const [busy, setBusy] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  const [actionError, setActionError] = useState<string | null>(null);

  // The customer (or, if the customer cannot, the shop owner) closes the delivery.
  const closeDelivery = async () => {
    const ok = await confirm(
      admin
        ? { title: "Close this delivery", message: "Close this order as received? Only do this if you know the customer has it.", confirmLabel: "Close as received" }
        : { title: "Confirm receipt", message: "Do you have your order? Confirming ends the delivery.", confirmLabel: "Yes, I received it" }
    );
    if (!ok) return;
    setBusy(true);
    setActionError(null);
    try {
      const res = admin
        ? await fetch(`/api/orders/${orderId}/status`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ statut: CommandeStatut.RECUE, note: "Closed by the shop owner" }) })
        : await fetch(`/api/orders/${orderId}/receive`, { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not confirm.");
      await load();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      <Link href={admin ? "/admin/deliveries" : "/client/orders"} className="text-sm text-blue-600 underline">
        <T>{admin ? "← Deliveries" : "← My orders"}</T>
      </Link>
      <h1 className="mt-2 text-2xl font-semibold"><T>Order tracking</T></h1>

      {error && <p className="mt-4 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {!data && !error && <p className="mt-4 text-sm text-gray-500"><T>Loading…</T></p>}

      {data && (
        <>
          <div className="mt-3 flex items-center gap-3">
            <span className="font-mono text-xs text-gray-500">#{data.orderId.slice(-8)}</span>
            <span className={`rounded px-3 py-1 text-sm ${getStatusColor(data.status)}`}><T>{data.statusLabel}</T></span>
          </div>

          {confirmDialog}
          {data.awaitingConfirmation && (
            <div className="mt-4 rounded-lg border border-teal-300 bg-teal-50 p-4">
              <p className="font-semibold text-teal-900">
                <T>{admin ? "The delivery person says the order has been delivered." : "Your order has arrived."}</T>
              </p>
              <p className="mt-1 text-sm text-teal-900">
                <T>{admin ? "The delivery stays open until the customer confirms that they received it." : "Please check your order, then confirm that you received it. This closes the delivery."}</T>
              </p>
              {actionError && <p className="mt-2 text-sm text-red-700">{actionError}</p>}
              <button
                type="button"
                onClick={closeDelivery}
                disabled={busy}
                className="mt-3 rounded-lg bg-teal-600 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
              >
                <T>{admin ? "Close as received" : "I received my order"}</T>
              </button>
            </div>
          )}
          {data.status === CommandeStatut.RECUE && (
            <p className="mt-4 rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900">
              <T>{admin ? "The customer confirmed receipt. This delivery is closed." : "You confirmed that you received this order. Thank you!"}</T>
            </p>
          )}
          {data.status === CommandeStatut.ANNULEE ? (
            <p className="mt-4 rounded bg-red-50 p-3 text-sm text-red-700"><T>This order has been cancelled.</T></p>
          ) : (
            <ol className="mt-5 grid grid-cols-6 gap-1 text-center text-[11px] leading-tight sm:text-xs">
              {HAPPY_PATH.map((s) => (
                <li key={s} className="flex flex-col items-center gap-1">
                  <span
                    className={`h-3 w-3 rounded-full ${
                      reached.has(s) ? "bg-green-500" : "bg-gray-300"
                    } ${data.status === s ? "ring-4 ring-green-200" : ""}`}
                  />
                  <span className={reached.has(s) ? "text-gray-900" : "text-gray-400"}><T>{STATUS_LABELS_EN[s]}</T></span>
                </li>
              ))}
            </ol>
          )}

          {data.mapOpen ? (
            <section className="mt-6">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-medium">
                  <T>{admin ? "The delivery person" : "Your delivery person"}</T>{data.driverFirstName ? ` (${data.driverFirstName})` : ""}{" "}
                  <T>{data.awaitingConfirmation ? "stopped here" : "is on the way"}</T>
                </h2>
                <div className="inline-flex overflow-hidden rounded-full border text-sm" role="tablist">
                  {(["map", "timeline"] as const).map((v) => (
                    <button
                      key={v}
                      role="tab"
                      aria-selected={view === v}
                      onClick={() => setView(v)}
                      className={`px-4 py-1.5 ${view === v ? "bg-black text-white" : "bg-white hover:bg-gray-100"}`}
                    >
                      <T>{v === "map" ? "Map" : "Timeline"}</T>
                    </button>
                  ))}
                </div>
              </div>

              {view === "map" && data.eta && data.trackingActive && (
                <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
                  <span className="text-lg font-semibold text-blue-900">
                    {t("About {time} away", { time: formatMinutes(data.eta.seconds) })}
                  </span>
                  <span className="text-sm text-blue-800">{t(admin ? "{distance} to the customer" : "{distance} to your door", { distance: formatDistance(data.eta.metres) })}</span>
                  {!admin && (
                    <a href="/client/notifications" className="ml-auto text-xs text-blue-700 underline"><T>Change how often I am reminded</T></a>
                  )}
                </div>
              )}
              {view === "map" && admin && plan?.nextStep && data.trackingActive && (
                <p className="mb-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-900">
                  <span className="font-semibold"><T>Next turn:</T></span> {plan.nextStep.instruction} · {formatDistance(plan.nextStep.distanceMetres)}
                </p>
              )}
              {view === "map" && !data.eta && data.location && !(data.destination?.latitude != null) && (
                <p className="mb-3 rounded border border-dashed p-3 text-sm text-gray-600">
                  <T>The time left is not shown because no delivery spot was pinned on the map for this order.</T>
                </p>
              )}
              {view === "map" &&
                (data.location ? (
                  <TrackingMap
                    position={data.location}
                    trail={data.trail}
                    live={data.trackingActive}
                    plannedRoute={plan?.available ? plan.geometry ?? null : null}
                    rerouted={plan?.rerouted ?? false}
                    destination={data.destination?.latitude != null && data.destination.longitude != null ? { latitude: data.destination.latitude, longitude: data.destination.longitude } : null}
                  />
                ) : (
                  <div className="flex h-[22rem] flex-col items-center justify-center rounded border bg-gray-50 p-6 text-center">
                    <span className="mb-3 h-4 w-4 animate-ping rounded-full bg-blue-500" />
                    <p className="font-medium"><T>{"Waiting for the delivery person's location"}</T></p>
                    <p className="mt-1 max-w-sm text-sm text-gray-600">
                      <T>The map appears as soon as they share it. The order status stays up to date meanwhile.</T>
                    </p>
                  </div>
                ))}
            </section>
          ) : (
            !finished && (
              <p className="mt-6 rounded border border-dashed p-4 text-sm text-gray-600">
                <T>The live map appears here once your order is out for delivery.</T>
              </p>
            )
          )}

          {data.destination && (
            <section className="mt-6">
              <p className="text-sm text-gray-600">
                <T>Delivery address:</T> {data.destination.rue}, {data.destination.ville}, {data.destination.wilaya}
              </p>
              {data.destination.repere && (
                <p className="mt-1 text-sm text-gray-600">
                  <span className="font-medium"><T>Landmark:</T></span> {data.destination.repere}
                </p>
              )}
              {data.destination.latitude != null && data.destination.longitude != null && (admin || data.mapOpen) && (
                <StreetPhotos latitude={data.destination.latitude} longitude={data.destination.longitude} />
              )}
              {/* Before the delivery starts and once it is over, the map shows the delivery spot. While the delivery person is on the road, the live map above shows it. */}
              {!data.mapOpen && data.status !== CommandeStatut.ANNULEE && data.destination.latitude != null && data.destination.longitude != null && (
                <div className="mt-3">
                  <DestinationMap latitude={data.destination.latitude} longitude={data.destination.longitude} />
                  <p className="mt-2 text-xs text-gray-500">
                    {data.status === CommandeStatut.RECUE ? (
                      <T>Your order was delivered to this spot.</T>
                    ) : (
                      <T>This is your delivery spot. The live map, with your delivery person moving towards it, appears here as soon as they start the delivery.</T>
                    )}
                  </p>
                </div>
              )}
              {!admin && !data.mapOpen && !finished && data.destination.latitude == null && (
                <p className="mt-3 rounded border border-dashed p-3 text-xs text-gray-600">
                  <T>You did not pin your spot on the map. The live map still appears when your delivery person starts, but the time left needs your pin. Pin your spot when you order next time.</T>
                </p>
              )}
            </section>
          )}

          <section className={`mt-6 ${data.mapOpen && view === "map" ? "hidden" : ""}`}>
            <h2 className="mb-2 font-medium"><T>History</T></h2>
            <ul className="space-y-2 border-l pl-4">
              {[...data.history].reverse().map((h) => (
                <li key={h.id} className="text-sm">
                  <span className="font-medium"><T>{h.label}</T></span>
                  <span className="ml-2 text-xs text-gray-500">{new Date(h.date).toLocaleString("en-NG")}</span>
                  {h.note && <span className="block text-xs text-gray-500">{h.note}</span>}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

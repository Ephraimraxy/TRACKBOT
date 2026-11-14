"use client";

import { T } from "@/components/i18n/T";

import { useCallback, useEffect, useState } from "react";
import { CommandeStatut } from "@prisma/client";

import { getStatusColor } from "@/lib/helpers/orderStatus";
import { STATUS_LABELS_EN } from "@/lib/orders/workflow";
import LocationSharer from "@/components/tracking/LocationSharer";
import { useConfirm } from "@/components/ui/confirm-dialog";

type Delivery = {
  id: string;
  etaSecondes: number | null;
  distanceMetres: number | null;
  commande: {
    id: string;
    statut: CommandeStatut;
    montant: string | number;
    adresse: { rue: string; ville: string; wilaya: string; codePostal: string; latitude: number | null; longitude: number | null } | null;
    client: { user: { nom: string; prenom: string; tel: string | null } } | null;
    lignesCommande: { nomProduit: string; quantite: number }[];
  };
};

const REFRESH_MS = 10_000;

/** Opens turn-by-turn directions in Google Maps: to the customer's pin if they set one, else to the address. */
function mapsLink(a: { rue: string; ville: string; wilaya: string; latitude: number | null; longitude: number | null }) {
  const destination = a.latitude != null && a.longitude != null ? `${a.latitude},${a.longitude}` : `${a.rue}, ${a.ville}, ${a.wilaya}, Nigeria`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
}

export default function DriverDeliveriesPage() {
  const [confirm, confirmDialog] = useConfirm();
  const [items, setItems] = useState<Delivery[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // The order just set out for delivery: its location sharing starts by itself.
  const [justStarted, setJustStarted] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/delivery/orders");
      if (!res.ok) throw new Error("Unable to load your deliveries.");
      setItems((await res.json()).data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);

  const advance = async (orderId: string, statut: CommandeStatut) => {
    if (statut === CommandeStatut.LIVREE && !(await confirm({ title: "Confirm delivery", message: "Confirm that the order was handed over to the customer?", confirmLabel: "Yes, delivered" }))) {
      return;
    }
    setBusyId(orderId);
    setError(null);
    try {
      const res = await fetch(`/api/delivery/orders/${orderId}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ statut }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Update failed.");
      if (statut === CommandeStatut.EN_LIVRAISON) setJustStarted(orderId);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="p-4 md:p-6">
      {confirmDialog}
      <h1 className="text-2xl font-semibold"><T>My deliveries</T></h1>
      <p className="mb-4 text-sm text-gray-500"><T>Updates automatically every 10 seconds.</T></p>

      <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
        <p className="mb-2 font-medium"><T>How a delivery works</T></p>
        <ol className="list-decimal space-y-1 pl-5">
          <li><T>When the shop hands you an order it appears below.</T></li>
          <li><T>Tap Start delivery when you set off. Your phone will ask to share your location: tap Allow.</T></li>
          <li><T>The customer now sees you moving on their map. Keep this page open and the screen on.</T></li>
          <li><T>When you hand over the order, tap Confirm delivery. Sharing stops and the customer is told.</T></li>
        </ol>
      </div>

      {error && <p className="mb-3 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {loading && <p className="text-sm text-gray-500"><T>Loading…</T></p>}
      {!loading && items.length === 0 && <p className="text-gray-500"><T>No deliveries assigned.</T></p>}

      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
        {items.map(({ id, commande: c }) => (
          <div key={id} className="rounded border bg-white p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-mono text-xs">#{c.id.slice(-8)}</span>
              <span className={`rounded px-2 py-1 text-xs ${getStatusColor(c.statut)}`}>
                <T>{STATUS_LABELS_EN[c.statut]}</T>
              </span>
            </div>

            {c.client && (
              <p className="text-sm">
                {c.client.user.prenom} {c.client.user.nom}
                {c.client.user.tel && (
                  <>
                    {" · "}
                    <a className="text-blue-600 underline" href={`tel:${c.client.user.tel}`}>
                      {c.client.user.tel}
                    </a>
                  </>
                )}
              </p>
            )}
            {c.adresse && (
              <p className="mb-2 text-sm text-gray-600">
                {c.adresse.rue}, {c.adresse.ville}, {c.adresse.wilaya} {c.adresse.codePostal}
              </p>
            )}
            {c.adresse && (c.statut === CommandeStatut.EXPEDIEE || c.statut === CommandeStatut.EN_LIVRAISON) && (
              <a
                href={mapsLink(c.adresse)}
                target="_blank"
                rel="noopener noreferrer"
                className="mb-3 inline-flex items-center gap-2 rounded-full border border-blue-600 px-4 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50"
              >
                <T>Navigate to the customer</T>
              </a>
            )}
            <ul className="mb-3 list-disc pl-5 text-sm text-gray-700">
              {c.lignesCommande.map((l, i) => (
                <li key={i}>
                  {l.quantite} × {l.nomProduit}
                </li>
              ))}
            </ul>

            {c.statut === CommandeStatut.EXPEDIEE && (
              <button
                className="w-full rounded bg-blue-600 py-2 text-white disabled:opacity-40"
                disabled={busyId === c.id}
                onClick={() => advance(c.id, CommandeStatut.EN_LIVRAISON)}
              >
                <T>Start delivery</T>
              </button>
            )}
            {c.statut === CommandeStatut.EN_LIVRAISON && (
              <>
                <button
                  className="w-full rounded bg-green-600 py-2 text-white disabled:opacity-40"
                  disabled={busyId === c.id}
                  onClick={() => advance(c.id, CommandeStatut.LIVREE)}
                >
                  <T>Confirm delivery</T>
                </button>
                <LocationSharer
                  orderId={c.id}
                  autoStart={justStarted === c.id}
                  destination={c.adresse?.latitude != null && c.adresse.longitude != null ? { latitude: c.adresse.latitude, longitude: c.adresse.longitude } : null}
                />
              </>
            )}
            {c.statut === CommandeStatut.LIVREE && (
              <p className="text-center text-sm text-green-700"><T>Delivered ✔</T></p>
            )}
            {(c.statut === CommandeStatut.EN_COURS || c.statut === CommandeStatut.EN_PREPARATION) && (
              <p className="rounded bg-amber-50 p-3 text-center text-sm text-amber-900">
                <T>The shop is still preparing this order. You can start the delivery once the shop marks it as Shipped.</T>
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

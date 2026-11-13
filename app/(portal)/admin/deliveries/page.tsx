"use client";

import { useCallback, useEffect, useState } from "react";

import DeliveryTeam from "@/components/portal/admin/deliveries/DeliveryTeam";
import { T } from "@/components/i18n/T";

import { getStatusColor } from "@/lib/helpers/orderStatus";
import { STATUS_LABELS_EN } from "@/lib/orders/workflow";
import { CommandeStatut } from "@prisma/client";

type Driver = { id: string; nom: string; prenom: string; tel: string | null; email?: string };
type BoardOrder = {
  id: string;
  date: string;
  statut: CommandeStatut;
  montant: string | number;
  adresse: { ville: string; wilaya: string } | null;
  client: { user: { nom: string; prenom: string } } | null;
  livraison: { livreur: { id: string; nom: string; prenom: string } } | null;
};

/** The next move the shop owner makes for an order, and the sentence that explains it. */
const NEXT_ACTION: Partial<Record<CommandeStatut, { to: CommandeStatut; label: string; hint: string }>> = {
  [CommandeStatut.EN_COURS]: { to: CommandeStatut.EN_PREPARATION, label: "Start preparing", hint: "Confirm the order and begin packing it." },
  [CommandeStatut.EN_PREPARATION]: { to: CommandeStatut.EXPEDIEE, label: "Mark as shipped", hint: "Packed and ready. The delivery person can now start." },
};

export default function AdminDeliveriesPage() {
  const [orders, setOrders] = useState<BoardOrder[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [o, d] = await Promise.all([fetch("/api/deliveries"), fetch("/api/drivers")]);
      if (!o.ok || !d.ok) throw new Error("Unable to load deliveries.");
      setOrders((await o.json()).data);
      setDrivers((await d.json()).data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const advance = async (orderId: string, to: CommandeStatut) => {
    setBusyId(orderId);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ statut: to }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not update the order.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const assign = async (orderId: string) => {
    const driverId = choice[orderId];
    if (!driverId) return;
    setBusyId(orderId);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/assign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ driverId }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Assignment failed.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="p-4 md:p-6">
      <h1 className="text-2xl font-semibold">Deliveries</h1>
      <p className="mb-4 text-sm text-gray-500">
        Assign a driver to orders. An order that is out for delivery can no longer be reassigned.
      </p>

      <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
        <p className="font-semibold"><T>How to get an order onto the live map</T></p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li><T>Press Start preparing, then Mark as shipped, in the Next step column.</T></li>
          <li><T>Assign a delivery person to the order.</T></li>
          <li><T>The delivery person opens My deliveries and taps Start delivery. Their location starts sharing.</T></li>
          <li><T>The customer now sees the live map and the time left on their tracking page.</T></li>
        </ol>
        <p className="mt-2 text-xs text-blue-900"><T>The time left only appears when the customer pinned their spot on the map at checkout.</T></p>
      </div>

      {error && <p className="mb-3 rounded bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {loading && <p className="text-sm text-gray-500">Loading…</p>}
      <DeliveryTeam drivers={drivers} onChanged={load} />

      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50 text-gray-600">
            <tr>
              <th className="p-3">Order</th>
              <th className="p-3">Customer</th>
              <th className="p-3">City</th>
              <th className="p-3">Status</th>
              <th className="p-3">Next step</th>
              <th className="p-3">Delivery person</th>
              <th className="p-3">Assign</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const locked = o.statut === CommandeStatut.EN_LIVRAISON;
              return (
                <tr key={o.id} className="border-t">
                  <td className="p-3 font-mono text-xs">{o.id.slice(-8)}</td>
                  <td className="p-3">
                    {o.client ? `${o.client.user.prenom} ${o.client.user.nom}` : "—"}
                  </td>
                  <td className="p-3">{o.adresse?.ville ?? "—"}</td>
                  <td className="p-3">
                    <span className={`rounded px-2 py-1 text-xs ${getStatusColor(o.statut)}`}>
                      {STATUS_LABELS_EN[o.statut]}
                    </span>
                  </td>
                  <td className="p-3">
                    {NEXT_ACTION[o.statut] ? (
                      <div>
                        <button
                          className="rounded bg-green-600 px-3 py-1 text-white disabled:opacity-40"
                          disabled={busyId === o.id}
                          onClick={() => advance(o.id, NEXT_ACTION[o.statut]!.to)}
                          title={NEXT_ACTION[o.statut]!.hint}
                        >
                          {busyId === o.id ? "…" : <T>{NEXT_ACTION[o.statut]!.label}</T>}
                        </button>
                      </div>
                    ) : o.statut === CommandeStatut.EXPEDIEE ? (
                      <span className="text-xs text-gray-600">
                        {o.livraison ? <T>Waiting for the delivery person to tap Start delivery</T> : <T>Assign a delivery person</T>}
                      </span>
                    ) : o.statut === CommandeStatut.EN_LIVRAISON ? (
                      <span className="text-xs text-green-700"><T>On the road, live on the map</T></span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  <td className="p-3">
                    {o.livraison
                      ? `${o.livraison.livreur.prenom} ${o.livraison.livreur.nom}`
                      : "Unassigned"}
                  </td>
                  <td className="p-3">
                    {locked ? (
                      <span className="text-xs text-gray-400">Locked</span>
                    ) : (
                      <div className="flex gap-2">
                        <select
                          className="rounded border p-1"
                          value={choice[o.id] ?? ""}
                          onChange={(e) => setChoice((c) => ({ ...c, [o.id]: e.target.value }))}
                        >
                          <option value="">Choose…</option>
                          {drivers.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.prenom} {d.nom}
                            </option>
                          ))}
                        </select>
                        <button
                          className="rounded bg-blue-600 px-3 py-1 text-white disabled:opacity-40"
                          disabled={!choice[o.id] || busyId === o.id}
                          onClick={() => assign(o.id)}
                        >
                          {busyId === o.id ? "…" : "Assign"}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {!loading && orders.length === 0 && (
              <tr>
                <td className="p-4 text-gray-500" colSpan={7}>
                  No orders to deliver at the moment.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

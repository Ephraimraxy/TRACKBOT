"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

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
  paiement: { statut: "EN_COURS" | "VALIDE" | "ECHOUE" } | null;
  livraison: { livreur: { id: string; nom: string; prenom: string } } | null;
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
        Assign a delivery person to each paid order. An order that is out for delivery can no longer be reassigned.
      </p>

      <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
        <p className="font-semibold"><T>How a delivery works</T></p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li><T>A customer places an order and pays. You are notified.</T></li>
          <li><T>Choose a delivery person for the order and press Assign. That is all you need to do.</T></li>
          <li><T>The delivery person opens My deliveries and taps Start delivery. You and the customer are notified and their live location starts sharing.</T></li>
          <li><T>Press Watch live to follow the delivery person on the map. The customer sees the same map on their tracking page.</T></li>
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
              <th className="p-3">Payment</th>
              <th className="p-3">What happens next</th>
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
                    {o.paiement?.statut === "VALIDE" ? (
                      <span className="rounded bg-green-100 px-2 py-1 text-xs text-green-700"><T>Paid</T></span>
                    ) : o.paiement?.statut === "ECHOUE" ? (
                      <span className="rounded bg-red-100 px-2 py-1 text-xs text-red-700"><T>Payment failed</T></span>
                    ) : (
                      <span className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-700"><T>Awaiting payment</T></span>
                    )}
                  </td>
                  <td className="p-3">
                    {o.statut === CommandeStatut.EN_LIVRAISON ? (
                      <Link href={`/admin/deliveries/${o.id}/track`} className="inline-flex items-center gap-1 rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
                        <T>Watch live</T>
                      </Link>
                    ) : o.livraison ? (
                      <span className="text-xs text-gray-600"><T>Waiting for the delivery person to tap Start delivery</T></span>
                    ) : (
                      <span className="text-xs font-medium text-blue-700"><T>Assign a delivery person</T></span>
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
                <td className="p-4 text-gray-500" colSpan={8}>
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

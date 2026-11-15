"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Analytics = {
  deliveries: number; averageMinutes: number | null; averageKm: number | null; withGpsProblems: number; withDeviations: number; tooFewPoints: number;
  drivers: { driverId: string; name: string; deliveries: number; averageMinutes: number | null; averageKm: number | null; averageSpeedKmh: number | null; withGpsProblems: number; withDeviations: number }[];
  recent: { orderId: string; driver: string; minutes: number | null; km: number | null; speedKmh: number | null; gpsProblems: boolean; deviations: boolean; tooFewPoints: boolean }[];
};
const dash = (v: number | null, unit = "") => (v === null ? "–" : `${v}${unit}`);

export default function DeliveryAnalyticsPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    (async () => {
      try {
        const res = await fetch(`/api/admin/delivery-analytics?days=${days}`, { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error ?? "Could not load analytics.");
        if (!cancelled) setData(json.data);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [days]);

  return (
    <div className="mx-auto max-w-5xl p-4" data-testid="analytics">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">Delivery analytics</h1>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded border px-2 py-1 text-sm" aria-label="Period">
          {[7, 30, 90, 365].map((d) => <option key={d} value={d}>Last {d} days</option>)}
        </select>
        <Link href="/admin/deliveries" className="ml-auto text-sm text-blue-700 underline">Deliveries</Link>
      </div>
      {error && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {!data && !error && <div className="h-40 animate-pulse rounded border bg-gray-100" />}
      {data && (
        <>
          <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            {[["Finished deliveries", String(data.deliveries)], ["Average time", dash(data.averageMinutes, " min")], ["Average distance", dash(data.averageKm, " km")], ["With GPS problems", `${data.withGpsProblems} of ${data.deliveries}`], ["Left the planned road", `${data.withDeviations} of ${data.deliveries}`], ["Too few GPS points", String(data.tooFewPoints)]].map(([k, v]) => (
              <div key={k} className="rounded-lg border bg-white p-3"><dt className="text-xs text-gray-500">{k}</dt><dd className="text-base font-semibold">{v}</dd></div>
            ))}
          </dl>
          <h2 className="mb-1 mt-5 text-sm font-semibold">By delivery person</h2>
          <div className="overflow-x-auto rounded-lg border bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs text-gray-600"><tr>{["Delivery person", "Deliveries", "Avg time", "Avg distance", "Avg speed", "GPS problems", "Left the road"].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr></thead>
              <tbody>
                {data.drivers.map((d) => (
                  <tr key={d.driverId} className="border-t"><td className="px-3 py-2 font-medium">{d.name}</td><td className="px-3 py-2">{d.deliveries}</td><td className="px-3 py-2">{dash(d.averageMinutes, " min")}</td><td className="px-3 py-2">{dash(d.averageKm, " km")}</td><td className="px-3 py-2">{dash(d.averageSpeedKmh, " km/h")}</td><td className="px-3 py-2">{d.withGpsProblems}</td><td className="px-3 py-2">{d.withDeviations}</td></tr>
                ))}
                {data.drivers.length === 0 && <tr><td className="px-3 py-4 text-gray-600" colSpan={7}>No finished deliveries in this period.</td></tr>}
              </tbody>
            </table>
          </div>
          <h2 className="mb-1 mt-5 text-sm font-semibold">Recent deliveries</h2>
          <ul className="divide-y rounded-lg border bg-white text-sm">
            {data.recent.map((r) => (
              <li key={r.orderId} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
                <span className="font-medium">{r.driver}</span><span>{dash(r.minutes, " min")}</span><span>{dash(r.km, " km")}</span>
                {r.gpsProblems && <span className="rounded bg-amber-100 px-2 text-xs text-amber-900">GPS problems</span>}
                {r.deviations && <span className="rounded bg-amber-100 px-2 text-xs text-amber-900">left the road</span>}
                <Link href={`/admin/deliveries/${r.orderId}/replay`} className="ml-auto text-blue-700 underline">Replay</Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Pause, Play } from "lucide-react";

import TrackingMap from "@/components/tracking/TrackingMap";
import { formatDistance } from "@/lib/services/etaService";

interface Report {
  orderId: string;
  status: string;
  driver: { name: string };
  address: string | null;
  destination: { latitude: number; longitude: number } | null;
  startedAt: string | null;
  deliveredAt: string | null;
  plannedRoute: [number, number][] | null;
  points: { latitude: number; longitude: number; accuracy: number | null; at: number; backfilled: boolean }[];
  analysis: { points: number; durationSeconds: number; distanceMetres: number; averageSpeedKmh: number | null; movingSpeedKmh: number | null; stops: { from: number; seconds: number }[]; gaps: { from: number; to: number; seconds: number }[]; deviations: { from: number; to: number; seconds: number; maxMetresFromRoute: number }[] | null; directness: number | null };
  findings: { kind: string; severity: "info" | "warning"; text: string }[];
}

const SPEEDS = [1, 4, 16, 60];
const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const mins = (s: number) => (s >= 120 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`);

/** Owner's replay of a finished (or running) delivery: scrub or play the movement, see the findings. */
export default function DeliveryReplay({ orderId }: { orderId: string }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(16);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/deliveries/${orderId}/report`, { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error(json?.error ?? "Could not load the report.");
        if (!cancelled) setReport(json.data);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  const points = report?.points ?? [];
  const t0 = points[0]?.at ?? 0;
  const tEnd = points.at(-1)?.at ?? 0;

  // Play: advance the replay clock `speed` times faster than real time, and show the last point at or before it.
  const clockRef = useRef(0);
  useEffect(() => {
    if (!playing || points.length < 2) return;
    let last = performance.now();
    clockRef.current = points[index]?.at ?? t0;
    const tick = (now: number) => {
      clockRef.current += (now - last) * speed;
      last = now;
      if (clockRef.current >= tEnd) {
        setIndex(points.length - 1);
        setPlaying(false);
        return;
      }
      let i = 0;
      while (i + 1 < points.length && points[i + 1].at <= clockRef.current) i++;
      setIndex(i);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, speed, points.length]);

  const trail = useMemo(() => points.slice(0, index + 1).map((p) => ({ latitude: p.latitude, longitude: p.longitude })), [points, index]);

  if (error) return <p className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>;
  if (!report) return <div className="h-96 animate-pulse rounded border bg-gray-100" />;
  if (points.length === 0) return <p className="rounded border border-dashed p-4 text-sm text-gray-600">No GPS points were recorded for this delivery, so there is nothing to replay.</p>;

  const here = points[index];
  const a = report.analysis;
  return (
    <div data-testid="replay">
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <Link href="/admin/deliveries" className="text-blue-700 underline">Back to deliveries</Link>
        <span className="font-semibold">{report.driver.name}</span>
        {report.address && <span className="text-gray-600">{report.address}</span>}
      </div>

      <TrackingMap
        position={{ latitude: here.latitude, longitude: here.longitude, accuracy: here.accuracy, updatedAt: new Date(here.at) }}
        trail={trail}
        destination={report.destination}
        plannedRoute={report.plannedRoute}
        routeKind={report.plannedRoute ? "road" : null}
        live={false}
        className="h-[26rem]"
      />

      <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border bg-white p-3">
        <button type="button" onClick={() => { if (!playing && index >= points.length - 1) setIndex(0); setPlaying((p) => !p); }} className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-white" aria-label={playing ? "Pause" : "Play"} data-testid="replay-play">
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <input type="range" min={0} max={points.length - 1} value={index} onChange={(e) => { setPlaying(false); setIndex(Number(e.target.value)); }} className="min-w-[10rem] flex-1" aria-label="Position in the delivery" data-testid="replay-slider" />
        <span className="font-mono text-xs" data-testid="replay-time">{clock(here.at)}{here.backfilled ? " · late point" : ""}</span>
        <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="rounded border px-2 py-1 text-xs" aria-label="Playback speed">
          {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
        </select>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        {[
          ["Time on the road", a.durationSeconds > 0 ? mins(a.durationSeconds) : "–"],
          ["Distance driven", formatDistance(a.distanceMetres)],
          ["Average speed", a.averageSpeedKmh != null ? `${a.averageSpeedKmh} km/h` : "–"],
          ["GPS points", String(a.points)],
        ].map(([k, v]) => (
          <div key={k} className="rounded-lg border bg-white p-3">
            <dt className="text-xs text-gray-500">{k}</dt>
            <dd className="text-base font-semibold">{v}</dd>
          </div>
        ))}
      </dl>

      <section className="mt-4" data-testid="findings">
        <h3 className="text-sm font-semibold">What the GPS shows</h3>
        {report.findings.length === 0 ? (
          <p className="mt-1 text-sm text-green-700">Nothing unusual: steady GPS, no long gaps, and the planned road was followed.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {report.findings.map((f, i) => (
              <li key={i} className={`rounded border px-3 py-2 text-sm ${f.severity === "warning" ? "border-amber-300 bg-amber-50 text-amber-900" : "border-gray-200 bg-gray-50 text-gray-800"}`}>{f.text}</li>
            ))}
          </ul>
        )}
        {a.deviations === null && <p className="mt-2 text-xs text-gray-500">No planned road was kept for this delivery (routing was unavailable), so route deviation cannot be judged.</p>}
      </section>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

export interface RouteView {
  available: boolean;
  reason?: string;
  geometry?: [number, number][];
  distanceMetres?: number;
  durationSeconds?: number;
  source?: "route" | "estimate";
  nextStep?: { instruction: string; distanceMetres: number } | null;
  rerouted?: boolean;
}

const EVERY_MS = 8000;

/**
 * The planned road from the delivery person to the customer's spot, refreshed while `active`. The server works the
 * route out from the latest position each time, so it adjusts by itself when the delivery person takes another road,
 * and says `rerouted` when that happened.
 */
export function useRoutePlan(orderId: string, active: boolean): RouteView | null {
  const [plan, setPlan] = useState<RouteView | null>(null);

  useEffect(() => {
    if (!active) {
      setPlan(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(`/api/orders/${orderId}/route`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { data?: RouteView };
        if (!cancelled && json.data) setPlan(json.data);
      } catch {
        // keep the last route; the next refresh tries again
      }
    };
    load();
    const timer = setInterval(load, EVERY_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [orderId, active]);

  return plan;
}

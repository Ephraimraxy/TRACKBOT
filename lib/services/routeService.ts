import { CommandeStatut, Prisma, UserRole, type PrismaClient } from "@prisma/client";

import { OrderError, type StatusActor } from "@/lib/services/orderService";
import { OFF_ROUTE_METRES, isSustainedDeviation, type Fix } from "@/lib/services/deviation";
import { planRoute, type FallbackReason, type RoutePlan } from "@/lib/services/etaService";

/** A planned route is reused for this long, so many viewers of one delivery cost the routing server one request. */
export const ROUTE_CACHE_MS = 8_000;
export { OFF_ROUTE_METRES };
/** "Rerouted" stays on screen for this long after the route changed. */
export const REROUTED_SHOWN_MS = 20_000;

export interface RouteView {
  available: boolean;
  /**
   * "road": a route along real roads, with turns.
   * "estimate": only a straight line to the customer's spot. It is NOT a road route, and it never has turns.
   */
  kind?: "road" | "estimate";
  /** For an estimate: why no road route was available. */
  fallbackReason?: FallbackReason;
  reason?: "NO_DESTINATION" | "NO_POSITION";
  geometry?: [number, number][];
  distanceMetres?: number;
  durationSeconds?: number;
  source?: "route" | "estimate";
  /** The next turn and how far away it is. Only for a road route, and only for the delivery person and the owner. */
  nextStep?: { instruction: string; distanceMetres: number } | null;
  rerouted?: boolean;
  updatedAt?: string;
}

interface Cached {
  at: number;
  plan: RoutePlan;
  reroutedAt: number | null;
}

const cache = new Map<string, Cached>();

/** Forget cached routes (tests). */
export const clearRouteCache = () => cache.clear();

/**
 * The route from the delivery person's latest position to the customer's pinned spot, while the order is out for
 * delivery. Readable by the owner, the customer who ordered and the assigned delivery person only.
 *
 * The route always starts from the latest position, so it adjusts by itself when the driver takes another road.
 * If the driver has moved off the previous line, the answer says `rerouted` for a few seconds so the screen can say so.
 */
export async function getRoutePlan(
  db: PrismaClient,
  params: { orderId: string; actor: StatusActor; now?: Date; plan?: typeof planRoute }
): Promise<RouteView> {
  const { orderId, actor } = params;
  const now = (params.now ?? new Date()).getTime();
  const plan = params.plan ?? planRoute;

  const order = await db.commande.findUnique({
    where: { id: orderId },
    select: {
      statut: true,
      clientId: true,
      adresse: { select: { latitude: true, longitude: true } },
      livraison: { select: { livreurId: true } },
    },
  });
  if (!order) throw new OrderError("ORDER_NOT_FOUND", "Order not found.");

  const allowed =
    actor.role === UserRole.ADMIN ||
    (actor.role === UserRole.CLIENT && order.clientId === actor.id) ||
    (actor.role === UserRole.LIVREUR && order.livraison?.livreurId === actor.id);
  if (!allowed) throw new OrderError("FORBIDDEN", "Access denied.");
  if (order.statut !== CommandeStatut.EN_LIVRAISON) throw new OrderError("TRACKING_INACTIVE", "A route exists only while the order is out for delivery.");

  const dest = order.adresse;
  if (dest?.latitude == null || dest.longitude == null) return { available: false, reason: "NO_DESTINATION" };
  // The newest live points (not late, queued ones: those say where the phone was, not where it is).
  const recent = await db.positionLivraison.findMany({ where: { commandeId: orderId, backfilled: false }, orderBy: { date: "desc" }, take: 8, select: { latitude: true, longitude: true, precision: true, date: true } });
  const last = recent[0] ?? (await db.positionLivraison.findFirst({ where: { commandeId: orderId }, orderBy: { date: "desc" }, select: { latitude: true, longitude: true, precision: true, date: true } }));
  if (!last) return { available: false, reason: "NO_POSITION" };
  const fixes: Fix[] = recent.map((p) => ({ latitude: p.latitude, longitude: p.longitude, accuracy: p.precision, at: p.date.getTime() }));

  const here = { latitude: last.latitude, longitude: last.longitude };
  const hit = cache.get(orderId);
  let entry = hit;
  if (!hit || now - hit.at > ROUTE_CACHE_MS) {
    const fresh = await plan(here, { latitude: dest.latitude, longitude: dest.longitude });
    // "Rerouted" only when the delivery person has really left a ROAD route: several accurate fixes in a row, well away from it.
    const left = hit && hit.plan.source === "route" ? isSustainedDeviation(fixes, hit.plan.geometry) : false;
    entry = { at: now, plan: fresh, reroutedAt: left ? now : hit?.reroutedAt ?? null };
    cache.set(orderId, entry);
    // Keep the FIRST road route of this delivery for the owner's deviation report (best effort; never blocks the answer).
    if (fresh.source === "route") {
      db.livraison.updateMany({ where: { commandeId: orderId, routePlanifiee: { equals: Prisma.DbNull } }, data: { routePlanifiee: fresh.geometry as unknown as Prisma.InputJsonValue } }).catch(() => undefined);
    }
  }
  const { plan: p, reroutedAt } = entry!;

  const view: RouteView = {
    available: true,
    kind: p.source === "route" ? "road" : "estimate",
    ...(p.source === "route" ? {} : { fallbackReason: p.fallbackReason }),
    geometry: p.geometry,
    distanceMetres: p.distanceMetres,
    durationSeconds: p.durationSeconds,
    source: p.source,
    rerouted: reroutedAt !== null && now - reroutedAt < REROUTED_SHOWN_MS,
    updatedAt: new Date(entry!.at).toISOString(),
  };
  // Turn-by-turn directions exist only for a real road route, and only the delivery person and the owner read them.
  // For a straight-line estimate nothing is sent: there are no turns to give, and inventing some would mislead.
  if (actor.role !== UserRole.CLIENT && p.source === "route") {
    // The next manoeuvre is at the start of the second step; the first step's length is how far away it is.
    view.nextStep = p.steps.length > 1 ? { instruction: p.steps[1].instruction, distanceMetres: p.steps[0].distanceMetres } : p.steps[0] ?? null;
  }
  return view;
}

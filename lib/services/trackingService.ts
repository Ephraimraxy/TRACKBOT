import { CommandeStatut, PrismaClient, UserRole } from "@prisma/client";

import { OrderError, type StatusActor } from "@/lib/services/orderService";
import { STATUS_LABELS_EN, STATUS_LABELS_FR } from "@/lib/orders/workflow";
import { updateEtaAndReminders, type ProgressResult } from "@/lib/services/deliveryProgressService";
import type { Eta, LatLng } from "@/lib/services/etaService";

/** How many of the latest GPS points the customer's map draws as the route so far. */
export const TRAIL_POINTS = 120;

/** A phone should not report more often than this (protects the database). */
export const MIN_SECONDS_BETWEEN_POSITIONS = 2;

export interface LocationInput {
  latitude?: unknown;
  longitude?: unknown;
  accuracy?: unknown;
  /** When the phone captured this fix (ISO string, or milliseconds since 1970). Absent means "just now". */
  capturedAt?: unknown;
}

/** A fix older than this at the moment it reaches the server counts as history (it was queued offline). */
export const LATE_AFTER_SECONDS = 30;
/** Phone clocks drift: a capture time up to this far ahead of the server is accepted and treated as "now". */
export const CLOCK_SKEW_SECONDS = 60;
/** Points older than this are refused (a phone that was offline for a whole shift is not replayed). */
export const MAX_BACKFILL_HOURS = 6;
/** Most points accepted in one batch. */
export const MAX_BATCH = 200;
/** A fix whose accuracy is worse than this is kept for the record but never used to judge the route. */
export const UNUSABLE_ACCURACY_METRES = 150;

/** Reads a capture time; returns null when it is not a usable date. */
export function parseCapturedAt(value: unknown): Date | null {
  if (value === undefined || value === null) return null;
  const d = typeof value === "number" ? new Date(value) : typeof value === "string" ? new Date(value) : null;
  return d && Number.isFinite(d.getTime()) ? d : null;
}

function validCoordinate(value: unknown, limit: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit;
}

/**
 * Store a GPS point reported by a delivery person. Allowed only when:
 *  - the caller is a delivery person assigned to the order, and
 *  - the order is currently out for delivery (tracking is never active otherwise).
 *
 * A point carries the time the phone captured it. A fresh point is the current position and drives the estimate and
 * the customer's reminders. A point that arrives late (sent from the offline queue) is stored as history with its
 * original time: it fills in the trail, and never becomes the current position or moves the estimate.
 */
export async function recordDriverLocation(
  db: PrismaClient,
  params: { orderId: string; actor: StatusActor; location: LocationInput; now?: Date; estimate?: (from: LatLng, to: LatLng) => Promise<Eta> }
) {
  const result = await recordDriverLocations(db, { orderId: params.orderId, actor: params.actor, locations: [params.location], now: params.now, estimate: params.estimate });
  const only = result.results[0];
  if (only.status === "rejected") throw only.error;
  if (only.status === "duplicate") return { id: only.id, latitude: only.latitude, longitude: only.longitude, date: only.date, eta: null, backfilled: false, duplicate: true as const };
  return { id: only.id, latitude: only.latitude, longitude: only.longitude, date: only.date, eta: result.eta, backfilled: only.backfilled, duplicate: false as const };
}

export type PointResult =
  | { status: "saved"; id: string; latitude: number; longitude: number; date: Date; backfilled: boolean }
  | { status: "duplicate"; id: string; latitude: number; longitude: number; date: Date }
  | { status: "rejected"; error: OrderError };

/** Several points at once (a phone that was offline sends what it kept), processed oldest first. One bad point does not stop the others. */
export async function recordDriverLocations(
  db: PrismaClient,
  params: { orderId: string; actor: StatusActor; locations: LocationInput[]; now?: Date; estimate?: (from: LatLng, to: LatLng) => Promise<Eta> }
) {
  const { orderId, actor } = params;
  const now = params.now ?? new Date();

  if (actor.role !== UserRole.LIVREUR) throw new OrderError("FORBIDDEN", "Access denied.");
  if (params.locations.length === 0 || params.locations.length > MAX_BATCH) throw new OrderError("INVALID_LOCATION", `Send between 1 and ${MAX_BATCH} points.`);

  // Same answer for "not yours" and "does not exist".
  const livraison = await db.livraison.findUnique({
    where: { commandeId: orderId },
    select: { livreurId: true, commande: { select: { statut: true, historique: { where: { nouveauStatut: CommandeStatut.EN_LIVRAISON }, orderBy: { date: "desc" }, take: 1, select: { date: true } } } } },
  });
  if (!livraison || livraison.livreurId !== actor.id) {
    throw new OrderError("FORBIDDEN", "This order is not assigned to you.");
  }
  if (livraison.commande.statut !== CommandeStatut.EN_LIVRAISON) {
    throw new OrderError("TRACKING_INACTIVE", "Tracking is only active while the order is out for delivery.");
  }
  const startedAt = livraison.commande.historique[0]?.date ?? null;
  const oldest = new Date(now.getTime() - MAX_BACKFILL_HOURS * 3600_000);

  // Oldest first, so the trail and the "newest" bookkeeping are built in the order things really happened.
  const parsed = params.locations
    .map((l, index) => ({ l, index, at: parseCapturedAt(l.capturedAt) }))
    .sort((x, y) => (x.at?.getTime() ?? now.getTime()) - (y.at?.getTime() ?? now.getTime()) || x.index - y.index);

  const results: PointResult[] = new Array(params.locations.length);
  let newest = await db.positionLivraison.findFirst({ where: { commandeId: orderId }, orderBy: { date: "desc" }, select: { date: true } });
  let currentPoint: { latitude: number; longitude: number; at: Date } | null = null;

  for (const { l, index, at } of parsed) {
    const reject = (code: string, message: string) => (results[index] = { status: "rejected", error: new OrderError(code as never, message) });
    const { latitude, longitude, accuracy } = l;
    if (!validCoordinate(latitude, 90) || !validCoordinate(longitude, 180)) { reject("INVALID_LOCATION", "Invalid coordinates."); continue; }
    if (accuracy !== undefined && accuracy !== null && (typeof accuracy !== "number" || !Number.isFinite(accuracy) || accuracy < 0)) { reject("INVALID_LOCATION", "Invalid accuracy."); continue; }
    if (l.capturedAt !== undefined && l.capturedAt !== null && !at) { reject("INVALID_LOCATION", "Invalid capture time."); continue; }

    // A capture time a little in the future is clock drift: treat it as now. A long way ahead is wrong.
    let captured = at ?? now;
    if (captured.getTime() > now.getTime()) {
      if (captured.getTime() - now.getTime() > CLOCK_SKEW_SECONDS * 1000) { reject("INVALID_LOCATION", "Capture time is in the future."); continue; }
      captured = now;
    }
    if (at && captured < oldest) { reject("INVALID_LOCATION", "Capture time is too old."); continue; }
    if (at && startedAt && captured.getTime() < startedAt.getTime() - 5000) { reject("INVALID_LOCATION", "Capture time is before the delivery started."); continue; }

    const late = now.getTime() - captured.getTime() > LATE_AFTER_SECONDS * 1000;

    // The same fix sent twice (a retry after a timeout) is stored once.
    const twin = !at ? null : await db.positionLivraison.findFirst({
      where: { commandeId: orderId, date: { gte: new Date(captured.getTime() - 1000), lte: new Date(captured.getTime() + 1000) }, latitude: latitude as number, longitude: longitude as number },
      select: { id: true, latitude: true, longitude: true, date: true },
    });
    if (twin) { results[index] = { status: "duplicate", ...twin }; continue; }

    // A live point may not come faster than the limit. A late one is history and is not rate limited.
    if (!late && newest && captured.getTime() - newest.date.getTime() >= 0 && captured.getTime() - newest.date.getTime() < MIN_SECONDS_BETWEEN_POSITIONS * 1000) {
      reject("TOO_FREQUENT", "Position sent too often.");
      continue;
    }

    // Older than the newest point we already hold means it is history, however recent it is.
    const history = late || (newest !== null && captured.getTime() < newest.date.getTime());
    const saved = await db.positionLivraison.create({
      data: { commandeId: orderId, livreurId: actor.id, latitude: latitude as number, longitude: longitude as number, precision: (accuracy as number | null | undefined) ?? null, date: captured, receivedAt: now, backfilled: history },
      select: { id: true, latitude: true, longitude: true, date: true },
    });
    results[index] = { status: "saved", ...saved, backfilled: history };
    if (!history) {
      if (!newest || captured > newest.date) newest = { date: captured };
      currentPoint = { latitude: latitude as number, longitude: longitude as number, at: captured };
    }
  }

  // Distance and time left, and the customer's reminders, from the newest live point only. Never allowed to lose a position.
  let progress: ProgressResult | null = null;
  if (currentPoint) {
    try {
      progress = await updateEtaAndReminders(db, { orderId, position: { latitude: currentPoint.latitude, longitude: currentPoint.longitude }, now, estimate: params.estimate });
    } catch (error) {
      console.error("[tracking] could not update the ETA or reminders:", (error as Error).message);
    }
  }
  return { results, eta: progress?.eta ?? null };
}

/**
 * Everything a customer's tracking page needs: current status, timeline,
 * delivery person's first name, and the latest GPS point (only while the
 * order is out for delivery). Visible to the owning customer and the admin.
 */
export async function getTracking(
  db: PrismaClient,
  params: { orderId: string; actor: StatusActor }
) {
  const { orderId, actor } = params;

  const order = await db.commande.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      statut: true,
      clientId: true,
      adresse: { select: { rue: true, ville: true, wilaya: true, repere: true, latitude: true, longitude: true } },
      livraison: { select: { livreur: { select: { prenom: true } }, etaSecondes: true, distanceMetres: true, etaSource: true, etaMisAJour: true } },
      historique: {
        orderBy: { date: "asc" },
        select: { id: true, ancienStatut: true, nouveauStatut: true, note: true, date: true },
      },
    },
  });
  if (!order) throw new OrderError("ORDER_NOT_FOUND", "Order not found.");
  if (actor.role !== UserRole.ADMIN && order.clientId !== actor.id) {
    throw new OrderError("FORBIDDEN", "Access denied.");
  }

  const live = order.statut === CommandeStatut.EN_LIVRAISON;
  // After the delivery person says "delivered", the delivery stays open and the map keeps showing where they stopped,
  // until the customer confirms receipt. Once it is received, the position is no longer exposed.
  const awaitingConfirmation = order.statut === CommandeStatut.LIVREE;
  const open = live || awaitingConfirmation;
  // The latest points, oldest first, so the map can draw the route driven so far.
  const recent = open
    ? await db.positionLivraison.findMany({
        where: { commandeId: orderId },
        orderBy: { date: "desc" },
        take: TRAIL_POINTS,
        select: { latitude: true, longitude: true, precision: true, date: true },
      })
    : [];
  const trail = recent.reverse();
  const point = trail.length > 0 ? trail[trail.length - 1] : null;

  return {
    orderId: order.id,
    status: order.statut,
    statusLabel: STATUS_LABELS_EN[order.statut],
    statusLabelFr: STATUS_LABELS_FR[order.statut],
    destination: order.adresse,
    // Time and distance left, while the delivery person is on the road (needs the customer's pin).
    eta:
      live && order.livraison?.etaSecondes != null && order.livraison.distanceMetres != null && order.livraison.etaMisAJour
        ? { seconds: order.livraison.etaSecondes, metres: order.livraison.distanceMetres, source: order.livraison.etaSource === "estimate" ? ("estimate" as const) : ("route" as const), updatedAt: order.livraison.etaMisAJour }
        : null,
    driverFirstName: order.livraison?.livreur.prenom ?? null,
    trackingActive: live,
    awaitingConfirmation,
    mapOpen: open,
    location: point
      ? {
          latitude: point.latitude,
          longitude: point.longitude,
          accuracy: point.precision,
          updatedAt: point.date,
        }
      : null,
    trail: trail.map((p) => ({ latitude: p.latitude, longitude: p.longitude, at: p.date })),
    history: order.historique.map((h) => ({
      id: h.id,
      from: h.ancienStatut,
      to: h.nouveauStatut,
      // An entry that does not change the status (for example a payment) is shown by what happened, not by the status.
      label: h.ancienStatut === h.nouveauStatut && h.note ? h.note : STATUS_LABELS_EN[h.nouveauStatut],
      labelFr: STATUS_LABELS_FR[h.nouveauStatut],
      note: h.ancienStatut === h.nouveauStatut ? null : h.note,
      date: h.date,
    })),
  };
}

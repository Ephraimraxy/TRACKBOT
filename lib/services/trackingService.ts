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
}

function validCoordinate(value: unknown, limit: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit;
}

/**
 * Store a GPS point reported by a delivery person. Allowed only when:
 *  - the caller is a delivery person assigned to the order, and
 *  - the order is currently out for delivery (tracking is never active otherwise).
 */
export async function recordDriverLocation(
  db: PrismaClient,
  params: { orderId: string; actor: StatusActor; location: LocationInput; now?: Date; estimate?: (from: LatLng, to: LatLng) => Promise<Eta> }
) {
  const { orderId, actor, location } = params;
  const now = params.now ?? new Date();

  if (actor.role !== UserRole.LIVREUR) throw new OrderError("FORBIDDEN", "Access denied.");

  // Same answer for "not yours" and "does not exist".
  const livraison = await db.livraison.findUnique({
    where: { commandeId: orderId },
    select: { livreurId: true, commande: { select: { statut: true } } },
  });
  if (!livraison || livraison.livreurId !== actor.id) {
    throw new OrderError("FORBIDDEN", "This order is not assigned to you.");
  }
  if (livraison.commande.statut !== CommandeStatut.EN_LIVRAISON) {
    throw new OrderError(
      "TRACKING_INACTIVE",
      "Tracking is only active while the order is out for delivery."
    );
  }

  const { latitude, longitude, accuracy } = location;
  if (!validCoordinate(latitude, 90) || !validCoordinate(longitude, 180)) {
    throw new OrderError("INVALID_LOCATION", "Invalid coordinates.");
  }
  if (accuracy !== undefined && (typeof accuracy !== "number" || !Number.isFinite(accuracy) || accuracy < 0)) {
    throw new OrderError("INVALID_LOCATION", "Invalid accuracy.");
  }

  const last = await db.positionLivraison.findFirst({
    where: { commandeId: orderId },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  if (last && now.getTime() - last.date.getTime() < MIN_SECONDS_BETWEEN_POSITIONS * 1000) {
    throw new OrderError("TOO_FREQUENT", "Position sent too often.");
  }

  const saved = await db.positionLivraison.create({
    data: {
      commandeId: orderId,
      livreurId: actor.id,
      latitude,
      longitude,
      precision: accuracy ?? null,
      date: now,
    },
    select: { id: true, latitude: true, longitude: true, date: true },
  });

  // Distance and time left, and the customer's reminders. Never allowed to lose the position itself.
  let progress: ProgressResult | null = null;
  try {
    progress = await updateEtaAndReminders(db, { orderId, position: { latitude, longitude }, now, estimate: params.estimate });
  } catch (error) {
    console.error("[tracking] could not update the ETA or reminders:", (error as Error).message);
  }
  return { ...saved, eta: progress?.eta ?? null };
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

import { NotificationType, type PrismaClient } from "@prisma/client";

import { estimateRoute, formatDistance, formatMinutes, type Eta, type LatLng } from "@/lib/services/etaService";

/** The ETA is refreshed at most this often per delivery (the routing server is a shared free service). */
export const ETA_REFRESH_SECONDS = 12;
/** "Almost there" is sent once the delivery person is this close, or this many seconds away. */
export const NEAR_METRES = 500;
export const NEAR_SECONDS = 150;

export interface ProgressResult {
  eta: (Eta & { updatedAt: Date }) | null;
  sent: ("reminder" | "near")[];
}

/**
 * Called each time a delivery person's position arrives. It
 *  1. refreshes the distance and the time left (when the customer pinned their delivery spot),
 *  2. sends the customer the reminders they asked for: every N minutes ("about 12 min away"), and once
 *     "almost there". N is the customer's own setting (0 = no reminders).
 * Nothing here may stop a position from being saved, so the caller treats a failure as non-fatal.
 */
export async function updateEtaAndReminders(
  db: PrismaClient,
  params: {
    orderId: string;
    position: LatLng;
    now?: Date;
    /** Injectable so tests never call the real routing server. */
    estimate?: (from: LatLng, to: LatLng) => Promise<Eta>;
  }
): Promise<ProgressResult> {
  const { orderId, position } = params;
  const now = params.now ?? new Date();
  const estimate = params.estimate ?? estimateRoute;

  const delivery = await db.livraison.findUnique({
    where: { commandeId: orderId },
    select: {
      id: true,
      etaSecondes: true,
      distanceMetres: true,
      etaSource: true,
      etaMisAJour: true,
      dernierRappel: true,
      alerteProcheEnvoyee: true,
      livreur: { select: { prenom: true } },
      commande: {
        select: {
          clientId: true,
          adresse: { select: { latitude: true, longitude: true } },
          client: { select: { user: { select: { rappelLivraisonMinutes: true, alerteProche: true } } } },
        },
      },
    },
  });
  const destination = delivery?.commande.adresse;
  if (!delivery || destination?.latitude == null || destination.longitude == null) return { eta: null, sent: [] };

  // 1. the estimate: reuse a fresh one, otherwise ask again
  let eta: Eta & { updatedAt: Date };
  const fresh =
    delivery.etaMisAJour &&
    delivery.etaSecondes != null &&
    delivery.distanceMetres != null &&
    now.getTime() - delivery.etaMisAJour.getTime() < ETA_REFRESH_SECONDS * 1000;
  if (fresh) {
    eta = { durationSeconds: delivery.etaSecondes!, distanceMetres: delivery.distanceMetres!, source: delivery.etaSource === "estimate" ? "estimate" : "route", updatedAt: delivery.etaMisAJour! };
  } else {
    const computed = await estimate(position, { latitude: destination.latitude, longitude: destination.longitude });
    await db.livraison.update({
      where: { id: delivery.id },
      data: { etaSecondes: computed.durationSeconds, distanceMetres: computed.distanceMetres, etaSource: computed.source, etaMisAJour: now },
    });
    eta = { ...computed, updatedAt: now };
  }

  // 2. the customer's reminders
  const sent: ProgressResult["sent"] = [];
  const customerId = delivery.commande.clientId;
  const settings = delivery.commande.client?.user;
  if (!customerId || !settings) return { eta, sent };

  const driver = delivery.livreur.prenom;
  const link = `/client/orders/${orderId}/track`;
  const isNear = eta.distanceMetres <= NEAR_METRES || eta.durationSeconds <= NEAR_SECONDS;

  if (isNear && settings.alerteProche && !delivery.alerteProcheEnvoyee) {
    // Claim it first, so two positions arriving together cannot both send it.
    const claim = await db.livraison.updateMany({ where: { id: delivery.id, alerteProcheEnvoyee: false }, data: { alerteProcheEnvoyee: true, dernierRappel: now } });
    if (claim.count === 1) {
      await db.notification.create({
        data: {
          userId: customerId,
          type: NotificationType.LIVRAISON,
          objet: "Your delivery is almost here",
          text: `${driver} is about ${formatMinutes(eta.durationSeconds)} away (${formatDistance(eta.distanceMetres)}). Please be ready to receive your order.`,
          urlRedirection: link,
        },
      });
      sent.push("near");
    }
    return { eta, sent };
  }

  const minutes = settings.rappelLivraisonMinutes;
  if (minutes > 0 && !delivery.alerteProcheEnvoyee) {
    const due = !delivery.dernierRappel || now.getTime() - delivery.dernierRappel.getTime() >= minutes * 60_000;
    if (due) {
      const claim = await db.livraison.updateMany({ where: { id: delivery.id, dernierRappel: delivery.dernierRappel }, data: { dernierRappel: now } });
      if (claim.count === 1) {
        await db.notification.create({
          data: {
            userId: customerId,
            type: NotificationType.LIVRAISON,
            objet: "Your delivery is on its way",
            text: `${driver} is about ${formatMinutes(eta.durationSeconds)} away (${formatDistance(eta.distanceMetres)}). Tap to see where they are.`,
            urlRedirection: link,
          },
        });
        sent.push("reminder");
      }
    }
  }
  return { eta, sent };
}

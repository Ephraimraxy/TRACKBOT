import type { PrismaClient } from "@prisma/client";

import { getTracking } from "@/lib/services/trackingService";
import type { StatusActor } from "@/lib/services/orderService";

type Tracking = Awaited<ReturnType<typeof getTracking>>;

/**
 * Watches one order for a viewer and says when something changed: a new position, a new status, a new estimate.
 * The stream route calls `check()` every second or two. Looking for a change is one cheap query; the full
 * tracking answer (which the permission check lives in) is built only when there is something new to send.
 */
export function createTrackingWatcher(db: PrismaClient, params: { orderId: string; actor: StatusActor }) {
  const { orderId, actor } = params;
  let lastKey: string | null = null;

  const keyOf = async (): Promise<string | null> => {
    const order = await db.commande.findUnique({
      where: { id: orderId },
      select: {
        statut: true,
        livraison: { select: { etaMisAJour: true } },
        historique: { orderBy: { date: "desc" }, take: 1, select: { id: true } },
      },
    });
    if (!order) return null;
    const point = await db.positionLivraison.findFirst({ where: { commandeId: orderId }, orderBy: { date: "desc" }, select: { id: true } });
    return `${order.statut}|${order.historique[0]?.id ?? ""}|${point?.id ?? ""}|${order.livraison?.etaMisAJour?.getTime() ?? ""}`;
  };

  return {
    /** The full picture, now. Throws if this viewer may not see the order. */
    async initial(): Promise<Tracking> {
      const tracking = await getTracking(db, { orderId, actor });
      lastKey = await keyOf();
      return tracking;
    },
    /** The full picture if anything changed since the last call, otherwise null. */
    async check(): Promise<Tracking | null> {
      const key = await keyOf();
      if (key === null || key === lastKey) return null;
      const tracking = await getTracking(db, { orderId, actor });
      lastKey = key;
      return tracking;
    },
  };
}

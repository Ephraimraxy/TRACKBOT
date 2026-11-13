import {
  CommandeStatut,
  NotificationType,
  Prisma,
  PrismaClient,
  UserRole,
} from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

import { getOrderSelect } from "@/lib/helpers/orders";
import {
  canTransition,
  roleCanTransition,
  STATUS_LABELS_EN,
} from "@/lib/orders/workflow";

export type OrderErrorCode =
  | "PRODUCT_NOT_FOUND"
  | "INSUFFICIENT_STOCK"
  | "ORDER_NOT_FOUND"
  | "INVALID_TRANSITION"
  | "INVALID_DRIVER"
  | "NOT_ASSIGNABLE"
  | "INVALID_LOCATION"
  | "TRACKING_INACTIVE"
  | "TOO_FREQUENT"
  | "FORBIDDEN";

/**
 * Prisma's default interactive-transaction limit is 5 s, which a slow or remote
 * database can exceed under load (the transaction would then fail half-way and
 * roll back). Wait up to 10 s to start and allow 30 s to finish.
 */
export const TX_OPTIONS = { maxWait: 10_000, timeout: 30_000 } as const;

export class OrderError extends Error {
  constructor(
    public code: OrderErrorCode,
    message: string
  ) {
    super(message);
    this.name = "OrderError";
  }
}

export interface CreateOrderInput {
  userId: string;
  addresse: { rue: string; ville: string; wilaya: string; codePostal: string; latitude?: number; longitude?: number };
  produits: Array<{
    produitId: string;
    quantite: number;
    couleurId?: string;
    tailleId?: string;
  }>;
}

/**
 * Create an order atomically: stock check + decrement, address, order lines,
 * payment record and the first status-history entry all succeed or none do.
 * Prices always come from the database, never from the caller.
 */
export async function createOrder(db: PrismaClient, input: CreateOrderInput) {
  const { userId, addresse, produits } = input;

  return db.$transaction(async (tx) => {
    // Several lines may reference the same product: check stock on the sum.
    const wanted = new Map<string, number>();
    for (const line of produits) {
      wanted.set(line.produitId, (wanted.get(line.produitId) ?? 0) + line.quantite);
    }

    const products = await tx.produit.findMany({
      where: { id: { in: [...wanted.keys()] } },
      select: {
        id: true,
        nom: true,
        prix: true,
        images: { select: { imagePublicId: true }, take: 1 },
      },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    for (const id of wanted.keys()) {
      if (!byId.has(id)) {
        throw new OrderError("PRODUCT_NOT_FOUND", `Product ${id} not found.`);
      }
    }

    // Conditional decrement: succeeds only if enough stock remains, so two
    // concurrent orders can never drive stock below zero.
    for (const [id, qty] of wanted) {
      const res = await tx.produit.updateMany({
        where: { id, qteStock: { gte: qty } },
        data: { qteStock: { decrement: qty } },
      });
      if (res.count === 0) {
        throw new OrderError(
          "INSUFFICIENT_STOCK",
          `Not enough stock for “${byId.get(id)!.nom}”.`
        );
      }
    }

    let total = new Decimal(0);
    const lignesCommande = produits.map((line) => {
      const p = byId.get(line.produitId)!;
      total = total.add(p.prix.mul(line.quantite));
      return {
        nomProduit: p.nom,
        quantite: line.quantite,
        prixUnit: p.prix,
        imagePublicId: p.images[0]?.imagePublicId ?? null,
        produitId: p.id,
        couleurId: line.couleurId ?? null,
        tailleId: line.tailleId ?? null,
      };
    });

    const adresse = await tx.adresse.create({ data: addresse });

    const order = await tx.commande.create({
      data: {
        montant: total,
        clientId: userId,
        adresseId: adresse.id,
        lignesCommande: { create: lignesCommande },
        historique: {
          create: {
            ancienStatut: null,
            nouveauStatut: CommandeStatut.EN_COURS,
            modifieParId: userId,
            note: "Order created",
          },
        },
      },
      select: getOrderSelect(),
    });

    // The order starts as awaiting payment. It is marked paid only when Paystack confirms the money
    // arrived (see paymentService), never because the customer says so.
    const paiement = await tx.paiementCommande.create({
      data: { commandeId: order.id, statut: "EN_COURS" },
    });

    return { order, paiement };
  }, TX_OPTIONS);
}

export interface StatusActor {
  id: string;
  role: UserRole;
}

/**
 * Move an order to a new status. Enforces the lifecycle, the actor's role, and
 * writes the history entry in the same transaction. Cancelling returns the
 * reserved stock.
 *
 * `driverAssigned` must be true for a LIVREUR actor (checked by the caller
 * against the delivery assignment).
 */
export async function changeOrderStatus(
  db: PrismaClient,
  params: {
    orderId: string;
    to: CommandeStatut;
    actor: StatusActor;
    note?: string;
    driverAssigned?: boolean;
  }
) {
  const { orderId, to, actor, note, driverAssigned } = params;

  return db.$transaction(async (tx) => {
    const current = await tx.commande.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        statut: true,
        clientId: true,
        lignesCommande: { select: { produitId: true, quantite: true } },
      },
    });
    if (!current) throw new OrderError("ORDER_NOT_FOUND", "Order not found.");

    if (!canTransition(current.statut, to)) {
      throw new OrderError(
        "INVALID_TRANSITION",
        `Transition ${current.statut} -> ${to} is not allowed.`
      );
    }
    if (!roleCanTransition(actor.role, current.statut, to)) {
      throw new OrderError("FORBIDDEN", "You cannot perform this transition.");
    }
    if (actor.role === UserRole.LIVREUR && !driverAssigned) {
      throw new OrderError("FORBIDDEN", "This order is not assigned to you.");
    }

    // Guard against a concurrent change: only update if status is still what we read.
    const res = await tx.commande.updateMany({
      where: { id: orderId, statut: current.statut },
      data: { statut: to },
    });
    if (res.count === 0) {
      throw new OrderError("INVALID_TRANSITION", "The order was changed in the meantime.");
    }

    if (to === CommandeStatut.ANNULEE) {
      for (const line of current.lignesCommande) {
        if (line.produitId) {
          await tx.produit.update({
            where: { id: line.produitId },
            data: { qteStock: { increment: line.quantite } },
          });
        }
      }
    }

    await tx.historiqueStatutCommande.create({
      data: {
        commandeId: orderId,
        ancienStatut: current.statut,
        nouveauStatut: to,
        modifieParId: actor.id,
        note: note ?? null,
      },
    });

    // Tell the customer. Their tracking page reads the same history rows.
    if (current.clientId) {
      const delivering = to === CommandeStatut.EN_LIVRAISON || to === CommandeStatut.LIVREE;
      await tx.notification.create({
        data: {
          userId: current.clientId,
          type: delivering ? NotificationType.LIVRAISON : NotificationType.COMMANDE,
          objet: "Update on your order",
          text: `Your order is now: ${STATUS_LABELS_EN[to]}.`,
          urlRedirection: "/client/orders",
        },
      });
    }

    return tx.commande.findUniqueOrThrow({
      where: { id: orderId },
      select: getOrderSelect(),
    });
  }, TX_OPTIONS);
}

/**
 * Status timeline for an order. Only the business admin or the customer who
 * owns the order may read it.
 */
export async function getOrderHistory(
  db: PrismaClient | Prisma.TransactionClient,
  orderId: string,
  actor: StatusActor
) {
  const order = await db.commande.findUnique({
    where: { id: orderId },
    select: { id: true, clientId: true, statut: true },
  });
  if (!order) throw new OrderError("ORDER_NOT_FOUND", "Order not found.");

  if (actor.role !== UserRole.ADMIN && order.clientId !== actor.id) {
    throw new OrderError("FORBIDDEN", "Access denied.");
  }

  const entries = await db.historiqueStatutCommande.findMany({
    where: { commandeId: orderId },
    orderBy: { date: "asc" },
    select: {
      id: true,
      ancienStatut: true,
      nouveauStatut: true,
      note: true,
      date: true,
    },
  });

  return { orderId, currentStatus: order.statut, history: entries };
}

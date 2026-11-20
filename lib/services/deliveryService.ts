import { CommandeStatut, NotificationType, PrismaClient, UserRole } from "@prisma/client";

import {
  changeOrderStatus,
  OrderError,
  TX_OPTIONS,
  type StatusActor,
} from "@/lib/services/orderService";

/** Orders in these states may still be (re)assigned to a driver. */
const ASSIGNABLE: CommandeStatut[] = [
  CommandeStatut.EN_COURS,
  CommandeStatut.EN_PREPARATION,
  CommandeStatut.EXPEDIEE,
];

/** Admin lists the delivery staff they can choose from. */
export async function listDrivers(db: PrismaClient, actor: StatusActor) {
  if (actor.role !== UserRole.ADMIN) throw new OrderError("FORBIDDEN", "Access denied.");
  return db.user.findMany({
    where: { role: UserRole.LIVREUR },
    orderBy: { nom: "asc" },
    select: { id: true, nom: true, prenom: true, tel: true, email: true },
  });
}

/** Admin: recent orders that are being, or can still be, assigned to a driver. */
export async function listDeliveryBoard(db: PrismaClient, actor: StatusActor) {
  if (actor.role !== UserRole.ADMIN) throw new OrderError("FORBIDDEN", "Access denied.");
  return db.commande.findMany({
    // Delivered orders stay on the board until the customer confirms receipt.
    where: { statut: { in: [...ASSIGNABLE, CommandeStatut.EN_LIVRAISON, CommandeStatut.LIVREE] } },
    orderBy: { date: "desc" },
    take: 100,
    select: {
      id: true,
      date: true,
      statut: true,
      montant: true,
      adresse: { select: { ville: true, wilaya: true } },
      client: { select: { user: { select: { nom: true, prenom: true } } } },
      paiement: { select: { statut: true } },
      livraison: {
        select: { livreur: { select: { id: true, nom: true, prenom: true } } },
      },
    },
  });
}

/**
 * Assign (or reassign) an order to a delivery person. Admin only. The driver
 * must exist and have the LIVREUR role, and the order must not already be out
 * for delivery, delivered or cancelled.
 */
export async function assignDriver(
  db: PrismaClient,
  params: { orderId: string; driverId: string; actor: StatusActor }
) {
  const { orderId, driverId, actor } = params;
  if (actor.role !== UserRole.ADMIN) {
    throw new OrderError("FORBIDDEN", "Only the administrator can assign a delivery.");
  }

  return db.$transaction(async (tx) => {
    const order = await tx.commande.findUnique({
      where: { id: orderId },
      select: { id: true, statut: true },
    });
    if (!order) throw new OrderError("ORDER_NOT_FOUND", "Order not found.");

    if (!ASSIGNABLE.includes(order.statut)) {
      throw new OrderError(
        "NOT_ASSIGNABLE",
        "This order can no longer be assigned (out for delivery, delivered or cancelled)."
      );
    }

    const driver = await tx.user.findUnique({
      where: { id: driverId },
      select: { id: true, role: true },
    });
    if (!driver || driver.role !== UserRole.LIVREUR) {
      throw new OrderError("INVALID_DRIVER", "Invalid delivery person.");
    }

    const livraison = await tx.livraison.upsert({
      where: { commandeId: orderId },
      create: { commandeId: orderId, livreurId: driverId, assigneParId: actor.id },
      update: { livreurId: driverId, assigneParId: actor.id, dateAssignation: new Date() },
    });

    await tx.notification.create({
      data: {
        userId: driverId,
        type: NotificationType.LIVRAISON,
        objet: "New delivery assigned",
        text: "An order has been assigned to you. Open your deliveries for the details.",
        urlRedirection: "/driver/deliveries",
      },
    });

    return livraison;
  }, TX_OPTIONS);
}

/**
 * The driver's own deliveries only. Customer name, phone and address are
 * included because the driver needs them to deliver, but only for orders
 * assigned to that driver.
 */
export async function listDriverDeliveries(db: PrismaClient, actor: StatusActor) {
  if (actor.role !== UserRole.LIVREUR) throw new OrderError("FORBIDDEN", "Access denied.");

  const rows = await db.livraison.findMany({
    where: { livreurId: actor.id, commande: { statut: { not: CommandeStatut.ANNULEE } } },
    orderBy: { dateAssignation: "desc" },
    select: {
      id: true,
      dateAssignation: true,
      etaSecondes: true,
      distanceMetres: true,
      etaSource: true,
      etaMisAJour: true,
      commande: {
        select: {
          id: true,
          statut: true,
          montant: true,
          adresse: { select: { rue: true, ville: true, wilaya: true, codePostal: true, repere: true, latitude: true, longitude: true } },
          client: { select: { user: { select: { nom: true, prenom: true, tel: true } } } },
          lignesCommande: { select: { nomProduit: true, quantite: true } },
        },
      },
    },
  });

  // Active deliveries first, finished ones after.
  const rank = (s: CommandeStatut) => (s === CommandeStatut.LIVREE || s === CommandeStatut.RECUE ? 1 : 0);
  return rows.sort((a, b) => rank(a.commande.statut) - rank(b.commande.statut));
}

/**
 * Delivery person advances an order they are assigned to. Only the two
 * delivery steps are allowed (enforced by the workflow rules). An order that
 * is not assigned to this driver is reported as forbidden, never as missing.
 */
export async function driverChangeStatus(
  db: PrismaClient,
  params: { orderId: string; to: CommandeStatut; actor: StatusActor; note?: string }
) {
  const { orderId, to, actor, note } = params;
  if (actor.role !== UserRole.LIVREUR) throw new OrderError("FORBIDDEN", "Access denied.");

  const livraison = await db.livraison.findUnique({
    where: { commandeId: orderId },
    select: { livreurId: true },
  });
  const assigned = livraison?.livreurId === actor.id;
  if (!assigned) throw new OrderError("FORBIDDEN", "This order is not assigned to you.");

  return changeOrderStatus(db, { orderId, to, actor, note, driverAssigned: true });
}

// ---- Delivery staff accounts (managed by the admin) -------------------------------------------

export class DriverError extends Error {
  constructor(
    public code: "EMAIL_TAKEN" | "DRIVER_NOT_FOUND" | "HAS_ACTIVE_DELIVERIES",
    message: string
  ) {
    super(message);
    this.name = "DriverError";
  }
}

/**
 * Admin registers a delivery person. The admin chooses a starting password and hands it over; the
 * person signs in at the normal login page and is taken to their deliveries. The email counts as
 * verified because the shop owner is the one vouching for it. The administrator's own email can never
 * be used, and nobody can take over an existing account this way.
 */
export async function createDriver(
  db: PrismaClient,
  actor: StatusActor,
  input: { prenom: string; nom: string; email: string; tel?: string; password: string },
  hash: (plain: string) => Promise<string>,
  adminEmail: string | undefined = process.env.ADMIN_EMAIL
) {
  if (actor.role !== UserRole.ADMIN) throw new OrderError("FORBIDDEN", "Access denied.");

  const email = input.email.toLowerCase();
  const reserved = adminEmail?.trim().toLowerCase() === email;
  if (reserved || (await db.user.findUnique({ where: { email }, select: { id: true } }))) {
    throw new DriverError("EMAIL_TAKEN", "This email address is already in use.");
  }

  return db.user.create({
    data: {
      email,
      password: await hash(input.password),
      prenom: input.prenom,
      nom: input.nom,
      tel: input.tel ?? null,
      role: UserRole.LIVREUR,
      emailVerifie: true,
    },
    select: { id: true, nom: true, prenom: true, tel: true, email: true },
  });
}

/**
 * Admin removes someone from the delivery team. Not allowed while they have an order that is not yet
 * delivered or cancelled. A person with no delivery history is deleted; one who has delivered before
 * keeps their records and becomes an ordinary customer account, so no past order loses its driver.
 */
export async function removeDriver(db: PrismaClient, actor: StatusActor, driverId: string) {
  if (actor.role !== UserRole.ADMIN) throw new OrderError("FORBIDDEN", "Access denied.");

  const driver = await db.user.findUnique({ where: { id: driverId }, select: { id: true, role: true } });
  if (!driver || driver.role !== UserRole.LIVREUR) throw new DriverError("DRIVER_NOT_FOUND", "Delivery person not found.");

  const open = await db.livraison.count({
    where: { livreurId: driverId, commande: { statut: { notIn: [CommandeStatut.LIVREE, CommandeStatut.ANNULEE] } } },
  });
  if (open > 0) {
    throw new DriverError("HAS_ACTIVE_DELIVERIES", "This person still has orders to deliver. Reassign them first.");
  }

  const history = await db.livraison.count({ where: { livreurId: driverId } });
  if (history === 0) {
    await db.user.delete({ where: { id: driverId } });
    return { removed: "deleted" as const };
  }
  await db.$transaction([
    db.user.update({ where: { id: driverId }, data: { role: UserRole.CLIENT } }),
    db.client.upsert({ where: { id: driverId }, update: {}, create: { id: driverId } }),
  ]);
  return { removed: "demoted" as const };
}

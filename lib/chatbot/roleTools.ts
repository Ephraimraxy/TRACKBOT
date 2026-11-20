import { CommandeStatut, PaiementStatut, Prisma, PrismaClient, UserRole } from "@prisma/client";
import { z } from "zod";

import type { ChatContext, ToolSpec } from "@/lib/chatbot/types";
import { STATUS_LABELS_EN } from "@/lib/orders/workflow";
import { listDriverDeliveries } from "@/lib/services/deliveryService";
import { getDeliveryReport } from "@/lib/services/deliveryReportService";
import { listPaymentIssues } from "@/lib/services/paymentService";
import { OrderError } from "@/lib/services/orderService";

/**
 * Tools for the shop owner (system-wide view) and for delivery people (their own assignments).
 * Same rules as the customer tools: read-only, the role comes from the server session, results are small.
 * A customer can never reach these: each one checks the role again before it reads anything.
 */

type ToolOutput = Record<string, unknown>;

const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));
const shortRef = (id: string) => id.slice(-8);
const minutes = (s: number | null) => (s == null ? null : Math.max(1, Math.round(s / 60)));
const km = (m: number | null) => (m == null ? null : Math.round(m / 100) / 10);

/** "road_route" or "straight_line_estimate" (only a straight line was available), or null when there is no estimate. */
const timeLeftKind = (seconds: number | null | undefined, source: string | null | undefined) =>
  seconds == null ? null : source === "estimate" ? "straight_line_estimate" : "road_route";

const PAYMENT_LABEL: Record<PaiementStatut, string> = {
  [PaiementStatut.VALIDE]: "Paid",
  [PaiementStatut.EN_COURS]: "Awaiting payment",
  [PaiementStatut.ECHOUE]: "Payment failed",
};

/** What should happen next, in words the shop owner can act on. */
export const NEXT_STEP_EN: Record<CommandeStatut, string> = {
  [CommandeStatut.EN_COURS]: "The shop should confirm the order and start preparing it (mark it Processing).",
  [CommandeStatut.EN_PREPARATION]: "The shop should finish packing and mark it Shipped, then assign a delivery person.",
  [CommandeStatut.EXPEDIEE]: "The assigned delivery person can now tap Start delivery. That begins the live map for the customer.",
  [CommandeStatut.EN_LIVRAISON]: "The delivery person is on the way and sharing their live location.",
  [CommandeStatut.LIVREE]: "The delivery person says it was delivered. It stays open until the customer taps \"I received it\"; the owner can close it if the customer does not.",
  [CommandeStatut.RECUE]: "Nothing more to do. The customer confirmed receipt and the delivery is closed.",
  [CommandeStatut.ANNULEE]: "The order was cancelled.",
};

const ACTIVE: CommandeStatut[] = [
  CommandeStatut.EN_COURS,
  CommandeStatut.EN_PREPARATION,
  CommandeStatut.EXPEDIEE,
  CommandeStatut.EN_LIVRAISON,
];

export const ADMIN_TOOL_SPECS: ToolSpec[] = [
  {
    name: "shop_overview",
    description:
      "Shop owner only. A snapshot of the whole business: orders by status, unpaid orders, orders waiting for a delivery person, money received, customers, delivery team and low-stock products. Use it for any general question about how the shop or the deliveries are doing.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "list_deliveries",
    description:
      "Shop owner only. Orders in the delivery pipeline (Pending, Processing, Shipped, Out for delivery) with customer first name, city, payment status, assigned delivery person and live time left. Optionally filter by status.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["pending", "processing", "shipped", "out_for_delivery", "delivered", "received", "cancelled"] },
        limit: { type: "integer", description: "1-10, default 8" },
      },
    },
  },
  {
    name: "find_order",
    description:
      "Shop owner only. Full detail of any one order by its 8-character reference: items, total, payment, address, delivery person, live time left and what should happen next.",
    parameters: {
      type: "object",
      properties: { reference: { type: "string", description: "Order reference, e.g. 'a1b2c3d4'" } },
      required: ["reference"],
    },
  },
  {
    name: "delivery_report",
    description:
      "Shop owner only. How one delivery actually went, from its recorded GPS: time on the road, distance driven, average speed, number of GPS points, stops, signal gaps, whether the delivery person left the planned road, and plain-language findings. Use it for questions like 'how did delivery a1b2c3d4 go?', 'was there a GPS problem?' or 'did the driver take a detour?'. The full replay is on the Deliveries page (Replay the route).",
    parameters: {
      type: "object",
      properties: { reference: { type: "string", description: "Order reference, e.g. 'a1b2c3d4'" } },
      required: ["reference"],
    },
  },
  {
    name: "payment_issues",
    description:
      "Shop owner only. Payments that need the owner's attention: a wrong amount (overpayment or underpayment), a customer who paid twice, a dispute (chargeback) or a refund, with the order, the amounts and what to do. Use it for questions about payment problems, refunds, disputes or why an order is not marked paid. Refunds and dispute answers are done in the Paystack dashboard; the owner marks items resolved on the Payments to look at page.",
    parameters: { type: "object", properties: { status: { type: "string", enum: ["open", "resolved"], description: "default open" } } },
  },
  {
    name: "list_delivery_team",
    description: "Shop owner only. The delivery people with how many deliveries each has in progress.",
    parameters: { type: "object", properties: {} },
  },
];

export const DRIVER_TOOL_SPECS: ToolSpec[] = [
  {
    name: "my_deliveries",
    description:
      "Delivery person only. The deliveries assigned to the logged-in delivery person: status, the customer's address and the live time left. Use it for questions about their own work and what to do next.",
    parameters: { type: "object", properties: {} },
  },
];

export const ROLE_TOOL_NAMES = new Set([...ADMIN_TOOL_SPECS, ...DRIVER_TOOL_SPECS].map((t) => t.name));

const STATUS_ARG: Record<string, CommandeStatut> = {
  pending: CommandeStatut.EN_COURS,
  processing: CommandeStatut.EN_PREPARATION,
  shipped: CommandeStatut.EXPEDIEE,
  out_for_delivery: CommandeStatut.EN_LIVRAISON,
  delivered: CommandeStatut.LIVREE,
  received: CommandeStatut.RECUE,
  cancelled: CommandeStatut.ANNULEE,
};

const listArgs = z.object({
  status: z.enum(["pending", "processing", "shipped", "out_for_delivery", "delivered", "received", "cancelled"]).optional(),
  limit: z.number().int().min(1).max(10).optional(),
});
const findArgs = z.object({ reference: z.string().trim().min(3).max(30) });

const adminOnly = (ctx: ChatContext): ToolOutput | null =>
  !ctx.userId ? { error: "LOGIN_REQUIRED" } : ctx.role !== UserRole.ADMIN ? { error: "ADMIN_ONLY" } : null;

export async function shopOverview(db: PrismaClient, ctx: ChatContext): Promise<ToolOutput> {
  const denied = adminOnly(ctx);
  if (denied) return denied;

  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const [byStatus, unpaid, waiting, received, receivedWeek, customers, drivers, products, lowCount, lowStock] = await Promise.all([
    db.commande.groupBy({ by: ["statut"], _count: { _all: true } }),
    db.commande.count({ where: { statut: { in: ACTIVE }, NOT: { paiement: { statut: PaiementStatut.VALIDE } } } }),
    db.commande.count({ where: { statut: CommandeStatut.EXPEDIEE, livraison: null } }),
    db.commande.aggregate({ where: { paiement: { statut: PaiementStatut.VALIDE } }, _sum: { montant: true }, _count: { _all: true } }),
    db.commande.aggregate({ where: { paiement: { statut: PaiementStatut.VALIDE, datePaiement: { gte: weekAgo } } }, _sum: { montant: true } }),
    db.user.count({ where: { role: UserRole.CLIENT } }),
    db.user.count({ where: { role: UserRole.LIVREUR } }),
    db.produit.count(),
    db.produit.count({ where: { qteStock: { lte: 5 } } }),
    db.produit.findMany({ where: { qteStock: { lte: 5 } }, orderBy: { qteStock: "asc" }, take: 5, select: { nom: true, qteStock: true } }),
  ]);

  const counts: Record<string, number> = {};
  for (const row of byStatus) counts[STATUS_LABELS_EN[row.statut]] = row._count._all;

  return {
    currency: "NGN",
    ordersByStatus: counts,
    activeUnpaidOrders: unpaid,
    shippedWaitingForDeliveryPerson: waiting,
    paidOrders: received._count._all,
    moneyReceivedTotal: num(received._sum.montant),
    moneyReceivedLast7Days: num(receivedWeek._sum.montant),
    customers,
    deliveryPeople: drivers,
    products,
    lowStockCount: lowCount,
    lowStockProducts: lowStock.map((p) => ({ name: p.nom, stock: p.qteStock })),
  };
}

const orderSelect = {
  id: true,
  date: true,
  statut: true,
  montant: true,
  adresse: { select: { rue: true, ville: true, wilaya: true, latitude: true, longitude: true } },
  client: { select: { user: { select: { prenom: true, nom: true, tel: true } } } },
  paiement: { select: { statut: true, canal: true } },
  livraison: { select: { etaSecondes: true, distanceMetres: true, etaSource: true, etaMisAJour: true, livreur: { select: { prenom: true, nom: true } } } },
  lignesCommande: { select: { nomProduit: true, quantite: true } },
} satisfies Prisma.CommandeSelect;

type OrderRow = Prisma.CommandeGetPayload<{ select: typeof orderSelect }>;

function summarize(o: OrderRow, detailed = false): ToolOutput {
  const out: ToolOutput = {
    reference: shortRef(o.id),
    status: STATUS_LABELS_EN[o.statut],
    customerFirstName: o.client?.user.prenom ?? null,
    city: o.adresse?.ville ?? null,
    payment: o.paiement ? PAYMENT_LABEL[o.paiement.statut] : "No payment started",
    deliveryPerson: o.livraison ? `${o.livraison.livreur.prenom} ${o.livraison.livreur.nom}` : null,
    minutesLeft: minutes(o.livraison?.etaSecondes ?? null),
    kmLeft: km(o.livraison?.distanceMetres ?? null),
    timeLeftKind: timeLeftKind(o.livraison?.etaSecondes, o.livraison?.etaSource),
    nextStep: NEXT_STEP_EN[o.statut],
  };
  if (detailed) {
    Object.assign(out, {
      total: num(o.montant),
      date: o.date.toISOString().slice(0, 10),
      customerName: o.client ? `${o.client.user.prenom} ${o.client.user.nom}` : null,
      customerPhone: o.client?.user.tel ?? null,
      address: o.adresse ? `${o.adresse.rue}, ${o.adresse.ville}, ${o.adresse.wilaya}` : null,
      customerPinnedOnMap: o.adresse?.latitude != null && o.adresse.longitude != null,
      paymentChannel: o.paiement?.canal ?? null,
      items: o.lignesCommande.map((l) => ({ name: l.nomProduit, quantity: l.quantite })),
    });
  }
  return out;
}

export async function listDeliveries(db: PrismaClient, ctx: ChatContext, raw: unknown): Promise<ToolOutput> {
  const denied = adminOnly(ctx);
  if (denied) return denied;
  const { status, limit } = listArgs.parse(raw);

  const rows = await db.commande.findMany({
    where: { statut: status ? STATUS_ARG[status] : { in: ACTIVE } },
    orderBy: { date: "desc" },
    take: limit ?? 8,
    select: orderSelect,
  });
  return { orders: rows.map((o) => summarize(o)) };
}

export async function findOrder(db: PrismaClient, ctx: ChatContext, raw: unknown): Promise<ToolOutput> {
  const denied = adminOnly(ctx);
  if (denied) return denied;
  const { reference } = findArgs.parse(raw);

  const rows = await db.commande.findMany({
    where: { id: { endsWith: reference.replace(/^#/, "") } },
    take: 2,
    select: orderSelect,
  });
  if (rows.length === 0) return { error: "ORDER_NOT_FOUND" };
  if (rows.length > 1) return { error: "AMBIGUOUS_REFERENCE" };
  return { order: summarize(rows[0], true) };
}

export async function deliveryReport(db: PrismaClient, ctx: ChatContext, raw: unknown): Promise<ToolOutput> {
  const denied = adminOnly(ctx);
  if (denied) return denied;
  const { reference } = findArgs.parse(raw);

  const rows = await db.commande.findMany({ where: { id: { endsWith: reference.replace(/^#/, "") } }, take: 2, select: { id: true } });
  if (rows.length === 0) return { error: "ORDER_NOT_FOUND" };
  if (rows.length > 1) return { error: "AMBIGUOUS_REFERENCE" };

  try {
    // The same owner-only report as the replay page, read through the same permission check.
    const r = await getDeliveryReport(db, { orderId: rows[0].id, actor: { id: ctx.userId!, role: UserRole.ADMIN } });
    const a = r.analysis;
    return {
      reference: shortRef(r.orderId),
      status: STATUS_LABELS_EN[r.status],
      deliveryPerson: r.driver.name,
      minutesOnTheRoad: a.points > 1 ? Math.round(a.durationSeconds / 60) : null,
      kmDriven: a.points > 1 ? Math.round(a.distanceMetres / 100) / 10 : null,
      averageSpeedKmh: a.averageSpeedKmh,
      gpsPoints: a.points,
      stops: a.stops.length,
      signalGaps: a.gaps.length,
      longestSignalGapSeconds: a.gps.longestGapSeconds,
      latePointsSentAfterSignalReturned: a.gps.backfilledPoints,
      leftThePlannedRoad: a.deviations === null ? "unknown (no road route was kept for this delivery)" : a.deviations.length,
      findings: r.findings.map((f) => f.text),
      replayPage: `/admin/deliveries/${r.orderId}/replay`,
    };
  } catch (e) {
    if (e instanceof OrderError) return { error: e.code };
    throw e;
  }
}

export async function paymentIssues(db: PrismaClient, ctx: ChatContext, raw: unknown): Promise<ToolOutput> {
  const denied = adminOnly(ctx);
  if (denied) return denied;
  const { status } = z.object({ status: z.enum(["open", "resolved"]).optional() }).parse(raw ?? {});
  const rows = await listPaymentIssues(db, { actor: { id: ctx.userId!, role: UserRole.ADMIN }, status: status ?? "open", limit: 10 });
  const kobo = (k: number | null) => (k == null ? null : k / 100);
  return {
    count: rows.length,
    issues: rows.map((r) => ({
      kind: { AMOUNT_MISMATCH: "wrong amount", DOUBLE_PAYMENT: "paid twice", DISPUTE: "dispute", REFUND: "refund" }[r.kind],
      status: r.status === "OPEN" ? "open" : "resolved",
      orderReference: r.orderRef,
      customer: r.customer,
      amountPaid: kobo(r.amountPaidKobo),
      orderTotal: kobo(r.expectedKobo),
      what: r.note,
      page: "/admin/payment-issues",
    })),
  };
}

export async function listDeliveryTeam(db: PrismaClient, ctx: ChatContext): Promise<ToolOutput> {
  const denied = adminOnly(ctx);
  if (denied) return denied;

  const drivers = await db.user.findMany({
    where: { role: UserRole.LIVREUR },
    orderBy: { prenom: "asc" },
    take: 30,
    select: {
      prenom: true,
      nom: true,
      livraisons: {
        where: { commande: { statut: { in: [CommandeStatut.EXPEDIEE, CommandeStatut.EN_LIVRAISON] } } },
        select: { commande: { select: { statut: true } } },
      },
    },
  });
  return {
    deliveryPeople: drivers.map((d) => ({
      name: `${d.prenom} ${d.nom}`,
      waitingToStart: d.livraisons.filter((l) => l.commande.statut === CommandeStatut.EXPEDIEE).length,
      onTheRoad: d.livraisons.filter((l) => l.commande.statut === CommandeStatut.EN_LIVRAISON).length,
    })),
  };
}

export async function myDeliveries(db: PrismaClient, ctx: ChatContext): Promise<ToolOutput> {
  if (!ctx.userId) return { error: "LOGIN_REQUIRED" };
  if (ctx.role !== UserRole.LIVREUR) return { error: "DELIVERY_PEOPLE_ONLY" };

  const rows = await listDriverDeliveries(db, { id: ctx.userId, role: UserRole.LIVREUR });
  return {
    deliveries: rows.slice(0, 8).map((d) => ({
      reference: shortRef(d.commande.id),
      status: STATUS_LABELS_EN[d.commande.statut],
      customerFirstName: d.commande.client?.user.prenom ?? null,
      address: d.commande.adresse ? `${d.commande.adresse.rue}, ${d.commande.adresse.ville}, ${d.commande.adresse.wilaya}` : null,
      customerPinnedOnMap: d.commande.adresse?.latitude != null && d.commande.adresse.longitude != null,
      minutesLeft: minutes(d.etaSecondes),
      kmLeft: km(d.distanceMetres),
      timeLeftKind: timeLeftKind(d.etaSecondes, d.etaSource),
      nextStep: NEXT_STEP_EN[d.commande.statut],
    })),
  };
}

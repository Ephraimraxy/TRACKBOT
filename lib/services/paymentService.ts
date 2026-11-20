import { randomBytes } from "node:crypto";
import { CommandeStatut, NotificationType, PaiementStatut, PaymentIssueKind, PaymentIssueStatus, Prisma, UserRole, type PrismaClient } from "@prisma/client";

import { PaymentError, toTransaction, verifyWebhookSignature, type PaystackClient, type PaystackTransaction } from "@/lib/payments/paystack";
import { notifyAdmins, OrderError, TX_OPTIONS, type StatusActor } from "@/lib/services/orderService";

/** Naira to kobo, the unit Paystack counts in. Always computed from the stored order total. */
export const toKobo = (naira: { toString(): string } | number) => Math.round(Number(naira.toString()) * 100);

export type PaymentOutcome =
  | { status: "paid"; alreadyPaid: boolean; orderId: string }
  | { status: "failed"; orderId: string }
  | { status: "pending"; orderId: string }
  /** Paystack says paid, but the amount or currency is not what this order costs. Nothing is marked paid. */
  | { status: "mismatch"; orderId: string };

const shortId = (id: string) => id.slice(-8);
const naira = (kobo: number) => `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: kobo % 100 === 0 ? 0 : 2 })}`;

/**
 * Record a payment the owner must look at, once per (reference, kind), and tell the owners. A repeated webhook finds the
 * row already there and does nothing. Returns true when this call created it.
 * `info` rows (a refund that already happened) are stored as resolved and only announced.
 */
async function recordIssue(
  db: PrismaClient,
  args: { orderId: string; kind: PaymentIssueKind; reference: string; paidKobo?: number; expectedKobo?: number; currency?: string; note: string; info?: boolean; customerText?: string }
): Promise<boolean> {
  try {
    await db.paymentIssue.create({
      data: {
        commandeId: args.orderId,
        kind: args.kind,
        reference: args.reference,
        amountPaidKobo: args.paidKobo ?? null,
        expectedKobo: args.expectedKobo ?? null,
        currency: args.currency ?? null,
        note: args.note.slice(0, 500),
        status: args.info ? PaymentIssueStatus.RESOLVED : PaymentIssueStatus.OPEN,
        dateResolution: args.info ? new Date() : null,
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false; // already recorded
    throw e;
  }
  await notifyAdmins(db, {
    type: NotificationType.PAIEMENT,
    objet: args.info ? "Payment update" : "Payment needs review",
    text: `Order #${shortId(args.orderId)}: ${args.note}`.slice(0, 1000),
    url: "/admin/payment-issues",
  });
  if (args.customerText) {
    const order = await db.commande.findUnique({ where: { id: args.orderId }, select: { clientId: true } });
    if (order?.clientId) {
      await db.notification.create({ data: { userId: order.clientId, type: NotificationType.PAIEMENT, objet: "About your payment", text: args.customerText.slice(0, 1000), urlRedirection: "/client/orders" } });
    }
  }
  return true;
}

/**
 * Start paying for an order. The amount comes from the database, never from the browser, and only the
 * order's owner can do it. Returns the Paystack page to send the customer to.
 */
export async function initializePayment(
  db: PrismaClient,
  client: PaystackClient,
  args: { orderId: string; userId: string; email: string; callbackUrl: string }
): Promise<{ authorizationUrl: string; reference: string }> {
  const order = await db.commande.findUnique({ where: { id: args.orderId }, include: { paiement: true } });
  if (!order || order.clientId !== args.userId) throw new PaymentError("ORDER_NOT_FOUND", "Order not found.");
  if (order.statut === CommandeStatut.ANNULEE) throw new PaymentError("ORDER_CANCELLED", "This order was cancelled.");
  if (order.paiement?.statut === PaiementStatut.VALIDE) throw new PaymentError("ALREADY_PAID", "This order is already paid.");

  // A fresh reference for every attempt, so a retry never collides with an abandoned one.
  const reference = `TB-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;

  // Save the reference first, so the confirmation can always find the order, even if the
  // customer's browser never comes back from Paystack.
  await db.paiementCommande.upsert({
    where: { commandeId: order.id },
    update: { reference, statut: PaiementStatut.EN_COURS },
    create: { commandeId: order.id, reference, statut: PaiementStatut.EN_COURS },
  });

  return client.initialize({
    email: args.email,
    amountKobo: toKobo(order.montant),
    reference,
    callbackUrl: args.callbackUrl,
    metadata: { orderId: order.id, orderRef: shortId(order.id) },
  });
}

/**
 * Apply what Paystack says about a transaction to the order. Safe to call any number of times, from
 * the customer's return page and from the webhook: the order is marked paid once, the customer is
 * told once.
 */
async function applyTransaction(
  db: PrismaClient,
  paymentId: string,
  tx: PaystackTransaction
): Promise<PaymentOutcome> {
  const payment = await db.paiementCommande.findUniqueOrThrow({ where: { id: paymentId }, include: { commande: true } });
  const order = payment.commande;

  if (payment.statut === PaiementStatut.VALIDE) {
    // The order is already paid. A DIFFERENT successful transaction for it means the customer paid twice.
    if (tx.status === "success" && tx.reference && tx.reference !== payment.reference) {
      await recordIssue(db, {
        orderId: order.id,
        kind: PaymentIssueKind.DOUBLE_PAYMENT,
        reference: tx.reference,
        paidKobo: tx.amount,
        expectedKobo: toKobo(order.montant),
        currency: tx.currency,
        note: `A second payment of ${naira(tx.amount)} (reference ${tx.reference}) was received for an order that was already paid. Refund it in Paystack, then resolve this.`,
        customerText: `We received a second payment for order #${shortId(order.id)}, which was already paid. The shop will refund it.`,
      });
    }
    return { status: "paid", alreadyPaid: true, orderId: order.id };
  }

  if (tx.status === "success") {
    if (tx.currency !== "NGN" || tx.amount !== toKobo(order.montant)) {
      const expected = toKobo(order.montant);
      console.error(`[payment] amount mismatch for order ${order.id}: paid ${tx.amount} ${tx.currency}, expected ${expected} NGN`);
      const kind = tx.currency !== "NGN" ? "in " + (tx.currency || "an unknown currency") + " instead of NGN" : tx.amount > expected ? "an OVERPAYMENT" : "an UNDERPAYMENT";
      await recordIssue(db, {
        orderId: order.id,
        kind: PaymentIssueKind.AMOUNT_MISMATCH,
        reference: tx.reference || payment.reference || `order-${order.id}`,
        paidKobo: tx.amount,
        expectedKobo: expected,
        currency: tx.currency,
        note: `Paystack reports ${naira(tx.amount)} paid for an order of ${naira(expected)}: ${kind}. The order was NOT marked paid. Refund or collect the difference in Paystack, then resolve this.`,
        customerText: `We received a payment for order #${shortId(order.id)} that does not match its price. The shop has been told and will contact you; please keep your payment reference ${tx.reference}.`,
      });
      return { status: "mismatch", orderId: order.id };
    }

    const marked = await db.$transaction(async (t) => {
      // Only the call that flips the status continues; a second, simultaneous call does nothing.
      const { count } = await t.paiementCommande.updateMany({
        where: { id: payment.id, statut: { not: PaiementStatut.VALIDE } },
        data: {
          statut: PaiementStatut.VALIDE,
          reference: tx.reference || payment.reference,
          canal: tx.channel,
          datePaiement: tx.paidAt ? new Date(tx.paidAt) : new Date(),
        },
      });
      if (count === 0) return false;

      await t.historiqueStatutCommande.create({
        data: {
          commandeId: order.id,
          ancienStatut: order.statut,
          nouveauStatut: order.statut,
          note: `Payment received${tx.channel ? ` (${tx.channel.replace("_", " ")})` : ""}`,
        },
      });
      if (order.clientId) {
        await t.notification.create({
          data: {
            userId: order.clientId,
            type: NotificationType.PAIEMENT,
            objet: "Payment received",
            text: `We received your payment for order #${shortId(order.id)}. Thank you!`,
            urlRedirection: "/client/orders",
          },
        });
      }
      await notifyAdmins(t, {
        type: NotificationType.PAIEMENT,
        objet: "Payment received",
        text: `Order #${shortId(order.id)} has been paid. You can start processing it.`,
        url: "/admin/deliveries",
      });
      return true;
    }, TX_OPTIONS);

    return { status: "paid", alreadyPaid: !marked, orderId: order.id };
  }

  if (tx.status === "failed") {
    await db.paiementCommande.updateMany({
      where: { id: payment.id, statut: PaiementStatut.EN_COURS },
      data: { statut: PaiementStatut.ECHOUE },
    });
    return { status: "failed", orderId: order.id };
  }

  // abandoned / ongoing / pending: still waiting for the customer
  return { status: "pending", orderId: order.id };
}

/**
 * The customer came back from Paystack (or opened their order again): ask Paystack what happened.
 * Only the order's owner may check, and an unknown reference looks the same as someone else's.
 */
export async function confirmPayment(
  db: PrismaClient,
  client: PaystackClient,
  args: { reference: string; userId: string }
): Promise<PaymentOutcome> {
  const payment = await db.paiementCommande.findUnique({ where: { reference: args.reference }, include: { commande: true } });
  if (!payment || payment.commande.clientId !== args.userId) throw new PaymentError("PAYMENT_NOT_FOUND", "Payment not found.");
  if (payment.statut === PaiementStatut.VALIDE) return { status: "paid", alreadyPaid: true, orderId: payment.commandeId };

  const tx = await client.verify(args.reference);
  return applyTransaction(db, payment.id, tx);
}

/**
 * Paystack tells us directly when a payment succeeds, even if the customer closed the browser. The
 * request is trusted only if its signature matches. Returns quietly for events we do not act on.
 */
export async function processWebhook(
  db: PrismaClient,
  args: { rawBody: string; signature: string | null; secretKey: string }
): Promise<{ handled: boolean }> {
  if (!verifyWebhookSignature(args.rawBody, args.signature, args.secretKey)) {
    throw new PaymentError("BAD_SIGNATURE", "Invalid signature.");
  }

  let event: { event?: string; data?: Record<string, unknown> };
  try {
    event = JSON.parse(args.rawBody);
  } catch {
    return { handled: false };
  }
  if (!event.data) return { handled: false };
  if (event.event && /^(charge\.dispute\.|refund\.)/.test(event.event)) return handleDisputeOrRefund(db, event.event, event.data);
  if (event.event !== "charge.success") return { handled: false };

  const tx = toTransaction(event.data);
  const metadata = (event.data.metadata ?? {}) as { orderId?: unknown };

  // Normally found by reference. If the customer started a second attempt and paid the first one,
  // the order id Paystack echoes back still finds the right order.
  let payment = tx.reference ? await db.paiementCommande.findUnique({ where: { reference: tx.reference } }) : null;
  if (!payment && typeof metadata.orderId === "string") {
    payment = await db.paiementCommande.findUnique({ where: { commandeId: metadata.orderId } });
  }
  if (!payment) return { handled: false };

  await applyTransaction(db, payment.id, tx);
  return { handled: true };
}


const text = (v: unknown) => (typeof v === "string" ? v : undefined);
const numberOf = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/**
 * Disputes (chargebacks) and refunds reported by Paystack. Shapes follow Paystack's documentation for
 * charge.dispute.create / charge.dispute.resolve and refund.processed; every field is read defensively, and an event whose
 * transaction we cannot find is ignored rather than guessed at.
 */
async function handleDisputeOrRefund(db: PrismaClient, event: string, data: Record<string, unknown>): Promise<{ handled: boolean }> {
  const nested = (data.transaction ?? {}) as Record<string, unknown>;
  const reference = text(data.transaction_reference) ?? text(nested.reference) ?? text(data.reference);
  if (!reference) return { handled: false };
  const metadata = (nested.metadata ?? data.metadata ?? {}) as { orderId?: unknown };
  let payment = await db.paiementCommande.findUnique({ where: { reference } });
  if (!payment && typeof metadata.orderId === "string") payment = await db.paiementCommande.findUnique({ where: { commandeId: metadata.orderId } });
  if (!payment) return { handled: false };

  const paid = numberOf(nested.amount) ?? numberOf(data.amount);

  if (event === "charge.dispute.create") {
    const why = text(data.category) ?? text(data.reason);
    await recordIssue(db, {
      orderId: payment.commandeId,
      kind: PaymentIssueKind.DISPUTE,
      reference,
      paidKobo: paid,
      note: `The customer's bank disputed this payment${why ? ` (${why})` : ""}. Answer the dispute in the Paystack dashboard before the deadline, then resolve this.`,
    });
    return { handled: true };
  }
  if (event === "charge.dispute.resolve") {
    const resolution = text(data.resolution) ?? "resolved";
    await db.paymentIssue.updateMany({
      where: { reference, kind: PaymentIssueKind.DISPUTE, status: PaymentIssueStatus.OPEN },
      data: { status: PaymentIssueStatus.RESOLVED, dateResolution: new Date(), resolutionNote: `Paystack: ${resolution}`.slice(0, 500) },
    });
    return { handled: true };
  }
  if (event === "refund.processed") {
    const refunded = numberOf(data.amount) ?? numberOf(data.refund_amount);
    await recordIssue(db, {
      orderId: payment.commandeId,
      kind: PaymentIssueKind.REFUND,
      reference,
      paidKobo: refunded,
      info: true,
      note: `A refund${refunded ? ` of ${naira(refunded)}` : ""} was processed by Paystack for this payment.`,
    });
    return { handled: true };
  }
  return { handled: false };
}

/** The owner's list of payments to look at, newest first. Owner only. */
export async function listPaymentIssues(db: PrismaClient, params: { actor: StatusActor; status?: "open" | "resolved"; limit?: number }) {
  if (params.actor.role !== UserRole.ADMIN) throw new OrderError("FORBIDDEN", "Access denied.");
  const rows = await db.paymentIssue.findMany({
    where: params.status ? { status: params.status === "open" ? PaymentIssueStatus.OPEN : PaymentIssueStatus.RESOLVED } : {},
    orderBy: { dateCreation: "desc" },
    take: Math.min(params.limit ?? 50, 200),
    include: { commande: { select: { id: true, montant: true, client: { select: { user: { select: { prenom: true, nom: true, email: true } } } } } } },
  });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    orderRef: shortId(r.commandeId),
    orderId: r.commandeId,
    reference: r.reference,
    amountPaidKobo: r.amountPaidKobo,
    expectedKobo: r.expectedKobo,
    note: r.note,
    customer: r.commande.client ? `${r.commande.client.user.prenom} ${r.commande.client.user.nom}` : null,
    customerEmail: r.commande.client?.user.email ?? null,
    createdAt: r.dateCreation,
    resolvedAt: r.dateResolution,
    resolutionNote: r.resolutionNote,
  }));
}

/** The owner says an issue has been dealt with (refunded, collected, answered). Owner only; repeating it changes nothing. */
export async function resolvePaymentIssue(db: PrismaClient, params: { actor: StatusActor; id: string; note?: string }) {
  if (params.actor.role !== UserRole.ADMIN) throw new OrderError("FORBIDDEN", "Access denied.");
  const issue = await db.paymentIssue.findUnique({ where: { id: params.id }, select: { id: true, status: true } });
  if (!issue) throw new OrderError("ORDER_NOT_FOUND", "Payment issue not found.");
  if (issue.status === PaymentIssueStatus.RESOLVED) return { id: issue.id, status: "RESOLVED" as const, alreadyResolved: true };
  await db.paymentIssue.update({ where: { id: issue.id }, data: { status: PaymentIssueStatus.RESOLVED, dateResolution: new Date(), resolutionNote: params.note?.trim().slice(0, 500) || null } });
  return { id: issue.id, status: "RESOLVED" as const, alreadyResolved: false };
}

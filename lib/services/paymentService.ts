import { randomBytes } from "node:crypto";
import { CommandeStatut, NotificationType, PaiementStatut, type PrismaClient } from "@prisma/client";

import { PaymentError, toTransaction, verifyWebhookSignature, type PaystackClient, type PaystackTransaction } from "@/lib/payments/paystack";
import { notifyAdmins, TX_OPTIONS } from "@/lib/services/orderService";

/** Naira to kobo, the unit Paystack counts in. Always computed from the stored order total. */
export const toKobo = (naira: { toString(): string } | number) => Math.round(Number(naira.toString()) * 100);

export type PaymentOutcome =
  | { status: "paid"; alreadyPaid: boolean; orderId: string }
  | { status: "failed"; orderId: string }
  | { status: "pending"; orderId: string }
  /** Paystack says paid, but the amount or currency is not what this order costs. Nothing is marked paid. */
  | { status: "mismatch"; orderId: string };

const shortId = (id: string) => id.slice(-8);

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

  if (payment.statut === PaiementStatut.VALIDE) return { status: "paid", alreadyPaid: true, orderId: order.id };

  if (tx.status === "success") {
    if (tx.currency !== "NGN" || tx.amount !== toKobo(order.montant)) {
      console.error(`[payment] amount mismatch for order ${order.id}: paid ${tx.amount} ${tx.currency}, expected ${toKobo(order.montant)} NGN`);
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
        text: `Order #${shortId(order.id)} has been paid. Assign a delivery person.`,
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
  if (event.event !== "charge.success" || !event.data) return { handled: false };

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

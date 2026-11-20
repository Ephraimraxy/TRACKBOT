import { createHmac } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PaiementStatut as P, PaymentIssueKind as K, PaymentIssueStatus as IS, UserRole as R } from "@prisma/client";

import type { PaystackClient, PaystackTransaction } from "@/lib/payments/paystack";
import { confirmPayment, initializePayment, listPaymentIssues, processWebhook, resolvePaymentIssue, toKobo } from "@/lib/services/paymentService";
import { orderAt, world } from "./flow";
import { db, resetDb } from "./helpers";

const SECRET = "sk_test_not_a_real_key";
const fake = (answer: Partial<PaystackTransaction>): PaystackClient => ({
  async initialize(a) {
    return { authorizationUrl: `https://checkout.paystack.com/${a.reference}`, reference: a.reference };
  },
  async verify(reference) {
    return { status: "success", reference, amount: 0, currency: "NGN", channel: "card", paidAt: "2026-11-20T10:00:00.000Z", ...answer };
  },
});
const webhook = (event: string, data: Record<string, unknown>) => {
  const rawBody = JSON.stringify({ event, data });
  return processWebhook(db, { rawBody, signature: createHmac("sha512", SECRET).update(rawBody).digest("hex"), secretKey: SECRET });
};

async function startedPayment() {
  const w = await world();
  const orderId = await orderAt(w.client, w.admin);
  const order = await db.commande.findUniqueOrThrow({ where: { id: orderId } });
  const init = await initializePayment(db, fake({}), { orderId, userId: w.client.id, email: "c@example.com", callbackUrl: "http://x/cb" });
  return { ...w, order, orderId, reference: init.reference, expected: toKobo(order.montant) };
}
const issues = (orderId: string) => db.paymentIssue.findMany({ where: { commandeId: orderId } });
const notes = (userId: string) => db.notification.findMany({ where: { userId, type: "PAIEMENT" } });

beforeEach(resetDb);
afterAll(() => db.$disconnect());

describe("wrong amounts", () => {
  it("an UNDERpayment is not marked paid, is recorded for the owner, and the owner and customer are told", async () => {
    const p = await startedPayment();
    const out = await confirmPayment(db, fake({ amount: p.expected - 50_000 }), { reference: p.reference, userId: p.client.id });
    expect(out.status).toBe("mismatch");
    expect((await db.paiementCommande.findUniqueOrThrow({ where: { commandeId: p.orderId } })).statut).toBe(P.EN_COURS);
    const [issue] = await issues(p.orderId);
    expect(issue).toMatchObject({ kind: K.AMOUNT_MISMATCH, status: IS.OPEN, amountPaidKobo: p.expected - 50_000, expectedKobo: p.expected });
    expect(issue.note).toMatch(/UNDERPAYMENT/);
    expect((await notes(p.admin.id)).some((n) => n.urlRedirection === "/admin/payment-issues")).toBe(true);
    expect((await notes(p.client.id)).some((n) => /does not match/.test(n.text))).toBe(true);
  });

  it("an OVERpayment is also not marked paid and is recorded as an overpayment", async () => {
    const p = await startedPayment();
    expect((await confirmPayment(db, fake({ amount: p.expected + 100_000 }), { reference: p.reference, userId: p.client.id })).status).toBe("mismatch");
    expect((await issues(p.orderId))[0].note).toMatch(/OVERPAYMENT/);
  });

  it("a payment in another currency is recorded too", async () => {
    const p = await startedPayment();
    await confirmPayment(db, fake({ amount: p.expected, currency: "USD" }), { reference: p.reference, userId: p.client.id });
    expect((await issues(p.orderId))[0].note).toMatch(/USD/);
  });

  it("checking the same payment again does not create a second row or a second alert", async () => {
    const p = await startedPayment();
    for (let i = 0; i < 3; i++) await confirmPayment(db, fake({ amount: p.expected - 1 }), { reference: p.reference, userId: p.client.id });
    expect(await issues(p.orderId)).toHaveLength(1);
    expect((await notes(p.admin.id)).filter((n) => n.objet === "Payment needs review")).toHaveLength(1);
  });

  it("the exact amount is still marked paid, with no issue", async () => {
    const p = await startedPayment();
    expect((await confirmPayment(db, fake({ amount: p.expected }), { reference: p.reference, userId: p.client.id })).status).toBe("paid");
    expect(await issues(p.orderId)).toHaveLength(0);
  });
});

describe("paying twice", () => {
  it("a second successful payment for an order already paid is recorded for a refund", async () => {
    const p = await startedPayment();
    // the customer started a second attempt (a new reference) and then paid the first one
    const second = await initializePayment(db, fake({}), { orderId: p.orderId, userId: p.client.id, email: "c@example.com", callbackUrl: "http://x/cb" });
    const meta = { orderId: p.orderId };
    expect((await webhook("charge.success", { status: "success", reference: p.reference, amount: p.expected, currency: "NGN", metadata: meta })).handled).toBe(true);
    expect((await db.paiementCommande.findUniqueOrThrow({ where: { commandeId: p.orderId } })).statut).toBe(P.VALIDE);
    expect(await issues(p.orderId)).toHaveLength(0);

    // ...then the second attempt is paid as well
    await webhook("charge.success", { status: "success", reference: second.reference, amount: p.expected, currency: "NGN", metadata: meta });
    const [issue] = await issues(p.orderId);
    expect(issue).toMatchObject({ kind: K.DOUBLE_PAYMENT, status: IS.OPEN, reference: second.reference });
    // Paystack retries webhooks: still one row
    await webhook("charge.success", { status: "success", reference: second.reference, amount: p.expected, currency: "NGN", metadata: meta });
    expect(await issues(p.orderId)).toHaveLength(1);
  });

  it("a repeat of the SAME payment is not a double payment", async () => {
    const p = await startedPayment();
    for (let i = 0; i < 2; i++) await webhook("charge.success", { status: "success", reference: p.reference, amount: p.expected, currency: "NGN" });
    expect(await issues(p.orderId)).toHaveLength(0);
  });
});

describe("disputes and refunds", () => {
  it("records a dispute as open, and closes it when Paystack resolves it", async () => {
    const p = await startedPayment();
    await webhook("charge.success", { status: "success", reference: p.reference, amount: p.expected, currency: "NGN" });
    expect((await webhook("charge.dispute.create", { transaction: { reference: p.reference, amount: p.expected }, category: "fraud" })).handled).toBe(true);
    const [open] = await issues(p.orderId);
    expect(open).toMatchObject({ kind: K.DISPUTE, status: IS.OPEN });
    expect(open.note).toMatch(/disputed.*fraud/);

    await webhook("charge.dispute.resolve", { transaction: { reference: p.reference }, resolution: "merchant-accepted" });
    const [done] = await issues(p.orderId);
    expect(done.status).toBe(IS.RESOLVED);
    expect(done.resolutionNote).toMatch(/merchant-accepted/);
  });

  it("records a processed refund as already resolved, and tells the owner", async () => {
    const p = await startedPayment();
    await webhook("charge.success", { status: "success", reference: p.reference, amount: p.expected, currency: "NGN" });
    await webhook("refund.processed", { transaction_reference: p.reference, amount: 50_000 });
    const [refund] = await issues(p.orderId);
    expect(refund).toMatchObject({ kind: K.REFUND, status: IS.RESOLVED });
    expect(refund.note).toMatch(/₦500/);
    expect((await notes(p.admin.id)).some((n) => n.objet === "Payment update")).toBe(true);
  });

  it("ignores events about a transaction it does not know, and events with the wrong signature", async () => {
    await startedPayment();
    expect((await webhook("charge.dispute.create", { transaction: { reference: "unknown-ref" } })).handled).toBe(false);
    expect((await webhook("refund.processed", {})).handled).toBe(false);
    await expect(processWebhook(db, { rawBody: JSON.stringify({ event: "charge.dispute.create", data: {} }), signature: "bad", secretKey: SECRET })).rejects.toMatchObject({ code: "BAD_SIGNATURE" });
  });
});

describe("the owner's list", () => {
  it("lists and resolves issues for the owner only, and resolving twice changes nothing", async () => {
    const p = await startedPayment();
    await confirmPayment(db, fake({ amount: p.expected + 1 }), { reference: p.reference, userId: p.client.id });
    const owner = { id: p.admin.id, role: R.ADMIN };

    const open = await listPaymentIssues(db, { actor: owner, status: "open" });
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({ orderRef: p.orderId.slice(-8), kind: K.AMOUNT_MISMATCH });

    await expect(listPaymentIssues(db, { actor: { id: p.client.id, role: R.CLIENT } })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listPaymentIssues(db, { actor: { id: p.driver.id, role: R.LIVREUR } })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(resolvePaymentIssue(db, { actor: { id: p.client.id, role: R.CLIENT }, id: open[0].id })).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(await resolvePaymentIssue(db, { actor: owner, id: open[0].id, note: "refunded the difference" })).toMatchObject({ alreadyResolved: false });
    expect(await resolvePaymentIssue(db, { actor: owner, id: open[0].id })).toMatchObject({ alreadyResolved: true });
    expect(await listPaymentIssues(db, { actor: owner, status: "open" })).toHaveLength(0);
    expect((await listPaymentIssues(db, { actor: owner, status: "resolved" }))[0].resolutionNote).toBe("refunded the difference");
    await expect(resolvePaymentIssue(db, { actor: owner, id: "nope" })).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
  });
});

describe("checking waiting payments with Paystack", () => {
  const ago = (min: number) => new Date(Date.now() - min * 60_000);

  async function waiting(answer: Partial<PaystackTransaction>, startedMinAgo = 30) {
    const p = await startedPayment();
    await db.paiementCommande.update({ where: { commandeId: p.orderId }, data: { date: ago(startedMinAgo) } });
    return { ...p, client2: fake({ amount: p.expected, ...answer }) };
  }

  it("marks an order paid when Paystack says the customer did pay but the webhook never arrived", async () => {
    const { reconcilePendingPayments } = await import("@/lib/services/paymentService");
    const p = await waiting({});
    const r = await reconcilePendingPayments(db, p.client2, { actor: { id: p.admin.id, role: R.ADMIN } });
    expect(r).toMatchObject({ checked: 1, markedPaid: 1, stillWaiting: 0 });
    expect((await db.paiementCommande.findUniqueOrThrow({ where: { commandeId: p.orderId } })).statut).toBe(P.VALIDE);
    // running it again does nothing more
    expect(await reconcilePendingPayments(db, p.client2, { actor: { id: p.admin.id, role: R.ADMIN } })).toMatchObject({ checked: 0 });
  });

  it("leaves abandoned payments waiting, records failures, and sends wrong amounts to review", async () => {
    const { reconcilePendingPayments } = await import("@/lib/services/paymentService");
    const owner = { id: (await world()).admin.id, role: R.ADMIN };
    void owner;
    const a = await waiting({ status: "abandoned" });
    expect(await reconcilePendingPayments(db, a.client2, { actor: { id: a.admin.id, role: R.ADMIN } })).toMatchObject({ checked: 1, stillWaiting: 1 });
    await resetDb();
    const f = await waiting({ status: "failed" });
    expect(await reconcilePendingPayments(db, f.client2, { actor: { id: f.admin.id, role: R.ADMIN } })).toMatchObject({ failed: 1 });
    await resetDb();
    const m = await waiting({ amount: 1 });
    expect(await reconcilePendingPayments(db, m.client2, { actor: { id: m.admin.id, role: R.ADMIN } })).toMatchObject({ needsReview: 1 });
    expect(await issues(m.orderId)).toHaveLength(1);
  });

  it("skips payments started a moment ago (the customer may still be paying), and cancelled orders", async () => {
    const { reconcilePendingPayments } = await import("@/lib/services/paymentService");
    const fresh = await waiting({}, 1);
    expect(await reconcilePendingPayments(db, fresh.client2, { actor: { id: fresh.admin.id, role: R.ADMIN } })).toMatchObject({ checked: 0 });
    await db.commande.update({ where: { id: fresh.orderId }, data: { statut: "ANNULEE" } });
    await db.paiementCommande.update({ where: { commandeId: fresh.orderId }, data: { date: ago(60) } });
    expect(await reconcilePendingPayments(db, fresh.client2, { actor: { id: fresh.admin.id, role: R.ADMIN } })).toMatchObject({ checked: 0 });
  });

  it("counts a payment it could not check, and is closed to everyone but the owner", async () => {
    const { reconcilePendingPayments } = await import("@/lib/services/paymentService");
    const p = await waiting({});
    const broken: PaystackClient = { initialize: p.client2.initialize, verify: async () => { throw new Error("Paystack down"); } };
    expect(await reconcilePendingPayments(db, broken, { actor: { id: p.admin.id, role: R.ADMIN } })).toMatchObject({ checked: 1, couldNotCheck: 1 });
    await expect(reconcilePendingPayments(db, p.client2, { actor: { id: p.client.id, role: R.CLIENT } })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(reconcilePendingPayments(db, p.client2, { actor: { id: p.driver.id, role: R.LIVREUR } })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

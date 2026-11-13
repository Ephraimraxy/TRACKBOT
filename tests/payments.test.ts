import { createHmac } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PaiementStatut as P, CommandeStatut as S } from "@prisma/client";

import {
  createPaystackClient,
  PaymentError,
  verifyWebhookSignature,
  type PaystackClient,
  type PaystackTransaction,
} from "@/lib/payments/paystack";
import { confirmPayment, initializePayment, processWebhook, toKobo } from "@/lib/services/paymentService";
import { orderAt, world } from "./flow";
import { db, resetDb } from "./helpers";

const SECRET = "sk_test_not_a_real_key";

/** A stand-in for Paystack that records what it was asked and answers as the test says. */
function fakePaystack(answer: Partial<PaystackTransaction> = {}) {
  const calls = { initialize: [] as unknown[], verify: [] as string[] };
  const client: PaystackClient = {
    async initialize(args) {
      calls.initialize.push(args);
      return { authorizationUrl: `https://checkout.paystack.com/${args.reference}`, reference: args.reference };
    },
    async verify(reference) {
      calls.verify.push(reference);
      return { status: "success", reference, amount: 0, currency: "NGN", channel: "card", paidAt: "2026-10-28T12:00:00.000Z", ...answer };
    },
  };
  return { client, calls };
}

async function unpaidOrder() {
  const w = await world();
  const orderId = await orderAt(w.client, w.admin);
  const order = await db.commande.findUniqueOrThrow({ where: { id: orderId }, include: { paiement: true } });
  return { ...w, order, orderId };
}

beforeEach(resetDb);
afterAll(() => db.$disconnect());

describe("a new order", () => {
  it("is awaiting payment, not paid", async () => {
    const { order } = await unpaidOrder();
    expect(order.paiement?.statut).toBe(P.EN_COURS);
    expect(order.paiement?.reference).toBeNull();
  });
});

describe("amounts", () => {
  it("converts naira to kobo exactly", () => {
    expect(toKobo(9500)).toBe(950000);
    expect(toKobo("12500.50")).toBe(1250050);
    expect(toKobo(0.1 + 0.2)).toBe(30); // no floating-point drift
  });
});

describe("the Paystack client", () => {
  const okInit = { status: true, message: "ok", data: { authorization_url: "https://checkout.paystack.com/abc", reference: "R1", access_code: "x" } };
  const reply = (body: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it("asks Paystack to start a payment in naira, with the amount in kobo and the secret key as a bearer token", async () => {
    const f = reply(okInit);
    const out = await createPaystackClient(SECRET, f as unknown as typeof fetch).initialize({
      email: "ada@shop.test", amountKobo: 950000, reference: "R1", callbackUrl: "https://shop.test/payment/callback", metadata: { orderId: "o1" },
    });
    expect(out).toEqual({ authorizationUrl: "https://checkout.paystack.com/abc", reference: "R1" });

    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.paystack.co/transaction/initialize");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);
    expect(JSON.parse(init.body as string)).toMatchObject({
      email: "ada@shop.test", amount: 950000, currency: "NGN", reference: "R1", callback_url: "https://shop.test/payment/callback", metadata: { orderId: "o1" },
    });
  });

  it("reads a transaction back from Paystack", async () => {
    const f = reply({ status: true, data: { status: "success", reference: "R 1", amount: 950000, currency: "NGN", channel: "bank_transfer", paid_at: "2026-10-28T10:00:00Z" } });
    const tx = await createPaystackClient(SECRET, f as unknown as typeof fetch).verify("R 1");
    expect(tx).toEqual({ status: "success", reference: "R 1", amount: 950000, currency: "NGN", channel: "bank_transfer", paidAt: "2026-10-28T10:00:00Z" });
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe("https://api.paystack.co/transaction/verify/R%201");
  });

  it("turns every failure into a safe error that never contains the secret key", async () => {
    const bad = [
      reply({ status: false, message: "Invalid key" }, 401),
      reply({ status: true, data: { authorization_url: "http://insecure.example/x" } }),
      vi.fn(async () => { throw new Error(`network down ${SECRET}`); }),
    ];
    for (const f of bad) {
      const err = await createPaystackClient(SECRET, f as unknown as typeof fetch)
        .initialize({ email: "a@b.co", amountKobo: 100, reference: "R", callbackUrl: "https://x.test" })
        .catch((e) => e);
      expect(err).toBeInstanceOf(PaymentError);
      expect(err.code).toBe("GATEWAY_ERROR");
      expect(err.message).not.toContain(SECRET);
    }
  });
});

describe("webhook signatures", () => {
  const body = JSON.stringify({ event: "charge.success", data: { reference: "R1" } });
  const sign = (b: string, key = SECRET) => createHmac("sha512", key).update(b).digest("hex");

  it("accepts only a signature made with the secret key over the exact body", () => {
    expect(verifyWebhookSignature(body, sign(body), SECRET)).toBe(true);
    expect(verifyWebhookSignature(body + " ", sign(body), SECRET)).toBe(false); // body changed
    expect(verifyWebhookSignature(body, sign(body, "another-key"), SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, null, SECRET)).toBe(false);
    expect(verifyWebhookSignature(body, "short", SECRET)).toBe(false);
  });
});

describe("starting a payment", () => {
  it("sends Paystack the order's own total in kobo, to the customer's email, and remembers the reference", async () => {
    const { order, orderId } = await unpaidOrder();
    const { client, calls } = fakePaystack();

    const out = await initializePayment(db, client, { orderId, userId: order.clientId!, email: "ada@shop.test", callbackUrl: "https://shop.test/payment/callback" });
    const sent = calls.initialize[0] as { amountKobo: number; email: string; callbackUrl: string; metadata: { orderId: string } };
    expect(sent.amountKobo).toBe(toKobo(order.montant));
    expect(sent.email).toBe("ada@shop.test");
    expect(sent.callbackUrl).toBe("https://shop.test/payment/callback");
    expect(sent.metadata.orderId).toBe(orderId);
    expect(out.authorizationUrl).toContain(out.reference);
    expect((await db.paiementCommande.findUniqueOrThrow({ where: { commandeId: orderId } })).reference).toBe(out.reference);
  });

  it("uses a new reference for every attempt", async () => {
    const { orderId, order } = await unpaidOrder();
    const { client } = fakePaystack();
    const args = { orderId, userId: order.clientId!, email: "a@b.co", callbackUrl: "https://x.test/cb" };
    const first = await initializePayment(db, client, args);
    const second = await initializePayment(db, client, args);
    expect(second.reference).not.toBe(first.reference);
  });

  it("is only for the order's owner, and only while the order is open and unpaid", async () => {
    const { orderId, order, admin, driver } = await unpaidOrder();
    const { client } = fakePaystack();
    const base = { orderId, email: "a@b.co", callbackUrl: "https://x.test/cb" };

    await expect(initializePayment(db, client, { ...base, userId: driver.id })).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
    await expect(initializePayment(db, client, { ...base, userId: order.clientId!, orderId: "nope" })).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });

    await db.paiementCommande.update({ where: { commandeId: orderId }, data: { statut: P.VALIDE } });
    await expect(initializePayment(db, client, { ...base, userId: order.clientId! })).rejects.toMatchObject({ code: "ALREADY_PAID" });

    await db.paiementCommande.update({ where: { commandeId: orderId }, data: { statut: P.EN_COURS } });
    await db.commande.update({ where: { id: orderId }, data: { statut: S.ANNULEE } });
    await expect(initializePayment(db, client, { ...base, userId: order.clientId! })).rejects.toMatchObject({ code: "ORDER_CANCELLED" });
    void admin;
  });
});

describe("confirming a payment", () => {
  async function started() {
    const u = await unpaidOrder();
    const { client } = fakePaystack();
    const { reference } = await initializePayment(db, client, { orderId: u.orderId, userId: u.order.clientId!, email: "a@b.co", callbackUrl: "https://x.test/cb" });
    return { ...u, reference };
  }

  it("marks the order paid when Paystack says the right amount arrived", async () => {
    const { reference, order, orderId } = await started();
    const { client } = fakePaystack({ amount: toKobo(order.montant), channel: "bank_transfer" });

    expect(await confirmPayment(db, client, { reference, userId: order.clientId! })).toEqual({ status: "paid", alreadyPaid: false, orderId });
    const payment = await db.paiementCommande.findUniqueOrThrow({ where: { commandeId: orderId } });
    expect(payment).toMatchObject({ statut: P.VALIDE, canal: "bank_transfer" });
    expect(payment.datePaiement).toBeInstanceOf(Date);
    // the customer is told, and the order's history records it
    const note = await db.notification.findFirstOrThrow({ where: { userId: order.clientId!, type: "PAIEMENT" } });
    expect(note.text).toContain(orderId.slice(-8));
    expect(await db.historiqueStatutCommande.count({ where: { commandeId: orderId, note: { contains: "Payment received" } } })).toBe(1);
  });

  it("is safe to repeat: the order is marked paid and the customer told only once", async () => {
    const { reference, order, orderId } = await started();
    const { client, calls } = fakePaystack({ amount: toKobo(order.montant) });

    await confirmPayment(db, client, { reference, userId: order.clientId! });
    const again = await confirmPayment(db, client, { reference, userId: order.clientId! });
    expect(again).toMatchObject({ status: "paid", alreadyPaid: true });
    expect(calls.verify).toHaveLength(1); // the second call did not even ask Paystack
    expect(await db.notification.count({ where: { userId: order.clientId!, type: "PAIEMENT" } })).toBe(1);
    expect(await db.historiqueStatutCommande.count({ where: { commandeId: orderId, note: { contains: "Payment received" } } })).toBe(1);
  });

  it("does not mark an order paid if the amount or currency is wrong", async () => {
    const { reference, order, orderId } = await started();
    for (const wrong of [{ amount: toKobo(order.montant) - 1 }, { amount: 1 }, { amount: toKobo(order.montant), currency: "USD" }]) {
      const { client } = fakePaystack(wrong);
      expect(await confirmPayment(db, client, { reference, userId: order.clientId! })).toMatchObject({ status: "mismatch" });
    }
    expect((await db.paiementCommande.findUniqueOrThrow({ where: { commandeId: orderId } })).statut).toBe(P.EN_COURS);
  });

  it("records a failed payment, and leaves an abandoned one waiting", async () => {
    const { reference, order, orderId } = await started();
    const waiting = fakePaystack({ status: "abandoned", amount: toKobo(order.montant) }).client;
    expect(await confirmPayment(db, waiting, { reference, userId: order.clientId! })).toMatchObject({ status: "pending" });
    expect((await db.paiementCommande.findUniqueOrThrow({ where: { commandeId: orderId } })).statut).toBe(P.EN_COURS);

    const failed = fakePaystack({ status: "failed" }).client;
    expect(await confirmPayment(db, failed, { reference, userId: order.clientId! })).toMatchObject({ status: "failed" });
    expect((await db.paiementCommande.findUniqueOrThrow({ where: { commandeId: orderId } })).statut).toBe(P.ECHOUE);
  });

  it("only lets the owner check a payment, and an unknown reference looks the same", async () => {
    const { reference, driver, order } = await started();
    const { client, calls } = fakePaystack();
    await expect(confirmPayment(db, client, { reference, userId: driver.id })).rejects.toMatchObject({ code: "PAYMENT_NOT_FOUND" });
    await expect(confirmPayment(db, client, { reference: "TB-unknown", userId: order.clientId! })).rejects.toMatchObject({ code: "PAYMENT_NOT_FOUND" });
    expect(calls.verify).toHaveLength(0);
  });
});

describe("the Paystack webhook", () => {
  const sign = (b: string) => createHmac("sha512", SECRET).update(b).digest("hex");
  const event = (data: Record<string, unknown>, name = "charge.success") => JSON.stringify({ event: name, data });

  async function started() {
    const u = await unpaidOrder();
    const { client } = fakePaystack();
    const { reference } = await initializePayment(db, client, { orderId: u.orderId, userId: u.order.clientId!, email: "a@b.co", callbackUrl: "https://x.test/cb" });
    return { ...u, reference };
  }

  it("rejects a request that is not signed by Paystack", async () => {
    const { reference } = await started();
    const raw = event({ reference, status: "success" });
    await expect(processWebhook(db, { rawBody: raw, signature: "forged", secretKey: SECRET })).rejects.toMatchObject({ code: "BAD_SIGNATURE" });
    await expect(processWebhook(db, { rawBody: raw, signature: null, secretKey: SECRET })).rejects.toMatchObject({ code: "BAD_SIGNATURE" });
  });

  it("marks the order paid when a signed charge.success arrives, even if the customer never came back", async () => {
    const { reference, order, orderId } = await started();
    const raw = event({ reference, status: "success", amount: toKobo(order.montant), currency: "NGN", channel: "ussd", paid_at: "2026-10-28T11:00:00Z" });

    expect(await processWebhook(db, { rawBody: raw, signature: sign(raw), secretKey: SECRET })).toEqual({ handled: true });
    expect(await db.paiementCommande.findUniqueOrThrow({ where: { commandeId: orderId } })).toMatchObject({ statut: P.VALIDE, canal: "ussd" });
  });

  it("does not trust the event's amount blindly", async () => {
    const { reference, orderId } = await started();
    const raw = event({ reference, status: "success", amount: 100, currency: "NGN" });
    await processWebhook(db, { rawBody: raw, signature: sign(raw), secretKey: SECRET });
    expect((await db.paiementCommande.findUniqueOrThrow({ where: { commandeId: orderId } })).statut).toBe(P.EN_COURS);
  });

  it("finds the order from the metadata when the customer paid an earlier attempt", async () => {
    const { reference, order, orderId } = await started();
    const raw = event({ reference: "TB-older-attempt", status: "success", amount: toKobo(order.montant), currency: "NGN", channel: "card", metadata: { orderId } });
    await processWebhook(db, { rawBody: raw, signature: sign(raw), secretKey: SECRET });
    const payment = await db.paiementCommande.findUniqueOrThrow({ where: { commandeId: orderId } });
    expect(payment.statut).toBe(P.VALIDE);
    expect(payment.reference).toBe("TB-older-attempt");
    void reference;
  });

  it("ignores other events, unknown payments and unreadable bodies, without error", async () => {
    const { reference } = await started();
    const other = event({ reference }, "transfer.success");
    expect(await processWebhook(db, { rawBody: other, signature: sign(other), secretKey: SECRET })).toEqual({ handled: false });

    const unknown = event({ reference: "TB-nobody" });
    expect(await processWebhook(db, { rawBody: unknown, signature: sign(unknown), secretKey: SECRET })).toEqual({ handled: false });

    expect(await processWebhook(db, { rawBody: "not json", signature: sign("not json"), secretKey: SECRET })).toEqual({ handled: false });
  });

  it("delivering the same event twice pays the order once", async () => {
    const { reference, order } = await started();
    const raw = event({ reference, status: "success", amount: toKobo(order.montant), currency: "NGN", channel: "card" });
    await processWebhook(db, { rawBody: raw, signature: sign(raw), secretKey: SECRET });
    await processWebhook(db, { rawBody: raw, signature: sign(raw), secretKey: SECRET });
    expect(await db.notification.count({ where: { userId: order.clientId!, type: "PAIEMENT" } })).toBe(1);
  });
});

import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaiementStatut as P, UserRole as R } from "@prisma/client";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { auth } from "@/lib/auth";
import { POST as initializeRoute } from "@/app/api/payments/paystack/initialize/route";
import { POST as verifyRoute } from "@/app/api/payments/paystack/verify/route";
import { POST as webhookRoute } from "@/app/api/payments/paystack/webhook/route";
import { toKobo } from "@/lib/services/paymentService";
import { orderAt, world } from "./flow";
import { db, resetDb } from "./helpers";

const SECRET = "sk_test_not_a_real_key";
const mockedAuth = vi.mocked(auth) as unknown as ReturnType<typeof vi.fn>;
const loginAs = (u: { id: string; role: R; email?: string } | null) =>
  mockedAuth.mockResolvedValue(u ? { user: { id: u.id, role: u.role, email: u.email ?? "ada@shop.test" } } : null);

const post = (route: (r: NextRequest) => Promise<Response>, body: unknown, headers: Record<string, string> = {}) =>
  route(
    new NextRequest("https://shop.test/api/payments/paystack/x", {
      method: "POST",
      headers: { "content-type": "application/json", host: "shop.test", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    })
  );

/** Pretend to be Paystack's servers. */
function stubPaystack(txOverride: Record<string, unknown> = {}) {
  const f = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/transaction/initialize")) {
      const ref = JSON.parse(String(init?.body)).reference;
      return new Response(JSON.stringify({ status: true, data: { authorization_url: `https://checkout.paystack.com/${ref}`, reference: ref } }), { status: 200 });
    }
    const ref = decodeURIComponent(String(url).split("/").pop()!);
    return new Response(JSON.stringify({ status: true, data: { status: "success", reference: ref, amount: 0, currency: "NGN", channel: "card", ...txOverride } }), { status: 200 });
  });
  vi.stubGlobal("fetch", f);
  return f;
}

beforeEach(async () => {
  await resetDb();
  mockedAuth.mockReset();
  vi.stubEnv("PAYSTACK_SECRET_KEY", SECRET);
  vi.stubEnv("APP_URL", "https://shop.test");
  vi.stubEnv("NEXTAUTH_URL", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(() => db.$disconnect());

async function customerOrder() {
  const w = await world();
  const orderId = await orderAt(w.client, w.admin);
  const order = await db.commande.findUniqueOrThrow({ where: { id: orderId } });
  return { ...w, orderId, order };
}

describe("POST /api/payments/paystack/initialize", () => {
  it("needs a signed-in customer", async () => {
    loginAs(null);
    expect((await post(initializeRoute, { orderId: "x" })).status).toBe(401);
    const { admin } = await world();
    loginAs({ id: admin.id, role: R.ADMIN });
    expect((await post(initializeRoute, { orderId: "x" })).status).toBe(403);
  });

  it("gives the customer a Paystack page to pay on, for their own order", async () => {
    const { client, orderId, order } = await customerOrder();
    const f = stubPaystack();
    loginAs({ id: client.id, role: R.CLIENT, email: client.email });

    const res = await post(initializeRoute, { orderId });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.authorizationUrl).toMatch(/^https:\/\/checkout\.paystack\.com\//);

    const sent = JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(sent).toMatchObject({ amount: toKobo(order.montant), currency: "NGN", email: client.email, callback_url: "https://shop.test/payment/callback" });
  });

  it("will not start a payment for someone else's order, and validates the request", async () => {
    const { client, orderId, driver } = await customerOrder();
    stubPaystack();
    loginAs({ id: driver.id, role: R.CLIENT });
    expect((await post(initializeRoute, { orderId })).status).toBe(404);
    loginAs({ id: client.id, role: R.CLIENT });
    expect((await post(initializeRoute, {})).status).toBe(400);
    expect((await post(initializeRoute, "not json")).status).toBe(400);
  });

  it("says so clearly when online payment is not set up, without exposing anything", async () => {
    const { client, orderId } = await customerOrder();
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");
    loginAs({ id: client.id, role: R.CLIENT });
    const res = await post(initializeRoute, { orderId });
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("sk_");
  });
});

describe("POST /api/payments/paystack/verify", () => {
  it("marks the order paid after the customer returns from Paystack", async () => {
    const { client, orderId, order } = await customerOrder();
    stubPaystack({ amount: toKobo(order.montant) });
    loginAs({ id: client.id, role: R.CLIENT, email: client.email });
    const { authorizationUrl } = await (await post(initializeRoute, { orderId })).json();
    const reference = authorizationUrl.split("/").pop();

    const res = await post(verifyRoute, { reference });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "paid", orderId });
    expect((await db.paiementCommande.findUniqueOrThrow({ where: { commandeId: orderId } })).statut).toBe(P.VALIDE);
  });

  it("needs login, and hides other people's payments", async () => {
    const { client, orderId, driver } = await customerOrder();
    stubPaystack();
    loginAs({ id: client.id, role: R.CLIENT, email: client.email });
    const { authorizationUrl } = await (await post(initializeRoute, { orderId })).json();
    const reference = authorizationUrl.split("/").pop();

    loginAs(null);
    expect((await post(verifyRoute, { reference })).status).toBe(401);
    loginAs({ id: driver.id, role: R.CLIENT });
    expect((await post(verifyRoute, { reference })).status).toBe(404);
    loginAs({ id: client.id, role: R.CLIENT });
    expect((await post(verifyRoute, {})).status).toBe(400);
  });
});

describe("POST /api/payments/paystack/webhook", () => {
  const sign = (raw: string) => createHmac("sha512", SECRET).update(raw).digest("hex");

  it("rejects an unsigned or wrongly signed request", async () => {
    const raw = JSON.stringify({ event: "charge.success", data: { reference: "R1" } });
    expect((await post(webhookRoute, raw)).status).toBe(401);
    expect((await post(webhookRoute, raw, { "x-paystack-signature": "forged" })).status).toBe(401);
  });

  it("accepts a signed payment event and pays the order", async () => {
    const { client, orderId, order } = await customerOrder();
    stubPaystack();
    loginAs({ id: client.id, role: R.CLIENT, email: client.email });
    const { reference } = await (await post(initializeRoute, { orderId })).json();

    const raw = JSON.stringify({ event: "charge.success", data: { reference, status: "success", amount: toKobo(order.montant), currency: "NGN", channel: "bank_transfer" } });
    const res = await post(webhookRoute, raw, { "x-paystack-signature": sign(raw) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, handled: true });
    expect(await db.paiementCommande.findUniqueOrThrow({ where: { commandeId: orderId } })).toMatchObject({ statut: P.VALIDE, canal: "bank_transfer" });
  });

  it("answers 200 for events it does not act on, so Paystack does not keep retrying", async () => {
    const raw = JSON.stringify({ event: "transfer.success", data: {} });
    const res = await post(webhookRoute, raw, { "x-paystack-signature": sign(raw) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true, handled: false });
  });

  it("is switched off, not open, when no secret key is configured", async () => {
    vi.stubEnv("PAYSTACK_SECRET_KEY", "");
    expect((await post(webhookRoute, "{}", { "x-paystack-signature": "anything" })).status).toBe(503);
  });
});

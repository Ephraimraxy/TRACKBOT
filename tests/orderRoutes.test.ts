import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { CommandeStatut as S, UserRole as R } from "@prisma/client";

// Replace only authentication; routes, services and the database are real.
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { auth } from "@/lib/auth";
import { GET as listOrders, POST as postOrder } from "@/app/api/orders/route";
import { PATCH as patchStatus } from "@/app/api/orders/[orderId]/status/route";
import { GET as getHistory } from "@/app/api/orders/[orderId]/history/route";
import { address, db, makeProduct, makeUser, payment, resetDb } from "./helpers";

const mockedAuth = vi.mocked(auth) as unknown as ReturnType<typeof vi.fn>;
const loginAs = (user: { id: string; role: R } | null) =>
  mockedAuth.mockResolvedValue(user ? { user: { id: user.id, role: user.role } } : null);

const req = (method: string, body?: unknown) =>
  new NextRequest("http://localhost/api/test", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = (orderId: string) => ({ params: Promise.resolve({ orderId }) });

const orderBody = (userId: string, produitId: string, quantite = 1) => ({
  userId,
  addresse: address,
  produits: [{ produitId, quantite }],
  payment,
});

beforeEach(async () => {
  await resetDb();
  mockedAuth.mockReset();
});
afterAll(() => db.$disconnect());

describe("POST /api/orders", () => {
  it("401 when not logged in", async () => {
    loginAs(null);
    const res = await postOrder(req("POST", {}));
    expect(res.status).toBe(401);
  });

  it("403 for a non-customer role", async () => {
    const admin = await makeUser(R.ADMIN);
    const product = await makeProduct();
    loginAs(admin);
    const res = await postOrder(req("POST", orderBody(admin.id, product.id)));
    expect(res.status).toBe(403);
  });

  it("403 when ordering on behalf of another user", async () => {
    const me = await makeUser();
    const other = await makeUser();
    const product = await makeProduct();
    loginAs(me);
    const res = await postOrder(req("POST", orderBody(other.id, product.id)));
    expect(res.status).toBe(403);
    expect(await db.commande.count()).toBe(0);
  });

  it("201 for a valid order, with stock decremented", async () => {
    const me = await makeUser();
    const product = await makeProduct({ stock: 5 });
    loginAs(me);
    const res = await postOrder(req("POST", orderBody(me.id, product.id, 2)));
    expect(res.status).toBe(201);
    expect((await db.produit.findUniqueOrThrow({ where: { id: product.id } })).qteStock).toBe(3);
  });

  it("409 when stock is insufficient", async () => {
    const me = await makeUser();
    const product = await makeProduct({ stock: 1 });
    loginAs(me);
    const res = await postOrder(req("POST", orderBody(me.id, product.id, 2)));
    expect(res.status).toBe(409);
    expect(await db.commande.count()).toBe(0);
  });

  it("400 for an absurd quantity or an invalid body", async () => {
    const me = await makeUser();
    const product = await makeProduct();
    loginAs(me);
    expect((await postOrder(req("POST", orderBody(me.id, product.id, 99999)))).status).toBe(400);
    expect((await postOrder(req("POST", { userId: me.id, produits: [] }))).status).toBe(400);
  });

  it("400 for an unknown product", async () => {
    const me = await makeUser();
    loginAs(me);
    const res = await postOrder(req("POST", orderBody(me.id, "does-not-exist")));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/orders (admin list)", () => {
  it("403 for a customer, 200 for the admin", async () => {
    const me = await makeUser();
    const admin = await makeUser(R.ADMIN);
    loginAs(me);
    expect((await listOrders(new NextRequest("http://localhost/api/orders"))).status).toBe(403);
    loginAs(admin);
    expect((await listOrders(new NextRequest("http://localhost/api/orders"))).status).toBe(200);
  });
});

describe("PATCH /api/orders/[orderId]/status", () => {
  async function placed() {
    const me = await makeUser();
    const admin = await makeUser(R.ADMIN);
    const product = await makeProduct();
    loginAs(me);
    const res = await postOrder(req("POST", orderBody(me.id, product.id)));
    const id = (await res.json()).data.id as string;
    return { me, admin, id };
  }

  it("401 anonymous, 403 customer", async () => {
    const { me, id } = await placed();
    loginAs(null);
    expect((await patchStatus(req("PATCH", { statut: S.EN_PREPARATION }), ctx(id))).status).toBe(401);
    loginAs(me);
    expect((await patchStatus(req("PATCH", { statut: S.ANNULEE }), ctx(id))).status).toBe(403);
  });

  it("403 for a delivery person on this admin-only endpoint", async () => {
    const { id } = await placed();
    const driver = await makeUser(R.LIVREUR);
    loginAs(driver);
    expect((await patchStatus(req("PATCH", { statut: S.EN_LIVRAISON }), ctx(id))).status).toBe(403);
  });

  it("400 for an unknown status value or malformed body", async () => {
    const { admin, id } = await placed();
    loginAs(admin);
    expect((await patchStatus(req("PATCH", { statut: "BOGUS" }), ctx(id))).status).toBe(400);
    expect((await patchStatus(req("PATCH", {}), ctx(id))).status).toBe(400);
  });

  it("409 for an illegal transition, 404 for an unknown order", async () => {
    const { admin, id } = await placed();
    loginAs(admin);
    expect((await patchStatus(req("PATCH", { statut: S.LIVREE }), ctx(id))).status).toBe(409);
    expect((await patchStatus(req("PATCH", { statut: S.EN_PREPARATION }), ctx("missing"))).status).toBe(404);
  });

  it("200 for a legal admin transition and it shows in the history", async () => {
    const { me, admin, id } = await placed();
    loginAs(admin);
    const res = await patchStatus(req("PATCH", { statut: S.EN_PREPARATION, note: "Packing" }), ctx(id));
    expect(res.status).toBe(200);

    loginAs(me);
    const hist = await getHistory(req("GET"), ctx(id));
    expect(hist.status).toBe(200);
    const body = (await hist.json()).data;
    expect(body.currentStatus).toBe(S.EN_PREPARATION);
    expect(body.currentStatusLabel).toBe("Processing");
    expect(body.history.map((h: { to: string }) => h.to)).toEqual([S.EN_COURS, S.EN_PREPARATION]);
    expect(body.history[1].note).toBe("Packing");
  });
});

describe("GET /api/orders/[orderId]/history", () => {
  it("401 anonymous and 403 for another customer", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const product = await makeProduct();
    loginAs(owner);
    const id = (await (await postOrder(req("POST", orderBody(owner.id, product.id)))).json()).data.id as string;

    loginAs(null);
    expect((await getHistory(req("GET"), ctx(id))).status).toBe(401);
    loginAs(other);
    expect((await getHistory(req("GET"), ctx(id))).status).toBe(403);
    loginAs(owner);
    expect((await getHistory(req("GET"), ctx(id))).status).toBe(200);
  });
});

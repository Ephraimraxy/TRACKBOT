import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CommandeStatut as S, UserRole as R } from "@prisma/client";

import {
  changeOrderStatus,
  createOrder,
  getOrderHistory,
  OrderError,
} from "@/lib/services/orderService";
import { address, db, makeProduct, makeUser, resetDb } from "./helpers";

async function place(userId: string, lines: { produitId: string; quantite: number }[]) {
  const { order } = await createOrder(db, { userId, addresse: address, produits: lines });
  return order;
}

async function expectOrderError(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ name: "OrderError", code });
}

beforeEach(resetDb);
afterAll(() => db.$disconnect());

describe("createOrder", () => {
  it("persists the order, prices it from the database and decrements stock", async () => {
    const client = await makeUser();
    const product = await makeProduct({ stock: 10, price: 2500 });

    const order = await place(client.id, [{ produitId: product.id, quantite: 3 }]);

    expect(Number(order.montant)).toBe(7500);
    expect(order.statut).toBe(S.EN_COURS);
    expect((await db.produit.findUniqueOrThrow({ where: { id: product.id } })).qteStock).toBe(7);
    expect(await db.commande.count()).toBe(1);
    expect(await db.paiementCommande.count()).toBe(1);
  });

  it("writes the first status-history entry", async () => {
    const client = await makeUser();
    const product = await makeProduct();
    const order = await place(client.id, [{ produitId: product.id, quantite: 1 }]);

    const rows = await db.historiqueStatutCommande.findMany({ where: { commandeId: order.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ancienStatut: null, nouveauStatut: S.EN_COURS, modifieParId: client.id });
  });

  it("rejects insufficient stock and rolls everything back", async () => {
    const client = await makeUser();
    const product = await makeProduct({ stock: 2 });

    await expectOrderError(
      createOrder(db, { userId: client.id, addresse: address, produits: [{ produitId: product.id, quantite: 3 }] }),
      "INSUFFICIENT_STOCK"
    );

    expect((await db.produit.findUniqueOrThrow({ where: { id: product.id } })).qteStock).toBe(2);
    expect(await db.commande.count()).toBe(0);
    expect(await db.adresse.count()).toBe(0);
  });

  it("checks stock on the combined quantity when a product appears on two lines", async () => {
    const client = await makeUser();
    const product = await makeProduct({ stock: 3 });

    await expectOrderError(
      createOrder(db, {
        userId: client.id,
        addresse: address,
        produits: [
          { produitId: product.id, quantite: 2 },
          { produitId: product.id, quantite: 2 },
        ],
      }),
      "INSUFFICIENT_STOCK"
    );
    expect((await db.produit.findUniqueOrThrow({ where: { id: product.id } })).qteStock).toBe(3);
  });

  it("rejects an unknown product without leaving an orphan address", async () => {
    const client = await makeUser();
    await expectOrderError(
      createOrder(db, { userId: client.id, addresse: address, produits: [{ produitId: "nope", quantite: 1 }] }),
      "PRODUCT_NOT_FOUND"
    );
    expect(await db.adresse.count()).toBe(0);
    expect(await db.commande.count()).toBe(0);
  });

  it("never oversells when two orders race for the last units", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const product = await makeProduct({ stock: 5 });

    const results = await Promise.allSettled([
      place(a.id, [{ produitId: product.id, quantite: 3 }]),
      place(b.id, [{ produitId: product.id, quantite: 3 }]),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await db.produit.findUniqueOrThrow({ where: { id: product.id } })).qteStock).toBe(2);
    expect(await db.commande.count()).toBe(1);
  });
});

describe("changeOrderStatus", () => {
  async function setup(stock = 10, qty = 2) {
    const client = await makeUser();
    const admin = await makeUser(R.ADMIN);
    const product = await makeProduct({ stock });
    const order = await place(client.id, [{ produitId: product.id, quantite: qty }]);
    return { client, admin, product, order };
  }

  it("walks the full lifecycle and records every step in order", async () => {
    const { admin, order } = await setup();
    const actor = { id: admin.id, role: R.ADMIN };

    for (const to of [S.EN_PREPARATION, S.EXPEDIEE, S.EN_LIVRAISON, S.LIVREE]) {
      const updated = await changeOrderStatus(db, { orderId: order.id, to, actor });
      expect(updated.statut).toBe(to);
    }

    const history = await db.historiqueStatutCommande.findMany({
      where: { commandeId: order.id },
      orderBy: { date: "asc" },
    });
    expect(history.map((h) => h.nouveauStatut)).toEqual([
      S.EN_COURS, S.EN_PREPARATION, S.EXPEDIEE, S.EN_LIVRAISON, S.LIVREE,
    ]);
    expect(history[1].ancienStatut).toBe(S.EN_COURS);
    expect(history[4].modifieParId).toBe(admin.id);
  });

  it("rejects an illegal jump and records nothing", async () => {
    const { admin, order } = await setup();
    await expectOrderError(
      changeOrderStatus(db, { orderId: order.id, to: S.LIVREE, actor: { id: admin.id, role: R.ADMIN } }),
      "INVALID_TRANSITION"
    );
    expect((await db.commande.findUniqueOrThrow({ where: { id: order.id } })).statut).toBe(S.EN_COURS);
    expect(await db.historiqueStatutCommande.count({ where: { commandeId: order.id } })).toBe(1);
  });

  it("does not allow leaving a terminal status", async () => {
    const { admin, order } = await setup();
    const actor = { id: admin.id, role: R.ADMIN };
    await changeOrderStatus(db, { orderId: order.id, to: S.ANNULEE, actor });
    await expectOrderError(changeOrderStatus(db, { orderId: order.id, to: S.EN_PREPARATION, actor }), "INVALID_TRANSITION");
  });

  it("returns stock when an order is cancelled", async () => {
    const { admin, order, product } = await setup(10, 4);
    expect((await db.produit.findUniqueOrThrow({ where: { id: product.id } })).qteStock).toBe(6);

    await changeOrderStatus(db, { orderId: order.id, to: S.ANNULEE, actor: { id: admin.id, role: R.ADMIN } });
    expect((await db.produit.findUniqueOrThrow({ where: { id: product.id } })).qteStock).toBe(10);
  });

  it("forbids customers from changing status", async () => {
    const { client, order } = await setup();
    await expectOrderError(
      changeOrderStatus(db, { orderId: order.id, to: S.ANNULEE, actor: { id: client.id, role: R.CLIENT } }),
      "FORBIDDEN"
    );
  });

  it("lets only an assigned driver perform the delivery steps", async () => {
    const { admin, order } = await setup();
    const driver = await makeUser(R.LIVREUR);
    const adminActor = { id: admin.id, role: R.ADMIN };
    const driverActor = { id: driver.id, role: R.LIVREUR };

    await changeOrderStatus(db, { orderId: order.id, to: S.EN_PREPARATION, actor: adminActor });
    // A driver may not do admin steps.
    await expectOrderError(
      changeOrderStatus(db, { orderId: order.id, to: S.EXPEDIEE, actor: driverActor, driverAssigned: true }),
      "FORBIDDEN"
    );
    await changeOrderStatus(db, { orderId: order.id, to: S.EXPEDIEE, actor: adminActor });
    // Not assigned: refused.
    await expectOrderError(
      changeOrderStatus(db, { orderId: order.id, to: S.EN_LIVRAISON, actor: driverActor, driverAssigned: false }),
      "FORBIDDEN"
    );
    // Assigned: allowed.
    const out = await changeOrderStatus(db, { orderId: order.id, to: S.EN_LIVRAISON, actor: driverActor, driverAssigned: true });
    expect(out.statut).toBe(S.EN_LIVRAISON);
  });

  it("reports an unknown order", async () => {
    const admin = await makeUser(R.ADMIN);
    await expectOrderError(
      changeOrderStatus(db, { orderId: "missing", to: S.EN_PREPARATION, actor: { id: admin.id, role: R.ADMIN } }),
      "ORDER_NOT_FOUND"
    );
  });

  it("allows only one of two simultaneous conflicting changes", async () => {
    const { admin, order } = await setup();
    const actor = { id: admin.id, role: R.ADMIN };
    const results = await Promise.allSettled([
      changeOrderStatus(db, { orderId: order.id, to: S.EN_PREPARATION, actor }),
      changeOrderStatus(db, { orderId: order.id, to: S.ANNULEE, actor }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.historiqueStatutCommande.count({ where: { commandeId: order.id } })).toBe(2);
  });
});

describe("getOrderHistory", () => {
  it("is visible to the owner and the admin, but not to another customer", async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const admin = await makeUser(R.ADMIN);
    const product = await makeProduct();
    const order = await place(owner.id, [{ produitId: product.id, quantite: 1 }]);

    const mine = await getOrderHistory(db, order.id, { id: owner.id, role: R.CLIENT });
    expect(mine.history).toHaveLength(1);
    expect(mine.currentStatus).toBe(S.EN_COURS);

    const asAdmin = await getOrderHistory(db, order.id, { id: admin.id, role: R.ADMIN });
    expect(asAdmin.history).toHaveLength(1);

    await expect(getOrderHistory(db, order.id, { id: other.id, role: R.CLIENT })).rejects.toBeInstanceOf(OrderError);
    await expectOrderError(getOrderHistory(db, "missing", { id: owner.id, role: R.CLIENT }), "ORDER_NOT_FOUND");
  });
});

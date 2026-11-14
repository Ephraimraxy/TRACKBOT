import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { CommandeStatut as S, NotificationType, UserRole as R } from "@prisma/client";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { auth } from "@/lib/auth";
import { POST as assignRoute } from "@/app/api/orders/[orderId]/assign/route";
import { GET as driversRoute } from "@/app/api/drivers/route";
import { GET as myDeliveriesRoute } from "@/app/api/delivery/orders/route";
import { PATCH as driverStatusRoute } from "@/app/api/delivery/orders/[orderId]/status/route";
import { changeOrderStatus, createOrder } from "@/lib/services/orderService";
import { GET as boardRoute } from "@/app/api/deliveries/route";
import {
  assignDriver,
  driverChangeStatus,
  listDeliveryBoard,
  listDriverDeliveries,
  listDrivers,
} from "@/lib/services/deliveryService";
import { address, db, makeProduct, makeUser, resetDb } from "./helpers";

const mockedAuth = vi.mocked(auth) as unknown as ReturnType<typeof vi.fn>;
const loginAs = (u: { id: string; role: R } | null) =>
  mockedAuth.mockResolvedValue(u ? { user: { id: u.id, role: u.role } } : null);

const req = (method: string, body?: unknown) =>
  new NextRequest("http://localhost/api/test", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = (orderId: string) => ({ params: Promise.resolve({ orderId }) });

const STEPS = [S.EN_PREPARATION, S.EXPEDIEE, S.EN_LIVRAISON, S.LIVREE];

/** Create an order for `client` and move it (as admin) up to `status`. */
async function orderAt(client: { id: string }, admin: { id: string }, status: S = S.EN_COURS) {
  const product = await makeProduct({ stock: 50 });
  const { order } = await createOrder(db, {
    userId: client.id,
    addresse: address,
    produits: [{ produitId: product.id, quantite: 1 }],
  });
  if (status === S.ANNULEE) {
    await changeOrderStatus(db, { orderId: order.id, to: S.ANNULEE, actor: { id: admin.id, role: R.ADMIN } });
    return order.id;
  }
  for (const step of STEPS) {
    if (status === S.EN_COURS) break;
    await changeOrderStatus(db, { orderId: order.id, to: step, actor: { id: admin.id, role: R.ADMIN } });
    if (step === status) break;
  }
  return order.id;
}

async function world() {
  const client = await makeUser();
  const admin = await makeUser(R.ADMIN);
  const driver = await makeUser(R.LIVREUR);
  const otherDriver = await makeUser(R.LIVREUR);
  return { client, admin, driver, otherDriver };
}

const adminActor = (u: { id: string }) => ({ id: u.id, role: R.ADMIN });
const driverActor = (u: { id: string }) => ({ id: u.id, role: R.LIVREUR });

beforeEach(async () => {
  await resetDb();
  mockedAuth.mockReset();
});
afterAll(() => db.$disconnect());

describe("assignDriver", () => {
  it("assigns a driver, stores one delivery row and notifies the driver", async () => {
    const { client, admin, driver } = await world();
    const orderId = await orderAt(client, admin, S.EXPEDIEE);

    const livraison = await assignDriver(db, { orderId, driverId: driver.id, actor: adminActor(admin) });

    expect(livraison).toMatchObject({ commandeId: orderId, livreurId: driver.id, assigneParId: admin.id });
    const notes = await db.notification.findMany({ where: { userId: driver.id } });
    expect(notes).toHaveLength(1);
    expect(notes[0].type).toBe(NotificationType.LIVRAISON);
  });

  it("reassigning replaces the driver and keeps a single row", async () => {
    const { client, admin, driver, otherDriver } = await world();
    const orderId = await orderAt(client, admin, S.EXPEDIEE);
    await assignDriver(db, { orderId, driverId: driver.id, actor: adminActor(admin) });
    await assignDriver(db, { orderId, driverId: otherDriver.id, actor: adminActor(admin) });

    const rows = await db.livraison.findMany({ where: { commandeId: orderId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].livreurId).toBe(otherDriver.id);
  });

  it("only the admin may assign", async () => {
    const { client, admin, driver } = await world();
    const orderId = await orderAt(client, admin);
    for (const actor of [{ id: client.id, role: R.CLIENT }, driverActor(driver)]) {
      await expect(assignDriver(db, { orderId, driverId: driver.id, actor })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await db.livraison.count()).toBe(0);
  });

  it("rejects a target who is not a delivery person, or does not exist", async () => {
    const { client, admin } = await world();
    const orderId = await orderAt(client, admin);
    await expect(assignDriver(db, { orderId, driverId: client.id, actor: adminActor(admin) })).rejects.toMatchObject({ code: "INVALID_DRIVER" });
    await expect(assignDriver(db, { orderId, driverId: "ghost", actor: adminActor(admin) })).rejects.toMatchObject({ code: "INVALID_DRIVER" });
  });

  it("rejects an unknown order and orders that are out for delivery, delivered or cancelled", async () => {
    const { client, admin, driver } = await world();
    await expect(assignDriver(db, { orderId: "missing", driverId: driver.id, actor: adminActor(admin) })).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });

    for (const status of [S.EN_LIVRAISON, S.LIVREE, S.ANNULEE]) {
      const orderId = await orderAt(client, admin, status);
      await expect(assignDriver(db, { orderId, driverId: driver.id, actor: adminActor(admin) })).rejects.toMatchObject({ code: "NOT_ASSIGNABLE" });
    }
  });
});

describe("delivery board (admin)", () => {
  it("lists assignable and in-delivery orders with their driver, excluding delivered and cancelled", async () => {
    const { client, admin, driver } = await world();
    const open = await orderAt(client, admin, S.EXPEDIEE);
    const rolling = await orderAt(client, admin, S.EN_LIVRAISON);
    await orderAt(client, admin, S.LIVREE);
    await orderAt(client, admin, S.ANNULEE);
    await assignDriver(db, { orderId: open, driverId: driver.id, actor: adminActor(admin) });

    const board = await listDeliveryBoard(db, adminActor(admin));
    expect(board.map((o) => o.id).sort()).toEqual([open, rolling].sort());
    expect(board.find((o) => o.id === open)?.livraison?.livreur.id).toBe(driver.id);
    expect(board.find((o) => o.id === rolling)?.livraison).toBeNull();
  });

  it("GET /api/deliveries: 401, 403 for customer and driver, 200 for admin", async () => {
    const { client, admin, driver } = await world();
    loginAs(null);
    expect((await boardRoute()).status).toBe(401);
    loginAs(client);
    expect((await boardRoute()).status).toBe(403);
    loginAs(driver);
    expect((await boardRoute()).status).toBe(403);
    loginAs(admin);
    expect((await boardRoute()).status).toBe(200);
  });
});

describe("driver deliveries", () => {
  it("a driver sees only their own deliveries, not cancelled ones", async () => {
    const { client, admin, driver, otherDriver } = await world();
    const mine = await orderAt(client, admin, S.EXPEDIEE);
    const theirs = await orderAt(client, admin, S.EXPEDIEE);
    const cancelled = await orderAt(client, admin, S.EN_COURS);
    await assignDriver(db, { orderId: mine, driverId: driver.id, actor: adminActor(admin) });
    await assignDriver(db, { orderId: theirs, driverId: otherDriver.id, actor: adminActor(admin) });
    await assignDriver(db, { orderId: cancelled, driverId: driver.id, actor: adminActor(admin) });
    await changeOrderStatus(db, { orderId: cancelled, to: S.ANNULEE, actor: adminActor(admin) });

    const list = await listDriverDeliveries(db, driverActor(driver));
    expect(list.map((d) => d.commande.id)).toEqual([mine]);
    expect(list[0].commande.adresse?.ville).toBe(address.ville);
  });

  it("customers and admins cannot use the driver list, and only the admin may list drivers", async () => {
    const { client, admin } = await world();
    await expect(listDriverDeliveries(db, { id: client.id, role: R.CLIENT })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listDriverDeliveries(db, adminActor(admin))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listDrivers(db, { id: client.id, role: R.CLIENT })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await listDrivers(db, adminActor(admin))).toHaveLength(2);
  });
});

describe("driverChangeStatus", () => {
  it("assigned driver completes the delivery; history and customer notifications follow", async () => {
    const { client, admin, driver } = await world();
    const orderId = await orderAt(client, admin, S.EXPEDIEE);
    await assignDriver(db, { orderId, driverId: driver.id, actor: adminActor(admin) });
    const before = await db.notification.count({ where: { userId: client.id } });

    await driverChangeStatus(db, { orderId, to: S.EN_LIVRAISON, actor: driverActor(driver) });
    await driverChangeStatus(db, { orderId, to: S.LIVREE, actor: driverActor(driver), note: "Handed to customer" });

    const last = await db.historiqueStatutCommande.findMany({ where: { commandeId: orderId }, orderBy: { date: "asc" } });
    expect(last.at(-2)).toMatchObject({ nouveauStatut: S.EN_LIVRAISON, modifieParId: driver.id });
    expect(last.at(-1)).toMatchObject({ nouveauStatut: S.LIVREE, modifieParId: driver.id, note: "Handed to customer" });
    expect((await db.commande.findUniqueOrThrow({ where: { id: orderId } })).statut).toBe(S.LIVREE);

    const notes = await db.notification.findMany({ where: { userId: client.id }, orderBy: { date: "asc" } });
    expect(notes.length - before).toBe(2);
    expect(notes.at(-1)?.type).toBe(NotificationType.LIVRAISON);
  });

  it("refuses a driver who is not assigned (same answer whether or not the order exists)", async () => {
    const { client, admin, driver, otherDriver } = await world();
    const orderId = await orderAt(client, admin, S.EXPEDIEE);
    await assignDriver(db, { orderId, driverId: driver.id, actor: adminActor(admin) });

    await expect(driverChangeStatus(db, { orderId, to: S.EN_LIVRAISON, actor: driverActor(otherDriver) })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(driverChangeStatus(db, { orderId: "missing", to: S.EN_LIVRAISON, actor: driverActor(driver) })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await db.commande.findUniqueOrThrow({ where: { id: orderId } })).statut).toBe(S.EXPEDIEE);
  });

  it("an assigned driver still cannot do admin steps, skip steps or cancel", async () => {
    const { client, admin, driver } = await world();
    const orderId = await orderAt(client, admin, S.EN_PREPARATION);
    await assignDriver(db, { orderId, driverId: driver.id, actor: adminActor(admin) });

    // Assigning already made the order Ready for delivery, so there is no admin step left for the driver to take.
    await expect(driverChangeStatus(db, { orderId, to: S.EN_PREPARATION, actor: driverActor(driver) })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await expect(driverChangeStatus(db, { orderId, to: S.LIVREE, actor: driverActor(driver) })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await expect(driverChangeStatus(db, { orderId, to: S.ANNULEE, actor: driverActor(driver) })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("only delivery personnel may use it", async () => {
    const { client, admin } = await world();
    const orderId = await orderAt(client, admin, S.EXPEDIEE);
    await expect(driverChangeStatus(db, { orderId, to: S.EN_LIVRAISON, actor: adminActor(admin) })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("customer notification on status change", () => {
  it("creates one notification per admin status change, linking to the orders page", async () => {
    const { client, admin } = await world();
    const orderId = await orderAt(client, admin);
    const before = await db.notification.count({ where: { userId: client.id } });

    await changeOrderStatus(db, { orderId, to: S.EN_PREPARATION, actor: adminActor(admin) });

    const notes = await db.notification.findMany({ where: { userId: client.id }, orderBy: { date: "desc" }, take: 1 });
    expect(await db.notification.count({ where: { userId: client.id } })).toBe(before + 1);
    expect(notes[0]).toMatchObject({ type: NotificationType.COMMANDE, urlRedirection: "/client/orders" });
    expect(notes[0].text).toContain("Preparing");
  });
});

describe("delivery routes", () => {
  it("POST /api/orders/:id/assign: 401, 403, 400, 404, 409, 200", async () => {
    const { client, admin, driver } = await world();
    const orderId = await orderAt(client, admin, S.EXPEDIEE);
    const delivered = await orderAt(client, admin, S.LIVREE);

    loginAs(null);
    expect((await assignRoute(req("POST", { driverId: driver.id }), ctx(orderId))).status).toBe(401);
    loginAs(client);
    expect((await assignRoute(req("POST", { driverId: driver.id }), ctx(orderId))).status).toBe(403);
    loginAs(driver);
    expect((await assignRoute(req("POST", { driverId: driver.id }), ctx(orderId))).status).toBe(403);

    loginAs(admin);
    expect((await assignRoute(req("POST", {}), ctx(orderId))).status).toBe(400);
    expect((await assignRoute(req("POST", { driverId: client.id }), ctx(orderId))).status).toBe(400);
    expect((await assignRoute(req("POST", { driverId: driver.id }), ctx("missing"))).status).toBe(404);
    expect((await assignRoute(req("POST", { driverId: driver.id }), ctx(delivered))).status).toBe(409);
    expect((await assignRoute(req("POST", { driverId: driver.id }), ctx(orderId))).status).toBe(200);
  });

  it("GET /api/drivers: 401, 403 for a customer, 200 for the admin", async () => {
    const { client, admin } = await world();
    loginAs(null);
    expect((await driversRoute()).status).toBe(401);
    loginAs(client);
    expect((await driversRoute()).status).toBe(403);
    loginAs(admin);
    const res = await driversRoute();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toHaveLength(2);
  });

  it("GET /api/delivery/orders: only a delivery person, and only their orders", async () => {
    const { client, admin, driver, otherDriver } = await world();
    const mine = await orderAt(client, admin, S.EXPEDIEE);
    const theirs = await orderAt(client, admin, S.EXPEDIEE);
    await assignDriver(db, { orderId: mine, driverId: driver.id, actor: adminActor(admin) });
    await assignDriver(db, { orderId: theirs, driverId: otherDriver.id, actor: adminActor(admin) });

    loginAs(null);
    expect((await myDeliveriesRoute()).status).toBe(401);
    loginAs(client);
    expect((await myDeliveriesRoute()).status).toBe(403);
    loginAs(admin);
    expect((await myDeliveriesRoute()).status).toBe(403);

    loginAs(driver);
    const res = await myDeliveriesRoute();
    expect(res.status).toBe(200);
    const ids = (await res.json()).data.map((d: { commande: { id: string } }) => d.commande.id);
    expect(ids).toEqual([mine]);
  });

  it("PATCH /api/delivery/orders/:id/status: 401, 403, 400, 409, 200", async () => {
    const { client, admin, driver, otherDriver } = await world();
    const orderId = await orderAt(client, admin, S.EXPEDIEE);
    await assignDriver(db, { orderId, driverId: driver.id, actor: adminActor(admin) });

    loginAs(null);
    expect((await driverStatusRoute(req("PATCH", { statut: S.EN_LIVRAISON }), ctx(orderId))).status).toBe(401);
    loginAs(admin); // admin has its own endpoint
    expect((await driverStatusRoute(req("PATCH", { statut: S.EN_LIVRAISON }), ctx(orderId))).status).toBe(403);
    loginAs(otherDriver); // not assigned
    expect((await driverStatusRoute(req("PATCH", { statut: S.EN_LIVRAISON }), ctx(orderId))).status).toBe(403);

    loginAs(driver);
    expect((await driverStatusRoute(req("PATCH", { statut: "BOGUS" }), ctx(orderId))).status).toBe(400);
    expect((await driverStatusRoute(req("PATCH", { statut: S.LIVREE }), ctx(orderId))).status).toBe(409); // skipped a step
    const ok = await driverStatusRoute(req("PATCH", { statut: S.EN_LIVRAISON }), ctx(orderId));
    expect(ok.status).toBe(200);
    expect((await ok.json()).data.statut).toBe(S.EN_LIVRAISON);
  });
});

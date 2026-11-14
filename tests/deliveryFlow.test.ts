import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CommandeStatut as S, NotificationType, PaiementStatut as P, UserRole as R } from "@prisma/client";

import { assignDriver, driverChangeStatus } from "@/lib/services/deliveryService";
import { changeOrderStatus } from "@/lib/services/orderService";
import { confirmPayment, initializePayment, toKobo } from "@/lib/services/paymentService";
import { getTracking } from "@/lib/services/trackingService";
import type { PaystackClient } from "@/lib/payments/paystack";
import { adminActor, clientActor, driverActor, orderAt, world } from "./flow";
import { db, makeUser, resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(() => db.$disconnect());

const notesFor = (userId: string) => db.notification.findMany({ where: { userId }, orderBy: { date: "asc" } });
const statusOf = async (id: string) => (await db.commande.findUniqueOrThrow({ where: { id } })).statut;

/** An order that has been processed, shipped and assigned, and that the driver has started. */
async function onTheRoad() {
  const w = await world();
  const orderId = await orderAt(w.client, w.admin, S.EXPEDIEE);
  await assignDriver(db, { orderId, driverId: w.driver.id, actor: adminActor(w.admin) });
  await driverChangeStatus(db, { orderId, to: S.EN_LIVRAISON, actor: driverActor(w.driver) });
  return { ...w, orderId };
}

describe("the owner processes the order, then assigns a delivery person", () => {
  it("assigning does not change the status; the owner moves Pending -> Processing -> Shipped himself", async () => {
    const { client, admin, driver } = await world();
    const orderId = await orderAt(client, admin); // Pending
    await assignDriver(db, { orderId, driverId: driver.id, actor: adminActor(admin) });
    expect(await statusOf(orderId)).toBe(S.EN_COURS);

    // The driver cannot start an order the shop has not shipped yet.
    await expect(driverChangeStatus(db, { orderId, to: S.EN_LIVRAISON, actor: driverActor(driver) })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });

    await changeOrderStatus(db, { orderId, to: S.EN_PREPARATION, actor: adminActor(admin) });
    await changeOrderStatus(db, { orderId, to: S.EXPEDIEE, actor: adminActor(admin) });
    await driverChangeStatus(db, { orderId, to: S.EN_LIVRAISON, actor: driverActor(driver) });
    expect(await statusOf(orderId)).toBe(S.EN_LIVRAISON);
  });
});

describe("a delivery stays open until the customer confirms that they received the order", () => {
  it("the driver's Delivered does not close it: the map stays and the customer is asked to confirm", async () => {
    const { client, admin, driver, orderId } = await onTheRoad();

    await driverChangeStatus(db, { orderId, to: S.LIVREE, actor: driverActor(driver) });

    expect(await statusOf(orderId)).toBe(S.LIVREE);
    const t = await getTracking(db, { orderId, actor: clientActor(client) });
    expect(t).toMatchObject({ awaitingConfirmation: true, mapOpen: true });
    expect((await notesFor(client.id)).at(-1)).toMatchObject({ objet: "Your order has arrived", urlRedirection: `/client/orders/${orderId}/track` });
    expect((await notesFor(admin.id)).some((n) => n.objet === "Order delivered")).toBe(true);
  });

  it("only the customer who owns the order can close it", async () => {
    const { client, driver, orderId } = await onTheRoad();
    await driverChangeStatus(db, { orderId, to: S.LIVREE, actor: driverActor(driver) });
    const stranger = await makeUser();

    await expect(changeOrderStatus(db, { orderId, to: S.RECUE, actor: { id: stranger.id, role: R.CLIENT } })).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
    // the driver cannot close it either: only the customer (or the shop owner) says "received"
    await expect(changeOrderStatus(db, { orderId, to: S.RECUE, actor: driverActor(driver), driverAssigned: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await statusOf(orderId)).toBe(S.LIVREE);

    await changeOrderStatus(db, { orderId, to: S.RECUE, actor: { id: client.id, role: R.CLIENT } });
    expect(await statusOf(orderId)).toBe(S.RECUE);
  });

  it("a customer cannot confirm receipt before the driver has delivered it, or do any other step", async () => {
    const { client, orderId } = await onTheRoad(); // still out for delivery
    await expect(changeOrderStatus(db, { orderId, to: S.RECUE, actor: { id: client.id, role: R.CLIENT } })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await expect(changeOrderStatus(db, { orderId, to: S.ANNULEE, actor: { id: client.id, role: R.CLIENT } })).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("confirming receipt closes the delivery: the owner and the driver are told and the position is hidden", async () => {
    const { client, admin, driver, orderId } = await onTheRoad();
    await driverChangeStatus(db, { orderId, to: S.LIVREE, actor: driverActor(driver) });

    await changeOrderStatus(db, { orderId, to: S.RECUE, actor: { id: client.id, role: R.CLIENT }, note: "Receipt confirmed by the customer" });

    expect((await notesFor(admin.id)).some((n) => n.objet === "Order received")).toBe(true);
    expect((await notesFor(driver.id)).at(-1)?.objet).toBe("Delivery confirmed");
    // the customer is not told about their own action
    expect((await notesFor(client.id)).some((n) => n.objet === "Update on your order" && n.text.includes("Received"))).toBe(false);
    const t = await getTracking(db, { orderId, actor: clientActor(client) });
    expect(t).toMatchObject({ status: S.RECUE, mapOpen: false, location: null });
  });

  it("the shop owner can close a delivery that the customer never confirms", async () => {
    const { admin, driver, orderId } = await onTheRoad();
    await driverChangeStatus(db, { orderId, to: S.LIVREE, actor: driverActor(driver) });
    await changeOrderStatus(db, { orderId, to: S.RECUE, actor: adminActor(admin), note: "Closed by the shop owner" });
    expect(await statusOf(orderId)).toBe(S.RECUE);
  });
});

describe("the owner is told about every order, whoever placed it", () => {
  it("is notified when an order is placed", async () => {
    const { client, admin } = await world();
    const orderId = await orderAt(client, admin);
    const notes = await notesFor(admin.id);
    expect(notes.some((n) => n.objet === "New order" && n.text.includes(orderId.slice(-8)))).toBe(true);
  });

  it("is notified when a delivery starts, with a link to watch it live; the customer is told to follow on the map", async () => {
    const { client, admin, orderId } = await onTheRoad();
    const started = (await notesFor(admin.id)).find((n) => n.objet === "Delivery started");
    expect(started).toMatchObject({ type: NotificationType.LIVRAISON, urlRedirection: `/admin/deliveries/${orderId}/track` });
    expect((await notesFor(client.id)).at(-1)).toMatchObject({ objet: "Your order is on the way", urlRedirection: `/client/orders/${orderId}/track` });
  });

  it("is told when a payment arrives, so they know the order can be processed", async () => {
    const { client, admin } = await world();
    const orderId = await orderAt(client, admin);
    const order = await db.commande.findUniqueOrThrow({ where: { id: orderId } });
    const paystack: PaystackClient = {
      async initialize(a) {
        return { authorizationUrl: `https://checkout.paystack.com/${a.reference}`, reference: a.reference };
      },
      async verify(reference) {
        return { status: "success", reference, amount: toKobo(order.montant), currency: "NGN", channel: "card", paidAt: new Date().toISOString() };
      },
    };
    const { reference } = await initializePayment(db, paystack, { orderId, userId: client.id, email: "c@shop.test", callbackUrl: "http://localhost/cb" });
    await confirmPayment(db, paystack, { reference, userId: client.id });

    expect((await db.paiementCommande.findUniqueOrThrow({ where: { commandeId: orderId } })).statut).toBe(P.VALIDE);
    expect((await notesFor(admin.id)).some((n) => n.objet === "Payment received")).toBe(true);
  });
});

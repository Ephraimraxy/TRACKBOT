import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CommandeStatut as S, NotificationType, PaiementStatut as P } from "@prisma/client";

import { assignDriver, driverChangeStatus } from "@/lib/services/deliveryService";
import { confirmPayment, initializePayment, toKobo } from "@/lib/services/paymentService";
import type { PaystackClient } from "@/lib/payments/paystack";
import { adminActor, driverActor, orderAt, world } from "./flow";
import { db, resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(() => db.$disconnect());

const notesFor = (userId: string) => db.notification.findMany({ where: { userId }, orderBy: { date: "asc" } });

describe("the owner's only job is to assign a delivery person", () => {
  it("assigning a newly placed order makes it Ready for delivery, with history and a message to the customer", async () => {
    const { client, admin, driver } = await world();
    const orderId = await orderAt(client, admin); // just placed: status EN_COURS

    await assignDriver(db, { orderId, driverId: driver.id, actor: adminActor(admin) });

    expect((await db.commande.findUniqueOrThrow({ where: { id: orderId } })).statut).toBe(S.EXPEDIEE);
    const history = await db.historiqueStatutCommande.findMany({ where: { commandeId: orderId }, orderBy: { date: "asc" } });
    expect(history.at(-1)).toMatchObject({ ancienStatut: S.EN_COURS, nouveauStatut: S.EXPEDIEE, modifieParId: admin.id, note: "Delivery person assigned" });
    const customerNotes = await notesFor(client.id);
    expect(customerNotes.at(-1)).toMatchObject({ type: NotificationType.LIVRAISON, objet: "A delivery person is assigned" });
    expect((await notesFor(driver.id)).at(-1)?.objet).toBe("New delivery assigned");
  });

  it("the driver can start straight away, with no further step by the owner", async () => {
    const { client, admin, driver } = await world();
    const orderId = await orderAt(client, admin);
    await assignDriver(db, { orderId, driverId: driver.id, actor: adminActor(admin) });

    await driverChangeStatus(db, { orderId, to: S.EN_LIVRAISON, actor: driverActor(driver) });

    expect((await db.commande.findUniqueOrThrow({ where: { id: orderId } })).statut).toBe(S.EN_LIVRAISON);
  });

  it("reassigning an order that is already Ready for delivery does not add a second status change", async () => {
    const { client, admin, driver } = await world();
    const orderId = await orderAt(client, admin);
    await assignDriver(db, { orderId, driverId: driver.id, actor: adminActor(admin) });
    const before = await db.historiqueStatutCommande.count({ where: { commandeId: orderId } });

    await assignDriver(db, { orderId, driverId: driver.id, actor: adminActor(admin) });

    expect(await db.historiqueStatutCommande.count({ where: { commandeId: orderId } })).toBe(before);
  });
});

describe("the owner is told about every order, whoever placed it", () => {
  it("is notified when an order is placed", async () => {
    const { client, admin } = await world();
    const orderId = await orderAt(client, admin);

    const notes = await notesFor(admin.id);
    expect(notes.some((n) => n.objet === "New order" && n.text.includes(orderId.slice(-8)))).toBe(true);
  });

  it("is notified when a delivery starts (with a link to watch it live) and when it is delivered", async () => {
    const { client, admin, driver } = await world();
    const orderId = await orderAt(client, admin);
    await assignDriver(db, { orderId, driverId: driver.id, actor: adminActor(admin) });

    await driverChangeStatus(db, { orderId, to: S.EN_LIVRAISON, actor: driverActor(driver) });
    const started = (await notesFor(admin.id)).find((n) => n.objet === "Delivery started");
    expect(started).toMatchObject({ type: NotificationType.LIVRAISON, urlRedirection: `/admin/deliveries/${orderId}/track` });
    // and the customer is told to follow the driver on the map
    expect((await notesFor(client.id)).at(-1)).toMatchObject({ objet: "Your order is on the way", urlRedirection: `/client/orders/${orderId}/track` });

    await driverChangeStatus(db, { orderId, to: S.LIVREE, actor: driverActor(driver) });
    expect((await notesFor(admin.id)).some((n) => n.objet === "Order delivered")).toBe(true);
  });

  it("is told when a payment arrives, so they know to assign a delivery person", async () => {
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
    expect((await notesFor(admin.id)).some((n) => n.objet === "Payment received" && n.text.includes("Assign a delivery person"))).toBe(true);
  });
});

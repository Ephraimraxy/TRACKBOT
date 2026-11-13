import bcrypt from "bcryptjs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CommandeStatut as S, UserRole as R } from "@prisma/client";

import { assignDriver, createDriver, DriverError, listDrivers, removeDriver } from "@/lib/services/deliveryService";
import { OrderError } from "@/lib/services/orderService";
import { createDriverSchema } from "@/lib/validations/driver";
import { adminActor, clientActor, orderAt, world } from "./flow";
import { db, resetDb } from "./helpers";

// A fast stand-in for bcrypt so the tests stay quick; one test checks the real hash too.
const fastHash = async (plain: string) => `hashed:${plain}`;

const input = { prenom: "Musa", nom: "Bello", email: "musa@shop.test", tel: "08012345678", password: "start-123" };

beforeEach(resetDb);
afterAll(() => db.$disconnect());

describe("registering a delivery person", () => {
  it("creates a verified delivery account that can sign in straight away", async () => {
    const { admin } = await world();
    const driver = await createDriver(db, adminActor(admin), input, (p) => bcrypt.hash(p, 4));

    const stored = await db.user.findUniqueOrThrow({ where: { id: driver.id } });
    expect(stored).toMatchObject({ role: R.LIVREUR, emailVerifie: true, email: "musa@shop.test", tel: "08012345678", prenom: "Musa", nom: "Bello" });
    expect(stored.password).not.toBe("start-123");
    expect(await bcrypt.compare("start-123", stored.password)).toBe(true);
  });

  it("shows the new person in the list the admin assigns orders from, with an email", async () => {
    const { admin } = await world();
    await createDriver(db, adminActor(admin), input, fastHash);
    const list = await listDrivers(db, adminActor(admin));
    expect(list.map((d) => d.email)).toContain("musa@shop.test");
  });

  it("lets the admin assign an order to the new person", async () => {
    const { admin, client } = await world();
    const driver = await createDriver(db, adminActor(admin), input, fastHash);
    const orderId = await orderAt(client, admin);
    const result = await assignDriver(db, { orderId, driverId: driver.id, actor: adminActor(admin) });
    expect(result).toBeTruthy();
    expect((await db.livraison.findUniqueOrThrow({ where: { commandeId: orderId } })).livreurId).toBe(driver.id);
  });

  it("is for the administrator only", async () => {
    const { client, driver } = await world();
    await expect(createDriver(db, clientActor(client), input, fastHash)).rejects.toBeInstanceOf(OrderError);
    await expect(createDriver(db, { id: driver.id, role: R.LIVREUR }, input, fastHash)).rejects.toBeInstanceOf(OrderError);
    expect(await db.user.count({ where: { email: input.email } })).toBe(0);
  });

  it("refuses an email that is already registered, in any case", async () => {
    const { admin, client } = await world();
    await expect(createDriver(db, adminActor(admin), { ...input, email: client.email.toUpperCase() }, fastHash)).rejects.toMatchObject({
      code: "EMAIL_TAKEN",
    });
  });

  it("refuses the administrator's own email, even before that account exists", async () => {
    const { admin } = await world();
    await expect(
      createDriver(db, adminActor(admin), { ...input, email: "Owner@Shop.test" }, fastHash, "owner@shop.test")
    ).rejects.toBeInstanceOf(DriverError);
    expect(await db.user.count({ where: { email: "owner@shop.test" } })).toBe(0);
  });
});

describe("what the admin may type", () => {
  it("needs a name, a valid email and a password of at least 6 characters", () => {
    expect(createDriverSchema.safeParse(input).success).toBe(true);
    expect(createDriverSchema.safeParse({ ...input, password: "12345" }).success).toBe(false);
    expect(createDriverSchema.safeParse({ ...input, password: "123456" }).success).toBe(true);
    expect(createDriverSchema.safeParse({ ...input, email: "not-an-email" }).success).toBe(false);
    expect(createDriverSchema.safeParse({ ...input, prenom: "M" }).success).toBe(false);
    expect(createDriverSchema.safeParse({ ...input, tel: "abc" }).success).toBe(false);
  });

  it("treats the phone number as optional and lowercases the email", () => {
    const parsed = createDriverSchema.parse({ ...input, tel: "", email: "MUSA@Shop.TEST" });
    expect(parsed.tel).toBeUndefined();
    expect(parsed.email).toBe("musa@shop.test");
  });
});

describe("removing a delivery person", () => {
  it("deletes someone who never delivered anything", async () => {
    const { admin, driver } = await world();
    const result = await removeDriver(db, adminActor(admin), driver.id);
    expect(result.removed).toBe("deleted");
    expect(await db.user.findUnique({ where: { id: driver.id } })).toBeNull();
  });

  it("keeps the delivery history: a past driver becomes an ordinary customer", async () => {
    const { admin, client, driver } = await world();
    const orderId = await orderAt(client, admin, S.EXPEDIEE);
    await assignDriver(db, { orderId, driverId: driver.id, actor: adminActor(admin) });
    await db.commande.update({ where: { id: orderId }, data: { statut: S.LIVREE } }); // finished

    const result = await removeDriver(db, adminActor(admin), driver.id);
    expect(result.removed).toBe("demoted");
    expect((await db.user.findUniqueOrThrow({ where: { id: driver.id } })).role).toBe(R.CLIENT);
    expect(await db.client.findUnique({ where: { id: driver.id } })).not.toBeNull();
    expect(await db.livraison.count({ where: { livreurId: driver.id } })).toBe(1); // the record survives
  });

  it("will not remove someone who still has an order to deliver", async () => {
    const { admin, client, driver } = await world();
    const orderId = await orderAt(client, admin, S.EXPEDIEE);
    await assignDriver(db, { orderId, driverId: driver.id, actor: adminActor(admin) });

    await expect(removeDriver(db, adminActor(admin), driver.id)).rejects.toMatchObject({ code: "HAS_ACTIVE_DELIVERIES" });
    expect((await db.user.findUniqueOrThrow({ where: { id: driver.id } })).role).toBe(R.LIVREUR);
  });

  it("only removes delivery people, only for the admin", async () => {
    const { admin, client, driver } = await world();
    await expect(removeDriver(db, adminActor(admin), client.id)).rejects.toMatchObject({ code: "DRIVER_NOT_FOUND" });
    await expect(removeDriver(db, adminActor(admin), "nobody")).rejects.toMatchObject({ code: "DRIVER_NOT_FOUND" });
    await expect(removeDriver(db, clientActor(client), driver.id)).rejects.toBeInstanceOf(OrderError);
  });
});

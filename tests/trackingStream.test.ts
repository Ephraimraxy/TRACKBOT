import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CommandeStatut as S } from "@prisma/client";

import { assignDriver, driverChangeStatus } from "@/lib/services/deliveryService";
import { changeOrderStatus } from "@/lib/services/orderService";
import { recordDriverLocation } from "@/lib/services/trackingService";
import { createTrackingWatcher } from "@/lib/services/trackingStream";
import { adminActor, clientActor, driverActor, orderAt, world } from "./flow";
import { db, makeUser, resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(() => db.$disconnect());

async function shipped() {
  const w = await world();
  const orderId = await orderAt(w.client, w.admin, S.EXPEDIEE);
  await assignDriver(db, { orderId, driverId: w.driver.id, actor: adminActor(w.admin) });
  return { ...w, orderId };
}

describe("live tracking watcher", () => {
  it("says nothing while nothing changes, then sends the full picture for each change", async () => {
    const { client, driver, orderId } = await shipped();
    const watcher = createTrackingWatcher(db, { orderId, actor: clientActor(client) });
    expect((await watcher.initial()).status).toBe(S.EXPEDIEE);
    expect(await watcher.check()).toBeNull();

    await driverChangeStatus(db, { orderId, to: S.EN_LIVRAISON, actor: driverActor(driver) });
    const started = await watcher.check();
    expect(started?.status).toBe(S.EN_LIVRAISON);
    expect(await watcher.check()).toBeNull();

    await recordDriverLocation(db, { orderId, actor: driverActor(driver), location: { latitude: 8.84, longitude: 7.87 }, now: new Date() });
    const moved = await watcher.check();
    expect(moved?.location).toMatchObject({ latitude: 8.84, longitude: 7.87 });
    expect(await watcher.check()).toBeNull();

    await recordDriverLocation(db, { orderId, actor: driverActor(driver), location: { latitude: 8.8405, longitude: 7.8705 }, now: new Date(Date.now() + 5000) });
    expect((await watcher.check())?.location).toMatchObject({ latitude: 8.8405 });
  });

  it("notices a status change made by someone else, such as the customer closing the delivery", async () => {
    const { client, admin, driver, orderId } = await shipped();
    await driverChangeStatus(db, { orderId, to: S.EN_LIVRAISON, actor: driverActor(driver) });
    await driverChangeStatus(db, { orderId, to: S.LIVREE, actor: driverActor(driver) });
    const watcher = createTrackingWatcher(db, { orderId, actor: adminActor(admin) });
    await watcher.initial();

    await changeOrderStatus(db, { orderId, to: S.RECUE, actor: clientActor(client) });
    expect((await watcher.check())?.status).toBe(S.RECUE);
  });

  it("does not let a stranger watch someone else's order", async () => {
    const { orderId } = await shipped();
    const stranger = await makeUser();
    await expect(createTrackingWatcher(db, { orderId, actor: clientActor(stranger) }).initial()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

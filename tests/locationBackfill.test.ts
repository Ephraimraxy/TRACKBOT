import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandeStatut as S } from "@prisma/client";

import { assignDriver, driverChangeStatus } from "@/lib/services/deliveryService";
import { getTracking, LATE_AFTER_SECONDS, recordDriverLocation, recordDriverLocations } from "@/lib/services/trackingService";
import { adminActor, clientActor, driverActor, orderAt, world } from "./flow";
import { db, resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(() => db.$disconnect());

async function onTheRoad() {
  const w = await world();
  const orderId = await orderAt(w.client, w.admin, S.EXPEDIEE);
  const order = await db.commande.findUniqueOrThrow({ where: { id: orderId }, select: { adresseId: true } });
  await db.adresse.update({ where: { id: order.adresseId! }, data: { latitude: 8.852, longitude: 7.879 } });
  await assignDriver(db, { orderId, driverId: w.driver.id, actor: adminActor(w.admin) });
  await driverChangeStatus(db, { orderId, to: S.EN_LIVRAISON, actor: driverActor(w.driver) });
  // the delivery started an hour ago, so queued points from the last few minutes belong to it
  await db.historiqueStatutCommande.updateMany({ where: { commandeId: orderId, nouveauStatut: S.EN_LIVRAISON }, data: { date: new Date(Date.now() - 3600_000) } });
  return { ...w, orderId };
}
const estimate = () => vi.fn(async () => ({ durationSeconds: 300, distanceMetres: 1000, source: "route" as const }));
const ago = (now: Date, s: number) => new Date(now.getTime() - s * 1000).toISOString();

describe("GPS capture times and offline backfill", () => {
  it("stores the time the phone captured the fix, separately from when the server got it", async () => {
    const { driver, orderId } = await onTheRoad();
    const now = new Date();
    const r = await recordDriverLocation(db, { orderId, actor: driverActor(driver), now, location: { latitude: 8.84, longitude: 7.87, capturedAt: ago(now, 4) } });
    const row = await db.positionLivraison.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.date.toISOString()).toBe(ago(now, 4));
    expect(row.receivedAt.getTime()).toBe(now.getTime());
    expect(row.backfilled).toBe(false);
  });

  it("treats a queued (late) batch as history: original times, oldest first, never the current position, estimate untouched", async () => {
    const { driver, client, orderId } = await onTheRoad();
    const now = new Date();
    const live = await recordDriverLocation(db, { orderId, actor: driverActor(driver), now, location: { latitude: 8.845, longitude: 7.875, capturedAt: ago(now, 1) }, estimate: estimate() });
    expect(live.backfilled).toBe(false);

    // the phone was offline: it now sends three older points, deliberately out of order
    const calc = estimate();
    const batch = await recordDriverLocations(db, {
      orderId, actor: driverActor(driver), now, estimate: calc,
      locations: [
        { latitude: 8.842, longitude: 7.872, capturedAt: ago(now, 120) },
        { latitude: 8.841, longitude: 7.871, capturedAt: ago(now, 180) },
        { latitude: 8.843, longitude: 7.873, capturedAt: ago(now, 60) },
      ],
    });
    expect(batch.results.map((r) => r.status)).toEqual(["saved", "saved", "saved"]);
    expect(batch.results.every((r) => r.status === "saved" && r.backfilled)).toBe(true);
    expect(calc).not.toHaveBeenCalled(); // history never moves the estimate or sends reminders

    const tracking = await getTracking(db, { orderId, actor: clientActor(client) });
    expect(tracking.location).toMatchObject({ latitude: 8.845, longitude: 7.875 }); // still the live point
    expect(tracking.trail.map((p) => p.latitude)).toEqual([8.841, 8.842, 8.843, 8.845]); // chronological by capture time
  });

  it("is idempotent: the same queued point sent twice is stored once", async () => {
    const { driver, orderId } = await onTheRoad();
    const now = new Date();
    const point = { latitude: 8.841, longitude: 7.871, capturedAt: ago(now, 90) };
    await recordDriverLocations(db, { orderId, actor: driverActor(driver), now, locations: [point] });
    const again = await recordDriverLocations(db, { orderId, actor: driverActor(driver), now, locations: [point] });
    expect(again.results[0].status).toBe("duplicate");
    expect(await db.positionLivraison.count({ where: { commandeId: orderId } })).toBe(1);
  });

  it("rejects impossible capture times, but keeps the good points in the same batch", async () => {
    const { driver, orderId } = await onTheRoad();
    const now = new Date();
    const out = await recordDriverLocations(db, {
      orderId, actor: driverActor(driver), now,
      locations: [
        { latitude: 8.84, longitude: 7.87, capturedAt: new Date(now.getTime() + 10 * 60_000).toISOString() }, // 10 min in the future
        { latitude: 8.84, longitude: 7.87, capturedAt: new Date(now.getTime() - 7 * 3600_000).toISOString() }, // 7 hours ago
        { latitude: 8.84, longitude: 7.87, capturedAt: "not a date" },
        { latitude: 8.84, longitude: 7.87, capturedAt: new Date(now.getTime() - 5 * 60_000).toISOString() }, // fine
      ],
    });
    expect(out.results.map((r) => r.status)).toEqual(["rejected", "rejected", "rejected", "saved"]);
    expect(await db.positionLivraison.count({ where: { commandeId: orderId } })).toBe(1);
  });

  it("accepts a small clock drift (a phone a few seconds ahead) as 'now'", async () => {
    const { driver, orderId } = await onTheRoad();
    const now = new Date();
    const r = await recordDriverLocation(db, { orderId, actor: driverActor(driver), now, location: { latitude: 8.84, longitude: 7.87, capturedAt: new Date(now.getTime() + 20_000).toISOString() } });
    expect((await db.positionLivraison.findUniqueOrThrow({ where: { id: r.id } })).date.getTime()).toBe(now.getTime());
  });

  it("still refuses other drivers, other roles and finished deliveries, however the points are timed", async () => {
    const { client, driver, orderId } = await onTheRoad();
    const now = new Date();
    const p = [{ latitude: 8.84, longitude: 7.87, capturedAt: ago(now, 60) }];
    await expect(recordDriverLocations(db, { orderId, actor: clientActor(client), locations: p, now })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(recordDriverLocations(db, { orderId, actor: driverActor(driver), locations: [], now })).rejects.toMatchObject({ code: "INVALID_LOCATION" });
    await driverChangeStatus(db, { orderId, to: S.LIVREE, actor: driverActor(driver) });
    await expect(recordDriverLocations(db, { orderId, actor: driverActor(driver), locations: p, now })).rejects.toMatchObject({ code: "TRACKING_INACTIVE" });
    expect(LATE_AFTER_SECONDS).toBeGreaterThan(0);
  });

  it("refuses points captured before the delivery started", async () => {
    const { driver, orderId } = await onTheRoad();
    const now = new Date();
    const out = await recordDriverLocations(db, { orderId, actor: driverActor(driver), now, locations: [{ latitude: 8.84, longitude: 7.87, capturedAt: new Date(now.getTime() - 2 * 3600_000).toISOString() }] });
    expect(out.results[0].status).toBe("rejected");
  });
});

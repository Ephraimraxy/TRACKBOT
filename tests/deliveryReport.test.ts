import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CommandeStatut as S } from "@prisma/client";

import { assignDriver, driverChangeStatus } from "@/lib/services/deliveryService";
import { recordDriverLocation } from "@/lib/services/trackingService";
import { getDeliveryAnalytics, getDeliveryReport } from "@/lib/services/deliveryReportService";
import { clearRouteCache, getRoutePlan } from "@/lib/services/routeService";
import { adminActor, clientActor, driverActor, orderAt, world } from "./flow";
import { db, resetDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
  clearRouteCache();
});
afterAll(() => db.$disconnect());

async function finishedDelivery() {
  const w = await world();
  const orderId = await orderAt(w.client, w.admin, S.EXPEDIEE);
  const order = await db.commande.findUniqueOrThrow({ where: { id: orderId }, select: { adresseId: true } });
  await db.adresse.update({ where: { id: order.adresseId! }, data: { latitude: 8.84, longitude: 7.88 } });
  await assignDriver(db, { orderId, driverId: w.driver.id, actor: adminActor(w.admin) });
  await driverChangeStatus(db, { orderId, to: S.EN_LIVRAISON, actor: driverActor(w.driver) });
  await db.historiqueStatutCommande.updateMany({ where: { commandeId: orderId, nouveauStatut: S.EN_LIVRAISON }, data: { date: new Date(Date.now() - 3600_000) } });
  const start = Date.now() - 20 * 60_000;
  for (let i = 0; i < 40; i++) {
    await db.positionLivraison.create({ data: { commandeId: orderId, livreurId: w.driver.id, latitude: 8.84, longitude: 7.87 + i * 0.00025, precision: 8, date: new Date(start + i * 30_000), backfilled: false } });
  }
  await driverChangeStatus(db, { orderId, to: S.LIVREE, actor: driverActor(w.driver) });
  return { ...w, orderId };
}

describe("delivery report (owner only)", () => {
  it("gives the owner the whole movement and what it shows", async () => {
    const { admin, orderId } = await finishedDelivery();
    const r = await getDeliveryReport(db, { orderId, actor: adminActor(admin) });
    expect(r.points).toHaveLength(40);
    expect(r.points[0].at).toBeLessThan(r.points[39].at);
    expect(r.analysis.distanceMetres).toBeGreaterThan(800);
    expect(r.destination).toEqual({ latitude: 8.84, longitude: 7.88 });
    expect(r.startedAt).toBeInstanceOf(Date);
    expect(r.deliveredAt).toBeInstanceOf(Date);
    expect(r.driver.name).toContain("LIVREUR");
    expect(r.analysis.deviations).toBeNull(); // no planned road was kept
  });

  it("is closed to customers, drivers and other roles, and unknown orders say not found", async () => {
    const { client, driver, orderId, admin } = await finishedDelivery();
    await expect(getDeliveryReport(db, { orderId, actor: clientActor(client) })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getDeliveryReport(db, { orderId, actor: driverActor(driver) })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getDeliveryReport(db, { orderId: "nope", actor: adminActor(admin) })).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
    await expect(getDeliveryAnalytics(db, { actor: clientActor(client) })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getDeliveryAnalytics(db, { actor: driverActor(driver) })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("keeps the first road route of a delivery, and uses it to judge deviation", async () => {
    const w = await world();
    const orderId = await orderAt(w.client, w.admin, S.EXPEDIEE);
    const order = await db.commande.findUniqueOrThrow({ where: { id: orderId }, select: { adresseId: true } });
    await db.adresse.update({ where: { id: order.adresseId! }, data: { latitude: 8.84, longitude: 7.88 } });
    await assignDriver(db, { orderId, driverId: w.driver.id, actor: adminActor(w.admin) });
    await driverChangeStatus(db, { orderId, to: S.EN_LIVRAISON, actor: driverActor(w.driver) });
    await recordDriverLocation(db, { orderId, actor: driverActor(w.driver), location: { latitude: 8.84, longitude: 7.87 }, now: new Date(), estimate: undefined });
    const road = async (from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }) => ({
      distanceMetres: 1100, durationSeconds: 200, source: "route" as const, geometry: [[from.longitude, from.latitude], [to.longitude, to.latitude]] as [number, number][], steps: [{ instruction: "Start", distanceMetres: 1100 }],
    });
    await getRoutePlan(db, { orderId, actor: adminActor(w.admin), plan: road });
    await new Promise((r) => setTimeout(r, 100));
    const kept = await db.livraison.findUniqueOrThrow({ where: { commandeId: orderId }, select: { routePlanifiee: true } });
    expect(kept.routePlanifiee).toEqual([[7.87, 8.84], [7.88, 8.84]]);

    // a later route does not overwrite the first
    clearRouteCache();
    await getRoutePlan(db, { orderId, actor: adminActor(w.admin), plan: async (f, t) => ({ ...(await road(f, t)), geometry: [[1, 1], [2, 2]] }), now: new Date(Date.now() + 60_000) });
    await new Promise((r) => setTimeout(r, 100));
    expect((await db.livraison.findUniqueOrThrow({ where: { commandeId: orderId }, select: { routePlanifiee: true } })).routePlanifiee).toEqual([[7.87, 8.84], [7.88, 8.84]]);

    const r = await getDeliveryReport(db, { orderId, actor: adminActor(w.admin) });
    expect(r.plannedRoute).toEqual([[7.87, 8.84], [7.88, 8.84]]);
    expect(r.analysis.deviations).toEqual([]);
  });
});

describe("delivery analytics (owner only)", () => {
  it("summarises finished deliveries per delivery person", async () => {
    const { admin, driver } = await finishedDelivery();
    const a = await getDeliveryAnalytics(db, { actor: adminActor(admin) });
    expect(a.deliveries).toBe(1);
    expect(a.averageMinutes).toBeGreaterThan(15);
    expect(a.averageKm).toBeGreaterThan(0.5);
    expect(a.drivers).toHaveLength(1);
    expect(a.drivers[0]).toMatchObject({ driverId: driver.id, deliveries: 1, withGpsProblems: 0 });
    expect(a.recent[0].tooFewPoints).toBe(false);
  });

  it("counts a delivery with too few GPS points as a GPS problem, and ignores unfinished deliveries", async () => {
    const { admin, orderId } = await finishedDelivery();
    await db.positionLivraison.deleteMany({ where: { commandeId: orderId, date: { gt: new Date(Date.now() - 19 * 60_000) } } });
    const a = await getDeliveryAnalytics(db, { actor: adminActor(admin) });
    expect(a.tooFewPoints).toBe(1);
    expect(a.withGpsProblems).toBe(1);
    const fresh = await getDeliveryAnalytics(db, { actor: adminActor(admin), since: new Date(Date.now() + 86_400_000) });
    expect(fresh.deliveries).toBe(0);
  });
});

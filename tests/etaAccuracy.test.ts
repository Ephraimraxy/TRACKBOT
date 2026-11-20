import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandeStatut as S } from "@prisma/client";

import { sampleOf, summariseEtaAccuracy } from "@/lib/analytics/etaAccuracy";
import { assignDriver, driverChangeStatus } from "@/lib/services/deliveryService";
import { recordDriverLocation } from "@/lib/services/trackingService";
import { getDeliveryAnalytics } from "@/lib/services/deliveryReportService";
import { adminActor, clientActor, driverActor, orderAt, world } from "./flow";
import { db, resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(() => db.$disconnect());

const T0 = new Date("2026-11-20T10:00:00Z");
const at = (min: number) => new Date(T0.getTime() + min * 60_000);

describe("estimate accuracy maths", () => {
  it("compares the first estimate with how long the delivery really took", () => {
    expect(sampleOf({ predictedSeconds: 600, source: "route", firstAt: at(0), deliveredAt: at(12) })).toEqual({ predictedSeconds: 600, source: "route", actualSeconds: 720 });
    expect(sampleOf({ predictedSeconds: null, source: "route", firstAt: at(0), deliveredAt: at(12) })).toBeNull();
    expect(sampleOf({ predictedSeconds: 600, source: "route", firstAt: at(0), deliveredAt: null })).toBeNull();
    expect(sampleOf({ predictedSeconds: 600, source: "route", firstAt: at(10), deliveredAt: at(5) })).toBeNull(); // delivered "before" the estimate: not judgeable
    expect(sampleOf({ predictedSeconds: 600, source: "estimate", firstAt: at(0), deliveredAt: at(12) })?.source).toBe("estimate");
  });

  it("summarises road estimates and straight-line estimates separately", () => {
    const s = summariseEtaAccuracy([
      { predictedSeconds: 600, source: "route", actualSeconds: 660 }, // 1 min off, within 20%
      { predictedSeconds: 600, source: "route", actualSeconds: 1200 }, // 10 min off, promised too little
      { predictedSeconds: 600, source: "estimate", actualSeconds: 1800 },
    ]);
    expect(s.measured).toBe(3);
    expect(s.road).toEqual({ measured: 2, averageErrorMinutes: 5.5, within20Percent: 1, tooOptimistic: 1 });
    expect(s.estimate).toEqual({ measured: 1, averageErrorMinutes: 20, tooOptimistic: 1 });
    expect(summariseEtaAccuracy([])).toEqual({ measured: 0, road: null, estimate: null });
  });
});

describe("the first estimate is kept and used in the analytics", () => {
  async function delivered(source: "route" | "estimate", firstDeliveredAfterMin: number) {
    const w = await world();
    const orderId = await orderAt(w.client, w.admin, S.EXPEDIEE);
    const order = await db.commande.findUniqueOrThrow({ where: { id: orderId }, select: { adresseId: true } });
    await db.adresse.update({ where: { id: order.adresseId! }, data: { latitude: 8.852, longitude: 7.879 } });
    await assignDriver(db, { orderId, driverId: w.driver.id, actor: adminActor(w.admin) });
    await driverChangeStatus(db, { orderId, to: S.EN_LIVRAISON, actor: driverActor(w.driver) });
    const first = vi.fn(async () => ({ durationSeconds: 600, distanceMetres: 3000, source, ...(source === "estimate" ? { fallbackReason: "unreachable" as const } : {}), updatedAt: new Date() }));
    const now = new Date();
    await recordDriverLocation(db, { orderId, actor: driverActor(w.driver), location: { latitude: 8.84, longitude: 7.87 }, now, estimate: first });
    // a later estimate must NOT replace the first one
    await recordDriverLocation(db, { orderId, actor: driverActor(w.driver), location: { latitude: 8.845, longitude: 7.875 }, now: new Date(now.getTime() + 60_000), estimate: async () => ({ durationSeconds: 120, distanceMetres: 500, source: "route", updatedAt: new Date() }) });
    const row = await db.livraison.findUniqueOrThrow({ where: { commandeId: orderId } });
    expect(row).toMatchObject({ etaInitialeSecondes: 600, etaInitialeSource: source, etaSecondes: 120 });
    // the delivery person says "Delivered" N minutes after that first estimate
    await driverChangeStatus(db, { orderId, to: S.LIVREE, actor: driverActor(w.driver) });
    await db.historiqueStatutCommande.updateMany({ where: { commandeId: orderId, nouveauStatut: S.LIVREE }, data: { date: new Date(now.getTime() + firstDeliveredAfterMin * 60_000) } });
    return w;
  }

  it("is reported to the owner, with road and straight-line estimates apart", async () => {
    const w = await delivered("route", 12);
    const a = await getDeliveryAnalytics(db, { actor: adminActor(w.admin) });
    expect(a.etaAccuracy.measured).toBe(1);
    expect(a.etaAccuracy.road).toMatchObject({ measured: 1, averageErrorMinutes: 2, within20Percent: 1, tooOptimistic: 0 });
    expect(a.etaAccuracy.estimate).toBeNull();
    await expect(getDeliveryAnalytics(db, { actor: clientActor(w.client) })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("counts a straight-line estimate that promised too little", async () => {
    const w = await delivered("estimate", 30);
    const a = await getDeliveryAnalytics(db, { actor: adminActor(w.admin) });
    expect(a.etaAccuracy.estimate).toMatchObject({ measured: 1, averageErrorMinutes: 20, tooOptimistic: 1 });
    expect(a.etaAccuracy.road).toBeNull();
  });
});

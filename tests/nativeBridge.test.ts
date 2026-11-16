import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CommandeStatut as S } from "@prisma/client";

import { nativeTracker, parseNativeStatus } from "@/lib/native/bridge";
import { assignDriver, driverChangeStatus } from "@/lib/services/deliveryService";
import { recordDriverLocations } from "@/lib/services/trackingService";
import { adminActor, driverActor, orderAt, world } from "./flow";
import { db, resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(() => db.$disconnect());

const fake = (over: Record<string, unknown> = {}) => ({ isAvailable: () => true, version: () => "1.0.0", start: () => "started", stop: () => undefined, status: () => "{}", ...over });

describe("the Android app's bridge", () => {
  it("is absent in an ordinary browser, and only trusted when it looks right", () => {
    expect(nativeTracker({})).toBeNull();
    expect(nativeTracker(undefined)).toBeNull();
    expect(nativeTracker({ TrackBotNative: {} })).toBeNull();
    expect(nativeTracker({ TrackBotNative: fake({ isAvailable: () => false }) })).toBeNull();
    expect(nativeTracker({ TrackBotNative: fake({ isAvailable: () => { throw new Error("x"); } }) })).toBeNull();
    expect(nativeTracker({ TrackBotNative: fake({ start: "nope" }) })).toBeNull();
    expect(nativeTracker({ TrackBotNative: fake() })).not.toBeNull();
  });

  it("reads the app's status and never trusts its shape", () => {
    expect(parseNativeStatus(JSON.stringify({ tracking: true, orderId: "abc", queued: 3, signedOut: false, lastSentAt: 5, lastFix: { latitude: 8.84, longitude: 7.87, accuracy: 9, capturedAt: 7 } }))).toEqual({
      tracking: true, orderId: "abc", queued: 3, signedOut: false, lastSentAt: 5, lastFix: { latitude: 8.84, longitude: 7.87, accuracy: 9, capturedAt: 7 },
    });
    expect(parseNativeStatus(JSON.stringify({ tracking: false, orderId: null, queued: -4, lastFix: { latitude: "x" } }))).toMatchObject({ queued: 0, lastFix: null, orderId: null, signedOut: false });
    expect(parseNativeStatus("not json")).toBeNull();
    expect(parseNativeStatus(JSON.stringify({ queued: 1 }))).toBeNull();
    expect(parseNativeStatus(null)).toBeNull();
  });
});

describe("the app and the server agree on the upload format", () => {
  // Exactly what the Android core's batchBody() produces (see android/core .../CoreTest.kt, buildsTheBatchTheServerExpects),
  // with capture times moved to just before now so they are accepted.
  it("accepts the batch the app sends: points with epoch-millisecond capture times, stored as history, in order", async () => {
    const w = await world();
    const orderId = await orderAt(w.client, w.admin, S.EXPEDIEE);
    await assignDriver(db, { orderId, driverId: w.driver.id, actor: adminActor(w.admin) });
    await driverChangeStatus(db, { orderId, to: S.EN_LIVRAISON, actor: driverActor(w.driver) });
    await db.historiqueStatutCommande.updateMany({ where: { commandeId: orderId, nouveauStatut: S.EN_LIVRAISON }, data: { date: new Date(Date.now() - 3600_000) } });

    const now = Date.now();
    const body = `{"points":[{"latitude":8.84,"longitude":7.87,"accuracy":9.5,"capturedAt":${now - 120_000}},{"latitude":8.85,"longitude":7.88,"capturedAt":${now - 100_000}}]}`;
    const parsed = JSON.parse(body) as { points: { latitude: number; longitude: number; accuracy?: number; capturedAt: number }[] };
    const out = await recordDriverLocations(db, { orderId, actor: driverActor(w.driver), locations: parsed.points, now: new Date(now) });
    expect(out.results.map((r) => r.status)).toEqual(["saved", "saved"]);
    const rows = await db.positionLivraison.findMany({ where: { commandeId: orderId }, orderBy: { date: "asc" } });
    expect(rows.map((r) => r.latitude)).toEqual([8.84, 8.85]);
    expect(rows[0].precision).toBe(9.5);
    expect(rows[1].precision).toBeNull(); // accuracy omitted by the app when unknown
    expect(rows.every((r) => r.backfilled)).toBe(true); // older than 30 s: history
  });
});

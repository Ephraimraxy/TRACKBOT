import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandeStatut as S } from "@prisma/client";

import {
  DETOUR_FACTOR,
  estimateRoute,
  estimateStraightLine,
  formatDistance,
  formatMinutes,
  haversineMetres,
  type Eta,
  type LatLng,
} from "@/lib/services/etaService";
import { ETA_REFRESH_SECONDS, NEAR_METRES, updateEtaAndReminders } from "@/lib/services/deliveryProgressService";
import { assignDriver } from "@/lib/services/deliveryService";
import { changeOrderStatus } from "@/lib/services/orderService";
import { getTracking, recordDriverLocation } from "@/lib/services/trackingService";
import { adminActor, clientActor, driverActor, orderAt, world } from "./flow";
import { db, resetDb } from "./helpers";

const KEFFI: LatLng = { latitude: 8.8486, longitude: 7.8741 };
const HOME: LatLng = { latitude: 8.86, longitude: 7.88 }; // about 1.4 km away
const T0 = new Date("2026-11-02T10:00:00Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

describe("distance and time maths", () => {
  it("measures real distances (Keffi to Abuja is about 58 km as the crow flies)", () => {
    const abuja = { latitude: 9.0765, longitude: 7.3986 };
    const km = haversineMetres(KEFFI, abuja) / 1000;
    expect(km).toBeGreaterThan(56);
    expect(km).toBeLessThan(60);
    expect(haversineMetres(KEFFI, KEFFI)).toBe(0);
  });

  it("falls back to a straight-line estimate, stretched for roads, at town speed", () => {
    const a = { latitude: 8.0, longitude: 7.0 };
    const b = { latitude: 8.009, longitude: 7.0 }; // about 1 km north
    const eta = estimateStraightLine(a, b);
    expect(eta.source).toBe("estimate");
    expect(eta.distanceMetres).toBeGreaterThan(990 * DETOUR_FACTOR);
    expect(eta.distanceMetres).toBeLessThan(1010 * DETOUR_FACTOR);
    expect(eta.durationSeconds).toBeGreaterThan(180); // 1.35 km at 25 km/h is about 3 minutes
    expect(eta.durationSeconds).toBeLessThan(210);
  });

  it("reads a road route from the routing server", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ code: "Ok", routes: [{ distance: 2345.6, duration: 412.2 }] })));
    const eta = await estimateRoute(KEFFI, HOME, f as unknown as typeof fetch);
    expect(eta).toEqual({ distanceMetres: 2346, durationSeconds: 412, source: "route" });
    const url = String((f.mock.calls[0] as unknown as [string])[0]);
    expect(url).toContain("router.project-osrm.org");
    expect(url).toContain("7.8741,8.8486;7.88,8.86"); // longitude,latitude order
  });

  it("still gives an answer when the routing server fails, says no route, or is unreachable", async () => {
    const failures = [
      vi.fn(async () => new Response("nope", { status: 500 })),
      vi.fn(async () => new Response(JSON.stringify({ code: "NoRoute", routes: [] }))),
      vi.fn(async () => new Response(JSON.stringify({ code: "Ok", routes: [{ distance: "far" }] }))),
      vi.fn(async () => {
        throw new Error("offline");
      }),
    ];
    for (const f of failures) {
      const eta = await estimateRoute(KEFFI, HOME, f as unknown as typeof fetch);
      expect(eta.source).toBe("estimate");
      expect(eta.distanceMetres).toBeGreaterThan(0);
    }
  });

  it("words distance and time for people", () => {
    expect(formatDistance(4300)).toBe("4.3 km");
    expect(formatDistance(350)).toBe("350 m");
    expect(formatDistance(3)).toBe("10 m");
    expect(formatMinutes(20)).toBe("1 min");
    expect(formatMinutes(12 * 60)).toBe("12 min");
    expect(formatMinutes(65 * 60)).toBe("1 h 5 min");
    expect(formatMinutes(120 * 60)).toBe("2 h");
  });
});

// ---- the delivery reminders ----------------------------------------------------------------

const far = (seconds = 900, metres = 5000): Eta => ({ distanceMetres: metres, durationSeconds: seconds, source: "route" });
const answer = (eta: Eta) => vi.fn(async () => eta);

/** An order out for delivery whose destination the customer pinned. */
async function onTheRoad() {
  const w = await world();
  const orderId = await orderAt(w.client, w.admin, S.EXPEDIEE);
  const order = await db.commande.findUniqueOrThrow({ where: { id: orderId }, select: { adresseId: true } });
  await db.adresse.update({ where: { id: order.adresseId! }, data: { latitude: HOME.latitude, longitude: HOME.longitude } });
  await assignDriver(db, { orderId, driverId: w.driver.id, actor: adminActor(w.admin) });
  await changeOrderStatus(db, { orderId, to: S.EN_LIVRAISON, actor: driverActor(w.driver), driverAssigned: true });
  return { ...w, orderId };
}
const notes = (userId: string) => db.notification.findMany({ where: { userId, type: "LIVRAISON", objet: { startsWith: "Your delivery" } }, orderBy: { date: "asc" } });

beforeEach(resetDb);
afterAll(() => db.$disconnect());

describe("ETA and reminders for the customer", () => {
  it("does nothing, and costs nothing, when the customer did not pin a delivery spot", async () => {
    const w = await world();
    const orderId = await orderAt(w.client, w.admin, S.EXPEDIEE);
    await assignDriver(db, { orderId, driverId: w.driver.id, actor: adminActor(w.admin) });
    await changeOrderStatus(db, { orderId, to: S.EN_LIVRAISON, actor: driverActor(w.driver), driverAssigned: true });
    const estimate = answer(far());

    const result = await updateEtaAndReminders(db, { orderId, position: KEFFI, now: at(0), estimate });
    expect(result).toEqual({ eta: null, sent: [] });
    expect(estimate).not.toHaveBeenCalled();
    expect(await notes(w.client.id)).toHaveLength(0);
  });

  it("works out the time left and tells the customer as soon as the delivery person sets off", async () => {
    const { client, orderId } = await onTheRoad();
    const result = await updateEtaAndReminders(db, { orderId, position: KEFFI, now: at(0), estimate: answer(far(12 * 60, 4300)) });

    expect(result.eta).toMatchObject({ durationSeconds: 720, distanceMetres: 4300 });
    expect(result.sent).toEqual(["reminder"]);
    const [note] = await notes(client.id);
    expect(note.text).toContain("12 min");
    expect(note.text).toContain("4.3 km");
    expect(note.text).toContain("LIVREUR"); // the driver's first name (makeUser uses the role as the name)
    expect(note.urlRedirection).toBe(`/client/orders/${orderId}/track`);
  });

  it("then reminds at the customer's chosen interval, not more often", async () => {
    const { client, orderId } = await onTheRoad();
    const estimate = answer(far());
    await db.user.update({ where: { id: client.id }, data: { rappelLivraisonMinutes: 5 } });

    await updateEtaAndReminders(db, { orderId, position: KEFFI, now: at(0), estimate });
    for (const s of [30, 120, 240, 299]) await updateEtaAndReminders(db, { orderId, position: KEFFI, now: at(s), estimate });
    expect(await notes(client.id)).toHaveLength(1);

    await updateEtaAndReminders(db, { orderId, position: KEFFI, now: at(301), estimate });
    expect(await notes(client.id)).toHaveLength(2);
    await updateEtaAndReminders(db, { orderId, position: KEFFI, now: at(400), estimate });
    expect(await notes(client.id)).toHaveLength(2);
  });

  it("respects a different interval, and 0 means no reminders at all", async () => {
    const { client, orderId } = await onTheRoad();
    const estimate = answer(far());

    await db.user.update({ where: { id: client.id }, data: { rappelLivraisonMinutes: 2 } });
    await updateEtaAndReminders(db, { orderId, position: KEFFI, now: at(0), estimate });
    await updateEtaAndReminders(db, { orderId, position: KEFFI, now: at(125), estimate });
    expect(await notes(client.id)).toHaveLength(2);

    await db.user.update({ where: { id: client.id }, data: { rappelLivraisonMinutes: 0 } });
    await updateEtaAndReminders(db, { orderId, position: KEFFI, now: at(600), estimate });
    await updateEtaAndReminders(db, { orderId, position: KEFFI, now: at(1200), estimate });
    expect(await notes(client.id)).toHaveLength(2);
  });

  it("sends 'almost here' exactly once, and then stops the regular reminders", async () => {
    const { client, orderId } = await onTheRoad();
    await updateEtaAndReminders(db, { orderId, position: KEFFI, now: at(0), estimate: answer(far()) }); // first reminder

    const close = answer(far(100, NEAR_METRES - 100));
    expect((await updateEtaAndReminders(db, { orderId, position: HOME, now: at(400), estimate: close })).sent).toEqual(["near"]);
    expect((await updateEtaAndReminders(db, { orderId, position: HOME, now: at(420), estimate: close })).sent).toEqual([]);
    expect((await updateEtaAndReminders(db, { orderId, position: HOME, now: at(2000), estimate: close })).sent).toEqual([]);

    const all = await notes(client.id);
    expect(all.map((n) => n.objet)).toEqual(["Your delivery is on its way", "Your delivery is almost here"]);
  });

  it("is also 'almost here' when the time left is short, even if the distance is not", async () => {
    const { orderId } = await onTheRoad();
    const result = await updateEtaAndReminders(db, { orderId, position: KEFFI, now: at(0), estimate: answer(far(60, 2000)) });
    expect(result.sent).toEqual(["near"]);
  });

  it("lets a customer turn the 'almost here' alert off", async () => {
    const { client, orderId } = await onTheRoad();
    await db.user.update({ where: { id: client.id }, data: { alerteProche: false, rappelLivraisonMinutes: 0 } });
    const result = await updateEtaAndReminders(db, { orderId, position: HOME, now: at(0), estimate: answer(far(30, 100)) });
    expect(result.sent).toEqual([]);
    expect(await notes(client.id)).toHaveLength(0);
  });

  it("asks the routing server only now and then, not on every position", async () => {
    const { orderId } = await onTheRoad();
    const estimate = answer(far());
    for (const s of [0, 3, 6, 9]) await updateEtaAndReminders(db, { orderId, position: KEFFI, now: at(s), estimate });
    expect(estimate).toHaveBeenCalledTimes(1);
    await updateEtaAndReminders(db, { orderId, position: KEFFI, now: at(ETA_REFRESH_SECONDS + 1), estimate });
    expect(estimate).toHaveBeenCalledTimes(2);
  });

  it("never sends the same reminder twice when two positions arrive together", async () => {
    const { client, orderId } = await onTheRoad();
    const estimate = answer(far());
    await Promise.all([1, 2, 3, 4].map(() => updateEtaAndReminders(db, { orderId, position: KEFFI, now: at(0), estimate })));
    expect(await notes(client.id)).toHaveLength(1);
  });
});

describe("saving a position with ETA", () => {
  it("returns the ETA with the saved position", async () => {
    const { driver, orderId } = await onTheRoad();
    const saved = await recordDriverLocation(db, { orderId, actor: driverActor(driver), location: { latitude: 8.85, longitude: 7.875 }, now: at(0), estimate: answer(far(600, 3000)) });
    expect(saved).toMatchObject({ latitude: 8.85, eta: { durationSeconds: 600, distanceMetres: 3000 } });
  });

  it("still saves the position if the ETA step fails", async () => {
    const { driver, orderId } = await onTheRoad();
    const boom = vi.fn(async () => {
      throw new Error("routing exploded");
    });
    const saved = await recordDriverLocation(db, { orderId, actor: driverActor(driver), location: { latitude: 8.85, longitude: 7.875 }, now: at(0), estimate: boom });
    expect(saved.eta).toBeNull();
    expect(await db.positionLivraison.count({ where: { commandeId: orderId } })).toBe(1);
  });

  it("shows the customer the destination pin and the time left, only while the order is on the road", async () => {
    const { client, driver, orderId } = await onTheRoad();
    let t = await getTracking(db, { orderId, actor: clientActor(client) });
    expect(t.eta).toBeNull();
    expect(t.destination).toMatchObject({ latitude: HOME.latitude, longitude: HOME.longitude });

    await recordDriverLocation(db, { orderId, actor: driverActor(driver), location: { latitude: 8.85, longitude: 7.875 }, now: at(0), estimate: answer(far(480, 2100)) });
    t = await getTracking(db, { orderId, actor: clientActor(client) });
    expect(t.eta).toMatchObject({ seconds: 480, metres: 2100 });

    await changeOrderStatus(db, { orderId, to: S.LIVREE, actor: driverActor(driver), driverAssigned: true });
    t = await getTracking(db, { orderId, actor: clientActor(client) });
    expect(t.eta).toBeNull();
  });
});

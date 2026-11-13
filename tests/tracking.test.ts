import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { CommandeStatut as S, UserRole as R } from "@prisma/client";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { auth } from "@/lib/auth";
import { POST as locationRoute } from "@/app/api/delivery/orders/[orderId]/location/route";
import { GET as trackingRoute } from "@/app/api/orders/[orderId]/tracking/route";
import { changeOrderStatus } from "@/lib/services/orderService";
import { assignDriver } from "@/lib/services/deliveryService";
import { getTracking, recordDriverLocation, TRAIL_POINTS } from "@/lib/services/trackingService";
import { adminActor, clientActor, driverActor, orderAt, world } from "./flow";
import { db, resetDb } from "./helpers";

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

const point = (latitude: number, longitude: number, accuracy?: number) => ({ latitude, longitude, accuracy });
const T0 = new Date("2026-10-27T10:00:00Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

/** An order that is out for delivery and assigned to `driver`. */
async function outForDelivery() {
  const w = await world();
  const orderId = await orderAt(w.client, w.admin, S.EXPEDIEE);
  await assignDriver(db, { orderId, driverId: w.driver.id, actor: adminActor(w.admin) });
  await changeOrderStatus(db, { orderId, to: S.EN_LIVRAISON, actor: driverActor(w.driver), driverAssigned: true });
  return { ...w, orderId };
}

beforeEach(async () => {
  await resetDb();
  mockedAuth.mockReset();
});
afterAll(() => db.$disconnect());

describe("recordDriverLocation", () => {
  it("stores a position from the assigned driver while out for delivery", async () => {
    const { driver, orderId } = await outForDelivery();
    const saved = await recordDriverLocation(db, { orderId, actor: driverActor(driver), location: point(8.84, 7.87, 12) });
    expect(saved).toMatchObject({ latitude: 8.84, longitude: 7.87 });
    const row = await db.positionLivraison.findFirstOrThrow({ where: { commandeId: orderId } });
    expect(row).toMatchObject({ livreurId: driver.id, precision: 12 });
  });

  it("is refused unless the order is out for delivery (before and after)", async () => {
    const w = await world();
    const orderId = await orderAt(w.client, w.admin, S.EXPEDIEE);
    await assignDriver(db, { orderId, driverId: w.driver.id, actor: adminActor(w.admin) });

    await expect(recordDriverLocation(db, { orderId, actor: driverActor(w.driver), location: point(1, 1) })).rejects.toMatchObject({ code: "TRACKING_INACTIVE" });

    await changeOrderStatus(db, { orderId, to: S.EN_LIVRAISON, actor: driverActor(w.driver), driverAssigned: true });
    await recordDriverLocation(db, { orderId, actor: driverActor(w.driver), location: point(1, 1) });
    await changeOrderStatus(db, { orderId, to: S.LIVREE, actor: driverActor(w.driver), driverAssigned: true });

    await expect(recordDriverLocation(db, { orderId, actor: driverActor(w.driver), location: point(2, 2), now: at(60) })).rejects.toMatchObject({ code: "TRACKING_INACTIVE" });
    expect(await db.positionLivraison.count()).toBe(1);
  });

  it("is refused for another driver, an unknown order, a customer and the admin", async () => {
    const { client, admin, otherDriver, orderId } = await outForDelivery();
    const actors = [driverActor(otherDriver), clientActor(client), adminActor(admin)];
    for (const actor of actors) {
      await expect(recordDriverLocation(db, { orderId, actor, location: point(1, 1) })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(recordDriverLocation(db, { orderId: "missing", actor: driverActor(otherDriver), location: point(1, 1) })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.positionLivraison.count()).toBe(0);
  });

  it.each([
    ["latitude above 90", point(91, 0)],
    ["latitude below -90", point(-91, 0)],
    ["longitude above 180", point(0, 181)],
    ["NaN", point(NaN, 0)],
    ["Infinity", point(0, Infinity)],
    ["string coordinates", { latitude: "8.8", longitude: "7.8" }],
    ["missing coordinates", {}],
    ["negative accuracy", point(1, 1, -5)],
  ])("rejects invalid input: %s", async (_name, location) => {
    const { driver, orderId } = await outForDelivery();
    await expect(recordDriverLocation(db, { orderId, actor: driverActor(driver), location })).rejects.toMatchObject({ code: "INVALID_LOCATION" });
    expect(await db.positionLivraison.count()).toBe(0);
  });

  it("limits how often positions are accepted", async () => {
    const { driver, orderId } = await outForDelivery();
    const send = (seconds: number) => recordDriverLocation(db, { orderId, actor: driverActor(driver), location: point(1, 1), now: at(seconds) });

    await send(0);
    await expect(send(1)).rejects.toMatchObject({ code: "TOO_FREQUENT" });
    await send(3);
    expect(await db.positionLivraison.count()).toBe(2);
  });
});

describe("getTracking", () => {
  it("shows the owner status, timeline, driver first name and the latest position", async () => {
    const { client, driver, orderId } = await outForDelivery();
    await recordDriverLocation(db, { orderId, actor: driverActor(driver), location: point(8.1, 7.1), now: at(0) });
    await recordDriverLocation(db, { orderId, actor: driverActor(driver), location: point(8.2, 7.2, 9), now: at(10) });

    const t = await getTracking(db, { orderId, actor: clientActor(client) });
    expect(t.status).toBe(S.EN_LIVRAISON);
    expect(t.statusLabel).toBe("Out for delivery");
    expect(t.trackingActive).toBe(true);
    expect(t.location).toMatchObject({ latitude: 8.2, longitude: 7.2, accuracy: 9 });
    expect(t.driverFirstName).toBe(R.LIVREUR); // makeUser stores the role as first name
    expect(t.history.map((h) => h.to)).toEqual([S.EN_COURS, S.EN_PREPARATION, S.EXPEDIEE, S.EN_LIVRAISON]);
  });

  it("never exposes the driver's id, email or full record", async () => {
    const { client, driver, orderId } = await outForDelivery();
    const t = await getTracking(db, { orderId, actor: clientActor(client) });
    const json = JSON.stringify(t);
    expect(json).not.toContain(driver.id);
    expect(json).not.toContain(driver.email);
  });

  it("hides the location before pickup and again once delivered", async () => {
    const w = await world();
    const orderId = await orderAt(w.client, w.admin, S.EXPEDIEE);
    await assignDriver(db, { orderId, driverId: w.driver.id, actor: adminActor(w.admin) });

    let t = await getTracking(db, { orderId, actor: clientActor(w.client) });
    expect(t.trackingActive).toBe(false);
    expect(t.location).toBeNull();

    await changeOrderStatus(db, { orderId, to: S.EN_LIVRAISON, actor: driverActor(w.driver), driverAssigned: true });
    await recordDriverLocation(db, { orderId, actor: driverActor(w.driver), location: point(8, 7) });
    t = await getTracking(db, { orderId, actor: clientActor(w.client) });
    expect(t.location).not.toBeNull();

    await changeOrderStatus(db, { orderId, to: S.LIVREE, actor: driverActor(w.driver), driverAssigned: true });
    t = await getTracking(db, { orderId, actor: clientActor(w.client) });
    expect(t.trackingActive).toBe(false);
    expect(t.location).toBeNull(); // stored rows remain, but are no longer exposed
    expect(t.status).toBe(S.LIVREE);
  });

  it("is visible to the owner and admin only", async () => {
    const { admin, driver, orderId } = await outForDelivery();
    const stranger = (await world()).client;

    expect((await getTracking(db, { orderId, actor: adminActor(admin) })).orderId).toBe(orderId);
    await expect(getTracking(db, { orderId, actor: clientActor(stranger) })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getTracking(db, { orderId, actor: driverActor(driver) })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getTracking(db, { orderId: "missing", actor: adminActor(admin) })).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
  });
});

describe("tracking routes", () => {
  it("POST /api/delivery/orders/:id/location: 401, 403, 400, 409, 201, 429", async () => {
    const { client, admin, driver, otherDriver, orderId } = await outForDelivery();
    const ok = point(8.5, 7.5, 10);

    loginAs(null);
    expect((await locationRoute(req("POST", ok), ctx(orderId))).status).toBe(401);
    loginAs(client);
    expect((await locationRoute(req("POST", ok), ctx(orderId))).status).toBe(403);
    loginAs(admin);
    expect((await locationRoute(req("POST", ok), ctx(orderId))).status).toBe(403);
    loginAs(otherDriver);
    expect((await locationRoute(req("POST", ok), ctx(orderId))).status).toBe(403);

    loginAs(driver);
    expect((await locationRoute(req("POST", point(200, 0)), ctx(orderId))).status).toBe(400);
    expect((await locationRoute(req("POST", ok), ctx(orderId))).status).toBe(201);
    expect((await locationRoute(req("POST", ok), ctx(orderId))).status).toBe(429);
  });

  it("POST location returns 409 when the order is not out for delivery", async () => {
    const w = await world();
    const orderId = await orderAt(w.client, w.admin, S.EXPEDIEE);
    await assignDriver(db, { orderId, driverId: w.driver.id, actor: adminActor(w.admin) });
    loginAs(w.driver);
    expect((await locationRoute(req("POST", point(8, 7)), ctx(orderId))).status).toBe(409);
  });

  it("GET /api/orders/:id/tracking: 401, 403 for a stranger, 200 with the live point for the owner", async () => {
    const { client, driver, orderId } = await outForDelivery();
    const stranger = (await world()).client;
    await recordDriverLocation(db, { orderId, actor: driverActor(driver), location: point(8.3, 7.3) });

    loginAs(null);
    expect((await trackingRoute(req("GET"), ctx(orderId))).status).toBe(401);
    loginAs(stranger);
    expect((await trackingRoute(req("GET"), ctx(orderId))).status).toBe(403);

    loginAs(client);
    const res = await trackingRoute(req("GET"), ctx(orderId));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()).data;
    expect(body.location).toMatchObject({ latitude: 8.3, longitude: 7.3 });
    expect(body.trackingActive).toBe(true);
  });
});

describe("getTracking: the route so far", () => {
  it("returns the points oldest first, so the map can draw the path driven", async () => {
    const { client, driver, orderId } = await outForDelivery();
    for (const [i, [lat, lng]] of [[8.1, 7.1], [8.2, 7.15], [8.3, 7.2]].entries()) {
      await recordDriverLocation(db, { orderId, actor: driverActor(driver), location: point(lat, lng), now: at(i * 10) });
    }
    const t = await getTracking(db, { orderId, actor: clientActor(client) });
    expect(t.trail.map((p) => [p.latitude, p.longitude])).toEqual([[8.1, 7.1], [8.2, 7.15], [8.3, 7.2]]);
    expect(t.location).toMatchObject({ latitude: 8.3, longitude: 7.2 }); // the current point is the end of the trail
  });

  it("keeps only the most recent points", async () => {
    const { client, driver, orderId } = await outForDelivery();
    await db.positionLivraison.createMany({
      data: Array.from({ length: TRAIL_POINTS + 30 }, (_, i) => ({
        commandeId: orderId, livreurId: driver.id, latitude: 8 + i / 1000, longitude: 7, date: at(i),
      })),
    });
    const t = await getTracking(db, { orderId, actor: clientActor(client) });
    expect(t.trail).toHaveLength(TRAIL_POINTS);
    expect(t.trail[t.trail.length - 1].latitude).toBeCloseTo(8 + (TRAIL_POINTS + 29) / 1000, 6);
    expect(t.trail[0].latitude).toBeLessThan(t.trail[1].latitude); // still oldest first
  });

  it("is empty before pickup and after delivery, like the location", async () => {
    const w = await world();
    const orderId = await orderAt(w.client, w.admin, S.EXPEDIEE);
    await assignDriver(db, { orderId, driverId: w.driver.id, actor: adminActor(w.admin) });
    expect((await getTracking(db, { orderId, actor: clientActor(w.client) })).trail).toEqual([]);

    await changeOrderStatus(db, { orderId, to: S.EN_LIVRAISON, actor: driverActor(w.driver), driverAssigned: true });
    await recordDriverLocation(db, { orderId, actor: driverActor(w.driver), location: point(8, 7) });
    expect((await getTracking(db, { orderId, actor: clientActor(w.client) })).trail).toHaveLength(1);

    await changeOrderStatus(db, { orderId, to: S.LIVREE, actor: driverActor(w.driver), driverAssigned: true });
    expect((await getTracking(db, { orderId, actor: clientActor(w.client) })).trail).toEqual([]);
  });
});

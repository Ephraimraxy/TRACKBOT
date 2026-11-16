import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandeStatut as S } from "@prisma/client";

import { assignDriver, driverChangeStatus } from "@/lib/services/deliveryService";
import { recordDriverLocation } from "@/lib/services/trackingService";
import { createTrackingHub } from "@/lib/services/trackingHub";
import { acquireStream, MAX_STREAMS_PER_USER, resetStreamLimits, streamStats } from "@/lib/services/streamLimits";
import { adminActor, driverActor, orderAt, world } from "./flow";
import { db, resetDb } from "./helpers";

beforeEach(() => {
  resetStreamLimits();
  return resetDb();
});
afterAll(() => db.$disconnect());

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("shared tracking watcher", () => {
  it("serves any number of viewers of one order with ONE watcher and one set of change queries", async () => {
    const w = await world();
    const orderId = await orderAt(w.client, w.admin, S.EXPEDIEE);
    await assignDriver(db, { orderId, driverId: w.driver.id, actor: adminActor(w.admin) });
    await driverChangeStatus(db, { orderId, to: S.EN_LIVRAISON, actor: driverActor(w.driver) });

    const hub = createTrackingHub(db, { checkMs: 25 });
    const calls = vi.spyOn(db.commande, "findUnique");
    const got: number[] = [0, 0, 0, 0, 0];
    const stops = got.map((_, i) => hub.subscribe(orderId, () => void got[i]++));
    expect(hub.stats()).toEqual({ orders: 1, listeners: 5 }); // five viewers, one watcher

    await wait(120); // the shared watcher's first snapshot reaches everyone
    expect(got.every((n) => n >= 1)).toBe(true);
    const before = got[0];
    const queriesBefore = calls.mock.calls.length;

    await recordDriverLocation(db, { orderId, actor: driverActor(w.driver), location: { latitude: 8.84, longitude: 7.87 }, now: new Date() });
    await wait(120);
    expect(got.every((n) => n === before + 1)).toBe(true); // everyone got the new position, once
    // ~5 ticks in 120 ms. With five separate watchers this would be about 25 status queries.
    expect(calls.mock.calls.length - queriesBefore).toBeLessThan(12);
    calls.mockRestore();

    stops.slice(1).forEach((stop) => stop());
    expect(hub.stats()).toEqual({ orders: 1, listeners: 1 });
    stops[0]();
    expect(hub.stats()).toEqual({ orders: 0, listeners: 0 }); // nobody left: the timer is gone
  });

  it("keeps separate orders separate", async () => {
    const hub = createTrackingHub(db, { checkMs: 1000 });
    const a = hub.subscribe("order-a", () => undefined);
    const b = hub.subscribe("order-b", () => undefined);
    expect(hub.stats().orders).toBe(2);
    a();
    b();
    expect(hub.stats().orders).toBe(0);
  });
});

describe("per-user stream limits", () => {
  it("lets one person hold only a few streams, and frees a slot when one ends", () => {
    const held = Array.from({ length: MAX_STREAMS_PER_USER }, () => acquireStream("u1"));
    expect(held.every((h) => h.ok)).toBe(true);
    const refused = acquireStream("u1");
    expect(refused).toEqual({ ok: false, reason: "user_limit" });
    expect(acquireStream("u2").ok).toBe(true); // another person is unaffected

    if (held[0].ok) held[0].release();
    expect(acquireStream("u1").ok).toBe(true);
  });

  it("caps the server total, and releasing twice never frees two slots", () => {
    const limits = { perUser: 10, total: 2 };
    const a = acquireStream("a", limits);
    const b = acquireStream("b", limits);
    expect(acquireStream("c", limits)).toEqual({ ok: false, reason: "server_busy" });
    if (a.ok) {
      a.release();
      a.release();
    }
    expect(streamStats().total).toBe(1);
    expect(acquireStream("c", limits).ok).toBe(true);
    expect(acquireStream("d", limits)).toEqual({ ok: false, reason: "server_busy" });
    expect(b.ok).toBe(true);
  });
});

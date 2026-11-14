import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandeStatut as S } from "@prisma/client";

import { assignDriver, driverChangeStatus } from "@/lib/services/deliveryService";
import { describeApproach, describeStep, distanceToLineMetres, planRoute, type RoutePlan } from "@/lib/services/etaService";
import { recordDriverLocation } from "@/lib/services/trackingService";
import { clearRouteCache, getRoutePlan, OFF_ROUTE_METRES, ROUTE_CACHE_MS } from "@/lib/services/routeService";
import { adminActor, clientActor, driverActor, orderAt, world } from "./flow";
import { db, makeUser, resetDb } from "./helpers";

beforeEach(async () => {
  await resetDb();
  clearRouteCache();
});
afterAll(() => db.$disconnect());

const osrm = (coords: [number, number][], steps: unknown[]) =>
  vi.fn(async () => new Response(JSON.stringify({ code: "Ok", routes: [{ distance: 1200, duration: 300, geometry: { coordinates: coords }, legs: [{ steps }] }] }), { status: 200 }));

describe("planRoute", () => {
  it("returns the road line and the turns, in plain words", async () => {
    const fetchImpl = osrm([[7.87, 8.84], [7.875, 8.846], [7.879, 8.852]], [
      { distance: 700, name: "Zaria Road", maneuver: { type: "depart" } },
      { distance: 500, name: "Market Road", maneuver: { type: "turn", modifier: "left" } },
      { distance: 0, name: "", maneuver: { type: "arrive" } },
    ]);
    const plan = await planRoute({ latitude: 8.84, longitude: 7.87 }, { latitude: 8.852, longitude: 7.879 }, fetchImpl as unknown as typeof fetch);
    expect(plan.source).toBe("route");
    expect(plan.geometry).toHaveLength(3);
    expect(plan.distanceMetres).toBe(1200);
    expect(plan.steps.map((s) => s.instruction)).toEqual(["Start on Zaria Road", "Turn left onto Market Road", "You have arrived at the customer's spot"]);
  });

  it("falls back to a straight line when the routing server fails, so there is always something to draw", async () => {
    const plan = await planRoute({ latitude: 8.84, longitude: 7.87 }, { latitude: 8.852, longitude: 7.879 }, vi.fn(async () => { throw new Error("down"); }) as unknown as typeof fetch);
    expect(plan.source).toBe("estimate");
    expect(plan.geometry).toEqual([[7.87, 8.84], [7.879, 8.852]]);
    expect(plan.steps.at(-1)?.instruction).toContain("arrived");
  });

  it("describes the common manoeuvres", () => {
    expect(describeStep({ maneuver: { type: "turn", modifier: "slight right" }, name: "Hospital Road" })).toBe("Bear right onto Hospital Road");
    expect(describeStep({ maneuver: { type: "roundabout" }, name: "Zaria Road" })).toBe("At the roundabout, take the exit onto Zaria Road");
    expect(describeStep({ maneuver: { type: "turn", modifier: "uturn" } })).toBe("Make a U-turn");
    expect(describeStep({ maneuver: { type: "continue" }, name: "Market Road" })).toBe("Continue on Market Road");
  });
});

describe("geometry helpers", () => {
  it("measures how far a point is from a line (to notice a driver who left the route)", () => {
    const line: [number, number][] = [[7.87, 8.84], [7.88, 8.84]]; // east-west
    expect(distanceToLineMetres({ latitude: 8.84, longitude: 7.875 }, line)).toBeLessThan(1);
    const off = distanceToLineMetres({ latitude: 8.8409, longitude: 7.875 }, line); // about 100 m north
    expect(off).toBeGreaterThan(90);
    expect(off).toBeLessThan(110);
  });

  it("says where the customer's spot lies, in words", () => {
    const here = { latitude: 8.84, longitude: 7.87 };
    expect(describeApproach(here, { latitude: 8.843, longitude: 7.87 })).toMatchObject({ direction: "north" });
    expect(describeApproach(here, { latitude: 8.84, longitude: 7.873 })).toMatchObject({ direction: "east" });
    expect(describeApproach(here, { latitude: 8.84, longitude: 7.873 }).distanceMetres).toBeGreaterThan(300);
  });
});

/** An order out for delivery, with the customer's spot pinned and the driver at `at`. */
async function onTheRoad(at = { latitude: 8.84, longitude: 7.87 }) {
  const w = await world();
  const orderId = await orderAt(w.client, w.admin, S.EXPEDIEE);
  await db.adresse.update({ where: { id: (await db.commande.findUniqueOrThrow({ where: { id: orderId } })).adresseId! }, data: { latitude: 8.852, longitude: 7.879 } });
  await assignDriver(db, { orderId, driverId: w.driver.id, actor: adminActor(w.admin) });
  await driverChangeStatus(db, { orderId, to: S.EN_LIVRAISON, actor: driverActor(w.driver) });
  await recordDriverLocation(db, { orderId, actor: driverActor(w.driver), location: at, now: new Date() });
  return { ...w, orderId };
}

const straight = (counter: { n: number }) => async (from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }): Promise<RoutePlan> => {
  counter.n++;
  return {
    distanceMetres: 900, durationSeconds: 200, source: "route",
    geometry: [[from.longitude, from.latitude], [to.longitude, to.latitude]],
    steps: [{ instruction: "Start on Zaria Road", distanceMetres: 600 }, { instruction: "Turn right onto Market Road", distanceMetres: 300 }, { instruction: "You have arrived at the customer's spot", distanceMetres: 0 }],
  };
};

describe("getRoutePlan", () => {
  it("gives the delivery person and the owner the next turn, and the customer only the line and the time", async () => {
    const { client, admin, driver, orderId } = await onTheRoad();
    const calls = { n: 0 };
    const plan = straight(calls);

    const forDriver = await getRoutePlan(db, { orderId, actor: driverActor(driver), plan });
    expect(forDriver.nextStep).toEqual({ instruction: "Turn right onto Market Road", distanceMetres: 600 });
    expect((await getRoutePlan(db, { orderId, actor: adminActor(admin), plan })).nextStep).toBeDefined();
    const forCustomer = await getRoutePlan(db, { orderId, actor: clientActor(client), plan });
    expect(forCustomer.geometry).toHaveLength(2);
    expect(forCustomer.durationSeconds).toBe(200);
    expect(forCustomer.nextStep).toBeUndefined();
    expect(calls.n).toBe(1); // three viewers, one request to the routing server
  });

  it("refuses strangers and other drivers, and works only while the order is out for delivery", async () => {
    const { driver, orderId } = await onTheRoad();
    const stranger = await makeUser();
    const other = await makeUser("LIVREUR" as never);
    const plan = straight({ n: 0 });
    await expect(getRoutePlan(db, { orderId, actor: clientActor(stranger), plan })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getRoutePlan(db, { orderId, actor: driverActor(other), plan })).rejects.toMatchObject({ code: "FORBIDDEN" });

    await driverChangeStatus(db, { orderId, to: S.LIVREE, actor: driverActor(driver) });
    await expect(getRoutePlan(db, { orderId, actor: driverActor(driver), plan })).rejects.toMatchObject({ code: "TRACKING_INACTIVE" });
  });

  it("says so, instead of failing, when the customer did not pin their spot", async () => {
    const { driver, orderId } = await onTheRoad();
    await db.adresse.updateMany({ data: { latitude: null, longitude: null } });
    expect(await getRoutePlan(db, { orderId, actor: driverActor(driver), plan: straight({ n: 0 }) })).toEqual({ available: false, reason: "NO_DESTINATION" });
  });

  it("notices a driver who left the planned road and reroutes from where they are", async () => {
    const { driver, orderId } = await onTheRoad({ latitude: 8.84, longitude: 7.87 });
    const calls = { n: 0 };
    const plan = straight(calls);
    const t0 = new Date();
    expect((await getRoutePlan(db, { orderId, actor: driverActor(driver), plan, now: t0 })).rerouted).toBe(false);

    // the driver takes another road: about 400 m east of the planned line
    await db.positionLivraison.create({ data: { commandeId: orderId, livreurId: driver.id, latitude: 8.84, longitude: 7.8737 + 0.004, date: new Date(t0.getTime() + 5000) } });
    const later = new Date(t0.getTime() + ROUTE_CACHE_MS + 1000);
    const view = await getRoutePlan(db, { orderId, actor: driverActor(driver), plan, now: later });
    expect(calls.n).toBe(2);
    expect(view.rerouted).toBe(true);
    expect(view.geometry?.[0]).toEqual([7.8737 + 0.004, 8.84]); // the new route starts at the new position
    expect(OFF_ROUTE_METRES).toBeGreaterThan(0);
  });
});

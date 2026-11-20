import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CommandeStatut as S, UserRole as R } from "@prisma/client";

import { executeTool, toolSpecsFor } from "@/lib/chatbot/tools";
import { buildSystemPrompt } from "@/lib/chatbot/engine";
import { ruleBasedReply } from "@/lib/chatbot/rules";
import type { ChatContext } from "@/lib/chatbot/types";
import { assignDriver, driverChangeStatus } from "@/lib/services/deliveryService";
import { recordDriverLocation } from "@/lib/services/trackingService";
import { adminActor, driverActor, orderAt, world } from "./flow";
import { db, resetDb } from "./helpers";

const as = (u: { id: string }, role: R): ChatContext => ({ userId: u.id, role });
beforeEach(resetDb);
afterAll(() => db.$disconnect());

async function onTheRoad(source: "route" | "estimate" = "route") {
  const w = await world();
  const orderId = await orderAt(w.client, w.admin, S.EXPEDIEE);
  const order = await db.commande.findUniqueOrThrow({ where: { id: orderId }, select: { adresseId: true } });
  await db.adresse.update({ where: { id: order.adresseId! }, data: { latitude: 8.852, longitude: 7.879 } });
  await assignDriver(db, { orderId, driverId: w.driver.id, actor: adminActor(w.admin) });
  await driverChangeStatus(db, { orderId, to: S.EN_LIVRAISON, actor: driverActor(w.driver) });
  const eta = async () => ({ durationSeconds: 600, distanceMetres: 4000, source, ...(source === "estimate" ? { fallbackReason: "unreachable" as const } : {}), updatedAt: new Date() });
  await recordDriverLocation(db, { orderId, actor: driverActor(w.driver), location: { latitude: 8.84, longitude: 7.87 }, now: new Date(), estimate: eta });
  return { ...w, orderId };
}

describe("the chatbot tells road routes from straight-line estimates", () => {
  it("the customer's tracking tool says which it is", async () => {
    const road = await onTheRoad("route");
    expect((await executeTool(db, as(road.client, R.CLIENT), "track_my_order", {})).output).toMatchObject({ minutesLeft: 10, timeLeftKind: "road_route" });
    await resetDb();
    const guess = await onTheRoad("estimate");
    expect((await executeTool(db, as(guess.client, R.CLIENT), "track_my_order", {})).output).toMatchObject({ minutesLeft: 10, timeLeftKind: "straight_line_estimate" });
  });

  it("the owner's and the delivery person's tools say it too", async () => {
    const w = await onTheRoad("estimate");
    const list = await executeTool(db, as(w.admin, R.ADMIN), "list_deliveries", { status: "out_for_delivery" });
    expect((list.output.orders as { timeLeftKind: string }[])[0].timeLeftKind).toBe("straight_line_estimate");
    const mine = await executeTool(db, as(w.driver, R.LIVREUR), "my_deliveries", {});
    expect((mine.output.deliveries as { timeLeftKind: string }[])[0].timeLeftKind).toBe("straight_line_estimate");
  });

  it("the rule-based bot says 'rough estimate, not a road route' for an estimate, and nothing of the sort for a road", async () => {
    const guess = await onTheRoad("estimate");
    const reply = await ruleBasedReply({ db, ctx: as(guess.client, R.CLIENT), message: "where is my order?", locale: "en" });
    expect(reply.reply).toMatch(/straight line/i);
    expect(reply.reply).toMatch(/not a road route/i);
    await resetDb();
    const road = await onTheRoad("route");
    const reply2 = await ruleBasedReply({ db, ctx: as(road.client, R.CLIENT), message: "where is my order?", locale: "en" });
    expect(reply2.reply).not.toMatch(/straight line/i);
    expect(reply2.reply).toMatch(/About 10 min away/);
  });
});

describe("the chatbot knows when the position has gone quiet", () => {
  it("flags a position more than a minute old, and not a fresh one", async () => {
    const w = await onTheRoad();
    const fresh = await executeTool(db, as(w.client, R.CLIENT), "track_my_order", {});
    expect(fresh.output.positionLooksOutOfDate).toBe(false);
    await db.positionLivraison.updateMany({ where: { commandeId: w.orderId }, data: { date: new Date(Date.now() - 10 * 60_000) } });
    const stale = await executeTool(db, as(w.client, R.CLIENT), "track_my_order", {});
    expect(stale.output.positionLooksOutOfDate).toBe(true);
    expect(Number(stale.output.lastPositionSecondsAgo)).toBeGreaterThan(500);
    const reply = await ruleBasedReply({ db, ctx: as(w.client, R.CLIENT), message: "where is my order?", locale: "en" });
    expect(reply.reply).toMatch(/may be out of date/i);
  });
});

describe("owner tool: delivery_report", () => {
  async function finished() {
    const w = await onTheRoad();
    await db.historiqueStatutCommande.updateMany({ where: { commandeId: w.orderId, nouveauStatut: S.EN_LIVRAISON }, data: { date: new Date(Date.now() - 3600_000) } });
    await db.positionLivraison.deleteMany({ where: { commandeId: w.orderId } });
    const start = Date.now() - 30 * 60_000;
    for (let i = 0; i < 30; i++) {
      await db.positionLivraison.create({ data: { commandeId: w.orderId, livreurId: w.driver.id, latitude: 8.84, longitude: 7.87 + i * 0.0002 + (i >= 15 ? 0.0003 : 0), precision: 8, date: new Date(start + i * 30_000 + (i >= 15 ? 240_000 : 0)) } });
    }
    await driverChangeStatus(db, { orderId: w.orderId, to: S.LIVREE, actor: driverActor(w.driver) });
    return w;
  }

  it("tells the owner how a delivery went, in numbers the owner can quote", async () => {
    const w = await finished();
    const r = await executeTool(db, as(w.admin, R.ADMIN), "delivery_report", { reference: w.orderId.slice(-8) });
    expect(r.ok).toBe(true);
    expect(r.output).toMatchObject({ reference: w.orderId.slice(-8), gpsPoints: 30, signalGaps: 1, replayPage: `/admin/deliveries/${w.orderId}/replay` });
    expect(Number(r.output.kmDriven)).toBeGreaterThan(0.5);
    expect(r.output.leftThePlannedRoad).toMatch(/unknown/);
    expect((r.output.findings as string[]).join(" ")).toMatch(/GPS went quiet/);
  });

  it("is closed to customers, delivery people and visitors, and offered only to the owner", async () => {
    const w = await finished();
    const ref = { reference: w.orderId.slice(-8) };
    expect((await executeTool(db, { userId: null, role: null }, "delivery_report", ref)).output).toEqual({ error: "LOGIN_REQUIRED" });
    expect((await executeTool(db, as(w.client, R.CLIENT), "delivery_report", ref)).output).toEqual({ error: "ADMIN_ONLY" });
    expect((await executeTool(db, as(w.driver, R.LIVREUR), "delivery_report", ref)).output).toEqual({ error: "ADMIN_ONLY" });
    const names = (r: R | null) => toolSpecsFor(r).map((t) => t.name);
    expect(names(R.ADMIN)).toContain("delivery_report");
    expect(names(R.CLIENT)).not.toContain("delivery_report");
    expect(names(R.LIVREUR)).not.toContain("delivery_report");
    expect(names(null)).not.toContain("delivery_report");
  });

  it("says not found for an unknown reference", async () => {
    const w = await finished();
    expect((await executeTool(db, as(w.admin, R.ADMIN), "delivery_report", { reference: "zzzzzzzz" })).output).toEqual({ error: "ORDER_NOT_FOUND" });
  });
});

describe("what the assistant is told about the system", () => {
  it("knows the full order flow including Received, the estimate rule, the map controls and the owner's new pages", () => {
    const owner = buildSystemPrompt("en", R.ADMIN);
    for (const text of ["Received", "straight_line_estimate", "Full view", "Follow", "Last seen", "delivery_report", "Replay the route", "Delivery analytics"]) {
      expect(owner).toContain(text);
    }
    const client = buildSystemPrompt("en", R.CLIENT);
    expect(client).toContain("I received it");
    expect(client).toContain("positionLooksOutOfDate");
    // the owner's tool is never described to a customer or a delivery person
    expect(client).not.toContain("delivery_report");
    expect(buildSystemPrompt("en", R.LIVREUR)).not.toContain("delivery_report");
  });
});

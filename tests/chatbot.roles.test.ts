import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CommandeStatut as S, UserRole as R } from "@prisma/client";

import { executeTool } from "@/lib/chatbot/tools";
import { toolSpecsFor } from "@/lib/chatbot/tools";
import { buildSystemPrompt } from "@/lib/chatbot/engine";
import { ruleBasedReply } from "@/lib/chatbot/rules";
import type { ChatContext } from "@/lib/chatbot/types";
import { assignDriver } from "@/lib/services/deliveryService";
import { adminActor, orderAt, world } from "./flow";
import { db, makeUser, resetDb } from "./helpers";

const as = (u: { id: string }, role: R): ChatContext => ({ userId: u.id, role });

beforeEach(resetDb);
afterAll(() => db.$disconnect());

describe("owner tools", () => {
  it("are refused for customers, delivery people and visitors", async () => {
    const { client, driver } = await world();
    for (const name of ["shop_overview", "list_deliveries", "list_delivery_team"]) {
      expect((await executeTool(db, { userId: null, role: null }, name, {})).output).toEqual({ error: "LOGIN_REQUIRED" });
      expect((await executeTool(db, as(client, R.CLIENT), name, {})).output).toEqual({ error: "ADMIN_ONLY" });
      expect((await executeTool(db, as(driver, R.LIVREUR), name, {})).output).toEqual({ error: "ADMIN_ONLY" });
    }
    const find = await executeTool(db, as(client, R.CLIENT), "find_order", { reference: "abcdef12" });
    expect(find.output).toEqual({ error: "ADMIN_ONLY" });
  });

  it("only offer owner tools to the owner", () => {
    const names = (r: R | null) => toolSpecsFor(r).map((t) => t.name);
    expect(names(R.ADMIN)).toContain("shop_overview");
    expect(names(R.CLIENT)).not.toContain("shop_overview");
    expect(names(R.CLIENT)).not.toContain("my_deliveries");
    expect(names(null)).not.toContain("find_order");
    expect(names(R.LIVREUR)).toContain("my_deliveries");
    expect(names(R.LIVREUR)).not.toContain("list_deliveries");
  });

  it("shop_overview reports real counts, and flags a shipped order with nobody assigned", async () => {
    const { client, admin } = await world();
    await orderAt(client, admin, S.EXPEDIEE);
    await orderAt(client, admin, S.EN_PREPARATION);

    const r = await executeTool(db, as(admin, R.ADMIN), "shop_overview", {});
    expect(r.ok).toBe(true);
    expect(r.output).toMatchObject({
      ordersByStatus: { Shipped: 1, Processing: 1 },
      shippedWaitingForDeliveryPerson: 1,
      activeUnpaidOrders: 2,
      customers: 1,
      deliveryPeople: 2,
    });
  });

  it("list_deliveries and find_order show who is assigned and what happens next", async () => {
    const { client, admin, driver } = await world();
    const id = await orderAt(client, admin, S.EXPEDIEE);
    await assignDriver(db, { orderId: id, driverId: driver.id, actor: adminActor(admin) });

    const list = await executeTool(db, as(admin, R.ADMIN), "list_deliveries", { status: "shipped" });
    const orders = list.output.orders as Record<string, unknown>[];
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ reference: id.slice(-8), status: "Shipped", deliveryPerson: `${driver.prenom} ${driver.nom}` });
    expect(String(orders[0].nextStep)).toContain("Start delivery");

    const one = await executeTool(db, as(admin, R.ADMIN), "find_order", { reference: id.slice(-8) });
    expect(one.output.order).toMatchObject({ reference: id.slice(-8), customerPinnedOnMap: false });
    expect((await executeTool(db, as(admin, R.ADMIN), "find_order", { reference: "zzzzzzzz" })).output).toEqual({ error: "ORDER_NOT_FOUND" });
  });

  it("list_delivery_team counts each person's deliveries", async () => {
    const { client, admin, driver } = await world();
    const id = await orderAt(client, admin, S.EXPEDIEE);
    await assignDriver(db, { orderId: id, driverId: driver.id, actor: adminActor(admin) });

    const r = await executeTool(db, as(admin, R.ADMIN), "list_delivery_team", {});
    const team = r.output.deliveryPeople as { name: string; waitingToStart: number }[];
    expect(team.find((d) => d.name === `${driver.prenom} ${driver.nom}`)?.waitingToStart).toBe(1);
  });
});

describe("delivery person tool", () => {
  it("my_deliveries shows only the caller's own assignments", async () => {
    const { client, admin, driver, otherDriver } = await world();
    const mine = await orderAt(client, admin, S.EXPEDIEE);
    const theirs = await orderAt(client, admin, S.EXPEDIEE);
    await assignDriver(db, { orderId: mine, driverId: driver.id, actor: adminActor(admin) });
    await assignDriver(db, { orderId: theirs, driverId: otherDriver.id, actor: adminActor(admin) });

    const r = await executeTool(db, as(driver, R.LIVREUR), "my_deliveries", {});
    const refs = (r.output.deliveries as { reference: string }[]).map((d) => d.reference);
    expect(refs).toEqual([mine.slice(-8)]);
  });

  it("is refused for customers and the owner", async () => {
    const { client, admin } = await world();
    expect((await executeTool(db, as(client, R.CLIENT), "my_deliveries", {})).output).toEqual({ error: "DELIVERY_PEOPLE_ONLY" });
    expect((await executeTool(db, as(admin, R.ADMIN), "my_deliveries", {})).output).toEqual({ error: "DELIVERY_PEOPLE_ONLY" });
  });
});

describe("customer tracking answer", () => {
  it("includes payment status and what happens next, and explains a missing time estimate", async () => {
    const { client, admin } = await world();
    await orderAt(client, admin, S.EN_PREPARATION);
    const r = await executeTool(db, as(client, R.CLIENT), "track_my_order", {});
    expect(r.output).toMatchObject({ status: "Processing", minutesLeft: null });
    expect(String(r.output.whatHappensNext)).toContain("Shipped");
    expect(typeof r.output.payment).toBe("string");
  });
});

describe("prompts and the fallback bot", () => {
  it("each role gets its own briefing, and the delivery flow is explained", () => {
    expect(buildSystemPrompt("en", R.ADMIN)).toContain("SHOP OWNER");
    expect(buildSystemPrompt("en", R.LIVREUR)).toContain("DELIVERY PERSON");
    expect(buildSystemPrompt("en", R.CLIENT)).toContain("CUSTOMER");
    expect(buildSystemPrompt("en", R.CLIENT)).toContain("Start delivery");
  });

  it("answers the owner about deliveries from real data without any AI provider", async () => {
    const { client, admin } = await world();
    await orderAt(client, admin, S.EXPEDIEE);
    const r = await ruleBasedReply({ db, ctx: as(admin, R.ADMIN), message: "how are my deliveries doing?" });
    expect(r.usedTools).toEqual(["shop_overview", "list_deliveries"]);
    expect(r.reply).toContain("Shipped");
    expect(r.reply).toContain("waiting for a delivery person");
  });

  it("gives a customer asking about deliveries nothing from the owner's tools", async () => {
    const { client, admin } = await world();
    await orderAt(client, admin, S.EXPEDIEE);
    const r = await ruleBasedReply({ db, ctx: as(client, R.CLIENT), message: "how are the deliveries doing?" });
    expect(r.usedTools).not.toContain("shop_overview");
  });

  it("tells a delivery person what to do next", async () => {
    const { client, admin, driver } = await world();
    const id = await orderAt(client, admin, S.EXPEDIEE);
    await assignDriver(db, { orderId: id, driverId: driver.id, actor: adminActor(admin) });
    const r = await ruleBasedReply({ db, ctx: as(driver, R.LIVREUR), message: "what should I do next with my delivery?" });
    expect(r.usedTools).toEqual(["my_deliveries"]);
    expect(r.reply).toContain(id.slice(-8));
    expect(r.reply).toContain("Start delivery");
  });
});

void makeUser;

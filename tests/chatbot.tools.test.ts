import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { CommandeStatut as S, UserRole as R } from "@prisma/client";

import { executeTool } from "@/lib/chatbot/tools";
import { findUngroundedAmounts, parseAmount } from "@/lib/chatbot/grounding";
import { detectIntent, keywords, ruleBasedReply } from "@/lib/chatbot/rules";
import { buildSystemPrompt } from "@/lib/chatbot/engine";
import type { ChatContext } from "@/lib/chatbot/types";
import { assignDriver } from "@/lib/services/deliveryService";
import { changeOrderStatus } from "@/lib/services/orderService";
import { recordDriverLocation } from "@/lib/services/trackingService";
import { adminActor, driverActor, orderAt, world } from "./flow";
import { db, makeUser, resetDb } from "./helpers";

const anon: ChatContext = { userId: null, role: null };
const asClient = (u: { id: string }): ChatContext => ({ userId: u.id, role: R.CLIENT });

async function product(nom: string, prix: number, qteStock: number, categorie?: string) {
  const cat = categorie ? await db.categorie.upsert({ where: { nom: categorie }, update: {}, create: { nom: categorie } }) : null;
  return db.produit.create({ data: { nom, prix, qteStock, categorieId: cat?.id } });
}

beforeEach(resetDb);
afterAll(() => db.$disconnect());

describe("tool: search_products", () => {
  async function catalogue() {
    await product("Jean slim", 3000, 5, "Pantalons");
    await product("Jean bleu", 4500, 0, "Pantalons");
    await product("Pull simple", 1500, 40, "Hauts");
  }

  it("returns real prices and stock, cheapest first", async () => {
    await catalogue();
    const r = await executeTool(db, anon, "search_products", { query: "jean" });
    expect(r.ok).toBe(true);
    const products = r.output.products as { name: string; price: number; inStock: boolean; stock: number }[];
    expect(products.map((p) => [p.name, p.price, p.stock, p.inStock])).toEqual([
      ["Jean slim", 3000, 5, true],
      ["Jean bleu", 4500, 0, false],
    ]);
    expect(r.output.currency).toBe("NGN");
  });

  it("filters by max price, category, and requires every word to match", async () => {
    await catalogue();
    const names = async (args: object) =>
      ((await executeTool(db, anon, "search_products", args)).output.products as { name: string }[]).map((p) => p.name);

    expect(await names({ query: "jean", max_price: 3500 })).toEqual(["Jean slim"]);
    expect(await names({ query: "hauts" })).toEqual(["Pull simple"]);
    expect(await names({ query: "jean pull" })).toEqual([]);
  });

  it("rejects bad arguments without throwing, and is safe against SQL-looking input", async () => {
    await catalogue();
    for (const args of [{}, { query: "" }, { query: "x".repeat(200) }, { query: "jean", limit: 100 }, { query: 5 }]) {
      const r = await executeTool(db, anon, "search_products", args);
      expect(r.output).toEqual({ error: "INVALID_ARGUMENTS" });
    }
    const evil = await executeTool(db, anon, "search_products", { query: "'; DROP TABLE produit; --" });
    expect(evil.ok).toBe(true);
    expect(await db.produit.count()).toBe(3);
  });

  it("an unknown tool name is refused", async () => {
    expect((await executeTool(db, anon, "delete_everything", {})).output).toEqual({ error: "UNKNOWN_TOOL" });
  });
});

describe("tool: get_product", () => {
  it("returns the product, or PRODUCT_NOT_FOUND", async () => {
    const p = await product("Pull simple", 1500, 12);
    const found = await executeTool(db, anon, "get_product", { product_id: p.id });
    expect(found.output.product).toMatchObject({ name: "Pull simple", price: 1500, stock: 12, inStock: true });
    expect((await executeTool(db, anon, "get_product", { product_id: "nope" })).output).toEqual({ error: "PRODUCT_NOT_FOUND" });
  });
});

describe("tools: orders (identity and isolation)", () => {
  it("need a logged-in customer", async () => {
    const { admin, driver } = await world();
    for (const name of ["list_my_orders", "track_my_order"]) {
      expect((await executeTool(db, anon, name, {})).output).toEqual({ error: "LOGIN_REQUIRED" });
      expect((await executeTool(db, { userId: admin.id, role: R.ADMIN }, name, {})).output).toEqual({ error: "CUSTOMERS_ONLY" });
      expect((await executeTool(db, { userId: driver.id, role: R.LIVREUR }, name, {})).output).toEqual({ error: "CUSTOMERS_ONLY" });
    }
  });

  it("list_my_orders returns only the caller's own orders", async () => {
    const { client, admin } = await world();
    const other = await makeUser();
    const mine = await orderAt(client, admin, S.EXPEDIEE);
    const theirs = await orderAt(other, admin, S.EXPEDIEE);

    const r = await executeTool(db, asClient(client), "list_my_orders", {});
    const refs = (r.output.orders as { reference: string }[]).map((o) => o.reference);
    expect(refs).toEqual([mine.slice(-8)]);
    expect(r.json).not.toContain(theirs.slice(-8));
  });

  it("track_my_order cannot reach another customer's order, even by guessing the reference", async () => {
    const { client, admin } = await world();
    const other = await makeUser();
    await orderAt(client, admin, S.EXPEDIEE);
    const theirs = await orderAt(other, admin, S.EN_PREPARATION);

    const byShort = await executeTool(db, asClient(client), "track_my_order", { reference: theirs.slice(-8) });
    const byFull = await executeTool(db, asClient(client), "track_my_order", { reference: theirs });
    expect(byShort.output).toEqual({ error: "ORDER_NOT_FOUND" });
    expect(byFull.output).toEqual({ error: "ORDER_NOT_FOUND" });
  });

  it("ignores any user id the model tries to smuggle into the arguments", async () => {
    const { client, admin } = await world();
    const other = await makeUser();
    const mine = await orderAt(client, admin, S.EXPEDIEE);
    await orderAt(other, admin, S.EXPEDIEE);

    const r = await executeTool(db, asClient(client), "track_my_order", { user_id: other.id, userId: other.id, clientId: other.id });
    expect(r.ok).toBe(true);
    expect(r.output.reference).toBe(mine.slice(-8));
  });

  it("track_my_order returns real status, defaults to the latest order, and never exposes coordinates", async () => {
    const { client, admin, driver } = await world();
    await orderAt(client, admin, S.EN_PREPARATION);
    const latest = await orderAt(client, admin, S.EXPEDIEE);
    await assignDriver(db, { orderId: latest, driverId: driver.id, actor: adminActor(admin) });
    await changeOrderStatus(db, { orderId: latest, to: S.EN_LIVRAISON, actor: driverActor(driver), driverAssigned: true });
    await recordDriverLocation(db, { orderId: latest, actor: driverActor(driver), location: { latitude: 8.84123, longitude: 7.87456 } });

    const r = await executeTool(db, asClient(client), "track_my_order", {});
    expect(r.output).toMatchObject({
      reference: latest.slice(-8),
      status: "Out for delivery",
      outForDelivery: true,
      liveLocationAvailable: true,
      trackingPage: `/client/orders/${latest}/track`,
    });
    expect(r.json).not.toContain("8.84123");
    expect(r.json).not.toContain("7.87456");
    expect(r.json).not.toContain(driver.id);
  });

  it("reports ORDER_NOT_FOUND when the customer has no orders", async () => {
    const client = await makeUser();
    expect((await executeTool(db, asClient(client), "track_my_order", {})).output).toEqual({ error: "ORDER_NOT_FOUND" });
  });
});

describe("grounding (price check)", () => {
  it("parses common number formats", () => {
    expect(parseAmount("1500")).toBe(1500);
    expect(parseAmount("1 500")).toBe(1500);
    expect(parseAmount("1.500")).toBe(1500);
    expect(parseAmount("1,500,000")).toBe(1500000);
    expect(parseAmount("1.500,50")).toBe(1500.5);
    expect(parseAmount("1,500.50")).toBe(1500.5);
    expect(parseAmount("12,5")).toBe(12.5);
  });

  it("accepts amounts that a tool returned, in either position and format", () => {
    const tool = [JSON.stringify({ products: [{ price: 3000 }, { price: 1500.5 }] })];
    expect(findUngroundedAmounts("Le jean coûte 3000 DA", tool)).toEqual([]);
    expect(findUngroundedAmounts("The jean is 3 000 DA", tool)).toEqual([]);
    expect(findUngroundedAmounts("Price: DA 3000, or ₦1,500.50", tool)).toEqual([]);
  });

  it("flags amounts no tool returned", () => {
    const tool = [JSON.stringify({ products: [{ price: 3000 }] })];
    expect(findUngroundedAmounts("Il coûte 2500 DA", tool)).toEqual([2500]);
    expect(findUngroundedAmounts("Only $9.99 today", tool)).toEqual([9.99]);
    expect(findUngroundedAmounts("Il coûte 2500 DA", [])).toEqual([2500]);
  });

  it("ignores numbers that are not money", () => {
    expect(findUngroundedAmounts("Il en reste 12 en stock, commande #a1b2c3d4", [])).toEqual([]);
  });
});

describe("rule-based fallback", () => {
  it("detects intents in French and English", () => {
    expect(detectIntent("Bonjour")).toBe("greeting");
    expect(detectIntent("où est ma commande ?")).toBe("order_track");
    expect(detectIntent("Where is my order")).toBe("order_track");
    expect(detectIntent("mes commandes")).toBe("orders_list");
    expect(detectIntent("prix du jean")).toBe("product");
    expect(detectIntent("do you have sneakers?")).toBe("product");
    expect(detectIntent("quels sont vos délais de livraison ?")).not.toBe("order_track");
    expect(detectIntent("aide")).toBe("help");
  });

  it("extracts product keywords", () => {
    expect(keywords("Quel est le prix du jean slim ?")).toBe("jean slim");
    expect(keywords("do you have a blue jean")).toBe("blue jean");
  });

  it("answers product questions with real prices and stock (French and English)", async () => {
    await product("Jean slim", 3000, 5, "Pantalons");
    await product("Jean bleu", 4500, 0, "Pantalons");

    const fr = await ruleBasedReply({ db, ctx: anon, message: "prix jean" });
    expect(fr.usedTools).toEqual(["search_products"]);
    expect(fr.reply).toContain("₦3000");
    expect(fr.reply).toContain("en stock (5)");
    expect(fr.reply).toContain("rupture de stock");

    const en = await ruleBasedReply({ db, ctx: anon, message: "do you have a jean?" });
    expect(en.reply).toContain("in stock (5)");
    expect(en.reply).toContain("out of stock");
  });

  it("says so when nothing matches instead of inventing a product", async () => {
    await product("Jean slim", 3000, 5);
    const r = await ruleBasedReply({ db, ctx: anon, message: "prix télévision" });
    expect(r.reply).toContain("aucun produit");
    expect(r.reply).not.toContain("DA");
  });

  it("asks anonymous visitors to log in for order questions", async () => {
    const r = await ruleBasedReply({ db, ctx: anon, message: "où est ma commande ?" });
    expect(r.reply).toContain("connecter");
  });

  it("tells a customer the real status of their order and lists their orders", async () => {
    const { client, admin } = await world();
    const id = await orderAt(client, admin, S.EXPEDIEE);

    const track = await ruleBasedReply({ db, ctx: asClient(client), message: "where is my order?" });
    expect(track.reply).toContain(`#${id.slice(-8)}`);
    expect(track.reply).toContain("Ready for delivery");

    const list = await ruleBasedReply({ db, ctx: asClient(client), message: "mes commandes" });
    expect(list.reply).toContain(`#${id.slice(-8)}`);
    expect(list.reply).toContain("Prête pour la livraison"); // asked in French, so the status label is French
  });

  it("never reveals another customer's order, whatever reference is typed", async () => {
    const { client, admin } = await world();
    const other = await makeUser();
    await orderAt(client, admin, S.EXPEDIEE);
    const theirs = await orderAt(other, admin, S.EN_PREPARATION);

    // Written with "#", the reference is always taken literally and refused.
    const marked = await ruleBasedReply({ db, ctx: asClient(client), message: `where is my order #${theirs.slice(-8)}` });
    expect(marked.reply).toContain("can't find that order");
    expect(marked.reply).not.toContain("Preparing");

    // Bare, it may or may not be recognised as a reference (depends on the random id).
    // Either way the other customer's order must never appear.
    const bare = await ruleBasedReply({ db, ctx: asClient(client), message: `where is my order ${theirs.slice(-8)}` });
    expect(bare.reply).not.toContain("Preparing");
    expect(bare.reply).not.toContain(`#${theirs.slice(-8)}`);
  });

  it("honours an all-letters reference written with # (never silently shows another order)", async () => {
    const { client, admin } = await world();
    await orderAt(client, admin, S.EXPEDIEE);
    const r = await ruleBasedReply({ db, ctx: asClient(client), message: "where is my order #abcdefgh" });
    expect(r.reply).toContain("can't find that order");
  });
});

describe("rule-based replies in the customer's language", () => {
  it("answers a greeting in Hausa when Hausa is selected", async () => {
    const r = await ruleBasedReply({ db, ctx: anon, message: "ina kwana", locale: "ha" });
    expect(r.usedTools).toEqual([]);
    expect(r.reply.length).toBeGreaterThan(0);
  });

  it("falls back to English for a language with no translation of that sentence", async () => {
    const r = await ruleBasedReply({ db, ctx: anon, message: "hello", locale: "ig" });
    expect(r.reply).toContain("TrackBot");
  });

  it("uses the selected language for the system prompt", () => {
    expect(buildSystemPrompt("yo")).toContain("Write every reply in Yoruba");
    expect(buildSystemPrompt()).toContain("Write every reply in English");
  });
});

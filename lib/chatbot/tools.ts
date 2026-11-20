import { Prisma, PrismaClient, UserRole } from "@prisma/client";
import { z } from "zod";

import type { ChatContext, ToolSpec } from "@/lib/chatbot/types";
import { STATUS_LABELS_EN } from "@/lib/orders/workflow";
import { getTracking } from "@/lib/services/trackingService";
import { OrderError } from "@/lib/services/orderService";
import { searchFaqs } from "@/lib/services/faqService";
import {
  ADMIN_TOOL_SPECS,
  DRIVER_TOOL_SPECS,
  NEXT_STEP_EN,
  findOrder,
  listDeliveries,
  listDeliveryTeam,
  deliveryReport,
  myDeliveries,
  shopOverview,
} from "@/lib/chatbot/roleTools";

/**
 * The ONLY way the chatbot touches data. Rules that make this safe:
 *  - Identity (who is asking) comes from `ctx`, which is built from the server
 *    session. No tool accepts a user id, so the model cannot ask for anyone else's data.
 *  - Every tool is read-only.
 *  - Arguments are validated; results are small and contain no personal data
 *    beyond the customer's own orders.
 *  - Tools never throw: failures come back as { error } so the model reports them.
 */

export const CURRENCY = "NGN";
const MAX_RESULT_CHARS = 6000;

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: "search_products",
    description:
      "Search the shop's catalogue by words in the name, description or category. Returns real prices and stock. Use this for any question about products, prices or availability.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to look for, e.g. 'jean' or 'sneakers'" },
        max_price: { type: "number", description: "Optional maximum price" },
        limit: { type: "integer", description: "Number of results (1-8, default 5)" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_product",
    description: "Get one product by its id (from search_products): price, stock and description.",
    parameters: {
      type: "object",
      properties: { product_id: { type: "string" } },
      required: ["product_id"],
    },
  },
  {
    name: "search_faq",
    description:
      "Look up the shop owner's own answers to policy questions: delivery times and fees, payment methods, returns and refunds, opening hours, warranty. Use this for ANY such question; never answer them from memory.",
    parameters: {
      type: "object",
      properties: { question: { type: "string", description: "The customer's question, in their own words" } },
      required: ["question"],
    },
  },
  {
    name: "list_my_orders",
    description:
      "List the logged-in customer's own recent orders with status and total. Requires a logged-in customer.",
    parameters: {
      type: "object",
      properties: { limit: { type: "integer", description: "1-5, default 5" } },
    },
  },
  {
    name: "track_my_order",
    description:
      "Get the real tracking status of one of the logged-in customer's own orders. Pass the order reference (the 8-character code shown to the customer) or omit it for the latest order.",
    parameters: {
      type: "object",
      properties: { reference: { type: "string", description: "Order reference, e.g. 'a1b2c3d4'" } },
    },
  },
];

/** The tools this person may use: everyone gets the shop tools; the owner and delivery people get their own extra ones. */
export function toolSpecsFor(role: UserRole | null): ToolSpec[] {
  if (role === UserRole.ADMIN) return [...TOOL_SPECS, ...ADMIN_TOOL_SPECS];
  if (role === UserRole.LIVREUR) return [...TOOL_SPECS, ...DRIVER_TOOL_SPECS];
  return TOOL_SPECS;
}

const searchArgs = z.object({
  query: z.string().trim().min(1).max(80),
  max_price: z.number().positive().max(1e9).optional(),
  limit: z.number().int().min(1).max(8).optional(),
});
const productArgs = z.object({ product_id: z.string().trim().min(1).max(40) });
const faqArgs = z.object({ question: z.string().trim().min(2).max(200) });
const ordersArgs = z.object({ limit: z.number().int().min(1).max(5).optional() });
const trackArgs = z.object({ reference: z.string().trim().min(3).max(30).optional() });

type ToolOutput = Record<string, unknown>;

const num = (d: Prisma.Decimal | number) => Number(d);
const shortRef = (id: string) => id.slice(-8);

function words(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2)
    .slice(0, 5);
}

async function searchProducts(db: PrismaClient, raw: unknown): Promise<ToolOutput> {
  const args = searchArgs.parse(raw);
  const terms = words(args.query);
  if (terms.length === 0) return { products: [], note: "Query too short." };

  const rows = await db.produit.findMany({
    where: {
      AND: [
        ...terms.map((t) => ({
          OR: [
            { nom: { contains: t, mode: Prisma.QueryMode.insensitive } },
            { objet: { contains: t, mode: Prisma.QueryMode.insensitive } },
            { categorie: { nom: { contains: t, mode: Prisma.QueryMode.insensitive } } },
          ],
        })),
        ...(args.max_price ? [{ prix: { lte: args.max_price } }] : []),
      ],
    },
    orderBy: { prix: "asc" },
    take: args.limit ?? 5,
    select: { id: true, nom: true, prix: true, qteStock: true, categorie: { select: { nom: true } } },
  });

  return {
    currency: CURRENCY,
    products: rows.map((p) => ({
      id: p.id,
      name: p.nom,
      category: p.categorie?.nom ?? null,
      price: num(p.prix),
      inStock: p.qteStock > 0,
      stock: p.qteStock,
    })),
  };
}

async function getProduct(db: PrismaClient, raw: unknown): Promise<ToolOutput> {
  const { product_id } = productArgs.parse(raw);
  const p = await db.produit.findUnique({
    where: { id: product_id },
    select: { id: true, nom: true, objet: true, prix: true, qteStock: true, categorie: { select: { nom: true } } },
  });
  if (!p) return { error: "PRODUCT_NOT_FOUND" };
  return {
    currency: CURRENCY,
    product: {
      id: p.id,
      name: p.nom,
      summary: p.objet,
      category: p.categorie?.nom ?? null,
      price: num(p.prix),
      inStock: p.qteStock > 0,
      stock: p.qteStock,
    },
  };
}

async function searchFaq(db: PrismaClient, raw: unknown): Promise<ToolOutput> {
  const { question } = faqArgs.parse(raw);
  const faqs = await searchFaqs(db, question);
  return faqs.length > 0
    ? { faqs }
    : { faqs: [], note: "The shop owner has not published an answer to this question." };
}

/** Order tools are for logged-in customers only. */
type Customer = { ok: true; userId: string } | { ok: false; output: ToolOutput };

function customerOnly(ctx: ChatContext): Customer {
  if (!ctx.userId) return { ok: false, output: { error: "LOGIN_REQUIRED" } };
  if (ctx.role !== UserRole.CLIENT) return { ok: false, output: { error: "CUSTOMERS_ONLY" } };
  return { ok: true, userId: ctx.userId };
}

async function listMyOrders(db: PrismaClient, ctx: ChatContext, raw: unknown): Promise<ToolOutput> {
  const who = customerOnly(ctx);
  if (!who.ok) return who.output;
  const { limit } = ordersArgs.parse(raw);

  const orders = await db.commande.findMany({
    where: { clientId: who.userId }, // always the session user
    orderBy: { date: "desc" },
    take: limit ?? 5,
    select: {
      id: true,
      date: true,
      statut: true,
      montant: true,
      lignesCommande: { select: { nomProduit: true, quantite: true } },
    },
  });

  return {
    currency: CURRENCY,
    orders: orders.map((o) => ({
      reference: shortRef(o.id),
      status: STATUS_LABELS_EN[o.statut],
      total: num(o.montant),
      date: o.date.toISOString().slice(0, 10),
      items: o.lignesCommande.map((l) => ({ name: l.nomProduit, quantity: l.quantite })),
    })),
  };
}

async function trackMyOrder(db: PrismaClient, ctx: ChatContext, raw: unknown): Promise<ToolOutput> {
  const who = customerOnly(ctx);
  if (!who.ok) return who.output;
  const { reference } = trackArgs.parse(raw);

  // Resolve the reference among THIS customer's orders only.
  const candidates = await db.commande.findMany({
    where: { clientId: who.userId, ...(reference ? { id: { endsWith: reference.replace(/^#/, "") } } : {}) },
    orderBy: { date: "desc" },
    take: 2,
    select: { id: true },
  });
  if (candidates.length === 0) return { error: "ORDER_NOT_FOUND" };
  if (reference && candidates.length > 1) return { error: "AMBIGUOUS_REFERENCE" };

  try {
    const t = await getTracking(db, {
      orderId: candidates[0].id,
      actor: { id: who.userId, role: UserRole.CLIENT },
    });
    const payment = await db.paiementCommande.findUnique({ where: { commandeId: t.orderId }, select: { statut: true } });
    return {
      reference: shortRef(t.orderId),
      status: t.statusLabel,
      payment: payment ? (payment.statut === "VALIDE" ? "Paid" : payment.statut === "ECHOUE" ? "Payment failed" : "Awaiting payment") : "No payment started",
      whatHappensNext: NEXT_STEP_EN[t.status],
      minutesLeft: t.eta ? Math.max(1, Math.round(t.eta.seconds / 60)) : null,
      // "road_route": worked out along real roads. "straight_line_estimate": only a straight line to the customer's spot (road
      // directions were not available), so it is a rough guide and the real drive is usually longer.
      timeLeftKind: t.eta ? (t.eta.source === "estimate" ? "straight_line_estimate" : "road_route") : null,
      kmLeft: t.eta ? Math.round(t.eta.metres / 100) / 10 : null,
      etaNote: t.eta ? null : t.trackingActive ? "No time estimate: no delivery spot was pinned on the map, or the delivery person has not shared a position yet." : null,
      outForDelivery: t.trackingActive,
      driverFirstName: t.driverFirstName,
      // Coordinates are deliberately not given to the chatbot; the tracking page shows the map.
      liveLocationAvailable: t.location !== null,
      liveLocationUpdatedAt: t.location?.updatedAt ?? null,
      // How old the last position is. Over a minute while out for delivery means the phone went quiet (screen locked, no signal).
      lastPositionSecondsAgo: t.location ? Math.max(0, Math.round((Date.now() - new Date(t.location.updatedAt).getTime()) / 1000)) : null,
      positionLooksOutOfDate: t.trackingActive && t.location ? Date.now() - new Date(t.location.updatedAt).getTime() > 60_000 : false,
      trackingPage: `/client/orders/${t.orderId}/track`,
      history: t.history.map((h) => ({ status: h.label, at: h.date })),
    };
  } catch (e) {
    if (e instanceof OrderError) return { error: e.code };
    throw e;
  }
}

/** Run one tool call. Never throws. */
export async function executeTool(
  db: PrismaClient,
  ctx: ChatContext,
  name: string,
  args: unknown
): Promise<{ ok: boolean; output: ToolOutput; json: string }> {
  let output: ToolOutput;
  try {
    switch (name) {
      case "search_products":
        output = await searchProducts(db, args);
        break;
      case "get_product":
        output = await getProduct(db, args);
        break;
      case "search_faq":
        output = await searchFaq(db, args);
        break;
      case "list_my_orders":
        output = await listMyOrders(db, ctx, args);
        break;
      case "track_my_order":
        output = await trackMyOrder(db, ctx, args);
        break;
      case "shop_overview":
        output = await shopOverview(db, ctx);
        break;
      case "list_deliveries":
        output = await listDeliveries(db, ctx, args);
        break;
      case "find_order":
        output = await findOrder(db, ctx, args);
        break;
      case "delivery_report":
        output = await deliveryReport(db, ctx, args);
        break;
      case "list_delivery_team":
        output = await listDeliveryTeam(db, ctx);
        break;
      case "my_deliveries":
        output = await myDeliveries(db, ctx);
        break;
      default:
        output = { error: "UNKNOWN_TOOL" };
    }
  } catch (e) {
    output = e instanceof z.ZodError ? { error: "INVALID_ARGUMENTS" } : { error: "TOOL_FAILED" };
    if (!(e instanceof z.ZodError)) console.error(`[chatbot] tool ${name} failed:`, e);
  }

  let json = JSON.stringify(output);
  if (json.length > MAX_RESULT_CHARS) json = JSON.stringify({ error: "RESULT_TOO_LARGE" });
  return { ok: !("error" in output), output, json };
}

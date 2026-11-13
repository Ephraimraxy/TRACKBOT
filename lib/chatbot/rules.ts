import type { PrismaClient } from "@prisma/client";

import type { ChatContext } from "@/lib/chatbot/types";
import { executeTool } from "@/lib/chatbot/tools";
import { STOPWORDS } from "@/lib/chatbot/text";
import { BRAND } from "@/lib/config/brand";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n/config";
import { translate } from "@/lib/i18n/translate";

export type Intent = "orders_list" | "order_track" | "faq" | "product" | "greeting" | "help" | "other";

const RE = {
  ordersList: /\b(mes commandes|my orders|historique (?:de|des) commandes?|order history)\b/i,
  orderTrack: /(où est|ou est|where is|track|suivi|suivre|statut|status|colis|ma commande|ma livraison|my order|my delivery|commande\s*#|order\s*#)/i,
  faq: /(délai|delai|livraison|expédition|expedition|paiement|payer|payment|pay|retour|return|rembours|refund|échange|echange|exchange|horaire|ouvert|opening|garantie|warranty|shipping|delivery|frais)/i,
  product: /(prix|price|cost|coûte|coute|combien|how much|stock|disponible|available|avez[- ]vous|do you have|cherche|looking for|acheter|buy|show me|montre)/i,
  greeting: /^\s*(bonjour|salut|bonsoir|hello|hi|hey|hola|buenas|sannu|ina kwana|barka|nnoo|ndewo|ndeewo|bawo|pẹlẹ o|ẹ kú)(?![\p{L}])/iu,
  help: /(\baide\b|\bhelp\b|que peux[- ]tu|what can you)/i,
  french: /[àâçéèêëîïôûùüÿœ]|\b(bonjour|salut|bonsoir|commande|commandes|prix|combien|où|ma|mon|mes|livraison|disponible|avez|cherche|suivi|merci)\b/i,
  // An order reference: anything written as "#abc12345", or a bare 6-25 character
  // code that mixes letters and digits (so ordinary words are never mistaken for one).
  reference: /#[a-z0-9]{6,25}(?![a-z0-9])|(?<![a-z0-9])(?=[a-z0-9]*\d)(?=[a-z0-9]*[a-z])[a-z0-9]{6,25}(?![a-z0-9])/i,
};

/** Questions the shop owner or a delivery person asks about the running business (not product shopping). */
const OPS_RE = /(deliver|livraison|order|commande|overview|summary|status|pending|stuck|driver|livreur|revenue|sales|income|paid|unpaid|payment|stock|customer|team|map|eta|how long|what should|what do i do|how do i|how does)/i;
export const isOpsQuestion = (message: string) => OPS_RE.test(message);

export const detectIntent = (message: string): Intent => {
  if (RE.ordersList.test(message)) return "orders_list";
  if (RE.orderTrack.test(message)) return "order_track";
  if (RE.faq.test(message)) return "faq";
  if (RE.product.test(message)) return "product";
  if (RE.greeting.test(message) && message.trim().split(/\s+/).length <= 4) return "greeting";
  if (RE.help.test(message)) return "help";
  return "other";
};

const isFrench = (message: string) => RE.french.test(message);

export function keywords(message: string): string {
  return message
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w))
    .slice(0, 4)
    .join(" ");
}

interface Product { name: string; price: number; inStock: boolean; stock: number }

/**
 * Reply language. French and English are written out in full (the shop was first built for a
 * French-speaking market, and a French question is still answered in French). Every other
 * language in the switcher goes through the translation dictionaries, and falls back to
 * English for a sentence that has no translation yet.
 */
type Lang = Locale;
type Vars = Record<string, string | number>;
const fill = (text: string, vars?: Vars) =>
  vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;

/** Pick the sentence in the reply language. `en` is also the translation key. */
const say = (lang: Lang, en: string, fr: string, vars?: Vars) =>
  lang === "fr" ? fill(fr, vars) : lang === "en" ? fill(en, vars) : translate(lang, en, vars);

const NAME = BRAND.assistantName;
const SYM = BRAND.currencySymbol;

function productLines(products: Product[], lang: Lang): string {
  return products
    .map((p) => {
      const stock = p.inStock
        ? say(lang, "in stock ({n})", "en stock ({n})", { n: p.stock })
        : say(lang, "out of stock", "rupture de stock");
      return `- **${p.name}**: ${SYM}${p.price} — ${stock}`;
    })
    .join("\n");
}

/** Which language to answer in: the one chosen in the switcher, else French when the customer wrote French. */
const replyLang = (locale: Locale, message: string): Lang =>
  locale !== DEFAULT_LOCALE ? locale : isFrench(message) ? "fr" : "en";

const S = {
  help: {
    en: "I can help you **find products** (price and stock), **see your orders** and **track a delivery**. Try: “price of jeans” or “where is my order?”.",
    fr: "Je peux vous aider à : **trouver des produits** (prix et stock), **voir vos commandes** et **suivre une livraison**. Essayez : « prix jean » ou « où est ma commande ? ».",
  },
  hello: {
    en: "Hello! I'm {name}, this shop's assistant. Ask me about a price, product availability, or your order status.",
    fr: "Bonjour ! Je suis {name}, l'assistant de la boutique. Demandez-moi un prix, la disponibilité d'un produit, ou l'état de votre commande.",
  },
  login: {
    en: "To look up your orders, please log in with a customer account first.",
    fr: "Pour consulter vos commandes, veuillez d'abord vous connecter avec un compte client.",
  },
  customersOnly: {
    en: "Order tracking is only available for customer accounts.",
    fr: "Le suivi de commande est réservé aux comptes clients.",
  },
  noFaq: {
    en: "I don't have that information. Please contact the shop owner directly.",
    fr: "Je n'ai pas cette information. Veuillez contacter directement le commerçant.",
  },
  noOrders: { en: "You don't have any orders yet.", fr: "Vous n'avez pas encore de commande." },
  noOrder: {
    en: "I can't find that order among yours. Please check the reference (8 characters).",
    fr: "Je ne trouve pas cette commande parmi les vôtres. Vérifiez la référence (8 caractères).",
  },
  ambiguous: {
    en: "Several orders match. Please give the full 8-character reference.",
    fr: "Plusieurs commandes correspondent. Donnez la référence complète à 8 caractères.",
  },
  noProduct: {
    en: "I couldn't find any product for “{q}”. Try another word.",
    fr: "Je n'ai trouvé aucun produit pour « {q} ». Essayez un autre mot.",
  },
  failure: {
    en: "Sorry, I can't retrieve that information right now. Please try again shortly.",
    fr: "Désolé, je n'arrive pas à récupérer cette information pour le moment. Réessayez dans un instant.",
  },
  latestOrders: { en: "Your latest orders:", fr: "Vos dernières commandes :" },
  found: { en: "Here is what I found:", fr: "Voici ce que j'ai trouvé :" },
  orderStatus: { en: "Order **#{ref}**: **{status}**.", fr: "Commande **#{ref}** : **{status}**." },
  outForDelivery: { en: "It is out for delivery.", fr: "Elle est en cours de livraison." },
  outForDeliveryWith: { en: "It is out for delivery with {driver}.", fr: "Elle est en cours de livraison avec {driver}." },
  livePosition: {
    en: "The driver's live position is shown on the tracking page.",
    fr: "La position du livreur est visible sur la page de suivi.",
  },
  timeLeft: { en: "About {m} min away ({d} km).", fr: "Environ {m} min restantes ({d} km)." },
  detailedTracking: { en: "Detailed tracking: {link}", fr: "Suivi détaillé : {link}" },
};
export const RULE_SENTENCES = Object.values(S).map((s) => s.en);

const pick = (t: { en: string; fr: string }, lang: Lang, vars?: Vars) => say(lang, t.en, t.fr, vars);

/**
 * Answer without any AI provider. It uses the very same tools as the AI path, so
 * prices, stock and order status are always real data, never invented text.
 */
export async function ruleBasedReply(args: {
  db: PrismaClient;
  ctx: ChatContext;
  message: string;
  locale?: Locale;
}): Promise<{ reply: string; usedTools: string[] }> {
  const { db, ctx, message } = args;
  const lang = replyLang(args.locale ?? DEFAULT_LOCALE, message);
  const intent = detectIntent(message);
  const used: string[] = [];

  const run = async (name: string, a: unknown) => {
    used.push(name);
    return executeTool(db, ctx, name, a);
  };
  const orderError = (code: unknown): string | null =>
    code === "LOGIN_REQUIRED" ? pick(S.login, lang)
    : code === "CUSTOMERS_ONLY" ? pick(S.customersOnly, lang)
    : code === "ORDER_NOT_FOUND" ? pick(S.noOrder, lang)
    : code === "AMBIGUOUS_REFERENCE" ? pick(S.ambiguous, lang)
    : null;

  // The shop owner and delivery people get their own answers from the same read-only tools.
  const isOwner = ctx.role === "ADMIN";
  const isDriver = ctx.role === "LIVREUR";
  if ((isOwner || isDriver) && intent !== "greeting" && intent !== "help" && intent !== "faq" && isOpsQuestion(message)) {
    const tr = (en: string, vars?: Vars) => (lang === "en" ? fill(en, vars) : translate(lang, en, vars));
    const row = (o: Record<string, unknown>) => {
      const bits = [`- #${o.reference} — ${tr(String(o.status))}`];
      if (o.customerFirstName) bits.push(String(o.customerFirstName));
      if (o.city) bits.push(String(o.city));
      if (o.payment) bits.push(tr(String(o.payment)));
      if (o.deliveryPerson) bits.push(tr("delivery: {n}", { n: String(o.deliveryPerson) }));
      if (o.minutesLeft != null) bits.push(tr("about {m} min left", { m: Number(o.minutesLeft) }));
      return bits.join(" — ") + (o.nextStep ? `
  _${tr(String(o.nextStep))}_` : "");
    };

    if (isDriver) {
      const r = await run("my_deliveries", {});
      if (!r.ok) return { reply: pick(S.failure, lang), usedTools: used };
      const list = r.output.deliveries as Record<string, unknown>[];
      if (list.length === 0) return { reply: tr("You have no deliveries assigned right now."), usedTools: used };
      return { reply: `${tr("Your deliveries:")}
${list.map(row).join("\n")}`, usedTools: used };
    }

    const ref = message.match(RE.reference)?.[0];
    if (ref) {
      const r = await run("find_order", { reference: ref });
      if (!r.ok) return { reply: orderError(r.output.error) ?? pick(S.failure, lang), usedTools: used };
      const o = r.output.order as Record<string, unknown>;
      const extra = [o.total != null ? `${SYM}${o.total}` : null, o.address ? String(o.address) : null].filter(Boolean).join(" — ");
      return { reply: `${row(o)}${extra ? `
${extra}` : ""}`, usedTools: used };
    }
    const [ov, dl] = [await run("shop_overview", {}), await run("list_deliveries", {})];
    if (!ov.ok || !dl.ok) return { reply: pick(S.failure, lang), usedTools: used };
    const counts = Object.entries(ov.output.ordersByStatus as Record<string, number>)
      .map(([k, v]) => `${tr(k)}: ${v}`)
      .join(", ");
    const lines = [
      tr("Orders by status — {counts}.", { counts }),
      tr("{n} orders are unpaid and still active; {w} shipped orders are waiting for a delivery person.", {
        n: Number(ov.output.activeUnpaidOrders),
        w: Number(ov.output.shippedWaitingForDeliveryPerson),
      }),
      tr("Money received: {amount} in total, {week} in the last 7 days.", {
        amount: `${SYM}${ov.output.moneyReceivedTotal}`,
        week: `${SYM}${ov.output.moneyReceivedLast7Days}`,
      }),
    ];
    const orders = dl.output.orders as Record<string, unknown>[];
    if (orders.length) lines.push(tr("In the delivery pipeline:"), ...orders.map(row));
    return { reply: lines.join("\n"), usedTools: used };
  }

  if (intent === "greeting") return { reply: pick(S.hello, lang, { name: NAME }), usedTools: used };
  if (intent === "help") return { reply: pick(S.help, lang), usedTools: used };

  if (intent === "faq") {
    const r = await run("search_faq", { question: message });
    if (!r.ok) return { reply: pick(S.failure, lang), usedTools: used };
    const faqs = r.output.faqs as { question: string; answer: string }[];
    if (faqs.length === 0) return { reply: pick(S.noFaq, lang), usedTools: used };
    const text = faqs.slice(0, 2).map((f) => `**${f.question}**\n${f.answer}`).join("\n\n");
    return { reply: text, usedTools: used };
  }

  if (intent === "orders_list") {
    const r = await run("list_my_orders", {});
    if (!r.ok) return { reply: orderError(r.output.error) ?? pick(S.failure, lang), usedTools: used };
    const orders = r.output.orders as { reference: string; status: string; total: number; date: string }[];
    if (orders.length === 0) return { reply: pick(S.noOrders, lang), usedTools: used };
    const lines = orders
      .map((o) => `- #${o.reference} — ${translate(lang, o.status)} — ${SYM}${o.total} (${o.date})`)
      .join("\n");
    return { reply: `${pick(S.latestOrders, lang)}\n${lines}`, usedTools: used };
  }

  if (intent === "order_track") {
    const ref = message.match(RE.reference)?.[0];
    const r = await run("track_my_order", ref ? { reference: ref } : {});
    if (!r.ok) return { reply: orderError(r.output.error) ?? pick(S.failure, lang), usedTools: used };
    const o = r.output as {
      reference: string; status: string; outForDelivery: boolean; driverFirstName: string | null;
      liveLocationAvailable: boolean; trackingPage: string; minutesLeft: number | null; kmLeft: number | null;
    };
    const parts = [pick(S.orderStatus, lang, { ref: o.reference, status: translate(lang, o.status) })];
    if (o.outForDelivery) {
      parts.push(
        o.driverFirstName
          ? pick(S.outForDeliveryWith, lang, { driver: o.driverFirstName })
          : pick(S.outForDelivery, lang)
      );
      if (o.liveLocationAvailable) parts.push(pick(S.livePosition, lang));
      if (o.minutesLeft != null) parts.push(pick(S.timeLeft, lang, { m: o.minutesLeft, d: o.kmLeft ?? 0 }));
    }
    parts.push(pick(S.detailedTracking, lang, { link: o.trackingPage }));
    return { reply: parts.join(" "), usedTools: used };
  }

  // product questions, and anything else: try a catalogue search on the keywords.
  const q = keywords(message);
  if (!q) return { reply: pick(S.help, lang), usedTools: used };
  const r = await run("search_products", { query: q });
  if (!r.ok) return { reply: pick(S.failure, lang), usedTools: used };
  const products = r.output.products as Product[];
  if (products.length === 0) {
    return { reply: intent === "product" ? pick(S.noProduct, lang, { q }) : pick(S.help, lang), usedTools: used };
  }
  return { reply: `${pick(S.found, lang)}\n${productLines(products, lang)}`, usedTools: used };
}

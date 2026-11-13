import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { UserRole as R } from "@prisma/client";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));

import { auth } from "@/lib/auth";
import { GET as listRoute, POST as createRoute } from "@/app/api/faqs/route";
import { DELETE as deleteRoute, PATCH as patchRoute } from "@/app/api/faqs/[faqId]/route";
import { POST as chatRoute } from "@/app/api/chat/route";
import { runChat } from "@/lib/chatbot/engine";
import { detectIntent, ruleBasedReply } from "@/lib/chatbot/rules";
import { executeTool } from "@/lib/chatbot/tools";
import type { ChatContext, ChatMessage, ChatProvider, ProviderReply } from "@/lib/chatbot/types";
import { createFaq, deleteFaq, listFaqs, searchFaqs, updateFaq } from "@/lib/services/faqService";
import { db, makeUser, resetDb } from "./helpers";

const mockedAuth = vi.mocked(auth) as unknown as ReturnType<typeof vi.fn>;
const loginAs = (u: { id: string; role: R } | null) =>
  mockedAuth.mockResolvedValue(u ? { user: { id: u.id, role: u.role } } : null);

const anon: ChatContext = { userId: null, role: null };
const actor = (u: { id: string }, role: R) => ({ id: u.id, role });

const req = (method: string, body?: unknown) =>
  new NextRequest("http://localhost/api/faqs", {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": `10.1.0.${Math.floor(Math.random() * 250)}` },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
const ctx = (faqId: string) => ({ params: Promise.resolve({ faqId }) });

async function seedFaqs() {
  await db.faq.createMany({
    data: [
      { question: "Quels sont les délais de livraison ?", answer: "Livraison en 2 à 5 jours. Frais : 500 DA.", keywords: "delai, shipping, expedition" },
      { question: "Puis-je retourner un article ?", answer: "Oui, sous 7 jours après réception.", keywords: "retour, remboursement, refund" },
      { question: "Quels modes de paiement ?", answer: "Paiement à la livraison ou par carte.", keywords: "payer, paiement, payment" },
      { question: "Horaires", answer: "Ouvert de 9h à 18h.", keywords: "ouverture, opening hours", actif: false } as never,
    ],
  });
}

beforeEach(async () => {
  await resetDb();
  mockedAuth.mockReset();
  loginAs(null);
  vi.unstubAllEnvs();
  ["DEEPSEEK_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"].forEach((k) => vi.stubEnv(k, ""));
});
afterAll(() => db.$disconnect());

describe("faq service: management (admin only)", () => {
  it("admin can create, list, update and delete", async () => {
    const admin = actor(await makeUser(R.ADMIN), R.ADMIN);

    const created = await createFaq(db, admin, { question: "Livrez-vous le dimanche ?", answer: "Non.", keywords: " " });
    expect(created).toMatchObject({ question: "Livrez-vous le dimanche ?", actif: true, keywords: null });

    const updated = await updateFaq(db, admin, created.id, { answer: "Oui, sur demande.", actif: false });
    expect(updated).toMatchObject({ answer: "Oui, sur demande.", actif: false, question: "Livrez-vous le dimanche ?" });

    expect((await listFaqs(db, admin)).map((f) => f.id)).toEqual([created.id]);

    await deleteFaq(db, admin, created.id);
    expect(await listFaqs(db, admin)).toEqual([]);
  });

  it("everyone else is refused (customer, driver, vendor)", async () => {
    const admin = actor(await makeUser(R.ADMIN), R.ADMIN);
    const entry = await createFaq(db, admin, { question: "Une question ?", answer: "Une réponse." });
    for (const role of [R.CLIENT, R.LIVREUR, R.VENDEUR]) {
      const who = actor(await makeUser(role), role);
      await expect(listFaqs(db, who)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(createFaq(db, who, { question: "Hack ?", answer: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(updateFaq(db, who, entry.id, { answer: "pwned" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(deleteFaq(db, who, entry.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect((await db.faq.findUniqueOrThrow({ where: { id: entry.id } })).answer).toBe("Une réponse.");
  });

  it("validates input and reports unknown ids", async () => {
    const admin = actor(await makeUser(R.ADMIN), R.ADMIN);
    for (const bad of [{}, { question: "ab", answer: "x" }, { question: "ok question", answer: "" }, { question: "q".repeat(256), answer: "x" }, { question: "ok question", answer: "a".repeat(1001) }, { question: 5, answer: "x" }]) {
      await expect(createFaq(db, admin, bad)).rejects.toMatchObject({ code: "INVALID" });
    }
    const entry = await createFaq(db, admin, { question: "Une question ?", answer: "Une réponse." });
    await expect(updateFaq(db, admin, entry.id, {})).rejects.toMatchObject({ code: "INVALID" });
    await expect(updateFaq(db, admin, "missing", { answer: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteFaq(db, admin, "missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("faq service: search", () => {
  it("matches by question words, ignoring accents and plurals", async () => {
    await seedFaqs();
    const r = await searchFaqs(db, "quels sont vos délais de livraisons ?");
    expect(r[0].question).toContain("délais de livraison");
  });

  it("matches synonyms the owner added in keywords", async () => {
    await seedFaqs();
    expect((await searchFaqs(db, "what is your refund policy?"))[0].question).toContain("retourner");
    expect((await searchFaqs(db, "how do I make a payment?"))[0].question).toContain("paiement");
  });

  it("matches whole words only: a shorter form is found only if the owner listed it as a keyword", async () => {
    await seedFaqs();
    // "pay" is not among the keywords (payer, paiement, payment), so it does not match "payment".
    expect(await searchFaqs(db, "how can I pay")).toEqual([]);
    const entry = await db.faq.findFirstOrThrow({ where: { question: { contains: "paiement" } } });
    await db.faq.update({ where: { id: entry.id }, data: { keywords: "payer, paiement, payment, pay" } });
    expect((await searchFaqs(db, "how can I pay"))[0].question).toContain("paiement");
  });

  it("never returns deactivated entries", async () => {
    await seedFaqs();
    expect(await searchFaqs(db, "horaires ouverture opening hours")).toEqual([]);
  });

  it("ignores weak matches, stop-words-only queries and unrelated questions", async () => {
    await seedFaqs();
    expect(await searchFaqs(db, "banane")).toEqual([]);
    expect(await searchFaqs(db, "le la de")).toEqual([]);
    expect(await searchFaqs(db, "")).toEqual([]);
    // "jours" appears only inside one answer (weight 1 < threshold 2)
    expect(await searchFaqs(db, "jours")).toEqual([]);
  });

  it("returns only question and answer, at most 3 entries", async () => {
    for (let i = 0; i < 5; i++) {
      await db.faq.create({ data: { question: `Livraison cas ${i}`, answer: "Réponse livraison", keywords: "livraison" } });
    }
    const r = await searchFaqs(db, "livraison");
    expect(r).toHaveLength(3);
    expect(Object.keys(r[0]).sort()).toEqual(["answer", "question"]);
  });
});

describe("faq admin routes", () => {
  it("GET: 401 anonymous, 403 customer, 200 admin", async () => {
    const client = await makeUser();
    const admin = await makeUser(R.ADMIN);
    expect((await listRoute()).status).toBe(401);
    loginAs(client);
    expect((await listRoute()).status).toBe(403);
    loginAs(admin);
    expect((await listRoute()).status).toBe(200);
  });

  it("POST: 401, 403, 400 (malformed and invalid), 201", async () => {
    const client = await makeUser();
    const admin = await makeUser(R.ADMIN);
    const good = { question: "Horaires d'ouverture ?", answer: "9h-18h" };

    expect((await createRoute(req("POST", good))).status).toBe(401);
    loginAs(client);
    expect((await createRoute(req("POST", good))).status).toBe(403);
    loginAs(admin);
    expect((await createRoute(req("POST", "not json"))).status).toBe(400);
    expect((await createRoute(req("POST", { question: "x", answer: "" }))).status).toBe(400);
    const ok = await createRoute(req("POST", good));
    expect(ok.status).toBe(201);
    expect((await ok.json()).data).toMatchObject({ question: good.question, actif: true });
  });

  it("PATCH and DELETE: 401, 403, 404, 400, 200/204", async () => {
    const client = await makeUser();
    const admin = await makeUser(R.ADMIN);
    const entry = await createFaq(db, actor(admin, R.ADMIN), { question: "Une question ?", answer: "Une réponse." });

    expect((await patchRoute(req("PATCH", { actif: false }), ctx(entry.id))).status).toBe(401);
    expect((await deleteRoute(req("DELETE"), ctx(entry.id))).status).toBe(401);
    loginAs(client);
    expect((await patchRoute(req("PATCH", { actif: false }), ctx(entry.id))).status).toBe(403);
    expect((await deleteRoute(req("DELETE"), ctx(entry.id))).status).toBe(403);

    loginAs(admin);
    expect((await patchRoute(req("PATCH", { actif: false }), ctx("missing"))).status).toBe(404);
    expect((await patchRoute(req("PATCH", {}), ctx(entry.id))).status).toBe(400);
    expect((await patchRoute(req("PATCH", "bad"), ctx(entry.id))).status).toBe(400);
    const off = await patchRoute(req("PATCH", { actif: false }), ctx(entry.id));
    expect(off.status).toBe(200);
    expect((await off.json()).data.actif).toBe(false);

    expect((await deleteRoute(req("DELETE"), ctx("missing"))).status).toBe(404);
    expect((await deleteRoute(req("DELETE"), ctx(entry.id))).status).toBe(204);
    expect(await db.faq.count()).toBe(0);
  });
});

describe("chatbot uses the FAQ (and never invents policies)", () => {
  it("detects policy questions without stealing order questions", () => {
    expect(detectIntent("quels sont vos délais de livraison ?")).toBe("faq");
    expect(detectIntent("what is your return policy?")).toBe("faq");
    expect(detectIntent("comment payer ?")).toBe("faq");
    expect(detectIntent("où est ma livraison ?")).toBe("order_track");
    expect(detectIntent("where is my order")).toBe("order_track");
    expect(detectIntent("prix du jean")).toBe("product");
  });

  it("tool search_faq returns entries, a note when there is none, and rejects bad arguments", async () => {
    await seedFaqs();
    const hit = await executeTool(db, anon, "search_faq", { question: "délais de livraison" });
    expect((hit.output.faqs as unknown[]).length).toBeGreaterThan(0);
    const miss = await executeTool(db, anon, "search_faq", { question: "banane" });
    expect(miss.output.faqs).toEqual([]);
    expect(String(miss.output.note)).toContain("not published");
    expect((await executeTool(db, anon, "search_faq", {})).output).toEqual({ error: "INVALID_ARGUMENTS" });
  });

  it("rule-based bot answers with the owner's text, in French and English", async () => {
    await seedFaqs();
    const fr = await ruleBasedReply({ db, ctx: anon, message: "Quels sont vos délais de livraison ?" });
    expect(fr.usedTools).toEqual(["search_faq"]);
    expect(fr.reply).toContain("Livraison en 2 à 5 jours");
    const en = await ruleBasedReply({ db, ctx: anon, message: "what is your refund policy?" });
    expect(en.reply).toContain("sous 7 jours");
  });

  it("says it has no information instead of inventing a policy", async () => {
    const empty = await ruleBasedReply({ db, ctx: anon, message: "Quels sont vos délais de livraison ?" });
    expect(empty.reply).toContain("contacter");
    expect(empty.reply).not.toMatch(/\d+ ?(jours|DA)/);

    await seedFaqs();
    const noMatch = await ruleBasedReply({ db, ctx: anon, message: "do you offer gift warranty extension?" });
    expect(noMatch.reply).toContain("contact the shop owner");
  });

  it("stops using an entry as soon as the owner deactivates it", async () => {
    await seedFaqs();
    const entry = await db.faq.findFirstOrThrow({ where: { question: { contains: "retourner" } } });
    await db.faq.update({ where: { id: entry.id }, data: { actif: false } });
    const r = await ruleBasedReply({ db, ctx: anon, message: "puis-je retourner un article ?" });
    expect(r.reply).not.toContain("7 jours");
  });

  describe("AI path", () => {
    const scripted = (steps: ProviderReply[]) => {
      const seen: ChatMessage[][] = [];
      let i = 0;
      const provider: ChatProvider = {
        id: "deepseek",
        async complete({ messages }) {
          seen.push(structuredClone(messages));
          return steps[Math.min(i++, steps.length - 1)];
        },
      };
      return { provider, seen };
    };

    it("a policy answer given without calling search_faq is rejected", async () => {
      await seedFaqs();
      const lazy = scripted([{ text: "Nous livrons en 24 heures partout." }]);
      const r = await runChat({ db, ctx: anon, message: "Quels sont vos délais de livraison ?", providers: [lazy.provider] });
      expect(r.source).toBe("rules");
      expect(r.reply).toContain("2 à 5 jours");
      expect(r.reply).not.toContain("24 heures");
    });

    it("an answer based on search_faq is accepted, including the amount the FAQ contains", async () => {
      await seedFaqs();
      const good = scripted([
        { toolCalls: [{ id: "f1", name: "search_faq", args: { question: "délais de livraison" } }] },
        { text: "La livraison prend 2 à 5 jours, frais de 500 DA." },
      ]);
      const r = await runChat({ db, ctx: anon, message: "Quels sont vos délais de livraison ?", providers: [good.provider] });
      expect(r.source).toBe("deepseek");
      expect(r.usedTools).toEqual(["search_faq"]);
    });

    it("an amount that is not in the FAQ is rejected", async () => {
      await seedFaqs();
      const liar = scripted([
        { toolCalls: [{ id: "f1", name: "search_faq", args: { question: "délais de livraison" } }] },
        { text: "La livraison coûte seulement 300 DA." },
      ]);
      const r = await runChat({ db, ctx: anon, message: "Quels sont vos délais de livraison ?", providers: [liar.provider] });
      expect(r.source).toBe("rules");
      expect(r.reply).toContain("500 DA");
      expect(r.reply).not.toContain("300");
    });
  });

  it("end to end through /api/chat (no AI keys)", async () => {
    await seedFaqs();
    const res = await chatRoute(
      new NextRequest("http://localhost/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.77" },
        body: JSON.stringify({ message: "Quels sont vos délais de livraison ?" }),
      })
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ source: "rules", usedTools: ["search_faq"] });
    expect(body.reply).toContain("2 à 5 jours");
  });
});

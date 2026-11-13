import { PrismaClient, UserRole } from "@prisma/client";
import { z } from "zod";

import { significantTokens } from "@/lib/chatbot/text";
import type { StatusActor } from "@/lib/services/orderService";

export type FaqErrorCode = "FORBIDDEN" | "NOT_FOUND" | "INVALID";

export class FaqError extends Error {
  constructor(
    public code: FaqErrorCode,
    message: string
  ) {
    super(message);
    this.name = "FaqError";
  }
}

export const faqInput = z.object({
  question: z.string().trim().min(3).max(255),
  answer: z.string().trim().min(1).max(1000),
  keywords: z.string().trim().max(255).nullable().optional(),
  actif: z.boolean().optional(),
});
export const faqPatch = faqInput.partial().refine((v) => Object.keys(v).length > 0, {
  message: "Nothing to update",
});

const select = {
  id: true,
  question: true,
  answer: true,
  keywords: true,
  actif: true,
  dateCreation: true,
  dateModification: true,
} as const;

function adminOnly(actor: StatusActor) {
  if (actor.role !== UserRole.ADMIN) throw new FaqError("FORBIDDEN", "Access denied.");
}

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const r = schema.safeParse(raw);
  if (!r.success) throw new FaqError("INVALID", "Invalid data.");
  return r.data;
}

export async function listFaqs(db: PrismaClient, actor: StatusActor) {
  adminOnly(actor);
  return db.faq.findMany({ orderBy: { dateCreation: "desc" }, select });
}

export async function createFaq(db: PrismaClient, actor: StatusActor, raw: unknown) {
  adminOnly(actor);
  const data = parse(faqInput, raw);
  return db.faq.create({ data: { ...data, keywords: data.keywords || null }, select });
}

export async function updateFaq(db: PrismaClient, actor: StatusActor, id: string, raw: unknown) {
  adminOnly(actor);
  const data = parse(faqPatch, raw);
  const exists = await db.faq.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw new FaqError("NOT_FOUND", "FAQ entry not found.");
  return db.faq.update({
    where: { id },
    data: { ...data, ...("keywords" in data ? { keywords: data.keywords || null } : {}) },
    select,
  });
}

export async function deleteFaq(db: PrismaClient, actor: StatusActor, id: string) {
  adminOnly(actor);
  const exists = await db.faq.findUnique({ where: { id }, select: { id: true } });
  if (!exists) throw new FaqError("NOT_FOUND", "FAQ entry not found.");
  await db.faq.delete({ where: { id } });
}

/** Entries a question must score at least this much against to count as a match. */
export const MIN_FAQ_SCORE = 2;

/**
 * Find the active FAQ entries that best match a customer's question. Public (no login):
 * only active entries are searched and only question + answer are returned.
 * Scoring: a word found in an entry's question or keywords counts 2, found only in
 * its answer counts 1. The owner can add synonyms in `keywords` to improve matching.
 */
export async function searchFaqs(db: PrismaClient, query: string, limit = 3) {
  const words = significantTokens(query, 3);
  if (words.length === 0) return [];

  const entries = await db.faq.findMany({
    where: { actif: true },
    take: 200,
    select: { question: true, answer: true, keywords: true },
  });

  return entries
    .map((e) => {
      const head = new Set(significantTokens(`${e.question} ${e.keywords ?? ""}`, 3));
      const body = new Set(significantTokens(e.answer, 3));
      const score = words.reduce((s, w) => s + (head.has(w) ? 2 : body.has(w) ? 1 : 0), 0);
      return { question: e.question, answer: e.answer, score };
    })
    .filter((e) => e.score >= MIN_FAQ_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ question, answer }) => ({ question, answer }));
}

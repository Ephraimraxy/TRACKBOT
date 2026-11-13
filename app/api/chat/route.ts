import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/utils/prisma";
import { buildProviders } from "@/lib/chatbot/providers";
import { runChat } from "@/lib/chatbot/engine";
import { createRateLimiter } from "@/lib/utils/rateLimit";
import { ERROR_MESSAGES } from "@/lib/constants/settings";
import { DEFAULT_LOCALE, isLocale } from "@/lib/i18n/config";

const bodySchema = z.object({
  message: z.string().trim().min(1).max(500),
  // The language chosen in the switcher; anything unsupported is treated as English.
  locale: z.string().max(8).optional(),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(1000) }))
    .max(10)
    .default([]),
});

// 20 messages per minute per user (or per IP when anonymous).
const allow = createRateLimiter({ limit: 20, windowMs: 60_000 });

// Anyone may chat (product questions are public). Order questions need a logged-in
// customer, and the identity used by the tools always comes from the session below.
export async function POST(req: NextRequest) {
  const session = await auth();
  const ctx = { userId: session?.user?.id ?? null, role: session?.user?.role ?? null };

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  if (!allow(ctx.userId ?? `ip:${ip}`)) {
    return NextResponse.json({ error: "Too many messages. Try again in a minute." }, { status: 429 });
  }

  let parsed;
  try {
    parsed = bodySchema.safeParse(await req.json());
  } catch {
    return NextResponse.json({ error: ERROR_MESSAGES.BAD_REQUEST }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json({ error: ERROR_MESSAGES.BAD_REQUEST }, { status: 400 });
  }

  try {
    const result = await runChat({
      db: prisma,
      ctx,
      message: parsed.data.message,
      history: parsed.data.history,
      locale: isLocale(parsed.data.locale) ? parsed.data.locale : DEFAULT_LOCALE,
      providers: buildProviders(),
    });

    if (result.skipped.length > 0) {
      // Server log only: reasons never reach the client, and contain no keys.
      console.warn("[chatbot] providers skipped:", result.skipped.join(" | "));
    }

    return NextResponse.json(
      { reply: result.reply, source: result.source, usedTools: result.usedTools },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("API Error [POST /api/chat]:", error);
    return NextResponse.json({ error: ERROR_MESSAGES.INTERNAL_ERROR }, { status: 500 });
  }
}

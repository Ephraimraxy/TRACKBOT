import { NextRequest, NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/utils/prisma";
import { getPaystackClient } from "@/lib/payments/paystack";
import { confirmPayment } from "@/lib/services/paymentService";
import { paymentErrorResponse } from "@/lib/utils/paymentErrorResponse";
import { createRateLimiter } from "@/lib/utils/rateLimit";
import { ERROR_MESSAGES } from "@/lib/constants/settings";

const bodySchema = z.object({ reference: z.string().min(1).max(100) });
const allow = createRateLimiter({ limit: 30, windowMs: 60_000 });

/** The customer is back from Paystack: ask Paystack whether the money arrived and update the order. */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 });
  if (session.user.role !== UserRole.CLIENT) return NextResponse.json({ error: ERROR_MESSAGES.FORBIDDEN }, { status: 403 });
  if (!allow(session.user.id)) return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: ERROR_MESSAGES.BAD_REQUEST }, { status: 400 });

  try {
    const outcome = await confirmPayment(prisma, getPaystackClient(), { reference: parsed.data.reference, userId: session.user.id });
    return NextResponse.json(outcome, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const known = paymentErrorResponse(error);
    if (known) return known;
    console.error("API Error [POST /api/payments/paystack/verify]:", error);
    return NextResponse.json({ error: ERROR_MESSAGES.INTERNAL_ERROR }, { status: 500 });
  }
}

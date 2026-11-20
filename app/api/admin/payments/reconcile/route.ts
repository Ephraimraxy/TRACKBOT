import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";

import { auth } from "@/lib/auth";
import { ERROR_MESSAGES } from "@/lib/constants/settings";
import { prisma } from "@/lib/utils/prisma";
import { getPaystackClient } from "@/lib/payments/paystack";
import { reconcilePendingPayments } from "@/lib/services/paymentService";
import { orderErrorResponse } from "@/lib/utils/orderErrorResponse";
import { paymentErrorResponse } from "@/lib/utils/paymentErrorResponse";
import { createRateLimiter } from "@/lib/utils/rateLimit";

export const dynamic = "force-dynamic";
const allow = createRateLimiter({ limit: 5, windowMs: 60_000 });

// POST (owner only): ask Paystack about payments that were started but never confirmed, and update the orders.
export async function POST() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 });
  if (session.user.role !== UserRole.ADMIN) return NextResponse.json({ error: ERROR_MESSAGES.FORBIDDEN }, { status: 403 });
  if (!allow(session.user.id)) return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 });
  try {
    const actor = { id: session.user.id, role: session.user.role };
    const data = await reconcilePendingPayments(prisma, getPaystackClient(), { actor });
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return paymentErrorResponse(error) ?? orderErrorResponse(error, "POST /api/admin/payments/reconcile");
  }
}

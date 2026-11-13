import { NextRequest, NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/utils/prisma";
import { getPaystackClient } from "@/lib/payments/paystack";
import { initializePayment } from "@/lib/services/paymentService";
import { paymentErrorResponse } from "@/lib/utils/paymentErrorResponse";
import { appOrigin } from "@/lib/utils/appOrigin";
import { createRateLimiter } from "@/lib/utils/rateLimit";
import { ERROR_MESSAGES } from "@/lib/constants/settings";

const bodySchema = z.object({ orderId: z.string().min(1).max(40) });
const allow = createRateLimiter({ limit: 10, windowMs: 60_000 });

/** Start paying for one of the signed-in customer's orders; answers with the Paystack page to open. */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 });
  if (session.user.role !== UserRole.CLIENT) return NextResponse.json({ error: ERROR_MESSAGES.FORBIDDEN }, { status: 403 });
  if (!allow(session.user.id)) return NextResponse.json({ error: "Too many attempts. Try again in a minute." }, { status: 429 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: ERROR_MESSAGES.BAD_REQUEST }, { status: 400 });

  try {
    const result = await initializePayment(prisma, getPaystackClient(), {
      orderId: parsed.data.orderId,
      userId: session.user.id,
      email: session.user.email,
      callbackUrl: `${appOrigin(req)}/payment/callback`,
    });
    return NextResponse.json({ authorizationUrl: result.authorizationUrl, reference: result.reference }, { status: 200 });
  } catch (error) {
    const known = paymentErrorResponse(error);
    if (known) return known;
    console.error("API Error [POST /api/payments/paystack/initialize]:", error);
    return NextResponse.json({ error: ERROR_MESSAGES.INTERNAL_ERROR }, { status: 500 });
  }
}

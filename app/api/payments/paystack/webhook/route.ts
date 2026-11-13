import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/utils/prisma";
import { PaymentError } from "@/lib/payments/paystack";
import { processWebhook } from "@/lib/services/paymentService";

/**
 * Paystack calls this itself when a payment succeeds, so the order is marked paid even if the customer
 * closed the browser before coming back. Set it in the Paystack dashboard (Settings > API Keys & Webhooks):
 *   https://<your-site>/api/payments/paystack/webhook
 * Only requests signed with your secret key are accepted.
 */
export async function POST(req: NextRequest) {
  const secretKey = process.env.PAYSTACK_SECRET_KEY?.trim();
  if (!secretKey) return NextResponse.json({ error: "Payments are not configured." }, { status: 503 });

  // The signature is computed over the exact bytes sent, so read the body as text, not JSON.
  const rawBody = await req.text();

  try {
    const { handled } = await processWebhook(prisma, {
      rawBody,
      signature: req.headers.get("x-paystack-signature"),
      secretKey,
    });
    return NextResponse.json({ received: true, handled }, { status: 200 });
  } catch (error) {
    if (error instanceof PaymentError && error.code === "BAD_SIGNATURE") {
      return NextResponse.json({ error: "Invalid signature." }, { status: 401 });
    }
    console.error("API Error [POST /api/payments/paystack/webhook]:", error);
    // A 500 makes Paystack retry later, which is what we want for a transient failure.
    return NextResponse.json({ error: "Could not process the event." }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { ERROR_MESSAGES } from "@/lib/constants/settings";
import { prisma } from "@/lib/utils/prisma";
import { listPaymentIssues } from "@/lib/services/paymentService";
import { orderErrorResponse } from "@/lib/utils/orderErrorResponse";

export const dynamic = "force-dynamic";

// GET (owner only): payments that need a look: wrong amount, second payment, dispute, refund. ?status=open|resolved
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 });
  const s = req.nextUrl.searchParams.get("status");
  try {
    const data = await listPaymentIssues(prisma, { actor: { id: session.user.id, role: session.user.role }, status: s === "open" || s === "resolved" ? s : undefined });
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return orderErrorResponse(error, "GET /api/admin/payment-issues");
  }
}

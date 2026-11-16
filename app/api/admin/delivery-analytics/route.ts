import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { ERROR_MESSAGES } from "@/lib/constants/settings";
import { prisma } from "@/lib/utils/prisma";
import { getDeliveryAnalytics } from "@/lib/services/deliveryReportService";
import { orderErrorResponse } from "@/lib/utils/orderErrorResponse";

export const dynamic = "force-dynamic";

// GET (owner only): delivery analytics. ?days=30 limits it to recent deliveries.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 });
  const days = Number(req.nextUrl.searchParams.get("days"));
  const since = Number.isFinite(days) && days > 0 ? new Date(Date.now() - Math.min(days, 366) * 86_400_000) : undefined;
  try {
    const data = await getDeliveryAnalytics(prisma, { actor: { id: session.user.id, role: session.user.role }, since });
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return orderErrorResponse(error, "GET /api/admin/delivery-analytics");
  }
}

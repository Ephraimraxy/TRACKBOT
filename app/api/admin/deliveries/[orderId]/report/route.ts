import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { ERROR_MESSAGES } from "@/lib/constants/settings";
import { prisma } from "@/lib/utils/prisma";
import { getDeliveryReport } from "@/lib/services/deliveryReportService";
import { orderErrorResponse } from "@/lib/utils/orderErrorResponse";

export const dynamic = "force-dynamic";

// GET (owner only): the movement of one delivery for playback, with the GPS, stop and deviation findings.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 });
  const { orderId } = await params;
  try {
    const data = await getDeliveryReport(prisma, { orderId: String(orderId), actor: { id: session.user.id, role: session.user.role } });
    return NextResponse.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return orderErrorResponse(error, "GET /api/admin/deliveries/:id/report");
  }
}

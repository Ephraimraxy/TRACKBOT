import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { ERROR_MESSAGES } from "@/lib/constants/settings";
import { prisma } from "@/lib/utils/prisma";
import { getTracking } from "@/lib/services/trackingService";
import { orderErrorResponse } from "@/lib/utils/orderErrorResponse";

// GET: tracking data for the order's owner (or the admin): status, timeline,
// driver first name and the latest GPS point while out for delivery.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 });
  }

  const { orderId } = await params;

  try {
    const data = await getTracking(prisma, {
      orderId: String(orderId),
      actor: { id: session.user.id, role: session.user.role },
    });
    return NextResponse.json(
      { data },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return orderErrorResponse(error, "GET /api/orders/:id/tracking");
  }
}

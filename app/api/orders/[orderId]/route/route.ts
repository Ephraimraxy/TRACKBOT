import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { ERROR_MESSAGES } from "@/lib/constants/settings";
import { prisma } from "@/lib/utils/prisma";
import { getRoutePlan } from "@/lib/services/routeService";
import { orderErrorResponse } from "@/lib/utils/orderErrorResponse";

export const dynamic = "force-dynamic";

// GET: the road route from the delivery person to the customer's spot, with the next turn for the delivery person
// and the owner. Customers get the line and the time left, not the turn-by-turn steps.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 });
  }
  const { orderId } = await params;
  try {
    const data = await getRoutePlan(prisma, { orderId: String(orderId), actor: { id: session.user.id, role: session.user.role } });
    return NextResponse.json({ data }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return orderErrorResponse(error, "GET /api/orders/:id/route");
  }
}

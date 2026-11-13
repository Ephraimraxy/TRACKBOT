import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { ERROR_MESSAGES } from "@/lib/constants/settings";
import { prisma } from "@/lib/utils/prisma";
import { listDriverDeliveries } from "@/lib/services/deliveryService";
import { orderErrorResponse } from "@/lib/utils/orderErrorResponse";

// GET: the logged-in delivery person's own assigned deliveries.
export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 });
  }

  try {
    const data = await listDriverDeliveries(prisma, {
      id: session.user.id,
      role: session.user.role,
    });
    return NextResponse.json({ data }, { status: 200 });
  } catch (error) {
    return orderErrorResponse(error, "GET /api/delivery/orders");
  }
}

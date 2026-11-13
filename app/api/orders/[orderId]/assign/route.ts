import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { ERROR_MESSAGES } from "@/lib/constants/settings";
import { prisma } from "@/lib/utils/prisma";
import { assignDriver } from "@/lib/services/deliveryService";
import { orderErrorResponse } from "@/lib/utils/orderErrorResponse";

// POST: the business admin assigns (or reassigns) a delivery person to an order.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: ERROR_MESSAGES.FORBIDDEN }, { status: 403 });
  }

  const { orderId } = await params;

  let driverId: unknown;
  try {
    ({ driverId } = await req.json());
  } catch {
    return NextResponse.json({ error: ERROR_MESSAGES.BAD_REQUEST }, { status: 400 });
  }
  if (typeof driverId !== "string" || driverId.length === 0 || driverId.length > 25) {
    return NextResponse.json({ error: ERROR_MESSAGES.BAD_REQUEST }, { status: 400 });
  }

  try {
    const livraison = await assignDriver(prisma, {
      orderId: String(orderId),
      driverId,
      actor: { id: session.user.id, role: session.user.role },
    });
    return NextResponse.json(
      { message: "Delivery person assigned successfully", data: livraison },
      { status: 200 }
    );
  } catch (error) {
    return orderErrorResponse(error, "POST /api/orders/:id/assign");
  }
}

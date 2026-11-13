import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { ERROR_MESSAGES } from "@/lib/constants/settings";
import { prisma } from "@/lib/utils/prisma";
import { recordDriverLocation } from "@/lib/services/trackingService";
import { orderErrorResponse } from "@/lib/utils/orderErrorResponse";

// POST: the assigned delivery person's phone reports its GPS position
// (only accepted while the order is out for delivery).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 });
  }
  if (session.user.role !== "LIVREUR") {
    return NextResponse.json({ error: ERROR_MESSAGES.FORBIDDEN }, { status: 403 });
  }

  const { orderId } = await params;

  let body: { latitude?: unknown; longitude?: unknown; accuracy?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: ERROR_MESSAGES.BAD_REQUEST }, { status: 400 });
  }

  try {
    const saved = await recordDriverLocation(prisma, {
      orderId: String(orderId),
      actor: { id: session.user.id, role: session.user.role },
      location: {
        latitude: body.latitude,
        longitude: body.longitude,
        accuracy: body.accuracy,
      },
    });
    // `eta` is the time and distance left to the customer, when they pinned their delivery spot.
    return NextResponse.json({ data: saved }, { status: 201 });
  } catch (error) {
    return orderErrorResponse(error, "POST /api/delivery/orders/:id/location");
  }
}

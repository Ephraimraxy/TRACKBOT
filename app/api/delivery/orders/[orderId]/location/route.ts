import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { ERROR_MESSAGES } from "@/lib/constants/settings";
import { prisma } from "@/lib/utils/prisma";
import { recordDriverLocation, recordDriverLocations, type LocationInput } from "@/lib/services/trackingService";
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

  let body: LocationInput & { points?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: ERROR_MESSAGES.BAD_REQUEST }, { status: 400 });
  }

  const actor = { id: session.user.id, role: session.user.role };

  // A phone that was offline sends what it kept in one request: { points: [{ latitude, longitude, accuracy, capturedAt }, ...] }.
  if (body && Array.isArray(body.points)) {
    try {
      const batch = await recordDriverLocations(prisma, { orderId: String(orderId), actor, locations: body.points as LocationInput[] });
      return NextResponse.json(
        {
          data: {
            eta: batch.eta,
            results: batch.results.map((r) => (r.status === "rejected" ? { status: "rejected", code: r.error.code, message: r.error.message } : { status: r.status, id: r.id, backfilled: r.status === "saved" ? r.backfilled : false })),
          },
        },
        { status: 201 }
      );
    } catch (error) {
      return orderErrorResponse(error, "POST /api/delivery/orders/:id/location");
    }
  }

  try {
    const saved = await recordDriverLocation(prisma, {
      orderId: String(orderId),
      actor,
      location: {
        latitude: body.latitude,
        longitude: body.longitude,
        accuracy: body.accuracy,
        capturedAt: body.capturedAt,
      },
    });
    // `eta` is the time and distance left to the customer, when they pinned their delivery spot.
    return NextResponse.json({ data: saved }, { status: 201 });
  } catch (error) {
    return orderErrorResponse(error, "POST /api/delivery/orders/:id/location");
  }
}

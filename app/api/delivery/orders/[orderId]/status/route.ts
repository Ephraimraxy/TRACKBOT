import { NextRequest, NextResponse } from "next/server";
import { CommandeStatut } from "@prisma/client";

import { auth } from "@/lib/auth";
import { ERROR_MESSAGES } from "@/lib/constants/settings";
import { prisma } from "@/lib/utils/prisma";
import { driverChangeStatus } from "@/lib/services/deliveryService";
import { orderErrorResponse } from "@/lib/utils/orderErrorResponse";

// PATCH: a delivery person advances an order assigned to them
// (EXPEDIEE -> EN_LIVRAISON -> LIVREE). Anything else is refused.
export async function PATCH(
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

  let body: { statut?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: ERROR_MESSAGES.BAD_REQUEST }, { status: 400 });
  }
  const { statut, note } = body;
  if (
    typeof statut !== "string" ||
    !Object.values(CommandeStatut).includes(statut as CommandeStatut) ||
    (note !== undefined && (typeof note !== "string" || note.length > 255))
  ) {
    return NextResponse.json({ error: ERROR_MESSAGES.BAD_REQUEST }, { status: 400 });
  }

  try {
    const order = await driverChangeStatus(prisma, {
      orderId: String(orderId),
      to: statut as CommandeStatut,
      actor: { id: session.user.id, role: session.user.role },
      note: note as string | undefined,
    });
    return NextResponse.json(
      { message: "Delivery status updated", data: { id: order.id, statut: order.statut } },
      { status: 200 }
    );
  } catch (error) {
    return orderErrorResponse(error, "PATCH /api/delivery/orders/:id/status");
  }
}

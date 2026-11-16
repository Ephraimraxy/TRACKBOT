import { NextRequest, NextResponse } from "next/server";
import { CommandeStatut, UserRole } from "@prisma/client";

import { auth } from "@/lib/auth";
import { ERROR_MESSAGES } from "@/lib/constants/settings";
import { prisma } from "@/lib/utils/prisma";
import { changeOrderStatus } from "@/lib/services/orderService";
import { orderErrorResponse } from "@/lib/utils/orderErrorResponse";

// POST: the customer confirms that they received their order. This is what closes the delivery: the delivery
// person can say "delivered", but only the customer can say "received".
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 });
  }
  if (session.user.role !== UserRole.CLIENT) {
    return NextResponse.json({ error: ERROR_MESSAGES.FORBIDDEN }, { status: 403 });
  }

  const { orderId } = await params;
  try {
    const order = await changeOrderStatus(prisma, {
      orderId: String(orderId),
      to: CommandeStatut.RECUE,
      actor: { id: session.user.id, role: session.user.role },
      note: "Receipt confirmed by the customer",
    });
    return NextResponse.json({ data: order }, { status: 200 });
  } catch (error) {
    return orderErrorResponse(error, "POST /api/orders/:id/receive");
  }
}

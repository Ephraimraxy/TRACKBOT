import { auth } from "@/lib/auth";
import { ERROR_MESSAGES } from "@/lib/constants/settings";
import { formatOrderData } from "@/lib/helpers/orders";
import { prisma } from "@/lib/utils/prisma";
import { changeOrderStatus, OrderError } from "@/lib/services/orderService";
import { CommandeStatut } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 }
    );
  }
  // Phase 1: only the business admin changes status here. Delivery personnel
  // get their own assignment-checked endpoint in the delivery phase.
  if (session.user.role !== "ADMIN") {
    return NextResponse.json(
      { error: ERROR_MESSAGES.FORBIDDEN },
      { status: 403 }
    );
  }

  const { orderId } = await params;

  let body: { statut?: unknown; note?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: ERROR_MESSAGES.BAD_REQUEST },
      { status: 400 }
    );
  }
  const { statut, note } = body;

  if (
    typeof statut !== "string" ||
    !Object.values(CommandeStatut).includes(statut as CommandeStatut) ||
    (note !== undefined && (typeof note !== "string" || note.length > 255))
  ) {
    return NextResponse.json(
      { error: ERROR_MESSAGES.BAD_REQUEST },
      { status: 400 }
    );
  }

  try {
    const order = await changeOrderStatus(prisma, {
      orderId: String(orderId),
      to: statut as CommandeStatut,
      actor: { id: session.user.id, role: session.user.role },
      note: note as string | undefined,
    });

    return NextResponse.json(
      {
        message: "The order status was updated successfully",
        data: formatOrderData(order as Parameters<typeof formatOrderData>[0]),
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof OrderError) {
      const status =
        error.code === "ORDER_NOT_FOUND"
          ? 404
          : error.code === "FORBIDDEN"
            ? 403
            : 409;
      return NextResponse.json({ error: error.message }, { status });
    }
    console.error("Error updating order status:", error);
    return NextResponse.json(
      { error: ERROR_MESSAGES.INTERNAL_ERROR },
      { status: 500 }
    );
  }
}

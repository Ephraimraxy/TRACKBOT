import { auth } from "@/lib/auth";
import { ERROR_MESSAGES } from "@/lib/constants/settings";
import { prisma } from "@/lib/utils/prisma";
import { getOrderHistory, OrderError } from "@/lib/services/orderService";
import { STATUS_LABELS_EN, STATUS_LABELS_FR } from "@/lib/orders/workflow";
import { NextRequest, NextResponse } from "next/server";

// GET the status timeline of an order (admin, or the customer who owns it).
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const session = await auth();
  if (!session) {
    return NextResponse.json(
      { error: ERROR_MESSAGES.UNAUTHORIZED },
      { status: 401 }
    );
  }

  const { orderId } = await params;

  try {
    const result = await getOrderHistory(prisma, String(orderId), {
      id: session.user.id,
      role: session.user.role,
    });

    return NextResponse.json(
      {
        data: {
          orderId: result.orderId,
          currentStatus: result.currentStatus,
          currentStatusLabel: STATUS_LABELS_EN[result.currentStatus],
          history: result.history.map((h) => ({
            id: h.id,
            from: h.ancienStatut,
            to: h.nouveauStatut,
            label: STATUS_LABELS_EN[h.nouveauStatut],
            labelFr: STATUS_LABELS_FR[h.nouveauStatut],
            note: h.note,
            date: h.date,
          })),
        },
      },
      { status: 200 }
    );
  } catch (error) {
    if (error instanceof OrderError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.code === "ORDER_NOT_FOUND" ? 404 : 403 }
      );
    }
    console.error("API Error [GET order history]:", error);
    return NextResponse.json(
      { error: ERROR_MESSAGES.INTERNAL_ERROR },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { ERROR_MESSAGES } from "@/lib/constants/settings";
import { prisma } from "@/lib/utils/prisma";
import { DriverError, removeDriver } from "@/lib/services/deliveryService";
import { orderErrorResponse } from "@/lib/utils/orderErrorResponse";

// DELETE: the admin removes someone from the delivery team (their past deliveries are kept).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ driverId: string }> }) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 });
  }

  try {
    const { driverId } = await params;
    const result = await removeDriver(prisma, { id: session.user.id, role: session.user.role }, driverId);
    return NextResponse.json({ message: "Removed from the delivery team", data: result }, { status: 200 });
  } catch (error) {
    if (error instanceof DriverError) {
      const status = error.code === "DRIVER_NOT_FOUND" ? 404 : 409;
      return NextResponse.json({ error: error.message }, { status });
    }
    return orderErrorResponse(error, "DELETE /api/drivers/[driverId]");
  }
}

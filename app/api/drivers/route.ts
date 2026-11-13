import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { ERROR_MESSAGES } from "@/lib/constants/settings";
import { prisma } from "@/lib/utils/prisma";
import { createDriver, DriverError, listDrivers } from "@/lib/services/deliveryService";
import { createDriverSchema } from "@/lib/validations/driver";
import { formatValidationErrors } from "@/lib/validations";
import { orderErrorResponse } from "@/lib/utils/orderErrorResponse";

// GET: delivery staff the admin can assign orders to.
export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 });
  }

  try {
    const data = await listDrivers(prisma, {
      id: session.user.id,
      role: session.user.role,
    });
    return NextResponse.json({ data }, { status: 200 });
  } catch (error) {
    return orderErrorResponse(error, "GET /api/drivers");
  }
}

// POST: the admin registers a delivery person.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 });
  }

  const parsed = createDriverSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return formatValidationErrors(parsed);

  try {
    const driver = await createDriver(
      prisma,
      { id: session.user.id, role: session.user.role },
      parsed.data,
      (plain) => bcrypt.hash(plain, 10)
    );
    return NextResponse.json({ message: "Delivery person registered", data: driver }, { status: 201 });
  } catch (error) {
    if (error instanceof DriverError && error.code === "EMAIL_TAKEN") {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return orderErrorResponse(error, "POST /api/drivers");
  }
}

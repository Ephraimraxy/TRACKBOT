import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { ERROR_MESSAGES } from "@/lib/constants/settings";
import { prisma } from "@/lib/utils/prisma";
import { resolvePaymentIssue } from "@/lib/services/paymentService";
import { orderErrorResponse } from "@/lib/utils/orderErrorResponse";

const body = z.object({ note: z.string().trim().max(500).optional() });

// PATCH (owner only): mark a payment issue as dealt with, with an optional note.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: ERROR_MESSAGES.BAD_REQUEST }, { status: 400 });
  const { id } = await params;
  try {
    const data = await resolvePaymentIssue(prisma, { actor: { id: session.user.id, role: session.user.role }, id: String(id), note: parsed.data.note });
    return NextResponse.json({ data });
  } catch (error) {
    return orderErrorResponse(error, "PATCH /api/admin/payment-issues/:id");
  }
}

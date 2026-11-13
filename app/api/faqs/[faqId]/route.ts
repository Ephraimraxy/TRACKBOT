import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { ERROR_MESSAGES } from "@/lib/constants/settings";
import { prisma } from "@/lib/utils/prisma";
import { deleteFaq, updateFaq } from "@/lib/services/faqService";
import { faqErrorResponse } from "@/lib/utils/faqErrorResponse";

type Ctx = { params: Promise<{ faqId: string }> };

// PATCH: edit an entry or switch it on/off.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 });
  }
  const { faqId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: ERROR_MESSAGES.BAD_REQUEST }, { status: 400 });
  }

  try {
    const data = await updateFaq(prisma, { id: session.user.id, role: session.user.role }, String(faqId), body);
    return NextResponse.json({ data }, { status: 200 });
  } catch (error) {
    return faqErrorResponse(error, "PATCH /api/faqs/:id");
  }
}

// DELETE: remove an entry.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 });
  }
  const { faqId } = await params;

  try {
    await deleteFaq(prisma, { id: session.user.id, role: session.user.role }, String(faqId));
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return faqErrorResponse(error, "DELETE /api/faqs/:id");
  }
}

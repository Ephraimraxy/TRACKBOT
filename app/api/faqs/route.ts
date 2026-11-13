import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { ERROR_MESSAGES } from "@/lib/constants/settings";
import { prisma } from "@/lib/utils/prisma";
import { createFaq, listFaqs } from "@/lib/services/faqService";
import { faqErrorResponse } from "@/lib/utils/faqErrorResponse";

// GET: the shop owner lists all FAQ entries (active and inactive).
export async function GET() {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 });
  }
  try {
    const data = await listFaqs(prisma, { id: session.user.id, role: session.user.role });
    return NextResponse.json({ data }, { status: 200 });
  } catch (error) {
    return faqErrorResponse(error, "GET /api/faqs");
  }
}

// POST: the shop owner adds an FAQ entry.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: ERROR_MESSAGES.BAD_REQUEST }, { status: 400 });
  }

  try {
    const data = await createFaq(prisma, { id: session.user.id, role: session.user.role }, body);
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return faqErrorResponse(error, "POST /api/faqs");
  }
}

import { NextRequest, NextResponse } from "next/server";
import { NotificationType } from "@prisma/client";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/utils/prisma";
import { ERROR_MESSAGES } from "@/lib/constants/settings";
import { formatValidationErrors } from "@/lib/validations";
import { deliveryUpdatesSchema } from "@/lib/validations/deliveryUpdates";
import { createRateLimiter } from "@/lib/utils/rateLimit";

const allowTest = createRateLimiter({ limit: 5, windowMs: 60_000 });

type Own = { ok: true; userId: string } | { ok: false; response: NextResponse };

/** Only the person themselves may read or change their own settings. */
async function ownSession(params: Promise<{ userId: string }>): Promise<Own> {
  const { userId } = await params;
  const session = await auth();
  if (!session) return { ok: false, response: NextResponse.json({ error: ERROR_MESSAGES.UNAUTHORIZED }, { status: 401 }) };
  if (session.user.id !== userId) return { ok: false, response: NextResponse.json({ error: ERROR_MESSAGES.FORBIDDEN }, { status: 403 }) };
  return { ok: true, userId };
}

// GET: this person's reminder settings.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const who = await ownSession(params);
  if (!who.ok) return who.response;

  const user = await prisma.user.findUnique({ where: { id: who.userId }, select: { rappelLivraisonMinutes: true, alerteProche: true } });
  if (!user) return NextResponse.json({ error: ERROR_MESSAGES.NOT_FOUND }, { status: 404 });
  return NextResponse.json({ data: user }, { status: 200, headers: { "Cache-Control": "no-store" } });
}

// PATCH: change how often to be reminded, and whether to get the "almost here" alert.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const who = await ownSession(params);
  if (!who.ok) return who.response;

  const parsed = deliveryUpdatesSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return formatValidationErrors(parsed);

  const user = await prisma.user.update({
    where: { id: who.userId },
    data: parsed.data,
    select: { rappelLivraisonMinutes: true, alerteProche: true },
  });
  return NextResponse.json({ message: "Delivery updates saved", data: user }, { status: 200 });
}

// POST: send this person a test notification, so they can see real-time alerts working.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const who = await ownSession(params);
  if (!who.ok) return who.response;
  if (!allowTest(who.userId)) return NextResponse.json({ error: "Too many tests. Try again in a minute." }, { status: 429 });

  const note = await prisma.notification.create({
    data: {
      userId: who.userId,
      type: NotificationType.LIVRAISON,
      objet: "Test notification",
      text: "This is how your delivery updates will look. If you can see this straight away, real-time alerts are working.",
      urlRedirection: "/client/notifications",
    },
    select: { id: true },
  });
  return NextResponse.json({ message: "Test notification sent", data: note }, { status: 201 });
}

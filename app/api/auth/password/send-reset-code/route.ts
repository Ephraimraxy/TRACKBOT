import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/utils/prisma";
import { sendPasswordResetEmail } from "@/lib/helpers/emailService";
import { createRateLimiter } from "@/lib/utils/rateLimit";
import {
  generateTOTPCode,
  generateTOTPSecret,
  TOTP_EXPIRATION_DURATION,
} from "@/lib/utils/totp";
import { ERROR_MESSAGES } from "@/lib/constants/settings";

const bodySchema = z.object({ email: z.string().trim().email().max(255) });

// At most 3 code requests per 10 minutes, per visitor and per email address.
// (In-memory: one server instance. See lib/utils/rateLimit.ts for the limits of that.)
const allow = createRateLimiter({ limit: 3, windowMs: 10 * 60_000 });

// The answer is identical whether or not an account exists, so this endpoint cannot be used
// to find out which email addresses are registered.
const GENERIC = "If an account exists for that email address, a reset code has been sent.";

export async function POST(req: Request) {
  let parsed;
  try {
    parsed = bodySchema.safeParse(await req.json());
  } catch {
    return NextResponse.json({ error: ERROR_MESSAGES.BAD_REQUEST }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }
  const email = parsed.data.email.toLowerCase();

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
  if (!allow(`ip:${ip}`) || !allow(`mail:${email}`)) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a few minutes and try again." },
      { status: 429 }
    );
  }

  try {
    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true, email: true },
    });

    if (user) {
      const secret = generateTOTPSecret();
      const code = generateTOTPCode(secret);
      const expiresLe = new Date(Date.now() + TOTP_EXPIRATION_DURATION * 1000);
      await prisma.tOTPSecret.upsert({
        where: { userId: user.id },
        update: { secret, expiresLe },
        create: { userId: user.id, secret, expiresLe },
      });
      try {
        await sendPasswordResetEmail(user.email, code);
      } catch (error) {
        // Logged for the operator; the visitor still gets the generic answer.
        console.error("Password reset email could not be sent:", (error as Error).message);
      }
    }

    return NextResponse.json({ message: GENERIC }, { status: 200 });
  } catch (error) {
    console.error("API Error [send-reset-code]:", error);
    return NextResponse.json({ error: ERROR_MESSAGES.INTERNAL_ERROR }, { status: 500 });
  }
}

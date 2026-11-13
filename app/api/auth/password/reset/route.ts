import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/utils/prisma";
import { createRateLimiter } from "@/lib/utils/rateLimit";
import { verifyTOTPCode } from "@/lib/utils/totp";
import { resetPasswordSchema } from "@/lib/validations";
import { ERROR_MESSAGES } from "@/lib/constants/settings";

// A 6-digit code has only a million possibilities, so guessing must be stopped:
// at most 5 attempts per 15 minutes per email address. On the 6th the code is destroyed
// and a new one has to be requested.
const allowAttempt = createRateLimiter({ limit: 5, windowMs: 15 * 60_000 });

// One message for every kind of failure (unknown account, no code, expired, wrong code),
// so the answer reveals nothing about the account.
const INVALID_CODE = "The code is invalid or has expired. Request a new one.";

export async function POST(req: Request) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: ERROR_MESSAGES.BAD_REQUEST }, { status: 400 });
    }

    const parseResult = resetPasswordSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: "Some fields are missing or incorrect",
          data: parseResult.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        },
        { status: 400 }
      );
    }
    const { email, code, newPassword } = parseResult.data;

    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true, TOTPSecret: { select: { secret: true, expiresLe: true } } },
    });

    if (!allowAttempt(email)) {
      if (user) await prisma.tOTPSecret.deleteMany({ where: { userId: user.id } });
      return NextResponse.json(
        { error: "Too many attempts. Request a new code and try again." },
        { status: 429 }
      );
    }

    if (!user || !user.TOTPSecret) {
      return NextResponse.json({ error: INVALID_CODE }, { status: 400 });
    }
    if (user.TOTPSecret.expiresLe < new Date()) {
      await prisma.tOTPSecret.deleteMany({ where: { userId: user.id } });
      return NextResponse.json({ error: INVALID_CODE }, { status: 400 });
    }
    if (!verifyTOTPCode(code, user.TOTPSecret.secret)) {
      return NextResponse.json({ error: INVALID_CODE }, { status: 400 });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { password: hashedPassword } }),
      prisma.tOTPSecret.delete({ where: { userId: user.id } }), // a code works only once
    ]);

    return NextResponse.json({ message: "Password reset successfully" }, { status: 200 });
  } catch (error) {
    console.error("API Error [reset password]:", error);
    return NextResponse.json({ error: ERROR_MESSAGES.INTERNAL_ERROR }, { status: 500 });
  }
}

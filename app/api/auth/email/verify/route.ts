import { NextResponse } from "next/server";

import getAuth from "@/lib/auth/getAuth";
import { prisma } from "@/lib/utils/prisma";
import { verifyTOTPCode } from "@/lib/utils/totp";
import { ERROR_MESSAGES } from "@/lib/constants/settings";
import { createRateLimiter } from "@/lib/utils/rateLimit";

// A 6-digit code has only a million possibilities: 5 guesses per 15 minutes per account,
// after which the code is destroyed and a new one must be requested.
const allowAttempt = createRateLimiter({ limit: 5, windowMs: 15 * 60_000 });

export async function POST(req: Request) {
  try {
    const { email, code } = await req.json();
    const session = await getAuth();

    // Ensure the user is authenticated and owns the email
    if (!session) {
      return NextResponse.json(
        { error: ERROR_MESSAGES.UNAUTHORIZED },
        { status: 401 }
      );
    }
    if (email !== session.user.email) {
      return NextResponse.json(
        {
          error: "The email address does not match the logged-in user",
        },
        { status: 403 }
      );
    }

    // Check if email is already verified
    if (session.user.emailVerifie) {
      return NextResponse.json(
        { message: "Email address already verified" },
        { status: 200 }
      );
    }

    if (!allowAttempt(session.user.id)) {
      await prisma.tOTPSecret.deleteMany({ where: { userId: session.user.id } });
      return NextResponse.json(
        { error: "Too many attempts. Request a new code and try again." },
        { status: 429 }
      );
    }

    // Fetch user with TOTP secret
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        emailVerifie: true,
        TOTPSecret: {
          select: {
            secret: true,
            expiresLe: true,
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: "User not found" },
        { status: 404 }
      );
    }

    if (user.emailVerifie) {
      return NextResponse.json(
        { message: "Email address already verified" },
        { status: 200 }
      );
    }

    if (!user.TOTPSecret) {
      return NextResponse.json(
        {
          error: "Verification was not initiated",
        },
        { status: 400 }
      );
    }

    // Check if TOTP code is expired
    if (user.TOTPSecret.expiresLe < new Date()) {
      return NextResponse.json(
        {
          error:
            "The verification code has expired. Please generate a new one.",
        },
        { status: 400 }
      );
    }

    // Validate the provided TOTP code
    const isValid = verifyTOTPCode(code, user.TOTPSecret.secret);
    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid verification code" },
        { status: 400 }
      );
    }

    // Mark email as verified and delete TOTP secret
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { emailVerifie: true },
      }),
      prisma.tOTPSecret.delete({
        where: { userId: user.id },
      }),
    ]);

    return NextResponse.json(
      { message: "Email address verified successfully" },
      { status: 200 }
    );
  } catch (error) {
    console.error("API Error : ", error);
    return NextResponse.json(
      { error: ERROR_MESSAGES.INTERNAL_ERROR },
      { status: 500 }
    );
  }
}

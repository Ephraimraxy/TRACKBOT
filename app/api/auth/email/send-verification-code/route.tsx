import { NextResponse } from "next/server";

import getAuth from "@/lib/auth/getAuth";
import { triggerEmailVerification } from "@/lib/helpers/emailService";
import { ERROR_MESSAGES } from "@/lib/constants/settings";
import { createRateLimiter } from "@/lib/utils/rateLimit";

// A code e-mail costs money and can be used to pester someone: 3 requests per 10 minutes per account.
const allowSend = createRateLimiter({ limit: 3, windowMs: 10 * 60_000 });

export async function POST(req: Request) {
  try {
    const { email } = await req.json();
    const session = await getAuth();

    // Check if user is authenticated
    if (!session) {
      return NextResponse.json(
        { error: ERROR_MESSAGES.UNAUTHORIZED },
        { status: 401 }
      );
    }

    // Checks if the email matches the logged-in user's email.
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

    if (!allowSend(session.user.id)) {
      return NextResponse.json(
        { error: "Too many requests. Please wait a few minutes and try again." },
        { status: 429 }
      );
    }

    // Generate and send verification code
    await triggerEmailVerification(session.user.id, email, false);

    return NextResponse.json({ message: "Code sent" }, { status: 200 });
  } catch (error) {
    console.error("API Error : ", error);
    return NextResponse.json(
      { error: ERROR_MESSAGES.INTERNAL_ERROR },
      { status: 500 }
    );
  }
}

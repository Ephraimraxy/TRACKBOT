import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/utils/prisma";
import { signIn } from "@/lib/auth";
import { ERROR_MESSAGES } from "@/lib/constants/settings";
import { loginSchema, formatValidationErrors } from "@/lib/validations";
import { createRateLimiter } from "@/lib/utils/rateLimit";

// 10 attempts a minute per address and email: enough for a person, too slow for guessing.
const allow = createRateLimiter({ limit: 10, windowMs: 60_000 });

const INCORRECT = { error: "Incorrect credentials" };

/**
 * Two sign-in pages share this route:
 *  - /auth/login is open to everyone: the administrator's own credentials work here too, and the
 *    response simply says which role signed in so the page can open the right area;
 *  - /admin is the owner's optional shortcut ({ portal: "admin" }) and only accepts an administrator
 *    account, so a customer's password is never accepted there.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const portal = body?.portal === "admin" ? "admin" : "customer";

    // Validate input data
    const parseResult = loginSchema.safeParse(body);
    if (!parseResult.success) {
      return formatValidationErrors(parseResult);
    }
    const { email, password } = parseResult.data;

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
    if (!allow(`${ip}:${email}`)) {
      return NextResponse.json({ error: "Too many attempts. Try again in a minute." }, { status: 429 });
    }

    // Find user in DB
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return NextResponse.json(INCORRECT, { status: 400 });

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return NextResponse.json(INCORRECT, { status: 400 });

    const isAdmin = user.role === "ADMIN";
    if (portal === "admin" && !isAdmin) return NextResponse.json(INCORRECT, { status: 400 });

    // Sign in user (create session)
    await signIn("credentials", { email, password, redirect: false });

    return NextResponse.json({ message: "Login successful", role: user.role }, { status: 200 });
  } catch (error) {
    console.error("API Error : ", error);
    return NextResponse.json(
      { error: ERROR_MESSAGES.INTERNAL_ERROR },
      { status: 500 }
    );
  }
}

import bcrypt from "bcryptjs";
import type { User } from "next-auth";

import { prisma } from "@/lib/utils/prisma";
import { createRateLimiter } from "@/lib/utils/rateLimit";

// NextAuth also exposes /api/auth/callback/credentials, which a script can call directly and so
// skip the throttle on /api/auth/login. The same brake is therefore applied here, per email address.
const allowSignIn = createRateLimiter({ limit: 10, windowMs: 60_000 });

/**
 * Checks an email and password. Every failure (bad input, throttled, no such account, wrong password)
 * gives the same answer, `null`, so the response never reveals which email addresses are registered.
 */
export async function authorizeCredentials(
  credentials: Partial<Record<"email" | "password", unknown>> | undefined
): Promise<User | null> {
  const email = String(credentials?.email ?? "").trim().toLowerCase();
  const password = String(credentials?.password ?? "");
  if (!email || !password || !allowSignIn(email)) return null;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return null;
  if (!(await bcrypt.compare(password, user.password))) return null;

  return {
    id: user.id,
    email: user.email,
    nom: user.nom,
    prenom: user.prenom,
    role: user.role,
    emailVerifie: user.emailVerifie,
    imagePublicId: user.imagePublicId,
  };
}

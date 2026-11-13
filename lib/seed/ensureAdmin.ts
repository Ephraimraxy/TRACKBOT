import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PrismaClient, UserRole } from "@prisma/client";

import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/constants/password";

type Env = Record<string, string | undefined>;

export type EnsureAdminResult = "created" | "updated" | "skipped";

/**
 * Make sure the shop owner's administrator account exists, using the Railway variables.
 *
 *   ADMIN_EMAIL        a valid email address (required)
 *   ADMIN_PASSWORD     the administrator's password, 6 to 72 characters. When it is set, it IS the
 *                      password for the /admin sign-in: it is applied the first time and re-applied on
 *                      every start-up if it differs, so changing the variable changes the password.
 *   ADMIN_FIRST_NAME / ADMIN_LAST_NAME   optional
 *
 * Without ADMIN_PASSWORD the account is created with a random password nobody knows, and the owner
 * sets their own through "Forgot password" (a code is emailed to ADMIN_EMAIL). That path remains
 * available as a fallback, but while ADMIN_PASSWORD is set, the next start-up puts the variable's
 * value back, so remove the variable if you prefer to manage the password by email only.
 *
 * Idempotent: running it again never creates a duplicate account.
 */
export async function ensureAdmin(
  db: PrismaClient,
  env: Env = process.env,
  opts: { optional?: boolean } = {}
): Promise<EnsureAdminResult> {
  const rawEmail = env.ADMIN_EMAIL?.trim();
  let password = env.ADMIN_PASSWORD || undefined;

  if (opts.optional && !rawEmail) return "skipped";

  const email = rawEmail?.toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("ADMIN_EMAIL is missing or not a valid email.");

  if (password !== undefined && (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX)) {
    const problem = `ADMIN_PASSWORD must be ${PASSWORD_MIN} to ${PASSWORD_MAX} characters (or leave it unset).`;
    // A bad value must never stop the start-up bootstrap: ignore it and keep the account reachable
    // through the emailed reset code. A manual run (not optional) is an explicit action, so it fails loudly.
    if (!opts.optional) throw new Error(problem);
    console.warn(`Admin bootstrap: ${problem} It was ignored.`);
    password = undefined;
  }

  const existing = await db.user.findUnique({ where: { email }, select: { id: true, password: true } });

  let userId: string;
  if (!existing) {
    const initial = password ?? randomBytes(32).toString("base64url");
    const user = await db.user.create({
      data: {
        email,
        password: await bcrypt.hash(initial, 12),
        nom: env.ADMIN_LAST_NAME?.trim() || "Owner",
        prenom: env.ADMIN_FIRST_NAME?.trim() || "Shop",
        role: UserRole.ADMIN,
        emailVerifie: true,
      },
      select: { id: true },
    });
    userId = user.id;
  } else {
    userId = existing.id;
    // The variable is the source of truth: only write a new hash when it actually differs.
    const passwordChanged = password !== undefined && !(await bcrypt.compare(password, existing.password));
    await db.user.update({
      where: { id: userId },
      data: {
        role: UserRole.ADMIN,
        emailVerifie: true,
        ...(passwordChanged && password ? { password: await bcrypt.hash(password, 12) } : {}),
      },
    });
  }
  await db.admin.upsert({ where: { userId }, update: {}, create: { userId } });

  return existing ? "updated" : "created";
}

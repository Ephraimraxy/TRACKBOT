/**
 * Creates (or updates) the first administrator account from environment variables, so no account
 * with a well-known password ever exists on a public site.
 *
 *   npm run seed:admin        run once by hand; fails loudly on bad values
 *   --if-configured           used by `npm start`: does nothing when ADMIN_EMAIL / ADMIN_PASSWORD are
 *                             not set, and never stops the server from starting if they are invalid
 *
 * See lib/seed/ensureAdmin.ts for the rules.
 */
import { PrismaClient } from "@prisma/client";

import { ensureAdmin } from "@/lib/seed/ensureAdmin";

const prisma = new PrismaClient();
const optional = process.argv.includes("--if-configured");

async function main() {
  const result = await ensureAdmin(prisma, process.env, { optional });
  if (result === "skipped") console.log("Admin bootstrap skipped (ADMIN_EMAIL / ADMIN_PASSWORD not set).");
  else console.log(`Administrator ${result}: ${process.env.ADMIN_EMAIL?.trim().toLowerCase()}`);
}

main()
  .catch((e) => {
    console.error(`Admin bootstrap: ${e.message}`);
    // Started by `npm start`: a bad value must not take the whole site down.
    process.exit(optional ? 0 : 1);
  })
  .finally(() => prisma.$disconnect());

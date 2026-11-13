import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

/**
 * Creates the dedicated test database if needed and applies every migration.
 * Safe to run repeatedly. Never touches the development database.
 */
export default async function setup() {
  const testUrl =
    process.env.TEST_DATABASE_URL ??
    "postgresql://dev:devpass@127.0.0.1:54329/megashop_test";

  const url = new URL(testUrl);
  const dbName = url.pathname.slice(1);
  if (!/^[a-z0-9_]*test[a-z0-9_]*$/i.test(dbName)) {
    throw new Error(
      `Refusing to run tests: database name "${dbName}" does not contain "test".`
    );
  }

  const adminUrl = new URL(testUrl);
  adminUrl.pathname = "/postgres";

  const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
  try {
    const rows = await admin.$queryRawUnsafe<{ datname: string }[]>(
      `SELECT datname FROM pg_database WHERE datname = '${dbName}'`
    );
    if (rows.length === 0) {
      await admin.$executeRawUnsafe(
        `CREATE DATABASE "${dbName}" ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`
      );
    }
  } finally {
    await admin.$disconnect();
  }

  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: testUrl, DATABASE_DIRECT_URL: testUrl },
  });
}

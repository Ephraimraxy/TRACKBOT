import path from "node:path";
import { defineConfig } from "vitest/config";

// Integration tests run against a dedicated test database (never the dev one).
// Set TEST_DATABASE_URL, or the default local test database is used.
const testDb =
  process.env.TEST_DATABASE_URL ??
  "postgresql://dev:devpass@127.0.0.1:54329/megashop_test";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/setup/globalSetup.ts"],
    env: {
      DATABASE_URL: testDb,
      DATABASE_DIRECT_URL: testDb,
      AUTH_SECRET: "test-secret",
    },
    // Tests share one database, so run files one at a time.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Integration tests run against an isolated SQLite DB (created in globalSetup).
    // loadEnvFile() in src/lib/env.ts does not override an already-set var.
    env: { DATABASE_URL: "file:./test-integration.db" },
    globalSetup: ["tests/integration/globalSetup.ts"],
    // Single DB file is shared, so keep test files from racing each other.
    fileParallelism: false,
  },
});

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Integration tests run against an isolated SQLite DB (created in globalSetup).
    // loadEnvFile() in src/lib/env.ts does not override an already-set var.
    env: {
      DATABASE_URL: "file:./test-integration.db",
      // Registration/Stripe config. These are fake but must be *shaped* right:
      // webhook signature verification is pure local crypto, so the suite signs
      // its own events with this secret and exercises the real verification path
      // without a Stripe account or a network call. The API calls that would go
      // over the wire (session create, refund) are mocked per test file.
      STRIPE_SECRET_KEY: "sk_test_dummy_for_tests",
      STRIPE_WEBHOOK_SECRET: "whsec_dummy_for_tests",
      PUBLIC_BASE_URL: "https://test.fcfrick.test",
    },
    globalSetup: ["tests/integration/globalSetup.ts"],
    // Single DB file is shared, so keep test files from racing each other.
    fileParallelism: false,
  },
});

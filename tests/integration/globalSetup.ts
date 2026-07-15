import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * One-time integration DB setup: create a fresh SQLite database from the Prisma
 * migrations, isolated from the dev database. The same DATABASE_URL is injected
 * into the test workers via `test.env` in vitest.config.ts.
 */
const TEST_DB_URL = "file:./test-integration.db";
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dbFile = resolve(projectRoot, "prisma", "test-integration.db");

export async function setup(): Promise<void> {
  if (existsSync(dbFile)) rmSync(dbFile);
  execSync("npx prisma migrate deploy", {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: TEST_DB_URL },
    stdio: "ignore",
  });
}

export async function teardown(): Promise<void> {
  if (existsSync(dbFile)) rmSync(dbFile);
}

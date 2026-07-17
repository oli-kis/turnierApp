import { buildApp } from "./app.js";
import { env } from "./lib/env.js";
import { prisma } from "./db/client.js";
import { ensureAdmin } from "./services/adminSeed.js";

async function main(): Promise<void> {
  const app = await buildApp();

  // A hosted instance may have no shell to run `npm run seed:admin` in, so boot
  // is the only chance to create the account. Logged rather than thrown: a seed
  // that fails (a cold database refusing the first connection) must not take the
  // public schedule down with it, and the next restart tries again.
  try {
    const admin = await ensureAdmin();
    if (admin) app.log.info(`Admin account ready: ${admin.email}`);
    else app.log.warn("ADMIN_EMAIL / ADMIN_PASSWORD unset — no admin account seeded");
  } catch (err) {
    app.log.error({ err }, "Admin seed failed — nobody may be able to log in as admin");
  }

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down`);
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();

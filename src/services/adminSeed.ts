import bcrypt from "bcryptjs";
import { env } from "../lib/env.js";
import { prisma } from "../db/client.js";

/**
 * Create or update the single admin account from `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
 *
 * Runs from `npm run seed:admin` *and* on server boot, because a free Render
 * instance has no shell: if boot does not do this, there is no way to create the
 * account and nobody can log in to the deployment at all.
 *
 * An upsert rather than a create, so booting twice is not an error — and so
 * changing `ADMIN_PASSWORD` and redeploying is the recovery path for a lost
 * admin password, which is otherwise unrecoverable without DB access.
 *
 * Returns null when the vars are unset (dev machines, the test suite) — that is
 * a deployment without an admin, not a broken one.
 */
export async function ensureAdmin(): Promise<{ email: string } | null> {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) return null;

  const passwordHash = await bcrypt.hash(env.ADMIN_PASSWORD, 10);
  const admin = await prisma.user.upsert({
    where: { email: env.ADMIN_EMAIL },
    update: { passwordHash, name: env.ADMIN_NAME, role: "ADMIN", status: "APPROVED" },
    create: {
      email: env.ADMIN_EMAIL,
      name: env.ADMIN_NAME,
      passwordHash,
      role: "ADMIN",
      status: "APPROVED",
    },
  });
  return { email: admin.email };
}

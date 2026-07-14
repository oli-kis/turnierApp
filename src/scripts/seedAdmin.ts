import bcrypt from "bcryptjs";
import { env } from "../lib/env.js";
import { prisma } from "../db/client.js";

/** Create (or update) the single admin account from env vars. */
async function main(): Promise<void> {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must be set");
  }
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
  console.log(`Admin ready: ${admin.email}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });

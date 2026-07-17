import { prisma } from "../db/client.js";
import { ensureAdmin } from "../services/adminSeed.js";

/** Create (or update) the single admin account from env vars. */
async function main(): Promise<void> {
  const admin = await ensureAdmin();
  if (!admin) throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must be set");
  console.log(`Admin ready: ${admin.email}`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });

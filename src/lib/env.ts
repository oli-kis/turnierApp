import { z } from "zod";

// Load .env into process.env if present (Node >= 20.12). Harmless if absent.
try {
  process.loadEnvFile();
} catch {
  // no .env file — rely on the ambient environment
}

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(1).optional(),
  ADMIN_NAME: z.string().min(1).default("Tournament Admin"),
  // Web Push (referee notifications). All three or none: without a keypair the
  // feature reports itself unavailable and sends are skipped, so a dev machine
  // or a club that never wants push needs no configuration at all.
  // `npm run push:keys` prints a fresh pair.
  VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  VAPID_SUBJECT: z.string().min(1).default("mailto:admin@fcfrick.ch"),
});

export const env = schema.parse(process.env);

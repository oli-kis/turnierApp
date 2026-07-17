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
  // Team self-service registration. Optional for the same reason as push: with
  // no Stripe credentials the feature reports itself unconfigured rather than
  // crashing a server that never intended to take money. PUBLIC_BASE_URL is
  // where Stripe sends the payer back to — it must be the *browser's* origin,
  // not the API's.
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  PUBLIC_BASE_URL: z.string().url().optional(),
  // Browser origins allowed to call this API, comma-separated. Optional for a
  // reason that is easy to misread as an oversight: in dev and in `preview` the
  // frontend reaches us through Vite's `/api` proxy, so every request is
  // same-origin and CORS never enters the picture. It is only a deployed
  // frontend on its own domain that needs this — so unset means "nobody calls me
  // cross-origin", not "everybody may".
  //
  // Stripe's webhook is server-to-server and sends no Origin, so it is unaffected
  // by whatever is set here.
  CORS_ORIGIN: z.string().min(1).optional(),
  // Confirmation email. Absent → the mailer logs instead of sending; a missing
  // receipt must never fail a payment that already went through.
  RESEND_API_KEY: z.string().min(1).optional(),
  MAIL_FROM: z.string().min(1).default("FC Frick Turnier <onboarding@resend.dev>"),
});

export const env = schema.parse(process.env);

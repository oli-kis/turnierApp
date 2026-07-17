# deployment.md — Free prototype hosting (Vercel + Render + Neon)

Goal: a publicly reachable prototype the client can test. Not production — see the caveats at the end before the real tournament day.

## Architecture

| Piece | Service | Free-tier reality |
|---|---|---|
| Frontend (Vite SPA) | **Vercel** Hobby | Static hosting, HTTPS, auto-deploy on push. No relevant limits for this app. |
| Backend (Fastify) | **Render** Free Web Service | Spins down after 15 min idle; first request then takes up to ~1 min. 750 free instance hours/month — one service running 24/7 fits. |
| Database | **Neon** Free (Postgres) | Does **not** expire. Render's own free Postgres is hard-deleted after 30 days — do not use it for this. |
| Payments | **Stripe test mode** | Fake money, real flow incl. TWINT. No business verification needed for test mode. |
| Email | **Resend** free / console fallback | Without a verified domain, Resend only delivers to your own account email — fine for a prototype. |

Prerequisite: both repos on GitHub. Accounts (all free, no credit card): vercel.com, render.com, neon.tech, dashboard.stripe.com, resend.com.

---

## 1. Database — Neon

1. neon.tech → New Project → region **Frankfurt (eu-central-1)** (closest to CH), Postgres 17.
2. From the connection widget copy **two** connection strings: the **pooled** one (contains `-pooler`) and the **direct** one.
3. In the backend, Prisma needs both — pooled for the app, direct for migrations:
   ```prisma
   datasource db {
     provider  = "postgresql"
     url       = env("DATABASE_URL")    // pooled
     directUrl = env("DIRECT_URL")      // direct, used by prisma migrate
   }
   ```
   Commit this change.

## 2. Backend code prep — done

The three things Render's free tier forces are all in place; this section is kept
as a record of *why* they exist, not as a to-do list.

1. **Port binding:** Render injects `PORT`; `server.ts` listens on `0.0.0.0:env.PORT`.
2. **Admin seed on boot:** free instances have **no shell**, so `npm run seed:admin` can never be run by hand — meaning without this there is no way to log in at all. `server.ts` calls `ensureAdmin()` on startup. It is an upsert, so booting twice is fine, and **changing `ADMIN_PASSWORD` and redeploying is the recovery path for a lost admin password** (there is no reset flow). A failed seed is logged, not thrown: a cold database refusing the first connection must not take the public schedule down with it.
3. **CORS from env:** `CORS_ORIGIN` (comma-separated, no trailing slash) is read in `lib/env.ts` and registered in `app.ts`. Unset means "no cross-origin callers" — correct for local dev, where Vite's proxy makes everything same-origin. Stripe's webhook is server-to-server and sends no `Origin`, so it is unaffected.

`GET /health` exists (Render's health check and the keep-alive ping).

## 3. Backend — Render

1. render.com → New → **Web Service** → connect the backend repo. Region **Frankfurt**.
2. Settings:
   - Build command: `npm ci && npx prisma migrate deploy && npm run build`
   - Start command: `node dist/index.js` (adjust to your build output)
   - Instance type: **Free**
   - Health check path: `/health`
3. Environment variables:
   ```
   DATABASE_URL   = <neon pooled url>
   DIRECT_URL     = <neon direct url>
   JWT_SECRET     = <long random string>
   ADMIN_EMAIL    = <you>
   ADMIN_PASSWORD = <strong, this is a public URL>
   CORS_ORIGIN    = https://<your-app>.vercel.app     (add after step 4)
   PUBLIC_BASE_URL= https://<your-app>.vercel.app     (used in Stripe redirect URLs)
   STRIPE_SECRET_KEY     = sk_test_...                (step 5)
   STRIPE_WEBHOOK_SECRET = whsec_...                  (step 5)
   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT  (step 6)
   RESEND_API_KEY = ...                               (step 7, optional)
   ```
4. Deploy. Note the URL: `https://<service>.onrender.com`. Migrations run on every deploy via the build command — that's intended.

## 4. Frontend — Vercel

1. vercel.com → Add New Project → import the frontend repo. Framework preset **Vite** (build `npm run build`, output `dist` — auto-detected).
2. Environment variable: `VITE_API_ORIGIN = https://<service>.onrender.com` (all environments).

   **Not `VITE_API_URL`.** The two are different things, and mixing them up produces an app that builds fine and cannot reach its API. `VITE_API_URL` is the *dev/preview proxy target*, read by `vite.config.ts` and never bundled. `VITE_API_ORIGIN` is baked into the built JS and is what the shipped app actually calls. Vercel serves static files with no proxy behind them, so a build without it emits relative `/api/…` calls that hit Vercel, get caught by the SPA rewrite in step 3, and return the HTML shell to code expecting JSON.
3. SPA routing: add `vercel.json` to the repo root so deep links like `/t/abc/gruppe/xyz` don't 404:
   ```json
   { "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
   ```
   Vercel serves real files (assets, `sw.js`, `manifest.webmanifest`) before applying rewrites, so the PWA is unaffected.
4. Deploy → `https://<your-app>.vercel.app`. Now go back to Render and set `CORS_ORIGIN` and `PUBLIC_BASE_URL` to this URL (Render redeploys on env change).

Note: Vercel preview deployments get their own random URLs which won't pass CORS. `CORS_ORIGIN` takes a comma-separated list, so add a preview URL explicitly when you need one. There is no wildcard — an exact list is the whole point of the setting.

## 5. Stripe test mode

Everything below happens with the **Test mode** toggle ON — no real money, no verification.

1. Dashboard → Developers → API keys → copy the test `sk_test_...` into Render (`STRIPE_SECRET_KEY`).
2. Settings → Payment methods: enable **TWINT** and **Cards** (test mode toggles, no contract).
3. Developers → Webhooks → Add endpoint:
   - URL: `https://<service>.onrender.com/api/webhooks/stripe`
   - Events: `checkout.session.completed`, `checkout.session.expired`
   - Copy the signing secret `whsec_...` into Render (`STRIPE_WEBHOOK_SECRET`).
4. Test payments: card `4242 4242 4242 4242`, any future date/CVC. TWINT in test mode shows a fake approval screen — no app needed.
5. Cold-start pitfall: if the backend is asleep when Stripe delivers a webhook, the first attempt can time out. Stripe retries automatically, so registrations still complete — just possibly a minute late. The status page's polling covers this. The keep-alive ping (step 8) makes it a non-issue.

## 6. Web push (VAPID)

```bash
npx web-push generate-vapid-keys
```
Put the pair into Render (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`) plus `VAPID_SUBJECT=mailto:info@fcfrick.ch`. Push works on the Vercel HTTPS domain; the frontend already hides the UI where push isn't available.

## 7. Email (optional for the prototype)

Resend without a verified domain can only send **to your own account email** from `onboarding@resend.dev` — enough to demo the confirmation mail to yourself. For the client demo either accept that, or add a `MAIL_MODE=log` fallback that writes mails to the server log instead of failing. Verifying `fcfrick.ch` (DNS records) unlocks real delivery later and costs nothing.

## 8. Keep-alive (recommended)

The 1-minute cold start makes a terrible client demo. Create a free monitor at uptimerobot.com pinging `https://<service>.onrender.com/health` every 10 minutes. One always-on service ≈ 730 h/month, inside the 750 free hours. (Neon's compute also auto-suspends when idle; the same ping wakes the DB path too since /health should touch the DB — add a trivial `SELECT 1` to it.)

## 9. Verify

1. `https://<service>.onrender.com/health` → 200.
2. Open the Vercel URL → tournament picker loads (empty is fine). Check the browser console for CORS errors — if any, `CORS_ORIGIN` doesn't match exactly (scheme + host, no trailing slash).
3. Log in as admin, create a test tournament with 2 categories, open registration.
4. Register a team on your phone, pay with the test card → team appears; check Developers → Webhooks in Stripe for the delivered `checkout.session.completed`.
5. Open the tournament page in two browsers, score a test goal as referee → the other browser updates (SSE through Render works; the frontend's reconnect logic covers spin-down gaps).

Every `git push` to main now auto-deploys both sides.

## Before the real tournament day — not optional

The free tier is for the prototype phase only:

- **Render Starter ($7/mo, cancel monthly):** no spin-down, no cold starts. A referee waiting 60 s for the ready button while four pitches watch is not acceptable; upgrade for the event month at minimum.
- **Neon free** (0.5 GB) holds years of tournament data — can stay.
- **Stripe live mode** requires activating the account with the club's details and bank account (IBAN), enabling TWINT for live, creating a **second** webhook endpoint with the live signing secret, and swapping both keys in Render. Do a CHF 1 real test payment end-to-end before opening registration.
- Point a subdomain (e.g. `turnier.fcfrick.ch`) at Vercel via CNAME — free, and the URL your flyers print should not be `*.vercel.app`. Remember to update `CORS_ORIGIN`, `PUBLIC_BASE_URL`, and the Stripe redirect URLs when you do.

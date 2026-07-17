# feature-team-registration.md — Team self-service registration with payment

Teams register themselves for a planned tournament and pay the entry fee via Stripe Checkout (TWINT, cards, Apple/Google Pay). A team exists in the tournament **only after payment succeeded**. Applies to both repos — update both CLAUDE.md files (data model, endpoint tables, screens) as part of this feature.

Decisions already made — do not re-open:
- Payment: **Stripe Checkout**, hosted page, currency CHF. TWINT is single-use CHF-only, which fits (one-time fee, max 5000 CHF).
- Fee is defined **per tournament**, same for every category.
- **No capacity limit** per category — no sold-out or waitlist logic.
- Paid = registered. No admin approval step.
- Refunds are handled manually in the Stripe dashboard, not in the app (v1).

## Backend

### Data model

```prisma
model Tournament {
  // add:
  entryFeeRp           Int      @default(0)   // fee in Rappen (e.g. 10000 = CHF 100.00); registration requires > 0
  registrationOpen     Boolean  @default(false)
  registrationDeadline DateTime?              // optional; open = registrationOpen && (deadline == null || now < deadline)
}

model Registration {
  id              String   @id @default(cuid())
  tournamentId    String
  categoryId      String
  teamName        String
  contactName     String
  contactEmail    String
  contactPhone    String
  status          RegistrationStatus // PENDING_PAYMENT | PAID | EXPIRED | CANCELED
  amountRp        Int                // fee snapshot at creation — later fee changes don't affect open sessions
  stripeSessionId String   @unique
  teamId          String?  @unique   // set when the Team is created on payment success
  createdAt       DateTime @default(now())
  paidAt          DateTime?
  expiresAt       DateTime           // createdAt + 30 min, mirrors the Checkout Session expiry
}
```

`Team.groupId` is already nullable — paid registrations create a Team with `groupId: null` (the "unassigned pool" of the category). The admin assigns groups in setup via the existing `PATCH /teams/:id`.

### Flow

1. `POST /api/registrations` (public, rate-limited)
   Body: `{ tournamentId, categoryId, teamName, contactName, contactEmail, contactPhone }`. Zod: email format, phone non-empty, teamName 2–40 chars.
   Validations → `409` with code:
   - registration not open / deadline passed → `REGISTRATION_CLOSED`
   - `entryFeeRp <= 0` → `REGISTRATION_NOT_CONFIGURED`
   - team name already taken in this category, case-insensitive, among existing Teams + `PAID` + non-expired `PENDING_PAYMENT` registrations → `TEAM_NAME_TAKEN`
   Then: create Registration (`PENDING_PAYMENT`), create Stripe Checkout Session:
   ```
   mode: "payment", currency: "chf",
   line_items: [{ name: `Startgeld ${tournament.name} — ${category.name}`, amount: amountRp }],
   payment_method_types: ["twint", "card"],
   metadata: { registrationId },
   expires_at: now + 30 min,   // Stripe minimum is 30 min — matches our hold
   success_url: `${PUBLIC_BASE_URL}/t/:id/anmeldung/status?rid={registrationId}`,
   cancel_url:  `${PUBLIC_BASE_URL}/t/:id/anmelden`
   ```
   Response: `{ registrationId, checkoutUrl }` → frontend redirects.

2. `POST /api/webhooks/stripe` (no auth, Stripe signature verification)
   - **Must receive the raw request body** — register this route with the raw-body content-type parser, before/excluded from the global JSON parser, or signature verification will always fail.
   - `checkout.session.completed` → in one transaction: Registration → `PAID` + `paidAt`, create Team `{ categoryId, groupId: null, name: teamName }`, link `teamId`. Then: confirmation email, SSE `registration.paid` (id only).
   - `checkout.session.expired` → `EXPIRED`.
   - Idempotent: if the registration is already in the target state, ack with 200 and do nothing. Unknown events: 200, ignore. Never 500 on business-level noise — Stripe retries.
   - Race with a name collision (two pending registrations, same name, both pay): first `completed` wins; second one is marked `PAID` but team creation hits the unique check → auto-refund via Stripe API + status `CANCELED` + apologetic email. Rare, but must not crash the webhook.

3. `GET /api/registrations/:id/status` (public)
   Returns `{ status, teamName, categoryName }` — **no contact data** (the id is in a shareable URL). The success page polls this every 2 s (max 60 s) because the user's redirect can arrive before the webhook; show "Zahlung wird bestätigt…" until `PAID`.

4. Admin:
   - `GET /api/tournaments/:id/registrations?status=` — full list incl. contact data and payment state.
   - `POST /api/registrations/:id/cancel` — allowed for `PAID` registrations while the team is unassigned and unscheduled; deletes the Team, sets `CANCELED`. The actual refund happens manually in the Stripe dashboard — the UI must say so and link the session (`https://dashboard.stripe.com/payments/...`).
   - `PATCH /tournaments/:id` gains `entryFeeRp`, `registrationOpen`, `registrationDeadline`.

### Interaction with existing rules

- **Schedule generation** now additionally requires: `registrationOpen === false` (`409 REGISTRATION_STILL_OPEN`) and no team with `groupId: null` in any category of the tournament (`409 UNASSIGNED_TEAMS`, with team ids). Otherwise teams could register into an already-fixed schedule.
- Bracket-size validation (4/8/16) is untouched — it runs against groups, and group assignment is the admin's move.
- Tournament cascade delete (improvements item 7) includes Registrations — contact data does not outlive the tournament (Swiss DSG: collected for running the tournament, nothing else; state this in the Datenschutz page).

### Email

Confirmation on `PAID` via **Resend** (or nodemailer/SMTP if the club has a mailbox — decide by available credentials): team name, category, tournament date, amount, note that the schedule follows later on the website. Enable Stripe's own receipt email in the dashboard for the payment receipt — don't rebuild it.

### Env & local dev

```
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
PUBLIC_BASE_URL=https://...
RESEND_API_KEY=...
```
Local webhook testing: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`. Add a test covering the webhook idempotency and the name-collision refund path.

## Frontend

### Public registration flow (`/t/:id/anmelden`)

Mobile-first, three steps on one route, German UI:
1. **Kategorie wählen** — category cards; fee shown prominently once (`Startgeld: CHF 100.–`), since it's identical everywhere.
2. **Team & Kontakt** — teamName, contactName, email, phone. Inline validation; `TEAM_NAME_TAKEN` renders at the field ("Dieser Teamname ist in dieser Kategorie bereits vergeben").
3. **Bezahlen** — summary + "Weiter zur Zahlung" → redirect to `checkoutUrl`. Note under the button: "Zahlung per TWINT, Karte, Apple Pay oder Google Pay. Der Platz ist 30 Minuten reserviert."

`/t/:id/anmeldung/status?rid=` — polling state → success state ("**{Teamname}** ist angemeldet!", link to the team page) or failure state with a retry link back to the form. Handle the cancel_url return gracefully (form state preserved via sessionStorage).

Entry points: a visible "Team anmelden" button on the tournament home and tournament picker for every tournament where registration is open — this funds the club, don't hide it. Closed/deadline passed: show the state instead of hiding the button ("Anmeldung geschlossen").

### Admin

- Setup → Grunddaten: fee input (CHF, stored as Rappen), registration toggle, optional deadline.
- Setup → new section **Anmeldungen**: table (team, category, contact, status, paidAt), SSE badge on `registration.paid`, cancel action with the manual-refund notice.
- Setup → Gruppen: unassigned teams of each category shown as a pool next to the groups with a group-assign dropdown per team. The schedule-generate step surfaces the two new `409`s as actionable messages ("Anmeldung ist noch offen — zuerst schliessen", "n Teams sind noch keiner Gruppe zugeteilt").

## Out of scope (v2)

- Waitlists / capacity (explicitly excluded), in-app refunds, registration editing by the team, multi-team discount, reminder emails before the deadline.

# CLAUDE.md — FC Frick Tournament Backend

Backend for the FC Frick annual tournament weekend. Handles tournament setup, automatic match scheduling, group standings, knockout brackets, a referee ready/scoring system with synchronized match starts, and public read-only views.

## Tech Stack

- **Runtime:** Node.js 22, TypeScript (strict mode)
- **Framework:** Fastify
- **ORM / DB:** Prisma + PostgreSQL (SQLite acceptable for local dev via Prisma provider switch)
- **Validation:** Zod on every request body and query string
- **Auth:** JWT (`@fastify/jwt`), bcrypt for password hashing
- **Real-time:** Server-Sent Events (SSE). One-directional push is enough — referees and admin act via normal POST/PATCH, they only need to *receive* live state. No WebSocket dependency.
- **Tests:** Vitest. The scheduler, standings calculator, and bracket generator must have unit tests before anything else — they encode the tournament's fairness rules.

## Commands

```bash
npm run dev          # start dev server with reload
npm run build        # tsc build
npm test             # vitest
npx prisma migrate dev
npx prisma studio
npm run seed:admin   # create the admin account from ADMIN_EMAIL / ADMIN_PASSWORD env vars
npm run push:keys    # print a VAPID keypair for .env (see Push); optional
npm run push:test -- <referee-email>   # send a real test notification to their devices
```

Env: `DATABASE_URL`, `JWT_SECRET`, `PORT`, `ADMIN_*`. Two optional feature
blocks, each simply off when unset:
- Push: `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`.
- Registration: `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `PUBLIC_BASE_URL`
  (+ `RESEND_API_KEY` / `MAIL_FROM` once the mailer has a provider).

## Roles & Auth

| Role | How created | Can do |
|---|---|---|
| `ADMIN` | Seed script only, no registration endpoint | Everything |
| `REFEREE` | Self-registration, status `PENDING` until admin approves | Ready/score/finish only on matches assigned to them. **`PENDING` referees cannot log in at all** — login returns `403 REFEREE_PENDING` with a message to wait for approval |
| Public | No account | All `GET` endpoints marked public |

JWT payload: `{ userId, role }`. Access token TTL 12h (one tournament day), no refresh token needed for v1.

## Data Model (Prisma sketch)

```prisma
model User {
  id           String  @id @default(cuid())
  email        String  @unique
  passwordHash String
  name         String
  role         Role    // ADMIN | REFEREE
  status       UserStatus // APPROVED | PENDING | REJECTED  (admins always APPROVED)
  matches      Match[]
}

model Tournament {
  id                 String @id @default(cuid())
  name               String
  startAt            DateTime          // first slot start
  matchDurationMin   Int               // e.g. 12
  transitionMin      Int               // e.g. 3
  pitchCount         Int
  status             TournamentStatus  // DRAFT | SCHEDULED | RUNNING | FINISHED
  entryFeeRp           Int      @default(0)  // Rappen; registration needs > 0
  registrationOpen     Boolean  @default(false)
  registrationDeadline DateTime?
  categories         Category[]
  pitches            Pitch[]
  slots              Slot[]
  registrations      Registration[]
}

model Pitch {
  id           String @id @default(cuid())
  tournamentId String
  name         String    // "Platz 1"
  sortOrder    Int
}

model Category {
  id                    String @id @default(cuid())
  tournamentId          String
  name                  String   // "Junioren D", "Aktive", ...
  qualifiersPerGroup    Int      // teams advancing per group, set before knockout generation
  knockoutGenerated     Boolean @default(false)
  groups                Group[]
  teams                 Team[]
}

model Group {
  id         String @id @default(cuid())
  categoryId String
  name       String   // "Gruppe A"
  teams      Team[]
}

model Team {
  id         String @id @default(cuid())
  categoryId String
  groupId    String?   // null = the category's "unassigned pool" (paid, not placed)
  name       String
  @@unique([categoryId, name])  // see Registration: this is what settles the race
}

model Slot {
  id           String @id @default(cuid())
  tournamentId String
  index        Int        // 0-based, defines order of the day
  plannedStart DateTime   // startAt + index * (matchDurationMin + transitionMin)
  actualStart  DateTime?  // set when the slot fires
  status       SlotStatus // PENDING | WAITING_READY | RUNNING | FINISHED
  matches      Match[]
  @@unique([tournamentId, index])
}

model Match {
  id           String  @id @default(cuid())
  tournamentId String
  categoryId   String
  groupId      String?     // null for knockout
  slotId       String?     // null until scheduled
  pitchId      String?
  refereeId    String?
  phase        MatchPhase  // GROUP | ROUND_OF_16 | QUARTERFINAL | SEMIFINAL | THIRD_PLACE | FINAL
  status       MatchStatus // SCHEDULED | READY | RUNNING | FINISHED
  homeTeamId   String?     // null while knockout source unresolved
  awayTeamId   String?
  homeSource   Json?       // {type:"GROUP_RANK",groupId,rank} | {type:"MATCH_WINNER"|"MATCH_LOSER",matchId}
  awaySource   Json?
  scoreHome    Int @default(0)   // denormalized from Goal rows
  scoreAway    Int @default(0)
  pensHome     Int?        // knockout only, after a draw
  pensAway     Int?
  finishedAt   DateTime?
  goals        Goal[]
}

model Goal {
  id        String @id @default(cuid())
  matchId   String
  teamId    String
  clientId  String? @unique  // idempotency key minted by the referee's outbox
  createdAt DateTime @default(now())
  createdBy String   // referee userId, for audit
}

model Registration {              // team self-service entry (see Registration below)
  id              String @id @default(cuid())
  tournamentId    String
  categoryId      String
  teamName        String
  contactName     String
  contactEmail    String
  contactPhone    String
  status          RegistrationStatus // PENDING_PAYMENT | PAID | EXPIRED | CANCELED
  amountRp        Int                // fee snapshot at creation
  stripeSessionId String @unique
  teamId          String? @unique    // set when the Team is created on payment
  createdAt       DateTime @default(now())
  paidAt          DateTime?
  expiresAt       DateTime           // createdAt + 30 min, mirrors the Session
}

model PushSubscription {          // one row per referee device (see Push below)
  id        String @id @default(cuid())
  userId    String
  endpoint  String @unique        // the browser's own handle for the subscription
  p256dh    String
  auth      String
  createdAt DateTime @default(now())
}
```

## Core Business Rules

### 1. Group-stage scheduling (`POST /tournaments/:id/schedule/generate`)

Input already on the tournament: `startAt`, `matchDurationMin`, `transitionMin`, `pitchCount`, plus all categories/groups/teams.

Requirements:
- Round-robin inside each group: every team plays every other team once. Use the circle method. Group of n teams → n−1 rounds (n rounds with a bye if n is odd), each round has ⌊n/2⌋ matches with no team appearing twice.
- Pack rounds into global **slots**. A slot holds at most `pitchCount` matches. A team must never have two matches in the same slot (guaranteed if a group's round is never split across... it *can* be split across slots, but then enforce the constraint per team explicitly — prefer keeping a group-round inside one slot when ⌊n/2⌋ ≤ pitchCount).
- Rounds of the same group must be scheduled in round order.
- **Rest balancing objective:** minimize the variance of the gap (in slots) between consecutive matches of each team, across all teams. Perfect equality is usually impossible; document the achieved min/max rest in the generation response so the admin can judge it.

Suggested algorithm (good enough, exact optimum is NP-hard):
1. Build round units per group.
2. Fill slots greedily: for each slot, among groups whose next round is eligible, pick the ones whose teams have waited longest (maximize minimum rest), until pitch capacity is reached.
3. Local-search pass: try pairwise swaps of round units between slots; keep a swap if it lowers rest variance without violating constraints.
4. Assign pitches: keep a group on the same pitch where possible (spectator convenience), tiebreak by pitch sortOrder.

`plannedStart` per slot = `startAt + index × (matchDurationMin + transitionMin)`.

Regeneration: allowed only while tournament status is `DRAFT` or `SCHEDULED` and no match has started. Regeneration deletes all existing group-stage matches and slots. Return `409` otherwise.

### 2. Synchronized starts (the ready system)

All matches inside a slot start at the same moment. Flow:

1. Slot `k` becomes `WAITING_READY` when slot `k−1` reaches `FINISHED` (slot 0: when admin starts the tournament).
2. Each referee assigned to a match in slot `k` sees a **Ready** button and presses it when both teams stand on the pitch → match status `READY`.
3. When **every** match in the slot is `READY`, the server flips the slot to `RUNNING`, sets `actualStart = now`, sets all its matches to `RUNNING`, and broadcasts `slot.started` over SSE. Referees start their clocks off this event.
4. Admin override: `POST /matches/:id/force-ready` marks a match ready without the referee (no-show referee, dead phone battery). Admin can also remove a match from a slot (`PATCH /matches/:id` with `slotId: null`) if a team withdrew — the slot then fires without it.
5. Delays cascade: when a slot starts late, recompute estimated starts for all later slots as `max(plannedStart, previousSlotEnd + transitionMin)` and broadcast `schedule.updated`. Store only `plannedStart` and `actualStart`; estimated times are computed, never persisted.

A slot is `FINISHED` when all its matches are `FINISHED`. The match clock (`matchDurationMin`) is informational for the referee UI; the server never auto-finishes a match — the referee presses Finish.

### 3. Live scoring

- `POST /matches/:id/goals { teamId }` — only the assigned referee, only while match is `RUNNING`. Creates a Goal row, increments the denormalized score, broadcasts `goal.scored`.
- `DELETE /goals/:id` — correction by the same referee or admin, decrements score.
- `POST /matches/:id/finish` — referee or admin. Group match: any result stands. Knockout match with a draw: server responds `409 PENALTIES_REQUIRED`; referee then submits `POST /matches/:id/penalties { home, away }` (must not be equal), after which the match auto-finishes.
- Admin can `PATCH /matches/:id/result` after the fact to fix a wrong final score (audit-log it).

### 4. Standings

Computed on read from finished group matches (no stored table — one weekend of data, always consistent):
- Win 3 points, draw 1, loss 0.
- Tiebreakers in order: points → goal difference → goals scored → head-to-head result → head-to-head goal difference.
- If still tied and the tie affects qualification, the standings response flags it (`tieUnresolved: true`) and the admin resolves it with `PATCH /groups/:id/tiebreak { order: [teamId, ...] }` (drawing of lots at the tournament desk). Knockout generation refuses to run while a qualification-relevant tie is unresolved.

### 5. Knockout generation (`POST /categories/:id/knockout/generate`)

Preconditions: all group matches of the category `FINISHED`, no unresolved qualification tie, `qualifiersPerGroup` set, not already generated.

1. N = groups × qualifiersPerGroup and **must be exactly 4, 8, or 16** — no byes, no uneven brackets. This is enforced twice: when the admin sets `qualifiersPerGroup` (against the current group count, `422 INVALID_BRACKET_SIZE` with the valid options for that group count) and again at generation time.
2. Seeding: rank all qualifiers by group position first (all group winners above all runners-up), then by points, goal difference, goals scored within the same position tier.
3. Pairing: 1 vs N, 2 vs N−1, ... Best effort to avoid rematches of same-group teams in round 1 (swap seeds within the same tier if it resolves a clash).
4. Rounds map to phases up to `FINAL`. Losers of the two `SEMIFINAL` matches feed a `THIRD_PLACE` match via `MATCH_LOSER` sources; the third-place match is slotted **before** the final.
5. Knockout matches use the same slot mechanics. They are appended as new slots after the last existing slot of the tournament (knockout rounds of different categories can share slots to fill pitches). Sources resolve automatically: when a match finishes or a group completes, the server fills `homeTeamId`/`awayTeamId` of dependent matches and broadcasts `bracket.updated`.

The knockout uses the same `matchDurationMin` as the group stage in v1. Per-phase durations are a v2 item (see Open Items).

## API Reference

Base path `/api`. `A` = admin JWT, `R` = approved referee JWT (assigned to the match where noted), `P` = public. All errors: `{ error: { code, message } }` with proper HTTP status. Mutating endpoints validate tournament/match state and return `409` on illegal transitions.

### Auth
| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/auth/register` | P | Referee sign-up `{ email, name, password }` → status `PENDING` |
| POST | `/auth/login` | P | `{ email, password }` → `{ token, user }`; `403 REFEREE_PENDING` / `403 REFEREE_REJECTED` for non-approved referees |
| GET | `/auth/me` | A/R | Current user |

### Referee administration
| GET | `/admin/referees?status=` | A | List referees; `?status=PENDING` backs the admin approval view |
| POST | `/admin/referees/:id/approve` | A | `PENDING → APPROVED`, unlocks login |
| POST | `/admin/referees/:id/reject` | A | `PENDING → REJECTED` |
| DELETE | `/admin/referees/:id` | A | Hard delete. `409 REFEREE_HAS_ASSIGNMENTS` (`error.details.matchIds`) if the referee is assigned to any non-`FINISHED` match — reassign first. Finished matches keep their history but the referee link is nulled (`onDelete: SetNull`), so they read as "unbekannt". The auth hook re-checks existence, invalidating any live session |

SSE event `referee.registered` (admin dashboard shows a badge when someone new signs up during the tournament).

### Tournament setup
| POST | `/tournaments` | A | `{ name, startAt, matchDurationMin, transitionMin, pitchCount }`; creates Pitch rows |
| GET | `/tournaments` | P | List |
| GET | `/tournaments/:id` | P | Detail incl. categories |
| PATCH | `/tournaments/:id` | A | Editable while `DRAFT`/`SCHEDULED`; changing timing/pitchCount after generation requires regeneration |
| DELETE | `/tournaments/:id` | A | Allowed in `DRAFT`, `SCHEDULED`, `FINISHED`; `409 TOURNAMENT_RUNNING` while `RUNNING`. Cascade-deletes all tournament-scoped data (categories, groups, teams, slots, matches, goals, pitches, audit entries); referee accounts are tournament-independent and remain |
| POST | `/tournaments/:id/start` | A | `SCHEDULED → RUNNING`, puts slot 0 into `WAITING_READY` |
| POST | `/tournaments/:id/finish` | A | `RUNNING → FINISHED`. `409 MATCHES_STILL_RUNNING` (`error.details.matchIds`) if any match is `READY`/`RUNNING` — a finished tournament must never contain a live match; run finish-running first |
| POST | `/tournaments/:id/matches/finish-running` | A | Force-finishes every `RUNNING` match at its current score (normal downstream: slot finish, standings, knockout resolution, `match.finished` per match). Level knockout draws can't pick a winner and are skipped. Returns `{ finished: [matchId], skipped: [{ matchId, reason: "PENALTIES_REQUIRED" }] }`; audit-logged |

### Structure (categories / groups / teams)
| POST | `/tournaments/:id/categories` | A | `{ name, qualifiersPerGroup }` |
| PATCH | `/categories/:id` | A | `qualifiersPerGroup` validated against {4, 8, 16} total qualifiers; locked once knockout generated |
| DELETE | `/categories/:id` | A | |
| POST | `/categories/:id/groups` | A | `{ name }` |
| PATCH | `/groups/:id` | A | |
| DELETE | `/groups/:id` | A | |
| PATCH | `/groups/:id/tiebreak` | A | `{ order: [teamId] }` manual tie resolution |
| POST | `/groups/:id/teams` | A | `{ name }` |
| PATCH | `/teams/:id` | A | Rename / move group (pre-schedule only) |
| DELETE | `/teams/:id` | A | Pre-schedule only |
All structure mutations that would invalidate an existing schedule return `409 SCHEDULE_EXISTS` — admin must regenerate.

### Scheduling
| POST | `/tournaments/:id/schedule/generate` | A | Generates slots + group matches; response includes per-team rest stats `{ min, max, avg }` |
| POST | `/categories/:id/knockout/generate` | A | See rules above |
| GET | `/tournaments/:id/slots` | P | Slots with planned/actual/estimated starts |
| GET | `/tournaments/:id/matches?categoryId=&groupId=&phase=&teamId=&status=` | P | Filterable match list |
| GET | `/matches/:id` | P | Detail incl. goals |
| PATCH | `/matches/:id` | A | Manual fixes: `{ pitchId?, slotId?, refereeId? }` — refereeId must be an `APPROVED` referee without another match in the same slot |

### Referee flow
| GET | `/referees/me/matches` | R | Own assignments with slot state and estimated start |
| POST | `/matches/:id/ready` | R (assigned) | Match `SCHEDULED → READY`; only while its slot is `WAITING_READY` |
| POST | `/matches/:id/unready` | R (assigned) | Undo before slot fires (team walked off again) |
| POST | `/matches/:id/goals` | R (assigned) | `{ teamId, clientId? }`, match must be `RUNNING`. Idempotent on `clientId` (see Replay safety) |
| DELETE | `/goals/:id` | R (own) / A | |
| POST | `/matches/:id/finish` | R (assigned) / A | `409 PENALTIES_REQUIRED` on knockout draw |
| POST | `/matches/:id/penalties` | R (assigned) / A | `{ home, away }`, home ≠ away. Idempotent on the result (see Replay safety) |

### Team registration
| POST | `/registrations` | P | `{ tournamentId, categoryId, teamName, contactName, contactEmail, contactPhone }` → `{ registrationId, checkoutUrl }`. Rate-limited 20/10 min per IP. `409 REGISTRATION_CLOSED` / `REGISTRATION_NOT_CONFIGURED` / `TEAM_NAME_TAKEN` |
| GET | `/registrations/:id/status` | P | `{ status, teamName, categoryName }` — **no contact data**; the id sits in a shareable URL |
| POST | `/webhooks/stripe` | Stripe signature | `checkout.session.completed` → PAID + Team; `checkout.session.expired` → EXPIRED |
| GET | `/tournaments/:id/registrations?status=` | A | Full list incl. contact data + `stripeUrl` |
| POST | `/registrations/:id/cancel` | A | PAID + team unassigned & unscheduled → deletes the Team, sets CANCELED. **Refund is manual** |

### Push (referee notifications)
| GET | `/push/public-key` | P | `{ enabled, key }` — `enabled:false` when no VAPID keypair is configured |
| POST | `/push/subscribe` | R | `{ endpoint, keys: { p256dh, auth } }`, upserted on `endpoint` |
| POST | `/push/unsubscribe` | R | `{ endpoint }`, idempotent |

### Admin live control
| GET | `/tournaments/:id/dashboard` | A | Current + next slot, per pitch: match, referee, ready status, score; unassigned upcoming matches; delay vs. plan |
| POST | `/matches/:id/force-ready` | A | Override missing referee |
| PATCH | `/matches/:id/result` | A | Post-hoc correction `{ scoreHome, scoreAway, pensHome?, pensAway? }` |

### Public views
| GET | `/groups/:id/standings` | P | Table with played/W/D/L/GF/GA/GD/points, `tieUnresolved` flag |
| GET | `/categories/:id/bracket` | P | Knockout tree incl. unresolved sources ("Winner Group A" etc.) |
| GET | `/tournaments/:id/teams/search?q=` | P | Name search, case-insensitive substring |
| GET | `/teams/:id/matches` | P | All matches of a team, chronological, with pitch and estimated start |

### Real-time
| GET | `/tournaments/:id/events` | P | SSE stream |

SSE event types: `slot.waiting-ready`, `match.ready`, `match.unready`, `slot.started`, `goal.scored`, `goal.deleted`, `match.finished`, `slot.finished`, `schedule.updated`, `standings.updated`, `bracket.updated`, `referee.registered`, `registration.paid` (both id only — the admin refetches over the authed endpoint, so no personal data leaks on the public stream; a registration carries a name, an email and a phone number, none of which belong on a stream anyone can open). One public stream is enough — ready states and scores are not secrets, and the admin dashboard and referee UIs subscribe to the same stream and filter client-side. Payloads carry ids only where possible; clients refetch details.

## State Machines

```
Tournament: DRAFT → SCHEDULED (schedule generated) → RUNNING → FINISHED
Slot:       PENDING → WAITING_READY → RUNNING → FINISHED
Match:      SCHEDULED → READY → RUNNING → FINISHED
```
Reject every transition not shown here with `409`. `RUNNING → FINISHED` on the
tournament additionally requires no match to be `READY`/`RUNNING`
(`409 MATCHES_STILL_RUNNING`); the admin force-finishes live matches via
`POST /tournaments/:id/matches/finish-running` first.

## Validation & Edge Cases

- Group needs ≥ 2 teams before schedule generation; odd team counts get byes inside the round-robin.
- `qualifiersPerGroup`: ≥ 1, < smallest group size, and groups × qualifiersPerGroup ∈ {4, 8, 16}.
- Adding or deleting a group after `qualifiersPerGroup` is set re-runs the bracket-size check; if the combination becomes invalid, the mutation returns `422 INVALID_BRACKET_SIZE` and the admin must fix `qualifiersPerGroup` first.
- A referee can hold at most one match per slot.
- Goals only on `RUNNING` matches; ready only from the assigned referee on a `WAITING_READY` slot.
- Deleting a team after scheduling is blocked; withdrawal during the tournament = admin removes its remaining matches from slots and the standings ignore unplayed matches (document this in the standings response).
- Timestamps in UTC in the DB, tournament timezone (`Europe/Zurich`) applied client-side.
- Rate-limit `/auth/login` and `/auth/register`.

## Replay safety

The referee client queues writes made with no signal and replays them on
reconnect (see the frontend's `outbox.ts`). A replayed request is one whose
*response* was lost, not necessarily one that failed — so the two endpoints that
record a result must be idempotent, and both check that **before** the status
check, not after:

- `POST /matches/:id/goals` dedupes on `clientId`, unique on `Goal`. Two replays
  racing each other lose to the unique index rather than double-count.
- `POST /matches/:id/penalties` dedupes on the submitted result itself: an
  identical resubmission for an already-finished match returns
  `200 { duplicate: true }`. A *different* result for a decided match is a
  correction, not a replay → `409 PENALTIES_ALREADY_SET` (use the admin result
  editor).

Order matters: by replay time the match is usually already `FINISHED`, so a
status check that ran first would answer `409 MATCH_NOT_RUNNING` to a write that
in fact landed — and the client, correctly, drops rejected items. That is how a
recorded goal gets reported to the referee as lost.

## Registration (team self-service + payment)

Teams register themselves for a planned tournament and pay the entry fee via
Stripe Checkout (TWINT + card, CHF). **A Team exists only after payment
succeeded** — until then the Registration is the sole record of the intent, and
it holds the team name so two clubs cannot check out under the same name at once.
Paid = registered; no admin approval. Refunds are manual in the Stripe dashboard
(v1), except the collision path below.

- **Optional by construction**, like push: no `STRIPE_SECRET_KEY` /
  `PUBLIC_BASE_URL` → `REGISTRATION_NOT_CONFIGURED`, the same code as a missing
  fee. From the payer's side both mean "the club hasn't finished setting this up".
- **`PUBLIC_BASE_URL` is the *browser's* origin**, not the API's — Stripe
  redirects the payer there. Trailing slashes are normalised.
- **The fee is snapshotted** onto the Registration at creation: a later fee
  change must not move the goalposts for a checkout already quoted.
- **The name hold is 30 min**, mirroring the Checkout Session expiry. A name is
  blocked by existing Teams + `PAID` + non-expired `PENDING_PAYMENT` rows.
- **Case-insensitivity is done in JS, not SQL.** Prisma's `mode: "insensitive"`
  is Postgres-only and this also runs on SQLite, where the query would silently
  become case-*sensitive* — i.e. behave differently in dev and production.

### The name-collision race

Two payers check out as "Falcons"; both pay. First `completed` wins. The loser is
refunded automatically, set `CANCELED`, and emailed an apology. Two mechanisms,
because neither covers the other:

- `@@unique([categoryId, name])` on Team catches the identical-name race that
  slips between the check and the insert. This is *why* that constraint exists.
- An in-transaction re-check catches case-*differing* collisions, which an exact
  unique index cannot see.

Both funnel into one handler, which **never throws**: it runs inside the webhook,
and a failed refund must not make Stripe retry a fulfilment that succeeded. A
refund that fails is logged and left for the dashboard; the admin list carries
the payment link.

### Interaction with scheduling

Schedule generation additionally requires `registrationOpen === false`
(`409 REGISTRATION_STILL_OPEN`) and no team with `groupId: null` in any category
(`409 UNASSIGNED_TEAMS`, team ids in `error.details.teams`). Both guard the same
disaster: a team that paid and is then missing from the fixtures.

Registrations cascade with the tournament — contact data is collected to run the
tournament and must not outlive it (Swiss DSG).

### Email

Currently a **seam, not an integration**: `services/mailer.ts` logs what it would
send. Wiring Resend or SMTP is a change to `deliver` alone. The rule the shape
enforces: a confirmation must never fail the thing it confirms — by then the
money has moved — so `send` swallows everything. Stripe's own receipt email is
enabled in the dashboard rather than rebuilt.

### Local dev

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe   # prints whsec_…
```
The webhook does **not** need a tunnel (the CLI connects outbound); the payer
redirect does — `PUBLIC_BASE_URL` must be a public HTTPS origin serving the
frontend. See the frontend's „Testing on a real phone".

## Push (referee notifications)

Web Push via `web-push`, sent on two triggers only: a referee being **newly**
assigned to a match (`PATCH /matches/:id` with a changed `refereeId`), and a slot
entering `WAITING_READY` — the cue to walk to the pitch. Re-saving an existing
assignment does not notify; a phone that buzzes for non-news gets muted before
the first whistle.

- **Optional by construction.** Without `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`
  the feature reports `enabled:false` and every send is a no-op, so dev machines
  and test runs need no configuration. `npm run push:keys` prints a keypair;
  rotating it invalidates every existing subscription.
- **Sends never affect the request that triggered them.** They fire from inside
  slot cascades and admin edits, so they are fire-and-forget and swallow their
  own errors. A referee's dead endpoint cannot fail an admin's assignment.
- Expired endpoints (`404`/`410`) are pruned as they are discovered.
- `slot.waiting-ready` is broadcast from three places — `slotService`,
  `knockoutService`, `POST /tournaments/:id/start` — and each notifies.

## Conventions

- REST, JSON, camelCase.
- Every write endpoint: Zod schema → state check → transaction → SSE broadcast, in that order.
- Scheduler, standings, and bracket logic live in pure functions under `src/domain/` with no I/O — unit test them exhaustively (rest balancing, tiebreakers, byes, semifinal-loser routing).
- No soft deletes; the audit trail for scores is the Goal table plus a simple `AuditLog` table for admin result corrections.

## Open Items (deliberately v2)

- **Pick an email provider.** `services/mailer.ts` is a seam that logs; the
  confirmation and the collision-refund apology are written but not sent.
- In-app refunds. Today the admin cancel deletes the team and links the Stripe
  payment; the money is moved by hand.
- Registration editing by the team (wrong team name, changed contact).
- Reminder email before the deadline.
- Waitlists / capacity per category — explicitly excluded, not forgotten.
- Multi-team discount.

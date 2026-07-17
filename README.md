# FC Frick Tournament Backend

Backend for the FC Frick annual tournament weekend: setup, automatic group-stage
scheduling, standings, referee ready/scoring with synchronized starts, live
admin control, public read views, and SSE. See `CLAUDE.md` for the full spec.

## Stack

Node 22 · TypeScript (strict) · Fastify · Prisma (SQLite for local dev) · Zod ·
`@fastify/jwt` · bcrypt · Vitest.

## Getting started

```bash
npm install
npx prisma migrate dev        # creates dev.db
npm run seed:admin            # admin from ADMIN_EMAIL / ADMIN_PASSWORD in .env
npm run dev                   # http://localhost:3000
```

Copy `.env.example` to `.env` and adjust secrets before running.

## Commands

```bash
npm run dev        # dev server with reload
npm run build      # tsc build to dist/
npm start          # run built server
npm test           # vitest (domain unit tests)
npm run seed:admin # create/refresh the admin account
```

## What's implemented

- **Auth:** referee self-registration (PENDING), admin approve/reject, login with
  `REFEREE_PENDING` / `REFEREE_REJECTED` gating, `/auth/me`.
- **Setup:** tournaments (+ pitches), categories, groups, teams, with
  `SCHEDULE_EXISTS` guards and bracket-size validation.
- **Scheduling:** `POST /tournaments/:id/schedule/generate` — circle-method
  round-robin, slot packing under pitch capacity, rest balancing, rest stats in
  the response.
- **Synchronized starts:** slot WAITING_READY → all matches READY → RUNNING,
  finish cascade to the next slot, admin `force-ready`, computed estimated starts.
- **Live scoring:** goals add/delete, finish, knockout penalties path.
  `POST /matches/:id/goals` takes an optional `clientId` idempotency key: the
  referee app queues goals tapped without signal and replays them on reconnect,
  so a request whose response was lost must not score twice. A replayed key
  returns the existing goal as `200 { goalId, duplicate: true }` instead of
  creating one. The dedupe runs before the RUNNING check — by replay time the
  match is often finished, and a goal that IS recorded has to report success.
- **Standings:** computed on read with the full tiebreaker chain,
  `tieUnresolved` flagging, and manual tiebreak-by-lots
  (`PATCH /groups/:id/tiebreak`).
- **Knockout:** `POST /categories/:id/knockout/generate` — seeding (position
  tiers → points/GD/GF), standard seeded bracket with same-group rematch
  avoidance, third place from semifinal losers, matches slotted after the group
  stage (PENDING knockout slots shared across categories), automatic source
  resolution as feeder matches finish, and `GET /categories/:id/bracket` with
  readable unresolved slots.
- **Admin live:** dashboard, force-ready, post-hoc result correction (audit-logged).
- **Public views:** slots, matches, standings, bracket, team search, team matches.
- **Real-time:** `GET /tournaments/:id/events` SSE stream (ids-only payloads).

Everything in the spec's v1 is implemented; only the items `CLAUDE.md` marks as
deliberately v2 (per-phase durations, multi-day tournaments, referee push
notifications, etc.) remain out of scope.

## Layout

```
src/
  domain/     pure logic: scheduler, standings, bracket, time (unit-tested)
  services/   orchestration: schedule generation, slot cascade, knockout,
              source resolution
  routes/     one module per resource group
  plugins/    jwt/auth guards, error handler
  sse/        in-process broadcaster
  lib/        env, errors, loaders, estimates, match auth
prisma/       schema + migrations
tests/domain/ vitest suites
docs/         design spec
```

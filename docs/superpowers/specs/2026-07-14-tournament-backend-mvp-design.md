# FC Frick Tournament Backend — MVP Design

Date: 2026-07-14
Status: Approved

This design supplements `CLAUDE.md`, which is the authoritative spec for the API
contract, data model, and business rules. This document records only the
decisions CLAUDE.md leaves open and the MVP scope boundary.

## Environment decisions

- **Database:** SQLite via Prisma's SQLite provider for local dev (no local
  Postgres available). Schema kept Postgres-compatible so the provider can be
  switched for production. `Json` fields for knockout sources are stored as
  strings under SQLite.
- **Runtime:** Node 22, TypeScript strict, Fastify, Prisma, Zod, `@fastify/jwt`,
  bcrypt, Vitest.

## MVP scope boundary

**In scope**

- Auth: referee register/login, `/auth/me`, admin referee approve/reject.
- Tournament + category + group + team setup (structure CRUD with
  `SCHEDULE_EXISTS` guards).
- Group-stage scheduler (`/schedule/generate`): round-robin via circle method,
  slot packing under `pitchCount`, rest balancing, rest stats in response.
- Slot + synchronized-start ready system, delay cascade recomputation.
- Live scoring (goals add/delete, finish) for group matches.
- Standings computed on read, full tiebreaker chain, `tieUnresolved` flag.
- Admin dashboard + live control (force-ready, result correction).
- Public read views (slots, matches, standings, team search, team matches).
- SSE stream (in-process broadcaster, ids-only payloads).

**Deferred to a follow-up (schema stays complete so no migration needed)**

- Knockout bracket generation (`/knockout/generate`), `/bracket` view,
  penalties flow, and knockout source auto-resolution.
- `PATCH /groups/:id/tiebreak` manual tie resolution by lots.

The Prisma schema includes all knockout fields (`phase`, `homeSource`,
`awaySource`, `pens*`, etc.) from the start; only the routes and domain logic
for knockout/tiebreak are deferred.

## Architecture

```
src/
  domain/      pure, no I/O, unit-tested first
    scheduler.ts   round-robin + slot packing + rest balancing, returns stats
    standings.ts   points + tiebreakers + tieUnresolved detection
    time.ts        plannedStart / estimated-start computation
  db/          Prisma client singleton
  plugins/     jwt, auth guards (requireAdmin / requireReferee / requireAssigned),
               global error handler, rate-limit
  routes/      one file per resource group
  services/    orchestration: state check -> transaction -> SSE broadcast
  sse/         per-tournament subscriber registry (EventEmitter-backed)
  schemas/     Zod request/response schemas
  app.ts / server.ts
prisma/schema.prisma
tests/domain/  vitest unit tests
```

## Key judgment calls

1. **SSE broadcaster** — in-process registry keyed by tournamentId, single
   server process, no Redis. Payloads carry ids only; clients refetch details.
2. **Slot cascade logic** lives in one `slotService`: ready press may flip slot
   to RUNNING (all matches READY); match finish may flip slot FINISHED and the
   next slot to WAITING_READY. Estimated starts are always computed, never
   persisted.
3. **Scheduler** implements the greedy-fill + local-search-swap heuristic from
   CLAUDE.md; heaviest test coverage.
4. **Every write endpoint**: Zod -> state check -> transaction -> SSE broadcast.
5. **Errors**: global Fastify handler emits `{ error: { code, message } }` with
   correct status; an `AppError(code, status, message)` class carries them.

## Testing

Vitest. Domain (`scheduler`, `standings`, `time`) tested first and
exhaustively: round-robin correctness, odd-team byes, no team twice per slot,
rest-balancing stats, every tiebreaker level, `tieUnresolved` flagging. Route
tests follow the domain core.

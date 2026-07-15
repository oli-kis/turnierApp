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
```

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
  categories         Category[]
  pitches            Pitch[]
  slots              Slot[]
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
  groupId    String?
  name       String
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
  createdAt DateTime @default(now())
  createdBy String   // referee userId, for audit
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
| POST | `/matches/:id/goals` | R (assigned) | `{ teamId }`, match must be `RUNNING` |
| DELETE | `/goals/:id` | R (own) / A | |
| POST | `/matches/:id/finish` | R (assigned) / A | `409 PENALTIES_REQUIRED` on knockout draw |
| POST | `/matches/:id/penalties` | R (assigned) / A | `{ home, away }`, home ≠ away |

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

SSE event types: `slot.waiting-ready`, `match.ready`, `match.unready`, `slot.started`, `goal.scored`, `goal.deleted`, `match.finished`, `slot.finished`, `schedule.updated`, `standings.updated`, `bracket.updated`, `referee.registered` (id only — admin refetches the list via the authed endpoint, so no personal data leaks on the public stream). One public stream is enough — ready states and scores are not secrets, and the admin dashboard and referee UIs subscribe to the same stream and filter client-side. Payloads carry ids only where possible; clients refetch details.

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

## Conventions

- REST, JSON, camelCase.
- Every write endpoint: Zod schema → state check → transaction → SSE broadcast, in that order.
- Scheduler, standings, and bracket logic live in pure functions under `src/domain/` with no I/O — unit test them exhaustively (rest balancing, tiebreakers, byes, semifinal-loser routing).
- No soft deletes; the audit trail for scores is the Goal table plus a simple `AuditLog` table for admin result corrections.

## Open Items (deliberately v2)

- Per-category or per-phase match durations (currently one duration per tournament).
- Multi-day tournaments (weekend = create one Tournament per day for now).
- Team contact data / registration self-service.
- Push notifications for referees (SSE + browser notification API covers v1).
- Live minute-of-goal display (Goal.createdAt minus slot.actualStart gives it for free if the frontend wants it).

# CLAUDE.md — FC Frick Tournament Frontend

Frontend for the FC Frick tournament backend (see the backend repo's CLAUDE.md for the API contract). One codebase, three surfaces:

| Surface | Users | Device reality |
|---|---|---|
| **Public** | Spectators, parents, players | Phones, outdoors, bright sunlight, one hand holding a bratwurst |
| **Referee** | Approved referees | Phone in hand pitchside, gloves possible, glare, stress |
| **Admin** | Tournament desk | Laptop/tablet at the info stand |

Rename this file to `CLAUDE.md` in the frontend repository root.

## Tech Stack

- **Vite + React 19 + TypeScript (strict)** — plain SPA. The backend is a separate Fastify API; no SSR needed, everything is live data anyway.
- **React Router v7** (library mode)
- **TanStack Query v5** for all server state. No Redux/Zustand — the only client state is the auth token and UI toggles.
- **Tailwind CSS v4** with the design tokens below defined as CSS variables in `@theme`.
- **Zod** for parsing API responses (share schemas with the backend via a copied `types.ts` until a shared package exists).
- **Vitest + Testing Library** for the standings table, bracket rendering, and the SSE→invalidation map.

```bash
npm run dev        # vite dev server, proxies /api to VITE_API_URL
npm run build
npm test
npm run typecheck
```

`.env`: `VITE_API_URL=http://localhost:3000`

## Project Structure

```
src/
  api/
    client.ts        # fetch wrapper: base URL, JWT header, error normalization
    endpoints/       # one typed function per backend endpoint
    queries.ts       # TanStack Query hooks (keys defined here, nowhere else)
    sse.ts           # EventSource lifecycle + event→invalidation map
  routes/
    public/          # /, /t/:id, standings, bracket, team search
    referee/         # /ref/*
    admin/           # /admin/*
  components/        # shared: ScoreBoard, MatchCard, StandingsTable, Tag, ...
  lib/               # time formatting (de-CH, 24h), match-state helpers
```

## API Integration

`client.ts` rules:
- Reads JWT from `localStorage` (`token`), attaches `Authorization: Bearer`.
- Normalizes the backend error contract `{ error: { code, message } }` into a thrown `ApiError { status, code, message }`.
- Global handling: `401` → clear token, redirect to login. `403 REFEREE_PENDING` → route to the pending screen, don't sign out. `409` → surface `message` as a toast; these are legal race conditions on tournament day (someone else pressed the button first), never blank screens.

### Endpoint coverage

Every backend endpoint has exactly one home. When implementing, check off against this table — nothing in the API goes unused:

| Endpoint | Used by |
|---|---|
| POST `/auth/register` | Referee registration page |
| POST `/auth/login` | Shared login page (routes by role after) |
| GET `/auth/me` | App bootstrap when a token exists |
| GET `/admin/referees?status=` | Admin → referee approval queue |
| POST `/admin/referees/:id/approve` `/reject` | Approval queue row actions |
| POST/GET/PATCH/DELETE `/tournaments*` | Admin tournament list + settings form; public tournament picker |
| POST `/tournaments/:id/start` `/finish` | Admin live dashboard header |
| Category/Group/Team CRUD | Admin setup screen (tree editor) |
| PATCH `/groups/:id/tiebreak` | Admin standings view, only shown when `tieUnresolved` |
| POST `/tournaments/:id/schedule/generate` | Admin setup → "Spielplan erstellen" step, renders returned rest stats before the admin confirms publishing |
| POST `/categories/:id/knockout/generate` | Admin category view, enabled when preconditions met |
| GET `/tournaments/:id/slots` | Public schedule timeline; admin dashboard delay banner |
| GET `/tournaments/:id/matches?...` | Public match lists (all filters exposed as UI filters) |
| GET `/matches/:id` | Public match detail; referee match screen |
| PATCH `/matches/:id` | Admin match editor (pitch/slot/referee assignment) |
| GET `/referees/me/matches` | Referee home |
| POST `/matches/:id/ready` `/unready` | Referee match screen ready toggle |
| POST `/matches/:id/goals`, DELETE `/goals/:id` | Referee live scoring |
| POST `/matches/:id/finish` `/penalties` | Referee match screen |
| GET `/tournaments/:id/dashboard` | Admin live dashboard |
| POST `/matches/:id/force-ready` | Admin dashboard pitch card |
| PATCH `/matches/:id/result` | Admin match editor, post-hoc correction with confirm dialog |
| GET `/groups/:id/standings` | Public group page; admin standings |
| GET `/categories/:id/bracket` | Public bracket page; admin category view |
| GET `/tournaments/:id/teams/search?q=` | Public team search |
| GET `/teams/:id/matches` | Public team page |
| GET `/tournaments/:id/events` | `sse.ts`, subscribed on every tournament-scoped route |

### SSE handling (`sse.ts`)

One `EventSource` per open tournament, created by a `useTournamentEvents(tournamentId)` hook mounted in the tournament layout route. Map events to query invalidations — do not patch caches by hand except for `goal.scored` (optimistic-feel score bump, then invalidate):

| Event | Invalidate |
|---|---|
| `match.ready` / `match.unready` | dashboard, slots, match detail |
| `slot.waiting-ready` / `slot.started` / `slot.finished` | slots, dashboard, referee matches |
| `goal.scored` / `goal.deleted` | match detail, dashboard |
| `match.finished` | match lists, standings of its group, dashboard |
| `schedule.updated` | slots, all match lists (estimated times changed) |
| `standings.updated` | standings |
| `bracket.updated` | bracket, match lists |
| `referee.registered` | admin referee list |

Reconnect with exponential backoff (max 15 s); on reconnect, invalidate everything tournament-scoped once — pitchside 4G will drop.

## Screens

Route names and UI copy are **German** (de-CH: 24-h times, `14:30`, no AM/PM). Code, comments, and this doc stay English.

### Public (no auth)

- `/` — Tournament picker. If exactly one tournament is `RUNNING`, redirect straight into it.
- `/t/:id` — Tournament home. Top block: **Jetzt läuft** — the running slot as live score cards per pitch, updating via SSE. Below: **Als Nächstes** (next slot with estimated times and a delay note when estimate ≠ plan, e.g. „+12 min verspätet"), then category links.
- `/t/:id/kategorie/:catId` — Groups with mini-standings; bracket below once knockout exists.
- `/t/:id/gruppe/:groupId` — Full standings table (Sp/S/U/N/Tore/TD/Pkt) + all group matches with results.
- `/t/:id/tabelle` → bracket view per category: classic tree, unresolved slots labeled from `homeSource`/`awaySource` („Sieger Gruppe A", „Verlierer HF 1").
- `/t/:id/teams` — Search-as-you-type (debounced 300 ms) → `/team/:teamId`: the team's full day, chronological, each row with time (estimated, live-updating), pitch, opponent, result. This page is what parents bookmark — it must be perfect on a 360-px screen.

### Referee (`/ref`)

- `/ref/login`, `/ref/registrieren` — registration ends on „Warte auf Freigabe durch die Turnierleitung"; the same screen appears on `403 REFEREE_PENDING` at login.
- `/ref` — My matches, grouped by slot, next one pinned on top with its state.
- `/ref/spiel/:id` — The one screen that matters. Full-height layout, three phases:
  1. **Waiting**: opponent names huge, pitch name, estimated start. One button: **„Beide Teams bereit"** — minimum 64 px tall, full width. After tapping: confirmation state with an „Doch nicht bereit" undo, plus „Warten auf andere Plätze" with a live n/m ready counter (SSE).
  2. **Running** (flips automatically on `slot.started`): scoreboard with a client-side count-up clock from `slot.actualStart`, turning `--live` colored past `matchDurationMin`. Two giant `+1` zones (left/right half of the screen, one per team), an undo row listing recent goals with delete, and **„Spiel beenden"** behind a confirm sheet.
  3. **Finish**: on knockout draw the `409 PENALTIES_REQUIRED` response opens the penalty sheet (two steppers, home ≠ away enforced client-side too).
  - Goal taps must feel instant: optimistic increment, rollback + toast on failure. Disable the tapped zone for 400 ms to prevent double-taps.
  - `navigator.onLine` false or a failed mutation → sticky offline banner; never silently drop a goal.

### Admin (`/admin`)

- `/admin` — Tournament list, create form.
- `/admin/t/:id/setup` — Setup as a checklist, not a wizard (admins jump around): 1. Grunddaten 2. Kategorien/Gruppen/Teams (inline-editable tree) 3. Schiedsrichter zuweisen (per-slot table, dropdown per match, conflict-checked) 4. Spielplan. The generate button shows the returned rest stats (min/max/avg Pause pro Team) in a confirm dialog before the schedule is accepted. Invalid bracket sizes (`INVALID_BRACKET_SIZE`) render inline at the `qualifiersPerGroup` field with the valid options from the error message.
- `/admin/t/:id/live` — The dashboard. One card per pitch for the active slot: teams, referee name, ready state (pulsing until ready), live score, force-ready button. Header: current delay vs. plan, „Slot n von m", tournament start/finish controls. Next slot preview underneath with assignment gaps highlighted in the live accent color — an unassigned referee 10 minutes before a slot is the #1 operational failure.
- `/admin/referees` — Approval queue; badge in the nav on `referee.registered`.
- `/admin/t/:id/spiel/:matchId` — Match editor: reassign pitch/slot/referee, post-hoc result correction with a typed-confirmation dialog („SF1 korrigieren").

## Design System

**Direction — „Anzeigetafel":** the visual world of this app is the tournament ground itself: chalk lines on grass, the hand-flipped scoreboard, laminated schedules at the info stand. Not the club's blue/yellow (explicit requirement) and not a generic sports-app dark mode — the app is used outdoors in May sunshine, so the base is light and the contrast is brutal.

### Tokens (`@theme` in Tailwind v4)

```css
--color-chalk:   #F6F6F2;  /* page background — cool paper white */
--color-ink:     #16211B;  /* text — green-cast near-black, AAA on chalk */
--color-pine:    #1A5A48;  /* primary: buttons, links, active states */
--color-pine-deep:#0E3D30; /* hover, headers */
--color-live:    #E8590C;  /* ONLY for live things: running clock, LIVE tag, delay warnings, unassigned-referee alerts */
--color-line:    #D8DAD3;  /* borders, table rules — chalk line grey */
--color-win: #1F7A33; --color-loss: #B3261E; /* result glyphs only, never surfaces */
```

Rules: `--color-live` is reserved for time-critical/live information and appears nowhere decorative — that scarcity is what makes the dashboard scannable. Surfaces stay chalk/white with 1 px `--color-line` borders; shadows minimal; radius 8 px on cards, 999 px on tags.

### Type

- **Display & scores:** Archivo (weights 600–900, `font-feature-settings: "tnum"` — scores and clocks must be tabular so digits don't jump). Scores on the referee screen: 96 px+. Live cards public: 40 px.
- **Body/UI:** Instrument Sans. Utility/data (tables, times): same family, tabular numerals, 13–14 px, generous line height.
- Standings tables and schedules are the core content — design the table first, the page around it.

### Signature element

The **live score card**: pitch name as an eyebrow, two team names, the tabular score in display weight, a thin progress bar underneath filling across `matchDurationMin` in `--color-live`. This exact card is reused at three sizes — public „Jetzt läuft", admin dashboard, referee screen — so the whole product visibly shares one scoreboard identity.

### Outdoor & touch floor

- Contrast ≥ 7:1 for all text (sunlight), no grey-on-grey metadata below 4.5:1.
- Touch targets ≥ 48 px everywhere, ≥ 64 px for referee actions.
- No hover-only affordances; everything works by tap.
- `prefers-reduced-motion` respected; the only ambient animation is the ready-state pulse and the score-change tick.
- Visible keyboard focus (admin uses a laptop).

## States & Copy

- Every list has a designed empty state that says what to do next („Noch keine Teams — füge das erste Team hinzu").
- Errors state what happened and the way out, in the interface's voice, no apologies: „Spiel läuft nicht mehr — Tor wurde nicht gezählt."
- Loading: skeletons for tables/cards, never spinners on full pages.
- Times: always show estimated start when it differs from planned, formatted „14:42 (geplant 14:30)".

## Open Items (v2)

- PWA install + offline goal queue (v1 only guards against silent loss).
- Big-screen mode: auto-cycling standings/live view for a beamer at the clubhouse.
- Push notifications for referees.

# CLAUDE.md — FC Frick Tournament Frontend

Frontend for the FC Frick tournament backend (see the backend repo's CLAUDE.md for the API contract). One codebase, three surfaces:

| Surface | Users | Device reality |
|---|---|---|
| **Public** | Spectators, parents, players | Phones, outdoors, bright sunlight, one hand holding a bratwurst |
| **Referee** | Approved referees | Phone in hand pitchside, gloves possible, glare, stress |
| **Admin** | Tournament desk | Laptop/tablet at the info stand |

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
    outbox.ts        # offline write queue for referee actions
    useOutbox.ts     # React bindings for the outbox (state, flush triggers)
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
| DELETE `/admin/referees/:id` | Approval queue delete action; on `409 REFEREE_HAS_ASSIGNMENTS` show the blocking matches (`error.details.matches`) as links to the match editor |
| POST/GET/PATCH/DELETE `/tournaments*` | Admin tournament list + settings form; public tournament picker. DELETE via typed-name confirm dialog (allowed unless `RUNNING` → `409 TOURNAMENT_RUNNING`) |
| POST `/tournaments/:id/start` `/finish` | Admin live dashboard header. `/finish` on `409 MATCHES_STILL_RUNNING` opens the finish-running action from the error state |
| POST `/tournaments/:id/matches/finish-running` | Admin live dashboard header "Laufende beenden"; confirm dialog lists running matches, reports skipped `PENALTIES_REQUIRED` draws afterwards |
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
| GET `/push/public-key` | `NotificationPrompt` — whether to offer the toggle at all, plus the key to subscribe with |
| POST `/push/subscribe` `/unsubscribe` | `NotificationPrompt` toggle on `/ref` |

### Offline write queue (`outbox.ts`)

Every referee write (`goal.add` / `goal.delete` / `match.ready` / `match.unready` / `match.finish` / `match.penalties`) goes through `sendOrQueue`, never through the endpoint directly. Online with an empty queue → sent now; otherwise persisted to `localStorage` (`outbox.v1`) and replayed in order on the `online` event, on mount, and on a 15 s tick while pending.

- **`networkMode: "always"` is mandatory on these mutations.** TanStack Query's default pauses a mutation while offline — `onMutate` runs, `mutationFn` does not — which bypasses the outbox and leaves the goal in memory to die with the tab. This is the whole failure the queue exists to prevent.
- **Replay semantics:** network error → stop, keep the queue. HTTP error → drop that item and toast it (a 409 is a legal race; retrying forever would wedge the queue and hide the truth). `404` on `goal.delete` is success — already gone.
- **Coalescing:** a new ready/unready drops the pending one for that match; undoing a still-queued goal removes its `goal.add` rather than queueing a delete for an id the server never saw; a new `match.penalties` drops both the previous result for that match and any queued `match.finish` — the penalties endpoint finishes the match itself, and a finish replayed after it would be reported to the referee as a failure.
- **Idempotency:** each goal tap mints a `clientId` sent to `POST /matches/:id/goals`. The backend returns the existing goal (`200 {duplicate:true}`) instead of scoring twice, so a replay of a request whose response was lost cannot double-count. That dedupe runs *before* the RUNNING check, so a replay landing after the match finished still reports success. `POST /matches/:id/penalties` gets the same guarantee without a `clientId`: a penalty result is a value, not a countable event, so the backend dedupes on the result itself.
- **Penalties are queued, not asked for.** The referee normally learns that penalties are needed from `409 PENALTIES_REQUIRED` — an answer that needs a connection. Offline, a queued `match.finish` would be replayed into that 409 and dropped, leaving a knockout match undecided. So the client evaluates the same two facts the server checks (knockout, drawn) and opens the penalty sheet itself; the 409 path stays as defence in depth for when the two disagree.
- A failed *refetch* must never replace the referee screen with an error state — cached data plus the offline banner is the correct pitchside behaviour.

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
- `/t/:id/beamer` — Big-screen mode for the clubhouse projector, outside `TournamentLayout` (no nav, no header, no max-width). The deck builds itself from live data (`buildBeamerPages`): „Jetzt läuft" (or „Als Nächstes" when nothing runs) → one page per group table → one per generated bracket; a page with nothing to show is never emitted. Cycles every 15 s (`?interval=`), `?scale=` sizes it for the room via `zoom` on the stage — the shared components are reused untouched rather than growing a fourth ScoreCard size. Space pauses, ←/→ step, F fullscreen. The dwell bar is **pine, not live** — it is a UI timer, not tournament time. Launched from the admin live header in a new tab.

### Referee (`/ref`)

- `/ref/login`, `/ref/registrieren` — registration ends on „Warte auf Freigabe durch die Turnierleitung"; the same screen appears on `403 REFEREE_PENDING` at login.
- `/ref` — My matches, grouped by slot, next one pinned on top with its state.
- `/ref/spiel/:id` — The one screen that matters. Full-height layout, three phases:
  1. **Waiting**: opponent names huge, pitch name, estimated start. One button: **„Beide Teams bereit"** — minimum 64 px tall, full width. After tapping: confirmation state with an „Doch nicht bereit" undo, plus „Warten auf andere Plätze" with a live n/m ready counter (SSE).
  2. **Running** (flips automatically on `slot.started`): scoreboard with a client-side count-up clock from `slot.actualStart`, turning `--live` colored past `matchDurationMin`. Two giant `+1` zones (left/right half of the screen, one per team), an undo row listing recent goals with delete, and **„Spiel beenden"** behind a confirm sheet.
  3. **Finish**: a knockout draw routes „Spiel beenden" into the penalty sheet (two steppers, home ≠ away enforced client-side too) instead of finishing. Decided client-side so it works with no signal — see the outbox notes; `409 PENALTIES_REQUIRED` still opens the same sheet if the server disagrees.
  - Goal taps must feel instant: optimistic increment, rollback + toast on failure. Disable the tapped zone for 400 ms to prevent double-taps.
  - `navigator.onLine` false or a failed mutation → sticky offline banner; never silently drop a goal.

### Admin (`/admin`)

- `/admin` — Tournament list, create form. Each card's **Setup** and **Live** are real buttons (the contextually relevant one primary: Live while `RUNNING`, else Setup); no link-styled actions. Delete is available unless `RUNNING` and opens a typed-name confirmation dialog — deleting a tournament destroys a whole day's results, so a plain OK is not enough.
- `/admin/t/:id/setup` — Setup as a checklist, not a wizard (admins jump around): 1. Grunddaten 2. Kategorien/Gruppen/Teams (inline-editable tree) 3. Schiedsrichter zuweisen (per-slot table, dropdown per match, conflict-checked) 4. Spielplan. The generate button shows the returned rest stats (min/max/avg Pause pro Team) in a confirm dialog before the schedule is accepted. Invalid bracket sizes (`INVALID_BRACKET_SIZE`) render inline at the `qualifiersPerGroup` field with the valid options from the error message.
- `/admin/t/:id/live` — The dashboard. One card per pitch for the active slot: teams, referee name, ready state (pulsing until ready), live score, force-ready button. Header: current delay vs. plan, „Slot n von m", tournament start/finish controls, and a **„Laufende beenden (n)"** action that force-finishes every running match (confirm dialog lists them; reports skipped knockout draws needing penalties). Finishing the tournament while matches run surfaces the same action from the `409 MATCHES_STILL_RUNNING` state. Next slot preview underneath with assignment gaps highlighted in the live accent color — an unassigned referee 10 minutes before a slot is the #1 operational failure.
- `/admin/referees` — Approval queue; badge in the nav on `referee.registered`. Each row has a delete action (confirm dialog); on `409 REFEREE_HAS_ASSIGNMENTS` the blocking matches are listed as links to the match editor to reassign first.
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
- Times: always show estimated start when it differs from planned, formatted „14:42 (geplant 14:30)". The kickoff time is the single most important datum for players/parents, so **every** match rendering shows it in display weight (tabular): `MatchRow` leads with it, `ScoreCard` shows it as the eyebrow when not running, and the match list / team-day endpoints carry each match's `plannedStart` + `estimatedStart` so no view can forget it.
- LIVE guard (defence in depth): the LIVE badge and count-up clock render only when `match.status === "RUNNING"` **and** the tournament is `RUNNING`. `MatchRow` and `ScoreCard` take an optional `tournamentStatus` for this — a finished tournament must never show a live match.

## PWA

`vite-plugin-pwa` (`autoUpdate`), `injectManifest` strategy — the worker is hand-written in `src/sw.ts` rather than generated, because push needs real listeners and workbox cannot generate those. Everything the generated worker did is restated there on purpose: the caching contract is a product decision, not a default.

The app shell and fonts are precached; **`/api` is never cached** — everything under it is live tournament data, and a cached standings table on tournament day is worse than a spinner. It is reached by having no route match it (so it goes straight to the network) plus a `denylist` on the navigation fallback, which must never swallow an API call or the SSE stream. Offline writes are the outbox's job, not the service worker's. The SW ships only in a real build (`devOptions.enabled: false`), so `npm run preview` (proxied to the API, same as dev) is the only way to exercise it.

Icons come from `npm run icons` (`scripts/generate-icons.mjs`): the scoreboard mark drawn as plain rectangles and encoded with node's `zlib`, so there is no native image dependency to install on a build machine. Re-run it if the palette changes.

`InstallPrompt` sits at the bottom of `/ref` and `/t/:id` — never above the scores. It uses the real `beforeinstallprompt` where it exists and falls back to „Teilen → Zum Home-Bildschirm" instructions on iOS Safari, which has no such event; dismissal is remembered.

### Push notifications

`NotificationPrompt` sits beside `InstallPrompt` at the bottom of `/ref`, same rule: nothing outranks the schedule. Referees are notified on assignment and when their slot opens for ready-checks (`lib/push.ts` owns enrolment, `sw.ts` the `push` / `notificationclick` handlers).

It renders **nothing** unless push can actually be honoured — the backend has VAPID keys (`GET /push/public-key`), the browser has the APIs, and permission isn't already denied. Two rules worth keeping:

- **The browser is the authority on subscription state**, not our database: permission can be revoked in system settings without telling us, so the toggle reads `pushManager.getSubscription()` rather than trusting a stored flag.
- **iOS has push only in an installed PWA** — Safari exposes no `PushManager` in a normal tab, so roughly half the referees can only opt in after adding the app to the home screen. That case says so and points at `InstallPrompt`; it never shows a toggle that would silently fail.

Push needs a **secure context** — see „Testing on a real phone" below.

## Testing on a real phone

This is a phone app used outdoors; it has to be exercised on one. Two routes, and
the choice is not taste — it decides what is testable at all.

**The rule that governs everything here: service workers, PWA install and push
require a secure context.** `localhost` and HTTPS qualify; `http://<lan-ip>` does
not. Over LAN HTTP the browser exposes no `PushManager`, so `NotificationPrompt`
correctly renders *nothing* — indistinguishable from a bug unless you know why.

### LAN — fast, for everyday UI work

```bash
npm run dev -- --host     # → http://192.168.x.x:5173
```

Phone on the same Wi-Fi, open that URL. The `/api` proxy runs on the laptop, so
**the phone only ever talks to :5173** — the API port never needs to be reachable.

Windows blocks this by default: an inbound rule is needed, and if the Wi-Fi is
categorised `Public` (Windows' default for a home router) the rule must match
that profile. Prefer marking the home network `Private` and scoping the rule to
it, rather than opening a port on every public network you ever join:

```powershell
# elevated, once
Set-NetConnectionProfile -InterfaceAlias "WLAN" -NetworkCategory Private
New-NetFirewallRule -DisplayName "Vite mobile testing" -Direction Inbound `
  -Protocol TCP -LocalPort 5173,4173 -Action Allow -Profile Private
```

Gets you: the whole app, HMR, real touch targets in real sunlight — **including
the offline outbox**, which is plain `localStorage` + `fetch` and needs no SW, so
airplane-mode scoring is testable here. Does *not* get you: install prompt, push,
or SW precache (loading the app while offline).

### Tunnel — HTTPS, for the PWA surface

```bash
npm run build && npm run preview                      # SW ships only in a real build
npx cloudflared tunnel --url http://localhost:4173    # → https://<random>.trycloudflare.com
```

No firewall rule and no admin: the tunnel is an *outbound* connection, which is
why this is often the easier route on a locked-down laptop, not the harder one.
One tunnel covers both — preview proxies `/api`, so app and API share an origin:
no CORS, no mixed content. `allowedHosts: true` on both servers is what lets the
tunnel's `Host` through; without it Vite 6 answers „Blocked request" before the
app loads. Tunnelling `dev` (5173) works too and keeps HMR, but the SW is off in
dev, so push and install still need `preview`.

For push specifically: `npm run push:keys` on the backend first (paste into
`.env`, restart), then on the phone log in as an **approved** referee —
**iPhone: Share → „Zum Home-Bildschirm" and reopen from the icon**, or there is
no `PushManager` — and switch „Benachrichtigungen" on. `npm run push:test --
<referee-email>` then fires a real notification through the production send path,
so delivery can be checked without staging a tournament.

## Open Items (v2)

- Push covers assignment and `slot.waiting-ready`. Not yet: a nudge when the referee's slot is `WAITING_READY` but *their* match is still unready — the one operational gap notifications could still close.

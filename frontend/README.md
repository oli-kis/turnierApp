# FC Frick Tournament Frontend

Vite + React 19 SPA for the FC Frick tournament weekend — three surfaces in one
codebase: **Public** (spectators), **Referee** (pitchside scoring), **Admin**
(tournament desk). Talks to the Fastify backend at the repo root. See
`CLAUDE.md` for the full spec and the "Anzeigetafel" design system.

## Stack

React 19 · TypeScript (strict) · React Router v7 · TanStack Query v5 ·
Tailwind CSS v4 · Zod · Vitest + Testing Library. Fonts self-hosted
(`@fontsource` Archivo + Instrument Sans).

## Getting started

```bash
# 1. start the backend (repo root, separate terminal)
cd ..  &&  npm start            # http://localhost:3000

# 2. start the frontend
npm install
npm run dev                     # http://localhost:5173, proxies /api → :3000
```

`.env`: `VITE_API_URL=http://localhost:3000`

## Commands

```bash
npm run dev        # dev server with /api proxy
npm run build      # tsc -b + vite build
npm run preview    # serve the production build
npm test           # vitest
npm run typecheck  # tsc -b --noEmit
```

## Architecture

```
src/
  api/
    client.ts     fetch wrapper: JWT, ApiError, global 401/403/409
    types.ts      Zod schemas mirroring backend responses
    endpoints/    one typed function per backend endpoint
    queries.ts    TanStack Query hooks + query keys (defined ONLY here)
    sse.ts        EventSource per tournament + event→invalidation map + backoff
    appBridge.ts  runtime bridge for global nav/toast handlers
  auth/           token context + role-routed ProtectedRoute
  routes/
    public/       /, /t/:id (+category/group/bracket/teams), /team/:id
    referee/      /ref/* incl. the 3-phase match screen
    admin/        /admin/* incl. setup checklist, live dashboard, match editor
  components/      ScoreCard (signature, 3 sizes), StandingsTable, BracketTree,
                  MatchRow, LiveClock, Tag, Sheet, Toast, Skeleton, …
  lib/            de-CH time formatting, match-state helpers
```

## Key behaviours

- **Every backend endpoint has exactly one home** (see the coverage table in
  `CLAUDE.md`) — all wired.
- **Live updates via SSE**: one `EventSource` per open tournament mounts in the
  tournament layout / referee match / admin live routes and maps events to query
  invalidations. Routes without a tournament id poll instead. Reconnect uses
  exponential backoff (max 15 s) and invalidates everything tournament-scoped on
  reconnect.
- **Referee scoring** is optimistic: goal taps bump the score immediately, roll
  back with a toast on failure, and guard against double-taps; a sticky offline
  banner appears when the connection drops.
- **Global error contract**: `401` signs out, `403 REFEREE_PENDING` routes to the
  pending screen, `409` surfaces as a toast (legal tournament-day races).

## Tests

Vitest + Testing Library cover the standings table, bracket rendering (resolved
+ unresolved source labels, third-place routing), the SSE→invalidation map, and
an integration render of a real screen through the providers.

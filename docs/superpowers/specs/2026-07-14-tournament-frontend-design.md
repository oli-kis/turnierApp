# FC Frick Tournament Frontend — Build Design

Date: 2026-07-14
Status: Approved

Supplements `frontend/CLAUDE.md` (authoritative for screens, API integration,
SSE map, and the "Anzeigetafel" design system). This records only the decisions
that document leaves open.

## Decisions

- **Location:** `C:\tournamentapp\frontend\` — self-contained Vite project; the
  backend stays at the repo root serving `:3000`. Vite dev-proxies `/api` to
  `VITE_API_URL`. The frontend spec is copied to `frontend/CLAUDE.md`.
- **Fonts self-hosted** via `@fontsource/archivo` and
  `@fontsource/instrument-sans` — no CDN dependency, survives pitchside 4G.
- **Design execution:** implement the spec's design system faithfully, then a
  dedicated polish pass on the hero surfaces (referee match screen, live score
  cards, standings) using the impeccable / emil-design-eng skills.
- **Router:** React Router v7 data router (`createBrowserRouter`).
- **Client state:** only the auth token (localStorage) + small UI toggles;
  everything else is TanStack Query server state. Query keys live only in
  `api/queries.ts`.

## Architecture

```
src/
  api/
    client.ts     fetch wrapper: base URL, JWT, ApiError, global 401/403/409
    types.ts      Zod schemas mirroring backend responses
    endpoints/    one typed function per backend endpoint
    queries.ts    TanStack Query hooks; query keys defined only here
    sse.ts        EventSource lifecycle + event->invalidation map + backoff
  routes/
    public/       /, /t/:id, category, group, bracket, teams, team
    referee/      /ref/*
    admin/        /admin/*
  components/      ScoreCard (signature, 3 sizes), MatchCard, StandingsTable,
                   BracketTree, Tag, Button, Skeletons, EmptyState, Toast,
                   OfflineBanner, LiveClock
  lib/            de-CH time formatting, match-state helpers
  auth/           token context + role-routed ProtectedRoute
```

## Build order

1. Scaffold + foundation (client, types, endpoints, queries, sse, lib, auth,
   app shell, tokens, fonts).
2. Shared components incl. the signature ScoreCard.
3. Public surface.
4. Referee surface (the hero match screen).
5. Admin surface.
6. Tests: StandingsTable, BracketTree unresolved labels, SSE→invalidation map.
7. Polish pass on hero surfaces.
8. End-to-end verification against the running backend.

## Design system (from spec, applied verbatim)

`@theme` tokens (chalk/ink/pine/live/line/win/loss); `--color-live` reserved
strictly for live/time-critical UI; chalk surfaces with 1px `--color-line`
borders; radius 8 (cards) / 999 (tags); Archivo for display+scores (tabular),
Instrument Sans for body/data (tabular); contrast ≥7:1; touch ≥48px, ≥64px for
referee actions; `prefers-reduced-motion` respected; visible keyboard focus;
designed empty states and skeletons.

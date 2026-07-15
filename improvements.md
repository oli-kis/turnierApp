# improvements.md — Bug fixes & improvements

Work through these top to bottom. Items marked **[BE]** need backend changes, **[FE]** frontend, **[BE+FE]** both. Keep the state machines and error contract from the backend CLAUDE.md intact — where an item conflicts with the current spec, this file wins and the CLAUDE.md must be updated in the same commit.

---

## 1. [FE] Kickoff time must be far more prominent — on every match

Currently the (estimated) kickoff time is easy to miss. It is the single most important piece of information for players and parents.

- Show the kickoff time on **every** match rendering in the app: match cards, team page rows, group match lists, schedule, admin dashboard, referee screens.
- Visually: time first, in display weight with tabular numerals — not metadata-grey, not smaller than the team names on list rows.
- Always the *estimated* time; append the planned time when they differ: `14:42 (geplant 14:30)`.
- Add the time to the `MatchCard` component itself so no view can forget it, rather than per-page.

## 2. [BE+FE] Admin: "finish all running matches" button

Referees forget to press finish; a single forgotten match blocks the slot from finishing and stalls the whole day.

- **Backend:** `POST /tournaments/:id/matches/finish-running` (admin). Finishes every match with status `RUNNING` using its current score, sets `finishedAt`, triggers the normal downstream logic (slot finish, standings, knockout source resolution, SSE `match.finished` per match).
- **Knockout draws:** a running knockout match with a level score cannot be force-finished without a winner. Skip those matches and return them in the response: `{ finished: [matchIds], skipped: [{ matchId, reason: "PENALTIES_REQUIRED" }] }`. The admin resolves them individually via the match editor (enter penalties through `PATCH /matches/:id/result`).
- **Frontend:** button on the admin live dashboard header, behind a confirm dialog listing the affected matches. Show skipped matches with their reason after execution.
- Audit-log the action (who, when, which matches) like other admin result interventions.

## 3. [FE] Referee assignments disappear from the setup dropdowns

**Repro:** assign referees in Setup → navigate to Dashboard → return to Setup. Dropdowns are empty although the assignments are persisted in the DB.

- This is a form-initialization bug, not a data bug: the dropdowns are most likely initialized (e.g. `defaultValue` / initial form state) before the matches query resolves, or the component keeps stale local state instead of deriving from the query.
- Fix: the assignment table must be **controlled by server state** — render each dropdown's value directly from the fetched match's `refereeId`; local state only for in-flight edits. Key the rows by `match.id` and don't cache initial form state across mounts.
- Add a regression test: mount the setup screen with matches that have `refereeId` set → dropdowns show the assigned referee.

## 4. [BE+FE] Standings table sorted wrong

**Repro:** one team has 3 points, the others 0 — but it sits in 3rd place. The order shown equals team creation order.

- The table is rendered in the order teams were created, i.e. the tiebreaker sort is either not applied or its result is discarded.
- Check both layers:
  - **Backend:** `GET /groups/:id/standings` must return rows already sorted by the full comparator: points → goal difference → goals scored → head-to-head result → head-to-head goal difference → manual tiebreak order. Verify the comparator is actually used (a classic bug: computing stats into a map and returning `Object.values()` in insertion order).
  - **Frontend:** must render the response **in the order received** — remove any client-side re-sort or keyed ordering that falls back to team creation order.
- Add unit tests on the backend comparator with fixtures: (a) 3/0/0/0 points, (b) equal points decided by goal difference, (c) equal points+GD decided head-to-head. This function decides who reaches the knockout — it must be test-covered.

## 5. [FE] Back navigation from team detail returns to home instead of team search

**Repro:** search for a team → open team detail → tap "zurück" → lands on the start page instead of the search results.

- The back control is a hardcoded link (to `/` or `/t/:id`) instead of history navigation, and/or the search query isn't in the URL so the search page can't be restored.
- Fix:
  - Put the search term in the URL: `/t/:id/teams?q=frick`. The search page reads and writes `q` via search params, so the state survives navigation and is shareable.
  - The team detail back control navigates with `history.back()` when the previous entry is in-app; fall back to `/t/:id/teams` (with preserved `q` if passed via link state) on deep links.
- Apply the same pattern to every detail page with a back control — audit for other hardcoded back links.

## 6. [BE+FE] Admin: delete referees

- **Backend:** `DELETE /admin/referees/:id` (admin).
  - If the referee is assigned to matches that are not `FINISHED`: return `409 REFEREE_HAS_ASSIGNMENTS` with the affected match ids. The admin must reassign first — silent unassignment would break the ready flow of an upcoming slot.
  - If only finished matches reference them: soft approach — keep the historical `refereeId` on finished matches intact. Either anonymize the user row or use `onDelete: SetNull` and accept "unknown referee" in history; pick one, document it in CLAUDE.md.
  - Deleting also invalidates their sessions (JWT: acceptable to rely on the 12 h TTL, but reject requests whose `userId` no longer exists — verify the auth hook does a DB existence check or add one).
- **Frontend:** delete action in `/admin/referees` with confirm dialog; on `409`, show the blocking matches with links to the match editor.

## 7. [BE+FE] Admin: delete finished or scheduled tournaments

Current rule (CLAUDE.md) allows deletion only in `DRAFT`. Change:

- **Backend:** `DELETE /tournaments/:id` allowed for `DRAFT`, `SCHEDULED`, and `FINISHED`. Blocked with `409 TOURNAMENT_RUNNING` while `RUNNING`.
- Cascade delete everything tournament-scoped: categories, groups, teams, slots, matches, goals, pitches, audit entries. Referee accounts are tournament-independent and stay.
- **Frontend:** delete action on the admin tournament list with a typed-confirmation dialog (type the tournament name) — this destroys the results of a whole tournament day, a plain "OK" is not enough.
- Update the backend CLAUDE.md endpoint table accordingly.

## 8. [FE] "Setup" and "Live" must look like buttons

On the admin tournament card, "Setup" and "Live" read as plain text.

- Style them as real buttons per the design system: `--color-pine` primary for the contextually relevant action ("Live" while the tournament is `RUNNING`, otherwise "Setup"), secondary/outline for the other. Minimum 48 px touch target.
- General pass: every clickable element in the admin area needs a visible affordance (background or border + hover + focus-visible state). No link-styled actions.

## 9. [BE+FE] Matches still shown as LIVE after the tournament is finished

**Repro:** finish the tournament while matches are `RUNNING` → they keep showing as LIVE everywhere.

- Root cause: `POST /tournaments/:id/finish` currently ignores running matches, leaving them `RUNNING` forever.
- **Backend fix:** finishing a tournament with matches in `READY`/`RUNNING` (or any slot not `FINISHED`) returns `409 MATCHES_STILL_RUNNING` with the match ids. The admin first uses the finish-running button from item 2 (and resolves any skipped knockout draws), then finishes the tournament. No silent auto-finish — a finished tournament must never contain a match without an explicit final result.
- **Frontend:** on that `409`, the dashboard offers the item-2 action directly from the error state ("Es laufen noch n Spiele — jetzt beenden?").
- **Defense in depth in the UI:** the LIVE badge/clock renders only when `match.status === RUNNING` **and** the tournament is `RUNNING`. Cheap guard against any future inconsistent state.

---

## Definition of done (applies to every item)

- Backend changes covered by tests where logic changed (items 2, 4, 6, 7, 9).
- Both CLAUDE.md files updated where endpoints, state rules, or UI patterns changed (items 2, 6, 7, 9).
- Manual repro from each item re-checked after the fix.

# GeoSat Team Board

A private, realtime weekly task board with a Kanban view for the six-person GeoSat capstone team.
React + TypeScript (Vite) front end; Supabase (Postgres, Auth, Realtime) back end.

## Status

| Part | State |
|---|---|
| Front end (board, Tuesday planning, Thursday review, All tasks, roster, filters, team admin) | Built; type-checks and builds |
| Database schema, row-level security, versioned writes, evidence rule, activity log | Built; **tested** (`npm test`, 10 tests against Postgres via PGlite) |
| Pure logic (dates in America/Denver, rules, filters, roster, merge) | **Tested** (12 tests) |
| Real local Supabase (Postgres + Auth + Realtime): two signed-in sessions, live sync, conflicts, privacy | **Tested end to end** on 2026-10-22 (see below) |
| Your hosted Supabase project, deployment | **Not yet created** — follow Setup |

Until you complete the setup below (a hosted Supabase project of your own), the site shows a "Backend setup needed" screen and is **not collaborative**.

## Setup (about 10 minutes)

1. Create a project at <https://supabase.com>.
2. SQL editor → paste and run [`db/schema.sql`](db/schema.sql) once.
3. Authentication → Providers: keep **Email** on. Turn **Confirm email** on so nobody can claim an invited address without owning it.
4. Project settings → API: copy the Project URL and the `anon` public key into `.env` (copy `.env.example`).
5. `npm install && npm run dev`, open the site, **create an account**. The first signed-in person sees "Set up your team workspace", picks which teammate they are (J/A/W/M/T/B), and can enter the other five teammates' emails.
6. Teammates create accounts with those exact emails and are added automatically. More invites: **Team** tab.
7. **After the six of you are in:** Authentication → Sign In / Providers → disable "Allow new users to sign up". Row-level security already keeps strangers out of the data, but this removes the first-run window.
8. Deploy `npm run build` output (`dist/`) to Vercel/Netlify/etc. with the same two environment variables.

## Local development (no account needed)

Needs Docker. `npm run db:start` boots a local Supabase and applies `supabase/migrations/`; it prints the local API URL and anon key for `.env.local`
(`VITE_SUPABASE_URL=http://127.0.0.1:54321`). Then `npm run dev`. `npm run db:stop` shuts it down. Keep `supabase/migrations/*_schema.sql` in sync with `db/schema.sql` (copy it over).

### Verified against local Supabase (two signed-in sessions)
Passed: account creation and first-run workspace setup; invite → join; create task in one session appears in the other live; moves sync with "who/when" in the activity log; Completed blocked without evidence, allowed with it, reopen works; simultaneous edits to one task merge non-overlapping fields and ask about overlapping ones; weekly-goal edit conflict is detected; membership, demo data and edits sync live; data survives refresh and sign-out/in; an uninvited account sees nothing, cannot write, and cannot re-run first-run setup.
Two bugs found and fixed by this run: joining via invite failed under a double page load (now idempotent), and summary edits could silently overwrite a teammate's save (now version-checked from when editing began).
Not covered: a hosted project, email confirmation flow, other browsers/devices, and drag-and-drop against the live backend (drag was verified against a mock; "Move to" against the live one).

## Two-session verification checklist (repeat on your hosted project)

Open the site in two browsers signed in as two different teammates, then:
1. Create a task in A → appears in B without refresh.
2. Drag it to another column in B → A updates.
3. Move a task to Completed → it asks "Was there a deliverable?"; answering Yes requires a what-and-where sentence, No completes with a note; Reopen works.
4. Edit the same task's title in both, save in A then B → B gets the conflict dialog and nothing is silently overwritten. Edit *different* fields → merged automatically.
5. Edit the weekly goal in both → second saver is warned.
6. Sign out and back in → data still there. Sign in as a non-invited account → "not on this team".

## Upgrading an existing project to the Calendar release

If you ran the earlier `db/schema.sql` on a Supabase project, paste **`db/add-calendar.sql`** into the SQL Editor and run it **once** (it only adds new things; existing data is untouched). New projects just run `db/schema.sql`, which already includes it. Then upload the new build.

### Customer slides release (working deck / submitted deck / past decks)
Paste **`db/add-slides.sql`** into the SQL Editor and run it **once**, then upload the new build. It's safe whether or not you ran an earlier slides script (earlier links are kept) and safe to run twice. Fresh projects: already in `db/schema.sql`.

### Recurring events release
If your project already has the Calendar, paste **`db/add-recurring.sql`** into the SQL Editor and run it **once** (existing events become "does not repeat"), then upload the new build. Fresh projects: `db/schema.sql` already includes it.

## How the requirements are met

- **Columns / moves:** Backlog, Tuesday Commitments, In Progress, Thursday Review, Completed. Drag and drop (mouse, touch) plus a "Move to" menu on every card and in the detail panel.
- **Blocked** is a flag (⛔ Blocked, needs a description), allowed in any column except Completed. Completing a task clears it. **Overdue** shows a dashed border, a ⚠ icon, the word "Overdue", and underlined date — not color alone.
- **Required fields:** title, one owner, due date, deliverable (form and database). **Completing a task** asks whether there was a deliverable: *No* records "no deliverable"; *Yes* requires a one-sentence what-and-where note (stored with the task and enforced by a database constraint). Reopen from the panel.
- **Tuesday planning:** review all unfinished work (overdue first) and commit tasks for Thursday. **Thursday review:** inspect deliverables, add evidence, record integration dependencies, complete, or *explicitly* carry forward with a revised due date (moves to Backlog, leaves a comment). Nothing changes automatically when a meeting passes.
- **Calendar tab (events can repeat):** big upcoming events pinned at the top (with countdown and linked-task progress); anyone can add/edit events; tasks link to events; a **Month** view of events and due dates; and a **Timeline (Gantt)** of tasks (optional start date → due date) in 4/8/12-week windows, grouped by owner or workstream. Filters apply to tasks. The Tuesday/Thursday views are unchanged.
- **Roster** is computed from live tasks. **Filters:** owner, workstream, due, priority, blocked, search. **All tasks** keeps old unfinished work visible.
- **Collaboration:** Supabase Realtime re-reads changed tables; visible Live/Offline and Saving indicators; error toasts. Every task change is logged with who and when (detail panel → Activity).
- **Concurrent edits:** every task, summary and profile write carries a `version`; the database rejects stale writes. The detail panel merges non-overlapping edits and shows a per-field choice dialog for true conflicts. Drag-and-drop moves that lose a race are not applied and you are told why. Evidence is appended against the latest copy, so it's never lost.
- **Privacy:** every table has row-level security limited to workspace members; invites are keyed to email.
- **Time zone:** "today", Tuesday/Thursday and overdue are all computed in America/Denver; times display in Denver time.
- **Demo data:** optional, six example tasks (from `seed/demo-tasks.json`), each badged **DEMO** with a banner; removable in one click on the Team tab. A new board starts empty.

## Known limits

- Invites don't send email — tell teammates directly to create an account with their invited address.
- Within a column, cards are ordered by due date then priority (no manual ordering).
- Hosting: any static host; the app has no server code of its own.

## Layout

```
BUILD_BRIEF.md  original requirements        db/schema.sql   database, RLS, RPCs
config/         team, workstreams, columns   db/schema.test.ts  database tests
seed/           demo tasks                   src/            the app
```
Commands: `npm run dev`, `npm run build`, `npm run typecheck`, `npm test`.

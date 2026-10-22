# GeoSat Team Board — Build Brief

Hand this file (plus the files in `config/`, `db/`, `seed/`) to a developer or a coding agent to build the site.

Build a working, collaborative task-management website called "GeoSat Team Board" for a six-person engineering capstone team. The team meets every Tuesday and Thursday. The site shows who owns each task, when it is due, what they will deliver, and what is blocking progress.

## Visual design
- Clean whiteboard look: subtle dotted background, movable sticky-note task cards, rounded corners, generous spacing.
- Pale blue, navy, subtle teal accents; flowing blue wave in the header. Readability over decoration.
- Responsive: desktop, tablet, mobile.
- Tokens: see `config/design-tokens.json`.

## Main board
Five Kanban columns: Backlog, Tuesday Commitments, In Progress, Thursday Review, Completed.
- Drag-and-drop between columns, plus an accessible "Move to" menu on every card.
- Editable summaries at top: This week's goal; Next milestone and date; Current blockers and decisions needed.

## Task cards
Fields: title, one accountable owner, optional supporting teammates, workstream, due date, concrete deliverable, priority, blocker description (if any), evidence/result links, comments and activity history.
- Card shows: title, owner (color + initials), due date, workstream, blocker indicator. Everything else is in a detail panel.
- "Blocked" is a flag usable in any active column, not a column.
- Overdue tasks are highlighted without relying on color alone (icon + "Overdue" text).
- Creating a task requires title, owner, due date, deliverable.
- Moving to Completed asks "Was there a deliverable?" If no, the task completes with a "no deliverable" note. If yes, the person must write one sentence saying what it was and where it is (a link also works). Completed tasks can be reopened.

## Team members (editable profiles, consistent colors, always show initials)
See `config/team.json`.

## Workstreams
See `config/workstreams.json`.

## Tuesday / Thursday workflow
- **Tuesday planning view:** review unfinished work, select commitments for Thursday.
- **Thursday review view:** inspect deliverables, record evidence, identify integration dependencies, explicitly carry unfinished tasks forward with a revised due date.
- Never auto-complete tasks or change due dates when a meeting passes.

## Roster and filters
- Compact roster: each person's open tasks, due dates, blockers — computed from real board data.
- Filters: owner, workstream, due date, priority, blocked. Plus text search.
- "All tasks" view so unfinished work from previous weeks stays visible.

## Collaboration and persistence (must really work)
- Authenticated team access; persistent database.
- Persist tasks, comments, weekly goals, milestones, membership changes.
- Live sync across teammates without refresh (realtime subscriptions).
- Show who changed a task and when (activity log).
- Handle simultaneous edits without silent overwrite (optimistic concurrency via `version` column; on conflict show both versions and let the user merge).
- Loading, saving, and error states everywhere.
- Data survives refresh and sign-out.
- Workspace private to members (row-level security; see `db/schema.sql`).
- All dates/deadlines in America/Denver.
- Sample data clearly labeled and separable from real work (`is_demo` flag; one-click "remove demo data"). Allow starting with an empty board.

## Demo content
Optional, clearly labeled "DEMO" board: `seed/demo-tasks.json`.

## Delivery
- Implement the full core workflow before optional features. No placeholder buttons or simulated collaboration.
- Test: task create/edit/move, evidence requirement, filtering, persistence, and updates across two signed-in sessions.
- If backend/auth needs configuration, list remaining setup (see `README.md`) and do not call the site fully collaborative until it works.

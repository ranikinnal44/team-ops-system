# Team Ops System — Layer 1

An internal **team task management and accountability system**: one place that answers
*what is happening, what is late, what is blocked, who owns it, and what needs intervention* —
and, for the person doing the work, *what do I need to do today and what is blocking me*.

**Current state:** Layer 1, loaded with the **AutoDock Stream 1 build plan** — 28 tasks, 3 phases,
8 milestones and 13 deliverables imported from `Build Timeline.pdf`. See **[AUTODOCK.md](AUTODOCK.md)** for the import, the data-quality report and
what the source document did and did not establish.

This is **Layer 1**: a complete, tested foundation with no external integrations.
Google Drive, GitHub, Google Calendar and notifications are designed for but deliberately
not implemented; they attach to the port interfaces in `src/integrations/` without the
core system being redesigned.

---

## Architecture

### Stack

Node.js 24 + TypeScript, with **zero runtime dependencies**.

| Concern | Choice | Why |
| --- | --- | --- |
| Language | TypeScript | Node 24 strips types natively — no build step, no bundler |
| Database | `node:sqlite` | Built into the runtime; a single file, no server to operate |
| HTTP | `node:http` | A ~120-line router replaces Express without pulling in a tree of packages |
| Tests | `node:test` | Built in |
| Frontend | Vanilla ES modules | No framework to learn, upgrade or build |
| Validation | `src/lib/validate.ts` | A small typed schema library in place of a dependency |

`typescript` and `@types/node` are the only entries in `package.json`, both dev-only, used
purely for `tsc --noEmit` type checking. The application itself runs from source.

The workspace was inspected first: `/home/rani/team-ops-system` was empty and the adjacent
`autodock_ws` is a ROS 2 robotics workspace (Python/C++), unrelated to a web application and
**left untouched**. Its domain vocabulary — AutoDock, navigation, perception, manipulation —
is reflected in the demo data so the sample content reads as real work.

### Layering

Dependencies point inward only. Nothing in an inner ring imports an outer one.

```
┌──────────────────────────────────────────────────────────────┐
│  public/            Vanilla ES-module UI (9 screens)         │
└───────────────┬──────────────────────────────────────────────┘
                │ JSON over HTTP
┌───────────────▼──────────────────────────────────────────────┐
│  api/           routing, auth middleware, request validation  │
├───────────────────────────────────────────────────────────────┤
│  services/      business rules, permission enforcement,       │
│                 history writing, transactions                 │
├───────────────────────────────────────────────────────────────┤
│  repositories/  SQL only — no rules live here                 │
├───────────────────────────────────────────────────────────────┤
│  db/            schema, connection, migration, seed runner    │
└───────────────────────────────────────────────────────────────┘
                 ▲
┌────────────────┴──────────────────────────────────────────────┐
│  domain/        PURE logic, no I/O:                           │
│                 • status machine   • exception rules          │
│                 • permission policy • enums & types           │
└───────────────────────────────────────────────────────────────┘
┌───────────────────────────────────────────────────────────────┐
│  integrations/  PORTS ONLY — Drive / GitHub / Calendar /      │
│                 Notify interfaces + no-op implementations.    │
│                 No task code imports a concrete provider.     │
└───────────────────────────────────────────────────────────────┘
```

**Why `domain/` is pure.** The exception rules (`isOverdue`, `isDueSoon`, `hasNoRecentUpdate`,
`isBlocked`) are plain functions over a three-field shape — status, due date, last updated.
They take no database and perform no I/O, so the dashboards and a future automation engine
or scheduled notifier evaluate *the same code* and can never disagree about what counts as
late. That is the single most important seam in the system.

### Hierarchy

```
Project
  └── Workstream
        └── Milestone
              └── Deliverable        (optional grouping)
                    └── Task
                          ├── Owner              single accountable person
                          ├── Reviewer
                          ├── Supporting members
                          ├── Dependencies
                          └── Evidence link
```

### Integration readiness

Three things make Layer 2 an addition rather than a rewrite:

1. **Port interfaces** — `StorageProvider`, `IssueTracker`, `CalendarProvider`, `Notifier`
   in `src/integrations/types.ts`. Services depend on these contracts, never on a provider.
2. **One switch point** — `src/integrations/registry.ts` is the only file that decides which
   implementation is active. Today it always returns the no-ops.
3. **A generic link table** — `task_external_links (provider, kind, external_id, url, metadata)`
   already carries Drive document/folder IDs, GitHub issues/PRs/commits and calendar events
   without a single schema change to `tasks`.

Notification *conditions* are computed today; delivery is simply not wired up.

---

## Files created

All 56 source files are new; nothing outside `/home/rani/team-ops-system` was modified.

**Configuration**
```
package.json  tsconfig.json  .env.example  .env  .gitignore  README.md
```

**Domain — pure logic (5)**
```
src/domain/enums.ts           closed vocabularies: status, priority, role, flags
src/domain/types.ts           entity shapes
src/domain/status-machine.ts  legal transitions, manager-only reopen
src/domain/exceptions.ts      OVERDUE / DUE_SOON / NO_RECENT_UPDATE / BLOCKED + attention score
src/domain/permissions.ts     capabilities, task field policy, visibility
```

**Shared library (4)**
```
src/lib/dates.ts     calendar maths, working-day arithmetic, week bounds
src/lib/errors.ts    typed AppError with HTTP status mapping
src/lib/ids.ts       UUIDs, session tokens, human-readable task refs
src/lib/validate.ts  typed schema validator (zero-dependency)
```

**Data (4 + 1 dataset)**
```
src/db/schema.sql     15 tables
src/db/connection.ts  node:sqlite wrapper + transaction helper
src/db/migrate.ts     idempotent schema application
src/db/seed.ts        seed runner
src/seed/demo-data.ts DEMO DATA — declarative, imported by nothing but the runner
```

**Repositories (5)** — `user`, `hierarchy`, `task`, `activity`, `deadline`
**Services (4)** — `auth`, `project`, `task`, `dashboard`
**Integrations (3)** — `types` (ports), `noop/index`, `registry`
**API (6)** — `http`, `router`, `routes/{auth,project,task,dashboard}`
**Server (1)** — `src/server.ts`

**Frontend (15)**
```
public/index.html  public/styles.css
public/js/{app,api,ui}.js
public/js/views/{login,manager,employee,task-list,task-detail,create-task,
                 milestones,team,activity}.js
```

**Tests (9)** — `dates`, `status-machine`, `exceptions`, `permissions`, `validate`,
`task-service`, `dashboard`, `api`, plus `helpers.ts`

---

## Database schema

```
users ─────────┬──< projects(lead) ──< workstreams ──< milestones ──< deliverables
               │                                                           │
               ├──< tasks(owner)                                           │
               ├──< tasks(reviewer)                                        │
               ├──< tasks(created_by)        tasks ─────────────────────────┘
               ├──< task_supporters >── tasks     (many-to-many)
               ├──< task_history ──> tasks
               ├──< comments ──> tasks
               ├──< deadline_change_requests ──> tasks
               └──< sessions

tasks ──< task_day_plans                       (one row per day of a multi-day task)
tasks ──< task_day_logs                        (what each day actually produced)
tasks ──< task_dependencies >── tasks          (self-referencing, acyclic)
tasks ──< task_external_links                  (Layer 2+, unused today)
projects ──  task_ref_sequences                (per-project ref counter)
```

| Table | Purpose |
| --- | --- |
| `users` | People and their role (`manager` / `employee`) |
| `sessions` | Bearer tokens with expiry |
| `projects` / `workstreams` / `milestones` / `deliverables` | The hierarchy |
| `tasks` | Every actionable item — see below |
| `task_supporters` | Supporting members (the single owner stays on `tasks`) |
| `task_day_plans` | What each day of a multi-day task delivers |
| `task_day_logs` | What each day actually produced, reported by whoever did the work |
| `task_dependencies` | "must land before"; cycle-checked in the service layer |
| `task_ref_sequences` | Per-project counter behind `AD-MAN-001` |
| `task_history` | Append-only activity log |
| `comments` | Discussion thread per task |
| `deadline_change_requests` | Employee request → manager decision |
| `task_external_links` | Generic Drive/GitHub/Calendar links (Layer 2+) |
| `schema_meta` | Schema version |

`tasks` columns: `id`, `ref`, `milestone_id`, `deliverable_id`, `title`, `description`,
`owner_id`, `reviewer_id`, `priority`, `status`, `progress`, `start_date`, `due_date`,
`original_due_date`, `blocker`, `next_action`, `evidence_url`, `created_by_id`, `created_at`,
`last_updated_at`, `completed_at`.

Integrity is enforced in the database, not only in code: `CHECK` constraints pin `status`,
`priority`, `role` and `progress` (0–100) to their vocabularies, `CHECK (due_date >= start_date)`
and `CHECK (task_id <> depends_on_task_id)` hold structurally, and foreign keys are `ON`.

**Task references** are human-readable and unique: `AD-MAN-001`, `AD-PER-002`, `AD-HW-003` —
project code, workstream code, and a sequence that runs across the whole project. The counter
is incremented inside the same transaction as the insert, so concurrent creation cannot
collide.

**`original_due_date`** is never overwritten, including by approved deadline changes. Slippage
against the first commitment therefore stays measurable however many extensions are granted.

### Task scheduling rules

Dates are not the manager's to set. The manager budgets **effort**; the owner proposes the
days that spend it; the reviewer agrees them. The rules live together in
`src/domain/task-schedule.ts`, so the service, the API and the forms enforce one definition
rather than three drifting copies.

1. **A task carries an effort budget, in working days** (`MAX_TASK_EFFORT_DAYS`, default 5).
   Required at creation. Work needing longer is not a task; it is a milestone that has to be
   broken down. Weekends spend none of a budget, because "three days of effort" means three
   days worked.
2. **The owner proposes the dates.** A proposed window may not spend *more* working days than
   the budget — that is what a budget means. It may spend fewer: finishing three days of work
   in two is nobody's problem but the owner's. Needing more is what the extension flow is for.
3. **The reviewer agrees them, and then they lock.** Until they are agreed, work cannot start
   at all — so an unanswered proposal is somebody sitting idle, which is why
   `SCHEDULE_AWAITING_REVIEW` outranks a merely stale update on the dashboard. A manager can
   agree a schedule too, so an absent reviewer never deadlocks a task.
4. **Locked dates move only through an approved deadline extension** — including for a manager,
   who would otherwise leave no trace. The extension raises `effort_days` to match the new
   window while `original_effort_days` and `original_due_date` keep the first estimate, so both
   the current budget and the slippage against the original stay readable.
5. **Every day of a multi-day task states its outcome.** A two-day task is two checkable
   outcomes, not one vague block of time — one row per calendar day in `[start_date, due_date]`,
   stored in `task_day_plans`. A single-day task needs none: the task is its own outcome.

Day outcomes are deliberately **not** locked with the dates. They say what each agreed day
delivers rather than when the work happens, and an approved extension leaves new days owing
one; sealing them would open a gap with no way to close it. Rescheduling keeps the outcomes
still inside the new dates and raises `MISSING_DAY_OUTCOMES` for the rest rather than inventing
text for them.

**Dates live on tasks and nowhere else.** A milestone has no `start_date`, `end_date` or
`target_date` at all — only `timeline_label`, the plan's own relative wording such as
`"W1 - W2"`. A deliverable's `due_date` is nullable and set only once a real deadline is agreed.
A milestone is a named outcome with work underneath it; the calendar comes from that work, once
someone is accountable for it.

**A task with no dates is a normal state, not a defect.** `start_date` and `due_date` are
nullable and carry `SCHEDULE_NOT_SET` until the owner proposes them. Imported rows are dated
according to what their source actually established:

| Source | How it is dated |
|---|---|
| Build timeline (28 tasks) | Derived from `AUTODOCK_W1_START` — the plan states a schedule in relative weeks, so these arrive **agreed and locked**, with the budget read back out of the window |
| Daily log (56 tasks) | The day the row was logged stands at **both** ends, and these arrive **unscheduled**: the log records when a task was raised, not when it is due, and a stand-in is not an agreement. Every open row carries a `MISSING_DUE_DATE` clarification asking for a real one |
| Deliverables | Never dated by an import. `due_label` keeps the plan's own wording (`by W1`) where it gave one, which is a statement about the plan rather than a deadline anyone agreed |
| Milestones | Never dated, from either source. The build timeline's week range survives verbatim in `timeline_label` |
| Supply orders | Still dated, and deliberately: an 8-week lead time is only chaseable against a real calendar. The order-by date comes from the plan's stated week, or is worked back from the needed-by date |

What the source failed to establish still becomes a clarification rather than a silent guess —
the record now just carries a flagged stand-in instead of a null.

---

## How to run

Requires **Node.js ≥ 22.6** (24 recommended — this was built and tested on 24.19).

```bash
cd /home/rani/team-ops-system

npm install          # installs typescript + @types/node (dev-only)
cp .env.example .env # already done; adjust if you like
npm run setup        # create the schema and load the AutoDock project data
npm start            # http://127.0.0.1:4000
```

Open **http://127.0.0.1:4000** and pick a user. **Each person has their own passcode** — the
seed prints them all when it runs, under "Sign in as". A seeded demo passcode is the email's
local part with `123` on the end, so `demo.manager@example.com` signs in with `demomanager123`.
Rani is the manager; Firaz, Ashutosh, Mallikarjun and Faizan are employees.

A manager sets a passcode when adding someone on the **Team** screen, and can replace anybody's
from the same row. Nothing can read one back: only a scrypt hash with a per-user salt is stored,
so a forgotten passcode is replaced rather than recovered.

### Starting from nothing

A fresh install has no users, so the login screen offers to create the first **manager** instead
of an empty picker. From there the **Plan** screen builds the hierarchy by hand:

```
Plan  →  create the project
      →  add workstreams      (Mechanical Design, Procurement, …)
      →  add milestones       inside each workstream — named outcomes, no dates
      →  add deliverables and long-lead orders
Team  →  add the rest of the team, as managers or employees
Tasks →  create tasks, assign owners in bulk
```

Structure can be renamed and deleted afterwards. A delete **refuses** while anything hangs off the
node, naming what is in the way, rather than cascading and taking a month of tasks with it.

### Access from another machine

`HOST=0.0.0.0` in `.env` binds every interface; the server prints the address others use:

```
▸ UI  http://localhost:4000/
▸ On this network:  http://192.168.29.163:4000/
```

> **Security.** Before more than one machine uses this, do three things: turn on TLS, check
> backups are running, and change `AUTH_JOIN_CODE` from its default. The first two are one
> command each — see below. The login screen still lists who exists, which is deliberate for an
> internal tool. See Known Limitations for what is still missing.

### Running it for a team

**1. Encrypt the traffic.** Without TLS every passcode and every session token crosses the
network as readable text, and a token is the whole account for 12 hours — replayable by anyone
who saw it.

```bash
npm run tls:selfsigned      # certificate for this machine's addresses
# then in .env:
#   TLS_CERT_PATH=./certs/cert.pem
#   TLS_KEY_PATH=./certs/key.pem
npm start                   # now serves https://
```

The script creates a small local certificate authority (`certs/ca.pem`) once, then issues the
server's certificate from it. **Import `ca.pem` into each machine's browser once** and the
warning stops for good — including after this machine's IP changes, because re-running the
script reuses the same authority.

```
Chrome:  Settings → Privacy and security → Security → Manage certificates
         → Authorities → Import → ca.pem → tick "identifying websites"
Firefox: Settings → Privacy & Security → View Certificates → Authorities
```

Without that import you get `ERR_CERT_AUTHORITY_INVALID` and have to click through each time.
The warning is about *identity* — whether the browser can vouch for who the server is — not
encryption; traffic is protected either way.

**Use the name, not the address.** The certificate covers `<hostname>.local`, so
`https://rani-OMEN.local:4000/` keeps working when DHCP moves the machine to a different IP.
An address in the URL means a new certificate every time the network changes. Re-run
`npm run tls:selfsigned` after any such move, or pass extra names:
`npm run tls:selfsigned teamops.local`.

For a setup with no certificate management at all, run Caddy in front instead
([deploy/Caddyfile](deploy/Caddyfile)) and set `HOST=127.0.0.1` so nothing reaches the app
except through the proxy.

**2. Keep backups.** There is one database file and losing it is permanent.

```bash
npm run backup                     # snapshot now, keeping the last 14
npm run backup -- --keep=30 --dir=/mnt/nas/teamops
```

It uses SQLite's `VACUUM INTO`, so it is safe to run against a live server. Schedule it:

```cron
0 * * * * cd /path/to/team-ops-system && node --env-file-if-exists=.env scripts/backup.ts >> logs/backup.log 2>&1
```

A snapshot on the same disk survives a mistake, not a dead drive — point `--dir` at another
machine. **To restore:** stop the server and copy a snapshot over `data/team-ops.db`.

**3. Never put `data/team-ops.db` in Dropbox, Google Drive or on a network share,** and never
point two server processes at it. SQLite's locking does not survive that and the result is
corruption, not an error. One host, one process, local disk — copy *snapshots* elsewhere.

**Guessing is throttled.** Five failed attempts on one email, or twenty from one address, and
further attempts are refused for 15 minutes (`AUTH_MAX_FAILURES_PER_EMAIL`,
`AUTH_MAX_FAILURES_PER_IP`, `AUTH_LOCKOUT_MINUTES`). A correct passcode clears the count, so a
bad morning does not lock anyone out. Every attempt, success or failure, lands in `auth_events`
along with passcode resets and role changes.

**Credential changes end sessions.** Resetting somebody's passcode, or changing their role,
signs them out everywhere immediately rather than leaving the old session valid for the rest of
its 12 hours.

### Datasets

Real project data and demo data are kept strictly apart — one dataset per database,
recorded in the database and shown as a banner in the UI.

| Command | Loads |
| --- | --- |
| `npm run setup` / `npm run seed:reset` | `AUTO_DOCK` — the Stream 1 build plan |
| `node src/db/seed.ts --dataset=AUTO_DOCK_WITH_LOG --reset` | the plan plus the historical daily task log |
| `npm run seed:demo` | `DEMO` — synthetic data for development and tests |
| `npm run import:report` | the data-quality report for whatever is loaded |

| Script | Action |
| --- | --- |
| `npm run setup` | Migrate + load the AutoDock dataset |
| `npm start` | Run the server |
| `npm run dev` | Run with auto-restart on change |
| `npm test` | Full test suite |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run check` | Type check **and** tests |
| `npm run seed:reset` | Wipe and reload the AutoDock dataset |
| `npm run seed:demo` | Wipe and reload the demo dataset |
| `npm run import:report` | Print what the import could not determine |

**Supply register.** The plan's long-lead items are dated records, not notes: `GET /api/supply`
reports how long is left to place each order and whether it will still arrive in time. The API,
rules and table are intact; the screen that rendered them has been removed.

**Bulk assignment.** Managers can tick rows on the Tasks screen and set an owner and priority
across a whole workstream at once. It goes through the same field policy, history log and
clarification clearing as a single edit.

The build timeline is written in relative weeks. `AUTODOCK_W1_START` in `.env` anchors them to
the calendar; change it and re-run `npm run seed:reset` to move the whole plan.

All configuration lives in `.env` — port, database path, passcode, session lifetime, and the
exception thresholds (`DUE_SOON_DAYS`, `NO_UPDATE_WORKING_DAYS`, `DAILY_UPDATE_WORKING_DAYS`).
No secret or environment
value is hard-coded in source; `.env` is git-ignored.

### A two-minute tour

1. Sign in as **Rani** (manager) → the dashboard leads with counts, then
   `OVERDUE` / `BLOCKED` / `NO RECENT UPDATE` / `DUE WITHIN 2 DAYS`, then per-person roll-ups.
2. Check the **Requires clarification** card → each reason drills into **Tasks**, where the
   affected rows carry an accent edge and a *Gaps* count. Open one to fill the gap in.
3. Sign out, sign in as **Faizan** → *My work*, most urgent first. The team-wide
   tasks are gone; only their own are visible, and the **Plan** narrows to the
   workstreams they actually hold work in — the rest of the project is not listed at all.
4. Open a task, change the status, add a blocker, save → the change appears in the activity
   history and on the manager's exception list.
5. Try to change the due date as an employee → refused, pointing at the deadline-request flow.
6. Create a task with an effort budget and no dates → it carries `SCHEDULE_NOT_SET` and cannot
   be started. Sign in as its owner, propose dates, then as its reviewer, agree them — only
   then does work begin, and only the reviewer can later mark it complete.

---

## How to test

```bash
npm run check    # type check + 176 tests
```

Current state: **412 tests passing, 0 failing; `tsc --noEmit` clean.**
(176 Layer 1, 60 covering the AutoDock import, 49 rendering the frontend.)

```
tests/dates.test.ts           calendar maths, working days, week bounds
tests/status-machine.test.ts  every legal and illegal transition, manager-only reopen
tests/exceptions.test.ts      each rule at its boundary + flag combination + ranking
tests/permissions.test.ts     capabilities, field policy, visibility vs. update rights
tests/validate.test.ts        schema validation and error paths
tests/task-service.test.ts    creation, scoping, updates, history, dependencies, deadlines
tests/dashboard.test.ts       summaries, exception buckets, sorting, employee buckets
tests/api.test.ts             end-to-end over real HTTP, including the full workflow
tests/autodock-import.test.ts import fidelity, status mapping, provenance, and
                              — mostly — proof that nothing was invented
tests/ui-render.test.ts       every view executed for real under a stub DOM,
                              against a live API
tests/dom-stub.ts             the minimal DOM those tests run in
```

Each test runs against its own **in-memory** database seeded from the same dataset, so they
are isolated and leave no files behind.

Coverage maps to the Phase 4 checklist:

| Required check | Where |
| --- | --- |
| Role permissions | `permissions.test.ts`, plus HTTP 403s in `api.test.ts` |
| Task creation | `task-service.test.ts` — refs, uniqueness, validation |
| Scheduling rules | `task-service.test.ts` — required dates, the 3-day ceiling, per-day outcomes |
| Assignment | reassignment test + the history entry naming both people |
| Status transitions | all 7 legal and 7 illegal moves |
| Deadline calculations | `dates.test.ts`, `original_due_date` preservation |
| Overdue detection | boundary tests either side of today |
| No-update detection | including "a weekend does not age a task" |
| Activity history | asserted after every mutating operation |

The headline test, `api.test.ts` → *"create, assign, work, block, review, complete"*, walks
the exact flow from the brief over real HTTP: manager creates and assigns → employee sees it
on their board → starts work → is refused a blocked status without naming the blocker →
blocks it properly → manager finds it in the blocked bucket → unblock, review, complete →
the whole journey is in the history.

---

## Implemented features

**Hierarchy & data** — Project → Workstream → Milestone → Deliverable → Task, by relationship
rather than duplication. Every task carries all 18 required fields.

**Task scheduling** — both dates required, a three-day ceiling on any one task, and a stated
outcome for every day of a multi-day task, captured as the task is added. See
[Task scheduling rules](#task-scheduling-rules) for how the three hold together and which
limits imported records are exempt from.

**Roles** — three, split by what each one is answerable for: a manager plans the work, a
reviewer confirms what people commit to, an employee does it.

- *Manager*: create projects, workstreams, milestones, deliverables and tasks; assign owners;
  set priorities and effort budgets; reassign; change status; view all tasks; view overdue,
  blocked, stale and upcoming; review team-level progress; decide deadline requests.
- *Reviewer*: confirm the dates an owner proposes, sign off work submitted for review, and
  decide deadline-change requests — **on the tasks they are named the reviewer of, and only
  those**. The authority follows the accountability: one named person answers for each task's
  review. They read the whole board, including the team's load, because they cannot confirm
  what they cannot find.
- *Employee*: see only tasks they own, support or review; today / upcoming / overdue / blocked /
  awaiting review / recently completed; update status, progress, blocker, next action, comments
  and evidence links; propose their dates; request a deadline change; mark ready for review.
- A reviewer writes no more of a task than an employee does, and **cannot** create projects,
  workstreams, milestones or tasks, reassign work, bulk-assign or manage the team.
- Employees **cannot** change owner, project, milestone, priority, dates or day outcomes. The
  attempt is refused with a message pointing at the deadline-request flow.

Being a reviewer on a task and holding the reviewer *role* are still separate things: any
active user can be named a task's reviewer, which is what grants the per-task sign-off. The role
adds board-wide visibility and the right to decide extensions on those same tasks.

**Status machine** — exactly the five statuses, exactly the listed transitions, plus a
manager-only `Completed → In Progress` reopen (documented below). Completing sets progress to
100 and stamps `completed_at`; reopening clears it. A task cannot enter `Blocked` without a
blocker description — otherwise "what is blocked" would be a list without reasons.

**Daily outcome log** — an employee doing the work reports what each day produced into
`task_day_logs`, the counterpart to the `task_day_plans` that say what it was meant to
produce. One entry per person per day; re-submitting a day replaces it. Progress and
blockers raised there land on the task itself, so there is one number, not two that can
disagree. Only the owner and supporting members may write one, and only while the task is
in progress or blocked — a manager writing someone else's daily report is not accountability.

**Exception engine** — `OVERDUE`, `DUE SOON`, `NO RECENT UPDATE`, `BLOCKED`, `MISSING DAILY
UPDATE` as pure, threshold-
configurable functions. `NO RECENT UPDATE` counts **working days**, so Friday → Monday is one
day elapsed, not three. A task is never both overdue and due-soon; the more severe flag wins.

**Attention score** — ranks open work by urgency × priority so both dashboards lead with the
thing that matters most, rather than making the reader scan.

**Dashboards** — the manager's full summary (12 counts), four dedicated exception sections,
per-person roll-ups with each person's single most urgent task, upcoming deadlines and pending
deadline requests. The employee's board covers all seven required buckets with sorting by
priority, due date, status or importance.

**Activity history** — every change appends an entry with actor, field, before, after and a
note; comments refresh `last_updated_at`, which clears the stale flag.

**Deadline approval flow** — employee requests with a reason, manager approves or rejects,
only one open request per task, and `original_due_date` survives.

**Nine screens** — login/user selection, manager dashboard, employee dashboard, task list with
filters/search/sort, task detail, create task, milestones (by schedule or by workstream), team,
activity history. Every task row shows owner, title, due date with lateness, status, priority,
exception flags and the next action or blocker — the six things the brief asks to be
immediately visible.

**Safety** — all user content is rendered with `textContent`, never `innerHTML`; every query is
parameterised; static file serving is confined to `public/`; request bodies are capped at 1 MB.

---

## Access control

Four independent layers, each in one place.

| Layer | Where | What it decides |
|---|---|---|
| Authentication | `api/router.ts` | Resolves a bearer token to an `Actor` before any handler runs |
| Capability | `domain/permissions.ts` | May this **role** perform this kind of action at all |
| Scope | `domain/permissions.ts` + `services/project.service.ts` | Which workstreams and tasks **exist** for this person |
| Field policy | `domain/permissions.ts` | Which columns of a task this role may write |

On top of those sit three **relational** rules — about a person's relationship to one task,
which a role cannot express:

- **The reviewer** signs work off. Not the owner, not any manager-by-rank — the person assigned
  to that task (a manager too, so an absent reviewer never deadlocks it).
- **The owner** proposes dates and requests extensions; they are the one committing.
- **The owner and supporting members** report daily outcomes. A reviewer watches the work
  without doing it; a manager filing someone else's daily report would be putting words in
  their mouth.

A workstream an employee has no part in returns **404, not 403**. "Forbidden" would confirm it
exists, which is the thing being withheld.

Route capability is checked **before the request body is parsed**, so a caller who may not use
an endpoint is told that, rather than that their payload is malformed. The service checks it
again and remains authoritative.

---

## Known limitations

1. **Authentication is thin, though no longer shared or unguarded.** Each person has their own
   passcode, stored as a scrypt hash with its own salt; wrong email and wrong passcode fail
   identically; failures are throttled and logged; credential and role changes end sessions.
   What is still missing: password reset by email, passcode expiry or rotation, any second
   factor, SSO, and an idle timeout — a session lasts its full 12 hours whether or not anyone is
   using it. The login screen also still lists who exists, deliberately, because this is an
   internal tool. The seam is clean: `src/services/auth.service.ts` and `src/lib/passcode.ts`
   are the only files to change, because routes only ever see an `Actor`.
2. **Edits are checked for conflicts, not merged.** A task update may carry the
   `lastUpdatedAt` the editor was looking at; if somebody else saved first, the write is refused
   with a 409 naming them rather than overwriting their change. The screen sends it, so the
   protection is on for anything edited by hand. Bulk assignment and the importers deliberately
   omit it — they are not editing somebody's open screen. There is still no live refresh: the
   board does not update until you reload it.
3. **TLS is available but off by default.** Set `TLS_CERT_PATH` and `TLS_KEY_PATH` (see
   "Running it for a team") or put Caddy in front. Until you do, traffic is readable on the
   network. There is no CSRF surface — auth is a bearer token, not a cookie — but that token
   lives in `localStorage`, so an XSS would hand over the account; the CSP exists to make that
   much harder.
4. **Transitions are relational, not role-based.** `Review → Completed` and `Review → In
   Progress` require the task's assigned reviewer, because an owner signing off their own work
   is not review. Both exits are gated: gating only the exit to Completed would let an owner
   withdraw from review and walk the task to Completed the long way round. `Completed → In
   Progress` is manager-only, because work closed in error otherwise has no route back.
5. **Dashboard aggregation happens in memory.** Tasks are loaded and the rules evaluated in
   TypeScript rather than SQL. This is deliberate — one source of truth for the rules — and is
   comfortable into the low thousands of tasks. Past that, push the counts into SQL while
   keeping `domain/exceptions.ts` authoritative for single-task decisions.
6. **Nothing has a priority and the 28 planned tasks have no owner** — because neither source
   document states them. The 56 historical tasks state no deadline either; since dates are
   mandatory they carry the log's own date as a flagged stand-in, so the deadline engine is live
   for them but measuring against a date nobody committed to. Every affected task is marked in
   **Tasks** and reachable via the *Needs clarification* filter. See [AUTODOCK.md](AUTODOCK.md) §C.
7. **"Today" is the server's local date.** There is no per-user timezone; a distributed team
   would need one.
8. **Working days ignore public holidays.** Only Saturday and Sunday are skipped.
9. **SQLite single-writer.** Right for this scale; a busy multi-writer deployment would want
   PostgreSQL. Only `src/db/` and the repositories would change.
10. **No pagination.** Task lists return everything matching the filter.
11. **No soft delete or archiving of tasks.** Projects have an `archived` flag that the UI does
   not yet expose.
12. **Frontend coverage is smoke-level.** `tests/ui-render.test.ts` executes every view against
    a live API under a minimal DOM stub, which catches render-time errors and null handling.
    A few handlers are driven directly — the add-member form, and the date changes that build
    the per-day outcome inputs — but most interaction is not: clicks, routing and the bulk of
    form submission are not exercised.

---

## Next recommended layer

**Layer 2 — Automation and notifications**, because it is the highest-value step and the
exception engine already produces everything it needs.

1. **Scheduled rule evaluation** — a job that runs `evaluateTask` across open work on a
   schedule. No new rules to write; call the existing pure functions.
2. **Notification delivery** — implement `Notifier` for email and Google Chat, register it in
   `registry.ts`, flip `NOTIFICATIONS_ENABLED`. Add a `notification_log` table so nobody is
   told the same thing twice.
3. **A daily manager digest and a per-employee morning summary** — the dashboard read models
   already return exactly these shapes.

Then, in rough priority order:

- **Google Drive** — implement `StorageProvider`, write into `task_external_links`, auto-create
  a per-task evidence folder.
- **GitHub** — implement `IssueTracker`; move a task to Review when its PR is opened.
- **Google Calendar** — implement `CalendarProvider` for deadlines and review meetings.
- **Real authentication** — SSO or per-user credentials, replacing `auth.service.ts`.
- **Reporting** — velocity, slippage against `original_due_date`, and time-in-status, which
  `task_history` already records.

---

## Demo data

Loaded by `npm run seed:demo`, labelled **DEMO DATA** in the UI banner and in the dataset itself.
It is kept because the real imported data states no deadlines of its own — what it carries are
derived stand-ins — so it exercises none of the committed-deadline paths that the demo dataset
does.

4 users (1 manager, 3 employees) · 2 projects (AutoDock, Warehouse Automation) ·
8 workstreams across the two (Hardware, Manipulation, Perception, Navigation, Software,
Testing, Procurement) · 8 milestones · 4 deliverables · **15 tasks** · 63 history entries ·
4 comments · 1 pending deadline request.

The 15 tasks deliberately cover every state worth demonstrating: completed, in progress,
blocked, overdue, due today, due within two days, awaiting review, not started, with
dependencies, with evidence links, and with no recent update.

Every demo task also obeys the scheduling rules the app enforces — none runs longer than three
days, and the multi-day ones carry an outcome per day — so the demo never shows work the system
would refuse. The pending deadline request is deliberately one a manager can approve: doing so
stretches a one-day task to three, and the two days it adds land on the clarification queue
needing an outcome each.

Dates are stored as **offsets from the day you seed**, so the demo keeps showing live overdue
and due-today tasks whenever it is loaded. `npm run seed:reset` refreshes them.

Real project data lives separately in `src/seed/autodock-data.ts` and loads through
`src/seed/autodock-loader.ts`. Neither is imported by anything in `domain/`, `services/`,
`repositories/` or `api/`, and no demo or real name, email or task appears in any business rule.

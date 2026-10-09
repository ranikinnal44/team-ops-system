-- ---------------------------------------------------------------------------
-- Team Ops System — Layer 1 schema
--
-- Hierarchy: Project > Workstream > Milestone > Deliverable > Task
-- Relationships are used throughout; no denormalised copies of names or codes
-- are stored on tasks (the read models join for them instead).
-- ---------------------------------------------------------------------------

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  name        TEXT    NOT NULL,
  email       TEXT    NOT NULL UNIQUE,
  role        TEXT    NOT NULL CHECK (role IN ('manager', 'reviewer', 'employee')),
  title       TEXT,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  -- Each person's own passcode, as a scrypt hash with its own salt. Nullable
  -- only so an account can exist before one is set; a NULL cannot sign in.
  passcode_hash    TEXT,
  passcode_set_at  TEXT,
  created_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Who got in, who failed, and whose credentials changed. Also the throttle's
-- memory: failures are counted from here, so restarting the server does not
-- hand an attacker a fresh allowance.
CREATE TABLE IF NOT EXISTS auth_events (
  id         TEXT PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN (
               'login_success', 'login_failure', 'throttled', 'logout',
               'bootstrap', 'passcode_reset', 'role_change')),
  -- The address that was TRIED. Kept even when it belongs to nobody, because
  -- which addresses are being guessed is itself the signal.
  email      TEXT,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  ip         TEXT,
  detail     TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_events_email ON auth_events(email, created_at);
CREATE INDEX IF NOT EXISTS idx_auth_events_ip    ON auth_events(ip, created_at);
CREATE INDEX IF NOT EXISTS idx_auth_events_time  ON auth_events(created_at);

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  code        TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  description TEXT,
  lead_id     TEXT    REFERENCES users(id) ON DELETE SET NULL,
  archived    INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS workstreams (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  created_at  TEXT NOT NULL,
  UNIQUE (project_id, code)
);
CREATE INDEX IF NOT EXISTS idx_workstreams_project ON workstreams(project_id);

CREATE TABLE IF NOT EXISTS milestones (
  id             TEXT PRIMARY KEY,
  workstream_id  TEXT NOT NULL REFERENCES workstreams(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  description    TEXT,
  -- A milestone carries NO calendar dates. Dates belong to tasks, and only once
  -- someone is accountable for one: the owner proposes the days that spend
  -- their effort budget and the reviewer agrees them. A date here would be a
  -- commitment nobody made.
  --
  -- The plan's own relative schedule is kept verbatim, e.g. "W1 - W2". It is
  -- the source's wording, not a calendar claim, and survives re-anchoring.
  timeline_label TEXT,
  -- Long-lead items and external dependencies, one per line. These are
  -- constraints and risks ("VFD procurement - 8 week", "Vendor delays"),
  -- not task-to-task dependencies, so they are not forced into that table.
  long_lead_items TEXT,
  source_ref     TEXT,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_milestones_workstream ON milestones(workstream_id);

CREATE TABLE IF NOT EXISTS deliverables (
  id            TEXT PRIMARY KEY,
  milestone_id  TEXT NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  description   TEXT,
  -- An outcome of its milestone, so it carries no date of its own either.
  -- `due_label` keeps whatever the plan said, e.g. "by W1"; `due_date` is set
  -- only where a real calendar deadline has been agreed, which for an imported
  -- outcome is never.
  due_label     TEXT,
  due_date      TEXT,
  -- Flagged in the source as a critical long-lead or risk item.
  critical      INTEGER NOT NULL DEFAULT 0 CHECK (critical IN (0, 1)),
  source_ref    TEXT,
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deliverables_milestone ON deliverables(milestone_id);

CREATE TABLE IF NOT EXISTS tasks (
  id                TEXT PRIMARY KEY,
  ref               TEXT    NOT NULL UNIQUE,

  -- Workstream is the direct parent. Milestone and deliverable are OPTIONAL:
  -- imported work often has no milestone established yet, and inventing one
  -- would put false structure into the tracker.
  workstream_id     TEXT    NOT NULL REFERENCES workstreams(id) ON DELETE RESTRICT,
  milestone_id      TEXT    REFERENCES milestones(id) ON DELETE SET NULL,
  deliverable_id    TEXT    REFERENCES deliverables(id) ON DELETE SET NULL,

  title             TEXT    NOT NULL,
  description       TEXT,
  -- NULL owner means "not assigned yet". A single accountable owner is still
  -- the model; planned work that nobody has been given simply says so rather
  -- than being parked on whoever imported it.
  owner_id          TEXT    REFERENCES users(id) ON DELETE RESTRICT,
  reviewer_id       TEXT    REFERENCES users(id) ON DELETE SET NULL,

  -- NULL priority means "needs assignment" rather than a guessed P-value.
  priority          TEXT    CHECK (priority IS NULL OR priority IN ('P0', 'P1', 'P2', 'P3')),
  status            TEXT    NOT NULL CHECK (status IN ('not_started', 'in_progress', 'blocked', 'review', 'completed')),

  -- NULL progress means "unknown", which is not the same as 0%.
  progress          INTEGER CHECK (progress IS NULL OR progress BETWEEN 0 AND 100),
  -- Qualitative progress straight from the source, e.g. "70-80% Done".
  progress_note     TEXT,

  -- The manager's budget, in WORKING days. Dates are not the manager's to set:
  -- they budget the effort, the owner proposes the days that spend it and the
  -- reviewer agrees them.
  effort_days          INTEGER CHECK (effort_days IS NULL OR effort_days >= 1),
  -- The first estimate. Never changed, so slippage against it stays measurable
  -- even after an extension raises `effort_days`.
  original_effort_days INTEGER CHECK (original_effort_days IS NULL OR original_effort_days >= 1),

  schedule_state          TEXT NOT NULL DEFAULT 'unset'
    CHECK (schedule_state IN ('unset', 'proposed', 'locked')),
  schedule_proposed_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  schedule_proposed_at    TEXT,
  schedule_approved_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  schedule_approved_at    TEXT,
  schedule_review_note    TEXT,

  -- Nullable until the owner proposes them. A budgeted task with no dates is a
  -- normal, visible state (SCHEDULE_NOT_SET), not a defect.
  start_date        TEXT,
  due_date          TEXT,
  original_due_date TEXT,
  -- The date the task carried in its source record (e.g. a daily task log).
  -- This is NOT a deadline and must never be treated as one.
  source_date       TEXT,

  blocker           TEXT,
  next_action       TEXT,
  evidence_url      TEXT,
  review_note       TEXT,

  -- Provenance: 'app' for work created in the system, 'import' for records
  -- loaded from an external source, whose raw values are kept verbatim.
  origin            TEXT    NOT NULL DEFAULT 'app' CHECK (origin IN ('app', 'import')),
  source_ref        TEXT,
  source_status     TEXT,
  source_owner_label TEXT,
  -- Relative schedule the task came from, e.g. "W4 - W6".
  source_timeline   TEXT,

  created_by_id     TEXT    REFERENCES users(id) ON DELETE RESTRICT,
  created_at        TEXT    NOT NULL,
  last_updated_at   TEXT    NOT NULL,
  completed_at      TEXT,

  CHECK (due_date IS NULL OR start_date IS NULL OR due_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_tasks_owner     ON tasks(owner_id);
CREATE INDEX IF NOT EXISTS idx_tasks_milestone ON tasks(milestone_id);
CREATE INDEX IF NOT EXISTS idx_tasks_workstream ON tasks(workstream_id);
CREATE INDEX IF NOT EXISTS idx_tasks_origin    ON tasks(origin);
CREATE INDEX IF NOT EXISTS idx_tasks_status    ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due       ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_schedule  ON tasks(schedule_state);

-- Per-day outcomes for a multi-day task.
--
-- A task may span at most a few calendar days, and when it spans more than one
-- the person adding it has to say what each day is meant to produce — so a
-- two-day task is two checkable outcomes, not one vague block of time. One row
-- per calendar day in [start_date, due_date]; a single-day task needs none.
--
-- The span limit itself is enforced in the service layer, not here: imported
-- records carry whatever their source said and must not be rejected at write.
CREATE TABLE IF NOT EXISTS task_day_plans (
  task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  day_date TEXT NOT NULL,
  outcome  TEXT NOT NULL,
  PRIMARY KEY (task_id, day_date)
);
CREATE INDEX IF NOT EXISTS idx_task_day_plans_date ON task_day_plans(day_date);

-- What a day ACTUALLY produced, written by the person doing the work.
--
-- `task_day_plans` is the commitment; this is the report against it. They are
-- deliberately separate tables: the plan is authored once by whoever scheduled
-- the task, the log accumulates daily from whoever is doing it, and a day that
-- was never planned can still be reported on.
--
-- One row per person per task per calendar day. Re-submitting the same day
-- replaces that day's entry rather than appending a second one, so "today's
-- update" always has a single answer.
CREATE TABLE IF NOT EXISTS task_day_logs (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id)  ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES users(id)  ON DELETE RESTRICT,
  log_date   TEXT NOT NULL,
  outcome    TEXT NOT NULL,
  -- Nullable: "here is what I did" does not oblige anyone to put a number on it.
  progress   INTEGER CHECK (progress IS NULL OR progress BETWEEN 0 AND 100),
  blocker    TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (task_id, author_id, log_date)
);
CREATE INDEX IF NOT EXISTS idx_task_day_logs_task ON task_day_logs(task_id, log_date);
CREATE INDEX IF NOT EXISTS idx_task_day_logs_date ON task_day_logs(log_date);

-- Supporting members: many-to-many, the single accountable owner stays on tasks.
CREATE TABLE IF NOT EXISTS task_supporters (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_task_supporters_user ON task_supporters(user_id);

CREATE TABLE IF NOT EXISTS task_dependencies (
  task_id            TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id)
);
CREATE INDEX IF NOT EXISTS idx_task_deps_target ON task_dependencies(depends_on_task_id);

-- Per-project counter backing human-readable refs: AD-MAN-001, AD-PER-002,
-- AD-HW-003 — the sequence runs across the whole project, the middle segment
-- names the workstream. Incremented in the same transaction as the insert.
CREATE TABLE IF NOT EXISTS task_ref_sequences (
  project_id    TEXT    NOT NULL PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  next_sequence INTEGER NOT NULL DEFAULT 1
);

-- `actor_id` is NULL for entries that did not originate from a person acting
-- inside the application -- imported history must not imply that a real user
-- performed the change here.
CREATE TABLE IF NOT EXISTS task_history (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor_id   TEXT REFERENCES users(id) ON DELETE RESTRICT,
  actor_label TEXT,
  source     TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'import')),
  kind       TEXT NOT NULL,
  field      TEXT,
  from_value TEXT,
  to_value   TEXT,
  note       TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_task ON task_history(task_id, created_at);

CREATE TABLE IF NOT EXISTS comments (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id  TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_task ON comments(task_id, created_at);

CREATE TABLE IF NOT EXISTS deadline_change_requests (
  id                 TEXT PRIMARY KEY,
  task_id            TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  requested_by_id    TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  current_due_date   TEXT NOT NULL,
  requested_due_date TEXT NOT NULL,
  reason             TEXT NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
  decision_note      TEXT,
  created_at         TEXT NOT NULL,
  decided_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_deadline_requests_task   ON deadline_change_requests(task_id);
CREATE INDEX IF NOT EXISTS idx_deadline_requests_status ON deadline_change_requests(status);

-- ---------------------------------------------------------------------------
-- Integration readiness (Layer 2+). Nothing writes to this table in Layer 1.
--
-- A single generic link table rather than provider-specific columns on `tasks`,
-- so adding Drive / GitHub / Calendar later needs no schema migration of the
-- task table itself:
--   provider    'google_drive' | 'github' | 'google_calendar' | ...
--   kind        'document' | 'folder' | 'issue' | 'pull_request' | 'commit' |
--               'repository' | 'meeting' | 'deadline' | 'review_meeting' | ...
--   external_id provider-native identifier (document ID, folder ID, issue no.)
--   metadata    provider-specific JSON blob
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_external_links (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  provider    TEXT NOT NULL,
  kind        TEXT NOT NULL,
  external_id TEXT,
  url         TEXT,
  metadata    TEXT,
  created_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  UNIQUE (task_id, provider, kind, external_id)
);
CREATE INDEX IF NOT EXISTS idx_external_links_task ON task_external_links(task_id);

-- ---------------------------------------------------------------------------
-- Data-quality queue.
--
-- When a value cannot be established from a source record, the importer does
-- NOT guess: it records a clarification here for a manager to resolve. This is
-- what keeps "unknown" distinguishable from "decided".
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_clarifications (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  detail      TEXT NOT NULL,
  resolved    INTEGER NOT NULL DEFAULT 0 CHECK (resolved IN (0, 1)),
  resolved_by_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TEXT,
  created_at  TEXT NOT NULL,
  UNIQUE (task_id, code)
);
CREATE INDEX IF NOT EXISTS idx_clarifications_task     ON task_clarifications(task_id);
CREATE INDEX IF NOT EXISTS idx_clarifications_resolved ON task_clarifications(resolved, code);

-- ---------------------------------------------------------------------------
-- Supply register.
--
-- A plan's long-lead items are the things that sink a schedule quietly: an
-- order placed a week late arrives a week late, and nothing else can move.
-- Holding them as free text on a milestone means nothing can watch them, so
-- they become dated records here.
--
-- `kind` separates the two sorts of entry the source mixes together:
--   'order' — something with a lead time that must be placed by a date
--   'risk'  — a constraint with no order to place ("Vendor delays")
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS supply_items (
  id              TEXT PRIMARY KEY,
  milestone_id    TEXT NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
  label           TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('order', 'risk')),

  lead_time_weeks INTEGER,
  -- When the order has to be placed. Either stated by the plan or worked back
  -- from when it is needed; `order_by_derived` records which.
  order_by_date   TEXT,
  order_by_derived INTEGER NOT NULL DEFAULT 0 CHECK (order_by_derived IN (0, 1)),
  -- The latest it can arrive and still be usable.
  needed_by_date  TEXT,
  -- Milestone that consumes it, when the plan says.
  needed_by_milestone_id TEXT REFERENCES milestones(id) ON DELETE SET NULL,

  status          TEXT NOT NULL DEFAULT 'not_ordered'
                  CHECK (status IN ('not_ordered', 'ordered', 'received', 'not_needed')),
  -- Filled in when someone actually places or receives it.
  ordered_on      TEXT,
  received_on     TEXT,
  owner_id        TEXT REFERENCES users(id) ON DELETE SET NULL,

  critical        INTEGER NOT NULL DEFAULT 0 CHECK (critical IN (0, 1)),
  note            TEXT,
  source_text     TEXT,
  source_ref      TEXT,
  created_at      TEXT NOT NULL,
  last_updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_supply_milestone ON supply_items(milestone_id);
CREATE INDEX IF NOT EXISTS idx_supply_status    ON supply_items(kind, status);

CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

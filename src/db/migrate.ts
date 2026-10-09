/**
 * Applies the schema to the configured database file.
 *
 * The schema is written with `CREATE TABLE IF NOT EXISTS`, so running this is
 * idempotent and safe on an existing database. Layer 1 has a single schema
 * version; `schema_meta` is where incremental migrations will be tracked.
 */
import { openDatabase, readSchema, transaction } from './connection.ts';
import { applyInPlaceMigrations } from './migrations.ts';
import { config } from '../config/index.ts';
import { nowTimestamp } from '../lib/dates.ts';

export const SCHEMA_VERSION = '11';

/**
 * Schema 11 added `auth_events`: the authentication audit trail, and the
 * memory the login throttle counts failures out of. Purely additive, so
 * `CREATE TABLE IF NOT EXISTS` in the schema file brings a v10 database up to
 * date with nothing to do here.
 *
 * Schema 10 gave every user their own passcode (`passcode_hash`, a scrypt hash
 * with a per-user salt) in place of one shared `AUTH_PASSCODE`. Accounts that
 * predate it are backfilled with that shared code so nobody is locked out by
 * the upgrade; the shared value survives only as the join code that authorises
 * bootstrapping the first Task Assigner.
 *
 * Schema 9 added the `reviewer` role to the `users.role` vocabulary. SQLite
 * cannot widen a CHECK in place, so the table is rebuilt from `schema.sql`.
 *
 * Schema 8 took calendar dates off milestones entirely — `target_date`,
 * `start_date` and `end_date` are dropped, leaving `timeline_label` as the
 * plan's own relative wording — and made `deliverables.due_date` nullable
 * again. Dates now exist only on a task, agreed between its owner and its
 * reviewer. Both are table rebuilds, applied in place by `migrations.ts`.
 *
 * Schema 7 moved scheduling: a Task Assigner now sets an effort budget in working
 * days and the owner proposes the dates that spend it, so `start_date` and
 * `due_date` became nullable again (reversing v5) and the task gained
 * `effort_days`, `original_effort_days` and the `schedule_*` columns.
 *
 * Everything from v3 onwards is now migrated IN PLACE by `migrations.ts`,
 * including the constraint changes SQLite cannot apply directly — those rebuild
 * the table rather than refusing it. Only a pre-v3 database is turned away, and
 * only because its shape has nothing to derive the current one from.
 *
 * Schema 6 added `task_day_logs` — what a day actually produced, as reported
 * by whoever did the work, alongside the `task_day_plans` that say what it was
 * meant to produce. Purely additive, so the `CREATE TABLE IF NOT EXISTS` in the
 * schema file brings a v5 database up to date with nothing to do here.
 *
 * Schema 5 made start and end dates mandatory on tasks, milestones and
 * deliverables. SQLite cannot add a NOT NULL constraint in place, and a v4
 * database may hold undated rows with nothing to derive a date from, so the
 * old shape is detected and refused rather than half-applied.
 *
 * Schema 4 added `task_day_plans`. That one is purely additive, so the
 * `CREATE TABLE IF NOT EXISTS` in the schema file brings a v3 database up to
 * date on the next connection with nothing to do here.
 *
 * Schema 2 made deadlines, priorities and milestones optional and added task
 * provenance. The change is not expressible as an in-place SQLite migration of
 * a v1 database, so rather than silently half-applying it we detect the old
 * shape and stop with instructions.
 */
function assertNotStaleSchema(db: ReturnType<typeof openDatabase>): void {
  const tableExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tasks'")
    .get() as { name: string } | undefined;
  if (!tableExists) return;
  const columns = db
    .prepare('PRAGMA table_info(tasks)')
    .all() as { name: string; notnull: number }[];

  // v3 added task provenance and made milestones, deadlines, priorities and
  // owners optional. Everything from v3 onwards can be migrated in place by
  // `applyInPlaceMigrations`; older than that cannot, because the v1/v2 shape
  // has no column to derive the current one from.
  if (columns.some((c) => c.name === 'source_timeline')) return;

  throw new Error(
    'This database predates schema v3. Milestones, deadlines, priorities and owners are now ' +
      'optional, and milestones carry timeline and long-lead information. These changes ' +
      'cannot be applied in place over an older database.\n' +
      '  Reset the development database and reload a dataset:\n' +
      '    rm -f data/team-ops.db*\n    npm run setup',
  );
}

export function migrate(path: string = config.databasePath): void {
  // Opened without the schema: an older database lacks columns that
  // `schema.sql` indexes, so applying it first would fail before the
  // migrations that add them could run.
  const db = openDatabase(path);
  assertNotStaleSchema(db);
  // Foreign keys are deferred rather than dropped: a table rebuild momentarily
  // breaks references, and SQLite re-checks every one before the commit lands.
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    transaction(db, () => applyInPlaceMigrations(db));
    const broken = db.prepare('PRAGMA foreign_key_check').all();
    if (broken.length > 0) {
      throw new Error(
        `Migration left ${broken.length} broken foreign key reference(s); nothing was kept.`,
      );
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
  // Now that every column exists, the canonical schema can be applied: it
  // creates anything still missing, including the indexes a rebuild dropped.
  db.exec(readSchema());
  db.prepare(
    `INSERT INTO schema_meta (key, value) VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(SCHEMA_VERSION);
  db.prepare(
    `INSERT INTO schema_meta (key, value) VALUES ('migrated_at', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(nowTimestamp());
  db.close();
}

if (import.meta.filename === process.argv[1]) {
  migrate();
  console.log(`✓ Schema v${SCHEMA_VERSION} applied to ${config.databasePath}`);
}

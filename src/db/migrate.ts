/**
 * Applies the schema to the configured database file.
 *
 * The schema is written with `CREATE TABLE IF NOT EXISTS`, so running this is
 * idempotent and safe on an existing database. Layer 1 has a single schema
 * version; `schema_meta` is where incremental migrations will be tracked.
 */
import { createDatabase } from './connection.ts';
import { config } from '../config/index.ts';
import { nowTimestamp } from '../lib/dates.ts';

export const SCHEMA_VERSION = '6';

/**
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
function assertNotStaleSchema(db: ReturnType<typeof createDatabase>): void {
  const tableExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tasks'")
    .get() as { name: string } | undefined;
  if (!tableExists) return;
  const columns = db
    .prepare('PRAGMA table_info(tasks)')
    .all() as { name: string; notnull: number }[];
  if (columns.some((c) => c.name === 'source_timeline')) {
    const supply = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'supply_items'")
      .get() as { name: string } | undefined;
    if (supply) {
      const dates = columns.filter((c) => c.name === 'start_date' || c.name === 'due_date');
      if (dates.every((c) => c.notnull === 1)) return;
      throw new Error(
        'This database predates schema v5, where start and end dates became mandatory on ' +
          'tasks, milestones and deliverables. SQLite cannot add a NOT NULL constraint in ' +
          'place, and existing rows may carry no dates at all.\n' +
          '  Reset the development database and reload a dataset:\n' +
          '    rm -f data/team-ops.db*\n    npm run setup',
      );
    }
  }
  throw new Error(
    'This database predates schema v3. Milestones, deadlines, priorities and owners are now ' +
      'optional, and milestones carry timeline and long-lead information. These changes ' +
      'cannot be applied in place over an older database.\n' +
      '  Reset the development database and reload a dataset:\n' +
      '    rm -f data/team-ops.db*\n    npm run setup',
  );
}

export function migrate(path: string = config.databasePath): void {
  const db = createDatabase(path);
  assertNotStaleSchema(db);
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

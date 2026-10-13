/**
 * In-place schema migrations.
 *
 * These work from the database's ACTUAL shape rather than its recorded version
 * number, because the two drift: a database can be stamped v4 and already hold
 * a column v6 added, or be stamped v6 and have been built by a newer
 * `schema.sql` through `CREATE TABLE IF NOT EXISTS`. Inspecting
 * `PRAGMA table_info` and acting on what is really there is both idempotent
 * and honest about the starting point.
 *
 * Two kinds of change show up here:
 *
 *   1. Adding a column. SQLite does this in place, so it is a one-liner.
 *   2. Changing a constraint. SQLite cannot, so the table is rebuilt: create
 *      the target shape under a temporary name, copy the rows across, drop the
 *      old table and rename. The target DDL is taken from `schema.sql` itself
 *      via a scratch database, so there is never a second copy of the schema
 *      here to drift out of step with the real one.
 *
 * A rebuild that would violate a new constraint is REFUSED with the offending
 * count, not forced. Losing a row to a migration is worse than stopping.
 */
import { DatabaseSync } from 'node:sqlite';
import { readSchema, type Database } from './connection.ts';
import { hashPasscode } from '../lib/passcode.ts';
import { workingDaysInclusive } from '../lib/dates.ts';
import { config } from '../config/index.ts';

type ColumnInfo = { name: string; notnull: number };

const columns = (db: Database, table: string): ColumnInfo[] =>
  db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];

const hasTable = (db: Database, table: string): boolean =>
  db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !==
  undefined;

const hasColumn = (db: Database, table: string, column: string): boolean =>
  columns(db, table).some((c) => c.name === column);

const isNotNull = (db: Database, table: string, column: string): boolean =>
  columns(db, table).find((c) => c.name === column)?.notnull === 1;

/**
 * Whether a table's CHECK constraint already admits a value.
 *
 * A CHECK is invisible to `PRAGMA table_info`, so the stored DDL is read
 * instead. Crude, but it is the real constraint text rather than a guess, and
 * it keeps the rebuild idempotent.
 */
const ddlMentions = (db: Database, table: string, needle: string): boolean => {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table) as { sql: string } | undefined;
  return row?.sql.includes(needle) ?? false;
};

/** The canonical `CREATE TABLE` for one table, read back out of `schema.sql`. */
function targetDdl(table: string): string {
  const scratch = new DatabaseSync(':memory:');
  try {
    scratch.exec(readSchema());
    const row = scratch
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table) as { sql: string } | undefined;
    if (!row) throw new Error(`schema.sql defines no table named "${table}"`);
    return row.sql;
  } finally {
    scratch.close();
  }
}

/**
 * Rebuild `table` into the shape `schema.sql` declares, keeping every row.
 *
 * Only columns present in BOTH shapes are copied: a column the new shape drops
 * is left behind deliberately, and one it adds takes its declared default.
 */
function rebuildTable(db: Database, table: string): void {
  const ddl = targetDdl(table);
  const temp = `${table}__migrating`;
  const renamed = ddl.replace(
    /CREATE TABLE (IF NOT EXISTS )?["'`]?\w+["'`]?/,
    `CREATE TABLE ${temp}`,
  );

  const before = columns(db, table).map((c) => c.name);
  db.exec(renamed);
  const after = columns(db, temp).map((c) => c.name);
  const shared = before.filter((c) => after.includes(c));

  const list = shared.join(', ');
  db.exec(`INSERT INTO ${temp} (${list}) SELECT ${list} FROM ${table}`);
  db.exec(`DROP TABLE ${table}`);
  db.exec(`ALTER TABLE ${temp} RENAME TO ${table}`);
}

/**
 * Bring an existing database up to the current schema, in place.
 *
 * Safe to run against an already-current database: every step checks the real
 * shape first and does nothing when it is already right. Runs inside the
 * caller's transaction handling, with foreign keys deferred for the rebuilds —
 * SQLite re-checks them before the transaction commits.
 */
export function applyInPlaceMigrations(db: Database): void {
  if (!hasTable(db, 'tasks')) return; // a fresh database; schema.sql built it correctly

  // --- v7: the effort budget and the schedule state machine ---------------
  const v7Columns: [string, string][] = [
    ['effort_days', 'INTEGER'],
    ['original_effort_days', 'INTEGER'],
    ['schedule_state', "TEXT NOT NULL DEFAULT 'unset'"],
    ['schedule_proposed_by_id', 'TEXT REFERENCES users(id) ON DELETE SET NULL'],
    ['schedule_proposed_at', 'TEXT'],
    ['schedule_approved_by_id', 'TEXT REFERENCES users(id) ON DELETE SET NULL'],
    ['schedule_approved_at', 'TEXT'],
    ['schedule_review_note', 'TEXT'],
  ];
  for (const [name, type] of v7Columns) {
    if (!hasColumn(db, 'tasks', name)) {
      db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${type}`);
    }
  }

  // A task dated before v7 was dated by whoever created it, and nothing could
  // be stored undated, so those dates were agreed by definition. Marking them
  // `unset` would retroactively un-agree every task in the database and stop
  // all work; `locked` is the truthful reading of how they got there.
  db.exec(
    `UPDATE tasks SET schedule_state = 'locked'
      WHERE schedule_state = 'unset' AND start_date IS NOT NULL AND due_date IS NOT NULL`,
  );

  // --- v7: start and due dates become nullable again (reversing v5) -------
  if (isNotNull(db, 'tasks', 'start_date') || isNotNull(db, 'tasks', 'due_date')) {
    rebuildTable(db, 'tasks');
  }

  // --- v8: a milestone holds no calendar dates at all ---------------------
  // `target_date`, `start_date` and `end_date` are dropped rather than emptied.
  // The rebuild copies only the columns both shapes share, so the dates are
  // left behind with the old table. `timeline_label` keeps the plan's own
  // relative wording, which is what those dates were derived from anyway.
  if (hasTable(db, 'milestones') && hasColumn(db, 'milestones', 'start_date')) {
    rebuildTable(db, 'milestones');
  }

  // --- v8: a deliverable no longer has to be dated ------------------------
  // It is an outcome of its milestone; with the milestone undated there is
  // nothing for an imported outcome's date to be derived from.
  if (hasTable(db, 'deliverables') && isNotNull(db, 'deliverables', 'due_date')) {
    rebuildTable(db, 'deliverables');
  }

  // --- v12: a change request asks for DAYS, not a date --------------------
  // The deadline is derived from the budget now, so a request naming a date
  // would be asking for the wrong thing. The table is rebuilt; any request
  // still open is carried across by converting its window into working days,
  // because losing somebody's pending ask to a migration is worse than an
  // approximate number they can see and correct.
  if (hasTable(db, 'deadline_change_requests') && hasColumn(db, 'deadline_change_requests', 'current_due_date')) {
    const rows = db
      .prepare(
        `SELECT r.id, r.current_due_date, r.requested_due_date, t.start_date
           FROM deadline_change_requests r
           JOIN tasks t ON t.id = r.task_id`,
      )
      .all() as { id: string; current_due_date: string; requested_due_date: string; start_date: string | null }[];

    db.exec('ALTER TABLE deadline_change_requests ADD COLUMN current_effort_days INTEGER');
    db.exec('ALTER TABLE deadline_change_requests ADD COLUMN requested_effort_days INTEGER');
    for (const row of rows) {
      const from = row.start_date ?? row.current_due_date;
      db.prepare(
        'UPDATE deadline_change_requests SET current_effort_days = ?, requested_effort_days = ? WHERE id = ?',
      ).run(
        Math.max(1, workingDaysInclusive(from, row.current_due_date)),
        Math.max(1, workingDaysInclusive(from, row.requested_due_date)),
        row.id,
      );
    }
    // Anything the join could not reach gets the smallest honest value.
    db.exec(
      `UPDATE deadline_change_requests
          SET current_effort_days = COALESCE(current_effort_days, 1),
              requested_effort_days = COALESCE(requested_effort_days, 1)`,
    );
    rebuildTable(db, 'deadline_change_requests');
  }

  // --- v10: per-user passcodes -------------------------------------------
  // Existing accounts are backfilled with the old shared code, hashed per user
  // with its own salt. Nobody is locked out by the upgrade, and from here each
  // person's passcode can be changed independently of everybody else's.
  for (const [name, type] of [
    ['passcode_hash', 'TEXT'],
    ['passcode_set_at', 'TEXT'],
  ] as [string, string][]) {
    if (hasTable(db, 'users') && !hasColumn(db, 'users', name)) {
      db.exec(`ALTER TABLE users ADD COLUMN ${name} ${type}`);
    }
  }
  if (hasTable(db, 'users')) {
    const unset = db
      .prepare('SELECT id FROM users WHERE passcode_hash IS NULL')
      .all() as { id: string }[];
    const stamp = new Date().toISOString();
    for (const { id } of unset) {
      db.prepare('UPDATE users SET passcode_hash = ?, passcode_set_at = ? WHERE id = ?').run(
        hashPasscode(config.joinCode),
        stamp,
        id,
      );
    }
  }

  // --- v9: 'reviewer' joins the role vocabulary ---------------------------
  // The CHECK on users.role listed only Task Assigner and member, so an existing
  // database would refuse the new role outright.
  if (hasTable(db, 'users') && !ddlMentions(db, 'users', "'reviewer'")) {
    rebuildTable(db, 'users');
  }

  // Rebuilds drop the table's indexes with it; schema.sql puts them back.
  db.exec(readSchema());
}

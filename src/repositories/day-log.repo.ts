/**
 * Daily outcome log — SQL only.
 *
 * One row per person per task per calendar day. Re-submitting a day replaces
 * that day's row rather than appending a second one, so "what did Tuesday
 * produce" always has a single answer per person.
 */
import type { Database } from '../db/connection.ts';
import type { TaskDayLog } from '../domain/types.ts';
import { newId } from '../lib/ids.ts';
import { nowTimestamp, type IsoDate, type IsoTimestamp } from '../lib/dates.ts';

type DayLogRow = {
  id: string;
  task_id: string;
  author_id: string;
  author_name: string | null;
  log_date: string;
  outcome: string;
  progress: number | null;
  blocker: string | null;
  created_at: string;
  updated_at: string;
};

const SELECT = `
  SELECT l.*, u.name AS author_name
    FROM task_day_logs l
    LEFT JOIN users u ON u.id = l.author_id`;

const map = (row: DayLogRow): TaskDayLog => ({
  id: row.id,
  taskId: row.task_id,
  authorId: row.author_id,
  authorName: row.author_name ?? 'Unknown',
  logDate: row.log_date as IsoDate,
  outcome: row.outcome,
  progress: row.progress,
  blocker: row.blocker,
  createdAt: row.created_at as IsoTimestamp,
  updatedAt: row.updated_at as IsoTimestamp,
});

export type NewDayLog = {
  taskId: string;
  authorId: string;
  logDate: IsoDate;
  outcome: string;
  progress?: number | null;
  blocker?: string | null;
};

/** Insert, or overwrite this author's entry for that day. Returns the stored row. */
export function upsertDayLog(db: Database, input: NewDayLog, now?: Date): TaskDayLog {
  const timestamp = nowTimestamp(now);
  db.prepare(
    `INSERT INTO task_day_logs
       (id, task_id, author_id, log_date, outcome, progress, blocker, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (task_id, author_id, log_date) DO UPDATE SET
       outcome    = excluded.outcome,
       progress   = excluded.progress,
       blocker    = excluded.blocker,
       updated_at = excluded.updated_at`,
  ).run(
    newId(),
    input.taskId,
    input.authorId,
    input.logDate,
    input.outcome,
    input.progress ?? null,
    input.blocker ?? null,
    timestamp,
    timestamp,
  );
  const stored = findDayLog(db, input.taskId, input.authorId, input.logDate);
  if (!stored) throw new Error('Day log vanished immediately after being written');
  return stored;
}

export function findDayLog(
  db: Database,
  taskId: string,
  authorId: string,
  logDate: IsoDate,
): TaskDayLog | null {
  const row = db
    .prepare(`${SELECT} WHERE l.task_id = ? AND l.author_id = ? AND l.log_date = ?`)
    .get(taskId, authorId, logDate) as DayLogRow | undefined;
  return row ? map(row) : null;
}

/** Newest first — the shape the task detail screen reads. */
export function listDayLogs(db: Database, taskId: string): TaskDayLog[] {
  const rows = db
    .prepare(`${SELECT} WHERE l.task_id = ? ORDER BY l.log_date DESC, u.name`)
    .all(taskId) as DayLogRow[];
  return rows.map(map);
}

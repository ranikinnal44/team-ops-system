/**
 * The data-quality queue: things a source record did not establish and that a
 * manager must decide.
 */
import type { Database } from '../db/connection.ts';
import { toBool, fromBool, toText } from '../db/connection.ts';
import type { TaskClarification } from '../domain/types.ts';
import type { ClarificationCode } from '../domain/enums.ts';
import { newId } from '../lib/ids.ts';
import { nowTimestamp, type IsoTimestamp } from '../lib/dates.ts';

type Row = {
  id: string;
  task_id: string;
  code: string;
  detail: string;
  resolved: number;
  resolved_by_id: string | null;
  resolved_at: string | null;
  created_at: string;
};

const map = (row: Row): TaskClarification => ({
  id: row.id,
  taskId: row.task_id,
  code: row.code as ClarificationCode,
  detail: row.detail,
  resolved: toBool(row.resolved),
  resolvedById: toText(row.resolved_by_id),
  resolvedAt: toText(row.resolved_at),
  createdAt: row.created_at,
});

export function raiseClarification(
  db: Database,
  input: { taskId: string; code: ClarificationCode; detail: string; createdAt?: IsoTimestamp },
): void {
  // A repeated import of the same source row must not stack duplicates.
  db.prepare(
    `INSERT INTO task_clarifications (id, task_id, code, detail, resolved, created_at)
     VALUES (?, ?, ?, ?, 0, ?)
     ON CONFLICT(task_id, code) DO UPDATE SET detail = excluded.detail`,
  ).run(newId(), input.taskId, input.code, input.detail, input.createdAt ?? nowTimestamp());
}

export function listForTask(db: Database, taskId: string): TaskClarification[] {
  return (
    db
      .prepare('SELECT * FROM task_clarifications WHERE task_id = ? ORDER BY code')
      .all(taskId) as Row[]
  ).map(map);
}

/** Clarifications for many tasks at once, keyed by task id. */
export function listForTasks(
  db: Database,
  taskIds: readonly string[],
  opts: { unresolvedOnly?: boolean } = {},
): Map<string, TaskClarification[]> {
  const out = new Map<string, TaskClarification[]>();
  if (taskIds.length === 0) return out;
  const placeholders = taskIds.map(() => '?').join(', ');
  const resolvedClause = opts.unresolvedOnly ? ' AND resolved = 0' : '';
  const rows = db
    .prepare(
      `SELECT * FROM task_clarifications
       WHERE task_id IN (${placeholders})${resolvedClause} ORDER BY code`,
    )
    .all(...taskIds) as Row[];
  for (const row of rows) {
    const list = out.get(row.task_id) ?? [];
    list.push(map(row));
    out.set(row.task_id, list);
  }
  return out;
}

export function countByCode(db: Database, opts: { unresolvedOnly?: boolean } = {}): Map<string, number> {
  const where = opts.unresolvedOnly ? 'WHERE resolved = 0' : '';
  const rows = db
    .prepare(`SELECT code, COUNT(*) AS total FROM task_clarifications ${where} GROUP BY code`)
    .all() as { code: string; total: number }[];
  return new Map(rows.map((r) => [r.code, r.total]));
}

export function countUnresolved(db: Database): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM task_clarifications WHERE resolved = 0')
    .get() as { n: number };
  return row.n;
}

export function findById(db: Database, id: string): TaskClarification | null {
  const row = db.prepare('SELECT * FROM task_clarifications WHERE id = ?').get(id) as Row | undefined;
  return row ? map(row) : null;
}

export function setResolved(
  db: Database,
  id: string,
  resolvedById: string,
  resolved: boolean,
  at: IsoTimestamp = nowTimestamp(),
): void {
  db.prepare(
    `UPDATE task_clarifications
     SET resolved = ?, resolved_by_id = ?, resolved_at = ?
     WHERE id = ?`,
  ).run(fromBool(resolved), resolved ? resolvedById : null, resolved ? at : null, id);
}

/** Clear a clarification once the underlying gap is actually filled. */
export function resolveByCode(db: Database, taskId: string, code: ClarificationCode, by: string): void {
  db.prepare(
    `UPDATE task_clarifications
     SET resolved = 1, resolved_by_id = ?, resolved_at = ?
     WHERE task_id = ? AND code = ? AND resolved = 0`,
  ).run(by, nowTimestamp(), taskId, code);
}

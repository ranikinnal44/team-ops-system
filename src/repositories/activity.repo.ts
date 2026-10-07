/**
 * Task activity log and comments — the audit trail behind "what changed, when,
 * and who did it".
 */
import type { Database } from '../db/connection.ts';
import { toText } from '../db/connection.ts';
import type { TaskHistoryEntry, Comment } from '../domain/types.ts';
import type { HistoryKind, Origin } from '../domain/enums.ts';
import { newId } from '../lib/ids.ts';
import { nowTimestamp, type IsoTimestamp } from '../lib/dates.ts';

export type NewHistoryEntry = {
  taskId: string;
  /** NULL when the change did not originate from a person using the app. */
  actorId: string | null;
  /** Displayed in place of a user name for imported records. */
  actorLabel?: string | null;
  source?: Origin;
  kind: HistoryKind;
  field?: string | null;
  fromValue?: string | null;
  toValue?: string | null;
  note?: string | null;
  createdAt?: IsoTimestamp;
};

export function appendHistory(db: Database, entry: NewHistoryEntry): string {
  const id = newId();
  db.prepare(
    `INSERT INTO task_history
       (id, task_id, actor_id, actor_label, source, kind, field, from_value, to_value, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    entry.taskId,
    entry.actorId,
    entry.actorLabel ?? null,
    entry.source ?? 'app',
    entry.kind,
    entry.field ?? null,
    entry.fromValue ?? null,
    entry.toValue ?? null,
    entry.note ?? null,
    entry.createdAt ?? nowTimestamp(),
  );
  return id;
}

export function appendHistoryBatch(db: Database, entries: readonly NewHistoryEntry[]): void {
  for (const entry of entries) appendHistory(db, entry);
}

type HistoryRow = {
  id: string;
  task_id: string;
  actor_id: string | null;
  actor_label: string | null;
  actor_name: string | null;
  source: string;
  kind: string;
  field: string | null;
  from_value: string | null;
  to_value: string | null;
  note: string | null;
  created_at: string;
};

const mapHistory = (row: HistoryRow): TaskHistoryEntry => ({
  id: row.id,
  taskId: row.task_id,
  actorId: toText(row.actor_id),
  // Imported rows carry a label instead of a user, so the log never claims a
  // real person made a change inside the application when they did not.
  actorName: row.actor_name ?? row.actor_label ?? 'Imported record',
  source: row.source as Origin,
  kind: row.kind as HistoryKind,
  field: toText(row.field),
  fromValue: toText(row.from_value),
  toValue: toText(row.to_value),
  note: toText(row.note),
  createdAt: row.created_at,
});

const HISTORY_SELECT = `
  SELECT h.*, u.name AS actor_name
  FROM task_history h
  LEFT JOIN users u ON u.id = h.actor_id`;

export function listHistoryForTask(db: Database, taskId: string): TaskHistoryEntry[] {
  const rows = db
    .prepare(`${HISTORY_SELECT} WHERE h.task_id = ? ORDER BY h.created_at DESC, h.rowid DESC`)
    .all(taskId) as HistoryRow[];
  return rows.map(mapHistory);
}

/** Team-wide activity feed, newest first. Optionally scoped to one actor. */
export function listRecentHistory(
  db: Database,
  opts: { limit?: number; actorId?: string; participantId?: string } = {},
): (TaskHistoryEntry & { taskRef: string; taskTitle: string })[] {
  const limit = opts.limit ?? 50;
  const clauses: string[] = [];
  const params: (string | number)[] = [];
  if (opts.actorId) {
    clauses.push('h.actor_id = ?');
    params.push(opts.actorId);
  }
  if (opts.participantId) {
    clauses.push(
      `(t.owner_id = ? OR t.reviewer_id = ?
        OR EXISTS (SELECT 1 FROM task_supporters s WHERE s.task_id = t.id AND s.user_id = ?))`,
    );
    params.push(opts.participantId, opts.participantId, opts.participantId);
  }
  const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT h.*, u.name AS actor_name, t.ref AS task_ref, t.title AS task_title
       FROM task_history h
       LEFT JOIN users u ON u.id = h.actor_id
       JOIN tasks t ON t.id = h.task_id${where}
       ORDER BY h.created_at DESC, h.rowid DESC
       LIMIT ?`,
    )
    .all(...params, limit) as (HistoryRow & { task_ref: string; task_title: string })[];
  return rows.map((row) => ({
    ...mapHistory(row),
    taskRef: row.task_ref,
    taskTitle: row.task_title,
  }));
}

// --- comments -------------------------------------------------------------

type CommentRow = {
  id: string;
  task_id: string;
  author_id: string;
  author_name: string;
  body: string;
  created_at: string;
};

const mapComment = (row: CommentRow): Comment => ({
  id: row.id,
  taskId: row.task_id,
  authorId: row.author_id,
  authorName: row.author_name,
  body: row.body,
  createdAt: row.created_at,
});

export function insertComment(
  db: Database,
  input: { taskId: string; authorId: string; body: string; createdAt?: IsoTimestamp },
): Comment {
  const id = newId();
  const createdAt = input.createdAt ?? nowTimestamp();
  db.prepare(
    'INSERT INTO comments (id, task_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(id, input.taskId, input.authorId, input.body, createdAt);
  const row = db
    .prepare(
      `SELECT c.*, u.name AS author_name FROM comments c
       JOIN users u ON u.id = c.author_id WHERE c.id = ?`,
    )
    .get(id) as CommentRow;
  return mapComment(row);
}

export function listCommentsForTask(db: Database, taskId: string): Comment[] {
  const rows = db
    .prepare(
      `SELECT c.*, u.name AS author_name FROM comments c
       JOIN users u ON u.id = c.author_id
       WHERE c.task_id = ? ORDER BY c.created_at ASC`,
    )
    .all(taskId) as CommentRow[];
  return rows.map(mapComment);
}

export function countCommentsByTask(db: Database, taskIds: readonly string[]): Map<string, number> {
  if (taskIds.length === 0) return new Map();
  const placeholders = taskIds.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT task_id, COUNT(*) AS total FROM comments
       WHERE task_id IN (${placeholders}) GROUP BY task_id`,
    )
    .all(...taskIds) as { task_id: string; total: number }[];
  return new Map(rows.map((r) => [r.task_id, r.total]));
}

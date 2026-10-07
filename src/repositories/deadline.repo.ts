/**
 * Deadline change requests — the approval path that lets employees ask for a
 * new due date without being able to set one.
 */
import type { Database } from '../db/connection.ts';
import { toText } from '../db/connection.ts';
import type { DeadlineChangeRequest } from '../domain/types.ts';
import { DeadlineRequestStatus, type DeadlineRequestStatus as RequestStatus } from '../domain/enums.ts';
import { newId } from '../lib/ids.ts';
import { nowTimestamp, type IsoDate, type IsoTimestamp } from '../lib/dates.ts';

type RequestRow = {
  id: string;
  task_id: string;
  task_ref: string;
  task_title: string;
  requested_by_id: string;
  requested_by_name: string;
  current_due_date: string;
  requested_due_date: string;
  reason: string;
  status: string;
  decided_by_id: string | null;
  decided_by_name: string | null;
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
};

const SELECT = `
  SELECT r.*, t.ref AS task_ref, t.title AS task_title,
         ru.name AS requested_by_name, du.name AS decided_by_name
  FROM deadline_change_requests r
  JOIN tasks t  ON t.id = r.task_id
  JOIN users ru ON ru.id = r.requested_by_id
  LEFT JOIN users du ON du.id = r.decided_by_id`;

const map = (row: RequestRow): DeadlineChangeRequest => ({
  id: row.id,
  taskId: row.task_id,
  taskRef: row.task_ref,
  taskTitle: row.task_title,
  requestedById: row.requested_by_id,
  requestedByName: row.requested_by_name,
  currentDueDate: row.current_due_date,
  requestedDueDate: row.requested_due_date,
  reason: row.reason,
  status: row.status as RequestStatus,
  decidedById: toText(row.decided_by_id),
  decidedByName: toText(row.decided_by_name),
  decisionNote: toText(row.decision_note),
  createdAt: row.created_at,
  decidedAt: toText(row.decided_at),
});

export function insertDeadlineRequest(
  db: Database,
  input: {
    taskId: string;
    requestedById: string;
    currentDueDate: IsoDate;
    requestedDueDate: IsoDate;
    reason: string;
    createdAt?: IsoTimestamp;
  },
): string {
  const id = newId();
  db.prepare(
    `INSERT INTO deadline_change_requests
       (id, task_id, requested_by_id, current_due_date, requested_due_date, reason, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.taskId,
    input.requestedById,
    input.currentDueDate,
    input.requestedDueDate,
    input.reason,
    DeadlineRequestStatus.Pending,
    input.createdAt ?? nowTimestamp(),
  );
  return id;
}

export function findDeadlineRequest(db: Database, id: string): DeadlineChangeRequest | null {
  const row = db.prepare(`${SELECT} WHERE r.id = ?`).get(id) as RequestRow | undefined;
  return row ? map(row) : null;
}

export function findPendingRequestForTask(db: Database, taskId: string): DeadlineChangeRequest | null {
  const row = db
    .prepare(`${SELECT} WHERE r.task_id = ? AND r.status = 'pending' ORDER BY r.created_at DESC`)
    .get(taskId) as RequestRow | undefined;
  return row ? map(row) : null;
}

export function listDeadlineRequests(
  db: Database,
  opts: { status?: RequestStatus; taskId?: string; requestedById?: string } = {},
): DeadlineChangeRequest[] {
  const clauses: string[] = [];
  const params: string[] = [];
  if (opts.status) {
    clauses.push('r.status = ?');
    params.push(opts.status);
  }
  if (opts.taskId) {
    clauses.push('r.task_id = ?');
    params.push(opts.taskId);
  }
  if (opts.requestedById) {
    clauses.push('r.requested_by_id = ?');
    params.push(opts.requestedById);
  }
  const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`${SELECT}${where} ORDER BY r.created_at DESC`).all(...params) as RequestRow[];
  return rows.map(map);
}

export function decideDeadlineRequest(
  db: Database,
  input: {
    id: string;
    status: Extract<RequestStatus, 'approved' | 'rejected'>;
    decidedById: string;
    decisionNote: string | null;
    decidedAt?: IsoTimestamp;
  },
): void {
  db.prepare(
    `UPDATE deadline_change_requests
     SET status = ?, decided_by_id = ?, decision_note = ?, decided_at = ?
     WHERE id = ? AND status = 'pending'`,
  ).run(
    input.status,
    input.decidedById,
    input.decisionNote,
    input.decidedAt ?? nowTimestamp(),
    input.id,
  );
}

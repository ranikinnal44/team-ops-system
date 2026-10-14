/**
 * Task persistence, including the joined read model the UI consumes.
 */
import type { Database } from '../db/connection.ts';
import { toText } from '../db/connection.ts';
import type { Task, TaskContext } from '../domain/types.ts';
import type { TaskStatus, Priority, Origin, ScheduleState } from '../domain/enums.ts';
import { newId } from '../lib/ids.ts';
import { nowTimestamp, type IsoDate, type IsoTimestamp } from '../lib/dates.ts';

type TaskRow = {
  id: string;
  ref: string;
  workstream_id: string;
  milestone_id: string | null;
  deliverable_id: string | null;
  title: string;
  description: string | null;
  owner_id: string | null;
  reviewer_id: string | null;
  priority: string | null;
  status: string;
  progress: number | null;
  progress_note: string | null;
  effort_days: number | null;
  original_effort_days: number | null;
  schedule_state: string;
  schedule_proposed_by_id: string | null;
  schedule_proposed_at: string | null;
  schedule_approved_by_id: string | null;
  schedule_approved_at: string | null;
  schedule_review_note: string | null;
  start_date: string | null;
  due_date: string | null;
  original_due_date: string | null;
  source_date: string | null;
  blocker: string | null;
  next_action: string | null;
  evidence_url: string | null;
  review_note: string | null;
  origin: string;
  source_ref: string | null;
  source_status: string | null;
  source_owner_label: string | null;
  source_timeline: string | null;
  created_by_id: string | null;
  created_at: string;
  last_updated_at: string;
  completed_at: string | null;
};

type ContextRow = {
  project_id: string;
  project_code: string;
  project_name: string;
  workstream_code: string;
  workstream_name: string;
  milestone_name: string | null;
  deliverable_name: string | null;
  owner_name: string | null;
  reviewer_name: string | null;
  last_day_log_date: string | null;
};

/** Task row plus its hierarchy and the names the UI renders. */
export type TaskWithContext = Task & TaskContext;

/**
 * Milestone and deliverable are LEFT joined: a task is only required to sit
 * under a workstream, so forcing an inner join here would silently hide every
 * task whose milestone has not been decided yet.
 */
const CONTEXT_SELECT = `
  t.*,
  p.id   AS project_id,     p.code AS project_code,     p.name AS project_name,
  w.code AS workstream_code,  w.name AS workstream_name,
  m.name AS milestone_name,
  d.name AS deliverable_name,
  o.name AS owner_name,
  r.name AS reviewer_name,
  -- Carried on every task row so the daily-update rule never costs an extra
  -- query per task; NULL means no outcome has ever been logged.
  (SELECT MAX(l.log_date) FROM task_day_logs l WHERE l.task_id = t.id) AS last_day_log_date
FROM tasks t
JOIN workstreams  w ON w.id = t.workstream_id
JOIN projects     p ON p.id = w.project_id
LEFT JOIN users        o ON o.id = t.owner_id
LEFT JOIN milestones   m ON m.id = t.milestone_id
LEFT JOIN users        r ON r.id = t.reviewer_id
LEFT JOIN deliverables d ON d.id = t.deliverable_id`;

function mapTask(
  row: TaskRow & ContextRow,
  supporters: readonly string[],
  dependencies: readonly string[],
): TaskWithContext {
  return {
    id: row.id,
    ref: row.ref,
    workstreamId: row.workstream_id,
    milestoneId: toText(row.milestone_id),
    deliverableId: toText(row.deliverable_id),
    title: row.title,
    description: toText(row.description),
    ownerId: toText(row.owner_id),
    reviewerId: toText(row.reviewer_id),
    priority: row.priority === null ? null : (row.priority as Priority),
    status: row.status as TaskStatus,
    progress: row.progress === null ? null : row.progress,
    progressNote: toText(row.progress_note),
    effortDays: row.effort_days,
    originalEffortDays: row.original_effort_days,
    scheduleState: row.schedule_state as ScheduleState,
    scheduleProposedById: toText(row.schedule_proposed_by_id),
    scheduleProposedAt: toText(row.schedule_proposed_at),
    scheduleApprovedById: toText(row.schedule_approved_by_id),
    scheduleApprovedAt: toText(row.schedule_approved_at),
    scheduleReviewNote: toText(row.schedule_review_note),
    startDate: toText(row.start_date),
    dueDate: toText(row.due_date),
    originalDueDate: toText(row.original_due_date),
    sourceDate: toText(row.source_date),
    blocker: toText(row.blocker),
    nextAction: toText(row.next_action),
    evidenceUrl: toText(row.evidence_url),
    reviewNote: toText(row.review_note),
    origin: row.origin as Origin,
    sourceRef: toText(row.source_ref),
    sourceStatus: toText(row.source_status),
    sourceOwnerLabel: toText(row.source_owner_label),
    sourceTimeline: toText(row.source_timeline),
    createdById: toText(row.created_by_id),
    createdAt: row.created_at,
    lastUpdatedAt: row.last_updated_at,
    completedAt: toText(row.completed_at),
    supportingMemberIds: supporters,
    dependencyTaskIds: dependencies,
    projectId: row.project_id,
    projectCode: row.project_code,
    projectName: row.project_name,
    workstreamCode: row.workstream_code,
    workstreamName: row.workstream_name,
    lastDayLogDate: toText(row.last_day_log_date),
    milestoneName: toText(row.milestone_name),
    deliverableName: toText(row.deliverable_name),
    ownerName: toText(row.owner_name),
    reviewerName: toText(row.reviewer_name),
  };
}

/** Load supporters, dependencies and day plans for a set of tasks in three
 * queries, not 3N. */
function loadRelations(
  db: Database,
  taskIds: readonly string[],
): {
  supporters: Map<string, string[]>;
  dependencies: Map<string, string[]>;
} {
  const supporters = new Map<string, string[]>();
  const dependencies = new Map<string, string[]>();
  if (taskIds.length === 0) return { supporters, dependencies };

  const placeholders = taskIds.map(() => '?').join(', ');
  const supportRows = db
    .prepare(
      `SELECT ts.task_id, ts.user_id FROM task_supporters ts
       JOIN users u ON u.id = ts.user_id
       WHERE ts.task_id IN (${placeholders}) ORDER BY u.name`,
    )
    .all(...taskIds) as { task_id: string; user_id: string }[];
  for (const row of supportRows) {
    const list = supporters.get(row.task_id) ?? [];
    list.push(row.user_id);
    supporters.set(row.task_id, list);
  }

  const depRows = db
    .prepare(
      `SELECT task_id, depends_on_task_id FROM task_dependencies
       WHERE task_id IN (${placeholders})`,
    )
    .all(...taskIds) as { task_id: string; depends_on_task_id: string }[];
  for (const row of depRows) {
    const list = dependencies.get(row.task_id) ?? [];
    list.push(row.depends_on_task_id);
    dependencies.set(row.task_id, list);
  }


  return { supporters, dependencies };
}

function hydrate(db: Database, rows: (TaskRow & ContextRow)[]): TaskWithContext[] {
  const ids = rows.map((r) => r.id);
  const { supporters, dependencies } = loadRelations(db, ids);
  return rows.map((row) =>
    mapTask(
      row,
      supporters.get(row.id) ?? [],
      dependencies.get(row.id) ?? [],
    ),
  );
}

export type NewTaskRecord = {
  ref: string;
  workstreamId: string;
  milestoneId: string | null;
  deliverableId: string | null;
  title: string;
  description: string | null;
  ownerId: string | null;
  reviewerId: string | null;
  priority: Priority | null;
  status: TaskStatus;
  progress: number | null;
  progressNote?: string | null;
  startDate: IsoDate | null;
  dueDate: IsoDate | null;
  /**
   * The slippage baseline. Defaults to the due date, because creating a task in
   * the app means committing to its deadline. An import whose source states no
   * deadline passes `null` explicitly: a stand-in date is not a commitment, and
   * measuring slippage against one would invent a promise nobody made.
   */
  originalDueDate?: IsoDate | null;
  effortDays?: number | null;
  /** Defaults to `effortDays`; the first estimate, kept for slippage reporting. */
  originalEffortDays?: number | null;
  scheduleState?: ScheduleState;
  scheduleProposedById?: string | null;
  scheduleProposedAt?: IsoTimestamp | null;
  scheduleApprovedById?: string | null;
  scheduleApprovedAt?: IsoTimestamp | null;
  sourceDate?: IsoDate | null;
  blocker?: string | null;
  nextAction: string | null;
  evidenceUrl?: string | null;
  reviewNote?: string | null;
  origin?: Origin;
  sourceRef?: string | null;
  sourceStatus?: string | null;
  sourceOwnerLabel?: string | null;
  sourceTimeline?: string | null;
  createdById: string | null;
  createdAt?: IsoTimestamp;
  lastUpdatedAt?: IsoTimestamp;
  completedAt?: IsoTimestamp | null;
  supportingMemberIds: readonly string[];
  dependencyTaskIds: readonly string[];
  /** Omitted by importers: a source record states no per-day breakdown. */
};

export function insertTask(db: Database, input: NewTaskRecord): string {
  const id = newId();
  const createdAt = input.createdAt ?? nowTimestamp();
  const lastUpdatedAt = input.lastUpdatedAt ?? createdAt;
  db.prepare(
    `INSERT INTO tasks (
       id, ref, workstream_id, milestone_id, deliverable_id, title, description,
       owner_id, reviewer_id, priority, status, progress, progress_note,
       effort_days, original_effort_days, schedule_state,
       schedule_proposed_by_id, schedule_proposed_at,
       schedule_approved_by_id, schedule_approved_at,
       start_date, due_date, original_due_date, source_date,
       blocker, next_action, evidence_url, review_note,
       origin, source_ref, source_status, source_owner_label, source_timeline,
       created_by_id, created_at, last_updated_at, completed_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.ref,
    input.workstreamId,
    input.milestoneId,
    input.deliverableId,
    input.title,
    input.description,
    input.ownerId,
    input.reviewerId,
    input.priority,
    input.status,
    input.progress,
    input.progressNote ?? null,
    input.effortDays ?? null,
    input.originalEffortDays === undefined ? (input.effortDays ?? null) : input.originalEffortDays,
    input.scheduleState ?? 'unset',
    input.scheduleProposedById ?? null,
    input.scheduleProposedAt ?? null,
    input.scheduleApprovedById ?? null,
    input.scheduleApprovedAt ?? null,
    input.startDate,
    input.dueDate,
    input.originalDueDate === undefined ? input.dueDate : input.originalDueDate,
    input.sourceDate ?? null,
    input.blocker ?? null,
    input.nextAction,
    input.evidenceUrl ?? null,
    input.reviewNote ?? null,
    input.origin ?? 'app',
    input.sourceRef ?? null,
    input.sourceStatus ?? null,
    input.sourceOwnerLabel ?? null,
    input.sourceTimeline ?? null,
    input.createdById,
    createdAt,
    lastUpdatedAt,
    input.completedAt ?? null,
  );
  replaceSupporters(db, id, input.supportingMemberIds);
  replaceDependencies(db, id, input.dependencyTaskIds);
  return id;
}

export function replaceSupporters(db: Database, taskId: string, userIds: readonly string[]): void {
  db.prepare('DELETE FROM task_supporters WHERE task_id = ?').run(taskId);
  const stmt = db.prepare('INSERT INTO task_supporters (task_id, user_id) VALUES (?, ?)');
  for (const userId of new Set(userIds)) stmt.run(taskId, userId);
}

export function replaceDependencies(db: Database, taskId: string, dependsOn: readonly string[]): void {
  db.prepare('DELETE FROM task_dependencies WHERE task_id = ?').run(taskId);
  const stmt = db.prepare(
    'INSERT INTO task_dependencies (task_id, depends_on_task_id) VALUES (?, ?)',
  );
  for (const depId of new Set(dependsOn)) {
    if (depId !== taskId) stmt.run(taskId, depId);
  }
}



/** Columns the service layer may write, mapped to their SQL column names. */
const COLUMN_BY_FIELD: Record<string, string> = {
  title: 'title',
  description: 'description',
  ownerId: 'owner_id',
  reviewerId: 'reviewer_id',
  priority: 'priority',
  status: 'status',
  progress: 'progress',
  startDate: 'start_date',
  dueDate: 'due_date',
  originalDueDate: 'original_due_date',
  blocker: 'blocker',
  nextAction: 'next_action',
  evidenceUrl: 'evidence_url',
  workstreamId: 'workstream_id',
  milestoneId: 'milestone_id',
  deliverableId: 'deliverable_id',
  completedAt: 'completed_at',
  progressNote: 'progress_note',
  reviewNote: 'review_note',
  effortDays: 'effort_days',
  originalEffortDays: 'original_effort_days',
  scheduleState: 'schedule_state',
  scheduleProposedById: 'schedule_proposed_by_id',
  scheduleProposedAt: 'schedule_proposed_at',
  scheduleApprovedById: 'schedule_approved_by_id',
  scheduleApprovedAt: 'schedule_approved_at',
  scheduleReviewNote: 'schedule_review_note',
};

export type TaskColumnPatch = Record<string, string | number | null>;

/**
 * Applies a column patch and always refreshes `last_updated_at`.
 *
 * An unmapped field is a programming error, not something to skip quietly: a
 * silently dropped column means a write that appears to succeed and does not.
 */
export function updateTaskColumns(
  db: Database,
  taskId: string,
  patch: TaskColumnPatch,
  updatedAt: IsoTimestamp = nowTimestamp(),
): void {
  const entries = Object.entries(patch);
  const unknown = entries.filter(([field]) => !(field in COLUMN_BY_FIELD)).map(([field]) => field);
  if (unknown.length > 0) {
    throw new Error(`updateTaskColumns received unmapped task field(s): ${unknown.join(', ')}`);
  }
  const assignments = entries.map(([field]) => `${COLUMN_BY_FIELD[field]} = ?`);
  assignments.push('last_updated_at = ?');
  const values = [...entries.map(([, value]) => value), updatedAt, taskId];
  db.prepare(`UPDATE tasks SET ${assignments.join(', ')} WHERE id = ?`).run(...values);
}

/**
 * Set `created_at` / `last_updated_at` / `completed_at` explicitly.
 *
 * Used only by seeding and data import, where records carry their own history.
 * Normal updates go through `updateTaskColumns`, which always stamps "now".
 */
export function overrideTaskTimestamps(
  db: Database,
  taskId: string,
  stamps: { createdAt?: IsoTimestamp; lastUpdatedAt?: IsoTimestamp; completedAt?: IsoTimestamp | null },
): void {
  const assignments: string[] = [];
  const values: (string | null)[] = [];
  if (stamps.createdAt !== undefined) {
    assignments.push('created_at = ?');
    values.push(stamps.createdAt);
  }
  if (stamps.lastUpdatedAt !== undefined) {
    assignments.push('last_updated_at = ?');
    values.push(stamps.lastUpdatedAt);
  }
  if (stamps.completedAt !== undefined) {
    assignments.push('completed_at = ?');
    values.push(stamps.completedAt);
  }
  if (assignments.length === 0) return;
  db.prepare(`UPDATE tasks SET ${assignments.join(', ')} WHERE id = ?`).run(...values, taskId);
}

/** Bump `last_updated_at` without changing any column (used by comments). */
export function touchTask(db: Database, taskId: string, at: IsoTimestamp = nowTimestamp()): void {
  db.prepare('UPDATE tasks SET last_updated_at = ? WHERE id = ?').run(at, taskId);
}

export function findTaskById(db: Database, id: string): TaskWithContext | null {
  const row = db.prepare(`SELECT ${CONTEXT_SELECT} WHERE t.id = ?`).get(id) as
    | (TaskRow & ContextRow)
    | undefined;
  if (!row) return null;
  return hydrate(db, [row])[0] ?? null;
}

export function findTaskByRef(db: Database, ref: string): TaskWithContext | null {
  const row = db.prepare(`SELECT ${CONTEXT_SELECT} WHERE t.ref = ?`).get(ref) as
    | (TaskRow & ContextRow)
    | undefined;
  if (!row) return null;
  return hydrate(db, [row])[0] ?? null;
}

export type TaskFilter = {
  /** Tasks this user owns. */
  ownerId?: string;
  /** Tasks this user owns, supports or reviews — a member's visible set. */
  participantId?: string;
  reviewerId?: string;
  projectId?: string;
  workstreamId?: string;
  milestoneId?: string;
  statuses?: readonly TaskStatus[];
  priorities?: readonly Priority[];
  origin?: Origin;
  /** Only tasks with at least one unresolved clarification. */
  needsClarification?: boolean;
  missingPriority?: boolean;
  missingDueDate?: boolean;
  /** Only tasks with no owner assigned. */
  unassigned?: boolean;
  dueOnOrBefore?: IsoDate;
  dueOnOrAfter?: IsoDate;
  /** Case-insensitive match against ref, title and description. */
  search?: string;
};

export function listTasks(db: Database, filter: TaskFilter = {}): TaskWithContext[] {
  const clauses: string[] = [];
  const params: (string | number)[] = [];

  if (filter.ownerId) {
    clauses.push('t.owner_id = ?');
    params.push(filter.ownerId);
  }
  if (filter.participantId) {
    clauses.push(
      `(t.owner_id = ? OR t.reviewer_id = ?
        OR EXISTS (SELECT 1 FROM task_supporters s WHERE s.task_id = t.id AND s.user_id = ?))`,
    );
    params.push(filter.participantId, filter.participantId, filter.participantId);
  }
  if (filter.reviewerId) {
    clauses.push('t.reviewer_id = ?');
    params.push(filter.reviewerId);
  }
  if (filter.projectId) {
    clauses.push('p.id = ?');
    params.push(filter.projectId);
  }
  if (filter.workstreamId) {
    clauses.push('t.workstream_id = ?');
    params.push(filter.workstreamId);
  }
  if (filter.origin) {
    clauses.push('t.origin = ?');
    params.push(filter.origin);
  }
  if (filter.needsClarification) {
    clauses.push(
      'EXISTS (SELECT 1 FROM task_clarifications c WHERE c.task_id = t.id AND c.resolved = 0)',
    );
  }
  if (filter.missingPriority) clauses.push('t.priority IS NULL');
  if (filter.missingDueDate) clauses.push('t.due_date IS NULL');
  if (filter.unassigned) clauses.push('t.owner_id IS NULL');
  if (filter.milestoneId) {
    clauses.push('t.milestone_id = ?');
    params.push(filter.milestoneId);
  }
  if (filter.statuses && filter.statuses.length > 0) {
    clauses.push(`t.status IN (${filter.statuses.map(() => '?').join(', ')})`);
    params.push(...filter.statuses);
  }
  if (filter.priorities && filter.priorities.length > 0) {
    clauses.push(`t.priority IN (${filter.priorities.map(() => '?').join(', ')})`);
    params.push(...filter.priorities);
  }
  if (filter.dueOnOrBefore) {
    clauses.push('t.due_date <= ?');
    params.push(filter.dueOnOrBefore);
  }
  if (filter.dueOnOrAfter) {
    clauses.push('t.due_date >= ?');
    params.push(filter.dueOnOrAfter);
  }
  if (filter.search) {
    clauses.push('(LOWER(t.ref) LIKE ? OR LOWER(t.title) LIKE ? OR LOWER(IFNULL(t.description, \'\')) LIKE ?)');
    const needle = `%${filter.search.toLowerCase()}%`;
    params.push(needle, needle, needle);
  }

  const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
  // Tasks without a deadline sort last rather than first, which is where a NULL
  // would otherwise land in SQLite's ordering.
  const rows = db
    .prepare(
      `SELECT ${CONTEXT_SELECT}${where}
       ORDER BY (t.due_date IS NULL), t.due_date, (t.priority IS NULL), t.priority`,
    )
    .all(...params) as (TaskRow & ContextRow)[];
  return hydrate(db, rows);
}

/** Minimal shape used to render dependency chips without loading full tasks. */
export function findTaskSummaries(
  db: Database,
  ids: readonly string[],
): { id: string; ref: string; title: string; status: TaskStatus }[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db
    .prepare(`SELECT id, ref, title, status FROM tasks WHERE id IN (${placeholders})`)
    .all(...ids) as { id: string; ref: string; title: string; status: string }[];
  return rows.map((r) => ({ id: r.id, ref: r.ref, title: r.title, status: r.status as TaskStatus }));
}

export function countTasksByOwner(db: Database): Map<string, number> {
  const rows = db
    .prepare('SELECT owner_id, COUNT(*) AS total FROM tasks WHERE owner_id IS NOT NULL GROUP BY owner_id')
    .all() as { owner_id: string; total: number }[];
  return new Map(rows.map((r) => [r.owner_id, r.total]));
}

/**
 * Distinct workstreams the user holds work in, as owner, reviewer or
 * supporting member. Backs a member's visible slice of the plan.
 */
export function listParticipantWorkstreamIds(db: Database, userId: string): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT t.workstream_id AS id
         FROM tasks t
        WHERE t.owner_id = ?
           OR t.reviewer_id = ?
           OR EXISTS (SELECT 1 FROM task_supporters s WHERE s.task_id = t.id AND s.user_id = ?)`,
    )
    .all(userId, userId, userId) as { id: string }[];
  return rows.map((row) => row.id);
}

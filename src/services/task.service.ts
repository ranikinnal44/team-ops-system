/**
 * Task workflow: creation, assignment, updates, history and deadline requests.
 *
 * This is the only place that decides *what may change*; repositories decide
 * *how it is stored* and `domain/` decides *whether it is legal*.
 */
import type { Database } from '../db/connection.ts';
import { transaction } from '../db/connection.ts';
import * as taskRepo from '../repositories/task.repo.ts';
import * as hierarchyRepo from '../repositories/hierarchy.repo.ts';
import * as userRepo from '../repositories/user.repo.ts';
import * as activityRepo from '../repositories/activity.repo.ts';
import * as deadlineRepo from '../repositories/deadline.repo.ts';
import * as clarificationRepo from '../repositories/clarification.repo.ts';
import * as dayLogRepo from '../repositories/day-log.repo.ts';
import type { TaskWithContext } from '../repositories/task.repo.ts';
import type {
  Actor,
  TaskView,
  TaskHistoryEntry,
  Comment,
  DeadlineChangeRequest,
  TaskDayPlan,
  TaskDayLog,
} from '../domain/types.ts';
import {
  TaskStatus,
  Priority,
  Role,
  HistoryKind,
  STATUS_LABEL,
  PRIORITY_LABEL,
  DeadlineRequestStatus,
  ClarificationCode,
  type ExceptionFlag,
} from '../domain/enums.ts';
import { assertTransition, progressForStatus, allowedTransitions } from '../domain/status-machine.ts';
import {
  Capability,
  assertCan,
  assertCanViewTask,
  assertCanUpdateTask,
  assertCanWriteTaskFields,
  type TaskField,
} from '../domain/permissions.ts';
import { evaluateTask, attentionScore, type RuleThresholds } from '../domain/exceptions.ts';
import {
  normaliseSchedule,
  taskSpanDays,
  uncoveredDays,
  needsDayOutcomes,
  describeSchedule,
} from '../domain/task-schedule.ts';
import { config } from '../config/index.ts';
import { formatTaskRef } from '../lib/ids.ts';
import {
  todayDate,
  nowTimestamp,
  daysBetween,
  formatDateHuman,
  type IsoDate,
} from '../lib/dates.ts';
import { notFound, conflict, validationError, forbidden, type ErrorDetail } from '../lib/errors.ts';

const thresholds = (): RuleThresholds => ({
  dueSoonDays: config.rules.dueSoonDays,
  noUpdateWorkingDays: config.rules.noUpdateWorkingDays,
  dailyUpdateWorkingDays: config.rules.dailyUpdateWorkingDays,
});

/** Longest span a task may cover, in inclusive calendar days. */
const maxSpanDays = (): number => config.rules.maxTaskSpanDays;

/** The sentence the clarification queue shows for days with no outcome. */
const missingOutcomesDetail = (days: readonly IsoDate[]): string =>
  `No outcome is defined for ${days.map(formatDateHuman).join(', ')}.`;

// --- read model -----------------------------------------------------------

/** Enrich a stored task with the computed fields every screen needs. */
export function toTaskView(db: Database, task: TaskWithContext, today: IsoDate = todayDate()): TaskView {
  const names = userRepo.userNameMap(db);
  return buildView(
    task,
    today,
    names,
    taskRepo.findTaskSummaries(db, task.dependencyTaskIds),
    clarificationRepo.listForTask(db, task.id),
  );
}

function buildView(
  task: TaskWithContext,
  today: IsoDate,
  names: Map<string, string>,
  dependencyRefs: TaskView['dependencyRefs'],
  clarifications: TaskView['clarifications'],
): TaskView {
  const flags: ExceptionFlag[] = evaluateTask(task, today, thresholds());
  return {
    ...task,
    exceptions: flags,
    attentionScore: attentionScore(task, today, thresholds()),
    // `null` rather than a number when no deadline has been agreed.
    daysUntilDue: task.dueDate === null ? null : daysBetween(today, task.dueDate),
    supportingMemberNames: task.supportingMemberIds.map((id) => names.get(id) ?? 'Unknown'),
    dependencyRefs,
    clarifications,
  };
}

/** Batch version of `toTaskView` — one name lookup and one summary query total. */
export function toTaskViews(
  db: Database,
  tasks: readonly TaskWithContext[],
  today: IsoDate = todayDate(),
): TaskView[] {
  if (tasks.length === 0) return [];
  const names = userRepo.userNameMap(db);
  const allDeps = [...new Set(tasks.flatMap((t) => t.dependencyTaskIds))];
  const summaries = new Map(taskRepo.findTaskSummaries(db, allDeps).map((s) => [s.id, s]));
  const clarifications = clarificationRepo.listForTasks(db, tasks.map((t) => t.id));
  return tasks.map((task) =>
    buildView(
      task,
      today,
      names,
      task.dependencyTaskIds.map((id) => summaries.get(id)).filter((s) => s !== undefined),
      clarifications.get(task.id) ?? [],
    ),
  );
}

export function getTask(db: Database, actor: Actor, taskId: string, now = new Date()): TaskView {
  const task = taskRepo.findTaskById(db, taskId) ?? taskRepo.findTaskByRef(db, taskId);
  if (!task) throw notFound('Task');
  assertCanViewTask(actor.role, task, actor.id);
  return toTaskView(db, task, todayDate(now));
}

/**
 * List tasks visible to the actor. Employees are always scoped to tasks they
 * own, support or review — the scope is applied here, not trusted from input.
 */
export function listTasks(
  db: Database,
  actor: Actor,
  filter: taskRepo.TaskFilter = {},
  now = new Date(),
): TaskView[] {
  const scoped: taskRepo.TaskFilter =
    actor.role === Role.Manager ? filter : { ...filter, participantId: actor.id };
  return toTaskViews(db, taskRepo.listTasks(db, scoped), todayDate(now));
}

// --- creation -------------------------------------------------------------

export type CreateTaskInput = {
  /** Required parent. Milestone and deliverable are optional. */
  workstreamId: string;
  milestoneId?: string | null;
  deliverableId?: string | null;
  title: string;
  description?: string | null;
  /** Omit to leave the task unassigned rather than guessing an owner. */
  ownerId?: string | null;
  reviewerId?: string | null;
  supportingMemberIds?: readonly string[];
  /** Omit to leave the priority unassigned rather than guessing one. */
  priority?: Priority | null;
  /** Required. Undated work cannot be chased, so it is not accepted. */
  startDate: IsoDate;
  /** Required, and at most `maxTaskSpanDays` days after the start date. */
  dueDate: IsoDate;
  /** One per calendar day; required once the task covers more than one day. */
  dayPlans?: readonly TaskDayPlan[];
  dependencyTaskIds?: readonly string[];
  nextAction?: string | null;
};

export function createTask(
  db: Database,
  actor: Actor,
  input: CreateTaskInput,
  now = new Date(),
): TaskView {
  assertCan(actor.role, Capability.CreateTask);

  const ancestry = hierarchyRepo.findWorkstreamAncestry(db, input.workstreamId);
  if (!ancestry) throw notFound('Workstream');

  if (input.milestoneId) {
    const milestone = hierarchyRepo.findMilestoneById(db, input.milestoneId);
    if (!milestone) throw notFound('Milestone');
    if (milestone.workstreamId !== input.workstreamId) {
      throw validationError('Milestone does not belong to the selected workstream', [
        { path: 'milestoneId', message: 'must belong to the selected workstream' },
      ]);
    }
  }

  if (input.deliverableId) {
    const deliverable = hierarchyRepo.findDeliverableById(db, input.deliverableId);
    if (!deliverable) throw notFound('Deliverable');
    if (deliverable.milestoneId !== input.milestoneId) {
      throw validationError('Deliverable does not belong to the selected milestone', [
        { path: 'deliverableId', message: 'must belong to the selected milestone' },
      ]);
    }
  }

  if (input.ownerId) assertActiveUser(db, input.ownerId, 'ownerId', 'Owner');
  if (input.reviewerId) assertActiveUser(db, input.reviewerId, 'reviewerId', 'Reviewer');
  for (const id of input.supportingMemberIds ?? []) {
    assertActiveUser(db, id, 'supportingMemberIds', 'Supporting member');
  }
  // Dates are mandatory, bounded in length, and a multi-day task has to say
  // what each of its days delivers. All three are decided in one place.
  const schedule = normaliseSchedule(input, maxSpanDays());
  assertDependenciesExist(db, input.dependencyTaskIds ?? []);

  return transaction(db, () => {
    const sequence = hierarchyRepo.nextTaskSequence(db, ancestry.projectId);
    const ref = formatTaskRef(ancestry.projectCode, ancestry.workstreamCode, sequence);

    const taskId = taskRepo.insertTask(db, {
      ref,
      workstreamId: input.workstreamId,
      milestoneId: input.milestoneId ?? null,
      deliverableId: input.deliverableId ?? null,
      title: input.title,
      description: input.description ?? null,
      ownerId: input.ownerId ?? null,
      reviewerId: input.reviewerId ?? null,
      priority: input.priority ?? null,
      status: TaskStatus.NotStarted,
      progress: 0,
      startDate: schedule.startDate,
      dueDate: schedule.dueDate,
      nextAction: input.nextAction ?? null,
      createdById: actor.id,
      supportingMemberIds: input.supportingMemberIds ?? [],
      dependencyTaskIds: input.dependencyTaskIds ?? [],
      dayPlans: schedule.dayPlans,
    });

    const ownerName = input.ownerId
      ? (userRepo.findUserById(db, input.ownerId)?.name ?? 'Unknown')
      : 'nobody yet';
    const priorityText = input.priority ?? 'priority not assigned';
    const timestamp = nowTimestamp(now);
    activityRepo.appendHistory(db, {
      taskId,
      actorId: actor.id,
      kind: HistoryKind.Created,
      note:
        `Task created and assigned to ${ownerName}, ` +
        `${describeSchedule(schedule.startDate, schedule.dueDate)} (${priorityText}).`,
      createdAt: timestamp,
    });

    // The day-by-day plan is part of the commitment, so it belongs in the log
    // next to the dates rather than only in the task record. One entry for the
    // whole plan, not one per day — the feed stays readable.
    if (schedule.dayPlans.length > 0) {
      activityRepo.appendHistory(db, {
        taskId,
        actorId: actor.id,
        kind: HistoryKind.FieldChanged,
        field: 'dayPlans',
        fromValue: null,
        toValue: formatDayPlans(schedule.dayPlans),
        note: `Outcomes defined for each of the ${schedule.spanDays} days.`,
        createdAt: timestamp,
      });
    }

    // Anything left undecided at creation goes straight onto the manager's
    // clarification queue instead of being silently defaulted. Dates are no
    // longer among them: a task cannot be created without them.
    if (!input.priority) {
      clarificationRepo.raiseClarification(db, {
        taskId,
        code: ClarificationCode.MissingPriority,
        detail: 'No priority was set when the task was created.',
      });
    }
    if (!input.ownerId) {
      clarificationRepo.raiseClarification(db, {
        taskId,
        code: ClarificationCode.UnclearOwner,
        detail: 'The task was created without an owner. Assign one.',
      });
    }

    const created = taskRepo.findTaskById(db, taskId);
    if (!created) throw notFound('Task');
    return toTaskView(db, created, todayDate(now));
  });
}

function assertActiveUser(db: Database, userId: string, path: string, label: string): void {
  const user = userRepo.findUserById(db, userId);
  if (!user) throw validationError(`${label} not found`, [{ path, message: 'is not a known user' }]);
  if (!user.active) {
    throw validationError(`${label} is deactivated`, [{ path, message: 'is not an active user' }]);
  }
}

function assertDependenciesExist(db: Database, ids: readonly string[]): void {
  if (ids.length === 0) return;
  const found = new Set(taskRepo.findTaskSummaries(db, ids).map((s) => s.id));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw validationError('Unknown dependency task', [
      { path: 'dependencyTaskIds', message: `unknown task id(s): ${missing.join(', ')}` },
    ]);
  }
}

/** Depth-first search over `task_dependencies` to keep the graph acyclic. */
function wouldCreateCycle(db: Database, taskId: string, dependencyIds: readonly string[]): boolean {
  const edges = db
    .prepare('SELECT task_id, depends_on_task_id FROM task_dependencies')
    .all() as { task_id: string; depends_on_task_id: string }[];
  const graph = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.task_id === taskId) continue; // existing edges are being replaced
    const list = graph.get(edge.task_id) ?? [];
    list.push(edge.depends_on_task_id);
    graph.set(edge.task_id, list);
  }
  graph.set(taskId, [...dependencyIds]);

  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (node: string): boolean => {
    if (visiting.has(node)) return true;
    if (done.has(node)) return false;
    visiting.add(node);
    for (const next of graph.get(node) ?? []) {
      if (visit(next)) return true;
    }
    visiting.delete(node);
    done.add(node);
    return false;
  };
  return visit(taskId);
}

// --- updates --------------------------------------------------------------

export type UpdateTaskInput = {
  status?: TaskStatus;
  progress?: number;
  progressNote?: string | null;
  reviewNote?: string | null;
  blocker?: string | null;
  nextAction?: string | null;
  evidenceUrl?: string | null;
  title?: string;
  description?: string | null;
  /** `null` clears the owner, leaving the task unassigned. */
  ownerId?: string | null;
  reviewerId?: string | null;
  supportingMemberIds?: readonly string[];
  priority?: Priority | null;
  /** Movable, never clearable — see the create schema. */
  startDate?: IsoDate;
  dueDate?: IsoDate;
  /** The complete day-by-day plan for the task's dates, not a partial patch. */
  dayPlans?: readonly TaskDayPlan[];
  milestoneId?: string | null;
  deliverableId?: string | null;
  dependencyTaskIds?: readonly string[];
  /** Optional note recorded as a comment in the same transaction. */
  comment?: string;
};

const labelOf = (value: string | null): string => value ?? '\u2014';
/** "Mar 3: wiring loom routed · Mar 4: bench test passed" — one history value. */
const formatDayPlans = (plans: readonly TaskDayPlan[]): string =>
  plans.length === 0
    ? '\u2014'
    : plans.map((p) => `${formatDateHuman(p.date)}: ${p.outcome}`).join(' \u00b7 ');
const dateLabel = (value: IsoDate | null): string =>
  value === null ? 'not set' : formatDateHuman(value);
const priorityLabel = (value: Priority | null): string =>
  value === null ? 'not assigned' : PRIORITY_LABEL[value];

export function updateTask(
  db: Database,
  actor: Actor,
  taskId: string,
  input: UpdateTaskInput,
  now = new Date(),
): TaskView {
  const task = taskRepo.findTaskById(db, taskId) ?? taskRepo.findTaskByRef(db, taskId);
  if (!task) throw notFound('Task');
  assertCanUpdateTask(actor.role, task, actor.id);

  const { comment, ...fields } = input;
  const touched = Object.keys(fields) as TaskField[];
  assertCanWriteTaskFields(actor.role, touched);
  if (touched.length === 0 && comment === undefined) {
    throw validationError('Nothing to update', [{ path: 'body', message: 'provide at least one field' }]);
  }

  const timestamp = nowTimestamp(now);
  const patch: taskRepo.TaskColumnPatch = {};
  const history: activityRepo.NewHistoryEntry[] = [];
  /** Clarifications this update actually fills in, cleared on commit. */
  const resolvedCodes: ClarificationCode[] = [];
  const record = (entry: Omit<activityRepo.NewHistoryEntry, 'taskId' | 'actorId' | 'createdAt'>): void => {
    history.push({ ...entry, taskId: task.id, actorId: actor.id, createdAt: timestamp });
  };

  // --- status -------------------------------------------------------------
  let nextStatus = task.status;
  if (fields.status !== undefined && fields.status !== task.status) {
    assertTransition(task.status, fields.status, actor.role);
    nextStatus = fields.status;
    patch.status = nextStatus;
    record({
      kind: HistoryKind.StatusChanged,
      field: 'status',
      fromValue: STATUS_LABEL[task.status],
      toValue: STATUS_LABEL[nextStatus],
    });

    const implied = progressForStatus(nextStatus);
    if (implied !== null && fields.progress === undefined && implied !== task.progress) {
      patch.progress = implied;
      record({
        kind: HistoryKind.ProgressChanged,
        field: 'progress',
        fromValue: task.progress === null ? 'unknown' : `${task.progress}%`,
        toValue: `${implied}%`,
        note: 'Set automatically by the status change.',
      });
    }
    patch.completedAt = nextStatus === TaskStatus.Completed ? timestamp : null;
  }

  // Blocked status must name the blocker, otherwise "what is blocked" is useless.
  const blockerAfter = fields.blocker !== undefined ? fields.blocker : task.blocker;
  if (nextStatus === TaskStatus.Blocked && (blockerAfter === null || blockerAfter.trim() === '')) {
    throw validationError('A blocked task must describe its blocker', [
      { path: 'blocker', message: 'is required when the status is Blocked' },
    ]);
  }

  // --- progress -----------------------------------------------------------
  if (fields.progress !== undefined && fields.progress !== task.progress) {
    if (fields.progress < 0 || fields.progress > 100) {
      throw validationError('Progress must be between 0 and 100', [
        { path: 'progress', message: 'must be between 0 and 100' },
      ]);
    }
    const statusAfter = nextStatus;
    if (fields.progress === 100 && statusAfter !== TaskStatus.Completed && statusAfter !== TaskStatus.Review) {
      throw validationError('Move the task to Review before marking it 100% complete', [
        { path: 'progress', message: 'reaching 100% requires the Review or Completed status' },
      ]);
    }
    patch.progress = fields.progress;
    record({
      kind: HistoryKind.ProgressChanged,
      field: 'progress',
      fromValue: task.progress === null ? 'unknown' : `${task.progress}%`,
      toValue: `${fields.progress}%`,
    });
    resolvedCodes.push(ClarificationCode.UnknownProgress);
  }

  // --- blocker ------------------------------------------------------------
  if (fields.blocker !== undefined && fields.blocker !== task.blocker) {
    patch.blocker = fields.blocker;
    const kind =
      task.blocker === null
        ? HistoryKind.BlockerAdded
        : fields.blocker === null
          ? HistoryKind.BlockerCleared
          : HistoryKind.FieldChanged;
    record({ kind, field: 'blocker', fromValue: task.blocker, toValue: fields.blocker });
  }

  if (fields.nextAction !== undefined && fields.nextAction !== task.nextAction) {
    patch.nextAction = fields.nextAction;
    record({
      kind: HistoryKind.NextActionSet,
      field: 'nextAction',
      fromValue: task.nextAction,
      toValue: fields.nextAction,
    });
  }

  if (fields.evidenceUrl !== undefined && fields.evidenceUrl !== task.evidenceUrl) {
    patch.evidenceUrl = fields.evidenceUrl;
    record({
      kind: HistoryKind.EvidenceLinked,
      field: 'evidenceUrl',
      fromValue: task.evidenceUrl,
      toValue: fields.evidenceUrl,
    });
  }

  // --- manager-only fields -------------------------------------------------
  if (fields.ownerId !== undefined && fields.ownerId !== task.ownerId) {
    assertCan(actor.role, Capability.ReassignTask);
    // `null` clears the owner; the task goes back to unassigned rather than
    // being parked on someone.
    if (fields.ownerId !== null) assertActiveUser(db, fields.ownerId, 'ownerId', 'Owner');
    patch.ownerId = fields.ownerId;
    record({
      kind: HistoryKind.Reassigned,
      field: 'ownerId',
      fromValue: task.ownerName ?? 'Unassigned',
      toValue:
        fields.ownerId === null
          ? 'Unassigned'
          : (userRepo.findUserById(db, fields.ownerId)?.name ?? fields.ownerId),
    });
    // Naming a single accountable owner is exactly what the question asked for.
    resolvedCodes.push(ClarificationCode.UnclearOwner);
  }

  if (fields.reviewerId !== undefined && fields.reviewerId !== task.reviewerId) {
    if (fields.reviewerId) assertActiveUser(db, fields.reviewerId, 'reviewerId', 'Reviewer');
    patch.reviewerId = fields.reviewerId;
    record({
      kind: HistoryKind.FieldChanged,
      field: 'reviewerId',
      fromValue: labelOf(task.reviewerName),
      toValue: fields.reviewerId
        ? (userRepo.findUserById(db, fields.reviewerId)?.name ?? fields.reviewerId)
        : null,
    });
  }

  if (fields.priority !== undefined && fields.priority !== task.priority) {
    patch.priority = fields.priority;
    record({
      kind: HistoryKind.FieldChanged,
      field: 'priority',
      fromValue: priorityLabel(task.priority),
      toValue: priorityLabel(fields.priority),
    });
    if (fields.priority !== null) resolvedCodes.push(ClarificationCode.MissingPriority);
  }

  if (fields.title !== undefined && fields.title !== task.title) {
    patch.title = fields.title;
    record({ kind: HistoryKind.FieldChanged, field: 'title', fromValue: task.title, toValue: fields.title });
  }

  if (fields.description !== undefined && fields.description !== task.description) {
    patch.description = fields.description;
    record({ kind: HistoryKind.FieldChanged, field: 'description', fromValue: null, toValue: null, note: 'Description updated.' });
  }

  const startAfter = fields.startDate !== undefined ? fields.startDate : task.startDate;
  const dueAfter = fields.dueDate !== undefined ? fields.dueDate : task.dueDate;
  const scheduleTouched =
    fields.startDate !== undefined || fields.dueDate !== undefined || fields.dayPlans !== undefined;

  /** The plan to store, when this update rewrites the schedule. */
  let nextDayPlans: readonly TaskDayPlan[] | null = null;

  if (scheduleTouched) {
    // Re-running the whole rule here is what stops a one-day task being added
    // and then quietly stretched into a month. Outcomes already recorded are
    // carried over where they still fall inside the new dates; days that end
    // up with none are reported rather than silently dropped.
    const carried =
      startAfter !== null && dueAfter !== null
        ? task.dayPlans.filter((plan) => plan.date >= startAfter && plan.date <= dueAfter)
        : [];
    nextDayPlans = normaliseSchedule(
      { startDate: startAfter, dueDate: dueAfter, dayPlans: fields.dayPlans ?? carried },
      maxSpanDays(),
    ).dayPlans;
  }

  if (fields.startDate !== undefined && fields.startDate !== task.startDate) {
    patch.startDate = fields.startDate;
    record({
      kind: HistoryKind.FieldChanged,
      field: 'startDate',
      fromValue: dateLabel(task.startDate),
      toValue: dateLabel(fields.startDate),
    });
  }

  if (fields.dueDate !== undefined && fields.dueDate !== task.dueDate) {
    patch.dueDate = fields.dueDate;
    // The first deadline ever committed to becomes the baseline for slippage.
    if (task.originalDueDate === null) patch.originalDueDate = fields.dueDate;
    record({
      kind: HistoryKind.FieldChanged,
      field: 'dueDate',
      fromValue: dateLabel(task.dueDate),
      toValue: dateLabel(fields.dueDate),
    });
    resolvedCodes.push(ClarificationCode.MissingDueDate);
  }

  if (fields.milestoneId !== undefined && fields.milestoneId !== task.milestoneId) {
    let milestoneName: string | null = null;
    if (fields.milestoneId !== null) {
      const milestone = hierarchyRepo.findMilestoneById(db, fields.milestoneId);
      if (!milestone) throw notFound('Milestone');
      if (milestone.workstreamId !== task.workstreamId) {
        throw validationError('Milestone does not belong to this task\u2019s workstream', [
          { path: 'milestoneId', message: 'must belong to the task workstream' },
        ]);
      }
      milestoneName = milestone.name;
      resolvedCodes.push(ClarificationCode.MissingMilestone);
    }
    patch.milestoneId = fields.milestoneId;
    patch.deliverableId = fields.deliverableId ?? null;
    record({
      kind: HistoryKind.FieldChanged,
      field: 'milestoneId',
      fromValue: labelOf(task.milestoneName),
      toValue: milestoneName,
    });
  } else if (fields.deliverableId !== undefined && fields.deliverableId !== task.deliverableId) {
    if (fields.deliverableId) {
      const deliverable = hierarchyRepo.findDeliverableById(db, fields.deliverableId);
      if (!deliverable) throw notFound('Deliverable');
      if (deliverable.milestoneId !== task.milestoneId) {
        throw validationError('Deliverable does not belong to this task’s milestone', [
          { path: 'deliverableId', message: 'must belong to the task milestone' },
        ]);
      }
    }
    patch.deliverableId = fields.deliverableId;
    record({
      kind: HistoryKind.FieldChanged,
      field: 'deliverableId',
      fromValue: labelOf(task.deliverableName),
      toValue: fields.deliverableId,
    });
  }

  return transaction(db, () => {
    if (fields.supportingMemberIds !== undefined) {
      for (const id of fields.supportingMemberIds) {
        assertActiveUser(db, id, 'supportingMemberIds', 'Supporting member');
      }
      const before = [...task.supportingMemberIds].sort().join(',');
      const after = [...new Set(fields.supportingMemberIds)].sort().join(',');
      if (before !== after) {
        taskRepo.replaceSupporters(db, task.id, fields.supportingMemberIds);
        const names = userRepo.userNameMap(db);
        record({
          kind: HistoryKind.FieldChanged,
          field: 'supportingMemberIds',
          fromValue: task.supportingMemberIds.map((id) => names.get(id) ?? id).join(', ') || '—',
          toValue: fields.supportingMemberIds.map((id) => names.get(id) ?? id).join(', ') || '—',
        });
        // The list was read out of free text; setting it deliberately confirms it.
        resolvedCodes.push(ClarificationCode.InferredSupport);
      }
    }

    if (nextDayPlans !== null) {
      const before = formatDayPlans(task.dayPlans);
      const after = formatDayPlans(nextDayPlans);
      if (before !== after) {
        taskRepo.replaceDayPlans(db, task.id, nextDayPlans);
        record({
          kind: HistoryKind.FieldChanged,
          field: 'dayPlans',
          fromValue: before,
          toValue: after,
        });
      }
      // `normaliseSchedule` has already refused anything short of full cover,
      // so reaching here means every day is accounted for — either by an
      // outcome, or by the task having shrunk back to a single day with
      // nothing left to break down. Either way the gap is closed.
      resolvedCodes.push(ClarificationCode.MissingDayOutcomes);
    }

    if (fields.dependencyTaskIds !== undefined) {
      assertDependenciesExist(db, fields.dependencyTaskIds);
      if (fields.dependencyTaskIds.includes(task.id)) {
        throw validationError('A task cannot depend on itself', [
          { path: 'dependencyTaskIds', message: 'cannot contain the task itself' },
        ]);
      }
      if (wouldCreateCycle(db, task.id, fields.dependencyTaskIds)) {
        throw conflict('That dependency would create a circular chain.');
      }
      const before = [...task.dependencyTaskIds].sort().join(',');
      const after = [...new Set(fields.dependencyTaskIds)].sort().join(',');
      if (before !== after) {
        taskRepo.replaceDependencies(db, task.id, fields.dependencyTaskIds);
        const refs = new Map(
          taskRepo.findTaskSummaries(db, [...task.dependencyTaskIds, ...fields.dependencyTaskIds]).map((s) => [s.id, s.ref]),
        );
        record({
          kind: HistoryKind.FieldChanged,
          field: 'dependencyTaskIds',
          fromValue: task.dependencyTaskIds.map((id) => refs.get(id) ?? id).join(', ') || '—',
          toValue: fields.dependencyTaskIds.map((id) => refs.get(id) ?? id).join(', ') || '—',
        });
      }
    }

    if (Object.keys(patch).length > 0) {
      taskRepo.updateTaskColumns(db, task.id, patch, timestamp);
    } else if (history.length > 0 || comment !== undefined) {
      taskRepo.touchTask(db, task.id, timestamp);
    }

    if (comment !== undefined && comment.trim() !== '') {
      activityRepo.insertComment(db, {
        taskId: task.id,
        authorId: actor.id,
        body: comment.trim(),
        createdAt: timestamp,
      });
      record({ kind: HistoryKind.CommentAdded, note: comment.trim().slice(0, 200) });
    }

    activityRepo.appendHistoryBatch(db, history);

    // A gap stops being a gap once someone fills it in.
    for (const code of new Set(resolvedCodes)) {
      clarificationRepo.resolveByCode(db, task.id, code, actor.id);
    }

    const updated = taskRepo.findTaskById(db, task.id);
    if (!updated) throw notFound('Task');
    return toTaskView(db, updated, todayDate(now));
  });
}

export type BulkAssignInput = {
  taskIds: readonly string[];
  /** Omit to leave owners alone; `null` to clear them. */
  ownerId?: string | null;
  priority?: Priority | null;
};

export type BulkAssignResult = {
  updated: number;
  skipped: { taskId: string; reason: string }[];
};

/**
 * Assign an owner and/or a priority across many tasks at once.
 *
 * Twenty-eight tasks assigned one at a time is twenty-eight page loads, which
 * is why the plan sat unassigned. Everything still goes through `updateTask`,
 * so the field policy, the history log and the clarification clearing all
 * behave exactly as they do for a single edit — this only removes the tedium,
 * not the rules.
 */
export function bulkAssign(
  db: Database,
  actor: Actor,
  input: BulkAssignInput,
  now = new Date(),
): BulkAssignResult {
  assertCan(actor.role, Capability.BulkAssignTasks);
  if (input.ownerId === undefined && input.priority === undefined) {
    throw validationError('Nothing to apply', [
      { path: 'body', message: 'provide an owner, a priority, or both' },
    ]);
  }
  if (input.taskIds.length === 0) {
    throw validationError('No tasks selected', [{ path: 'taskIds', message: 'must not be empty' }]);
  }
  if (input.ownerId) assertActiveUser(db, input.ownerId, 'ownerId', 'Owner');

  const skipped: BulkAssignResult['skipped'] = [];
  let updated = 0;

  return transaction(db, () => {
    for (const taskId of new Set(input.taskIds)) {
      const patch: UpdateTaskInput = {};
      if (input.ownerId !== undefined) patch.ownerId = input.ownerId;
      if (input.priority !== undefined) patch.priority = input.priority;
      try {
        updateTask(db, actor, taskId, patch, now);
        updated += 1;
      } catch (error) {
        // One unassignable task must not abandon the other twenty-seven.
        skipped.push({
          taskId,
          reason: error instanceof Error ? error.message : 'Could not be updated',
        });
      }
    }
    return { updated, skipped };
  });
}

/** Statuses this actor may move the task to right now — drives the UI dropdown. */
export function availableTransitions(task: { status: TaskStatus }, actor: Actor): TaskStatus[] {
  return [...allowedTransitions(task.status, actor.role)];
}

// --- comments & history ---------------------------------------------------

export function addComment(
  db: Database,
  actor: Actor,
  taskId: string,
  body: string,
  now = new Date(),
): Comment {
  const task = taskRepo.findTaskById(db, taskId);
  if (!task) throw notFound('Task');
  assertCanViewTask(actor.role, task, actor.id);

  return transaction(db, () => {
    const timestamp = nowTimestamp(now);
    const comment = activityRepo.insertComment(db, {
      taskId: task.id,
      authorId: actor.id,
      body,
      createdAt: timestamp,
    });
    activityRepo.appendHistory(db, {
      taskId: task.id,
      actorId: actor.id,
      kind: HistoryKind.CommentAdded,
      note: body.slice(0, 200),
      createdAt: timestamp,
    });
    taskRepo.touchTask(db, task.id, timestamp);
    return comment;
  });
}

export function listComments(db: Database, actor: Actor, taskId: string): Comment[] {
  const task = taskRepo.findTaskById(db, taskId);
  if (!task) throw notFound('Task');
  assertCanViewTask(actor.role, task, actor.id);
  return activityRepo.listCommentsForTask(db, task.id);
}

export function listHistory(db: Database, actor: Actor, taskId: string): TaskHistoryEntry[] {
  const task = taskRepo.findTaskById(db, taskId);
  if (!task) throw notFound('Task');
  assertCanViewTask(actor.role, task, actor.id);
  return activityRepo.listHistoryForTask(db, task.id);
}

/** Team-wide feed for managers; scoped to the actor's own tasks otherwise. */
export function listActivityFeed(
  db: Database,
  actor: Actor,
  limit = 60,
): (TaskHistoryEntry & { taskRef: string; taskTitle: string })[] {
  return actor.role === Role.Manager
    ? activityRepo.listRecentHistory(db, { limit })
    : activityRepo.listRecentHistory(db, { limit, participantId: actor.id });
}

// --- deadline change requests --------------------------------------------

export function requestDeadlineChange(
  db: Database,
  actor: Actor,
  taskId: string,
  input: { requestedDueDate: IsoDate; reason: string },
  now = new Date(),
): DeadlineChangeRequest {
  const task = taskRepo.findTaskById(db, taskId);
  if (!task) throw notFound('Task');
  assertCanViewTask(actor.role, task, actor.id);
  if (task.ownerId !== actor.id && actor.role !== Role.Manager) {
    throw forbidden('Only the task owner can request a deadline change.');
  }
  if (task.dueDate === null) {
    throw validationError('This task has no deadline to change yet', [
      { path: 'requestedDueDate', message: 'the task has no due date — a manager must set one first' },
    ]);
  }
  if (input.requestedDueDate === task.dueDate) {
    throw validationError('The requested date matches the current deadline', [
      { path: 'requestedDueDate', message: 'must differ from the current due date' },
    ]);
  }
  // The span limit is a policy about the work, not about who is asking, so an
  // extension cannot be used to route around it. Imported tasks with no start
  // date have no span to measure and are left alone.
  if (task.startDate !== null) {
    const requestedSpan = taskSpanDays(task.startDate, input.requestedDueDate);
    if (requestedSpan < 1) {
      throw validationError('The requested date is before the task starts', [
        { path: 'requestedDueDate', message: 'must be on or after the start date' },
      ]);
    }
    if (requestedSpan > maxSpanDays()) {
      throw validationError(
        `That would make the task span ${requestedSpan} days; the limit is ${maxSpanDays()}. ` +
          'Split the remaining work into a new task instead.',
        [{ path: 'requestedDueDate', message: `must be within ${maxSpanDays()} day(s) of the start date` }],
      );
    }
  }
  if (deadlineRepo.findPendingRequestForTask(db, task.id)) {
    throw conflict('This task already has a deadline change awaiting a decision.');
  }
  // Captured after the null check so the closure below sees a narrowed value.
  const currentDueDate = task.dueDate;

  return transaction(db, () => {
    const timestamp = nowTimestamp(now);
    const id = deadlineRepo.insertDeadlineRequest(db, {
      taskId: task.id,
      requestedById: actor.id,
      currentDueDate,
      requestedDueDate: input.requestedDueDate,
      reason: input.reason,
      createdAt: timestamp,
    });
    activityRepo.appendHistory(db, {
      taskId: task.id,
      actorId: actor.id,
      kind: HistoryKind.DeadlineChangeRequested,
      field: 'dueDate',
      fromValue: formatDateHuman(currentDueDate),
      toValue: formatDateHuman(input.requestedDueDate),
      note: input.reason,
      createdAt: timestamp,
    });
    taskRepo.touchTask(db, task.id, timestamp);
    const created = deadlineRepo.findDeadlineRequest(db, id);
    if (!created) throw notFound('Deadline change request');
    return created;
  });
}

export function decideDeadlineChange(
  db: Database,
  actor: Actor,
  requestId: string,
  decision: { approve: boolean; note?: string | null },
  now = new Date(),
): DeadlineChangeRequest {
  assertCan(actor.role, Capability.DecideDeadlineRequest);
  const request = deadlineRepo.findDeadlineRequest(db, requestId);
  if (!request) throw notFound('Deadline change request');
  if (request.status !== DeadlineRequestStatus.Pending) {
    throw conflict('This request has already been decided.');
  }

  return transaction(db, () => {
    const timestamp = nowTimestamp(now);
    deadlineRepo.decideDeadlineRequest(db, {
      id: request.id,
      status: decision.approve ? DeadlineRequestStatus.Approved : DeadlineRequestStatus.Rejected,
      decidedById: actor.id,
      decisionNote: decision.note ?? null,
      decidedAt: timestamp,
    });

    if (decision.approve) {
      // `original_due_date` is deliberately left untouched so slippage against
      // the first commitment stays visible after any number of extensions.
      taskRepo.updateTaskColumns(db, request.taskId, { dueDate: request.requestedDueDate }, timestamp);
      applyDayPlanGapAfterReschedule(db, request.taskId, request.requestedDueDate, actor.id);
    }

    activityRepo.appendHistory(db, {
      taskId: request.taskId,
      actorId: actor.id,
      kind: decision.approve
        ? HistoryKind.DeadlineChangeApproved
        : HistoryKind.DeadlineChangeRejected,
      field: 'dueDate',
      fromValue: formatDateHuman(request.currentDueDate),
      toValue: formatDateHuman(request.requestedDueDate),
      note: decision.note ?? null,
      createdAt: timestamp,
    });

    const decided = deadlineRepo.findDeadlineRequest(db, request.id);
    if (!decided) throw notFound('Deadline change request');
    return decided;
  });
}

/**
 * An approved extension moves the end date without anyone having said what the
 * newly added days deliver. Rather than invent outcomes — or drop the rule —
 * the gap goes onto the manager's clarification queue, where the rest of the
 * "unknown is not decided" handling already lives. Setting `dayPlans` through
 * `updateTask` closes it.
 */
function applyDayPlanGapAfterReschedule(
  db: Database,
  taskId: string,
  newDueDate: IsoDate,
  actorId: string,
): void {
  const task = taskRepo.findTaskById(db, taskId);
  if (!task || task.startDate === null) return;

  taskRepo.pruneDayPlansOutside(db, taskId, task.startDate, newDueDate);
  const kept = task.dayPlans.filter(
    (plan) => plan.date >= (task.startDate as IsoDate) && plan.date <= newDueDate,
  );

  if (!needsDayOutcomes(task.startDate, newDueDate)) {
    // Back to a single day: there is nothing left to define.
    clarificationRepo.resolveByCode(db, taskId, ClarificationCode.MissingDayOutcomes, actorId);
    return;
  }

  const gaps = uncoveredDays(task.startDate, newDueDate, kept);
  if (gaps.length === 0) {
    clarificationRepo.resolveByCode(db, taskId, ClarificationCode.MissingDayOutcomes, actorId);
    return;
  }
  clarificationRepo.raiseClarification(db, {
    taskId,
    code: ClarificationCode.MissingDayOutcomes,
    detail: missingOutcomesDetail(gaps),
  });
}

export function listDeadlineRequests(
  db: Database,
  actor: Actor,
  opts: { status?: DeadlineRequestStatus } = {},
): DeadlineChangeRequest[] {
  if (actor.role === Role.Manager) {
    return deadlineRepo.listDeadlineRequests(db, opts);
  }
  return deadlineRepo.listDeadlineRequests(db, { ...opts, requestedById: actor.id });
}


// --- daily outcome log ----------------------------------------------------

export const MAX_DAY_LOG_OUTCOME_LENGTH = 1000;

export type DayLogInput = {
  /** Defaults to today. A future date is refused — you cannot report forward. */
  logDate?: IsoDate;
  outcome: string;
  progress?: number | null;
  blocker?: string | null;
};

/**
 * Record what a day actually produced.
 *
 * Who: the owner or a supporting member — the people doing the work. A
 * reviewer watches the task but does not report on it, and a manager writing
 * someone else's daily outcome would put words in their mouth, so neither can.
 *
 * When: only while the task is in progress or blocked. A not-started task has
 * produced nothing yet, and a finished one is closed; allowing either would
 * make the log a place to write history rather than a daily report.
 */
export function recordDayOutcome(
  db: Database,
  actor: Actor,
  taskId: string,
  input: DayLogInput,
  now = new Date(),
): TaskDayLog {
  const task = taskRepo.findTaskById(db, taskId) ?? taskRepo.findTaskByRef(db, taskId);
  if (!task) throw notFound('Task');
  assertCanViewTask(actor.role, task, actor.id);

  const isDoer =
    task.ownerId === actor.id || task.supportingMemberIds.includes(actor.id);
  if (!isDoer) {
    throw forbidden(
      'Only the task owner or a supporting member can log a daily outcome — ' +
        'it is a report on work done, not a note about it.',
    );
  }

  if (task.status !== TaskStatus.InProgress && task.status !== TaskStatus.Blocked) {
    throw conflict(
      `A daily outcome can only be logged while a task is in progress or blocked; ` +
        `this one is ${STATUS_LABEL[task.status]}.`,
    );
  }

  const today = todayDate(now);
  const logDate = input.logDate ?? today;
  const details: ErrorDetail[] = [];
  if (logDate > today) {
    details.push({ path: 'logDate', message: 'cannot be in the future' });
  }
  const outcome = input.outcome.trim();
  if (outcome === '') {
    details.push({ path: 'outcome', message: 'say what the day produced' });
  } else if (outcome.length > MAX_DAY_LOG_OUTCOME_LENGTH) {
    details.push({
      path: 'outcome',
      message: `must be at most ${MAX_DAY_LOG_OUTCOME_LENGTH} characters`,
    });
  }
  if (input.progress !== undefined && input.progress !== null) {
    if (!Number.isInteger(input.progress) || input.progress < 0 || input.progress > 100) {
      details.push({ path: 'progress', message: 'must be a whole number between 0 and 100' });
    }
  }
  if (details.length > 0) throw validationError('That daily outcome cannot be recorded', details);

  return transaction(db, () => {
    const timestamp = nowTimestamp(now);
    const existing = dayLogRepo.findDayLog(db, task.id, actor.id, logDate);
    const stored = dayLogRepo.upsertDayLog(
      db,
      { taskId: task.id, authorId: actor.id, logDate, outcome, progress: input.progress, blocker: input.blocker },
      now,
    );

    // The reported progress is the task's progress: one number, not two that
    // can disagree. Recorded as its own history entry so the trail shows why.
    const patch: taskRepo.TaskColumnPatch = {};
    if (input.progress !== undefined && input.progress !== null && input.progress !== task.progress) {
      patch.progress = input.progress;
      activityRepo.appendHistory(db, {
        taskId: task.id,
        actorId: actor.id,
        kind: HistoryKind.ProgressChanged,
        field: 'progress',
        fromValue: task.progress === null ? 'unknown' : `${task.progress}%`,
        toValue: `${input.progress}%`,
        note: `From the daily outcome for ${formatDateHuman(logDate)}.`,
        createdAt: timestamp,
      });
    }
    if (input.blocker !== undefined && (input.blocker ?? null) !== task.blocker) {
      patch.blocker = input.blocker ?? null;
      activityRepo.appendHistory(db, {
        taskId: task.id,
        actorId: actor.id,
        kind: input.blocker ? HistoryKind.BlockerAdded : HistoryKind.BlockerCleared,
        field: 'blocker',
        fromValue: task.blocker,
        toValue: input.blocker ?? null,
        createdAt: timestamp,
      });
    }
    if (Object.keys(patch).length > 0) taskRepo.updateTaskColumns(db, task.id, patch);

    activityRepo.appendHistory(db, {
      taskId: task.id,
      actorId: actor.id,
      kind: HistoryKind.DayOutcomeRecorded,
      field: 'dayLog',
      fromValue: existing === null ? null : existing.outcome,
      toValue: outcome,
      note: formatDateHuman(logDate),
      createdAt: timestamp,
    });
    taskRepo.touchTask(db, task.id, timestamp);
    return stored;
  });
}

/** Every reported day on a task, newest first. Visible to anyone who can see it. */
export function listDayLogs(db: Database, actor: Actor, taskId: string): TaskDayLog[] {
  const task = taskRepo.findTaskById(db, taskId) ?? taskRepo.findTaskByRef(db, taskId);
  if (!task) throw notFound('Task');
  assertCanViewTask(actor.role, task, actor.id);
  return dayLogRepo.listDayLogs(db, task.id);
}

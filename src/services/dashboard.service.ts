/**
 * Dashboard read models.
 *
 * Every bucket here is derived from the pure rules in `domain/exceptions.ts`,
 * so the dashboard and a future automation engine can never disagree about
 * what counts as overdue, blocked or stale.
 */
import type { Database } from '../db/connection.ts';
import * as taskRepo from '../repositories/task.repo.ts';
import * as userRepo from '../repositories/user.repo.ts';
import * as deadlineRepo from '../repositories/deadline.repo.ts';
import * as clarificationRepo from '../repositories/clarification.repo.ts';
import * as hierarchyRepo from '../repositories/hierarchy.repo.ts';
import type { Actor, TaskView, DeadlineChangeRequest } from '../domain/types.ts';
import {
  TaskStatus,
  Role,
  ExceptionFlag,
  PRIORITY_RANK,
  DeadlineRequestStatus,
  CLARIFICATION_LABEL,
  type ClarificationCode,
} from '../domain/enums.ts';
import { Capability, assertCan } from '../domain/permissions.ts';
import { todayDate, addDays, weekBounds, daysBetween, type IsoDate } from '../lib/dates.ts';
import { toTaskViews } from './task.service.ts';

const hasFlag = (task: TaskView, flag: ExceptionFlag): boolean => task.exceptions.includes(flag);
const isOpen = (task: TaskView): boolean => task.status !== TaskStatus.Completed;

/** Undated work sorts after dated work; unassigned priority after assigned. */
const dueKey = (task: TaskView): string => task.dueDate ?? '9999-12-31';
const priorityKey = (task: TaskView): number =>
  task.priority === null ? Number.MAX_SAFE_INTEGER : PRIORITY_RANK[task.priority];

const byAttention = (a: TaskView, b: TaskView): number =>
  b.attentionScore - a.attentionScore ||
  dueKey(a).localeCompare(dueKey(b)) ||
  priorityKey(a) - priorityKey(b);

export type Summary = {
  total: number;
  notStarted: number;
  inProgress: number;
  blocked: number;
  review: number;
  completed: number;
  overdue: number;
  dueToday: number;
  dueThisWeek: number;
  noUpdate: number;
  /** In progress with no daily outcome logged for the last working day. */
  missingDailyUpdate: number;
  /** Proposed dates sitting with a reviewer — work blocked until decided. */
  awaitingScheduleReview: number;
  /** Assigned and budgeted, but with no dates proposed yet. */
  scheduleNotSet: number;
  noDueDate: number;
  noPriority: number;
  completionPercent: number;
};

export function summarise(tasks: readonly TaskView[], today: IsoDate): Summary {
  const status = (s: TaskStatus): number => tasks.filter((t) => t.status === s).length;
  const week = weekBounds(today);
  const completed = status(TaskStatus.Completed);
  return {
    total: tasks.length,
    notStarted: status(TaskStatus.NotStarted),
    inProgress: status(TaskStatus.InProgress),
    blocked: status(TaskStatus.Blocked),
    review: status(TaskStatus.Review),
    completed,
    overdue: tasks.filter((t) => hasFlag(t, ExceptionFlag.Overdue)).length,
    dueToday: tasks.filter((t) => isOpen(t) && t.dueDate === today).length,
    dueThisWeek: tasks.filter(
      (t) => isOpen(t) && t.dueDate !== null && t.dueDate >= week.start && t.dueDate <= week.end,
    ).length,
    noUpdate: tasks.filter((t) => hasFlag(t, ExceptionFlag.NoRecentUpdate)).length,
    missingDailyUpdate: tasks.filter((t) => hasFlag(t, ExceptionFlag.MissingDailyUpdate)).length,
    awaitingScheduleReview: tasks.filter((t) => hasFlag(t, ExceptionFlag.ScheduleAwaitingReview)).length,
    scheduleNotSet: tasks.filter((t) => hasFlag(t, ExceptionFlag.ScheduleNotSet)).length,
    // Open work carrying no agreed deadline at all — invisible to every
    // deadline rule until someone sets one, so it is counted explicitly.
    noDueDate: tasks.filter((t) => isOpen(t) && t.dueDate === null).length,
    noPriority: tasks.filter((t) => isOpen(t) && t.priority === null).length,
    completionPercent: tasks.length === 0 ? 0 : Math.round((completed / tasks.length) * 100),
  };
}

export type ExceptionBuckets = {
  overdue: TaskView[];
  blocked: TaskView[];
  noRecentUpdate: TaskView[];
  dueWithinTwoDays: TaskView[];
  /** In progress, but the last working day produced no reported outcome. */
  missingDailyUpdate: TaskView[];
  /** Dates proposed, reviewer has not decided — nobody can start these. */
  scheduleAwaitingReview: TaskView[];
  /** Assigned and budgeted, but the owner has not proposed dates. */
  scheduleNotSet: TaskView[];
};

/**
 * The exception lists the manager works from. A task can legitimately
 * appear in more than one (e.g. blocked *and* overdue) — that is the point.
 */
export function bucketExceptions(tasks: readonly TaskView[]): ExceptionBuckets {
  const pick = (flag: ExceptionFlag): TaskView[] =>
    tasks.filter((t) => hasFlag(t, flag)).sort(byAttention);
  return {
    overdue: pick(ExceptionFlag.Overdue),
    blocked: pick(ExceptionFlag.Blocked),
    noRecentUpdate: pick(ExceptionFlag.NoRecentUpdate),
    dueWithinTwoDays: pick(ExceptionFlag.DueSoon),
    missingDailyUpdate: pick(ExceptionFlag.MissingDailyUpdate),
    scheduleAwaitingReview: pick(ExceptionFlag.ScheduleAwaitingReview),
    scheduleNotSet: pick(ExceptionFlag.ScheduleNotSet),
  };
}

export type OwnerRollup = {
  userId: string;
  name: string;
  title: string | null;
  total: number;
  open: number;
  overdue: number;
  blocked: number;
  noUpdate: number;
  /** Their in-progress work owing a daily outcome. */
  missingDailyUpdate: number;
  completed: number;
  completionPercent: number;
  /** Highest-attention open task for this person — "what to ask them about". */
  topTask: {
    id: string;
    ref: string;
    title: string;
    dueDate: IsoDate | null;
    status: TaskStatus;
  } | null;
  /** Open tasks of theirs still missing a deadline. */
  noDueDate: number;
};

export type WorkstreamRollup = {
  workstreamId: string;
  code: string;
  name: string;
  projectName: string;
  total: number;
  open: number;
  notStarted: number;
  inProgress: number;
  blocked: number;
  review: number;
  completed: number;
  overdue: number;
  noDueDate: number;
  completionPercent: number;
};

export type ClarificationSummary = {
  total: number;
  byCode: { code: ClarificationCode; label: string; count: number }[];
};

export type ManagerDashboard = {
  generatedFor: IsoDate;
  summary: Summary;
  exceptions: ExceptionBuckets;
  byOwner: OwnerRollup[];
  byWorkstream: WorkstreamRollup[];
  upcoming: TaskView[];
  pendingDeadlineRequests: DeadlineChangeRequest[];
  needsAttention: TaskView[];
  clarifications: ClarificationSummary;
};

export function managerDashboard(db: Database, actor: Actor, now = new Date()): ManagerDashboard {
  assertCan(actor.role, Capability.ViewTeamProgress);
  const today = todayDate(now);
  const tasks = toTaskViews(db, taskRepo.listTasks(db), today);
  const openTasks = tasks.filter(isOpen);

  const people = userRepo.listUsers(db, { activeOnly: true });
  const byOwner: OwnerRollup[] = people
    .map((user) => {
      const owned = tasks.filter((t) => t.ownerId === user.id);
      const open = owned.filter(isOpen);
      const completed = owned.filter((t) => t.status === TaskStatus.Completed).length;
      const top = [...open].sort(byAttention)[0];
      return {
        userId: user.id,
        name: user.name,
        title: user.title,
        total: owned.length,
        open: open.length,
        overdue: owned.filter((t) => hasFlag(t, ExceptionFlag.Overdue)).length,
        blocked: owned.filter((t) => hasFlag(t, ExceptionFlag.Blocked)).length,
        noUpdate: owned.filter((t) => hasFlag(t, ExceptionFlag.NoRecentUpdate)).length,
        missingDailyUpdate: owned.filter((t) => hasFlag(t, ExceptionFlag.MissingDailyUpdate)).length,
        noDueDate: open.filter((t) => t.dueDate === null).length,
        completed,
        completionPercent: owned.length === 0 ? 0 : Math.round((completed / owned.length) * 100),
        topTask: top
          ? { id: top.id, ref: top.ref, title: top.title, dueDate: top.dueDate, status: top.status }
          : null,
      };
    })
    .filter((rollup) => rollup.total > 0)
    .sort((a, b) => b.overdue + b.blocked - (a.overdue + a.blocked) || b.open - a.open);

  const horizon = addDays(today, 7);
  const upcoming = openTasks
    .filter((t) => t.dueDate !== null && t.dueDate >= today && t.dueDate <= horizon)
    .sort((a, b) => dueKey(a).localeCompare(dueKey(b)) || priorityKey(a) - priorityKey(b));

  const byWorkstream: WorkstreamRollup[] = hierarchyRepo
    .listWorkstreams(db)
    .map((workstream) => {
      const inStream = tasks.filter((t) => t.workstreamId === workstream.id);
      const open = inStream.filter(isOpen);
      const count = (status: TaskStatus): number =>
        inStream.filter((t) => t.status === status).length;
      const completed = count(TaskStatus.Completed);
      return {
        workstreamId: workstream.id,
        code: workstream.code,
        name: workstream.name,
        projectName: inStream[0]?.projectName ?? '',
        total: inStream.length,
        open: open.length,
        notStarted: count(TaskStatus.NotStarted),
        inProgress: count(TaskStatus.InProgress),
        blocked: count(TaskStatus.Blocked),
        review: count(TaskStatus.Review),
        completed,
        overdue: inStream.filter((t) => hasFlag(t, ExceptionFlag.Overdue)).length,
        noDueDate: open.filter((t) => t.dueDate === null).length,
        completionPercent:
          inStream.length === 0 ? 0 : Math.round((completed / inStream.length) * 100),
      };
    })
    .filter((rollup) => rollup.total > 0)
    .sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));

  const clarificationCounts = clarificationRepo.countByCode(db, { unresolvedOnly: true });

  return {
    generatedFor: today,
    summary: summarise(tasks, today),
    exceptions: bucketExceptions(tasks),
    byOwner,
    byWorkstream,
    upcoming,
    pendingDeadlineRequests: deadlineRepo.listDeadlineRequests(db, {
      status: DeadlineRequestStatus.Pending,
    }),
    needsAttention: openTasks.filter((t) => t.exceptions.length > 0).sort(byAttention).slice(0, 12),
    clarifications: {
      total: clarificationRepo.countUnresolved(db),
      byCode: [...clarificationCounts.entries()]
        .map(([code, count]) => ({
          code: code as ClarificationCode,
          label: CLARIFICATION_LABEL[code as ClarificationCode] ?? code,
          count,
        }))
        .sort((a, b) => b.count - a.count),
    },
  };
}

export type EmployeeDashboard = {
  generatedFor: IsoDate;
  summary: Summary;
  /** Default view: the most important open work first. */
  focus: TaskView[];
  dueToday: TaskView[];
  dueTomorrow: TaskView[];
  dueThisWeek: TaskView[];
  overdue: TaskView[];
  blocked: TaskView[];
  awaitingReview: TaskView[];
  recentlyCompleted: TaskView[];
  needsUpdate: TaskView[];
  /** My in-progress work owing a daily outcome. */
  needsDailyOutcome: TaskView[];
  /** My open work with no agreed deadline. */
  noDueDate: TaskView[];
  myDeadlineRequests: DeadlineChangeRequest[];
};

export function employeeDashboard(
  db: Database,
  actor: Actor,
  targetUserId?: string,
  now = new Date(),
): EmployeeDashboard {
  // Managers may inspect any individual's board; employees only ever see theirs.
  const userId = actor.role === Role.Manager && targetUserId ? targetUserId : actor.id;
  const today = todayDate(now);
  const tomorrow = addDays(today, 1);
  const week = weekBounds(today);

  const tasks = toTaskViews(db, taskRepo.listTasks(db, { participantId: userId }), today);
  const open = tasks.filter(isOpen);

  const recentlyCompleted = tasks
    .filter((t) => t.status === TaskStatus.Completed && t.completedAt !== null)
    .filter((t) => daysBetween((t.completedAt ?? '').slice(0, 10), today) <= 14)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
    .slice(0, 10);

  return {
    generatedFor: today,
    summary: summarise(tasks, today),
    focus: [...open].sort(byAttention),
    dueToday: open.filter((t) => t.dueDate === today).sort(byAttention),
    dueTomorrow: open.filter((t) => t.dueDate === tomorrow).sort(byAttention),
    dueThisWeek: open
      .filter((t) => t.dueDate !== null && t.dueDate >= week.start && t.dueDate <= week.end)
      .sort((a, b) => dueKey(a).localeCompare(dueKey(b)) || byAttention(a, b)),
    overdue: open.filter((t) => hasFlag(t, ExceptionFlag.Overdue)).sort(byAttention),
    blocked: open.filter((t) => hasFlag(t, ExceptionFlag.Blocked)).sort(byAttention),
    awaitingReview: open.filter((t) => t.status === TaskStatus.Review).sort(byAttention),
    recentlyCompleted,
    needsUpdate: open.filter((t) => hasFlag(t, ExceptionFlag.NoRecentUpdate)).sort(byAttention),
    needsDailyOutcome: open
      .filter((t) => hasFlag(t, ExceptionFlag.MissingDailyUpdate))
      .sort(byAttention),
    noDueDate: open.filter((t) => t.dueDate === null).sort(byAttention),
    myDeadlineRequests: deadlineRepo.listDeadlineRequests(db, { requestedById: userId }),
  };
}

export const SortKey = {
  Priority: 'priority',
  DueDate: 'dueDate',
  Status: 'status',
  Attention: 'attention',
} as const;
export type SortKey = (typeof SortKey)[keyof typeof SortKey];

const STATUS_ORDER: Record<TaskStatus, number> = {
  blocked: 0,
  in_progress: 1,
  review: 2,
  not_started: 3,
  completed: 4,
};

/** Shared sorting used by the task list screen. */
export function sortTasks(tasks: readonly TaskView[], key: SortKey): TaskView[] {
  const copy = [...tasks];
  switch (key) {
    case SortKey.Priority:
      return copy.sort(
        (a, b) => priorityKey(a) - priorityKey(b) || dueKey(a).localeCompare(dueKey(b)),
      );
    case SortKey.DueDate:
      return copy.sort(
        (a, b) => dueKey(a).localeCompare(dueKey(b)) || priorityKey(a) - priorityKey(b),
      );
    case SortKey.Status:
      return copy.sort(
        (a, b) =>
          STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.attentionScore - a.attentionScore,
      );
    case SortKey.Attention:
    default:
      return copy.sort(byAttention);
  }
}

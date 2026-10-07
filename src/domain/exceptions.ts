/**
 * Exception rules — the heart of the accountability model.
 *
 * These are pure functions over a minimal shape (not the full Task row) so the
 * same rules can later be driven by an automation engine, a scheduled job or a
 * notification dispatcher without touching the task code.
 *
 * Notifications are intentionally NOT fired here; Layer 1 only computes flags.
 */
import { ExceptionFlag, TaskStatus, ScheduleState } from './enums.ts';
import {
  todayDate,
  dateOfTimestamp,
  daysBetween,
  workingDaysBetween,
  type IsoDate,
  type IsoTimestamp,
} from '../lib/dates.ts';

/**
 * The minimum a record must expose to be evaluated by the rules.
 *
 * `dueDate` is nullable on purpose: a task with no agreed deadline cannot be
 * late. Treating "no deadline" as a deadline would manufacture false overdue
 * signals, so the deadline rules simply do not apply until one is set — the
 * missing deadline is surfaced through the clarification queue instead.
 */
export type EvaluableTask = {
  readonly status: TaskStatus;
  readonly dueDate: IsoDate | null;
  readonly lastUpdatedAt: IsoTimestamp;
  /**
   * Most recent day a daily outcome was logged against the task.
   *
   * Three states, and the difference matters: `undefined` means the caller did
   * not load logs and the daily-update rule stays silent rather than guessing;
   * `null` means loaded and there are none; a date means loaded and that was
   * the last one.
   */
  readonly lastDayLogDate?: IsoDate | null;
  /** Omitted by callers that do not load it; the rules then stay silent. */
  readonly scheduleState?: ScheduleState;
};

export type RuleThresholds = {
  readonly dueSoonDays: number;
  readonly noUpdateWorkingDays: number;
  /**
   * Working days a task may be in progress without a daily outcome before it
   * is chased. 1 means "yesterday was fine, skipping a whole working day is not".
   */
  readonly dailyUpdateWorkingDays: number;
};

export const DEFAULT_THRESHOLDS: RuleThresholds = {
  dueSoonDays: 2,
  noUpdateWorkingDays: 2,
  dailyUpdateWorkingDays: 1,
};

/** Completed work is never an exception, whatever its dates say. */
export const isOpen = (task: EvaluableTask): boolean => task.status !== TaskStatus.Completed;

/** A deadline rule can only fire once a deadline exists. */
export const hasDeadline = (task: EvaluableTask): task is EvaluableTask & { dueDate: IsoDate } =>
  task.dueDate !== null;

/** Due Date < Today AND Status != Completed */
export function isOverdue(task: EvaluableTask, today: IsoDate = todayDate()): boolean {
  return isOpen(task) && hasDeadline(task) && daysBetween(today, task.dueDate) < 0;
}

/**
 * Due Date <= Today + N days AND Status != Completed.
 * Overdue tasks also satisfy this; `evaluateTask` reports the more severe flag
 * only, so a task is never listed as both OVERDUE and DUE SOON.
 */
export function isDueSoon(
  task: EvaluableTask,
  today: IsoDate = todayDate(),
  thresholds: RuleThresholds = DEFAULT_THRESHOLDS,
): boolean {
  return (
    isOpen(task) && hasDeadline(task) && daysBetween(today, task.dueDate) <= thresholds.dueSoonDays
  );
}

/** Today - Last Updated At > N working days AND Status != Completed */
export function hasNoRecentUpdate(
  task: EvaluableTask,
  today: IsoDate = todayDate(),
  thresholds: RuleThresholds = DEFAULT_THRESHOLDS,
): boolean {
  if (!isOpen(task)) return false;
  const elapsed = workingDaysBetween(dateOfTimestamp(task.lastUpdatedAt), today);
  return elapsed > thresholds.noUpdateWorkingDays;
}

/**
 * In progress, and the last working day produced no reported outcome.
 *
 * Deliberately narrower than NO_RECENT_UPDATE: that rule watches any edit to
 * the task, this one watches the daily report specifically. A task can be
 * edited daily and still never say what a day delivered.
 *
 * Only live work is chased. Blocked work is already flagged as blocked, and
 * asking someone to file a daily outcome on a task they cannot progress is
 * noise rather than accountability.
 */
export function needsDailyUpdate(
  task: EvaluableTask,
  today: IsoDate = todayDate(),
  thresholds: RuleThresholds = DEFAULT_THRESHOLDS,
): boolean {
  if (task.status !== TaskStatus.InProgress) return false;
  if (task.lastDayLogDate === undefined) return false;
  if (task.lastDayLogDate === null) return true;
  return workingDaysBetween(task.lastDayLogDate, today) > thresholds.dailyUpdateWorkingDays;
}

/**
 * Budgeted and assigned, but the owner has not proposed dates yet.
 *
 * Only Not Started work can be in this state — nothing can begin until its
 * schedule is agreed — so this is the queue of work waiting on its owner.
 */
export const needsSchedule = (task: EvaluableTask): boolean =>
  isOpen(task) &&
  task.status === TaskStatus.NotStarted &&
  task.scheduleState === ScheduleState.Unset;

/**
 * Dates proposed, reviewer has not decided.
 *
 * This one blocks work outright, so it is the flag that says somebody is
 * sitting idle waiting on a review rather than merely running late.
 */
export const awaitingScheduleReview = (task: EvaluableTask): boolean =>
  isOpen(task) && task.scheduleState === ScheduleState.Proposed;

/** Status == Blocked */
export const isBlocked = (task: EvaluableTask): boolean => task.status === TaskStatus.Blocked;

export const isDueToday = (task: EvaluableTask, today: IsoDate = todayDate()): boolean =>
  isOpen(task) && task.dueDate === today;

/** No agreed deadline AND still open — the manager needs to set one. */
export const needsDeadline = (task: EvaluableTask): boolean => isOpen(task) && !hasDeadline(task);

export const isDueWithin = (
  task: EvaluableTask,
  days: number,
  today: IsoDate = todayDate(),
): boolean => {
  if (!isOpen(task) || !hasDeadline(task)) return false;
  const delta = daysBetween(today, task.dueDate);
  return delta >= 0 && delta <= days;
};

/**
 * All flags that apply to a task. OVERDUE suppresses DUE_SOON so each task
 * appears in exactly one deadline bucket on the dashboards.
 */
export function evaluateTask(
  task: EvaluableTask,
  today: IsoDate = todayDate(),
  thresholds: RuleThresholds = DEFAULT_THRESHOLDS,
): ExceptionFlag[] {
  const flags: ExceptionFlag[] = [];
  const overdue = isOverdue(task, today);
  if (overdue) flags.push(ExceptionFlag.Overdue);
  else if (isDueSoon(task, today, thresholds)) flags.push(ExceptionFlag.DueSoon);
  if (isBlocked(task)) flags.push(ExceptionFlag.Blocked);
  if (hasNoRecentUpdate(task, today, thresholds)) flags.push(ExceptionFlag.NoRecentUpdate);
  if (needsDailyUpdate(task, today, thresholds)) flags.push(ExceptionFlag.MissingDailyUpdate);
  if (needsSchedule(task)) flags.push(ExceptionFlag.ScheduleNotSet);
  if (awaitingScheduleReview(task)) flags.push(ExceptionFlag.ScheduleAwaitingReview);
  return flags;
}

export const hasFlag = (flags: readonly ExceptionFlag[], flag: ExceptionFlag): boolean =>
  flags.includes(flag);

/**
 * Attention score — higher means it needs looking at sooner. Used to order the
 * employee's default view and the manager's exception lists so the most
 * important item is always first.
 */
/**
 * Attention score -- higher means it needs looking at sooner. Used to order the
 * employee's default view and the manager's exception lists so the most
 * important item is always first.
 *
 * An unassigned priority contributes nothing rather than being scored as if it
 * were normal; the task still surfaces through the clarification queue.
 */
export function attentionScore(
  task: EvaluableTask & { priority: 'P0' | 'P1' | 'P2' | 'P3' | null },
  today: IsoDate = todayDate(),
  thresholds: RuleThresholds = DEFAULT_THRESHOLDS,
): number {
  if (!isOpen(task)) return 0;
  const flags = evaluateTask(task, today, thresholds);
  let score = task.priority === null ? 0 : { P0: 40, P1: 30, P2: 20, P3: 10 }[task.priority];
  if (flags.includes(ExceptionFlag.Overdue) && hasDeadline(task)) {
    score += 100 + Math.min(-daysBetween(today, task.dueDate), 30);
  }
  if (flags.includes(ExceptionFlag.Blocked)) score += 60;
  if (flags.includes(ExceptionFlag.DueSoon)) score += 35;
  if (flags.includes(ExceptionFlag.NoRecentUpdate)) score += 25;
  if (flags.includes(ExceptionFlag.MissingDailyUpdate)) score += 20;
  // Nobody can work on these at all, so they outrank a merely stale update.
  if (flags.includes(ExceptionFlag.ScheduleAwaitingReview)) score += 45;
  if (flags.includes(ExceptionFlag.ScheduleNotSet)) score += 30;
  return score;
}

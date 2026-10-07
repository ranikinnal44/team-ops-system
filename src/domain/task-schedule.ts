/**
 * The scheduling rules a task has to satisfy to be added or rescheduled.
 *
 * Three rules, all enforced here so the service, the API and the tests agree on
 * one definition:
 *
 *   1. A task has both a start date and a due date. Neither is optional —
 *      undated work cannot be chased, so it is not accepted in the first place.
 *   2. A task spans at most `maxSpanDays` calendar days, counted inclusively.
 *      Work that needs longer is not a task; it is a milestone that has to be
 *      broken into tasks.
 *   3. A task covering more than one day states what each of those days is
 *      meant to produce. A two-day task is two checkable outcomes, not one
 *      vague block of time.
 *
 * Imported records are deliberately out of scope: they carry whatever their
 * source said, and rejecting history at write time would lose it. These rules
 * apply to work added and rescheduled inside the system.
 */
import {
  addDays,
  daysBetween,
  formatDateHuman,
  workingDaysInclusive,
  type IsoDate,
} from '../lib/dates.ts';
import { validationError, type ErrorDetail } from '../lib/errors.ts';
import type { TaskDayPlan } from './types.ts';

/** Matches `config.rules.maxTaskEffortDays`; passed in so this stays pure. */
export const DEFAULT_MAX_TASK_EFFORT_DAYS = 5;

/** Kept for the manager's direct-schedule path. */
export const DEFAULT_MAX_TASK_SPAN_DAYS = DEFAULT_MAX_TASK_EFFORT_DAYS;

export const MAX_DAY_OUTCOME_LENGTH = 500;

/** Inclusive length of `[start, due]` in calendar days: a same-day task is 1. */
export function taskSpanDays(start: IsoDate, due: IsoDate): number {
  return daysBetween(start, due) + 1;
}

/** Every calendar date the task covers, from start to due inclusive. */
export function scheduleDays(start: IsoDate, due: IsoDate): IsoDate[] {
  const span = taskSpanDays(start, due);
  return Array.from({ length: Math.max(span, 0) }, (_, i) => addDays(start, i));
}

export type ScheduleInput = {
  readonly startDate: IsoDate | null | undefined;
  readonly dueDate: IsoDate | null | undefined;
  readonly dayPlans?: readonly { date: IsoDate; outcome: string }[] | undefined;
};

export type NormalisedSchedule = {
  readonly startDate: IsoDate;
  readonly dueDate: IsoDate;
  readonly spanDays: number;
  /** Ordered by date. Empty for a single-day task that supplied no outcome. */
  readonly dayPlans: readonly TaskDayPlan[];
};

/**
 * Validate a proposed schedule and return it in canonical form.
 *
 * Throws a single `AppError` carrying one detail per offending field, so the
 * form can mark every problem at once rather than one per round-trip.
 */
export function normaliseSchedule(
  input: ScheduleInput,
  maxSpanDays: number = DEFAULT_MAX_TASK_SPAN_DAYS,
): NormalisedSchedule {
  const details: ErrorDetail[] = [];
  const { startDate, dueDate } = input;

  if (startDate === null || startDate === undefined) {
    details.push({ path: 'startDate', message: 'is required — every task has to say when it starts' });
  }
  if (dueDate === null || dueDate === undefined) {
    details.push({ path: 'dueDate', message: 'is required — every task has to say when it ends' });
  }
  if (details.length > 0) {
    throw validationError('A task needs both a start date and an end date', details);
  }

  // Narrowed by the guard above; TypeScript cannot see through the push.
  const start = startDate as IsoDate;
  const due = dueDate as IsoDate;

  const span = taskSpanDays(start, due);
  if (span < 1) {
    throw validationError('The end date cannot be before the start date', [
      { path: 'dueDate', message: 'must be on or after the start date' },
    ]);
  }
  if (span > maxSpanDays) {
    throw validationError(
      `A task can span at most ${maxSpanDays} day${maxSpanDays === 1 ? '' : 's'}; this one spans ${span}. ` +
        'Split it into smaller tasks, or track it as a milestone.',
      [{ path: 'dueDate', message: `must be within ${maxSpanDays} day(s) of the start date` }],
    );
  }

  return {
    startDate: start,
    dueDate: due,
    spanDays: span,
    dayPlans: normaliseDayPlans(start, due, input.dayPlans),
  };
}

/**
 * Check the per-day outcomes against the days the task actually covers.
 *
 * A multi-day task must name an outcome for every one of its days — no more,
 * no fewer. A single-day task may state one, but the day and the task are the
 * same thing, so it is not required to.
 */
export function normaliseDayPlans(
  start: IsoDate,
  due: IsoDate,
  plans: readonly { date: IsoDate; outcome: string }[] | undefined,
): readonly TaskDayPlan[] {
  const days = scheduleDays(start, due);
  const supplied = plans ?? [];
  const details: ErrorDetail[] = [];

  const byDate = new Map<IsoDate, string>();
  supplied.forEach((plan, index) => {
    if (!days.includes(plan.date)) {
      details.push({
        path: `dayPlans[${index}].date`,
        message: `${plan.date} is outside the task's dates (${start} to ${due})`,
      });
      return;
    }
    if (byDate.has(plan.date)) {
      details.push({ path: `dayPlans[${index}].date`, message: `${plan.date} is listed twice` });
      return;
    }
    const outcome = plan.outcome.trim();
    if (outcome === '') {
      details.push({
        path: `dayPlans[${index}].outcome`,
        message: `say what ${formatDateHuman(plan.date)} is meant to produce`,
      });
      return;
    }
    if (outcome.length > MAX_DAY_OUTCOME_LENGTH) {
      details.push({
        path: `dayPlans[${index}].outcome`,
        message: `must be at most ${MAX_DAY_OUTCOME_LENGTH} characters`,
      });
      return;
    }
    byDate.set(plan.date, outcome);
  });

  if (days.length > 1) {
    for (const day of days) {
      if (!byDate.has(day)) {
        details.push({
          path: `dayPlans.${day}`,
          message: `${formatDateHuman(day)} has no outcome — say what that day delivers`,
        });
      }
    }
  }

  if (details.length > 0) {
    throw validationError(
      days.length > 1
        ? `A ${days.length}-day task has to say what each day delivers`
        : 'The day outcome does not match the task dates',
      details,
    );
  }

  return days.filter((day) => byDate.has(day)).map((day) => ({ date: day, outcome: byDate.get(day) as string }));
}

/** Days in `[start, due]` that no stored outcome covers. Empty when complete. */
export function uncoveredDays(
  start: IsoDate,
  due: IsoDate,
  plans: readonly TaskDayPlan[],
): IsoDate[] {
  const covered = new Set(plans.filter((p) => p.outcome.trim() !== '').map((p) => p.date));
  return scheduleDays(start, due).filter((day) => !covered.has(day));
}

/** True when the task covers several days and is therefore owed day outcomes. */
export const needsDayOutcomes = (start: IsoDate, due: IsoDate): boolean =>
  taskSpanDays(start, due) > 1;

/** One-line summary used in history notes, e.g. "Mar 3 → Mar 5 (3 days)". */
export function describeSchedule(start: IsoDate, due: IsoDate): string {
  const span = taskSpanDays(start, due);
  return span === 1
    ? formatDateHuman(start)
    : `${formatDateHuman(start)} → ${formatDateHuman(due)} (${span} days)`;
}


// --- effort budgets and proposed schedules --------------------------------

/**
 * Validate a manager's effort budget.
 *
 * The budget is in WORKING days, which is what "three days of effort" means to
 * the person doing it; a weekend in the middle does not spend any of it.
 */
export function normaliseEffortDays(
  effortDays: number | null | undefined,
  maxEffortDays: number = DEFAULT_MAX_TASK_EFFORT_DAYS,
): number {
  if (effortDays === null || effortDays === undefined) {
    throw validationError('A task needs an effort budget', [
      {
        path: 'effortDays',
        message: 'is required — say how many working days this should take',
      },
    ]);
  }
  if (!Number.isInteger(effortDays) || effortDays < 1) {
    throw validationError('Effort is counted in whole working days', [
      { path: 'effortDays', message: 'must be a whole number of days, at least 1' },
    ]);
  }
  if (effortDays > maxEffortDays) {
    throw validationError(
      `A task can be budgeted at most ${maxEffortDays} working day` +
        `${maxEffortDays === 1 ? '' : 's'}; this one asks for ${effortDays}. ` +
        'Work that needs longer is a milestone, not a task — break it down.',
      [{ path: 'effortDays', message: `must be ${maxEffortDays} or fewer` }],
    );
  }
  return effortDays;
}

export type ProposedSchedule = {
  readonly startDate: IsoDate;
  readonly dueDate: IsoDate;
  /** Working days the proposal actually spends. */
  readonly effortUsed: number;
  readonly dayPlans: readonly TaskDayPlan[];
};

/**
 * Validate dates an owner proposes against the budget they were given.
 *
 * The window may not spend MORE working days than the budget — that is what a
 * budget means. It may spend fewer: finishing three days of work in two is
 * nobody's problem but the owner's, and the system has no business forbidding
 * it. Needing more is what the deadline extension exists for.
 */
export function normaliseProposedSchedule(
  input: ScheduleInput,
  effortDays: number,
  maxEffortDays: number = DEFAULT_MAX_TASK_EFFORT_DAYS,
): ProposedSchedule {
  const details: ErrorDetail[] = [];
  const { startDate, dueDate } = input;
  if (startDate === null || startDate === undefined) {
    details.push({ path: 'startDate', message: 'is required — say when you will start' });
  }
  if (dueDate === null || dueDate === undefined) {
    details.push({ path: 'dueDate', message: 'is required — say when you will finish' });
  }
  if (details.length > 0) {
    throw validationError('Proposing a schedule needs both a start and an end date', details);
  }

  const start = startDate as IsoDate;
  const due = dueDate as IsoDate;
  if (daysBetween(start, due) < 0) {
    throw validationError('The end date cannot be before the start date', [
      { path: 'dueDate', message: 'must be on or after the start date' },
    ]);
  }

  const effortUsed = workingDaysInclusive(start, due);
  if (effortUsed === 0) {
    throw validationError('That window contains no working days', [
      { path: 'startDate', message: 'a task has to cover at least one working day' },
    ]);
  }
  const budget = Math.min(effortDays, maxEffortDays);
  if (effortUsed > budget) {
    throw validationError(
      `These dates span ${effortUsed} working days, but this task is budgeted for ${budget}. ` +
        'Pick a shorter window, or request a deadline extension once the dates are agreed.',
      [{ path: 'dueDate', message: `must cover ${budget} working day(s) or fewer` }],
    );
  }

  return { startDate: start, dueDate: due, effortUsed, dayPlans: normaliseDayPlans(start, due, input.dayPlans) };
}

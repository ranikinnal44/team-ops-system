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
import { addDays, daysBetween, formatDateHuman, type IsoDate } from '../lib/dates.ts';
import { validationError, type ErrorDetail } from '../lib/errors.ts';
import type { TaskDayPlan } from './types.ts';

/** Matches `config.rules.maxTaskSpanDays`; passed in so this stays pure. */
export const DEFAULT_MAX_TASK_SPAN_DAYS = 3;

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

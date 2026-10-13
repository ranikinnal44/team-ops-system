/**
 * Date helpers.
 *
 * Conventions used across the system:
 *  - Calendar dates (start date, due date) are stored as `YYYY-MM-DD` strings.
 *  - Timestamps (created/updated) are stored as ISO-8601 UTC strings.
 *
 * All comparisons go through these helpers so that "today" is decided in one
 * place and can be frozen in tests.
 */

export type IsoDate = string; // YYYY-MM-DD
export type IsoTimestamp = string; // 2026-10-06T09:30:00.000Z

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

export function isIsoTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

export function nowTimestamp(now: Date = new Date()): IsoTimestamp {
  return now.toISOString();
}

/** The calendar date "today" means, in the server's local timezone. */
export function todayDate(now: Date = new Date()): IsoDate {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The calendar date an ISO timestamp falls on, in the server's local timezone. */
export function dateOfTimestamp(timestamp: IsoTimestamp): IsoDate {
  return todayDate(new Date(timestamp));
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return shifted.toISOString().slice(0, 10);
}

/** Signed difference `b - a` in whole calendar days. */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  const toUtc = (value: IsoDate): number => {
    const [y, m, d] = value.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

export function isWeekend(date: IsoDate): boolean {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 || day === 6;
}

/**
 * Number of working days (Mon-Fri) strictly after `from` and up to and
 * including `to`. Returns 0 when `to` is not after `from`.
 *
 * Used by the NO RECENT UPDATE rule: a task updated on Friday and checked on
 * the following Monday has elapsed exactly 1 working day, not 3.
 */
export function workingDaysBetween(from: IsoDate, to: IsoDate): number {
  const span = daysBetween(from, to);
  if (span <= 0) return 0;
  let count = 0;
  for (let offset = 1; offset <= span; offset += 1) {
    if (!isWeekend(addDays(from, offset))) count += 1;
  }
  return count;
}

/**
 * Working days (Mon-Fri) in `[start, due]` INCLUSIVE, which is how effort is
 * counted: Monday to Wednesday is three days of work, and a task that starts
 * and ends on the same working day is one.
 *
 * Deliberately different from `workingDaysBetween`, which is exclusive of its
 * start because it measures elapsed time rather than effort.
 */
export function workingDaysInclusive(start: IsoDate, due: IsoDate): number {
  const span = daysBetween(start, due);
  if (span < 0) return 0;
  let count = 0;
  for (let offset = 0; offset <= span; offset += 1) {
    if (!isWeekend(addDays(start, offset))) count += 1;
  }
  return count;
}

/**
 * The first working day on or after `date`.
 *
 * Used to answer "when does this actually begin" for a date that lands on a
 * weekend, without silently moving what someone typed.
 */
export function nextWorkingDay(date: IsoDate): IsoDate {
  let cursor = date;
  while (isWeekend(cursor)) cursor = addDays(cursor, 1);
  return cursor;
}

/**
 * The date `effortDays` working days after `start`, counting `start` itself as
 * the first when it is a working day.
 *
 * One day of effort starting Monday finishes Monday. Five finish Friday. Five
 * starting Thursday finish the following Wednesday, because the weekend is not
 * worked — which is the whole point of deriving a deadline rather than letting
 * somebody count calendar squares and get it wrong.
 */
export function workingDayDeadline(start: IsoDate, effortDays: number): IsoDate {
  if (effortDays < 1) {
    throw new RangeError(`effortDays must be at least 1, got ${effortDays}`);
  }
  let cursor = nextWorkingDay(start);
  let remaining = effortDays - 1;
  while (remaining > 0) {
    cursor = nextWorkingDay(addDays(cursor, 1));
    remaining -= 1;
  }
  return cursor;
}

/** Every working day from `start` to `due` inclusive, weekends omitted. */
export function workingDaysInRange(start: IsoDate, due: IsoDate): IsoDate[] {
  const days: IsoDate[] = [];
  for (let cursor = start; daysBetween(cursor, due) >= 0; cursor = addDays(cursor, 1)) {
    if (!isWeekend(cursor)) days.push(cursor);
  }
  return days;
}

/** Monday-to-Sunday week containing `date`, as inclusive bounds. */
export function weekBounds(date: IsoDate): { start: IsoDate; end: IsoDate } {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const backToMonday = weekday === 0 ? 6 : weekday - 1;
  const start = addDays(date, -backToMonday);
  return { start, end: addDays(start, 6) };
}

export function formatDateHuman(date: IsoDate): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

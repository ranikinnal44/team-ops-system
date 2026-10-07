/**
 * Relative project weeks (W1, W2, …) resolved to calendar dates.
 *
 * The build timeline is written in weeks relative to the project start, not in
 * dates. The anchor — what W1 actually means — is a single configurable value
 * rather than something baked into the plan, so re-anchoring the whole schedule
 * is one change in `.env` and a re-import.
 *
 * Convention: a week runs Monday to Sunday. Work in week N is treated as
 * starting on its Monday and due on its Friday, because a deadline falling on
 * a Sunday is not a deadline anyone works to.
 */
import { addDays, type IsoDate } from './dates.ts';

/** Monday of the week containing `date`. */
export function mondayOf(date: IsoDate): IsoDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(date, weekday === 0 ? -6 : 1 - weekday);
}

export type WeekResolver = {
  /** The calendar date W1 begins on (a Monday). */
  readonly anchor: IsoDate;
  /** Monday of week N (1-based). */
  startOf: (week: number) => IsoDate;
  /** Friday of week N — the working deadline for that week. */
  endOf: (week: number) => IsoDate;
  /** Calendar range a "W3 - W5" style span covers. */
  span: (from: number, to: number) => { startDate: IsoDate; dueDate: IsoDate };
};

export function createWeekResolver(anchorDate: IsoDate): WeekResolver {
  const anchor = mondayOf(anchorDate);
  const startOf = (week: number): IsoDate => addDays(anchor, (Math.max(1, week) - 1) * 7);
  const endOf = (week: number): IsoDate => addDays(startOf(week), 4);
  return {
    anchor,
    startOf,
    endOf,
    span: (from, to) => ({ startDate: startOf(from), dueDate: endOf(Math.max(from, to)) }),
  };
}

/** "W1 - W2" / "W5" / "W1 -W4" → { from, to }. Returns null when unparseable. */
export function parseWeekLabel(label: string): { from: number; to: number } | null {
  const matches = [...label.matchAll(/W\s*(\d+)/gi)].map((m) => Number(m[1]));
  if (matches.length === 0) return null;
  const from = matches[0] as number;
  const to = (matches[1] ?? matches[0]) as number;
  return { from, to };
}

/** "by W1", "by W1 end", "by W10 (in case of …)" → the week number, if stated. */
export function parseDueWeek(text: string): number | null {
  const match = /\bby\s+W\s*(\d+)/i.exec(text);
  return match ? Number(match[1]) : null;
}

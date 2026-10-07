import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  daysBetween,
  isWeekend,
  workingDaysBetween,
  weekBounds,
  isIsoDate,
  todayDate,
  dateOfTimestamp,
} from '../src/lib/dates.ts';

describe('calendar arithmetic', () => {
  test('addDays crosses month and year boundaries', () => {
    assert.equal(addDays('2026-01-31', 1), '2026-02-01');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
    assert.equal(addDays('2024-03-01', -1), '2024-02-29'); // leap year
  });

  test('daysBetween is signed and symmetric', () => {
    assert.equal(daysBetween('2026-10-06', '2026-10-09'), 3);
    assert.equal(daysBetween('2026-10-09', '2026-10-06'), -3);
    assert.equal(daysBetween('2026-10-06', '2026-10-06'), 0);
  });

  test('isIsoDate rejects malformed and impossible dates', () => {
    assert.ok(isIsoDate('2026-10-06'));
    assert.ok(!isIsoDate('2026-13-01'));
    assert.ok(!isIsoDate('2026-02-30'));
    assert.ok(!isIsoDate('06/10/2026'));
    assert.ok(!isIsoDate('2026-1-1'));
  });
});

describe('working days', () => {
  // 2026-10-05 is a Monday; 10-10 Saturday; 10-11 Sunday.
  test('identifies weekends', () => {
    assert.ok(!isWeekend('2026-10-05'));
    assert.ok(!isWeekend('2026-10-09'));
    assert.ok(isWeekend('2026-10-10'));
    assert.ok(isWeekend('2026-10-11'));
  });

  test('counts weekdays strictly after the start date', () => {
    assert.equal(workingDaysBetween('2026-10-05', '2026-10-05'), 0);
    assert.equal(workingDaysBetween('2026-10-05', '2026-10-06'), 1);
    assert.equal(workingDaysBetween('2026-10-05', '2026-10-08'), 3);
  });

  test('a weekend costs nothing — Friday to Monday is one working day', () => {
    assert.equal(workingDaysBetween('2026-10-09', '2026-10-12'), 1);
    assert.equal(workingDaysBetween('2026-10-09', '2026-10-11'), 0);
  });

  test('never returns a negative count', () => {
    assert.equal(workingDaysBetween('2026-10-09', '2026-10-05'), 0);
  });
});

describe('week bounds', () => {
  test('runs Monday to Sunday', () => {
    assert.deepEqual(weekBounds('2026-10-07'), { start: '2026-10-05', end: '2026-10-11' });
  });

  test('a Sunday belongs to the week that started six days earlier', () => {
    assert.deepEqual(weekBounds('2026-10-11'), { start: '2026-10-05', end: '2026-10-11' });
  });

  test('a Monday is its own week start', () => {
    assert.deepEqual(weekBounds('2026-10-05'), { start: '2026-10-05', end: '2026-10-11' });
  });
});

describe('timestamps', () => {
  test('todayDate uses the local calendar date', () => {
    assert.equal(todayDate(new Date(2026, 9, 6, 23, 30)), '2026-10-06');
    assert.equal(todayDate(new Date(2026, 9, 6, 0, 1)), '2026-10-06');
  });

  test('dateOfTimestamp round-trips a locally created timestamp', () => {
    const stamp = new Date(2026, 9, 6, 15, 30).toISOString();
    assert.equal(dateOfTimestamp(stamp), '2026-10-06');
  });
});

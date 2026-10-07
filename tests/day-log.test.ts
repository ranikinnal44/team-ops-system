/**
 * The daily outcome log.
 *
 * `task_day_plans` says what a day was MEANT to produce; these are the reports
 * against it. Most of what matters here is who may write one and when — the
 * log is a report on work done, so it is not open to people who are not doing
 * the work, nor to days when no work is happening.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, manager, employee1, employee2, employee3 } from './helpers.ts';
import type { Database } from '../src/db/connection.ts';
import * as tasks from '../src/services/task.service.ts';
import * as projects from '../src/services/project.service.ts';
import { TaskStatus, ExceptionFlag, HistoryKind } from '../src/domain/enums.ts';
import { needsDailyUpdate, DEFAULT_THRESHOLDS } from '../src/domain/exceptions.ts';
import { ErrorCode } from '../src/lib/errors.ts';
import { todayDate, addDays } from '../src/lib/dates.ts';

const today = (): string => todayDate();

function placement(db: Database): { workstreamId: string; milestoneId: string } {
  const [workstream] = projects.listWorkstreams(db, manager(db));
  assert.ok(workstream);
  const [milestone] = projects.listMilestones(db, manager(db), workstream.id);
  assert.ok(milestone);
  return { workstreamId: workstream.id, milestoneId: milestone.id };
}

/** A task owned by employee1, supported by employee2, reviewed by employee3. */
function liveTask(db: Database): string {
  const created = tasks.createTask(db, manager(db), {
    ...placement(db),
    title: 'Measure dock latch torque',
    ownerId: employee1(db).id,
    reviewerId: employee3(db).id,
    supportingMemberIds: [employee2(db).id],
    priority: 'P1',
    startDate: today(),
    dueDate: today(),
  });
  tasks.updateTask(db, employee1(db), created.id, { status: TaskStatus.InProgress });
  return created.id;
}

describe('who may log a daily outcome', () => {
  let db: Database;
  let taskId: string;
  beforeEach(() => {
    db = freshDb();
    taskId = liveTask(db);
  });

  test('the owner can', () => {
    const log = tasks.recordDayOutcome(db, employee1(db), taskId, {
      outcome: 'All six latches measured.',
    });
    assert.equal(log.outcome, 'All six latches measured.');
    assert.equal(log.logDate, today());
    assert.equal(log.authorId, employee1(db).id);
  });

  test('a supporting member can — they are doing the work too', () => {
    const log = tasks.recordDayOutcome(db, employee2(db), taskId, { outcome: 'Rig set up.' });
    assert.equal(log.authorId, employee2(db).id);
  });

  test('the reviewer cannot — they watch the work, they do not do it', () => {
    assert.throws(
      () => tasks.recordDayOutcome(db, employee3(db), taskId, { outcome: 'Looks fine.' }),
      (e: { code?: string }) => e.code === ErrorCode.FORBIDDEN,
    );
  });

  test('a manager cannot write someone else’s daily outcome', () => {
    assert.throws(
      () => tasks.recordDayOutcome(db, manager(db), taskId, { outcome: 'They did the latches.' }),
      (e: { code?: string }) => e.code === ErrorCode.FORBIDDEN,
      'a daily report in someone else’s name is not accountability',
    );
  });
});

describe('when a daily outcome may be logged', () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
  });

  test('not before the task has started', () => {
    const created = tasks.createTask(db, manager(db), {
      ...placement(db),
      title: 'Not begun yet',
      reviewerId: manager(db).id,
      ownerId: employee1(db).id,
      startDate: today(),
      dueDate: today(),
    });
    assert.throws(
      () => tasks.recordDayOutcome(db, employee1(db), created.id, { outcome: 'Nothing yet.' }),
      (e: { code?: string }) => e.code === ErrorCode.CONFLICT,
    );
  });

  test('blocked work can still report — being stuck is an outcome', () => {
    const taskId = liveTask(db);
    tasks.updateTask(db, employee1(db), taskId, {
      status: TaskStatus.Blocked,
      blocker: 'Torque wrench is out for calibration.',
    });
    const log = tasks.recordDayOutcome(db, employee1(db), taskId, {
      outcome: 'Chased the calibration lab; nothing else possible today.',
    });
    assert.ok(log.id);
  });

  test('a future day is refused — you cannot report forward', () => {
    const taskId = liveTask(db);
    assert.throws(
      () =>
        tasks.recordDayOutcome(db, employee1(db), taskId, {
          logDate: addDays(today(), 1),
          outcome: 'Will have done it.',
        }),
      (e: { code?: string }) => e.code === ErrorCode.VALIDATION,
    );
  });

  test('an empty outcome is refused', () => {
    const taskId = liveTask(db);
    assert.throws(
      () => tasks.recordDayOutcome(db, employee1(db), taskId, { outcome: '   ' }),
      (e: { code?: string }) => e.code === ErrorCode.VALIDATION,
    );
  });
});

describe('a day has one answer per person', () => {
  let db: Database;
  let taskId: string;
  beforeEach(() => {
    db = freshDb();
    taskId = liveTask(db);
  });

  test('re-submitting the same day replaces it rather than appending', () => {
    tasks.recordDayOutcome(db, employee1(db), taskId, { outcome: 'Two latches done.' });
    tasks.recordDayOutcome(db, employee1(db), taskId, { outcome: 'Actually four latches done.' });
    const logs = tasks.listDayLogs(db, employee1(db), taskId);
    assert.equal(logs.length, 1);
    assert.equal(logs[0]?.outcome, 'Actually four latches done.');
  });

  test('two people reporting the same day each keep their own entry', () => {
    tasks.recordDayOutcome(db, employee1(db), taskId, { outcome: 'Owner view.' });
    tasks.recordDayOutcome(db, employee2(db), taskId, { outcome: 'Supporter view.' });
    assert.equal(tasks.listDayLogs(db, employee1(db), taskId).length, 2);
  });
});

describe('a daily outcome moves the task with it', () => {
  let db: Database;
  let taskId: string;
  beforeEach(() => {
    db = freshDb();
    taskId = liveTask(db);
  });

  test('reported progress becomes the task’s progress, not a second number', () => {
    tasks.recordDayOutcome(db, employee1(db), taskId, { outcome: 'Half done.', progress: 50 });
    assert.equal(tasks.getTask(db, manager(db), taskId).progress, 50);
  });

  test('it is written to the activity history', () => {
    tasks.recordDayOutcome(db, employee1(db), taskId, { outcome: 'Rig calibrated.' });
    const kinds = tasks.listHistory(db, manager(db), taskId).map((h) => h.kind);
    assert.ok(kinds.includes(HistoryKind.DayOutcomeRecorded));
  });

  test('a blocker raised in the daily outcome lands on the task', () => {
    tasks.recordDayOutcome(db, employee1(db), taskId, {
      outcome: 'Stopped — no wrench.',
      blocker: 'Torque wrench out for calibration.',
    });
    assert.equal(
      tasks.getTask(db, manager(db), taskId).blocker,
      'Torque wrench out for calibration.',
    );
  });
});

describe('the missing-daily-update rule', () => {
  const base = { status: TaskStatus.InProgress, dueDate: null, lastUpdatedAt: `${today()}T09:00:00.000Z` };

  test('stays silent when the caller did not load logs', () => {
    // `undefined` means "not loaded", which must never be read as "none".
    assert.equal(needsDailyUpdate({ ...base }, today()), false);
  });

  test('fires on in-progress work that has never reported', () => {
    assert.equal(needsDailyUpdate({ ...base, lastDayLogDate: null }, today()), true);
  });

  test('is satisfied by today’s outcome', () => {
    assert.equal(needsDailyUpdate({ ...base, lastDayLogDate: today() }, today()), false);
  });

  test('ignores work that is not in progress', () => {
    for (const status of [TaskStatus.NotStarted, TaskStatus.Blocked, TaskStatus.Review, TaskStatus.Completed]) {
      assert.equal(
        needsDailyUpdate({ ...base, status, lastDayLogDate: null }, today()),
        false,
        `${status} must not be chased for a daily outcome`,
      );
    }
  });

  test('the threshold is honoured', () => {
    const task = { ...base, lastDayLogDate: '2026-01-05' as const };
    // 2026-01-05 is a Monday; 2026-01-07 is two working days later.
    assert.equal(needsDailyUpdate(task, '2026-01-07', { ...DEFAULT_THRESHOLDS, dailyUpdateWorkingDays: 1 }), true);
    assert.equal(needsDailyUpdate(task, '2026-01-07', { ...DEFAULT_THRESHOLDS, dailyUpdateWorkingDays: 5 }), false);
  });
});

describe('the flag reaches the task view', () => {
  test('an in-progress task with no outcome logged carries MISSING_DAILY_UPDATE', () => {
    const db = freshDb();
    const taskId = liveTask(db);
    const view = tasks.getTask(db, manager(db), taskId);
    assert.ok(view.exceptions.includes(ExceptionFlag.MissingDailyUpdate));
  });

  test('and loses it once the day is reported', () => {
    const db = freshDb();
    const taskId = liveTask(db);
    tasks.recordDayOutcome(db, employee1(db), taskId, { outcome: 'Latches measured.' });
    const view = tasks.getTask(db, manager(db), taskId);
    assert.ok(!view.exceptions.includes(ExceptionFlag.MissingDailyUpdate));
  });
});

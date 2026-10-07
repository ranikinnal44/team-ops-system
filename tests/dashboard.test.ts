import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Database } from '../src/db/connection.ts';
import { freshDb, manager, employee1, employee3 } from './helpers.ts';
import {
  managerDashboard,
  employeeDashboard,
  summarise,
  bucketExceptions,
  sortTasks,
  SortKey,
} from '../src/services/dashboard.service.ts';
import * as tasks from '../src/services/task.service.ts';
import { TaskStatus, ExceptionFlag } from '../src/domain/enums.ts';
import { todayDate, addDays } from '../src/lib/dates.ts';
import { AppError, ErrorCode } from '../src/lib/errors.ts';

let db: Database;
beforeEach(() => {
  db = freshDb();
});

describe('manager dashboard', () => {
  test('summary counts add up across statuses', () => {
    const board = managerDashboard(db, manager(db));
    const { summary } = board;
    assert.equal(
      summary.notStarted + summary.inProgress + summary.blocked + summary.review + summary.completed,
      summary.total,
    );
    assert.equal(summary.total, tasks.listTasks(db, manager(db)).length);
  });

  test('the demo data exercises every exception bucket', () => {
    const { exceptions } = managerDashboard(db, manager(db));
    assert.ok(exceptions.overdue.length > 0, 'expected overdue tasks');
    assert.ok(exceptions.blocked.length > 0, 'expected blocked tasks');
    assert.ok(exceptions.noRecentUpdate.length > 0, 'expected stale tasks');
    assert.ok(exceptions.dueWithinTwoDays.length > 0, 'expected due-soon tasks');
  });

  test('no completed task appears in any exception bucket', () => {
    const { exceptions } = managerDashboard(db, manager(db));
    const all = [
      ...exceptions.overdue,
      ...exceptions.blocked,
      ...exceptions.noRecentUpdate,
      ...exceptions.dueWithinTwoDays,
    ];
    assert.ok(all.every((t) => t.status !== TaskStatus.Completed));
  });

  test('a task is never both overdue and due-soon', () => {
    const { exceptions } = managerDashboard(db, manager(db));
    const overdueIds = new Set(exceptions.overdue.map((t) => t.id));
    assert.ok(exceptions.dueWithinTwoDays.every((t) => !overdueIds.has(t.id)));
  });

  test('exception lists lead with the most urgent task', () => {
    const { exceptions } = managerDashboard(db, manager(db));
    for (const bucket of Object.values(exceptions)) {
      for (let i = 1; i < bucket.length; i += 1) {
        assert.ok((bucket[i - 1]?.attentionScore ?? 0) >= (bucket[i]?.attentionScore ?? 0));
      }
    }
  });

  test('every owner roll-up reconciles with that person’s task count', () => {
    const board = managerDashboard(db, manager(db));
    const all = tasks.listTasks(db, manager(db));
    for (const rollup of board.byOwner) {
      assert.equal(rollup.total, all.filter((t) => t.ownerId === rollup.userId).length);
      assert.equal(rollup.open + rollup.completed, rollup.total);
    }
  });

  test('the pending deadline request is surfaced for decision', () => {
    const board = managerDashboard(db, manager(db));
    assert.equal(board.pendingDeadlineRequests.length, 1);
    assert.equal(board.pendingDeadlineRequests[0]?.status, 'pending');
  });

  test('an employee cannot open the manager dashboard', () => {
    assert.throws(
      () => managerDashboard(db, employee1(db)),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.FORBIDDEN,
    );
  });

  test('a completed task drops out of the exceptions it was in', () => {
    const before = managerDashboard(db, manager(db));
    const overdue = before.exceptions.overdue.find((t) => t.status === TaskStatus.Review);
    assert.ok(overdue, 'expected an overdue task awaiting review');

    tasks.updateTask(db, manager(db), overdue.id, { status: TaskStatus.Completed });

    const after = managerDashboard(db, manager(db));
    assert.ok(!after.exceptions.overdue.some((t) => t.id === overdue.id));
    assert.equal(after.summary.overdue, before.summary.overdue - 1);
    assert.equal(after.summary.completed, before.summary.completed + 1);
  });
});

describe('employee dashboard', () => {
  test('only shows tasks the employee is involved in', () => {
    const emp = employee1(db);
    const board = employeeDashboard(db, emp);
    const visibleIds = new Set(tasks.listTasks(db, emp).map((t) => t.id));
    for (const task of board.focus) assert.ok(visibleIds.has(task.id));
  });

  test('the default focus list is ordered by attention', () => {
    const board = employeeDashboard(db, employee1(db));
    for (let i = 1; i < board.focus.length; i += 1) {
      assert.ok((board.focus[i - 1]?.attentionScore ?? 0) >= (board.focus[i]?.attentionScore ?? 0));
    }
  });

  test('buckets match their own definitions', () => {
    const board = employeeDashboard(db, employee1(db));
    const today = todayDate();
    assert.ok(board.dueToday.every((t) => t.dueDate === today));
    assert.ok(board.dueTomorrow.every((t) => t.dueDate === addDays(today, 1)));
    assert.ok(board.overdue.every((t) => t.dueDate !== null && t.dueDate < today));
    assert.ok(board.blocked.every((t) => t.status === TaskStatus.Blocked));
    assert.ok(board.awaitingReview.every((t) => t.status === TaskStatus.Review));
    assert.ok(board.needsUpdate.every((t) => t.exceptions.includes(ExceptionFlag.NoRecentUpdate)));
  });

  test('no open bucket contains completed work', () => {
    const board = employeeDashboard(db, employee1(db));
    const open = [...board.focus, ...board.dueToday, ...board.overdue, ...board.blocked];
    assert.ok(open.every((t) => t.status !== TaskStatus.Completed));
    assert.ok(board.recentlyCompleted.every((t) => t.status === TaskStatus.Completed));
  });

  test('an employee cannot peek at a colleague’s board', () => {
    const mine = employeeDashboard(db, employee1(db));
    const theirs = employeeDashboard(db, employee1(db), employee3(db).id);
    assert.deepEqual(
      mine.focus.map((t) => t.id),
      theirs.focus.map((t) => t.id),
    );
  });

  test('a manager may inspect an individual board', () => {
    const board = employeeDashboard(db, manager(db), employee3(db).id);
    const theirTasks = tasks.listTasks(db, employee3(db));
    assert.equal(board.summary.total, theirTasks.length);
  });

  test('a stale task leaves the needs-update list once it is touched', () => {
    const board = employeeDashboard(db, employee3(db));
    const stale = board.needsUpdate[0];
    assert.ok(stale, 'expected a stale task in the demo data');

    tasks.addComment(db, employee3(db), stale.id, 'Starting on this now.');

    const after = employeeDashboard(db, employee3(db));
    assert.ok(!after.needsUpdate.some((t) => t.id === stale.id));
  });
});

describe('sorting', () => {
  test('by priority puts P0 first', () => {
    const sorted = sortTasks(tasks.listTasks(db, manager(db)), SortKey.Priority);
    assert.equal(sorted[0]?.priority, 'P0');
  });

  test('by due date is ascending', () => {
    const sorted = sortTasks(tasks.listTasks(db, manager(db)), SortKey.DueDate);
    for (let i = 1; i < sorted.length; i += 1) {
      assert.ok((sorted[i - 1]?.dueDate ?? '') <= (sorted[i]?.dueDate ?? ''));
    }
  });

  test('by status leads with blocked and ends with completed', () => {
    const sorted = sortTasks(tasks.listTasks(db, manager(db)), SortKey.Status);
    assert.equal(sorted[0]?.status, TaskStatus.Blocked);
    assert.equal(sorted.at(-1)?.status, TaskStatus.Completed);
  });

  test('sorting never loses or duplicates a task', () => {
    const all = tasks.listTasks(db, manager(db));
    for (const key of [SortKey.Priority, SortKey.DueDate, SortKey.Status, SortKey.Attention]) {
      const sorted = sortTasks(all, key);
      assert.equal(sorted.length, all.length);
      assert.equal(new Set(sorted.map((t) => t.id)).size, all.length);
    }
  });
});

describe('summary helpers', () => {
  test('an empty set summarises to zeroes rather than NaN', () => {
    const summary = summarise([], todayDate());
    assert.equal(summary.total, 0);
    assert.equal(summary.completionPercent, 0);
  });

  test('bucketing an empty set yields empty buckets', () => {
    const buckets = bucketExceptions([]);
    assert.deepEqual(buckets, {
      overdue: [],
      blocked: [],
      noRecentUpdate: [],
      dueWithinTwoDays: [],
      missingDailyUpdate: [],
      scheduleAwaitingReview: [],
      scheduleNotSet: [],
    });
  });
});

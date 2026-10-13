import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Database } from '../src/db/connection.ts';
import { freshDb, manager, employee1, employee2, employee3, taskByRef } from './helpers.ts';
import * as tasks from '../src/services/task.service.ts';
import * as projects from '../src/services/project.service.ts';
import { TaskStatus, HistoryKind, ClarificationCode } from '../src/domain/enums.ts';
import { AppError, ErrorCode } from '../src/lib/errors.ts';
import {
  todayDate,
  addDays,
  nextWorkingDay,
  workingDayDeadline,
  workingDaysInRange,
} from '../src/lib/dates.ts';

let db: Database;
beforeEach(() => {
  db = freshDb();
});

const today = (): string => todayDate();

/** The first working day from today — a task cannot start on a weekend. */
const workStart = (): string => nextWorkingDay(todayDate());
/** The nth working day of a schedule starting there, weekends skipped. */
const workDay = (n: number): string =>
  workingDaysInRange(workStart(), workingDayDeadline(workStart(), 10))[n] as string;


function anyPlacement(d: Database): { workstreamId: string; milestoneId: string } {
  const [workstream] = projects.listWorkstreams(d, manager(d));
  assert.ok(workstream);
  const [milestone] = projects.listMilestones(d, manager(d), workstream.id);
  assert.ok(milestone);
  return { workstreamId: workstream.id, milestoneId: milestone.id };
}

describe('task creation', () => {
  test('a manager creates a task with a generated human-readable reference', () => {
    const created = tasks.createTask(db, manager(db), {
      ...anyPlacement(db),
      title: 'Check dock latch torque',
      effortDays: 5,
      reviewerId: manager(db).id,
      ownerId: employee1(db).id,
      priority: 'P1',
      startDate: workStart(),
      scheduledDays: 3,
      dayPlans: [
        { date: workDay(0), outcome: 'Torque spec confirmed against the drawing.' },
        { date: workDay(1), outcome: 'All six latches measured and logged.' },
        { date: workDay(2), outcome: 'Out-of-spec latches re-torqued and signed off.' },
      ],
    });

    assert.equal(created.dayPlans.length, 3);
    assert.match(created.ref, /^[A-Z]{2,8}-[A-Z0-9]{2,8}-\d{3}$/);
    assert.equal(created.status, TaskStatus.NotStarted);
    assert.equal(created.progress, 0);
    assert.equal(created.originalDueDate, created.dueDate);
    assert.ok(created.createdAt);
    assert.equal(created.lastUpdatedAt, created.createdAt);
  });

  test('references are unique and increment per project', () => {
    const placement = anyPlacement(db);
    const made = [1, 2, 3].map((n) =>
      tasks.createTask(db, manager(db), {
        ...placement,
        title: `Task ${n}`,
        effortDays: 5,
        reviewerId: manager(db).id,
        ownerId: employee1(db).id,
        priority: 'P2',
        startDate: today(),
        scheduledDays: 1,
      }),
    );
    const refs = made.map((t) => t.ref);
    assert.equal(new Set(refs).size, 3);
    const numbers = refs.map((r) => Number(r.split('-')[2]));
    assert.equal(numbers[1], (numbers[0] as number) + 1);
    assert.equal(numbers[2], (numbers[1] as number) + 1);
  });

  test('an employee cannot create a task', () => {
    assert.throws(
      () =>
        tasks.createTask(db, employee1(db), {
          ...anyPlacement(db),
          title: 'Unauthorised',
          effortDays: 5,
          reviewerId: manager(db).id,
          ownerId: employee1(db).id,
          priority: 'P2',
          startDate: today(),
          scheduledDays: 1,
        }),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.FORBIDDEN,
    );
  });

  test('a due date before the start date is rejected', () => {
    assert.throws(
      () =>
        tasks.createTask(db, manager(db), {
          ...anyPlacement(db),
          title: 'Backwards',
          effortDays: 5,
          reviewerId: manager(db).id,
          ownerId: employee1(db).id,
          priority: 'P2',
          startDate: addDays(today(), 5),
          scheduledDays: 1,
        }),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.VALIDATION,
    );
  });

  test('a task with no start date or no end date is refused', () => {
    const base = {
      ...anyPlacement(db),
      title: 'Undated',
      ownerId: employee1(db).id,
      priority: 'P2' as const,
    };
    for (const dates of [
      { startDate: undefined, dueDate: today() },
      { startDate: today(), dueDate: undefined },
      { startDate: undefined, dueDate: undefined },
    ]) {
      assert.throws(
        // The type says both are required; the check exists for callers that
        // reach the service with data that never went through the validator.
        () => tasks.createTask(db, manager(db), { ...base, ...dates } as never),
        (error: unknown) => error instanceof AppError && error.code === ErrorCode.VALIDATION,
      );
    }
  });

  test('a budget beyond the cap is refused', () => {
    assert.throws(
      () =>
        tasks.createTask(db, manager(db), {
          ...anyPlacement(db),
          title: 'Too long to be one task',
          effortDays: 6,
          reviewerId: manager(db).id,
          ownerId: employee1(db).id,
          priority: 'P2',
        }),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === ErrorCode.VALIDATION &&
        /at most 5 working days/.test(error.message),
    );
  });

  test('a window that spends more than the budget is refused', () => {
    assert.throws(
      () =>
        tasks.createTask(db, manager(db), {
          ...anyPlacement(db),
          title: 'Two days of work spread over a fortnight',
          effortDays: 1,
          reviewerId: manager(db).id,
          ownerId: employee1(db).id,
          priority: 'P2',
          startDate: workStart(),
          scheduledDays: 2,
        }),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === ErrorCode.VALIDATION &&
        /budgeted 1 working day/.test(error.message),
    );
  });

  test('taking fewer days than budgeted is fine — the budget is a ceiling', () => {
    const start = nextWorkingDay(today());
    const days = workingDaysInRange(start, workingDayDeadline(start, 3));
    const created = tasks.createTask(db, manager(db), {
      ...anyPlacement(db),
      title: 'Three of the five budgeted',
      effortDays: 5,
      reviewerId: manager(db).id,
      ownerId: employee1(db).id,
      priority: 'P2',
      startDate: start,
      scheduledDays: 3,
      dayPlans: days.map((date, i) => ({ date, outcome: `Day ${i + 1}.` })),
    });
    assert.equal(created.dayPlans.length, 3);
    // Derived, and weekend-aware: three working days from the start.
    assert.equal(created.dueDate, workingDayDeadline(start, 3));
  });

  test('a multi-day task with no day outcomes is refused', () => {
    assert.throws(
      () =>
        tasks.createTask(db, manager(db), {
          ...anyPlacement(db),
          title: 'Two days, no plan',
          effortDays: 5,
          reviewerId: manager(db).id,
          ownerId: employee1(db).id,
          priority: 'P2',
          startDate: nextWorkingDay(today()),
          scheduledDays: 2,
        }),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === ErrorCode.VALIDATION &&
        error.details.length === 2,
    );
  });

  test('a multi-day task missing one day\u2019s outcome names that day', () => {
    assert.throws(
      () =>
        tasks.createTask(db, manager(db), {
          ...anyPlacement(db),
          title: 'Second day unaccounted for',
          effortDays: 5,
          reviewerId: manager(db).id,
          ownerId: employee1(db).id,
          priority: 'P2',
          startDate: workStart(),
          scheduledDays: 2,
          dayPlans: [{ date: workDay(0), outcome: 'Bench set up.' }],
        }),
      (error: unknown) =>
        error instanceof AppError &&
        error.details.some((d) => d.path === `dayPlans.${addDays(today(), 1)}`),
    );
  });

  test('a blank day outcome does not count as defining the day', () => {
    assert.throws(
      () =>
        tasks.createTask(db, manager(db), {
          ...anyPlacement(db),
          title: 'Whitespace is not a plan',
          effortDays: 5,
          reviewerId: manager(db).id,
          ownerId: employee1(db).id,
          priority: 'P2',
          startDate: workStart(),
          scheduledDays: 2,
          dayPlans: [
            { date: workDay(0), outcome: 'Bench set up.' },
            { date: workDay(1), outcome: '   ' },
          ],
        }),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.VALIDATION,
    );
  });

  test('a day outcome outside the task dates is refused', () => {
    assert.throws(
      () =>
        tasks.createTask(db, manager(db), {
          ...anyPlacement(db),
          title: 'Outcome for a day the task does not cover',
          effortDays: 5,
          reviewerId: manager(db).id,
          ownerId: employee1(db).id,
          priority: 'P2',
          startDate: workStart(),
          scheduledDays: 2,
          dayPlans: [
            { date: workDay(0), outcome: 'Bench set up.' },
            { date: workDay(1), outcome: 'Run complete.' },
            { date: workDay(2), outcome: 'A day that is not part of this task.' },
          ],
        }),
      (error: unknown) =>
        error instanceof AppError && error.details.some((d) => /outside the task/.test(d.message)),
    );
  });

  test('a single-day task needs no day outcomes', () => {
    const created = tasks.createTask(db, manager(db), {
      ...anyPlacement(db),
      title: 'One day, one outcome \u2014 the task itself',
      effortDays: 5,
      reviewerId: manager(db).id,
      ownerId: employee1(db).id,
      priority: 'P2',
      startDate: today(),
      scheduledDays: 1,
    });
    assert.deepEqual(created.dayPlans, []);
  });

  test('an unknown owner is rejected', () => {
    assert.throws(
      () =>
        tasks.createTask(db, manager(db), {
          ...anyPlacement(db),
          title: 'Ghost owner',
          effortDays: 5,
          reviewerId: manager(db).id,
          ownerId: 'no-such-user',
          priority: 'P2',
          startDate: today(),
          scheduledDays: 1,
        }),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.VALIDATION,
    );
  });

  test('creation writes the first history entry', () => {
    const created = tasks.createTask(db, manager(db), {
      ...anyPlacement(db),
      title: 'Logged on creation',
      effortDays: 5,
      reviewerId: manager(db).id,
      ownerId: employee2(db).id,
      priority: 'P0',
      startDate: today(),
      scheduledDays: 1,
    });
    const history = tasks.listHistory(db, manager(db), created.id);
    assert.equal(history.length, 1);
    assert.equal(history[0]?.kind, HistoryKind.Created);
    assert.match(history[0]?.note ?? '', /Demo Employee 2/);
  });
});

describe('visibility scoping', () => {
  test('an employee only lists tasks they are involved in', () => {
    const emp = employee1(db);
    const visible = tasks.listTasks(db, emp);
    assert.ok(visible.length > 0);
    for (const task of visible) {
      const involved =
        task.ownerId === emp.id ||
        task.reviewerId === emp.id ||
        task.supportingMemberIds.includes(emp.id);
      assert.ok(involved, `${task.ref} should not be visible to ${emp.name}`);
    }
  });

  test('a manager lists every task', () => {
    assert.ok(tasks.listTasks(db, manager(db)).length > tasks.listTasks(db, employee1(db)).length);
  });

  test('an employee cannot open someone else’s task', () => {
    const emp = employee1(db);
    const all = tasks.listTasks(db, manager(db));
    const foreign = all.find(
      (t) =>
        t.ownerId !== emp.id && t.reviewerId !== emp.id && !t.supportingMemberIds.includes(emp.id),
    );
    assert.ok(foreign);
    assert.throws(
      () => tasks.getTask(db, emp, foreign.id),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.FORBIDDEN,
    );
  });

  test('a supporting member can read but not update', () => {
    const task = taskByRef(db, 'AD-MAN-003'); // emp2 owns, emp1 supports
    assert.ok(task);
    const supporter = employee1(db);
    assert.doesNotThrow(() => tasks.getTask(db, supporter, task.id));
    assert.throws(
      () => tasks.updateTask(db, supporter, task.id, { progress: 61 }),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.FORBIDDEN,
    );
  });
});

describe('task updates', () => {
  test('an owner moves a task forward and the change is logged', () => {
    const task = taskByRef(db, 'WA-SW-006'); // emp3, not started
    assert.ok(task);
    const updated = tasks.updateTask(db, employee3(db), task.id, {
      status: TaskStatus.InProgress,
      progress: 25,
      nextAction: 'Draft the migration script',
    });

    assert.equal(updated.status, TaskStatus.InProgress);
    assert.equal(updated.progress, 25);
    assert.notEqual(updated.lastUpdatedAt, task.lastUpdatedAt);

    const history = tasks.listHistory(db, employee3(db), task.id);
    const kinds = history.map((h) => h.kind);
    assert.ok(kinds.includes(HistoryKind.StatusChanged));
    assert.ok(kinds.includes(HistoryKind.ProgressChanged));
    assert.ok(kinds.includes(HistoryKind.NextActionSet));
  });

  test('an illegal status jump is refused', () => {
    const task = taskByRef(db, 'WA-SW-006');
    assert.ok(task);
    assert.throws(
      () => tasks.updateTask(db, employee3(db), task.id, { status: TaskStatus.Completed }),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.INVALID_TRANSITION,
    );
  });

  test('an employee cannot change the owner, priority or due date', () => {
    const task = taskByRef(db, 'WA-SW-006');
    assert.ok(task);
    const owner = employee3(db);
    for (const patch of [
      { ownerId: employee1(db).id },
      { priority: 'P0' as const },
      { dueDate: addDays(today(), 30) as string },
    ]) {
      assert.throws(
        () => tasks.updateTask(db, owner, task.id, patch),
        (error: unknown) => error instanceof AppError && error.code === ErrorCode.FORBIDDEN,
      );
    }
  });

  test('a manager reassigns a task and the log names both people', () => {
    const task = taskByRef(db, 'WA-SW-006');
    assert.ok(task);
    const updated = tasks.updateTask(db, manager(db), task.id, { ownerId: employee1(db).id });
    assert.equal(updated.ownerId, employee1(db).id);

    const entry = tasks
      .listHistory(db, manager(db), task.id)
      .find((h) => h.kind === HistoryKind.Reassigned);
    assert.ok(entry);
    assert.equal(entry.fromValue, 'Demo Employee 3');
    assert.equal(entry.toValue, 'Demo Employee 1');
  });

  test('blocking a task requires naming the blocker', () => {
    const task = taskByRef(db, 'AD-MAN-003'); // emp2, in progress
    assert.ok(task);
    assert.throws(
      () => tasks.updateTask(db, employee2(db), task.id, { status: TaskStatus.Blocked }),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.VALIDATION,
    );
    assert.doesNotThrow(() =>
      tasks.updateTask(db, employee2(db), task.id, {
        status: TaskStatus.Blocked,
        blocker: 'Test rig unavailable until Thursday',
      }),
    );
  });

  test('completing a task sets progress to 100 and stamps completedAt', () => {
    const task = taskByRef(db, 'AD-NAV-008'); // in review
    assert.ok(task);
    const done = tasks.updateTask(db, manager(db), task.id, { status: TaskStatus.Completed });
    assert.equal(done.status, TaskStatus.Completed);
    assert.equal(done.progress, 100);
    assert.ok(done.completedAt);
    assert.deepEqual(done.exceptions, []);
  });

  test('reopening a completed task clears completedAt', () => {
    const task = taskByRef(db, 'AD-PER-001'); // completed
    assert.ok(task);
    const reopened = tasks.updateTask(db, manager(db), task.id, { status: TaskStatus.InProgress });
    assert.equal(reopened.completedAt, null);
  });

  test('100% progress is refused before the task reaches review', () => {
    const task = taskByRef(db, 'WA-SW-005'); // in progress
    assert.ok(task);
    assert.throws(
      () => tasks.updateTask(db, employee1(db), task.id, { progress: 100 }),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.VALIDATION,
    );
  });

  test('an empty patch is rejected', () => {
    const task = taskByRef(db, 'WA-SW-006');
    assert.ok(task);
    assert.throws(
      () => tasks.updateTask(db, employee3(db), task.id, {}),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.VALIDATION,
    );
  });

  test('an evidence link is recorded in the history', () => {
    const task = taskByRef(db, 'WA-SW-005');
    assert.ok(task);
    tasks.updateTask(db, employee1(db), task.id, {
      evidenceUrl: 'https://example.com/demo/sync-service-pr',
    });
    const entry = tasks
      .listHistory(db, employee1(db), task.id)
      .find((h) => h.kind === HistoryKind.EvidenceLinked);
    assert.ok(entry);
    assert.equal(entry.toValue, 'https://example.com/demo/sync-service-pr');
  });

  test('a comment supplied with an update lands in both the log and the thread', () => {
    const task = taskByRef(db, 'WA-SW-005');
    assert.ok(task);
    tasks.updateTask(db, employee1(db), task.id, { progress: 50, comment: 'Reconciler merged.' });
    const comments = tasks.listComments(db, employee1(db), task.id);
    assert.ok(comments.some((c) => c.body === 'Reconciler merged.'));
    assert.ok(
      tasks
        .listHistory(db, employee1(db), task.id)
        .some((h) => h.kind === HistoryKind.CommentAdded),
    );
  });
});

describe('dependencies', () => {
  test('a task cannot depend on itself', () => {
    const task = taskByRef(db, 'WA-SW-006');
    assert.ok(task);
    assert.throws(
      () => tasks.updateTask(db, manager(db), task.id, { dependencyTaskIds: [task.id] }),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.VALIDATION,
    );
  });

  test('a circular dependency chain is refused', () => {
    const a = taskByRef(db, 'WA-SW-005');
    const b = taskByRef(db, 'WA-TEST-002'); // already depends on WA-SW-005
    assert.ok(a && b);
    assert.throws(
      () => tasks.updateTask(db, manager(db), a.id, { dependencyTaskIds: [b.id] }),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.CONFLICT,
    );
  });

  test('unknown dependencies are rejected', () => {
    const task = taskByRef(db, 'WA-SW-006');
    assert.ok(task);
    assert.throws(
      () => tasks.updateTask(db, manager(db), task.id, { dependencyTaskIds: ['nope'] }),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.VALIDATION,
    );
  });

  test('seeded dependencies resolve to readable references', () => {
    const task = tasks.getTask(db, manager(db), taskByRef(db, 'AD-TEST-009')?.id ?? '');
    assert.equal(task.dependencyRefs.length, 2);
    for (const dep of task.dependencyRefs) assert.match(dep.ref, /^[A-Z]{2,8}-/);
  });
});

describe('comments', () => {
  test('a supporting member may comment on a task they cannot update', () => {
    const task = taskByRef(db, 'AD-MAN-003');
    assert.ok(task);
    const comment = tasks.addComment(db, employee1(db), task.id, 'Bench rig is free tomorrow.');
    assert.equal(comment.authorName, 'Demo Employee 1');
  });

  test('an outsider cannot comment', () => {
    const task = taskByRef(db, 'AD-MAN-003');
    assert.ok(task);
    assert.throws(
      () => tasks.addComment(db, employee3(db), task.id, 'Not mine'),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.FORBIDDEN,
    );
  });

  test('commenting refreshes the last-updated stamp', () => {
    const task = taskByRef(db, 'AD-MAN-005'); // stale by design
    assert.ok(task);
    tasks.addComment(db, employee2(db), task.id, 'Picking this back up today.');
    const after = tasks.getTask(db, employee2(db), task.id);
    assert.ok(after.lastUpdatedAt > task.lastUpdatedAt);
    assert.ok(!after.exceptions.includes('NO_RECENT_UPDATE'));
  });
});

describe('deadline change requests', () => {
  test('an employee requests, a manager approves, and the due date moves', () => {
    const task = taskByRef(db, 'WA-SW-006');
    assert.ok(task);
    assert.ok(task.dueDate);
    const asked = (task.effortDays ?? 1) + 1;

    const request = tasks.requestDeadlineChange(db, employee3(db), task.id, {
      requestedEffortDays: asked,
      reason: 'Backfill window moved.',
    });
    assert.equal(request.status, 'pending');

    const decided = tasks.decideDeadlineChange(db, manager(db), request.id, { approve: true });
    assert.equal(decided.status, 'approved');

    const after = tasks.getTask(db, manager(db), task.id);
    // The deadline follows the approved budget, counted in working days.
    assert.equal(after.effortDays, asked);
    assert.equal(after.dueDate, workingDayDeadline(task.startDate as string, asked));
    // The first commitment stays visible so slippage can be measured.
    assert.equal(after.originalDueDate, task.dueDate);
  });

  test('a rejected request leaves the deadline untouched', () => {
    const task = taskByRef(db, 'WA-SW-006');
    assert.ok(task);
    assert.ok(task.dueDate);
    const request = tasks.requestDeadlineChange(db, employee3(db), task.id, {
      requestedEffortDays: (task.effortDays ?? 1) + 2,
      reason: 'Other priorities.',
    });
    tasks.decideDeadlineChange(db, manager(db), request.id, {
      approve: false,
      note: 'Hold the date.',
    });
    assert.equal(tasks.getTask(db, manager(db), task.id).dueDate, task.dueDate);
  });

  test('an employee cannot decide their own request', () => {
    const task = taskByRef(db, 'WA-SW-006');
    assert.ok(task);
    assert.ok(task.dueDate);
    const request = tasks.requestDeadlineChange(db, employee3(db), task.id, {
      requestedEffortDays: (task.effortDays ?? 1) + 2,
      reason: 'Needs more time.',
    });
    assert.throws(
      () => tasks.decideDeadlineChange(db, employee3(db), request.id, { approve: true }),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.FORBIDDEN,
    );
  });

  test('only one request may be open per task', () => {
    const task = taskByRef(db, 'WA-SW-006');
    assert.ok(task);
    assert.ok(task.dueDate);
    tasks.requestDeadlineChange(db, employee3(db), task.id, {
      requestedEffortDays: (task.effortDays ?? 1) + 1,
      reason: 'First.',
    });
    assert.throws(
      () =>
        tasks.requestDeadlineChange(db, employee3(db), task.id, {
          requestedEffortDays: (task.effortDays ?? 1) + 2,
          reason: 'Second.',
        }),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.CONFLICT,
    );
  });

  test('an extension beyond the span limit cannot be requested', () => {
    const task = taskByRef(db, 'WA-SW-006');
    assert.ok(task?.dueDate);
    assert.throws(
      () =>
        tasks.requestDeadlineChange(db, employee3(db), task.id, {
          requestedEffortDays: 99,
          reason: 'Needs a month.',
        }),
      (error: unknown) =>
        error instanceof AppError &&
        error.code === ErrorCode.VALIDATION &&
        /at most 5 working days/.test(error.message),
    );
  });

  test('approving an extension leaves the new days owing an outcome', () => {
    const task = taskByRef(db, 'WA-SW-006');
    assert.ok(task?.dueDate && task.startDate);
    // One day today, three days once the extension lands.
    assert.deepEqual(task.dayPlans, []);

    const request = tasks.requestDeadlineChange(db, employee3(db), task.id, {
      requestedEffortDays: (task.effortDays ?? 1) + 2,
      reason: 'Schema freeze slipped.',
    });
    tasks.decideDeadlineChange(db, manager(db), request.id, { approve: true });

    const stretched = tasks.getTask(db, manager(db), task.id);
    const gap = stretched.clarifications.find(
      (c) => c.code === ClarificationCode.MissingDayOutcomes,
    );
    assert.ok(gap && !gap.resolved, 'the two new days should be flagged, not invented');

    // The dates are locked, but the outcomes owed for the new days are not:
    // otherwise the extension would open a gap with no way to close it.
    tasks.updateTask(db, manager(db), task.id, {
      dayPlans: [
        { date: stretched.startDate as string, outcome: 'Schema mapped.' },
        { date: addDays(stretched.startDate as string, 1), outcome: 'Migration run on a copy.' },
        { date: addDays(stretched.startDate as string, 2), outcome: 'Cutover completed.' },
      ],
    });
    const settled = tasks.getTask(db, manager(db), task.id);
    assert.equal(settled.dayPlans.length, 3);
    assert.ok(
      settled.clarifications.find((c) => c.code === ClarificationCode.MissingDayOutcomes)?.resolved,
    );
  });

  test('a decided request cannot be decided again', () => {
    const task = taskByRef(db, 'WA-SW-006');
    assert.ok(task);
    assert.ok(task.dueDate);
    const request = tasks.requestDeadlineChange(db, employee3(db), task.id, {
      requestedEffortDays: (task.effortDays ?? 1) + 2,
      reason: 'Once.',
    });
    tasks.decideDeadlineChange(db, manager(db), request.id, { approve: true });
    assert.throws(
      () => tasks.decideDeadlineChange(db, manager(db), request.id, { approve: false }),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.CONFLICT,
    );
  });
});

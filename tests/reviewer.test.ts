/**
 * The review gate.
 *
 * Work is signed off by somebody other than the person who did it. That is a
 * relationship to one task, not a rank, so most of these tests are about the
 * difference between "a manager" and "this task's reviewer".
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, manager, employee1, employee2, employee3 } from './helpers.ts';
import type { Database } from '../src/db/connection.ts';
import * as tasks from '../src/services/task.service.ts';
import * as projects from '../src/services/project.service.ts';
import * as team from '../src/services/team.service.ts';
import { TaskStatus, Role } from '../src/domain/enums.ts';
import type { Actor } from '../src/domain/types.ts';
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

const newTask = (db: Database, over: Record<string, unknown> = {}): ReturnType<typeof tasks.createTask> =>
  tasks.createTask(db, manager(db), {
    ...placement(db),
    title: 'Latch torque check',
    effortDays: 5,
    ownerId: employee1(db).id,
    reviewerId: employee2(db).id,
    startDate: today(),
    dueDate: today(),
    ...over,
  } as Parameters<typeof tasks.createTask>[2]);

describe('a task cannot be created without a reviewer', () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
  });

  test('omitting one is refused', () => {
    assert.throws(
      () => newTask(db, { reviewerId: undefined }),
      (e: { code?: string }) => e.code === ErrorCode.VALIDATION,
      'with no reviewer the task could never reach Completed',
    );
  });

  test('the owner cannot review their own work', () => {
    assert.throws(
      () => newTask(db, { reviewerId: employee1(db).id }),
      (e: { code?: string }) => e.code === ErrorCode.VALIDATION,
    );
  });

  test('a reviewer who does not exist is refused', () => {
    assert.throws(
      () => newTask(db, { reviewerId: 'user-does-not-exist' }),
      (e: { code?: string }) => e.code === ErrorCode.VALIDATION || e.code === ErrorCode.NOT_FOUND,
    );
  });

  test('a reviewer who is neither owner nor supporter is accepted', () => {
    const created = newTask(db);
    assert.equal(created.reviewerId, employee2(db).id);
  });
});

describe('completion goes through the assigned reviewer', () => {
  let db: Database;
  let taskId: string;
  beforeEach(() => {
    db = freshDb();
    const created = newTask(db);
    taskId = created.id;
    tasks.updateTask(db, employee1(db), taskId, { status: TaskStatus.InProgress });
    tasks.updateTask(db, employee1(db), taskId, { status: TaskStatus.Review });
  });

  test('the owner applies for review', () => {
    assert.equal(tasks.getTask(db, manager(db), taskId).status, TaskStatus.Review);
  });

  test('the owner cannot then complete it', () => {
    assert.throws(
      () => tasks.updateTask(db, employee1(db), taskId, { status: TaskStatus.Completed }),
      (e: { code?: string }) => e.code === ErrorCode.INVALID_TRANSITION,
    );
  });

  test('an uninvolved employee certainly cannot', () => {
    assert.throws(
      () => tasks.updateTask(db, employee3(db), taskId, { status: TaskStatus.Completed }),
      (e: { code?: string }) => e.code === ErrorCode.FORBIDDEN || e.code === ErrorCode.INVALID_TRANSITION,
    );
  });

  test('the assigned reviewer can', () => {
    const done = tasks.updateTask(db, employee2(db), taskId, { status: TaskStatus.Completed });
    assert.equal(done.status, TaskStatus.Completed);
    assert.equal(done.progress, 100);
  });

  test('a manager can too — an absent reviewer must not deadlock the task', () => {
    const done = tasks.updateTask(db, manager(db), taskId, { status: TaskStatus.Completed });
    assert.equal(done.status, TaskStatus.Completed);
  });

  test('the reviewer can send it back instead', () => {
    const back = tasks.updateTask(db, employee2(db), taskId, { status: TaskStatus.InProgress });
    assert.equal(back.status, TaskStatus.InProgress);
  });

  test('the owner cannot withdraw it from review', () => {
    assert.throws(
      () => tasks.updateTask(db, employee1(db), taskId, { status: TaskStatus.InProgress }),
      (e: { code?: string }) => e.code === ErrorCode.INVALID_TRANSITION,
      'otherwise the owner walks it to Completed the long way round',
    );
  });

  test('the refusal names the reviewer rather than blaming the status', () => {
    try {
      tasks.updateTask(db, employee1(db), taskId, { status: TaskStatus.Completed });
      assert.fail('expected a rejection');
    } catch (error) {
      assert.match((error as Error).message, /reviewer/i);
    }
  });
});

describe('work imported without a reviewer', () => {
  test('cannot be sent to review until a manager assigns one', () => {
    const db = freshDb();
    const created = newTask(db);
    tasks.updateTask(db, manager(db), created.id, { reviewerId: null });
    tasks.updateTask(db, employee1(db), created.id, { status: TaskStatus.InProgress });
    assert.throws(
      () => tasks.updateTask(db, employee1(db), created.id, { status: TaskStatus.Review }),
      (e: { code?: string }) => e.code === ErrorCode.CONFLICT,
      'there is nobody to send it to',
    );
  });

  test('and works again once one is assigned', () => {
    const db = freshDb();
    const created = newTask(db);
    tasks.updateTask(db, manager(db), created.id, { reviewerId: null });
    tasks.updateTask(db, employee1(db), created.id, { status: TaskStatus.InProgress });
    tasks.updateTask(db, manager(db), created.id, { reviewerId: employee2(db).id });
    const sent = tasks.updateTask(db, employee1(db), created.id, { status: TaskStatus.Review });
    assert.equal(sent.status, TaskStatus.Review);
  });
});

/**
 * The reviewer ROLE, as distinct from the per-task relationship above.
 *
 * It carries the authority to confirm what other people commit to, and the
 * reach to find it — but only over the tasks it was named on, and nothing of
 * the manager's power to plan the work in the first place.
 */
describe('the reviewer role', () => {
  let db: Database;
  let reviewer: Actor;

  beforeEach(() => {
    db = freshDb();
    const added = team.addTeamMember(db, manager(db), {
      name: 'Dana Reviewer',
      email: 'dana.reviewer@example.com',
      role: Role.Reviewer,
      passcode: 'test-passcode',
    });
    reviewer = { id: added.id, name: added.name, role: added.role };
  });

  test('sees work it has no part in, so it can find what is waiting', () => {
    const task = newTask(db);
    const visible = tasks.listTasks(db, reviewer).map((t) => t.id);
    assert.ok(visible.includes(task.id), 'a reviewer reads the whole board');
  });

  test('decides a deadline request on a task it reviews', () => {
    const task = newTask(db, { reviewerId: reviewer.id });
    assert.ok(task.dueDate);
    const request = tasks.requestDeadlineChange(db, employee1(db), task.id, {
      requestedDueDate: addDays(task.dueDate, 2),
      reason: 'The rig is double-booked.',
    });

    const decided = tasks.decideDeadlineChange(db, reviewer, request.id, { approve: true });
    assert.equal(decided.status, 'approved');
    assert.equal(tasks.getTask(db, manager(db), task.id).dueDate, addDays(task.dueDate, 2));
  });

  test('is refused on a task somebody else reviews', () => {
    // Named reviewer is employee2, not Dana.
    const task = newTask(db);
    assert.ok(task.dueDate);
    const request = tasks.requestDeadlineChange(db, employee1(db), task.id, {
      requestedDueDate: addDays(task.dueDate, 2),
      reason: 'Same rig.',
    });

    assert.throws(
      () => tasks.decideDeadlineChange(db, reviewer, request.id, { approve: true }),
      (e: { code?: string }) => e.code === ErrorCode.FORBIDDEN,
      'the authority follows the accountability',
    );
    assert.equal(tasks.getTask(db, manager(db), task.id).dueDate, task.dueDate);
  });

  test('cannot create the work it reviews', () => {
    assert.throws(
      () =>
        tasks.createTask(db, reviewer, {
          ...placement(db),
          title: 'Something I made up',
          effortDays: 1,
          ownerId: employee1(db).id,
          reviewerId: employee2(db).id,
        } as Parameters<typeof tasks.createTask>[2]),
      (e: { code?: string }) => e.code === ErrorCode.FORBIDDEN,
    );
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Role } from '../src/domain/enums.ts';
import {
  Capability,
  can,
  assertCan,
  canWriteTaskField,
  assertCanWriteTaskFields,
  isParticipant,
  canViewTask,
  canUpdateTask,
  EMPLOYEE_WRITABLE_TASK_FIELDS,
} from '../src/domain/permissions.ts';
import { AppError, ErrorCode } from '../src/lib/errors.ts';

const task = {
  ownerId: 'owner-1',
  reviewerId: 'reviewer-1',
  supportingMemberIds: ['support-1', 'support-2'],
};

describe('capabilities', () => {
  // Shaping the plan and the team: only a manager.
  const managerOnly = [
    Capability.CreateProject,
    Capability.CreateMilestone,
    Capability.ManageTeam,
  ];

  for (const capability of managerOnly) {
    test(`${capability} is manager-only`, () => {
      assert.ok(can(Role.Manager, capability));
      assert.ok(!can(Role.Reviewer, capability), 'a reviewer does not shape the plan or the team');
      assert.ok(!can(Role.Employee, capability));
      assert.throws(
        () => assertCan(Role.Employee, capability),
        (error: unknown) => error instanceof AppError && error.code === ErrorCode.FORBIDDEN,
      );
    });
  }

  // Judging the work: a reviewer needs the same reach as a manager, because
  // they cannot confirm what they cannot see. And handing work out: creating
  // tasks and assigning them, singly or in bulk.
  const managerAndReviewer = [
    Capability.ViewAllTasks,
    Capability.ViewTeamProgress,
    Capability.DecideDeadlineRequest,
    Capability.CreateTask,
    Capability.ReassignTask,
    Capability.BulkAssignTasks,
  ];

  for (const capability of managerAndReviewer) {
    test(`${capability} belongs to managers and reviewers`, () => {
      assert.ok(can(Role.Manager, capability));
      assert.ok(can(Role.Reviewer, capability));
      assert.ok(!can(Role.Employee, capability));
    });
  }

  test('employees may ask for a deadline change', () => {
    assert.ok(can(Role.Employee, Capability.RequestDeadlineChange));
  });

  test('so may a reviewer, who can own work of their own', () => {
    assert.ok(can(Role.Reviewer, Capability.RequestDeadlineChange));
  });

  test('a reviewer may assign a task, but not reschedule or rewrite it', () => {
    for (const field of ['ownerId', 'reviewerId', 'supportingMemberIds', 'priority'] as const) {
      assert.ok(canWriteTaskField(Role.Reviewer, field), `${field} is part of assigning`);
    }
    for (const field of ['dueDate', 'startDate', 'effortDays', 'title', 'description', 'milestoneId'] as const) {
      assert.ok(!canWriteTaskField(Role.Reviewer, field), `${field} is not a reviewer's to set`);
    }
    for (const field of ['status', 'progress', 'blocker'] as const) {
      assert.ok(canWriteTaskField(Role.Reviewer, field));
    }
  });

  test('assigning reaches a task the reviewer is not part of, and nothing else on it does', () => {
    const stranger = 'someone-else';
    assert.ok(canUpdateTask(Role.Reviewer, task, stranger, ['ownerId', 'priority']));
    assert.ok(!canUpdateTask(Role.Reviewer, task, stranger, ['ownerId', 'status']), 'a mixed payload is refused');
    assert.ok(!canUpdateTask(Role.Reviewer, task, stranger, ['status']));
    assert.ok(!canUpdateTask(Role.Reviewer, task, stranger), 'with no fields named, nothing is granted');
    assert.ok(!canUpdateTask(Role.Employee, task, stranger, ['ownerId']), 'a member cannot assign');
  });
});

describe('task field policy', () => {
  for (const field of EMPLOYEE_WRITABLE_TASK_FIELDS) {
    test(`employees may write ${field}`, () => {
      assert.ok(canWriteTaskField(Role.Employee, field));
    });
  }

  const managerOnlyFields = [
    'ownerId',
    'priority',
    'dueDate',
    'startDate',
    'milestoneId',
    'reviewerId',
    'supportingMemberIds',
    'dependencyTaskIds',
    'title',
    'description',
  ] as const;

  for (const field of managerOnlyFields) {
    test(`employees may not write ${field}`, () => {
      assert.ok(!canWriteTaskField(Role.Employee, field));
      assert.ok(canWriteTaskField(Role.Manager, field));
    });
  }

  test('a mixed payload is rejected as a whole', () => {
    assert.throws(
      () => assertCanWriteTaskFields(Role.Employee, ['status', 'dueDate']),
      (error: unknown) => error instanceof AppError && error.status === 403,
    );
  });

  test('the denial explains the deadline-request route', () => {
    try {
      assertCanWriteTaskFields(Role.Employee, ['dueDate']);
      assert.fail('expected a rejection');
    } catch (error) {
      assert.ok(error instanceof AppError);
      assert.match(error.message, /Request a deadline change/);
    }
  });

  test('an allowed payload passes', () => {
    assert.doesNotThrow(() =>
      assertCanWriteTaskFields(Role.Employee, ['status', 'progress', 'blocker', 'nextAction']),
    );
  });

  test('managers may write everything employees can, and more', () => {
    assert.doesNotThrow(() => assertCanWriteTaskFields(Role.Manager, ['status', 'ownerId', 'dueDate']));
  });
});

describe('visibility', () => {
  test('owner, reviewer and supporters all count as participants', () => {
    assert.ok(isParticipant(task, 'owner-1'));
    assert.ok(isParticipant(task, 'reviewer-1'));
    assert.ok(isParticipant(task, 'support-2'));
    assert.ok(!isParticipant(task, 'stranger'));
  });

  test('an employee cannot view a task they are not on', () => {
    assert.ok(!canViewTask(Role.Employee, task, 'stranger'));
    assert.ok(canViewTask(Role.Employee, task, 'support-1'));
  });

  test('a manager sees every task', () => {
    assert.ok(canViewTask(Role.Manager, task, 'stranger'));
  });

  test('updating is narrower than viewing — supporters may read but not drive', () => {
    assert.ok(canViewTask(Role.Employee, task, 'support-1'));
    assert.ok(!canUpdateTask(Role.Employee, task, 'support-1'));
    assert.ok(canUpdateTask(Role.Employee, task, 'owner-1'));
    assert.ok(canUpdateTask(Role.Employee, task, 'reviewer-1'));
  });
});

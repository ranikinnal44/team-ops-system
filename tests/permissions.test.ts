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
  // Planning the work, shaping the plan and managing the team: a Task
  // Assigner, and a reviewer, who holds every capability a Task Assigner does.
  const taskAssigner = [
    Capability.CreateProject,
    Capability.CreateWorkstream,
    Capability.CreateMilestone,
    Capability.CreateDeliverable,
    Capability.CreateTask,
    Capability.ReassignTask,
    Capability.ManageTeam,
    Capability.ViewTeam,
    Capability.ManageSupply,
    Capability.BulkAssignTasks,
    Capability.ViewAllTasks,
    Capability.ViewTeamProgress,
    Capability.DecideDeadlineRequest,
    Capability.ResolveClarification,
  ];

  for (const capability of taskAssigner) {
    test(`${capability} belongs to managers and reviewers, not employees`, () => {
      assert.ok(can(Role.Manager, capability));
      assert.ok(can(Role.Reviewer, capability), 'a reviewer has the same access as a Task Assigner');
      assert.ok(!can(Role.Employee, capability));
      assert.throws(
        () => assertCan(Role.Employee, capability),
        (error: unknown) => error instanceof AppError && error.code === ErrorCode.FORBIDDEN,
      );
    });
  }

  test('employees may ask for a deadline change', () => {
    assert.ok(can(Role.Employee, Capability.RequestDeadlineChange));
  });

  test('so may a reviewer, who can own work of their own', () => {
    assert.ok(can(Role.Reviewer, Capability.RequestDeadlineChange));
  });

  test('a reviewer may write every field a Task Assigner may', () => {
    for (const field of [
      'ownerId', 'reviewerId', 'supportingMemberIds', 'priority', 'dueDate', 'startDate',
      'effortDays', 'title', 'description', 'milestoneId', 'status', 'progress', 'blocker',
    ] as const) {
      assert.ok(canWriteTaskField(Role.Reviewer, field), `${field} is a Task Assigner's, and so a reviewer's`);
    }
  });

  test('a reviewer, like a Task Assigner, may update a task they are not part of; a member may not', () => {
    const stranger = 'someone-else';
    assert.ok(canUpdateTask(Role.Reviewer, task, stranger));
    assert.ok(canUpdateTask(Role.Manager, task, stranger));
    assert.ok(!canUpdateTask(Role.Employee, task, stranger));
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

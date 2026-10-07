import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TaskStatus, Role } from '../src/domain/enums.ts';
import {
  canTransition,
  assertTransition,
  allowedTransitions,
  progressForStatus,
} from '../src/domain/status-machine.ts';
import { AppError, ErrorCode } from '../src/lib/errors.ts';

describe('status transitions', () => {
  const legal: [TaskStatus, TaskStatus][] = [
    [TaskStatus.NotStarted, TaskStatus.InProgress],
    [TaskStatus.InProgress, TaskStatus.Blocked],
    [TaskStatus.InProgress, TaskStatus.Review],
    [TaskStatus.Blocked, TaskStatus.InProgress],
    [TaskStatus.Review, TaskStatus.Completed],
    [TaskStatus.Review, TaskStatus.InProgress],
  ];

  for (const [from, to] of legal) {
    test(`allows ${from} -> ${to} for both roles`, () => {
      assert.ok(canTransition(from, to, Role.Employee));
      assert.ok(canTransition(from, to, Role.Manager));
    });
  }

  const illegal: [TaskStatus, TaskStatus][] = [
    [TaskStatus.NotStarted, TaskStatus.Completed],
    [TaskStatus.NotStarted, TaskStatus.Review],
    [TaskStatus.NotStarted, TaskStatus.Blocked],
    [TaskStatus.InProgress, TaskStatus.Completed],
    [TaskStatus.Blocked, TaskStatus.Completed],
    [TaskStatus.Blocked, TaskStatus.Review],
    [TaskStatus.Completed, TaskStatus.Review],
  ];

  for (const [from, to] of illegal) {
    test(`rejects ${from} -> ${to}`, () => {
      assert.ok(!canTransition(from, to, Role.Manager));
      assert.throws(
        () => assertTransition(from, to, Role.Manager),
        (error: unknown) =>
          error instanceof AppError && error.code === ErrorCode.INVALID_TRANSITION,
      );
    });
  }

  test('reopening a completed task is manager-only', () => {
    assert.ok(canTransition(TaskStatus.Completed, TaskStatus.InProgress, Role.Manager));
    assert.ok(!canTransition(TaskStatus.Completed, TaskStatus.InProgress, Role.Employee));
    assert.throws(() => assertTransition(TaskStatus.Completed, TaskStatus.InProgress, Role.Employee));
  });

  test('a no-op transition is tolerated', () => {
    assert.doesNotThrow(() => assertTransition(TaskStatus.Blocked, TaskStatus.Blocked, Role.Employee));
  });

  test('the error message lists what is actually possible', () => {
    try {
      assertTransition(TaskStatus.NotStarted, TaskStatus.Completed, Role.Employee);
      assert.fail('expected a rejection');
    } catch (error) {
      assert.ok(error instanceof AppError);
      assert.match(error.message, /In Progress/);
    }
  });

  test('employees see no moves out of Completed', () => {
    assert.deepEqual(allowedTransitions(TaskStatus.Completed, Role.Employee), []);
    assert.deepEqual(allowedTransitions(TaskStatus.Completed, Role.Manager), [TaskStatus.InProgress]);
  });

  test('status implies progress only where it is unambiguous', () => {
    assert.equal(progressForStatus(TaskStatus.Completed), 100);
    assert.equal(progressForStatus(TaskStatus.NotStarted), 0);
    assert.equal(progressForStatus(TaskStatus.InProgress), null);
    assert.equal(progressForStatus(TaskStatus.Blocked), null);
    assert.equal(progressForStatus(TaskStatus.Review), null);
  });
});

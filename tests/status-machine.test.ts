import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { TaskStatus, Role } from '../src/domain/enums.ts';
import {
  canTransition,
  assertTransition,
  allowedTransitions,
  progressForStatus,
  type TransitionActor,
} from '../src/domain/status-machine.ts';
import { AppError, ErrorCode } from '../src/lib/errors.ts';

/** The four relationships a person can have to a task being moved. */
const owner: TransitionActor = { role: Role.Employee, isOwner: true, isReviewer: false };
const reviewer: TransitionActor = { role: Role.Employee, isOwner: false, isReviewer: true };
const bystander: TransitionActor = { role: Role.Employee, isOwner: false, isReviewer: false };
const boss: TransitionActor = { role: Role.Manager, isOwner: false, isReviewer: false };

describe('transitions anyone working the task may make', () => {
  const open: [TaskStatus, TaskStatus][] = [
    [TaskStatus.NotStarted, TaskStatus.InProgress],
    [TaskStatus.InProgress, TaskStatus.Blocked],
    [TaskStatus.InProgress, TaskStatus.Review],
    [TaskStatus.Blocked, TaskStatus.InProgress],
  ];

  for (const [from, to] of open) {
    test(`${from} -> ${to} is open to owner, reviewer and manager alike`, () => {
      for (const actor of [owner, reviewer, boss]) {
        assert.ok(canTransition(from, to, actor));
      }
    });
  }

  test('the owner applies for review — that part is theirs', () => {
    assert.ok(canTransition(TaskStatus.InProgress, TaskStatus.Review, owner));
  });
});

describe('leaving Review is the reviewer’s decision', () => {
  test('the owner cannot sign off their own work', () => {
    assert.ok(!canTransition(TaskStatus.Review, TaskStatus.Completed, owner));
    assert.throws(
      () => assertTransition(TaskStatus.Review, TaskStatus.Completed, owner),
      (e: unknown) => e instanceof AppError && e.code === ErrorCode.INVALID_TRANSITION,
    );
  });

  test('the reviewer can', () => {
    assert.ok(canTransition(TaskStatus.Review, TaskStatus.Completed, reviewer));
  });

  test('the owner cannot withdraw from review either', () => {
    // Otherwise the owner pulls the task back to In Progress and walks it to
    // Completed the long way round, and the gate means nothing.
    assert.ok(!canTransition(TaskStatus.Review, TaskStatus.InProgress, owner));
    assert.ok(canTransition(TaskStatus.Review, TaskStatus.InProgress, reviewer));
  });

  test('a manager can, because an absent reviewer must not deadlock a task', () => {
    assert.ok(canTransition(TaskStatus.Review, TaskStatus.Completed, boss));
    assert.ok(canTransition(TaskStatus.Review, TaskStatus.InProgress, boss));
  });

  test('the refusal says it is about the person, not the status', () => {
    try {
      assertTransition(TaskStatus.Review, TaskStatus.Completed, owner);
      assert.fail('expected a rejection');
    } catch (error) {
      assert.ok(error instanceof AppError);
      assert.match(error.message, /reviewer/i);
      assert.doesNotMatch(
        error.message,
        /Allowed from/,
        'the status is fine; saying otherwise would send the owner looking in the wrong place',
      );
    }
  });

  test('an owner sees no way out of Review; a reviewer sees both', () => {
    assert.deepEqual(allowedTransitions(TaskStatus.Review, owner), []);
    assert.deepEqual(
      [...allowedTransitions(TaskStatus.Review, reviewer)].sort(),
      [TaskStatus.Completed, TaskStatus.InProgress].sort(),
    );
  });
});

describe('transitions nobody may make', () => {
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
    test(`rejects ${from} -> ${to}, even for a manager`, () => {
      assert.ok(!canTransition(from, to, boss));
      assert.throws(
        () => assertTransition(from, to, boss),
        (e: unknown) => e instanceof AppError && e.code === ErrorCode.INVALID_TRANSITION,
      );
    });
  }

  test('In Progress -> Completed cannot skip review for anyone', () => {
    for (const actor of [owner, reviewer, boss]) {
      assert.ok(!canTransition(TaskStatus.InProgress, TaskStatus.Completed, actor));
    }
  });
});

describe('reopening finished work', () => {
  test('is manager-only, even for the reviewer who closed it', () => {
    assert.ok(canTransition(TaskStatus.Completed, TaskStatus.InProgress, boss));
    assert.ok(!canTransition(TaskStatus.Completed, TaskStatus.InProgress, reviewer));
    assert.ok(!canTransition(TaskStatus.Completed, TaskStatus.InProgress, owner));
    assert.throws(() => assertTransition(TaskStatus.Completed, TaskStatus.InProgress, owner));
  });

  test('employees see no moves out of Completed', () => {
    assert.deepEqual(allowedTransitions(TaskStatus.Completed, owner), []);
    assert.deepEqual(allowedTransitions(TaskStatus.Completed, reviewer), []);
    assert.deepEqual(allowedTransitions(TaskStatus.Completed, boss), [TaskStatus.InProgress]);
  });
});

describe('general behaviour', () => {
  test('a no-op transition is tolerated', () => {
    assert.doesNotThrow(() => assertTransition(TaskStatus.Blocked, TaskStatus.Blocked, owner));
  });

  test('a bystander still cannot move anything they could not before', () => {
    assert.ok(!canTransition(TaskStatus.Review, TaskStatus.Completed, bystander));
    assert.ok(!canTransition(TaskStatus.Completed, TaskStatus.InProgress, bystander));
  });

  test('the error message lists what is actually possible', () => {
    try {
      assertTransition(TaskStatus.NotStarted, TaskStatus.Completed, owner);
      assert.fail('expected a rejection');
    } catch (error) {
      assert.ok(error instanceof AppError);
      assert.match(error.message, /In Progress/);
    }
  });

  test('status implies progress only where it is unambiguous', () => {
    assert.equal(progressForStatus(TaskStatus.Completed), 100);
    assert.equal(progressForStatus(TaskStatus.NotStarted), 0);
    assert.equal(progressForStatus(TaskStatus.InProgress), null);
    assert.equal(progressForStatus(TaskStatus.Blocked), null);
    assert.equal(progressForStatus(TaskStatus.Review), null);
  });
});

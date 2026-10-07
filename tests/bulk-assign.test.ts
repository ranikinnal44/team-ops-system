/**
 * Bulk assignment.
 *
 * The point of these is that the shortcut does not become a back door: a bulk
 * edit must obey the same field policy, write the same history and clear the
 * same questions as editing one task by hand.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Database } from '../src/db/connection.ts';
import { autoDockDb, actorByEmail } from './helpers.ts';
import * as tasks from '../src/services/task.service.ts';
import * as taskRepo from '../src/repositories/task.repo.ts';
import * as clarificationRepo from '../src/repositories/clarification.repo.ts';
import { ClarificationCode, HistoryKind } from '../src/domain/enums.ts';
import { AppError, ErrorCode } from '../src/lib/errors.ts';

let db: Database;
const manager = (): ReturnType<typeof actorByEmail> => actorByEmail(db, 'rani@example.com');
const employee = (): ReturnType<typeof actorByEmail> => actorByEmail(db, 'firaz@example.com');

beforeEach(() => {
  db = autoDockDb();
});

const someTaskIds = (n: number): string[] => taskRepo.listTasks(db).slice(0, n).map((t) => t.id);

describe('assigning many at once', () => {
  test('sets an owner across a selection', () => {
    const ids = someTaskIds(5);
    const result = tasks.bulkAssign(db, manager(), { taskIds: ids, ownerId: employee().id });
    assert.equal(result.updated, 5);
    assert.equal(result.skipped.length, 0);
    for (const id of ids) {
      assert.equal(taskRepo.findTaskById(db, id)?.ownerId, employee().id);
    }
  });

  test('sets an owner and a priority together', () => {
    const ids = someTaskIds(3);
    tasks.bulkAssign(db, manager(), { taskIds: ids, ownerId: employee().id, priority: 'P0' });
    for (const id of ids) {
      const task = taskRepo.findTaskById(db, id);
      assert.equal(task?.ownerId, employee().id);
      assert.equal(task?.priority, 'P0');
    }
  });

  test('assigning the whole plan leaves nothing unowned', () => {
    const all = taskRepo.listTasks(db).map((t) => t.id);
    const result = tasks.bulkAssign(db, manager(), { taskIds: all, ownerId: employee().id });
    assert.equal(result.updated, 28);
    assert.equal(taskRepo.listTasks(db).filter((t) => t.ownerId === null).length, 0);
  });

  test('clearing an owner is possible, and is not the same as skipping it', () => {
    const ids = someTaskIds(2);
    tasks.bulkAssign(db, manager(), { taskIds: ids, ownerId: employee().id });
    tasks.bulkAssign(db, manager(), { taskIds: ids, ownerId: null });
    for (const id of ids) assert.equal(taskRepo.findTaskById(db, id)?.ownerId, null);
  });

  test('duplicate ids in the selection are applied once', () => {
    const [id] = someTaskIds(1);
    assert.ok(id);
    const result = tasks.bulkAssign(db, manager(), {
      taskIds: [id, id, id],
      ownerId: employee().id,
    });
    assert.equal(result.updated, 1);
  });
});

describe('it obeys the same rules as a single edit', () => {
  test('an employee cannot bulk assign', () => {
    assert.throws(
      () => tasks.bulkAssign(db, employee(), { taskIds: someTaskIds(2), ownerId: employee().id }),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.FORBIDDEN,
    );
  });

  test('every change is written to the task history', () => {
    const ids = someTaskIds(2);
    tasks.bulkAssign(db, manager(), { taskIds: ids, ownerId: employee().id, priority: 'P1' });
    for (const id of ids) {
      const kinds = tasks.listHistory(db, manager(), id).map((h) => h.kind);
      assert.ok(kinds.includes(HistoryKind.Reassigned), 'a bulk edit is still an edit');
      assert.ok(kinds.includes(HistoryKind.FieldChanged));
    }
  });

  test('the history names who it went to', () => {
    const [id] = someTaskIds(1);
    assert.ok(id);
    tasks.bulkAssign(db, manager(), { taskIds: [id], ownerId: employee().id });
    const entry = tasks.listHistory(db, manager(), id).find((h) => h.kind === HistoryKind.Reassigned);
    assert.equal(entry?.fromValue, 'Unassigned');
    assert.equal(entry?.toValue, 'Firaz');
  });

  test('it clears the questions it answers, and only those', () => {
    const [id] = someTaskIds(1);
    assert.ok(id);
    const before = clarificationRepo.listForTask(db, id).filter((c) => !c.resolved);
    assert.equal(before.length, 2, 'owner and priority');

    tasks.bulkAssign(db, manager(), { taskIds: [id], ownerId: employee().id });

    const after = clarificationRepo.listForTask(db, id);
    assert.ok(after.find((c) => c.code === ClarificationCode.UnclearOwner)?.resolved);
    assert.ok(!after.find((c) => c.code === ClarificationCode.MissingPriority)?.resolved);
  });

  test('an unknown owner is refused outright rather than half-applied', () => {
    const ids = someTaskIds(5);
    assert.throws(
      () => tasks.bulkAssign(db, manager(), { taskIds: ids, ownerId: 'nobody' }),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.VALIDATION,
    );
    assert.ok(ids.every((id) => taskRepo.findTaskById(db, id)?.ownerId === null));
  });

  test('one bad id does not abandon the rest of the selection', () => {
    const ids = [...someTaskIds(4), 'does-not-exist'];
    const result = tasks.bulkAssign(db, manager(), { taskIds: ids, ownerId: employee().id });
    assert.equal(result.updated, 4);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0]?.taskId, 'does-not-exist');
  });
});

describe('it refuses meaningless requests', () => {
  test('an empty selection', () => {
    assert.throws(
      () => tasks.bulkAssign(db, manager(), { taskIds: [], ownerId: employee().id }),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.VALIDATION,
    );
  });

  test('a selection with nothing to apply to it', () => {
    assert.throws(
      () => tasks.bulkAssign(db, manager(), { taskIds: someTaskIds(2) }),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.VALIDATION,
    );
  });
});

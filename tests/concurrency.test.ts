/**
 * Two people, one task.
 *
 * The failure this prevents is silent: without it the second save wins and the
 * first person's change is gone with no error anywhere.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Database } from '../src/db/connection.ts';
import { freshDb, manager, employee1, employee2 } from './helpers.ts';
import * as tasks from '../src/services/task.service.ts';
import * as projects from '../src/services/project.service.ts';
import { ErrorCode } from '../src/lib/errors.ts';
import { todayDate } from '../src/lib/dates.ts';

function newTask(db: Database): ReturnType<typeof tasks.createTask> {
  const [workstream] = projects.listWorkstreams(db, manager(db));
  assert.ok(workstream);
  return tasks.createTask(db, manager(db), {
    workstreamId: workstream.id,
    title: 'Latch torque check',
    effortDays: 1,
    ownerId: employee1(db).id,
    reviewerId: employee2(db).id,
    startDate: todayDate(),
    dueDate: todayDate(),
  } as Parameters<typeof tasks.createTask>[2]);
}

describe('conflicting edits', () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
  });

  test('a stale edit is refused rather than applied on top', () => {
    const task = newTask(db);
    const asOpened = task.lastUpdatedAt;

    // Person A saves first.
    tasks.updateTask(db, manager(db), task.id, {
      expectedLastUpdatedAt: asOpened,
      nextAction: 'Chase the torque spec',
    });

    // Person B had the screen open from before that, and saves second.
    assert.throws(
      () =>
        tasks.updateTask(db, manager(db), task.id, {
          expectedLastUpdatedAt: asOpened,
          nextAction: 'Book the rig',
        }),
      (e: { code?: string }) => e.code === ErrorCode.CONFLICT,
    );

    // A's change survived; B's was refused rather than silently merged.
    assert.equal(tasks.getTask(db, manager(db), task.id).nextAction, 'Chase the torque spec');
  });

  test('the refusal names who got there first', () => {
    const task = newTask(db);
    const asOpened = task.lastUpdatedAt;
    tasks.updateTask(db, employee1(db), task.id, {
      expectedLastUpdatedAt: asOpened,
      progress: 40,
    });

    try {
      tasks.updateTask(db, manager(db), task.id, { expectedLastUpdatedAt: asOpened, progress: 90 });
      assert.fail('expected a conflict');
    } catch (error) {
      assert.match((error as Error).message, /changed this task while you were editing it/);
      assert.match((error as Error).message, new RegExp(employee1(db).name));
    }
  });

  test('reloading first makes the same edit succeed', () => {
    const task = newTask(db);
    tasks.updateTask(db, manager(db), task.id, {
      expectedLastUpdatedAt: task.lastUpdatedAt,
      nextAction: 'First',
    });
    const reloaded = tasks.getTask(db, manager(db), task.id);

    const after = tasks.updateTask(db, manager(db), task.id, {
      expectedLastUpdatedAt: reloaded.lastUpdatedAt,
      nextAction: 'Second',
    });
    assert.equal(after.nextAction, 'Second');
  });

  test('a caller that sends no timestamp is not blocked', () => {
    // Bulk assignment and the importers are not editing anybody's open screen.
    const task = newTask(db);
    tasks.updateTask(db, manager(db), task.id, { nextAction: 'From a batch' });
    assert.equal(tasks.getTask(db, manager(db), task.id).nextAction, 'From a batch');
  });
});

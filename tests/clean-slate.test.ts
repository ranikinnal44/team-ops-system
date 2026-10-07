/**
 * Starting from nothing.
 *
 * Every other suite begins from a loaded dataset. These begin from an empty
 * database, which is how a real deployment starts — and is where the sharpest
 * failure lives: a system with no users cannot be signed into at all.
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Database } from '../src/db/connection.ts';
import { createDatabase } from '../src/db/connection.ts';
import * as auth from '../src/services/auth.service.ts';
import * as projects from '../src/services/project.service.ts';
import * as tasks from '../src/services/task.service.ts';
import * as team from '../src/services/team.service.ts';
import * as taskRepo from '../src/repositories/task.repo.ts';
import { config } from '../src/config/index.ts';
import { AppError, ErrorCode } from '../src/lib/errors.ts';
import type { Actor } from '../src/domain/types.ts';

let db: Database;
beforeEach(() => {
  db = createDatabase(':memory:');
});

const actorOf = (user: { id: string; name: string; role: 'manager' | 'employee' }): Actor => ({
  id: user.id,
  name: user.name,
  role: user.role,
});

describe('an empty system can be opened at all', () => {
  test('it reports that it has nobody in it', () => {
    assert.ok(auth.needsBootstrap(db));
    assert.deepEqual(auth.listSelectableUsers(db), []);
  });

  test('nobody can sign in, which is why bootstrap exists', () => {
    assert.throws(
      () => auth.login(db, 'anyone@example.com', config.authPasscode),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.UNAUTHENTICATED,
    );
  });

  test('the first user created is a manager, and is signed in straight away', () => {
    const result = auth.bootstrapFirstManager(db, {
      name: 'Rani',
      email: 'rani@example.com',
      passcode: config.authPasscode,
    });
    assert.equal(result.user.role, 'manager');
    assert.ok(result.session.token);
    assert.ok(!auth.needsBootstrap(db));
  });

  test('it still demands the passcode — an open port is no easier to walk into', () => {
    assert.throws(
      () =>
        auth.bootstrapFirstManager(db, {
          name: 'Intruder',
          email: 'x@example.com',
          passcode: 'wrong',
        }),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.UNAUTHENTICATED,
    );
    assert.ok(auth.needsBootstrap(db), 'a failed attempt must not create anyone');
  });

  test('it closes the moment it succeeds', () => {
    auth.bootstrapFirstManager(db, {
      name: 'Rani',
      email: 'rani@example.com',
      passcode: config.authPasscode,
    });
    assert.throws(
      () =>
        auth.bootstrapFirstManager(db, {
          name: 'Second',
          email: 'second@example.com',
          passcode: config.authPasscode,
        }),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.CONFLICT,
    );
  });
});

describe('building a project from nothing', () => {
  let manager: Actor;
  beforeEach(() => {
    manager = actorOf(
      auth.bootstrapFirstManager(db, {
        name: 'Rani',
        email: 'rani@example.com',
        passcode: config.authPasscode,
      }).user,
    );
  });

  test('the whole hierarchy can be built by hand, in order', () => {
    const project = projects.createProject(db, manager, { name: 'AutoDock', code: 'AD' });
    const workstream = projects.createWorkstream(db, manager, {
      projectId: project.id,
      name: 'Mechanical Design',
      code: 'MEC',
    });
    const milestone = projects.createMilestone(db, manager, {
      workstreamId: workstream.id,
      name: 'Final Design Validation',
      startDate: '2026-10-05',
      endDate: '2026-10-16',
    });
    const task = tasks.createTask(db, manager, {
      workstreamId: workstream.id,
      milestoneId: milestone.id,
      title: 'Proto ready design',
      reviewerId: manager.id,
      startDate: '2026-10-12',
      dueDate: '2026-10-12',
    });
    assert.equal(task.ref, 'AD-MEC-001');
    assert.equal(task.projectName, 'AutoDock');
    assert.equal(task.milestoneName, 'Final Design Validation');
  });

  test('a task can be created before anyone is given it', () => {
    const project = projects.createProject(db, manager, { name: 'AutoDock', code: 'AD' });
    const workstream = projects.createWorkstream(db, manager, {
      projectId: project.id,
      name: 'Mechanical Design',
      code: 'MEC',
    });
    const task = tasks.createTask(db, manager, {
      workstreamId: workstream.id,
      title: 'Unowned for now',
      reviewerId: manager.id,
      startDate: '2026-10-12',
      dueDate: '2026-10-12',
    });
    assert.equal(task.ownerId, null, 'structure is laid out before work is handed out');
    assert.equal(task.priority, null);
    // And it says so, rather than going quiet about it.
    const codes = task.clarifications.map((c) => c.code);
    assert.ok(codes.includes('UNCLEAR_OWNER'));
    assert.ok(codes.includes('MISSING_PRIORITY'));
  });

  test('a second manager can be added, and can build structure too', () => {
    const second = team.addTeamMember(db, manager, {
      name: 'Second Manager',
      email: 'second@example.com',
      role: 'manager',
    });
    const asSecond = actorOf(second);
    const project = projects.createProject(db, asSecond, { name: 'AutoDock', code: 'AD' });
    assert.ok(
      projects.createWorkstream(db, asSecond, {
        projectId: project.id,
        name: 'Procurement',
        code: 'PRC',
      }),
    );
  });

  test('an employee added by a manager cannot build structure', () => {
    const employee = actorOf(
      team.addTeamMember(db, manager, {
        name: 'Firaz',
        email: 'firaz@example.com',
        role: 'employee',
      }),
    );
    assert.throws(
      () => projects.createProject(db, employee, { name: 'Sneaky', code: 'SNK' }),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.FORBIDDEN,
    );
  });
});

describe('structure can be corrected, not just created', () => {
  let manager: Actor;
  let projectId: string;
  let workstreamId: string;
  let milestoneId: string;

  beforeEach(() => {
    manager = actorOf(
      auth.bootstrapFirstManager(db, {
        name: 'Rani',
        email: 'rani@example.com',
        passcode: config.authPasscode,
      }).user,
    );
    projectId = projects.createProject(db, manager, { name: 'AutoDock', code: 'AD' }).id;
    workstreamId = projects.createWorkstream(db, manager, {
      projectId,
      name: 'Mechancial Design',
      code: 'MEC',
    }).id;
    milestoneId = projects.createMilestone(db, manager, {
      workstreamId,
      name: 'Final Desgin Validation',
      startDate: '2026-10-05',
      endDate: '2026-10-16',
    }).id;
  });

  test('a typo in a workstream name can be fixed', () => {
    const fixed = projects.updateWorkstream(db, manager, workstreamId, {
      name: 'Mechanical Design',
    });
    assert.equal(fixed.name, 'Mechanical Design');
  });

  test('a milestone can be renamed and dated after the fact', () => {
    const fixed = projects.updateMilestone(db, manager, milestoneId, {
      name: 'Final Design Validation',
      startDate: '2026-10-12',
      endDate: '2026-10-23',
    });
    assert.equal(fixed.name, 'Final Design Validation');
    assert.equal(fixed.startDate, '2026-10-12');
  });

  test('a milestone that ends before it starts is refused', () => {
    assert.throws(
      () =>
        projects.updateMilestone(db, manager, milestoneId, {
          startDate: '2026-10-23',
          endDate: '2026-10-12',
        }),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.VALIDATION,
    );
  });

  test('an empty milestone can be deleted', () => {
    projects.deleteMilestone(db, manager, milestoneId);
    assert.equal(projects.listMilestones(db, manager, workstreamId).length, 0);
  });

  test('deleting refuses while tasks hang off it, rather than taking them too', () => {
    tasks.createTask(db, manager, {
      workstreamId,
      milestoneId,
      title: 'Something real',
      reviewerId: manager.id,
      startDate: '2026-10-12',
      dueDate: '2026-10-12',
    });
    assert.throws(
      () => projects.deleteMilestone(db, manager, milestoneId),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.CONFLICT,
    );
    assert.throws(
      () => projects.deleteWorkstream(db, manager, workstreamId),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.CONFLICT,
    );
    assert.equal(taskRepo.listTasks(db).length, 1, 'the task must survive the refused delete');
  });

  test('the refusal says what is in the way', () => {
    tasks.createTask(db, manager, {
      workstreamId,
      milestoneId,
      title: 'Something real',
      reviewerId: manager.id,
      startDate: '2026-10-12',
      dueDate: '2026-10-12',
    });
    try {
      projects.deleteWorkstream(db, manager, workstreamId);
      assert.fail('expected a refusal');
    } catch (error) {
      assert.ok(error instanceof AppError);
      assert.match(error.message, /1 milestones|1 tasks/);
    }
  });

  test('two workstreams cannot share a code', () => {
    assert.throws(
      () => projects.createWorkstream(db, manager, { projectId, name: 'Other', code: 'MEC' }),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.CONFLICT,
    );
  });

  test('renaming onto another code is refused too', () => {
    const other = projects.createWorkstream(db, manager, {
      projectId,
      name: 'Procurement',
      code: 'PRC',
    });
    assert.throws(
      () => projects.updateWorkstream(db, manager, other.id, { code: 'MEC' }),
      (error: unknown) => error instanceof AppError && error.code === ErrorCode.CONFLICT,
    );
  });
});

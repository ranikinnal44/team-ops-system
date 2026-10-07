/**
 * Workstream visibility.
 *
 * A manager sees the whole plan. An employee sees only the workstreams they
 * hold work in — as owner, reviewer or supporting member. These tests are
 * mostly NEGATIVE: the point is proving that structure an employee has no
 * part in is absent, not merely empty.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { autoDockWithLogDb, freshDb, actorByEmail, manager, employee1 } from './helpers.ts';
import * as projects from '../src/services/project.service.ts';
import * as taskRepo from '../src/repositories/task.repo.ts';
import {
  ALL_WORKSTREAMS,
  workstreamScope,
  scopeForRole,
  canViewWorkstream,
  assertCanViewWorkstream,
} from '../src/domain/permissions.ts';
import { Role } from '../src/domain/enums.ts';
import { ErrorCode } from '../src/lib/errors.ts';

describe('the scope policy is pure', () => {
  test('a manager scope admits any id, including ones it has never seen', () => {
    assert.ok(canViewWorkstream(ALL_WORKSTREAMS, 'ws-invented-later'));
    assert.deepEqual(scopeForRole(Role.Manager, []), ALL_WORKSTREAMS);
  });

  test('an employee scope admits exactly what it was given', () => {
    const scope = workstreamScope(['a', 'b']);
    assert.ok(canViewWorkstream(scope, 'a'));
    assert.ok(!canViewWorkstream(scope, 'c'));
  });

  test('an employee with no work sees nothing, rather than everything', () => {
    assert.ok(!canViewWorkstream(scopeForRole(Role.Employee, []), 'anything'));
  });

  test('a hidden workstream reports as missing, not as forbidden', () => {
    // "Forbidden" would confirm it exists. An employee has no business
    // learning that a workstream they cannot see is there at all.
    assert.throws(
      () => assertCanViewWorkstream(workstreamScope([]), 'ws-1'),
      (e: { code?: string }) => e.code === ErrorCode.NOT_FOUND,
    );
  });
});

describe('an employee sees only their own slice of the plan', () => {
  const db = autoDockWithLogDb();
  const rani = () => actorByEmail(db, 'rani@example.com');
  const faizan = () => actorByEmail(db, 'faizan@example.com');

  test('their workstreams are the ones they hold work in', () => {
    const mine = projects.listWorkstreams(db, faizan()).map((w) => w.id).sort();
    const participant = taskRepo.listParticipantWorkstreamIds(db, faizan().id).sort();
    assert.deepEqual(mine, participant);
    assert.ok(mine.length > 0, 'this fixture expects Faizan to hold some work');
  });

  test('the manager still sees strictly more', () => {
    const all = projects.listWorkstreams(db, rani());
    const mine = projects.listWorkstreams(db, faizan());
    assert.ok(all.length > mine.length, 'the plan is wider than one person');
    const allIds = new Set(all.map((w) => w.id));
    assert.ok(mine.every((w) => allIds.has(w.id)));
  });

  test('milestones are pruned to those workstreams', () => {
    const visible = new Set(projects.listWorkstreams(db, faizan()).map((w) => w.id));
    const milestones = projects.listMilestones(db, faizan());
    assert.ok(milestones.length > 0);
    assert.ok(milestones.every((m) => visible.has(m.workstreamId)));
    assert.ok(
      projects.listMilestones(db, rani()).length > milestones.length,
      'the manager sees milestones this employee does not',
    );
  });

  test('deliverables are pruned through their milestone', () => {
    const mine = new Set(projects.listMilestones(db, faizan()).map((m) => m.id));
    assert.ok(projects.listDeliverables(db, faizan()).every((d) => mine.has(d.milestoneId)));
  });

  test('asking for a foreign workstream is refused, not answered empty', () => {
    const foreign = projects
      .listWorkstreams(db, rani())
      .find((w) => !projects.listWorkstreams(db, faizan()).some((m) => m.id === w.id));
    assert.ok(foreign, 'this fixture expects a workstream Faizan has no part in');
    assert.throws(
      () => projects.listMilestones(db, faizan(), foreign.id),
      (e: { code?: string }) => e.code === ErrorCode.NOT_FOUND,
      'an empty list would still confirm the workstream exists',
    );
  });
});

describe('an employee with no work at all', () => {
  const db = freshDb();

  const outsider = { id: 'user-nobody', name: 'Nobody', role: Role.Employee } as const;

  test('sees no workstreams, milestones or deliverables', () => {
    assert.ok(projects.listWorkstreams(db, manager(db)).length > 0, 'fixture sanity');
    assert.deepEqual(projects.listWorkstreams(db, outsider), []);
    assert.deepEqual(projects.listMilestones(db, outsider), []);
    assert.deepEqual(projects.listDeliverables(db, outsider), []);
  });

  test('a project they hold no work in is reported as missing', () => {
    const [project] = projects.listProjects(db, manager(db));
    assert.ok(project);
    assert.throws(
      () => projects.getProjectTree(db, outsider, project.id),
      (e: { code?: string }) => e.code === ErrorCode.NOT_FOUND,
      'an empty tree would still confirm the project exists',
    );
    assert.deepEqual(projects.listProjects(db, outsider), [], 'and it is not listed either');
  });

  test('a participating employee still reaches the project', () => {
    const [project] = projects.listProjects(db, manager(db));
    assert.ok(project);
    const tree = projects.getProjectTree(db, employee1(db), project.id);
    assert.ok(tree.workstreams.length > 0);
  });
});

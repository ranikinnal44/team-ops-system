import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Database } from '../src/db/connection.ts';
import {
  freshDb, manager, employee1, startTestServer, loginAs, type TestServer,
} from './helpers.ts';
import * as team from '../src/services/team.service.ts';
import * as userRepo from '../src/repositories/user.repo.ts';
import * as taskRepo from '../src/repositories/task.repo.ts';
import { Role, TaskStatus } from '../src/domain/enums.ts';
import { seedPasscode } from '../src/seed/passcodes.ts';

describe('team service', () => {
  let db: Database;

  beforeEach(() => {
    db = freshDb();
  });

  test('a manager adds a member and the roster includes them', () => {
    const created = team.addTeamMember(db, manager(db), {
      name: 'Priya Raman',
      email: 'Priya.Raman@Example.com',
      role: Role.Employee,
      title: 'Controls Engineer',
      passcode: 'test-passcode',
    });

    assert.equal(created.name, 'Priya Raman');
    assert.equal(created.email, 'priya.raman@example.com', 'email is normalised to lower case');
    assert.equal(created.role, Role.Employee);
    assert.equal(created.title, 'Controls Engineer');
    assert.equal(created.active, true);

    const roster = team.listTeam(db, manager(db));
    assert.ok(roster.some((m) => m.id === created.id));
  });

  test('an employee cannot add a member', () => {
    assert.throws(
      () =>
        team.addTeamMember(db, employee1(db), {
          name: 'Nobody',
          email: 'nobody@example.com',
          role: Role.Employee,
          passcode: 'test-passcode',
        }),
      /not permitted/i,
    );
  });

  test('a duplicate email is refused', () => {
    const existing = userRepo.listUsers(db)[0]!;
    assert.throws(
      () =>
        team.addTeamMember(db, manager(db), {
          name: 'Impostor',
          email: existing.email.toUpperCase(),
          role: Role.Employee,
          passcode: 'test-passcode',
        }),
      /already on the team/i,
    );
  });

  test('a malformed email is refused', () => {
    assert.throws(
      () =>
        team.addTeamMember(db, manager(db), {
          name: 'Bad Email',
          email: 'not-an-email',
          role: Role.Employee,
          passcode: 'test-passcode',
        }),
      /valid email/i,
    );
  });

  test('a manager edits name, designation and role', () => {
    const added = team.addTeamMember(db, manager(db), {
      name: 'Temp Name',
      email: 'edit.me@example.com',
      role: Role.Employee,
      passcode: 'test-passcode',
    });

    const updated = team.updateTeamMember(db, manager(db), added.id, {
      name: 'Real Name',
      title: 'Perception Lead',
      role: Role.Manager,
    });

    assert.equal(updated.name, 'Real Name');
    assert.equal(updated.title, 'Perception Lead');
    assert.equal(updated.role, Role.Manager);
    assert.equal(updated.email, 'edit.me@example.com', 'email is not editable here');
  });

  test('a member with no open work can be deactivated and reactivated', () => {
    const added = team.addTeamMember(db, manager(db), {
      name: 'Short Stay',
      email: 'short.stay@example.com',
      role: Role.Employee,
      passcode: 'test-passcode',
    });

    const off = team.updateTeamMember(db, manager(db), added.id, { active: false });
    assert.equal(off.active, false);
    assert.ok(
      !team.listTeam(db, manager(db)).some((m) => m.id === added.id),
      'deactivated members drop out of the default roster',
    );
    assert.ok(
      team.listTeam(db, manager(db), { includeInactive: true }).some((m) => m.id === added.id),
      'but are still listed when explicitly requested',
    );

    const on = team.updateTeamMember(db, manager(db), added.id, { active: true });
    assert.equal(on.active, true);
  });

  test('deactivating someone who still owns open work is refused, and names the tasks', () => {
    const owner = employee1(db);
    const open = taskRepo
      .listTasks(db, { ownerId: owner.id })
      .filter((t) => t.status !== TaskStatus.Completed);
    assert.ok(open.length > 0, 'fixture should give this employee open work');

    assert.throws(
      () => team.updateTeamMember(db, manager(db), owner.id, { active: false }),
      (error: Error) =>
        /still owns/i.test(error.message) && error.message.includes(open[0]!.ref),
    );
  });

  test('the last active manager cannot be demoted or deactivated', () => {
    const boss = manager(db);

    assert.throws(
      () => team.updateTeamMember(db, boss, boss.id, { role: Role.Employee }),
      /only active Task Assigner/i,
    );
    assert.throws(
      () => team.updateTeamMember(db, boss, boss.id, { active: false }),
      /only active Task Assigner/i,
    );

    // With a second manager in place, the demotion is allowed.
    const deputy = team.addTeamMember(db, boss, {
      name: 'Deputy',
      email: 'deputy@example.com',
      role: Role.Manager,
      passcode: 'test-passcode',
    });
    const demoted = team.updateTeamMember(db, boss, boss.id, { role: Role.Employee });
    assert.equal(demoted.role, Role.Employee);
    assert.equal(userRepo.findUserById(db, deputy.id)?.role, Role.Manager);
  });

  test('a reviewer counts as a Task Assigner, so the last manager may step down once one exists', () => {
    const boss = manager(db);
    const reviewer = team.addTeamMember(db, boss, {
      name: 'Deputy reviewer',
      email: 'deputy-reviewer@example.com',
      role: Role.Reviewer,
      passcode: 'test-passcode',
    });
    // The reviewer can run the team, so nobody is locked out by this.
    const demoted = team.updateTeamMember(db, boss, boss.id, { role: Role.Employee });
    assert.equal(demoted.role, Role.Employee);

    // But now the reviewer is the only Task Assigner left, and is protected.
    const actor = { id: reviewer.id, name: reviewer.name, role: reviewer.role };
    assert.throws(
      () => team.updateTeamMember(db, actor, reviewer.id, { role: Role.Employee }),
      /only active Task Assigner/i,
    );
  });

  test('a manager cannot deactivate their own account', () => {
    const boss = manager(db);
    team.addTeamMember(db, boss, {
      name: 'Deputy',
      email: 'deputy@example.com',
      role: Role.Manager,
      passcode: 'test-passcode',
    });
    assert.throws(
      () => team.updateTeamMember(db, boss, boss.id, { active: false }),
      /your own account/i,
    );
  });

  test('the roster is closed to an employee', () => {
    assert.throws(
      () => team.listTeam(db, employee1(db)),
      /not permitted/i,
      'who is on the team, and which role they hold, is manager-only',
    );
  });

  test('but a reviewer sees the roster, having the same access as a Task Assigner', () => {
    const added = team.addTeamMember(db, manager(db), {
      name: 'Reviewer',
      email: 'reviewer@example.com',
      role: Role.Reviewer,
      passcode: 'test-passcode',
    });
    const roster = team.listTeam(db, { id: added.id, name: added.name, role: added.role });
    assert.ok(roster.length > 0);
  });

  test('a manager still sees everyone, with how much each is carrying', () => {
    const roster = team.listTeam(db, manager(db));
    assert.ok(roster.length > 0);
    assert.ok(roster.every((m) => typeof m.openTasks === 'number'));
    assert.ok(roster.some((m) => m.openTasks > 0));
  });
});

describe('team API', () => {
  let db: Database;
  let server: TestServer;
  let managerToken: string;
  let employeeToken: string;

  before(async () => {
    db = freshDb();
    server = await startTestServer(db);
    managerToken = await loginAs(server, 'demo.manager@example.com');
    employeeToken = await loginAs(server, 'demo.employee1@example.com');
  });

  after(async () => {
    await server.close();
  });

  test('the roster requires a token', async () => {
    const { status } = await server.request('GET', '/api/team');
    assert.equal(status, 401);
  });

  test('a manager adds a member over HTTP and can then sign in as them', async () => {
    const created = await server.request('POST', '/api/team', {
      token: managerToken,
      body: {
        name: 'Nisha Patel',
        email: 'nisha.patel@example.com',
        passcode: seedPasscode('nisha.patel@example.com'),
        role: 'employee',
        title: 'Test Engineer',
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.title, 'Test Engineer');

    const token = await loginAs(server, 'nisha.patel@example.com');
    assert.ok(token.length > 0, 'a newly added member can sign in straight away');
  });

  test('an employee is refused when adding a member', async () => {
    const { status, body } = await server.request('POST', '/api/team', {
      token: employeeToken,
      body: { name: 'No One', email: 'no.one@example.com', role: 'employee', passcode: seedPasscode('no.one@example.com') },
    });
    assert.equal(status, 403);
    assert.equal(body.error.code, 'FORBIDDEN');
  });

  test('an unknown role fails validation', async () => {
    const { status, body } = await server.request('POST', '/api/team', {
      token: managerToken,
      body: { name: 'Odd Role', email: 'odd.role@example.com', role: 'admin', passcode: seedPasscode('odd.role@example.com') },
    });
    assert.equal(status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
    assert.ok(body.error.details.some((d: { path: string }) => d.path === 'role'));
  });

  test('a duplicate email is a conflict', async () => {
    const { status, body } = await server.request('POST', '/api/team', {
      token: managerToken,
      body: { name: 'Clash', email: 'demo.manager@example.com', role: 'employee', passcode: seedPasscode('demo.manager@example.com') },
    });
    assert.equal(status, 409);
    assert.equal(body.error.code, 'CONFLICT');
  });

  test('patching an unknown member is a 404', async () => {
    const { status } = await server.request('PATCH', '/api/team/does-not-exist', {
      token: managerToken,
      body: { title: 'Ghost' },
    });
    assert.equal(status, 404);
  });

  test('a manager patches a designation and the roster reflects it', async () => {
    const created = await server.request('POST', '/api/team', {
      token: managerToken,
      body: { name: 'Arun Kumar', email: 'arun.kumar@example.com', role: 'employee', passcode: seedPasscode('arun.kumar@example.com') },
    });
    const id = created.body.id as string;

    const patched = await server.request('PATCH', `/api/team/${id}`, {
      token: managerToken,
      body: { title: 'Integration Engineer' },
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.title, 'Integration Engineer');

    const roster = await server.request('GET', '/api/team', { token: managerToken });
    assert.equal(roster.status, 200);
    const found = roster.body.find((m: { id: string }) => m.id === id);
    assert.equal(found.title, 'Integration Engineer');
    assert.equal(found.openTasks, 0, 'a brand-new member holds no work yet');
  });
});

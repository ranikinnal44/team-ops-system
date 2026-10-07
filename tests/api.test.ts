import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Database } from '../src/db/connection.ts';
import { freshDb, startTestServer, loginAs, type TestServer } from './helpers.ts';
import { addDays, todayDate } from '../src/lib/dates.ts';

let db: Database;
let server: TestServer;
let managerToken: string;
let employeeToken: string;
let reviewerToken: string;

before(async () => {
  db = freshDb();
  server = await startTestServer(db);
  managerToken = await loginAs(server, 'demo.manager@example.com');
  employeeToken = await loginAs(server, 'demo.employee1@example.com');
  reviewerToken = await loginAs(server, 'demo.employee2@example.com');
});

after(async () => {
  await server.close();
});

describe('authentication', () => {
  test('health is public and reports integrations as disabled', async () => {
    const { status, body } = await server.request('GET', '/api/health');
    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
    assert.deepEqual(body.integrations, {
      googleDrive: false,
      github: false,
      googleCalendar: false,
      notifications: false,
    });
  });

  test('the login screen can list selectable users without a token', async () => {
    const { status, body } = await server.request('GET', '/api/auth/users');
    assert.equal(status, 200);
    assert.equal(body.length, 4);
    assert.ok(body.every((u: Record<string, unknown>) => !('passcode' in u)));
  });

  test('a wrong passcode is rejected', async () => {
    const { status } = await server.request('POST', '/api/auth/login', {
      body: { email: 'demo.manager@example.com', passcode: 'wrong' },
    });
    assert.equal(status, 401);
  });

  test('an unknown email is rejected', async () => {
    const { status } = await server.request('POST', '/api/auth/login', {
      body: { email: 'nobody@example.com', passcode: 'demo1234' },
    });
    assert.equal(status, 401);
  });

  test('a malformed login body fails validation', async () => {
    const { status, body } = await server.request('POST', '/api/auth/login', { body: { email: '' } });
    assert.equal(status, 400);
    assert.equal(body.error.code, 'VALIDATION_ERROR');
  });

  test('protected routes require a token', async () => {
    const { status } = await server.request('GET', '/api/tasks');
    assert.equal(status, 401);
  });

  test('a bogus token is rejected', async () => {
    const { status } = await server.request('GET', '/api/tasks', { token: 'not-a-session' });
    assert.equal(status, 401);
  });

  test('/api/auth/me reflects the signed-in role', async () => {
    const { body } = await server.request('GET', '/api/auth/me', { token: managerToken });
    assert.equal(body.role, 'manager');
    const employee = await server.request('GET', '/api/auth/me', { token: employeeToken });
    assert.equal(employee.body.role, 'employee');
  });

  test('logging out invalidates the session', async () => {
    const token = await loginAs(server, 'demo.employee2@example.com');
    assert.equal((await server.request('GET', '/api/tasks', { token })).status, 200);
    await server.request('POST', '/api/auth/logout', { token });
    assert.equal((await server.request('GET', '/api/tasks', { token })).status, 401);
  });
});

describe('routing', () => {
  test('an unknown api path returns 404 as JSON', async () => {
    const { status, body } = await server.request('GET', '/api/nope', { token: managerToken });
    assert.equal(status, 404);
    assert.equal(body.error.code, 'NOT_FOUND');
  });

  test('an unsupported method on a known path returns 404', async () => {
    const { status } = await server.request('DELETE', '/api/tasks', { token: managerToken });
    assert.equal(status, 404);
  });

  test('a non-api path serves the UI shell', async () => {
    const response = await fetch(`${server.url}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
  });

  test('path traversal cannot escape the public directory', async () => {
    const response = await fetch(`${server.url}/../package.json`);
    const text = await response.text();
    assert.ok(!text.includes('"devDependencies"'));
  });
});

describe('role scoping over HTTP', () => {
  test('a manager sees more tasks than an employee', async () => {
    const all = await server.request('GET', '/api/tasks', { token: managerToken });
    const mine = await server.request('GET', '/api/tasks', { token: employeeToken });
    assert.equal(all.status, 200);
    assert.ok(all.body.length > mine.body.length);
  });

  test('an employee is refused the manager dashboard', async () => {
    const { status } = await server.request('GET', '/api/dashboard/manager', { token: employeeToken });
    assert.equal(status, 403);
  });

  test('an employee is refused task creation', async () => {
    const { status } = await server.request('POST', '/api/tasks', {
      token: employeeToken,
      body: {
        workstreamId: 'any',
        title: 'Nope',
        ownerId: 'any',
        priority: 'P2',
        startDate: todayDate(),
        dueDate: addDays(todayDate(), 1),
      },
    });
    assert.equal(status, 403);
  });
});

describe('the end-to-end flow a manager and employee actually follow', () => {
  test('create, assign, work, block, review, complete — with history throughout', async () => {
    // 1. The manager picks a milestone and creates a task for Demo Employee 1.
    const projects = await server.request('GET', '/api/projects', { token: managerToken });
    const project = projects.body[0];
    const workstreams = await server.request('GET', `/api/workstreams?projectId=${project.id}`, {
      token: managerToken,
    });
    const milestones = await server.request(
      'GET',
      `/api/milestones?workstreamId=${workstreams.body[0].id}`,
      { token: managerToken },
    );
    const users = await server.request('GET', '/api/users', { token: managerToken });
    const employee = users.body.find((u: { email: string }) => u.email === 'demo.employee1@example.com');
    const reviewer = users.body.find((u: { email: string }) => u.email === 'demo.employee2@example.com');

    const created = await server.request('POST', '/api/tasks', {
      token: managerToken,
      body: {
        workstreamId: workstreams.body[0].id,
        milestoneId: milestones.body[0].id,
        title: 'End-to-end flow task',
        description: 'Created by the API test.',
        ownerId: employee.id,
        reviewerId: reviewer.id,
        effortDays: 5,
        priority: 'P1',
        startDate: todayDate(),
        dueDate: addDays(todayDate(), 2),
        dayPlans: [
          { date: todayDate(), outcome: 'Approach drafted.' },
          { date: addDays(todayDate(), 1), outcome: 'Implementation reviewed.' },
          { date: addDays(todayDate(), 2), outcome: 'Evidence captured and linked.' },
        ],
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.dayPlans.length, 3);
    const taskId = created.body.id;
    assert.equal(created.body.status, 'not_started');

    // 2. The employee now sees it on their board.
    const board = await server.request('GET', '/api/dashboard/employee', { token: employeeToken });
    assert.ok(board.body.focus.some((t: { id: string }) => t.id === taskId));

    // 3. They start work and report progress.
    const started = await server.request('PATCH', `/api/tasks/${taskId}`, {
      token: employeeToken,
      body: { status: 'in_progress', progress: 30, nextAction: 'Draft the approach' },
    });
    assert.equal(started.status, 200);
    assert.equal(started.body.progress, 30);

    // 4. They hit a blocker — which must be described.
    const unnamedBlock = await server.request('PATCH', `/api/tasks/${taskId}`, {
      token: employeeToken,
      body: { status: 'blocked' },
    });
    assert.equal(unnamedBlock.status, 400);

    const blocked = await server.request('PATCH', `/api/tasks/${taskId}`, {
      token: employeeToken,
      body: { status: 'blocked', blocker: 'Waiting on the test rig' },
    });
    assert.equal(blocked.body.status, 'blocked');
    assert.ok(blocked.body.exceptions.includes('BLOCKED'));

    // 5. The manager sees it in the blocked exception bucket.
    const dashboard = await server.request('GET', '/api/dashboard/manager', { token: managerToken });
    assert.ok(dashboard.body.exceptions.blocked.some((t: { id: string }) => t.id === taskId));

    // 6. Unblocked, sent for review, then completed with evidence.
    await server.request('PATCH', `/api/tasks/${taskId}`, {
      token: employeeToken,
      body: { status: 'in_progress', comment: 'Rig is free again.' },
    });
    await server.request('PATCH', `/api/tasks/${taskId}`, {
      token: employeeToken,
      body: { status: 'review', progress: 95, evidenceUrl: 'https://example.com/demo/evidence' },
    });

    // The owner cannot sign off their own work, nor withdraw it from review
    // and walk it to Completed the long way round.
    const selfComplete = await server.request('PATCH', `/api/tasks/${taskId}`, {
      token: employeeToken,
      body: { status: 'completed' },
    });
    assert.equal(selfComplete.status, 422, 'the owner must not be able to complete their own task');
    assert.match(selfComplete.body.error.message, /reviewer/i);
    const selfWithdraw = await server.request('PATCH', `/api/tasks/${taskId}`, {
      token: employeeToken,
      body: { status: 'in_progress' },
    });
    assert.equal(selfWithdraw.status, 422, 'nor withdraw from review to get there another way');

    // The assigned reviewer can.
    const completed = await server.request('PATCH', `/api/tasks/${taskId}`, {
      token: reviewerToken,
      body: { status: 'completed' },
    });
    assert.equal(completed.body.status, 'completed');
    assert.equal(completed.body.progress, 100);
    assert.deepEqual(completed.body.exceptions, []);

    // 7. The whole journey is in the activity history.
    const detail = await server.request('GET', `/api/tasks/${taskId}`, { token: managerToken });
    const kinds = detail.body.history.map((h: { kind: string }) => h.kind);
    for (const expected of ['created', 'status_changed', 'progress_changed', 'blocker_added', 'evidence_linked']) {
      assert.ok(kinds.includes(expected), `history should contain ${expected}`);
    }
    assert.ok(detail.body.comments.some((c: { body: string }) => c.body === 'Rig is free again.'));
  });

  test('a deadline change is requested and approved over HTTP', async () => {
    const mine = await server.request('GET', '/api/tasks?status=not_started', { token: employeeToken });
    // A task still short of the span limit, so an extension has somewhere to go.
    const task = mine.body.find(
      (t: { ownerName: string; startDate: string; dueDate: string }) =>
        t.ownerName === 'Demo Employee 1' && t.dueDate < addDays(t.startDate, 2),
    );
    assert.ok(task, 'expected an owned not-started task with schedule headroom');
    const extended = addDays(task.startDate, 2);

    const tooFar = await server.request('POST', `/api/tasks/${task.id}/deadline-requests`, {
      token: employeeToken,
      body: { requestedDueDate: addDays(task.startDate, 9), reason: 'Supplier delay.' },
    });
    assert.equal(tooFar.status, 400, 'the span limit holds on the request path too');

    const requested = await server.request('POST', `/api/tasks/${task.id}/deadline-requests`, {
      token: employeeToken,
      body: { requestedDueDate: extended, reason: 'Supplier delay.' },
    });
    assert.equal(requested.status, 201);

    // The employee cannot approve it themselves.
    const selfApprove = await server.request(
      'POST',
      `/api/deadline-requests/${requested.body.id}/decision`,
      { token: employeeToken, body: { approve: true } },
    );
    assert.equal(selfApprove.status, 403);

    const approved = await server.request(
      'POST',
      `/api/deadline-requests/${requested.body.id}/decision`,
      { token: managerToken, body: { approve: true, note: 'Agreed.' } },
    );
    assert.equal(approved.status, 200);

    const after = await server.request('GET', `/api/tasks/${task.id}`, { token: employeeToken });
    assert.equal(after.body.task.dueDate, extended);
    assert.equal(after.body.task.originalDueDate, task.originalDueDate);
    // The days the extension added have no outcome yet, and that is reported
    // rather than filled in on the manager's behalf.
    assert.ok(
      after.body.task.clarifications.some(
        (c: { code: string; resolved: boolean }) =>
          c.code === 'MISSING_DAY_OUTCOMES' && !c.resolved,
      ),
    );
  });
});

describe('filtering and search', () => {
  test('filters by status', async () => {
    const { body } = await server.request('GET', '/api/tasks?status=blocked', { token: managerToken });
    assert.ok(body.length > 0);
    assert.ok(body.every((t: { status: string }) => t.status === 'blocked'));
  });

  test('filters by exception flag', async () => {
    const { body } = await server.request('GET', '/api/tasks?exception=OVERDUE', {
      token: managerToken,
    });
    assert.ok(body.every((t: { exceptions: string[] }) => t.exceptions.includes('OVERDUE')));
  });

  test('searches across reference, title and description', async () => {
    const { body } = await server.request('GET', '/api/tasks?search=gripper', { token: managerToken });
    assert.ok(body.length > 0);
    assert.ok(
      body.every((t: { title: string; description: string }) =>
        `${t.title} ${t.description}`.toLowerCase().includes('gripper'),
      ),
    );
  });

  test('sorts by the requested key', async () => {
    const { body } = await server.request('GET', '/api/tasks?sort=dueDate', { token: managerToken });
    for (let i = 1; i < body.length; i += 1) {
      assert.ok(body[i - 1].dueDate <= body[i].dueDate);
    }
  });

  test('an unknown sort key falls back rather than failing', async () => {
    const { status } = await server.request('GET', '/api/tasks?sort=banana', { token: managerToken });
    assert.equal(status, 200);
  });
});

describe('project view', () => {
  test('returns the full hierarchy with roll-ups', async () => {
    const projects = await server.request('GET', '/api/projects', { token: managerToken });
    const { status, body } = await server.request(`GET`, `/api/projects/${projects.body[0].id}`, {
      token: managerToken,
    });
    assert.equal(status, 200);
    assert.ok(body.project.name);
    assert.ok(body.workstreams.length > 0);
    assert.ok(body.workstreams[0].milestones.length > 0);
    assert.equal(
      body.totals.total,
      body.workstreams.reduce((sum: number, w: { totals: { total: number } }) => sum + w.totals.total, 0),
    );
  });
});

describe('dates at the API boundary', () => {
  let workstreamId: string;
  let milestoneId: string;
  let taskId: string;

  before(async () => {
    const projects = await server.request('GET', '/api/projects', { token: managerToken });
    const workstreams = await server.request(
      'GET',
      `/api/workstreams?projectId=${projects.body[0].id}`,
      { token: managerToken },
    );
    workstreamId = workstreams.body[0].id;
    const milestones = await server.request('GET', `/api/milestones?workstreamId=${workstreamId}`, {
      token: managerToken,
    });
    milestoneId = milestones.body[0].id;
    const tasks = await server.request('GET', `/api/tasks?workstreamId=${workstreamId}`, {
      token: managerToken,
    });
    taskId = tasks.body[0].id;
  });

  const pathsOf = (body: { error: { details: { path: string }[] } }): string[] =>
    body.error.details.map((d) => d.path);

  test('a milestone cannot be created without a start and an end', async () => {
    const { status, body } = await server.request('POST', '/api/milestones', {
      token: managerToken,
      body: { workstreamId, name: 'Undated milestone' },
    });
    assert.equal(status, 400);
    assert.deepEqual(pathsOf(body).sort(), ['endDate', 'startDate']);
  });

  test('a deliverable cannot be created without a due date', async () => {
    const { status, body } = await server.request('POST', '/api/deliverables', {
      token: managerToken,
      body: { milestoneId, name: 'Undated outcome' },
    });
    assert.equal(status, 400);
    assert.ok(pathsOf(body).includes('dueDate'));
  });

  test('an agreed schedule cannot be patched, even by a manager', async () => {
    const start = todayDate();
    const patched = await server.request('PATCH', `/api/tasks/${taskId}`, {
      token: managerToken,
      body: { startDate: start, dueDate: addDays(start, 1) },
    });
    assert.equal(patched.status, 409, 'locked dates move only through the extension flow');
    assert.match(patched.body.error.message, /extension/i);
  });

  test('a task is created with a budget, and its owner proposes the dates', async () => {
    const users = await server.request('GET', '/api/users', { token: managerToken });
    const owner = users.body.find((u: { email: string }) => u.email === 'demo.employee1@example.com');
    const reviewer = users.body.find((u: { email: string }) => u.email === 'demo.employee2@example.com');

    const created = await server.request('POST', '/api/tasks', {
      token: managerToken,
      body: {
        workstreamId,
        milestoneId,
        title: 'Budgeted, not yet scheduled',
        ownerId: owner.id,
        reviewerId: reviewer.id,
        effortDays: 2,
        priority: 'P2',
      },
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.scheduleState, 'unset');
    assert.equal(created.body.startDate, null);
    assert.ok(created.body.exceptions.includes('SCHEDULE_NOT_SET'));
    const id = created.body.id;

    // Work cannot start on dates nobody has agreed.
    const earlyStart = await server.request('PATCH', `/api/tasks/${id}`, {
      token: employeeToken,
      body: { status: 'in_progress' },
    });
    assert.equal(earlyStart.status, 409);

    const proposed = await server.request('POST', `/api/tasks/${id}/schedule`, {
      token: employeeToken,
      body: { startDate: todayDate(), dueDate: todayDate() },
    });
    assert.equal(proposed.status, 200);
    assert.equal(proposed.body.scheduleState, 'proposed');
    assert.ok(proposed.body.exceptions.includes('SCHEDULE_AWAITING_REVIEW'));

    // Still not startable: proposed is not agreed.
    const stillEarly = await server.request('PATCH', `/api/tasks/${id}`, {
      token: employeeToken,
      body: { status: 'in_progress' },
    });
    assert.equal(stillEarly.status, 409);

    // The owner cannot wave their own dates through.
    const selfApprove = await server.request('POST', `/api/tasks/${id}/schedule/decision`, {
      token: employeeToken,
      body: { approve: true },
    });
    assert.equal(selfApprove.status, 403);

    const agreed = await server.request('POST', `/api/tasks/${id}/schedule/decision`, {
      token: reviewerToken,
      body: { approve: true },
    });
    assert.equal(agreed.status, 200);
    assert.equal(agreed.body.scheduleState, 'locked');

    const started = await server.request('PATCH', `/api/tasks/${id}`, {
      token: employeeToken,
      body: { status: 'in_progress' },
    });
    assert.equal(started.status, 200, 'agreed dates unlock the work');
  });

  test('a milestone span cannot be cleared either', async () => {
    const { status, body } = await server.request('PATCH', `/api/milestones/${milestoneId}`, {
      token: managerToken,
      body: { startDate: null },
    });
    assert.equal(status, 400);
    assert.ok(pathsOf(body).includes('startDate'));
  });
});

describe('the hierarchy endpoints are scoped to the caller', () => {
  test('an employee gets fewer workstreams than the manager', async () => {
    const asManager = await server.request('GET', '/api/workstreams', { token: managerToken });
    const asEmployee = await server.request('GET', '/api/workstreams', { token: employeeToken });
    assert.equal(asManager.status, 200);
    assert.equal(asEmployee.status, 200);
    assert.ok(asManager.body.length > 0, 'fixture sanity');
    assert.ok(
      asEmployee.body.length < asManager.body.length,
      'the route must pass the actor through, not list the whole plan',
    );
    const visible = new Set(asEmployee.body.map((w: { id: string }) => w.id));
    assert.ok([...visible].every((id) => asManager.body.some((w: { id: string }) => w.id === id)));
  });

  test('milestones and deliverables are scoped the same way', async () => {
    for (const path of ['/api/milestones', '/api/deliverables']) {
      const asManager = await server.request('GET', path, { token: managerToken });
      const asEmployee = await server.request('GET', path, { token: employeeToken });
      assert.ok(
        asEmployee.body.length <= asManager.body.length,
        `${path} must not show an employee more than the manager`,
      );
    }
  });

  test('a workstream the employee has no part in is 404, not an empty list', async () => {
    const all = await server.request('GET', '/api/workstreams', { token: managerToken });
    const mine = await server.request('GET', '/api/workstreams', { token: employeeToken });
    const mineIds = new Set(mine.body.map((w: { id: string }) => w.id));
    const foreign = all.body.find((w: { id: string }) => !mineIds.has(w.id));
    assert.ok(foreign, 'fixture sanity: expected a workstream this employee is not on');
    const { status } = await server.request(
      `GET`,
      `/api/milestones?workstreamId=${foreign.id}`,
      { token: employeeToken },
    );
    assert.equal(status, 404, 'an empty 200 would still confirm the workstream exists');
  });
});

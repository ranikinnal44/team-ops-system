/**
 * Role journeys — the whole system driven over HTTP, as each role, with real
 * sign-ins.
 *
 * Everything else that tests the workflow calls the service layer directly
 * with a hand-made `Actor`. That skips the two things a real user goes
 * through first: authentication, and the capability check on the route. These
 * tests go in through `fetch` with a bearer token obtained by signing in, so a
 * permission that is enforced in the service but forgotten on the route — or
 * the reverse — shows up here and nowhere else.
 *
 * The demo dataset has a manager and three employees and no reviewer, so the
 * cast is completed the way a real team would: the manager adds one.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, startTestServer, loginAs, type TestServer } from './helpers.ts';
import { addDays, todayDate, isWeekend } from '../src/lib/dates.ts';

/**
 * The first Monday strictly after today.
 *
 * Journeys need a window of consecutive working days, and a window anchored on
 * "today" silently changes shape depending on the day the suite runs: a task
 * proposed on a Thursday spans a weekend and spends two fewer working days
 * than its calendar length suggests. Monday removes the variable.
 */
function nextMonday(): string {
  let date = addDays(todayDate(), 1);
  while (new Date(`${date}T00:00:00Z`).getUTCDay() !== 1) date = addDays(date, 1);
  return date;
}

type Cast = {
  server: TestServer;
  manager: string;
  owner: string;
  reviewer: string;
  /** An employee with no part in the task under test. */
  outsider: string;
  ids: Record<'manager' | 'owner' | 'reviewer' | 'outsider', string>;
  workstreamId: string;
};

const REVIEWER_EMAIL = 'demo.reviewer@example.com';
const REVIEWER_PASSCODE = 'reviewer123';

async function assemble(): Promise<Cast> {
  const server = await startTestServer(freshDb());

  const managerToken = await loginAs(server, 'demo.manager@example.com');
  const ownerToken = await loginAs(server, 'demo.employee1@example.com');
  const outsiderToken = await loginAs(server, 'demo.employee2@example.com');

  // The cast is completed through the API a manager would actually use.
  const added = await server.request('POST', '/api/team', {
    token: managerToken,
    body: {
      name: 'Demo Reviewer',
      email: REVIEWER_EMAIL,
      role: 'reviewer',
      title: 'Principal Engineer',
      passcode: REVIEWER_PASSCODE,
    },
  });
  assert.equal(added.status, 201, `adding a reviewer failed: ${JSON.stringify(added.body)}`);

  const signedIn = await server.request('POST', '/api/auth/login', {
    body: { email: REVIEWER_EMAIL, passcode: REVIEWER_PASSCODE },
  });
  assert.equal(signedIn.status, 200, 'the reviewer could not sign in with the passcode they were given');

  const me = async (token: string): Promise<string> =>
    (await server.request('GET', '/api/auth/me', { token })).body.id;

  const workstreams = await server.request('GET', '/api/workstreams', { token: managerToken });
  assert.ok(workstreams.body.length > 0, 'the demo dataset has no workstreams');

  return {
    server,
    manager: managerToken,
    owner: ownerToken,
    reviewer: signedIn.body.token,
    outsider: outsiderToken,
    ids: {
      manager: await me(managerToken),
      owner: await me(ownerToken),
      reviewer: signedIn.body.user.id,
      outsider: await me(outsiderToken),
    },
    workstreamId: workstreams.body[0].id,
  };
}

/** A task created by the manager, with the cast's reviewer attached. */
async function newTask(
  cast: Cast,
  overrides: Record<string, unknown> = {},
): Promise<{ id: string; ref: string }> {
  const created = await cast.server.request('POST', '/api/tasks', {
    token: cast.manager,
    body: {
      workstreamId: cast.workstreamId,
      title: 'Bench-test the dock latch',
      reviewerId: cast.ids.reviewer,
      effortDays: 3,
      ...overrides,
    },
  });
  assert.equal(created.status, 201, `task creation failed: ${JSON.stringify(created.body)}`);
  return { id: created.body.id, ref: created.body.ref };
}

const getTask = async (cast: Cast, token: string, id: string) =>
  cast.server.request('GET', `/api/tasks/${id}`, { token });

/** Three consecutive working days starting next Monday, each with an outcome. */
function threeDaySchedule(): { startDate: string; dueDate: string; dayPlans: { date: string; outcome: string }[] } {
  const start = nextMonday();
  const days = [start, addDays(start, 1), addDays(start, 2)];
  assert.ok(days.every((d) => !isWeekend(d)), 'Monday to Wednesday should contain no weekend');
  return {
    startDate: days[0] as string,
    dueDate: days[2] as string,
    dayPlans: days.map((date, i) => ({ date, outcome: `Day ${i + 1}: latch rig step ${i + 1}` })),
  };
}

// ---------------------------------------------------------------------------

describe('the happy path, one task, three roles', () => {
  let cast: Cast;
  let taskId: string;

  before(async () => {
    cast = await assemble();
    taskId = (await newTask(cast, { ownerId: null })).id;
  });
  after(async () => cast.server.close());

  test('an unassigned task is invisible to the employee who will own it', async () => {
    const seen = await getTask(cast, cast.owner, taskId);
    assert.equal(seen.status, 403, 'an employee should not reach a task nobody has given them');
  });

  test('the reviewer can already see it, because they cannot review what they cannot find', async () => {
    const seen = await getTask(cast, cast.reviewer, taskId);
    assert.equal(seen.status, 200);
    assert.equal(seen.body.task.ownerId, null);
  });

  test('the manager assigns an owner', async () => {
    const patched = await cast.server.request('PATCH', `/api/tasks/${taskId}`, {
      token: cast.manager,
      body: { ownerId: cast.ids.owner, priority: 'P1' },
    });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.ownerId, cast.ids.owner);
  });

  test('the owner now sees it, and it asks them for dates', async () => {
    const seen = await getTask(cast, cast.owner, taskId);
    assert.equal(seen.status, 200);
    assert.equal(seen.body.task.scheduleState, 'unset');
    assert.ok(
      seen.body.task.exceptions.includes('SCHEDULE_NOT_SET'),
      `expected SCHEDULE_NOT_SET, got ${JSON.stringify(seen.body.task.exceptions)}`,
    );
  });

  test('nothing starts on an unagreed schedule', async () => {
    const refused = await cast.server.request('PATCH', `/api/tasks/${taskId}`, {
      token: cast.owner,
      body: { status: 'in_progress' },
    });
    assert.equal(refused.status, 409);
    assert.match(refused.body.error.message, /no agreed dates/i);
  });

  test('the owner proposes the dates — this is the commitment', async () => {
    const proposed = await cast.server.request('POST', `/api/tasks/${taskId}/schedule`, {
      token: cast.owner,
      body: threeDaySchedule(),
    });
    assert.equal(proposed.status, 200, JSON.stringify(proposed.body));
    assert.equal(proposed.body.scheduleState, 'proposed');
    assert.ok(proposed.body.exceptions.includes('SCHEDULE_AWAITING_REVIEW'));
  });

  test('a multi-day proposal must say what each day delivers', async () => {
    const other = await newTask(cast, { ownerId: cast.ids.owner });
    const { startDate, dueDate } = threeDaySchedule();
    const refused = await cast.server.request('POST', `/api/tasks/${other.id}/schedule`, {
      token: cast.owner,
      body: { startDate, dueDate },
    });
    assert.equal(refused.status, 400);
    assert.match(refused.body.error.message, /what each day delivers/i);
  });

  test('an uninvolved employee cannot agree somebody else’s dates', async () => {
    const refused = await cast.server.request('POST', `/api/tasks/${taskId}/schedule/decision`, {
      token: cast.outsider,
      body: { approve: true },
    });
    assert.ok(refused.status === 403 || refused.status === 404, `got ${refused.status}`);
  });

  test('the owner cannot agree their own dates either', async () => {
    const refused = await cast.server.request('POST', `/api/tasks/${taskId}/schedule/decision`, {
      token: cast.owner,
      body: { approve: true },
    });
    assert.equal(refused.status, 403);
    assert.match(refused.body.error.message, /reviewer/i);
  });

  test('the reviewer agrees them, and they lock', async () => {
    const agreed = await cast.server.request('POST', `/api/tasks/${taskId}/schedule/decision`, {
      token: cast.reviewer,
      body: { approve: true, note: 'Fits the rig booking.' },
    });
    assert.equal(agreed.status, 200);
    assert.equal(agreed.body.scheduleState, 'locked');
  });

  test('locked dates cannot be edited by anyone, including the manager', async () => {
    const refused = await cast.server.request('PATCH', `/api/tasks/${taskId}`, {
      token: cast.manager,
      body: { dueDate: addDays(nextMonday(), 4) },
    });
    assert.equal(refused.status, 409);
    assert.match(refused.body.error.message, /locked/i);
  });

  test('now the owner can start', async () => {
    const started = await cast.server.request('PATCH', `/api/tasks/${taskId}`, {
      token: cast.owner,
      body: { status: 'in_progress' },
    });
    assert.equal(started.status, 200);
    assert.equal(started.body.status, 'in_progress');
  });

  test('the owner reports what the day produced, and it drives the task progress', async () => {
    const logged = await cast.server.request('POST', `/api/tasks/${taskId}/day-logs`, {
      token: cast.owner,
      body: { outcome: 'Latch rig assembled and instrumented.', progress: 40 },
    });
    assert.equal(logged.status, 201, JSON.stringify(logged.body));

    const seen = await getTask(cast, cast.owner, taskId);
    assert.equal(seen.body.task.progress, 40);
    assert.ok(!seen.body.task.exceptions.includes('MISSING_DAILY_UPDATE'));
  });

  test('the reviewer cannot file a daily outcome — it is a report on work done', async () => {
    const refused = await cast.server.request('POST', `/api/tasks/${taskId}/day-logs`, {
      token: cast.reviewer,
      body: { outcome: 'Looked at it.' },
    });
    assert.equal(refused.status, 403);
    assert.match(refused.body.error.message, /owner or a supporting member/i);
  });

  test('the owner applies for review; they do not grant it', async () => {
    const applied = await cast.server.request('PATCH', `/api/tasks/${taskId}`, {
      token: cast.owner,
      body: { status: 'review', evidenceUrl: 'https://example.com/latch-report' },
    });
    assert.equal(applied.status, 200);
    assert.equal(applied.body.status, 'review');
  });

  test('the owner cannot complete their own work', async () => {
    const refused = await cast.server.request('PATCH', `/api/tasks/${taskId}`, {
      token: cast.owner,
      body: { status: 'completed' },
    });
    assert.equal(refused.status, 422);
    assert.match(refused.body.error.message, /reviewer/i);
  });

  test('nor withdraw it from review to reach Completed the long way round', async () => {
    const refused = await cast.server.request('PATCH', `/api/tasks/${taskId}`, {
      token: cast.owner,
      body: { status: 'in_progress' },
    });
    assert.equal(refused.status, 422);
  });

  test('the reviewer signs it off, and progress follows the status', async () => {
    const done = await cast.server.request('PATCH', `/api/tasks/${taskId}`, {
      token: cast.reviewer,
      body: { status: 'completed' },
    });
    assert.equal(done.status, 200);
    assert.equal(done.body.status, 'completed');
    assert.equal(done.body.progress, 100);
  });

  test('reopening finished work is reserved for a manager', async () => {
    const refused = await cast.server.request('PATCH', `/api/tasks/${taskId}`, {
      token: cast.reviewer,
      body: { status: 'in_progress' },
    });
    assert.equal(refused.status, 422);

    const reopened = await cast.server.request('PATCH', `/api/tasks/${taskId}`, {
      token: cast.manager,
      body: { status: 'in_progress' },
    });
    assert.equal(reopened.status, 200);
  });

  test('the whole journey is on the record, with the right name against each step', async () => {
    const seen = await getTask(cast, cast.manager, taskId);
    const byKind = new Map<string, string>(
      seen.body.history.map((h: any) => [h.kind, h.actorName]),
    );
    assert.equal(byKind.get('schedule_proposed'), 'Demo Employee 1');
    assert.equal(byKind.get('schedule_approved'), 'Demo Reviewer');
    assert.equal(byKind.get('day_outcome_recorded'), 'Demo Employee 1');
    assert.ok(byKind.has('status_changed'));
  });
});

// ---------------------------------------------------------------------------

describe('the rework loops', () => {
  let cast: Cast;
  before(async () => (cast = await assemble()));
  after(async () => cast.server.close());

  test('the reviewer sends dates back, and the owner proposes again', async () => {
    const { id } = await newTask(cast, { ownerId: cast.ids.owner });
    await cast.server.request('POST', `/api/tasks/${id}/schedule`, {
      token: cast.owner,
      body: threeDaySchedule(),
    });

    const sentBack = await cast.server.request('POST', `/api/tasks/${id}/schedule/decision`, {
      token: cast.reviewer,
      body: { approve: false, note: 'The rig is booked that week.' },
    });
    assert.equal(sentBack.status, 200);
    assert.equal(sentBack.body.scheduleState, 'unset', 'a rejected schedule returns to draft');

    // Still cannot start — a sent-back schedule is not an agreed one.
    const refused = await cast.server.request('PATCH', `/api/tasks/${id}`, {
      token: cast.owner,
      body: { status: 'in_progress' },
    });
    assert.equal(refused.status, 409);

    const start = addDays(nextMonday(), 7);
    const retry = await cast.server.request('POST', `/api/tasks/${id}/schedule`, {
      token: cast.owner,
      body: {
        startDate: start,
        dueDate: addDays(start, 2),
        dayPlans: [0, 1, 2].map((i) => ({ date: addDays(start, i), outcome: `Revised day ${i + 1}` })),
      },
    });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.scheduleState, 'proposed');

    const agreed = await cast.server.request('POST', `/api/tasks/${id}/schedule/decision`, {
      token: cast.reviewer,
      body: { approve: true },
    });
    assert.equal(agreed.body.scheduleState, 'locked');
  });

  test('the reviewer sends submitted work back, and the owner picks it up again', async () => {
    const { id } = await newTask(cast, { ownerId: cast.ids.owner, effortDays: 1 });
    const day = nextMonday();
    await cast.server.request('POST', `/api/tasks/${id}/schedule`, {
      token: cast.owner,
      body: { startDate: day, dueDate: day },
    });
    await cast.server.request('POST', `/api/tasks/${id}/schedule/decision`, {
      token: cast.reviewer,
      body: { approve: true },
    });
    await cast.server.request('PATCH', `/api/tasks/${id}`, {
      token: cast.owner,
      body: { status: 'in_progress' },
    });
    await cast.server.request('PATCH', `/api/tasks/${id}`, {
      token: cast.owner,
      body: { status: 'review' },
    });

    const sentBack = await cast.server.request('PATCH', `/api/tasks/${id}`, {
      token: cast.reviewer,
      body: { status: 'in_progress', comment: 'No evidence link — attach the test log.' },
    });
    assert.equal(sentBack.status, 200);
    assert.equal(sentBack.body.status, 'in_progress');

    const seen = await getTask(cast, cast.owner, id);
    assert.ok(
      seen.body.comments.some((c: any) => /evidence link/i.test(c.body)),
      'the reviewer’s reason should reach the owner',
    );
  });

  test('a blocked task has to name its blocker, and can still report its day', async () => {
    const { id } = await newTask(cast, { ownerId: cast.ids.owner, effortDays: 1 });
    const day = nextMonday();
    await cast.server.request('POST', `/api/tasks/${id}/schedule`, {
      token: cast.owner,
      body: { startDate: day, dueDate: day },
    });
    await cast.server.request('POST', `/api/tasks/${id}/schedule/decision`, {
      token: cast.reviewer,
      body: { approve: true },
    });
    await cast.server.request('PATCH', `/api/tasks/${id}`, {
      token: cast.owner,
      body: { status: 'in_progress' },
    });

    const naked = await cast.server.request('PATCH', `/api/tasks/${id}`, {
      token: cast.owner,
      body: { status: 'blocked' },
    });
    assert.equal(naked.status, 400);
    assert.match(naked.body.error.message, /blocker/i);

    const blocked = await cast.server.request('PATCH', `/api/tasks/${id}`, {
      token: cast.owner,
      body: { status: 'blocked', blocker: 'Load cell has not arrived.' },
    });
    assert.equal(blocked.status, 200);

    // Blocked work still reports, so the blocker stays visible and current.
    const logged = await cast.server.request('POST', `/api/tasks/${id}/day-logs`, {
      token: cast.owner,
      body: { outcome: 'Chased the supplier; no movement.' },
    });
    assert.equal(logged.status, 201);

    const cleared = await cast.server.request('PATCH', `/api/tasks/${id}`, {
      token: cast.owner,
      body: { status: 'in_progress', blocker: null },
    });
    assert.equal(cleared.status, 200);
    assert.equal(cleared.body.blocker, null);
  });
});

// ---------------------------------------------------------------------------

describe('asking for more time, from all three sides', () => {
  let cast: Cast;
  let taskId: string;
  let lockedDue: string;

  before(async () => {
    cast = await assemble();
    const { id } = await newTask(cast, { ownerId: cast.ids.owner });
    taskId = id;
    const schedule = threeDaySchedule();
    lockedDue = schedule.dueDate;
    await cast.server.request('POST', `/api/tasks/${taskId}/schedule`, {
      token: cast.owner,
      body: schedule,
    });
    await cast.server.request('POST', `/api/tasks/${taskId}/schedule/decision`, {
      token: cast.reviewer,
      body: { approve: true },
    });
  });
  after(async () => cast.server.close());

  test('an employee cannot simply move the date', async () => {
    const refused = await cast.server.request('PATCH', `/api/tasks/${taskId}`, {
      token: cast.owner,
      body: { dueDate: addDays(lockedDue, 1) },
    });
    assert.equal(refused.status, 403);
    assert.match(refused.body.error.message, /deadline change/i);
  });

  test('somebody who does not own it cannot ask on their behalf', async () => {
    const refused = await cast.server.request('POST', `/api/tasks/${taskId}/deadline-requests`, {
      token: cast.outsider,
      body: { requestedDueDate: addDays(lockedDue, 1), reason: 'Looks tight.' },
    });
    assert.ok(refused.status === 403 || refused.status === 404);
  });

  test('the owner requests it, with a reason', async () => {
    const asked = await cast.server.request('POST', `/api/tasks/${taskId}/deadline-requests`, {
      token: cast.owner,
      body: { requestedDueDate: addDays(lockedDue, 1), reason: 'Load cell arrived two days late.' },
    });
    assert.equal(asked.status, 201, JSON.stringify(asked.body));
    assert.equal(asked.body.status, 'pending');
  });

  test('only one request can be open at a time', async () => {
    const second = await cast.server.request('POST', `/api/tasks/${taskId}/deadline-requests`, {
      token: cast.owner,
      body: { requestedDueDate: addDays(lockedDue, 2), reason: 'And a bit more.' },
    });
    assert.equal(second.status, 409);
  });

  test('a reviewer cannot decide a request on a task somebody else reviews', async () => {
    // A second task, reviewed by the manager rather than by our reviewer.
    const foreign = await newTask(cast, {
      ownerId: cast.ids.owner,
      reviewerId: cast.ids.manager,
      effortDays: 1,
    });
    const day = nextMonday();
    await cast.server.request('POST', `/api/tasks/${foreign.id}/schedule`, {
      token: cast.owner,
      body: { startDate: day, dueDate: day },
    });
    await cast.server.request('POST', `/api/tasks/${foreign.id}/schedule/decision`, {
      token: cast.manager,
      body: { approve: true },
    });
    const asked = await cast.server.request('POST', `/api/tasks/${foreign.id}/deadline-requests`, {
      token: cast.owner,
      body: { requestedDueDate: addDays(day, 1), reason: 'Rig clash.' },
    });
    assert.equal(asked.status, 201);

    const refused = await cast.server.request(
      'POST',
      `/api/deadline-requests/${asked.body.id}/decision`,
      { token: cast.reviewer, body: { approve: true } },
    );
    assert.equal(refused.status, 403);
    assert.match(refused.body.error.message, /reviewer of/i);
  });

  test('the task’s own reviewer approves it, and the original date stays on record', async () => {
    const pending = await cast.server.request('GET', '/api/deadline-requests?status=pending', {
      token: cast.reviewer,
    });
    const mine = pending.body.find((r: any) => r.taskId === taskId);
    assert.ok(mine, 'the reviewer should be able to find the request waiting on them');

    const decided = await cast.server.request(
      'POST',
      `/api/deadline-requests/${mine.id}/decision`,
      { token: cast.reviewer, body: { approve: true, note: 'Supplier slip, not effort.' } },
    );
    assert.equal(decided.status, 200);
    assert.equal(decided.body.status, 'approved');

    const seen = await getTask(cast, cast.owner, taskId);
    assert.equal(seen.body.task.dueDate, addDays(lockedDue, 1), 'the deadline should move');
    assert.equal(
      seen.body.task.originalDueDate,
      lockedDue,
      'slippage against the first commitment must stay measurable',
    );
  });

  test('an extension cannot be used to break the effort cap', async () => {
    const { id } = await newTask(cast, { ownerId: cast.ids.owner, effortDays: 1 });
    const day = nextMonday();
    await cast.server.request('POST', `/api/tasks/${id}/schedule`, {
      token: cast.owner,
      body: { startDate: day, dueDate: day },
    });
    await cast.server.request('POST', `/api/tasks/${id}/schedule/decision`, {
      token: cast.reviewer,
      body: { approve: true },
    });

    const refused = await cast.server.request('POST', `/api/tasks/${id}/deadline-requests`, {
      token: cast.owner,
      body: { requestedDueDate: addDays(day, 21), reason: 'Much more work than thought.' },
    });
    assert.equal(refused.status, 400);
    assert.match(refused.body.error.message, /cap is/i);
  });
});

// ---------------------------------------------------------------------------

describe('what each role can reach', () => {
  let cast: Cast;
  before(async () => (cast = await assemble()));
  after(async () => cast.server.close());

  test('an employee sees only their own work; the reviewer and manager see the board', async () => {
    const asEmployee = await cast.server.request('GET', '/api/tasks', { token: cast.owner });
    const asReviewer = await cast.server.request('GET', '/api/tasks', { token: cast.reviewer });
    const asManager = await cast.server.request('GET', '/api/tasks', { token: cast.manager });

    assert.ok(asEmployee.body.length < asManager.body.length);
    assert.equal(asReviewer.body.length, asManager.body.length, 'a reviewer must see everything');
    assert.ok(
      asEmployee.body.every((t: any) =>
        [t.ownerId, t.reviewerId].includes(cast.ids.owner) ||
        (t.supportingMemberIds ?? []).includes(cast.ids.owner),
      ),
      'an employee list should contain nothing they are not on',
    );
  });

  const managerOnly: [string, string, unknown][] = [
    ['POST', '/api/tasks', { workstreamId: 'x', title: 'x', reviewerId: 'x', effortDays: 1 }],
    ['POST', '/api/projects', { name: 'Shadow project' }],
    ['POST', '/api/team', { name: 'X', email: 'x@y.z', role: 'employee', passcode: 'abcdef' }],
    ['POST', '/api/tasks/bulk-assign', { taskIds: ['x'], ownerId: 'y' }],
  ];

  for (const [method, path, body] of managerOnly) {
    test(`an employee is refused ${method} ${path}`, async () => {
      const refused = await cast.server.request(method, path, { token: cast.owner, body });
      assert.equal(refused.status, 403, JSON.stringify(refused.body));
    });

    test(`a reviewer is refused ${method} ${path} — they decide, they do not plan`, async () => {
      const refused = await cast.server.request(method, path, { token: cast.reviewer, body });
      assert.equal(refused.status, 403, JSON.stringify(refused.body));
    });
  }

  test('the team dashboard is open to the reviewer and closed to the employee', async () => {
    const asReviewer = await cast.server.request('GET', '/api/dashboard/manager', { token: cast.reviewer });
    assert.equal(asReviewer.status, 200);

    const asEmployee = await cast.server.request('GET', '/api/dashboard/manager', { token: cast.owner });
    assert.equal(asEmployee.status, 403);
  });

  test('a reviewer writes no more of a task than an employee does', async () => {
    const { id } = await newTask(cast, { ownerId: cast.ids.owner });
    for (const field of ['title', 'priority', 'effortDays', 'ownerId'] as const) {
      const value = field === 'effortDays' ? 2 : field === 'priority' ? 'P0' : 'x';
      const refused = await cast.server.request('PATCH', `/api/tasks/${id}`, {
        token: cast.reviewer,
        body: { [field]: value },
      });
      assert.equal(refused.status, 403, `a reviewer should not be able to write ${field}`);
    }
  });

  test('a mixed payload is refused as a whole, not partly applied', async () => {
    const { id } = await newTask(cast, { ownerId: cast.ids.owner });
    const refused = await cast.server.request('PATCH', `/api/tasks/${id}`, {
      token: cast.owner,
      body: { nextAction: 'Order the load cell', priority: 'P0' },
    });
    assert.equal(refused.status, 403);

    const seen = await getTask(cast, cast.owner, id);
    assert.equal(seen.body.task.nextAction, null, 'the allowed half must not land either');
  });

  test('an employee asking for a colleague’s board gets their own', async () => {
    // The parameter is ignored rather than refused, so the request succeeds —
    // what matters is that none of the colleague's work comes back in it.
    const asked = await cast.server.request(
      'GET',
      `/api/dashboard/employee?userId=${cast.ids.outsider}`,
      { token: cast.owner },
    );
    assert.equal(asked.status, 200);

    const own = await cast.server.request('GET', '/api/dashboard/employee', { token: cast.owner });
    assert.deepEqual(
      asked.body.summary,
      own.body.summary,
      'an employee pointing the board at somebody else must still see only their own',
    );

    assert.deepEqual(
      asked.body.focus.map((t: any) => t.id),
      own.body.focus.map((t: any) => t.id),
      'the userId parameter must have no effect for an employee',
    );
  });

  test('a session can be ended, and the token stops working', async () => {
    const token = await loginAs(cast.server, 'demo.employee3@example.com');
    assert.equal((await cast.server.request('GET', '/api/auth/me', { token })).status, 200);
    await cast.server.request('POST', '/api/auth/logout', { token });
    assert.equal((await cast.server.request('GET', '/api/auth/me', { token })).status, 401);
  });
});

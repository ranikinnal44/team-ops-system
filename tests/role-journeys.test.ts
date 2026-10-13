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
import { workingDayDeadline, addDays, todayDate, isWeekend } from '../src/lib/dates.ts';

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
function threeDaySchedule(): {
  startDate: string;
  effortDays: number;
  dayPlans: { date: string; outcome: string }[];
} {
  const start = nextMonday();
  const days = [start, addDays(start, 1), addDays(start, 2)];
  assert.ok(days.every((d) => !isWeekend(d)), 'Monday to Wednesday should contain no weekend');
  return {
    startDate: days[0] as string,
    // The deadline is derived from this; no due date is supplied anywhere.
    effortDays: 3,
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

  test('nothing starts without a start date', async () => {
    const refused = await cast.server.request('PATCH', `/api/tasks/${taskId}`, {
      token: cast.owner,
      body: { status: 'in_progress' },
    });
    assert.equal(refused.status, 409);
    assert.match(refused.body.error.message, /no start date/i);
  });

  test('the owner says when they will start, and the deadline follows', async () => {
    const schedule = threeDaySchedule();
    const set = await cast.server.request('POST', `/api/tasks/${taskId}/schedule`, {
      token: cast.owner,
      body: schedule,
    });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    // Nobody agrees it: the budget was agreed when it was set, and the start
    // date is the owner's to choose.
    assert.equal(set.body.scheduleState, 'locked');
    assert.equal(set.body.startDate, schedule.startDate);
    // Derived, never typed — and counted in working days.
    assert.equal(set.body.dueDate, workingDayDeadline(schedule.startDate, schedule.effortDays));
  });

  test('a multi-day proposal must say what each day delivers', async () => {
    const other = await newTask(cast, { ownerId: cast.ids.owner });
    const { startDate, effortDays } = threeDaySchedule();
    const refused = await cast.server.request('POST', `/api/tasks/${other.id}/schedule`, {
      token: cast.owner,
      body: { startDate, effortDays },
    });
    assert.equal(refused.status, 400);
    assert.match(refused.body.error.message, /what each day delivers/i);
  });

  test('an uninvolved employee cannot schedule somebody else’s task', async () => {
    const refused = await cast.server.request('POST', `/api/tasks/${taskId}/schedule`, {
      token: cast.outsider,
      body: threeDaySchedule(),
    });
    assert.ok(refused.status === 403 || refused.status === 404, `got ${refused.status}`);
  });

  test('the owner cannot take more days than they were budgeted', async () => {
    const fresh = await newTask(cast, { ownerId: cast.ids.owner });
    const refused = await cast.server.request('POST', `/api/tasks/${fresh.id}/schedule`, {
      token: cast.owner,
      body: { startDate: nextMonday(), effortDays: 99 },
    });
    assert.equal(refused.status, 400);
    assert.match(refused.body.error.message, /budgeted/i);
  });

  test('an agreed schedule cannot be edited by anyone, including the Task Assigner', async () => {
    const refused = await cast.server.request('PATCH', `/api/tasks/${taskId}`, {
      token: cast.manager,
      body: { dueDate: addDays(nextMonday(), 4) },
    });
    assert.ok(refused.status === 400 || refused.status === 409, `got ${refused.status}`);
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
    // The owner sets the schedule and nobody agrees it, so there is one
    // schedule entry on the record rather than a proposal and an approval.
    assert.equal(byKind.get('schedule_proposed'), 'Demo Employee 1');
    assert.ok(!byKind.has('schedule_approved'), 'nothing approves a schedule now');
    assert.equal(byKind.get('day_outcome_recorded'), 'Demo Employee 1');
    assert.ok(byKind.has('status_changed'));
  });
});

// ---------------------------------------------------------------------------

describe('the rework loops', () => {
  let cast: Cast;
  before(async () => (cast = await assemble()));
  after(async () => cast.server.close());

  test('a schedule already set cannot be quietly replaced', async () => {
    const { id } = await newTask(cast, { ownerId: cast.ids.owner });
    const first = await cast.server.request('POST', `/api/tasks/${id}/schedule`, {
      token: cast.owner,
      body: threeDaySchedule(),
    });
    assert.equal(first.status, 200);

    // There is no approval to withdraw and no rejection to recover from, so
    // the only route to different dates is a change to the budget.
    const again = await cast.server.request('POST', `/api/tasks/${id}/schedule`, {
      token: cast.owner,
      body: threeDaySchedule(),
    });
    assert.equal(again.status, 409);
    assert.match(again.body.error.message, /already has a start date/i);
  });

  test('the reviewer sends submitted work back, and the owner picks it up again', async () => {
    const { id } = await newTask(cast, { ownerId: cast.ids.owner, effortDays: 1 });
    await cast.server.request('POST', `/api/tasks/${id}/schedule`, {
      token: cast.owner,
      body: { startDate: nextMonday(), effortDays: 1 },
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
    await cast.server.request('POST', `/api/tasks/${id}/schedule`, {
      token: cast.owner,
      body: { startDate: nextMonday(), effortDays: 1 },
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
    // Derived now, so read it back rather than asserting one we chose.
    lockedDue = workingDayDeadline(schedule.startDate, schedule.effortDays);
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
      body: { requestedEffortDays: 4, reason: 'Looks tight.' },
    });
    assert.ok(refused.status === 403 || refused.status === 404);
  });

  test('the owner requests it, with a reason', async () => {
    const asked = await cast.server.request('POST', `/api/tasks/${taskId}/deadline-requests`, {
      token: cast.owner,
      body: { requestedEffortDays: 4, reason: 'Load cell arrived two days late.' },
    });
    assert.equal(asked.status, 201, JSON.stringify(asked.body));
    assert.equal(asked.body.status, 'pending');
  });

  test('only one request can be open at a time', async () => {
    const second = await cast.server.request('POST', `/api/tasks/${taskId}/deadline-requests`, {
      token: cast.owner,
      body: { requestedEffortDays: 5, reason: 'And a bit more.' },
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
    await cast.server.request('POST', `/api/tasks/${foreign.id}/schedule`, {
      token: cast.owner,
      body: { startDate: nextMonday(), effortDays: 1 },
    });
    await cast.server.request('POST', `/api/tasks/${foreign.id}/schedule/decision`, {
      token: cast.manager,
      body: { approve: true },
    });
    const asked = await cast.server.request('POST', `/api/tasks/${foreign.id}/deadline-requests`, {
      token: cast.owner,
      body: { requestedEffortDays: 4, reason: 'Rig clash.' },
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
    // The budget rose by one working day, so the derived deadline follows.
    assert.equal(
      seen.body.task.dueDate,
      workingDayDeadline(seen.body.task.startDate, 4),
      'the deadline should follow the approved budget',
    );
    assert.equal(
      seen.body.task.originalDueDate,
      lockedDue,
      'slippage against the first commitment must stay measurable',
    );
  });

  test('an extension cannot be used to break the effort cap', async () => {
    const { id } = await newTask(cast, { ownerId: cast.ids.owner, effortDays: 1 });
    await cast.server.request('POST', `/api/tasks/${id}/schedule`, {
      token: cast.owner,
      body: { startDate: nextMonday(), effortDays: 1 },
    });

    const refused = await cast.server.request('POST', `/api/tasks/${id}/deadline-requests`, {
      token: cast.owner,
      body: { requestedEffortDays: 99, reason: 'Much more work than thought.' },
    });
    assert.equal(refused.status, 400);
    assert.match(refused.body.error.message, /at most 5 working days/i);
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

// ---------------------------------------------------------------------------

/**
 * The system's third rule: work is signed off by someone other than whoever
 * did it. `createTask` enforces it. These check that nothing downstream can
 * undo it, which is the part that decides whether the rule actually holds.
 */
describe('invariant: nobody signs off their own work', () => {
  let cast: Cast;
  before(async () => (cast = await assemble()));
  after(async () => cast.server.close());

  test('a task cannot be created with its owner as its own reviewer', async () => {
    const refused = await cast.server.request('POST', '/api/tasks', {
      token: cast.manager,
      body: {
        workstreamId: cast.workstreamId,
        title: 'Self-reviewed at birth',
        ownerId: cast.ids.owner,
        reviewerId: cast.ids.owner,
        effortDays: 1,
      },
    });
    assert.equal(refused.status, 400);
  });

  test('nor edited into one by pointing the reviewer at the owner', async () => {
    const { id } = await newTask(cast, { ownerId: cast.ids.owner });
    const patched = await cast.server.request('PATCH', `/api/tasks/${id}`, {
      token: cast.manager,
      body: { reviewerId: cast.ids.owner },
    });
    assert.notEqual(
      patched.status,
      200,
      'making the owner their own reviewer must be refused on update, as it is on create',
    );
  });

  test('nor by moving the owner onto somebody who already reviews it', async () => {
    const { id } = await newTask(cast, { ownerId: cast.ids.owner });
    const patched = await cast.server.request('PATCH', `/api/tasks/${id}`, {
      token: cast.manager,
      body: { ownerId: cast.ids.reviewer },
    });
    assert.notEqual(patched.status, 200, 'the reviewer must not become the owner of what they review');
  });

  test('nor in bulk, which is the screen a fresh plan is actually assigned from', async () => {
    const { id } = await newTask(cast, { ownerId: null });
    const applied = await cast.server.request('POST', '/api/tasks/bulk-assign', {
      token: cast.manager,
      body: { taskIds: [id], ownerId: cast.ids.reviewer },
    });
    assert.equal(applied.status, 200);
    assert.equal(
      applied.body.updated,
      0,
      'bulk assignment must skip a task whose reviewer is the person being made owner',
    );
  });

  test('and so the person who did the work can never be the one who signs it off', async () => {
    const { id } = await newTask(cast, { ownerId: cast.ids.owner, effortDays: 1 });
    await cast.server.request('PATCH', `/api/tasks/${id}`, {
      token: cast.manager,
      body: { reviewerId: cast.ids.owner },
    });

    await cast.server.request('POST', `/api/tasks/${id}/schedule`, {
      token: cast.owner,
      body: { startDate: nextMonday(), effortDays: 1 },
    });
    await cast.server.request('POST', `/api/tasks/${id}/schedule/decision`, {
      token: cast.manager,
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

    const selfSignOff = await cast.server.request('PATCH', `/api/tasks/${id}`, {
      token: cast.owner,
      body: { status: 'completed' },
    });
    assert.notEqual(
      selfSignOff.status,
      200,
      'an employee completed their own task — the review gate was bypassed',
    );
  });
});

// ---------------------------------------------------------------------------

describe('invariant: 100% means reviewed', () => {
  let cast: Cast;
  before(async () => (cast = await assemble()));
  after(async () => cast.server.close());

  test('a daily outcome cannot push a task to 100% while it is still in progress', async () => {
    const { id } = await newTask(cast, { ownerId: cast.ids.owner, effortDays: 1 });
    await cast.server.request('POST', `/api/tasks/${id}/schedule`, {
      token: cast.owner,
      body: { startDate: nextMonday(), effortDays: 1 },
    });
    await cast.server.request('POST', `/api/tasks/${id}/schedule/decision`, {
      token: cast.reviewer,
      body: { approve: true },
    });
    await cast.server.request('PATCH', `/api/tasks/${id}`, {
      token: cast.owner,
      body: { status: 'in_progress' },
    });

    // The direct route is refused...
    const direct = await cast.server.request('PATCH', `/api/tasks/${id}`, {
      token: cast.owner,
      body: { progress: 100 },
    });
    assert.equal(direct.status, 400);

    // ...so the daily log must not be a way around it.
    const viaLog = await cast.server.request('POST', `/api/tasks/${id}/day-logs`, {
      token: cast.owner,
      body: { outcome: 'Finished everything.', progress: 100 },
    });
    const seen = await getTask(cast, cast.owner, id);
    assert.ok(
      !(seen.body.task.progress === 100 && seen.body.task.status === 'in_progress'),
      `a day log left the task at 100% while In Progress (log status ${viaLog.status})`,
    );
  });
});

// ---------------------------------------------------------------------------

/**
 * The reviewer's queue.
 *
 * A reviewer is handed the whole board so they can find what is waiting on
 * them — which is precisely why they could not find it: their two proposals
 * sat in a list of everybody's, and there was no filter that said "mine".
 */
describe('finding what is waiting on you', () => {
  let cast: Cast;
  before(async () => (cast = await assemble()));
  after(async () => cast.server.close());

  /** Drives a task to a proposed-but-undecided schedule. */
  async function proposed(reviewerId: string): Promise<string> {
    const { id } = await newTask(cast, { ownerId: cast.ids.owner, reviewerId, effortDays: 1 });
    await cast.server.request('POST', `/api/tasks/${id}/schedule`, {
      token: cast.owner,
      body: { startDate: nextMonday(), effortDays: 1 },
    });
    return id;
  }

  /** Drives a task all the way to submitted-for-review. */
  async function submitted(reviewerId: string, _decider: string): Promise<string> {
    // Scheduling is the owner's alone now, so there is nothing to approve
    // between setting the dates and starting the work.
    const id = await proposed(reviewerId);
    await cast.server.request('PATCH', `/api/tasks/${id}`, {
      token: cast.owner,
      body: { status: 'in_progress' },
    });
    await cast.server.request('PATCH', `/api/tasks/${id}`, {
      token: cast.owner,
      body: { status: 'review' },
    });
    return id;
  }

  test('the task list can be filtered to one reviewer', async () => {
    const mine = await proposed(cast.ids.reviewer);
    const theirs = await proposed(cast.ids.manager);

    const filtered = await cast.server.request(
      `GET`,
      `/api/tasks?reviewerId=${cast.ids.reviewer}`,
      { token: cast.reviewer },
    );
    assert.equal(filtered.status, 200);
    const ids = filtered.body.map((t: any) => t.id);
    assert.ok(ids.includes(mine), 'a task they review should be in it');
    assert.ok(!ids.includes(theirs), 'a task somebody else reviews should not');
    assert.ok(
      filtered.body.every((t: any) => t.reviewerId === cast.ids.reviewer),
      'nothing else should come back',
    );
  });

  test('the filter cannot widen what an employee is allowed to see', async () => {
    const theirs = await proposed(cast.ids.manager);
    const asEmployee = await cast.server.request(
      'GET',
      `/api/tasks?reviewerId=${cast.ids.manager}`,
      { token: cast.outsider },
    );
    assert.equal(asEmployee.status, 200);
    assert.ok(
      !asEmployee.body.some((t: any) => t.id === theirs),
      'an employee must not reach a task through the reviewer filter that they could not reach without it',
    );
  });

  test('the dashboard carries a queue of only this reviewer’s decisions', async () => {
    const mySubmission = await submitted(cast.ids.reviewer, cast.reviewer);
    const theirSubmission = await submitted(cast.ids.manager, cast.manager);

    const board = await cast.server.request('GET', '/api/dashboard/manager', {
      token: cast.reviewer,
    });
    assert.equal(board.status, 200);
    const queue = board.body.awaitingMyDecision;

    assert.ok(
      queue.reviews.some((t: any) => t.id === mySubmission),
      'work submitted to them should be in their queue',
    );
    assert.ok(
      !queue.reviews.some((t: any) => t.id === theirSubmission),
      'somebody else’s submission must not be',
    );
    // Schedules are nobody's to agree now, so the queue is sign-offs and
    // extension requests.
    assert.equal(queue.total, queue.reviews.length + queue.deadlineRequests.length);
  });

  test('the board-wide buckets stay board-wide — the queue narrows, it does not hide', async () => {
    const theirSubmission = await submitted(cast.ids.manager, cast.manager);
    assert.ok(theirSubmission);
    // The manager board has no "awaiting review" bucket; the point is that a
    // reviewer still sees work that is none of their business to decide.
    const everything = await cast.server.request('GET', '/api/tasks', { token: cast.reviewer });
    assert.ok(
      everything.body.some((t: any) => t.id === theirSubmission),
      'a reviewer still sees the whole plan; they simply also get their own queue',
    );
  });

  test('extension requests are queued to the reviewer of the task they are about', async () => {
    // One task reviewed by our reviewer, one by the manager — both with a
    // pending request against them.
    const mine = await submitted(cast.ids.reviewer, cast.reviewer);
    await cast.server.request('PATCH', `/api/tasks/${mine}`, {
      token: cast.reviewer,
      body: { status: 'in_progress' },
    });
    const askedMine = await cast.server.request('POST', `/api/tasks/${mine}/deadline-requests`, {
      token: cast.owner,
      body: { requestedEffortDays: 4, reason: 'Rig slipped.' },
    });
    assert.equal(askedMine.status, 201, JSON.stringify(askedMine.body));

    const theirs = await proposed(cast.ids.manager);
    await cast.server.request('POST', `/api/tasks/${theirs}/schedule/decision`, {
      token: cast.manager,
      body: { approve: true },
    });
    const askedTheirs = await cast.server.request(
      'POST',
      `/api/tasks/${theirs}/deadline-requests`,
      { token: cast.owner, body: { requestedEffortDays: 4, reason: 'Also slipped.' } },
    );
    assert.equal(askedTheirs.status, 201);

    const board = await cast.server.request('GET', '/api/dashboard/manager', {
      token: cast.reviewer,
    });
    const queued = board.body.awaitingMyDecision.deadlineRequests.map((r: any) => r.id);
    assert.ok(queued.includes(askedMine.body.id), 'the request on their task should be queued');
    assert.ok(
      !queued.includes(askedTheirs.body.id),
      'a request they are not allowed to decide must not be',
    );

    // And the queue agrees with what the API will actually let them do.
    for (const id of queued) {
      const decided = await cast.server.request(`POST`, `/api/deadline-requests/${id}/decision`, {
        token: cast.reviewer,
        body: { approve: true, note: 'Fine.' },
      });
      assert.equal(decided.status, 200, 'every queued request must be one they can decide');
    }
  });

  test('a manager gets a queue of their own, for the work they review', async () => {
    // Scheduled alone is not waiting on anybody; it has to reach review.
    const theirs = await submitted(cast.ids.manager, cast.manager);
    const board = await cast.server.request('GET', '/api/dashboard/manager', {
      token: cast.manager,
    });
    assert.ok(
      board.body.awaitingMyDecision.reviews.some((t: any) => t.id === theirs),
      'a manager named as reviewer should see it waiting on them too',
    );
  });
});

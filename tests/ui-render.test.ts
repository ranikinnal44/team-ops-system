/**
 * Frontend render tests.
 *
 * Each view is executed for real against a live API backed by the AutoDock
 * import, under a minimal DOM. `node --check` only parses a module; these tests
 * run it, which is what catches use-before-declaration, bad property access and
 * null handling in the imported data.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Database } from '../src/db/connection.ts';
import {
  autoDockDb, autoDockWithLogDb, freshDb, startTestServer, type TestServer,
} from './helpers.ts';
import { installDom, installFetch, StubElement, type DomHandle } from './dom-stub.ts';
import { seedPasscode } from '../src/seed/passcodes.ts';

// Built at runtime so the loader, not TypeScript, resolves the plain-JS modules.
const moduleUrl = (path: string): string => new URL(`../public/js/${path}`, import.meta.url).href;

let db: Database;
let server: TestServer;
let dom: DomHandle;
let restoreFetch: () => void;

/* eslint-disable @typescript-eslint/no-explicit-any */
let ui: any;
let api: any;
let views: Record<string, any> = {};

before(async () => {
  // Rendered against both documents: the richer data exercises owners, alerts,
  // history and mixed statuses that the plan alone does not contain. The live
  // Stream 1 default gets its own suite below.
  db = autoDockWithLogDb();
  server = await startTestServer(db);
  dom = installDom();
  restoreFetch = installFetch(server.url);

  ui = await import(moduleUrl('ui.js'));
  api = await import(moduleUrl('api.js'));
  views = {
    login: await import(moduleUrl('views/login.js')),
    manager: await import(moduleUrl('views/manager.js')),
    employee: await import(moduleUrl('views/employee.js')),
    taskList: await import(moduleUrl('views/task-list.js')),
    taskDetail: await import(moduleUrl('views/task-detail.js')),
    createTask: await import(moduleUrl('views/create-task.js')),
    milestones: await import(moduleUrl('views/milestones.js')),
    activity: await import(moduleUrl('views/activity.js')),
    team: await import(moduleUrl('views/team.js')),
  };
});

after(async () => {
  restoreFetch();
  dom.restore();
  await server.close();
});

const mount = (): StubElement => new StubElement('main');

/** The first descendant with this `name` attribute. */
function byName(node: StubElement, name: string): StubElement | null {
  for (const child of node.elements()) {
    if (child.getAttribute('name') === name) return child;
    const found = byName(child, name);
    if (found) return found;
  }
  return null;
}

/** Every descendant carrying a class, for structural assertions. */
function findByClass(node: StubElement, cls: string, acc: StubElement[] = []): StubElement[] {
  for (const child of node.elements()) {
    if (child.classList().includes(cls)) acc.push(child);
    findByClass(child, cls, acc);
  }
  return acc;
}

/** Every descendant with this tag name — the stub has no querySelectorAll. */
function findAll(root: StubElement, tag: string): StubElement[] {
  const out: StubElement[] = [];
  const walk = (node: StubElement): void => {
    for (const child of node.elements()) {
      if (child.tagName === tag) out.push(child);
      walk(child);
    }
  };
  walk(root);
  return out;
}

/** Invoke the handlers registered for an event, awaiting any async work. */
async function fire(node: StubElement, event: string, payload: object = {}): Promise<void> {
  const handlers = node.listeners.get(event) ?? [];
  assert.ok(handlers.length > 0, `no "${event}" handler registered`);
  for (const handler of handlers) {
    await handler({ preventDefault: () => {}, ...payload });
  }
}

const signIn = async (email: string): Promise<void> => {
  const result = await api.api.login(email, seedPasscode(email));
  api.session.save(result.token, result.user);
};

// --- pure components ------------------------------------------------------

describe('task row rendering', () => {
  const baseTask = {
    id: 't1',
    ref: 'AD-CNV-027',
    title: 'Research couplings',
    status: 'in_progress',
    priority: 'P1',
    progress: 40,
    dueDate: '2026-10-10',
    daysUntilDue: 4,
    ownerName: 'Firaz',
    projectCode: 'AD',
    workstreamName: 'Conveyor & Dock Integration',
    exceptions: [],
    clarifications: [],
    blocker: null,
    nextAction: null,
  };

  test('renders a fully populated task', () => {
    const node = ui.taskRow(baseTask);
    const text = node.text();
    assert.match(text, /AD-CNV-027/);
    assert.match(text, /Research couplings/);
    assert.match(text, /Firaz/);
    assert.match(text, /In Progress/);
  });

  test('renders an imported task with no deadline, priority or progress', () => {
    // This is the exact shape every AutoDock task has.
    const node = ui.taskRow({
      ...baseTask,
      priority: null,
      progress: null,
      dueDate: null,
      daysUntilDue: null,
      exceptions: ['NO_RECENT_UPDATE'],
    });
    const text = node.text();
    assert.match(text, /No due date/, 'an undated task must say so, not show a placeholder date');
    assert.match(text, /No priority/, 'an unassigned priority must be visibly unassigned');
    assert.ok(node.allClasses().includes('unknown'), 'unknown progress needs its own treatment');
  });

  test('shows a NEEDS INFO marker when clarifications are open', () => {
    const node = ui.taskRow({
      ...baseTask,
      clarifications: [
        { id: 'c1', code: 'MISSING_DUE_DATE', detail: 'No deadline set.', resolved: false },
        { id: 'c2', code: 'MISSING_PRIORITY', detail: 'No priority set.', resolved: false },
      ],
    });
    assert.match(node.text(), /NEEDS INFO ×2/);
  });

  test('resolved clarifications do not count towards the marker', () => {
    const node = ui.taskRow({
      ...baseTask,
      clarifications: [{ id: 'c1', code: 'MISSING_DUE_DATE', detail: 'x', resolved: true }],
    });
    assert.ok(!node.text().includes('NEEDS INFO'));
  });

  test('a task with no clarifications field at all still renders', () => {
    const { clarifications: _ignored, ...withoutField } = baseTask;
    assert.doesNotThrow(() => ui.taskRow(withoutField));
  });

  test('blocker takes precedence over next action in the row detail', () => {
    const blocked = ui.taskRow({ ...baseTask, blocker: 'Vendor silent', nextAction: 'Chase' });
    assert.match(blocked.text(), /Blocked: Vendor silent/);
    assert.ok(!blocked.text().includes('Next: Chase'));
  });

  test('taskRows maps a list without losing any', () => {
    const rows = ui.taskRows([baseTask, { ...baseTask, id: 't2', ref: 'AD-SIM-036' }]);
    assert.equal(rows.length, 2);
  });
});

describe('value formatting', () => {
  test('dueLabel handles a missing deadline', () => {
    assert.match(ui.dueLabel({ dueDate: null, exceptions: [], status: 'in_progress' }).text(), /No due date/);
  });

  test('priorityTag handles an unassigned priority at the component, not the call site', () => {
    assert.match(ui.priorityTag(null).text(), /No priority/);
    assert.match(ui.priorityTag(undefined).text(), /No priority/);
    assert.match(ui.priorityTag('P0').text(), /P0/);
  });

  test('progressBar handles unknown progress', () => {
    assert.ok(ui.progressBar(null).classList().includes('unknown'));
    assert.ok(!ui.progressBar(0).classList().includes('unknown'));
  });

  test('statusBadge uses the readable label', () => {
    assert.equal(ui.statusBadge('not_started').text(), 'Not Started');
    assert.equal(ui.statusBadge('in_progress').text(), 'In Progress');
  });
});

// --- whole views against the live API -------------------------------------

describe('views render against real AutoDock data', () => {
  test('login view lists the real team', async () => {
    const node = mount();
    await views.login.loginView(node);
    const text = node.text();
    for (const name of ['Rani', 'Firaz', 'Ashutosh', 'Mallikarjun', 'Faizan']) {
      assert.match(text, new RegExp(name));
    }
  });

  test('manager dashboard renders, including workstreams and clarifications', async () => {
    await signIn('rani@example.com');
    const node = mount();
    await views.manager.managerView(node);
    const text = node.text();
    assert.match(text, /Task Assigner dashboard/);
    assert.match(text, /Conveyor & Dock Integration/);
    assert.match(text, /Requires clarification/);
    assert.match(text, /No Due Date/);
  });

  test('employee dashboard renders for a real employee', async () => {
    await signIn('faizan@example.com');
    const node = mount();
    await views.employee.employeeView(node, new URLSearchParams());
    const text = node.text();
    assert.match(text, /My work/);
    assert.match(text, /No due date/, 'undated work must be surfaced on the employee board');
    assert.match(text, /No priority/);
  });

  test('task list renders and survives filters', async () => {
    await signIn('rani@example.com');
    const node = mount();
    await views.taskList.taskListView(node, new URLSearchParams('needsClarification=true'));
    assert.match(node.text(), /task/);
  });

  test('the task list groups by workstream by default', async () => {
    await signIn('rani@example.com');
    const node = mount();
    await views.taskList.taskListView(node, new URLSearchParams());

    const groups = findByClass(node, 'task-group');
    assert.ok(groups.length > 1, 'expected the list to be chunked, not one flat run');
    const rows = findByClass(node, 'task-trow').filter((r) => !r.classList().includes('task-thead'));
    assert.equal(rows.length, 84, 'every task must still be present');
    assert.equal(findByClass(node, 'task-thead').length, groups.length, 'each group gets a header row');
  });

  test('each group header carries its own counts', async () => {
    await signIn('rani@example.com');
    const node = mount();
    await views.taskList.taskListView(node, new URLSearchParams());
    const heads = findByClass(node, 'task-group-head');
    assert.ok(heads.length > 0);
    assert.ok(heads.every((h) => /\d/.test(h.text())), 'a heading without a count is not a summary');
  });

  test('grouping can be switched, without losing or duplicating tasks', async () => {
    await signIn('rani@example.com');
    for (const groupBy of ['owner', 'status', 'milestone', 'none']) {
      const node = mount();
      await views.taskList.taskListView(node, new URLSearchParams(`groupBy=${groupBy}`));
      const rows = findByClass(node, 'task-trow').filter((r) => !r.classList().includes('task-thead'));
      assert.equal(rows.length, 84, `grouping by ${groupBy} changed the task count`);
    }
  });

  test('grouping by owner drops the owner column, which would repeat', async () => {
    await signIn('rani@example.com');
    const node = mount();
    await views.taskList.taskListView(node, new URLSearchParams('groupBy=owner'));
    const header = findByClass(node, 'task-thead')[0];
    assert.ok(header);
    const labels = header.elements().map((c) => c.text());
    assert.ok(!labels.includes('Owner'), 'the grouped-on column must not repeat in every row');
    assert.ok(labels.includes('Task'));
  });

  test('a column is dropped when no task in view has a value for it', async () => {
    await signIn('rani@example.com');

    // Nothing in this project has a priority, so the column earns no width.
    const all = mount();
    await views.taskList.taskListView(all, new URLSearchParams());
    const allLabels = findByClass(all, 'task-thead')[0]?.elements().map((c) => c.text()) ?? [];
    assert.ok(!allLabels.includes('Priority'), 'a column of 84 dashes tells you nothing');
    // The first header is the blank selection column, which only managers get.
    assert.deepEqual(allLabels.filter(Boolean), ['Ref', 'Task', 'Owner', 'Due', 'Alert', 'Gaps']);

    // Completed work raises no alert, so that column goes. The deadline column
    // stays: every task carries dates now, including the ones already done.
    const done = mount();
    await views.taskList.taskListView(done, new URLSearchParams('status=completed'));
    const doneLabels = findByClass(done, 'task-thead')[0]?.elements().map((c) => c.text()) ?? [];
    assert.ok(!doneLabels.includes('Alert'));
    assert.ok(doneLabels.includes('Due'));
  });

  test('every group shares one column set, so the groups stay aligned', async () => {
    await signIn('rani@example.com');
    const node = mount();
    await views.taskList.taskListView(node, new URLSearchParams());
    const headers = findByClass(node, 'task-thead');
    assert.ok(headers.length > 1);
    const first = headers[0]?.elements().map((c) => c.text()).join('|');
    assert.ok(headers.every((h) => h.elements().map((c) => c.text()).join('|') === first));
  });

  test('alerts and gaps are separate columns, not one invented word', async () => {
    await signIn('rani@example.com');
    const node = mount();
    await views.taskList.taskListView(node, new URLSearchParams());
    const labels = findByClass(node, 'task-thead')[0]?.elements().map((c) => c.text()) ?? [];
    assert.ok(labels.includes('Alert'), 'what is wrong with the work');
    assert.ok(labels.includes('Gaps'), 'what is missing from the record');
    assert.ok(!labels.includes('Signals'));
    assert.ok(!labels.includes('Pri'));
  });

  test('the gaps count reads as words and stays inside the row', async () => {
    await signIn('rani@example.com');
    const node = mount();
    await views.taskList.taskListView(node, new URLSearchParams());
    const gaps = findByClass(node, 'cell-gaps').filter((c) => c.text() !== '—');
    assert.ok(gaps.length > 0);
    assert.match(gaps[0]?.text() ?? '', /^\d+ gaps?$/, 'a bare "?6" is not readable');
    assert.ok(
      gaps.every((g) => g.tagName !== 'a'),
      'the cell must not be a link of its own: the row already opens the task',
    );
    assert.match(gaps[0]?.getAttribute('title') ?? '', /unanswered question/);
  });

  test('a task with open questions is marked on the row, and the row opens it', async () => {
    await signIn('rani@example.com');
    const node = mount();
    await views.taskList.taskListView(node, new URLSearchParams('needsClarification=true'));
    const marked = findByClass(node, 'needs-info');
    assert.ok(marked.length > 0, 'every task in this filter has unanswered questions');
    assert.ok(
      marked.every((row) => row.getAttribute('href')?.startsWith('#/tasks/')),
      'the mark must lead to the task detail, where the gap is filled',
    );

    // Tasks the source fully established carry no mark, or it means nothing.
    const all = mount();
    await views.taskList.taskListView(all, new URLSearchParams());
    const rows = findByClass(all, 'task-trow').filter((r) => !r.classList().includes('task-thead'));
    assert.ok(
      rows.length > marked.length,
      'a highlight on every row would be wallpaper, not a signal',
    );
  });

  test('the legend explains both flag columns, not just the dots', async () => {
    await signIn('rani@example.com');
    const node = mount();
    await views.taskList.taskListView(node, new URLSearchParams());
    const text = findByClass(node, 'legend')[0]?.text() ?? '';
    assert.match(text, /Alert = /);
    assert.match(text, /Gaps = /);
  });

  test('unset values render as a quiet dash, not a repeated phrase', async () => {
    await signIn('rani@example.com');
    const node = mount();
    await views.taskList.taskListView(node, new URLSearchParams('groupBy=none'));
    // Scoped to the rows: the same phrases are legitimate filter option labels.
    const rowText = findByClass(node, 'task-trow')
      .filter((r) => !r.classList().includes('task-thead'))
      .map((r) => r.text())
      .join(' ');
    // These used to repeat on every one of 84 rows.
    assert.ok(!rowText.includes('No priority'), 'unset priority must not shout on every row');
    assert.ok(!rowText.includes('No due date'), 'unset deadline must not shout on every row');
    assert.ok(!rowText.includes('NEEDS INFO'), 'clarification counts must be compact here');
    assert.ok(!rowText.includes('Signals'), 'the invented column name is gone');
    assert.ok(findByClass(node, 'cell-absent').length > 0, 'but gaps must still be shown');
  });

  test('the project code is not repeated on every row', async () => {
    await signIn('rani@example.com');
    const node = mount();
    await views.taskList.taskListView(node, new URLSearchParams('groupBy=none'));
    const rows = findByClass(node, 'task-trow').filter((r) => !r.classList().includes('task-thead'));
    const withCode = rows.filter((r) => r.text().includes('AD · '));
    assert.equal(withCode.length, 0, 'there is one project; its code adds nothing per row');
  });

  test('only the most severe alert is shown, the rest go in its tooltip', async () => {
    await signIn('rani@example.com');
    const node = mount();
    await views.taskList.taskListView(node, new URLSearchParams('groupBy=none'));
    const alerts = findByClass(node, 'cell-alert').filter((c) => c.classList().includes('sig'));
    assert.ok(alerts.length > 0);
    for (const cell of alerts) {
      // A row showing more than one flag says so as "+N", never as two chips.
      assert.ok(!cell.text().includes('·'), 'alerts must collapse to one chip');
      assert.ok((cell.getAttribute('title') ?? '').length > 0, 'the rest belong in the tooltip');
    }
  });

  test('the filter controls sit on separate lines, not one long bar', async () => {
    // An employee gets the two general lines; somebody who sees the whole
    // board gets a third for the lenses onto what is waiting on them.
    await signIn('faizan@example.com');
    const asEmployee = mount();
    await views.taskList.taskListView(asEmployee, new URLSearchParams());
    assert.equal(findByClass(asEmployee, 'line').length, 2);

    await signIn('rani@example.com');
    const asManager = mount();
    await views.taskList.taskListView(asManager, new URLSearchParams());
    assert.equal(findByClass(asManager, 'line').length, 3);
  });

  test('the review lenses are offered to a reviewer and withheld from an employee', async () => {
    await signIn('rani@example.com');
    const asManager = mount();
    await views.taskList.taskListView(asManager, new URLSearchParams());
    const labels = findByClass(asManager, 'lens').map((n) => n.text());
    assert.deepEqual(labels, ['Work to sign off', 'Dates to agree']);

    await signIn('faizan@example.com');
    const asEmployee = mount();
    await views.taskList.taskListView(asEmployee, new URLSearchParams());
    assert.equal(findByClass(asEmployee, 'lens').length, 0);
  });

  test('an active lens reads as pressed', async () => {
    await signIn('rani@example.com');
    const me = api.session.user.id;
    const node = mount();
    await views.taskList.taskListView(
      node,
      new URLSearchParams(`reviewerId=${me}&status=review`),
    );
    const on = findByClass(node, 'lens').filter((n) => n.classList().includes('on'));
    assert.equal(on.length, 1);
    assert.equal(on[0]?.text(), 'Work to sign off');
  });

  test('a status legend is present, so the dots are never a guess', async () => {
    await signIn('rani@example.com');
    const node = mount();
    await views.taskList.taskListView(node, new URLSearchParams());
    const text = findByClass(node, 'legend')[0]?.text() ?? '';
    for (const label of ['Not started', 'In progress', 'Blocked', 'Review', 'Completed']) {
      assert.match(text, new RegExp(label));
    }
  });

  test('an employee sees only their own tasks in the table', async () => {
    await signIn('faizan@example.com');
    const node = mount();
    await views.taskList.taskListView(node, new URLSearchParams('groupBy=none'));
    const rows = findByClass(node, 'task-trow').filter((r) => !r.classList().includes('task-thead'));
    const mine = await api.api.tasks({});
    assert.equal(rows.length, mine.length);
    assert.ok(rows.length < 84);
  });

  test('an empty result set says so rather than rendering an empty table', async () => {
    await signIn('rani@example.com');
    const node = mount();
    await views.taskList.taskListView(node, new URLSearchParams('search=zzzznomatch'));
    assert.match(node.text(), /No tasks match/);
    assert.equal(findByClass(node, 'task-trow').length, 0);
  });

  test('task detail renders an imported task with its provenance', async () => {
    await signIn('rani@example.com');
    const list = await api.api.tasks({ search: 'simulation capabilities' });
    assert.ok(list.length > 0);
    const node = mount();
    await views.taskDetail.taskDetailView(node, new URLSearchParams(), list[0].id);
    const text = node.text();
    assert.match(text, /DTL-036/, 'the source row should be visible');
    assert.match(text, /Firaz \/ Ashutosh/, 'the raw source owner should be visible');
    assert.match(text, /Imported record/);
  });

  test('every task reaching the detail screen carries both dates', async () => {
    await signIn('rani@example.com');
    const list = await api.api.tasks({ status: 'in_progress' });
    assert.ok(list.length > 0);
    assert.equal(
      list.filter((t: { dueDate: string | null }) => t.dueDate === null).length,
      0,
      'start and end are mandatory, so the undated branch is unreachable',
    );
    const node = mount();
    await views.taskDetail.taskDetailView(node, new URLSearchParams(), list[0].id);
    assert.doesNotMatch(node.text(), /No deadline agreed/);
  });

  test('a long imported task states why it has no day plan', async () => {
    await signIn('rani@example.com');
    // Plan tasks run for weeks, which is longer than anything added here may.
    const list = await api.api.tasks();
    const long = list.find(
      (t: { startDate: string; dueDate: string }) =>
        t.startDate && t.dueDate && t.dueDate > ui.addDays(t.startDate, 2),
    );
    assert.ok(long, 'the imported plan should contain a task longer than the limit');

    const node = mount();
    await views.taskDetail.taskDetailView(node, new URLSearchParams(), long.id);
    const text = node.text();
    assert.match(text, /longer than the 5-day limit/);
    // Forty rows of "no outcome defined yet" would be noise, not information.
    assert.equal(findByClass(node, 'day-plan-facts').length, 0);
  });

  test('create task form asks for a budget, not dates, and states the cap', async () => {
    await signIn('rani@example.com');
    const node = mount();
    await views.createTask.createTaskView(node);
    const text = node.text();
    assert.match(text, /Create task/);
    assert.match(text, /not assigned/, 'priority must offer an explicit unassigned option');
    assert.match(text, /at most 5 working days/, 'the cap has to be stated, not just enforced');

    const effort = byName(node, 'effortDays');
    assert.ok(effort, 'expected an effortDays input');
    assert.equal(effort.getAttribute('required'), '', 'the budget is what a manager must give');

    for (const name of ['startDate', 'dueDate']) {
      const input = byName(node, name);
      assert.ok(input, `expected a ${name} input`);
      assert.equal(
        input.getAttribute('required'),
        null,
        `${name} must be optional — the owner proposes it`,
      );
    }
  });

  test('extending the end date asks for an outcome per day', async () => {
    await signIn('rani@example.com');
    const node = mount();
    await views.createTask.createTaskView(node);

    const start = byName(node, 'startDate') as StubElement;
    const due = byName(node, 'dueDate') as StubElement;
    // Dates start blank now — a manager budgets effort and leaves the days to
    // the owner — so this test schedules the task directly to reach the form.
    start.value = ui.todayIso();
    due.value = ui.todayIso();
    await fire(start, 'change', { target: start });

    // A single-day task has nothing to break down.
    assert.equal(findByClass(node, 'day-plan-row').length, 0);
    assert.match(node.text(), /A one-day task is a single outcome/);

    due.value = ui.addDays(start.value, 2);
    await fire(due, 'change', { target: due });

    const rows = findByClass(node, 'day-plan-row');
    assert.equal(rows.length, 3, 'a three-day task asks for three outcomes');
    assert.match(node.text(), /This task covers 3 days/);
    for (const row of rows) {
      assert.ok(row.text().startsWith('Day '), 'each row is labelled with its day');
    }
  });

  test('the end date cannot be pushed past the budget cap', async () => {
    await signIn('rani@example.com');
    const node = mount();
    await views.createTask.createTaskView(node);

    const start = byName(node, 'startDate') as StubElement;
    const due = byName(node, 'dueDate') as StubElement;
    start.value = ui.todayIso();
    await fire(start, 'change', { target: start });
    due.value = ui.addDays(start.value, 30);
    await fire(due, 'change', { target: due });

    assert.equal(due.value, ui.addDays(start.value, 4), 'the form pulls it back to the cap');
    assert.equal(findByClass(node, 'day-plan-row').length, 5);
  });

  test('the plan resolves the sole project without a listing screen', async () => {
    await signIn('rani@example.com');
    const node = mount();
    // No id passed: with one project the nav goes straight to its plan.
    await views.milestones.milestonesView(node, new URLSearchParams());
    assert.match(node.text(), /AutoDock/);
  });

  test('the plan shows long lead items and deliverables', async () => {
    await signIn('rani@example.com');
    const node = mount();
    await views.milestones.milestonesView(node, new URLSearchParams());
    const text = node.text();
    assert.match(text, /Long lead items/);
    assert.match(text, /VFD procurement/);
    assert.match(text, /Outcomes and deliverables/);
  });

  test('a milestone shows the plan\'s week range next to its progress', async () => {
    await signIn('rani@example.com');
    const node = mount();
    await views.milestones.milestonesView(node, new URLSearchParams());

    // The relative week range is the plan's own wording, and with milestones
    // holding no calendar dates it is the only thing one can say about when.
    assert.ok(
      findByClass(node, 'timeline-chip').length > 0,
      'the plan states a week range for its milestones, so the screen shows it',
    );
    // Still no calendar date: a milestone has none to render.
    assert.equal(findByClass(node, 'ms-when').length, 0);

    // Alongside it: a bar, a percentage and a completion status per row.
    const bars = findByClass(node, 'ms-bar');
    const phases = findByClass(node, 'ms-phase');
    assert.ok(bars.length > 0, 'every milestone shows a progress bar');
    assert.equal(phases.length, bars.length, 'and a completion status beside it');
    assert.ok(
      phases.some((p) => /Complete|In progress|Not started|No tasks/.test(p.text())),
      'the status says where the milestone stands',
    );
    assert.ok(findByClass(node, 'ms-pct').length > 0, 'with the percentage spelled out');
  });

  test('grouping by workstream gives each stream a heading and its own roll-up', async () => {
    await signIn('rani@example.com');

    // Schedule is the default: one flat run, no stream headings.
    const flat = mount();
    await views.milestones.milestonesView(flat, new URLSearchParams());
    assert.equal(findByClass(flat, 'ms-section-head').length, 0);

    const grouped = mount();
    await views.milestones.milestonesView(grouped, new URLSearchParams('groupBy=workstream'));
    const heads = findByClass(grouped, 'ms-section-head');
    assert.ok(heads.length > 1, 'the plan spans more than one workstream');
    const names = findByClass(grouped, 'ms-section-name').map((n) => n.text());
    assert.ok(names.some((n) => /Autonomous Mobile Platform/.test(n)));

    // The work nobody placed on the plan cannot vanish into a grouping.
    assert.match(grouped.text(), /No milestone assigned/);
  });

  test('milestones view lists every milestone with its roll-up', async () => {
    await signIn('rani@example.com');
    const node = mount();
    await views.milestones.milestonesView(node, new URLSearchParams());
    const text = node.text();
    assert.match(text, /Milestones/);
    assert.match(text, /Final Design Validation/);
    assert.match(text, /\d+%/, 'the collapsed line carries progress, not a week range');

    const panels = findAll(node, 'details');
    const tree = await api.api.project((await api.api.projects())[0].id);
    const expected = tree.workstreams.reduce(
      (n: number, ws: { milestones: unknown[]; unassignedTasks: unknown[] }) =>
        n + ws.milestones.length + (ws.unassignedTasks.length > 0 ? 1 : 0),
      0,
    );
    assert.ok(expected > 0, 'the AutoDock plan has milestones');
    assert.equal(
      panels.length,
      expected,
      'one panel per milestone, plus one per workstream holding work nobody placed',
    );
  });

  test('each milestone folds its own tasks inside the disclosure', async () => {
    await signIn('rani@example.com');
    const node = mount();
    await views.milestones.milestonesView(node, new URLSearchParams());

    const panels = findAll(node, 'details');
    for (const panel of panels) {
      const summary = panel.elements().filter((child) => child.tagName === 'summary');
      assert.equal(summary.length, 1, 'a disclosure needs exactly one summary to click');
    }

    // The tasks of one milestone must sit inside that milestone's panel and
    // nowhere else, which is the whole point of the screen.
    const tree = await api.api.project((await api.api.projects())[0].id);
    const withTasks = tree.workstreams
      .flatMap((ws: { milestones: unknown[] }) => ws.milestones)
      .find((ms: { tasks: unknown[] }) => ms.tasks.length > 0) as {
      milestone: { name: string };
      tasks: { ref: string }[];
    };
    const panel = panels.find((p) => p.text().includes(withTasks.milestone.name));
    assert.ok(panel, 'expected a panel for the milestone');
    for (const task of withTasks.tasks) {
      assert.match(panel.text(), new RegExp(task.ref), `${task.ref} belongs in its milestone`);
    }
  });

  test('milestone panels start closed and the toggle opens them all', async () => {
    await signIn('rani@example.com');
    const node = mount();
    await views.milestones.milestonesView(node, new URLSearchParams());

    const panels = findAll(node, 'details');
    assert.ok(
      panels.every((p) => !p.open),
      'the list reads as a list until something is opened',
    );

    const toggle = findAll(node, 'button').find((b) => b.text() === 'Expand all');
    assert.ok(toggle, 'expected an expand-all control');
    await fire(toggle, 'click');
    assert.ok(panels.every((p) => p.open === true), 'every panel opens');
    assert.equal(toggle.text(), 'Collapse all');
    await fire(toggle, 'click');
    assert.ok(panels.every((p) => p.open === false), 'and closes again');
  });

  test('a milestone can be deep-linked open', async () => {
    await signIn('rani@example.com');
    const milestones = await api.api.milestones();
    const node = mount();
    await views.milestones.milestonesView(node, new URLSearchParams(`open=${milestones[0].id}`));
    const opened = findAll(node, 'details').filter((p) => p.open);
    assert.equal(opened.length, 1, 'only the linked milestone opens');
    const [linked] = opened;
    assert.ok(linked);
    assert.match(linked.text(), new RegExp(milestones[0].name));
  });

  test('an employee sees only the workstreams they hold work in', async () => {
    await signIn('rani@example.com');
    const managerNode = mount();
    await views.milestones.milestonesView(managerNode, new URLSearchParams());
    assert.match(
      managerNode.text(),
      /Final Design Validation/,
      'the manager still sees the whole plan',
    );

    await signIn('faizan@example.com');
    const node = mount();
    await views.milestones.milestonesView(node, new URLSearchParams());
    const text = node.text();
    assert.match(text, /Robot Stack Simulation/, 'their own workstreams stay visible');
    assert.doesNotMatch(
      text,
      /Final Design Validation/,
      'a workstream they have no part in is not advertised to them',
    );
    assert.doesNotMatch(
      text,
      /No tasks have been recorded against this milestone yet/,
      'nothing an employee can see is an empty shell of work they cannot',
    );
  });

  test('unassigned planned work reads as unassigned', async () => {
    await signIn('rani@example.com');
    const all = await api.api.tasks({});
    const planned = all.find((t: { sourceRef: string | null }) =>
      (t.sourceRef ?? '').startsWith('BT-'),
    );
    assert.ok(planned, 'expected a task imported from the build timeline');
    assert.equal(planned.ownerName, null);
    const node = ui.taskRow(planned);
    assert.match(node.text(), /Unassigned/, 'no owner must never render as a name');
  });

  test('activity view renders imported history without claiming an author', async () => {
    await signIn('rani@example.com');
    const node = mount();
    await views.activity.activityView(node);
    assert.match(node.text(), /Daily task log import/);
  });

  // The task list says "2 gaps"; opening the task has to answer "which two?".
  describe('a gap is shown on the field it is about', () => {
    const byId = (root: StubElement, id: string): StubElement | undefined =>
      [...findAll(root, 'dt'), ...findAll(root, 'dd')].find((n) => n.getAttribute('id') === id);

    test('the Owner and Priority rows are marked, and untouched rows are not', async () => {
      await signIn('rani@example.com');
      const tasks = await api.api.tasks({ needsClarification: 'true' });
      const target = tasks.find((t: { clarifications: unknown[] }) => t.clarifications.length >= 2);
      assert.ok(target, 'fixture should have a task with at least two gaps');

      const node = mount();
      await views.taskDetail.taskDetailView(node, new URLSearchParams(), target.id);

      const codes = target.clarifications.map((c: { code: string }) => c.code);
      if (codes.includes('MISSING_PRIORITY')) {
        assert.match(
          byId(node, 'fact-priority')?.className ?? '',
          /has-gap/,
          'the Priority row carries the marker',
        );
      }
      if (codes.includes('UNCLEAR_OWNER')) {
        assert.match(byId(node, 'fact-owner')?.className ?? '', /has-gap/);
      }
      assert.ok(
        !(byId(node, 'fact-reviewer-note')?.className ?? '').includes('has-gap'),
        'a field with no question is left alone',
      );
    });

    test('the reason is in plain words, next to the value, not a raw code', async () => {
      await signIn('rani@example.com');
      const tasks = await api.api.tasks({ needsClarification: 'true' });
      const target = tasks.find((t: { clarifications: unknown[] }) => t.clarifications.length >= 2);

      const node = mount();
      await views.taskDetail.taskDetailView(node, new URLSearchParams(), target.id);
      const text = node.text();

      assert.match(text, /Needs a priority|Primary owner unclear/);
      assert.ok(
        !/MISSING_PRIORITY|UNCLEAR_OWNER/.test(text),
        'raw clarification codes must not reach the screen',
      );
      assert.match(text, /NEEDS INFO/, 'the marker sits on the field');
      assert.match(text, /Gaps \(\d+\)/, 'the side panel uses the same word as the task list');
    });

    test('a task with no gaps shows no markers at all', async () => {
      await signIn('rani@example.com');
      const tasks = await api.api.tasks();
      const clean = tasks.find((t: { clarifications: unknown[] }) => t.clarifications.length === 0);
      if (!clean) return; // every fixture task has a gap; nothing to assert

      const node = mount();
      await views.taskDetail.taskDetailView(node, new URLSearchParams(), clean.id);
      assert.ok(!node.text().includes('NEEDS INFO'));
      assert.ok(!node.allClasses().includes('has-gap'));
    });

    // Highlighting a gap is only half the job: the field has to be fillable
    // from where the marker is, and filling it has to close the question.
    test('a marked field offers the control that fills it', async () => {
      await signIn('rani@example.com');
      const tasks = await api.api.tasks({ needsClarification: 'true' });
      const target = tasks.find((t: { clarifications: { code: string }[] }) =>
        t.clarifications.some((c) => c.code === 'MISSING_PRIORITY'));
      assert.ok(target, 'fixture should have a task missing a priority');

      const node = mount();
      await views.taskDetail.taskDetailView(node, new URLSearchParams(), target.id);
      const labels = findAll(node, 'button').map((b) => b.text());
      assert.ok(labels.includes('Set a priority'), `expected a fix control, got ${labels.join(' | ')}`);
    });

    test('filling the priority from the field closes that gap', async () => {
      await signIn('rani@example.com');
      const tasks = await api.api.tasks({ needsClarification: 'true' });
      const target = tasks.find((t: { clarifications: { code: string }[] }) =>
        t.clarifications.some((c) => c.code === 'MISSING_PRIORITY'));

      const node = mount();
      await views.taskDetail.taskDetailView(node, new URLSearchParams(), target.id);

      const open = findAll(node, 'button').find((b) => b.text() === 'Set a priority');
      await fire(open!, 'click');

      const form = findAll(node, 'form').find((f) => f.className.includes('gap-form'));
      assert.ok(form, 'the control opens an inline editor');
      const picker = findAll(form, 'select')[0]!;
      picker.value = 'P1';
      await fire(form, 'submit');

      const after = await api.api.task(target.id);
      assert.equal(after.task.priority, 'P1', 'the value is actually stored');
      assert.ok(
        !after.task.clarifications.some((c: { code: string; resolved: boolean }) =>
          c.code === 'MISSING_PRIORITY' && !c.resolved),
        'filling the field closes its question — no second step to remember',
      );
    });

    test('assigning an owner closes the unclear-owner question', async () => {
      await signIn('rani@example.com');
      const tasks = await api.api.tasks({ needsClarification: 'true' });
      const target = tasks.find((t: { clarifications: { code: string }[] }) =>
        t.clarifications.some((c) => c.code === 'UNCLEAR_OWNER'));
      assert.ok(target, 'fixture should have a task with an unclear owner');

      const node = mount();
      await views.taskDetail.taskDetailView(node, new URLSearchParams(), target.id);

      const open = findAll(node, 'button').find((b) => b.text() === 'Assign an owner');
      assert.ok(open, 'the Owner gap offers a way to assign one');
      await fire(open, 'click');

      const form = findAll(node, 'form').find((f) => f.className.includes('gap-form'))!;
      const people = await api.api.users();
      findAll(form, 'select')[0]!.value = people[0].id;
      await fire(form, 'submit');

      const after = await api.api.task(target.id);
      assert.equal(after.task.ownerId, people[0].id);
      assert.ok(
        !after.task.clarifications.some((c: { code: string; resolved: boolean }) =>
          c.code === 'UNCLEAR_OWNER' && !c.resolved),
      );
    });

    test('the side panel offers to fix, not merely to point', async () => {
      await signIn('rani@example.com');
      const tasks = await api.api.tasks({ needsClarification: 'true' });
      const target = tasks.find((t: { clarifications: unknown[] }) => t.clarifications.length > 0)!;

      const node = mount();
      await views.taskDetail.taskDetailView(node, new URLSearchParams(), target.id);
      const labels = findAll(node, 'button').map((b) => b.text());
      assert.ok(
        labels.some((l) => l.startsWith('Fix ')),
        `the Gaps panel should offer a Fix action, got ${labels.join(' | ')}`,
      );
    });

    test('the subtitle omits a missing milestone rather than printing null', async () => {
      await signIn('rani@example.com');
      const tasks = await api.api.tasks();
      const noMilestone = tasks.find((t: { milestoneName: string | null }) => !t.milestoneName);
      if (!noMilestone) return;

      const node = mount();
      await views.taskDetail.taskDetailView(node, new URLSearchParams(), noMilestone.id);
      assert.ok(!/null|undefined/.test(node.text()), 'no placeholder leaks into the heading');
    });
  });

  test('team view lists the real roster with the add-member form for a manager', async () => {
    await signIn('rani@example.com');
    const node = mount();
    await views.team.teamView(node);
    const text = node.text();
    assert.match(text, /Add a team member/);
    assert.match(text, /Team members/);
    for (const name of ['Rani', 'Firaz', 'Ashutosh', 'Mallikarjun', 'Faizan']) {
      assert.match(text, new RegExp(name));
    }
    assert.match(text, /rani@example\.com/);
    // No source document states job titles. The row simply omits it rather
    // than captioning every member with the same placeholder.
    assert.ok(!text.includes('No designation set'), 'a placeholder on every row is not information');
    assert.match(text, /open/, 'a manager sees how much open work each person holds');
  });

  test('an employee is told the roster is closed, not shown a stripped-down one', async () => {
    await signIn('faizan@example.com');
    const node = mount();
    await views.team.teamView(node);
    const text = node.text();
    assert.match(text, /Task Assigner/i);
    assert.ok(!text.includes('Add a team member'), 'employees cannot add members');
    for (const name of ['Ashutosh', 'Mallikarjun']) {
      assert.ok(!text.includes(name), 'no colleague is named');
    }
  });

  // These drive the handlers rather than just the markup: rendering a form
  // proves nothing about whether submitting it reaches the API.
  test('submitting the add form puts the new member on the roster', async () => {
    await signIn('rani@example.com');
    const node = mount();
    await views.team.teamView(node);

    const form = findAll(node, 'form')[0]!;
    const [name, email, title, passcode] = findAll(form, 'input');
    const [role] = findAll(form, 'select');
    name!.value = 'Sunita Rao';
    email!.value = 'sunita.rao@example.com';
    role!.value = 'employee';
    title!.value = 'Safety Engineer';
    // Every member now arrives with their own passcode; the form asks for it.
    passcode!.value = 'sunita-first-code';

    await fire(form, 'submit');

    const text = node.text();
    assert.match(text, /Sunita Rao/, 'the roster re-renders with the new member');
    assert.match(text, /Safety Engineer/);
    assert.match(text, /sunita\.rao@example\.com/);
    assert.ok(!text.includes('sunita-first-code'), 'a passcode is never rendered back');

    // And it is the credential that signs them in.
    const signedIn = await api.api.login('sunita.rao@example.com', 'sunita-first-code');
    assert.ok(signedIn.token);
  });

  test('pressing Edit opens an inline editor for that member only', async () => {
    await signIn('rani@example.com');
    const node = mount();
    await views.team.teamView(node);

    assert.equal(findAll(node, 'form').length, 1, 'only the add form to begin with');

    const edit = findAll(node, 'button').find((b) => b.text() === 'Edit');
    assert.ok(edit, 'a manager gets an Edit control per member');
    await fire(edit, 'click', { target: edit });

    const forms = findAll(node, 'form');
    assert.equal(forms.length, 2, 'the add form plus one inline editor');
    const editRows = findAll(node, 'tr').filter((row) => row.className.includes('team-edit'));
    assert.equal(editRows.length, 1, 'exactly one row is in edit mode');
  });
});

describe('views render against the demo dataset too', () => {
  let demoServer: TestServer;
  let restoreDemoFetch: () => void;

  before(async () => {
    demoServer = await startTestServer(freshDb());
    restoreFetch();
    restoreDemoFetch = installFetch(demoServer.url);
  });

  after(async () => {
    restoreDemoFetch();
    restoreFetch = installFetch(server.url);
    await demoServer.close();
  });

  test('manager dashboard renders with dated, prioritised tasks', async () => {
    const result = await api.api.login('demo.manager@example.com', seedPasscode('demo.manager@example.com'));
    api.session.save(result.token, result.user);
    const node = mount();
    await views.manager.managerView(node);
    const text = node.text();
    assert.match(text, /OVERDUE/);
    assert.match(text, /Demo Employee/);
  });

  test('employee dashboard renders', async () => {
    const result = await api.api.login('demo.employee1@example.com', seedPasscode('demo.employee1@example.com'));
    api.session.save(result.token, result.user);
    const node = mount();
    await views.employee.employeeView(node, new URLSearchParams());
    assert.match(node.text(), /My work/);
  });

  test('task detail lists the outcome for each day of a multi-day task', async () => {
    const result = await api.api.login('demo.manager@example.com', seedPasscode('demo.manager@example.com'));
    api.session.save(result.token, result.user);
    const all = await api.api.tasks();
    const multiDay = all.find((t: { dayPlans: unknown[] }) => t.dayPlans.length > 1);
    assert.ok(multiDay, 'the demo dataset should contain a multi-day task');

    const node = mount();
    await views.taskDetail.taskDetailView(node, new URLSearchParams(), multiDay.id);
    const text = node.text();
    assert.match(text, /Day plan/);
    for (const plan of multiDay.dayPlans) {
      assert.ok(text.includes(plan.outcome), `the outcome for ${plan.date} should be shown`);
    }
  });

  test('a single-day task says so rather than showing an empty day plan', async () => {
    const result = await api.api.login('demo.manager@example.com', seedPasscode('demo.manager@example.com'));
    api.session.save(result.token, result.user);
    const all = await api.api.tasks();
    const oneDay = all.find(
      (t: { startDate: string; dueDate: string }) => t.startDate === t.dueDate,
    );
    assert.ok(oneDay, 'the demo dataset should contain a single-day task');

    const node = mount();
    await views.taskDetail.taskDetailView(node, new URLSearchParams(), oneDay.id);
    assert.match(node.text(), /Single-day task/);
  });
});

describe('the live Stream 1 project renders', () => {
  let planServer: TestServer;
  let restorePlanFetch: () => void;

  before(async () => {
    planServer = await startTestServer(autoDockDb());
    restoreFetch();
    restorePlanFetch = installFetch(planServer.url);
    await signIn('rani@example.com');
  });

  after(async () => {
    restorePlanFetch();
    restoreFetch = installFetch(server.url);
    await planServer.close();
  });

  test('the task list shows the 28 plan tasks under their three phases', async () => {
    const node = mount();
    await views.taskList.taskListView(node, new URLSearchParams());
    const rows = findByClass(node, 'task-trow').filter((r) => !r.classList().includes('task-thead'));
    assert.equal(rows.length, 28);
    const headings = findByClass(node, 'task-group-head').map((h) => h.text());
    assert.equal(headings.length, 3);
    assert.ok(headings.some((h) => h.includes('Autonomous Mobile Platform')));
  });

  test('the owner column shows dashes, because the plan assigns nobody', async () => {
    const node = mount();
    await views.taskList.taskListView(node, new URLSearchParams());
    const labels = findByClass(node, 'task-thead')[0]?.elements().map((c) => c.text()) ?? [];
    assert.ok(labels.includes('Owner'));
    assert.ok(labels.includes('Due'), 'the plan is scheduled, so Due earns its width');
    assert.ok(!labels.includes('Priority'));
  });

  test('the manager dashboard renders with nothing overdue and nothing blocked', async () => {
    const node = mount();
    await views.manager.managerView(node);
    const text = node.text();
    assert.match(text, /Task Assigner dashboard/);
    assert.match(text, /Autonomous Mobile Platform/);
    assert.match(text, /Requires clarification/);
  });

  test('an employee board is empty, and says so rather than breaking', async () => {
    // Nobody owns anything in the plan yet, so this is the honest state.
    const r = await api.api.login('faizan@example.com', seedPasscode('faizan@example.com'));
    api.session.save(r.token, r.user);
    const node = mount();
    await views.employee.employeeView(node, new URLSearchParams());
    assert.match(node.text(), /My work/);
    await signIn('rani@example.com');
  });

  test('the plan shows progress and long lead items', async () => {
    const node = mount();
    await views.milestones.milestonesView(node, new URLSearchParams());
    const text = node.text();
    assert.ok(findByClass(node, 'ms-bar').length > 0, 'progress is shown as a bar');
    assert.match(text, /Long lead items/);
  });

  test('every row reports its gaps, since the whole plan is unassigned', async () => {
    const node = mount();
    await views.taskList.taskListView(node, new URLSearchParams('groupBy=none'));
    const gaps = findByClass(node, 'cell-gaps').filter((c) => c.classList().includes('sig'));
    assert.equal(gaps.length, 28, 'every plan task is missing an owner and a priority');
    assert.ok(gaps.every((g) => /^2 gaps$/.test(g.text())));
  });
});

describe('screens stay readable when there is nothing to report', () => {
  let planServer: TestServer;
  let restorePlan: () => void;

  before(async () => {
    planServer = await startTestServer(autoDockDb());
    restoreFetch();
    restorePlan = installFetch(planServer.url);
    await signIn('rani@example.com');
  });

  after(async () => {
    restorePlan();
    restoreFetch = installFetch(server.url);
    await planServer.close();
  });

  test('empty exception buckets collapse to one line, not a card each', async () => {
    const node = mount();
    await views.manager.managerView(node);
    const clear = findByClass(node, 'all-clear');
    assert.equal(clear.length, 1, 'one line should stand in for every clear bucket');
    assert.match(clear[0]?.text() ?? '', /All clear/);
    assert.match(clear[0]?.text() ?? '', /overdue.*blocked/);
    assert.equal(findByClass(node, 'empty').length, 0, 'no card may exist only to say "nothing"');
  });

  test('the dashboard leads with what blocks the plan, not with zeros', async () => {
    const node = mount();
    await views.manager.managerView(node);
    const setup = findByClass(node, 'setup-panel')[0];
    assert.ok(setup, 'a plan nobody owns needs a call to action');
    assert.match(setup.text(), /have no owner/);
    assert.match(setup.text(), /need a priority/);
  });

  test('sections with no content are dropped rather than rendered empty', async () => {
    const node = mount();
    await views.manager.managerView(node);
    const text = node.text();
    for (const phrase of [
      'Nothing currently requires intervention',
      'No deadline changes are awaiting',
      'No deadlines in the next week',
    ]) {
      assert.ok(!text.includes(phrase), `"${phrase}" should be an absent card, not an empty one`);
    }
  });

  test('a stat of zero recedes instead of competing with real figures', async () => {
    const node = mount();
    await views.manager.managerView(node);
    const stats = findByClass(node, 'stat');
    const zeros = stats.filter((s) => /^0/.test(s.text()));
    assert.ok(zeros.length > 0);
    assert.ok(zeros.every((s) => s.classList().includes('zero')));
    assert.ok(
      stats.filter((s) => !/^0/.test(s.text())).every((s) => !s.classList().includes('zero')),
    );
  });

  test('the workstream table drops columns that are zero for every row', async () => {
    const node = mount();
    await views.manager.managerView(node);
    const headers = findAll(node, 'th').map((h) => h.text());
    assert.ok(headers.includes('Open'));
    assert.ok(headers.includes('Not started'));
    for (const empty of ['Blocked', 'Review', 'Overdue', 'No due date']) {
      assert.ok(!headers.includes(empty), `${empty} is zero everywhere and should be dropped`);
    }
  });

  test('an employee with nothing assigned gets one empty state, not nine', async () => {
    const r = await api.api.login('faizan@example.com', seedPasscode('faizan@example.com'));
    api.session.save(r.token, r.user);
    const node = mount();
    await views.employee.employeeView(node, new URLSearchParams());

    assert.equal(findByClass(node, 'empty-state').length, 1);
    assert.equal(findByClass(node, 'stat').length, 0, 'nine zeroed tiles tell you nothing');
    assert.equal(findByClass(node, 'card').length, 0);
    assert.match(node.text(), /no tasks assigned yet/i);
    await signIn('rani@example.com');
  });
});

describe('bulk assignment', () => {
  let planServer: TestServer;
  let restorePlan: () => void;

  before(async () => {
    planServer = await startTestServer(autoDockDb());
    restoreFetch();
    restorePlan = installFetch(planServer.url);
    await signIn('rani@example.com');
  });

  after(async () => {
    restorePlan();
    restoreFetch = installFetch(server.url);
    await planServer.close();
  });

  test('a manager gets a tick box on every row', async () => {
    const node = mount();
    await views.taskList.taskListView(node, new URLSearchParams());
    const boxes = findByClass(node, 'tickbox');
    assert.equal(boxes.length, 28);
    assert.ok(boxes.every((b) => b.getAttribute('aria-checked') === 'false'));
  });

  test('an employee gets none — bulk assignment is a manager action', async () => {
    const r = await api.api.login('faizan@example.com', seedPasscode('faizan@example.com'));
    api.session.save(r.token, r.user);
    const node = mount();
    await views.taskList.taskListView(node, new URLSearchParams());
    assert.equal(findByClass(node, 'tickbox').length, 0);
    assert.equal(findByClass(node, 'bulkbar').length, 0);
    await signIn('rani@example.com');
  });

  test('the action bar is present but hidden until something is picked', async () => {
    const node = mount();
    await views.taskList.taskListView(node, new URLSearchParams());
    const bar = findByClass(node, 'bulkbar')[0];
    assert.ok(bar);
    assert.equal(bar.getAttribute('hidden'), '');
    assert.match(bar.text(), /0 selected/);
  });

  test('ticking a box selects it and reveals the bar', async () => {
    const node = mount();
    await views.taskList.taskListView(node, new URLSearchParams());
    const box = findByClass(node, 'tickbox')[0];
    assert.ok(box);

    box.listeners.get('click')?.[0]?.({ preventDefault() {}, stopPropagation() {} });

    assert.equal(box.getAttribute('aria-checked'), 'true');
    assert.ok(box.classList().includes('on'));
    const bar = findByClass(node, 'bulkbar')[0];
    assert.equal(bar?.getAttribute('hidden'), null);
    assert.match(bar?.text() ?? '', /1 selected/);
  });

  test('"select all" takes a whole group in one click', async () => {
    const node = mount();
    await views.taskList.taskListView(node, new URLSearchParams());
    const selectAll = findByClass(node, 'gselect')[0];
    assert.ok(selectAll, 'each group heading needs a select-all');

    selectAll.listeners.get('click')?.[0]?.({});

    const bar = findByClass(node, 'bulkbar')[0];
    // The largest group is AMP with 14 tasks; groups are ordered by size.
    assert.match(bar?.text() ?? '', /14 selected/);
    assert.equal(findByClass(node, 'tickbox').filter((b) => b.classList().includes('on')).length, 14);
  });

  test('assigning in bulk goes through the API and updates every task', async () => {
    const users = await api.api.users();
    const firaz = users.find((u: { name: string }) => u.name === 'Firaz');
    const before = await api.api.tasks({});
    const ids = before.slice(0, 5).map((t: { id: string }) => t.id);

    const result = await api.api.bulkAssign({ taskIds: ids, ownerId: firaz.id, priority: 'P1' });
    assert.equal(result.updated, 5);
    assert.equal(result.skipped.length, 0);

    const after = await api.api.tasks({});
    for (const id of ids) {
      const task = after.find((t: { id: string }) => t.id === id);
      assert.equal(task.ownerName, 'Firaz');
      assert.equal(task.priority, 'P1');
    }
  });

  test('assigning clears the owner and priority questions on those tasks', async () => {
    const all = await api.api.tasks({});
    const assigned = all.filter((t: { ownerName: string | null }) => t.ownerName === 'Firaz');
    assert.ok(assigned.length > 0);
    for (const task of assigned) {
      const open = task.clarifications.filter((c: { resolved: boolean }) => !c.resolved);
      const codes = open.map((c: { code: string }) => c.code);
      assert.ok(!codes.includes('UNCLEAR_OWNER'));
      assert.ok(!codes.includes('MISSING_PRIORITY'));
    }
  });

  test('once owners exist the Priority column comes back on its own', async () => {
    const node = mount();
    await views.taskList.taskListView(node, new URLSearchParams());
    const labels = findByClass(node, 'task-thead')[0]?.elements().map((c) => c.text()) ?? [];
    assert.ok(labels.includes('Priority'), 'the column earns its width once anything has one');
  });
});

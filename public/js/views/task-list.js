/**
 * Screen 4 — Tasks.
 *
 * At this project's size the old row-per-task list wrapped a line of chips for
 * every entry, and since most values are unset the same few phrases repeated
 * down the whole page. This screen lays tasks out in fixed columns, groups them
 * under headings that carry their own counts, and keeps the filter controls on
 * two quiet lines rather than one long bar.
 */
import { api, session } from '../api.js';
import {
  el, pageHead, select, loading, taskGroup, groupTasks, GROUP_KEYS, visibleTaskColumns,
  paintSelection, toast,
} from '../ui.js';

const STATUS_OPTIONS = [
  { value: '', label: 'Any status' },
  { value: 'not_started', label: 'Not Started' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'review', label: 'Review' },
  { value: 'completed', label: 'Completed' },
];

const PRIORITY_OPTIONS = [
  { value: '', label: 'Any priority' },
  { value: 'P0', label: 'P0 — Critical' },
  { value: 'P1', label: 'P1 — High' },
  { value: 'P2', label: 'P2 — Normal' },
  { value: 'P3', label: 'P3 — Low' },
];

const EXCEPTION_OPTIONS = [
  { value: '', label: 'Any condition' },
  { value: 'OVERDUE', label: 'Overdue' },
  { value: 'BLOCKED', label: 'Blocked' },
  { value: 'DUE_SOON', label: 'Due within 2 days' },
  { value: 'NO_RECENT_UPDATE', label: 'No recent update' },
  { value: 'SCHEDULE_AWAITING_REVIEW', label: 'Dates awaiting review' },
  { value: 'SCHEDULE_NOT_SET', label: 'Needs dates' },
  { value: 'MISSING_DAILY_UPDATE', label: 'No daily outcome' },
];

const GAP_OPTIONS = [
  { value: '', label: 'Any data state' },
  { value: 'needsClarification', label: 'Needs clarification' },
  { value: 'missingDueDate', label: 'No due date' },
  { value: 'missingPriority', label: 'No priority' },
  { value: 'unassigned', label: 'No owner' },
];

const SORT_OPTIONS = [
  { value: 'attention', label: 'Most important' },
  { value: 'priority', label: 'Priority' },
  { value: 'dueDate', label: 'Due date' },
  { value: 'status', label: 'Status' },
];

const GROUP_OPTIONS = [
  { value: 'workstream', label: 'Workstream' },
  { value: 'milestone', label: 'Milestone' },
  { value: 'owner', label: 'Owner' },
  { value: 'status', label: 'Status' },
  { value: 'none', label: 'Nothing' },
];

const GAP_KEYS = ['needsClarification', 'missingDueDate', 'missingPriority', 'unassigned'];

/**
 * Key for the status dots and for the two flag columns, so nothing in the
 * table needs explaining elsewhere.
 */
function legend(columns) {
  const shown = new Set(columns.map((c) => c.key));
  const dot = (status, label) =>
    el('span', {}, el('span', { class: `status-dot s-${status}` }), label);

  return el(
    'div',
    { class: 'legend' },
    dot('not_started', 'Not started'),
    dot('in_progress', 'In progress'),
    dot('blocked', 'Blocked'),
    dot('review', 'Review'),
    dot('completed', 'Completed'),
    shown.has('alert')
      ? el('span', { class: 'legend-note', title: 'Shown in the Alert column' },
          'Alert = the work needs attention (late, blocked, no update)')
      : null,
    shown.has('gaps')
      ? el('span', {
          class: 'legend-note',
          title: 'These rows carry an accent edge — open one to answer its questions',
        }, 'Gaps = unanswered questions about the record')
      : null,
  );
}

export async function taskListView(mount, params) {
  const isManager = session.user?.role === 'manager';
  // A reviewer is handed the whole board, so they get the same lenses onto it.
  const seesAll = isManager || session.user?.role === 'reviewer';

  const filters = {
    search: params.get('search') ?? '',
    status: params.get('status') ?? '',
    priority: params.get('priority') ?? '',
    exception: params.get('exception') ?? '',
    ownerId: params.get('ownerId') ?? '',
    reviewerId: params.get('reviewerId') ?? '',
    workstreamId: params.get('workstreamId') ?? '',
    sort: params.get('sort') ?? 'attention',
  };
  let gap = GAP_KEYS.find((key) => params.get(key) === 'true') ?? '';
  let groupBy = params.get('groupBy') ?? 'workstream';

  const apply = () => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) next.set(key, value);
    if (gap) next.set(gap, 'true');
    if (groupBy !== 'workstream') next.set('groupBy', groupBy);
    location.hash = `#/tasks${next.toString() ? `?${next}` : ''}`;
  };

  const [workstreams, users] = await Promise.all([
    api.workstreams().catch(() => []),
    seesAll ? api.users().catch(() => []) : Promise.resolve([]),
  ]);

  const search = el('input', {
    type: 'search',
    placeholder: 'Search reference, title or description…',
    value: filters.search,
  });
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      filters.search = search.value;
      apply();
    }
  });

  const bind = (node, key) =>
    node.addEventListener('change', () => {
      filters[key] = node.value;
      apply();
    });

  const groupSel = select(GROUP_OPTIONS, groupBy);
  groupSel.addEventListener('change', () => {
    groupBy = groupSel.value;
    apply();
  });

  const sortSel = select(SORT_OPTIONS, filters.sort);
  bind(sortSel, 'sort');

  const statusSel = select(STATUS_OPTIONS, filters.status);
  const prioritySel = select(PRIORITY_OPTIONS, filters.priority);
  const exceptionSel = select(EXCEPTION_OPTIONS, filters.exception);
  const workstreamSel = select(
    [
      { value: '', label: 'All workstreams' },
      ...workstreams.map((w) => ({ value: w.id, label: `${w.code} — ${w.name}` })),
    ],
    filters.workstreamId,
  );
  const gapSel = select(GAP_OPTIONS, gap);
  bind(statusSel, 'status');
  bind(prioritySel, 'priority');
  bind(exceptionSel, 'exception');
  bind(workstreamSel, 'workstreamId');
  gapSel.addEventListener('change', () => {
    gap = gapSel.value;
    apply();
  });

  const refine = [statusSel, prioritySel, exceptionSel, gapSel, workstreamSel];
  if (seesAll) {
    const ownerSel = select(
      [{ value: '', label: 'All owners' }, ...users.map((u) => ({ value: u.id, label: u.name }))],
      filters.ownerId,
    );
    bind(ownerSel, 'ownerId');
    refine.push(ownerSel);

    const reviewerSel = select(
      [{ value: '', label: 'All reviewers' }, ...users.map((u) => ({ value: u.id, label: u.name }))],
      filters.reviewerId,
    );
    bind(reviewerSel, 'reviewerId');
    refine.push(reviewerSel);
  }

  /**
   * The queue a reviewer actually works from.
   *
   * Two separate things wait on a reviewer — proposed dates and submitted work
   * — and a list cannot show the union of two filters, so this is a pair of
   * lenses rather than one. Both are one click from anywhere in the plan.
   */
  const lenses = seesAll
    ? [
        {
          label: 'Work to sign off',
          on: filters.reviewerId === session.user?.id && filters.status === 'review',
          set: { reviewerId: session.user?.id ?? '', status: 'review', exception: '' },
        },
        {
          label: 'Dates to agree',
          on: filters.reviewerId === session.user?.id && filters.exception === 'SCHEDULE_AWAITING_REVIEW',
          set: { reviewerId: session.user?.id ?? '', exception: 'SCHEDULE_AWAITING_REVIEW', status: '' },
        },
      ]
    : [];

  const activeCount =
    Object.entries(filters).filter(([key, value]) => value && key !== 'sort').length + (gap ? 1 : 0);
  if (activeCount > 0) {
    refine.push(
      el('button', {
        class: 'subtle',
        text: `Clear ${activeCount} filter${activeCount === 1 ? '' : 's'}`,
        onclick: () => {
          location.hash = groupBy === 'workstream' ? '#/tasks' : `#/tasks?groupBy=${groupBy}`;
        },
      }),
    );
  }

  const filterbar = el(
    'section',
    { class: 'card' },
    el(
      'div',
      { class: 'body' },
      el(
        'div',
        { class: 'filterbar' },
        el(
          'div',
          { class: 'line primary' },
          search,
          el('span', { class: 'seg-label', text: 'Group' }),
          groupSel,
          el('span', { class: 'seg-label', text: 'Sort' }),
          sortSel,
        ),
        lenses.length
          ? el(
              'div',
              { class: 'line' },
              el('span', { class: 'seg-label', text: 'Waiting on me' }),
              ...lenses.map((lens) =>
                el('button', {
                  class: lens.on ? 'lens on' : 'lens',
                  type: 'button',
                  text: lens.label,
                  onclick: () => {
                    // Clicking the active lens clears it, so the button is a
                    // toggle rather than a one-way trip.
                    const next = lens.on
                      ? { reviewerId: '', status: '', exception: '' }
                      : lens.set;
                    Object.assign(filters, next);
                    gap = '';
                    apply();
                  },
                }),
              ),
            )
          : null,
        el('div', { class: 'line' }, el('span', { class: 'seg-label', text: 'Filter' }), ...refine),
      ),
    ),
  );

  const results = el('div', {}, loading());

  mount.replaceChildren(
    pageHead(
      'Tasks',
      isManager ? 'Every task across the project' : 'Tasks you own, support or review',
      isManager ? el('a', { class: 'btn primary', href: '#/tasks/new', text: '+ New task' }) : null,
    ),
    filterbar,
    results,
  );

  const tasks = await api.tasks({ ...filters, ...(gap ? { [gap]: 'true' } : {}) });

  if (tasks.length === 0) {
    results.replaceChildren(
      el('div', { class: 'card' }, el('div', { class: 'empty', text: 'No tasks match these filters.' })),
    );
    return;
  }

  // Owner is dropped as a column when it is the thing being grouped by, or
  // when every row would show the same name.
  /* --- bulk assignment ---------------------------------------------------
     Twenty-eight tasks assigned one at a time is twenty-eight page loads,
     which is the reason the plan sat unassigned. Managers get tick boxes and
     an action bar; employees never see either. */
  const selection = isManager ? new Set() : undefined;
  let bulkBar = null;
  /** taskId -> the row and tick box built for it, so repainting needs no lookup. */
  const nodes = new Map();
  const register = (taskId, parts) => {
    nodes.set(taskId, { ...(nodes.get(taskId) ?? {}), ...parts });
  };

  const redrawSelection = () => {
    for (const [taskId, entry] of nodes) paintSelection(entry, selection.has(taskId));
    if (bulkBar) bulkBar.refresh();
  };

  const onToggle = (id) => {
    if (selection.has(id)) selection.delete(id);
    else selection.add(id);
    redrawSelection();
  };
  const onToggleGroup = (ids, on) => {
    for (const id of ids) {
      if (on) selection.add(id);
      else selection.delete(id);
    }
    redrawSelection();
  };

  function makeBulkBar(users) {
    const ownerSel = select(
      [
        { value: '', label: 'Owner — leave as is' },
        ...users.map((u) => ({ value: u.id, label: u.name })),
        { value: '__clear__', label: 'Owner — clear' },
      ],
      '',
    );
    const prioritySel = select(
      [
        { value: '', label: 'Priority — leave as is' },
        { value: 'P0', label: 'P0 — Critical' },
        { value: 'P1', label: 'P1 — High' },
        { value: 'P2', label: 'P2 — Normal' },
        { value: 'P3', label: 'P3 — Low' },
      ],
      '',
    );
    const count = el('span', { class: 'count', text: '0 selected' });
    const apply = el('button', { class: 'primary', text: 'Apply' });

    apply.addEventListener('click', async () => {
      const payload = { taskIds: [...selection] };
      if (ownerSel.value === '__clear__') payload.ownerId = null;
      else if (ownerSel.value) payload.ownerId = ownerSel.value;
      if (prioritySel.value) payload.priority = prioritySel.value;

      if (payload.ownerId === undefined && payload.priority === undefined) {
        toast('Pick an owner or a priority first', true);
        return;
      }
      apply.disabled = true;
      try {
        const result = await api.bulkAssign(payload);
        toast(
          result.skipped.length > 0
            ? `${result.updated} updated, ${result.skipped.length} skipped`
            : `${result.updated} task${result.updated === 1 ? '' : 's'} updated`,
          result.skipped.length > 0,
        );
        taskListView(mount, params);
      } catch (error) {
        toast(error.message, true);
        apply.disabled = false;
      }
    });

    const bar = el(
      'div',
      { class: 'bulkbar', hidden: true },
      count,
      ownerSel,
      prioritySel,
      apply,
      el('span', { class: 'spacer' }),
      el('button', {
        class: 'subtle',
        text: 'Clear selection',
        onclick: () => {
          selection.clear();
          redrawSelection();
        },
      }),
    );
    bar.refresh = () => {
      const n = selection.size;
      count.textContent = `${n} selected`;
      if (n > 0) bar.removeAttribute('hidden');
      else bar.setAttribute('hidden', '');
      apply.disabled = n === 0;
    };
    return bar;
  }

  const hideOwner = groupBy === 'owner' || (!isManager && filters.ownerId !== '');
  const groups = groupTasks(tasks, groupBy);
  // Columns are decided once across the whole result, so groups stay aligned
  // with each other rather than each picking its own set.
  const selectOpts = selection ? { selection, onToggle, onToggleGroup, register } : {};
  const columns = visibleTaskColumns(tasks, { hideOwner, ...selectOpts });
  if (selection) bulkBar = makeBulkBar(users);

  results.replaceChildren(
    el(
      'div',
      { class: 'result-head' },
      el(
        'span',
        { class: 'n' },
        `${tasks.length} task${tasks.length === 1 ? '' : 's'}`,
        groups.length > 1 && groupBy !== 'none'
          ? el('span', {
              class: 'muted',
              text: ` in ${groups.length} ${GROUP_KEYS[groupBy].label.toLowerCase()}s`,
            })
          : null,
      ),
      legend(columns),
    ),
    ...groups.map((group) =>
      taskGroup(group.name, group.tasks, { hideOwner, columns, ...selectOpts }),
    ),
    ...(bulkBar ? [bulkBar] : []),
  );
  if (bulkBar) bulkBar.refresh();
}

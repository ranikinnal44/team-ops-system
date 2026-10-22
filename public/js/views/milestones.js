/**
 * Screen 7 — Milestones: the plan, however you need to read it.
 *
 * One line per milestone, each carrying its own roll-up, with the tasks folded
 * away until asked for. The disclosure is a native <details>, so it opens on
 * click, on Enter and on Space, and screen readers announce it as expandable
 * without any ARIA here.
 *
 * Two orderings, because a plan gets read two ways. "Schedule" is the default:
 * flat and date-ordered, which is what you act on. "Workstream" groups the
 * same rows under their stream with a roll-up per stream — the top-down read
 * that the separate Project screen used to carry. That screen fetched this
 * exact payload to lay it out a second way, so it folded into this one.
 */
import { api, session } from '../api.js';
import { isTaskAssigner } from '../access.js';
import {
  el, pageHead, stat, select, progressBar, formatDate, taskGroup, visibleTaskColumns,
  openClarifications,
} from '../ui.js';

/**
 * Resolves the one project without a listing screen.
 *
 * There is a single project, so a list of one was pure friction: the nav goes
 * straight to its plan. The API still returns a collection, because nothing in
 * the data model says there can only ever be one.
 */
export async function soleProjectId() {
  const projects = await api.projects();
  if (projects.length === 0) return null;
  return projects[0].id;
}

/** Long-lead items and risks the plan records against a milestone. */
export function longLeadBox(items) {
  if (!items || items.length === 0) return null;
  return el(
    'div',
    { class: 'long-lead' },
    el('div', { class: 'label', text: 'Long lead items / dependencies' }),
    el(
      'ul',
      {},
      items.map((item) => {
        const critical = item.endsWith('[critical]');
        const text = critical ? item.replace(/\s*\[critical\]$/, '') : item;
        return el('li', { class: critical ? 'critical' : '', text });
      }),
    ),
  );
}

/** The plan's outcomes, each with its own stated deadline where it has one. */
export function deliverableList(deliverables) {
  if (!deliverables || deliverables.length === 0) return null;
  return el(
    'div',
    { style: 'margin:6px 0' },
    el('div', { class: 'small muted', style: 'margin-bottom:2px', text: 'Outcomes and deliverables' }),
    ...deliverables.map((d) =>
      el(
        'div',
        { class: `deliverable-row ${d.critical ? 'critical' : ''}` },
        el('span', { text: d.critical ? '▲' : '•' }),
        el('span', { text: d.name }),
        d.dueDate
          ? el('span', { class: 'due muted', text: `${d.dueLabel ?? ''} · ${formatDate(d.dueDate)}` })
          : d.dueLabel
            // The plan's wording, where no calendar date has been agreed.
            ? el('span', { class: 'due muted', text: d.dueLabel })
            : null,
      ),
    ),
  );
}

const GROUP_OPTIONS = [
  { value: 'schedule', label: 'Schedule' },
  { value: 'workstream', label: 'Workstream' },
];

/**
 * Counts for one milestone, computed here rather than read from the API's
 * totals so that the "no milestone" buckets — which the server does not roll
 * up — are summarised by the same rules as everything else on the screen.
 */
function rollUp(tasks) {
  const completed = tasks.filter((t) => t.status === 'completed').length;
  return {
    total: tasks.length,
    completed,
    blocked: tasks.filter((t) => t.status === 'blocked').length,
    overdue: tasks.filter((t) => t.exceptions.includes('OVERDUE')).length,
    gaps: tasks.reduce((n, t) => n + openClarifications(t).length, 0),
    percent: tasks.length === 0 ? 0 : Math.round((completed / tasks.length) * 100),
  };
}

/**
 * Where the milestone stands, as a single word.
 *
 * Deliberately about progress only: being blocked or late is a different
 * question and is shown separately, so a milestone cannot read as "Blocked"
 * when four of its five tasks are finished.
 */
function phaseOf(tasks, totals) {
  if (totals.total === 0) return { key: 'empty', label: 'No tasks' };
  if (totals.completed === totals.total) return { key: 'done', label: 'Complete' };
  if (tasks.some((t) => t.status !== 'not_started')) return { key: 'active', label: 'In progress' };
  return { key: 'queued', label: 'Not started' };
}

/**
 * What a milestone sorts by. It holds no dates of its own, so the earliest
 * start among its tasks stands in — the work is what gives a milestone a place
 * in the calendar. A milestone whose tasks are all unscheduled sorts last.
 */
const scheduleKey = (milestone, tasks = []) => {
  const dated = tasks.map((t) => t.startDate ?? t.dueDate).filter(Boolean).sort();
  return dated[0] ?? null;
};

/**
 * One flat, date-ordered list out of the project tree.
 *
 * Tasks with no milestone get an entry of their own per workstream rather than
 * being dropped: a screen that claims to show the project's work cannot
 * silently omit the work nobody has placed on the plan yet.
 */
function toEntries(tree) {
  const entries = [];
  for (const ws of tree.workstreams) {
    for (const ms of ws.milestones) {
      entries.push({
        id: ms.milestone.id,
        workstream: ws.workstream,
        milestone: ms.milestone,
        deliverables: ms.deliverables,
        tasks: ms.tasks,
      });
    }
    if (ws.unassignedTasks?.length) {
      entries.push({
        id: `unplaced-${ws.workstream.id}`,
        workstream: ws.workstream,
        milestone: null,
        deliverables: [],
        tasks: ws.unassignedTasks,
      });
    }
  }

  return entries.sort((a, b) => {
    // The unplaced buckets are not on the schedule, so they sit at the end.
    if ((a.milestone === null) !== (b.milestone === null)) return a.milestone === null ? 1 : -1;
    const da = scheduleKey(a.milestone, a.tasks);
    const db = scheduleKey(b.milestone, b.tasks);
    if (da !== db) {
      if (da === null) return 1;
      if (db === null) return -1;
      return da < db ? -1 : 1;
    }
    return (
      a.workstream.code.localeCompare(b.workstream.code) ||
      (a.milestone?.name ?? '').localeCompare(b.milestone?.name ?? '')
    );
  });
}

/** A count that only appears when it is non-zero — silence means nothing wrong. */
const alertChip = (count, label, tone) =>
  count > 0 ? el('span', { class: `ms-alert ${tone}`, text: `${count} ${label}` }) : null;

/**
 * Entries split into the sections the chosen grouping asks for.
 *
 * Schedule keeps the one flat, date-ordered run. Workstream buckets the same
 * rows by stream; because `toEntries` already sorted them, each bucket stays
 * in date order without sorting again.
 */
function toSections(entries, groupBy) {
  if (groupBy !== 'workstream') return [{ key: 'all', name: null, entries }];
  const sections = new Map();
  for (const entry of entries) {
    const existing = sections.get(entry.workstream.id) ?? {
      key: entry.workstream.id,
      name: `${entry.workstream.code} — ${entry.workstream.name}`,
      code: entry.workstream.code,
      entries: [],
    };
    existing.entries.push(entry);
    sections.set(entry.workstream.id, existing);
  }
  return [...sections.values()].sort((a, b) => a.code.localeCompare(b.code));
}

/** The stream's own roll-up, so a section is readable without opening a row. */
function sectionHead(section) {
  const totals = rollUp(section.entries.flatMap((entry) => entry.tasks));
  return el(
    'div',
    { class: 'ms-section-head' },
    el('span', { class: 'ms-section-name', text: section.name }),
    el(
      'span',
      { class: 'ms-metrics' },
      el(
        'span',
        { class: 'ms-alerts' },
        alertChip(totals.overdue, 'late', 'hot'),
        alertChip(totals.blocked, 'blocked', 'hot'),
        alertChip(totals.gaps, totals.gaps === 1 ? 'gap' : 'gaps', 'quiet'),
      ),
      el('span', { class: 'ms-count', text: `${totals.completed}/${totals.total}` }),
      el('span', { class: 'ms-bar section' }, progressBar(totals.total === 0 ? null : totals.percent)),
      el('span', { class: 'ms-pct', text: totals.total === 0 ? '—' : `${totals.percent}%` }),
    ),
  );
}

/** The collapsed line: name, where it sits, when it runs, how far along it is. */
function summaryLine(entry, totals, phase) {
  const { milestone, workstream } = entry;

  return el(
    'summary',
    { class: 'ms-head' },
    el('span', { class: 'ms-caret', 'aria-hidden': 'true', text: '▶' }),
    el(
      'span',
      { class: 'ms-main' },
      el('span', { class: 'ms-name', text: milestone ? milestone.name : 'No milestone assigned' }),
      el(
        'span',
        { class: 'ms-tags' },
        el('span', { class: 'ws-chip', title: workstream.name, text: workstream.code }),
        // The plan's own schedule, verbatim — "W1 - W2". A milestone holds no
        // calendar dates, so this is the only thing it can say about when.
        milestone?.timelineLabel
          ? el('span', {
              class: 'timeline-chip',
              title: 'Schedule as the plan states it',
              text: milestone.timelineLabel,
            })
          : null,
      ),
    ),
    el(
      'span',
      { class: 'ms-metrics' },
      el(
        'span',
        { class: 'ms-alerts' },
        alertChip(totals.overdue, 'late', 'hot'),
        alertChip(totals.blocked, 'blocked', 'hot'),
        alertChip(totals.gaps, totals.gaps === 1 ? 'gap' : 'gaps', 'quiet'),
      ),
      el('span', { class: `ms-phase ${phase.key}`, text: phase.label }),
      el('span', { class: 'ms-count', text: `${totals.completed}/${totals.total}` }),
      el(
        'span',
        { class: `ms-bar ${phase.key}`, title: `${totals.completed} of ${totals.total} tasks complete` },
        progressBar(totals.total === 0 ? null : totals.percent),
      ),
      el('span', { class: 'ms-pct', text: totals.total === 0 ? '—' : `${totals.percent}%` }),
    ),
  );
}

export async function milestonesView(mount, params) {
  const isManager = isTaskAssigner(session.user?.role);
  const projectId = await soleProjectId();
  if (projectId === null) {
    mount.replaceChildren(pageHead('Milestones', 'No project has been created yet.'));
    return;
  }

  const tree = await api.project(projectId);
  const entries = toEntries(tree);

  if (entries.length === 0) {
    mount.replaceChildren(
      pageHead('Milestones', tree.project.name),
      el('div', { class: 'card' }, el('div', { class: 'empty', text: 'No milestones on the plan yet.' })),
    );
    return;
  }

  // Columns are decided once across every task on the screen, so the tables
  // inside two open milestones line up with each other instead of each one
  // choosing its own widths.
  const allTasks = entries.flatMap((entry) => entry.tasks);
  const columns = visibleTaskColumns(allTasks, {});

  const openId = params?.get('open') ?? null;
  const groupBy = params?.get('groupBy') === 'workstream' ? 'workstream' : 'schedule';
  const panels = [];
  const phases = { done: 0, active: 0, queued: 0, empty: 0 };

  const rowFor = (entry) => {
    const totals = rollUp(entry.tasks);
    const phase = phaseOf(entry.tasks, totals);
    if (entry.milestone) phases[phase.key] += 1;

    const body = el(
      'div',
      { class: 'ms-body' },
      entry.milestone
        ? entry.milestone.description
          ? el('p', { class: 'ms-desc', text: entry.milestone.description })
          : null
        : el('p', {
            class: 'ms-desc',
            text: 'These tasks sit directly under the workstream; the source never placed them on a milestone.',
          }),
      deliverableList(entry.deliverables),
      entry.milestone ? longLeadBox(entry.milestone.longLeadItems) : null,
      entry.tasks.length
        ? el('div', { class: 'ms-tasks' }, taskGroup(null, entry.tasks, { columns }))
        : el('div', {
            class: 'empty',
            text: isManager
              ? 'No tasks have been recorded against this milestone yet.'
              : 'None of the tasks you are part of sit under this milestone.',
          }),
    );

    const panel = el(
      'details',
      { class: `ms-item ${phase.key}`, open: entry.id === openId },
      summaryLine(entry, totals, phase),
      body,
    );
    panels.push(panel);
    return panel;
  };

  const sections = toSections(entries, groupBy).flatMap((section) =>
    section.name === null
      ? section.entries.map(rowFor)
      : [el('div', { class: 'ms-section' }, sectionHead(section), ...section.entries.map(rowFor))],
  );

  let allOpen = false;
  const toggleAll = el('button', { class: 'subtle', text: 'Expand all' });
  toggleAll.addEventListener('click', () => {
    allOpen = !allOpen;
    for (const panel of panels) panel.open = allOpen;
    toggleAll.textContent = allOpen ? 'Collapse all' : 'Expand all';
  });

  // The grouping lives in the hash, so a particular reading of the plan can be
  // linked to and survives a reload.
  const groupSel = select(GROUP_OPTIONS, groupBy);
  groupSel.addEventListener('change', () => {
    location.hash = groupSel.value === 'schedule' ? '#/milestones' : '#/milestones?groupBy=workstream';
  });
  const controls = el(
    'div',
    { class: 'row' },
    el('span', { class: 'seg-label', text: 'Group' }),
    groupSel,
    toggleAll,
  );

  const planned = entries.filter((e) => e.milestone !== null).length;
  const overall = rollUp(allTasks);

  mount.replaceChildren(
    pageHead(
      'Milestones',
      isManager
        ? `${tree.project.name} — every milestone on the plan, ` +
          `${groupBy === 'workstream' ? 'grouped by workstream' : 'in date order'}`
        : `${tree.project.name} — milestones with the tasks you are part of`,
      controls,
    ),
    el(
      'div',
      { class: 'stats' },
      stat('Milestones', planned),
      stat('Complete', phases.done),
      stat('In progress', phases.active),
      stat('Not started', phases.queued + phases.empty),
      stat('Tasks', overall.total),
      stat('Overdue', overall.overdue, overall.overdue > 0 ? 'alert' : ''),
    ),
    el('div', { class: 'ms-list' }, ...sections),
  );
}

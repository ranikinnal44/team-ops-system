/**
 * DOM helpers and shared presentational pieces.
 *
 * Everything builds real nodes and sets `textContent` — no innerHTML with
 * user data anywhere, so task titles and comments cannot inject markup.
 */

export const STATUS_LABEL = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  review: 'Review',
  completed: 'Completed',
};

export const PRIORITY_LABEL = {
  P0: 'P0 — Critical',
  P1: 'P1 — High',
  P2: 'P2 — Normal',
  P3: 'P3 — Low',
};

export const FLAG_LABEL = {
  OVERDUE: 'OVERDUE',
  DUE_SOON: 'DUE SOON',
  NO_RECENT_UPDATE: 'NO UPDATE',
  BLOCKED: 'BLOCKED',
};

/**
 * What each clarification code means in plain words, and — crucially — which
 * row of the task's Details panel it is about.
 *
 * `field` is the answer to "where is the gap?": it matches a label in the
 * facts list, so the marker can be rendered on the field itself instead of
 * only in a side panel. `null` means the question is about the whole record,
 * not one field.
 */
export const CLARIFICATION = {
  MISSING_DUE_DATE: { label: 'Needs a deadline', field: 'Due date' },
  MISSING_DAY_OUTCOMES: { label: 'Needs an outcome for each day', field: 'Day plan' },
  MISSING_PRIORITY: { label: 'Needs a priority', field: 'Priority' },
  MISSING_STATUS: { label: 'Status not stated in the source', field: 'Status' },
  AMBIGUOUS_STATUS: { label: 'Source status could not be mapped', field: 'Status' },
  UNCLEAR_OWNER: { label: 'Primary owner unclear', field: 'Owner' },
  OWNERSHIP_TRANSFER: { label: 'Ownership transfer noted in the source', field: 'Owner' },
  MISSING_MILESTONE: { label: 'Not attached to a milestone', field: 'Hierarchy' },
  MISSING_DELIVERABLE: { label: 'No deliverable identified', field: 'Hierarchy' },
  UNCLEAR_CLASSIFICATION: { label: 'Workstream inferred, needs confirmation', field: 'Hierarchy' },
  UNKNOWN_PROGRESS: { label: 'Progress not quantified in the source', field: 'Progress' },
  INFERRED_SUPPORT: { label: 'Supporting member read from the task wording', field: 'Supporting' },
  TRUNCATED_SOURCE_TEXT: { label: 'Source text appears truncated', field: null },
  POSSIBLE_DUPLICATE: { label: 'Possible duplicate or overlap', field: null },
  MAY_NEED_DECOMPOSITION: { label: 'May need splitting into several tasks', field: null },
};

/** Plain label for a clarification, falling back to the raw code. */
export const clarificationLabel = (code) => CLARIFICATION[code]?.label ?? code;

/** Which facts row a clarification belongs on, or null for record-level ones. */
export const clarificationField = (code) => CLARIFICATION[code]?.field ?? null;

/** Stable id for a facts row, so a gap can link straight to its field. */
export const factId = (label) => `fact-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

/** el('div', { class: 'x' }, child, child) */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = String(value);
    else if (key === 'html') node.innerHTML = value; // only ever used with literals
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const clear = (node) => {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
};

// --- formatting -----------------------------------------------------------

export function formatDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function relativeDays(days) {
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  if (days === -1) return '1 day late';
  if (days < 0) return `${Math.abs(days)} days late`;
  return `in ${days} days`;
}

export const todayIso = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

/** Inclusive calendar days from `start` to `end`, as ISO dates. Empty if invalid. */
export const daysInRange = (start, end) => {
  if (!start || !end || end < start) return [];
  const out = [];
  for (let day = start; day <= end; day = addDays(day, 1)) {
    out.push(day);
    if (out.length > 366) break; // guard against a malformed range
  }
  return out;
};

export const addDays = (iso, days) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

/** Display name for a role. One place, so a new role is never mislabelled. */
export const roleLabel = (role) =>
  ({ manager: 'Manager', reviewer: 'Reviewer', employee: 'Employee' })[role] ?? 'Employee';

export const initials = (name) =>
  (name ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');

// --- small components -----------------------------------------------------

/**
 * How an owner is shown when nobody has been assigned. Planned work with no
 * owner must read as unassigned, not as belonging to whoever is nearest.
 */
export const ownerLabel = (name) => name ?? 'Unassigned';

export const unassignedTag = () =>
  el('span', { class: 'owner none', title: 'No owner assigned yet', text: 'Unassigned' });

export const statusBadge = (status) =>
  el('span', { class: `badge s-${status}`, text: STATUS_LABEL[status] ?? status });

/**
 * Handles an unassigned priority itself rather than leaving each call site to
 * remember: passing `null` otherwise built a chip with no text, so imported
 * work — all of which is unprioritised — showed nothing at all.
 */
export const priorityTag = (priority) => {
  if (priority === null || priority === undefined) return noPriorityTag();
  const label = PRIORITY_LABEL[priority] ?? priority;
  return el(
    'span',
    { class: `prio ${priority}`, title: label },
    el('span', { 'aria-hidden': 'true', text: priority }),
    el('span', { class: 'sr-only', text: label }),
  );
};

/** Shown in place of a priority chip when none has been assigned yet. */
export const noPriorityTag = () =>
  el('span', { class: 'prio none', title: 'Priority not assigned', text: 'No priority' });

export const flagTag = (flag) =>
  el('span', { class: `flag ${flag}`, text: FLAG_LABEL[flag] ?? flag });

/**
 * A task with no agreed deadline says so plainly. Showing a placeholder date
 * would make undated work look scheduled, which is the thing this system is
 * meant to prevent.
 */
export function dueLabel(task) {
  if (task.dueDate === null || task.dueDate === undefined) {
    return el('span', {
      class: 'due none',
      title: 'No deadline agreed yet',
      text: 'No due date',
    });
  }
  const cls = task.exceptions.includes('OVERDUE')
    ? 'late'
    : task.exceptions.includes('DUE_SOON')
      ? 'soon'
      : '';
  return el(
    'span',
    { class: `due ${cls}`, title: `Due ${formatDate(task.dueDate)}` },
    formatDate(task.dueDate),
    task.status !== 'completed' && task.daysUntilDue !== null
      ? el('span', { class: 'muted', text: ` · ${relativeDays(task.daysUntilDue)}` })
      : null,
  );
}

export const progressBar = (percent) =>
  percent === null || percent === undefined
    ? el('div', { class: 'progress-track unknown', title: 'Progress not recorded' })
    : el(
        'div',
        { class: 'progress-track', title: `${percent}% complete` },
        el('div', {
          class: 'progress-fill',
          style: `width:${Math.max(0, Math.min(100, percent))}%`,
        }),
      );

/**
 * A number on a scoreboard. A zero stays on the board — "0 overdue" is worth
 * knowing — but recedes, so a row that is mostly zeros does not read as loud
 * as a row with real figures in it.
 */
export function stat(label, value, tone) {
  const isZero = value === 0 || value === '0' || value === '0%';
  return el(
    'div',
    { class: `stat ${tone || (isZero ? 'zero' : '')}`.trim() },
    el('div', { class: 'n', text: value }),
    el('div', { class: 'k', text: label }),
  );
}

/**
 * A grid of exception buckets, where only the buckets with something in them
 * get a card.
 *
 * A screen of cards each saying "nothing here" reads as broken, and buries the
 * one card that does have content. But silently dropping an empty bucket loses
 * the reassurance that it was checked at all — so the clear ones collapse into
 * a single line naming them.
 *
 * `sections` is [{ title, tasks, emptyText }].
 */
export function exceptionGrid(sections, opts = {}) {
  const withContent = sections.filter((section) => section.tasks.length > 0);
  const clear = sections.filter((section) => section.tasks.length === 0);

  const clearLine =
    clear.length > 0
      ? el(
          'div',
          { class: 'all-clear' },
          el('span', { class: 'tick', text: '✓' }),
          el(
            'span',
            {},
            clear.length === sections.length ? 'All clear — ' : 'Also checked, nothing found — ',
            el('span', { class: 'items', text: clear.map((c) => c.title.toLowerCase()).join(', ') }),
          ),
        )
      : null;

  if (withContent.length === 0) return clearLine;

  return el(
    'div',
    {},
    el(
      'div',
      { class: 'exceptions' },
      withContent.map((section) => exceptionSection(section.title, section.tasks, section.emptyText, opts)),
    ),
    clearLine,
  );
}

/**
 * The one thing to say when a whole screen has no content, instead of a dozen
 * empty cards each saying it separately.
 */
export function emptyState(heading, detail, action) {
  return el(
    'div',
    { class: 'empty-state' },
    el('div', { class: 'es-head', text: heading }),
    detail ? el('div', { class: 'es-detail', text: detail }) : null,
    action ? el('div', { class: 'es-action' }, action) : null,
  );
}

export function card(title, body, actions) {
  const header = title
    ? el('header', {}, el('h2', {}, title), actions ? el('div', { class: 'row' }, actions) : null)
    : null;
  return el('section', { class: 'card' }, header, el('div', { class: 'body' }, body));
}

/**
 * A card whose body sits flush to the edges — for task lists and tables that
 * bring their own padding. Built this way rather than by reaching back into
 * the finished node, which silently targeted the wrong element when a page
 * grew a second list.
 */
export function tightCard(title, body, actions) {
  const header = title
    ? el('header', {}, el('h2', {}, title), actions ? el('div', { class: 'row' }, actions) : null)
    : null;
  return el('section', { class: 'card' }, header, el('div', { class: 'body tight' }, body));
}

let sectionSeq = 0;

/** Tone for the count pill: red for things that are already wrong, amber for soon. */
function countTone(title, count) {
  if (count <= 0) return '';
  if (/overdue|blocked/i.test(title)) return 'hot';
  if (/due (today|tomorrow|soon|within)|no recent update|needs an update/i.test(title)) return 'warm';
  return '';
}

/**
 * A titled list section. The heading sits left, the count right — never run
 * together — and the count is repeated in the heading for screen readers so
 * the section announces as e.g. "Overdue, 1 task".
 *
 * `opts.layout` picks the body: 'rows' (the dense table-like list) or 'cards'
 * (the self-contained task cards the exception sections use).
 */
export function listCard(title, nodes, emptyText, badgeCount, opts = {}) {
  const titleId = `sec-${++sectionSeq}`;
  const counted = badgeCount !== undefined;
  const header = el(
    'header',
    {},
    el(
      'h2',
      { id: titleId },
      title,
      counted
        ? el('span', { class: 'sr-only', text: `, ${badgeCount} ${badgeCount === 1 ? 'task' : 'tasks'}` })
        : null,
    ),
    counted
      ? el('span', {
          class: `count-pill ${countTone(title, badgeCount)}`,
          'aria-hidden': 'true',
          text: badgeCount,
        })
      : null,
  );
  const wrapper = opts.layout === 'cards' ? 'task-cards' : 'task-list';
  const body =
    nodes.length > 0
      ? el('div', { class: 'body tight' }, el('div', { class: wrapper }, nodes))
      : el('div', { class: 'empty', text: emptyText });
  return el('section', { class: 'card', 'aria-labelledby': titleId }, header, body);
}

/** An exception bucket rendered as a stack of task cards. */
export function exceptionSection(title, tasks, emptyText, opts = {}) {
  return listCard(title, taskCards(tasks, opts), emptyText, tasks.length, { layout: 'cards' });
}

/** The questions the source never answered. The one definition everything uses. */
export const openClarifications = (task) =>
  (task.clarifications ?? []).filter((c) => !c.resolved);

/** The standard task row: owner, what, when, status, blocked, next action. */
export function taskRow(task, opts = {}) {
  const unresolved = openClarifications(task);
  const needs = unresolved.length
    ? el('span', {
        class: 'flag NEEDS_INFO',
        title: unresolved.map((c) => c.detail).join('\n\n'),
        text: `NEEDS INFO ×${unresolved.length}`,
      })
    : null;

  const meta = el(
    'div',
    { class: 'meta' },
    statusBadge(task.status),
    priorityTag(task.priority),
    opts.hideOwner
      ? null
      : task.ownerName
        ? el('span', { text: `👤 ${task.ownerName}` })
        : unassignedTag(),
    el('span', { class: 'muted', text: `${task.projectCode} · ${task.workstreamName}` }),
    ...task.exceptions.map(flagTag),
    needs,
  );

  const detail = task.blocker
    ? el('div', { class: 'next blocker', text: `Blocked: ${task.blocker}` })
    : task.nextAction
      ? el('div', { class: 'next', text: `Next: ${task.nextAction}` })
      : null;

  return el(
    'a',
    { class: 'task-row', href: `#/tasks/${task.id}` },
    el('div', {}, el('span', { class: 'ref', text: task.ref })),
    el('div', {}, el('div', { class: 'title', text: task.title }), meta, detail),
    el(
      'div',
      { class: 'right' },
      dueLabel(task),
      el('div', { style: 'width:72px' }, progressBar(task.progress)),
    ),
  );
}

export const taskRows = (tasks, opts) => tasks.map((task) => taskRow(task, opts));

/* ---------------------------------------------------------------------------
   Task table — the dense, scannable layout used by the Tasks screen.

   The row above works for a dozen items on a dashboard. At 84 it collapses:
   every task wraps a line of chips, and because most values are unset the same
   three phrases ("No priority", "No due date", "NEEDS INFO") repeat down the
   whole page and drown the handful of rows that differ.

   So this lays tasks out in fixed columns the eye can run down, shows absent
   values as a quiet dash instead of a loud chip, and reduces the flag soup to
   the single most severe signal per task with the rest on hover.
--------------------------------------------------------------------------- */

/** Most severe first — only the top one is shown, the rest go in the tooltip. */
const FLAG_SEVERITY = ['OVERDUE', 'BLOCKED', 'DUE_SOON', 'NO_RECENT_UPDATE'];

/** Plain words, not jargon: these appear in a narrow column and a legend. */
const SHORT_FLAG = {
  OVERDUE: 'Late',
  BLOCKED: 'Blocked',
  DUE_SOON: 'Due soon',
  NO_RECENT_UPDATE: 'No update',
};

/**
 * A value that has not been set. Quiet on purpose: the Gaps column and the
 * Gaps filter are how you go looking for them.
 *
 * It keeps its column's class so responsive rules that hide a column still
 * catch the cells that happen to be empty.
 */
const absent = (hint, cellClass = '') =>
  el('span', { class: `${cellClass} cell-absent`.trim(), title: hint, text: '—' });

function statusDot(status) {
  return el(
    'span',
    { class: `status-dot s-${status}`, title: STATUS_LABEL[status] ?? status },
    el('span', { class: 'sr-only', text: STATUS_LABEL[status] ?? status }),
  );
}

/**
 * The table's columns, declared as data.
 *
 * `show` decides per view whether a column earns its width: a Priority column
 * that reads "—" on every row tells you nothing, so it is dropped until some
 * task in view actually has one.
 */
const TASK_COLUMNS = [
  {
    key: 'ref',
    label: 'Ref',
    width: '94px',
    cell: (task) => el('span', { class: 'cell-ref', text: task.ref }),
  },
  {
    key: 'task',
    label: 'Task',
    width: 'minmax(0, 1fr)',
    cell: (task) =>
      el(
        'span',
        { class: 'cell-task' },
        statusDot(task.status),
        el('span', { class: 'cell-title', text: task.title }),
        task.blocker ? el('span', { class: 'cell-blocker', text: task.blocker }) : null,
      ),
  },
  {
    key: 'owner',
    label: 'Owner',
    width: '118px',
    show: (tasks, opts) => !opts.hideOwner,
    cell: (task) =>
      task.ownerName
        ? el('span', { class: 'cell-owner', text: task.ownerName })
        : absent('No owner assigned', 'cell-owner'),
  },
  {
    key: 'due',
    label: 'Due',
    width: '94px',
    // Dropped when nothing in view has a deadline, which is the case for any
    // view of purely historical work.
    show: (tasks) => tasks.some((t) => t.dueDate),
    cell: (task) =>
      task.dueDate
        ? el('span', {
            class: `cell-due ${
              task.exceptions.includes('OVERDUE')
                ? 'late'
                : task.exceptions.includes('DUE_SOON')
                  ? 'soon'
                  : ''
            }`,
            title:
              task.daysUntilDue === null || task.status === 'completed'
                ? formatDate(task.dueDate)
                : `${formatDate(task.dueDate)} — ${relativeDays(task.daysUntilDue)}`,
            text: formatDate(task.dueDate),
          })
        : absent('No deadline agreed', 'cell-due'),
  },
  {
    key: 'priority',
    label: 'Priority',
    width: '62px',
    align: 'center',
    show: (tasks) => tasks.some((t) => t.priority),
    cell: (task) =>
      task.priority
        ? el('span', {
            class: `cell-prio prio ${task.priority}`,
            title: PRIORITY_LABEL[task.priority],
            text: task.priority,
          })
        : absent('No priority assigned', 'cell-prio'),
  },
  {
    // What is wrong with the WORK: late, blocked, not moving.
    key: 'alert',
    label: 'Alert',
    width: '96px',
    show: (tasks) => tasks.some((t) => t.exceptions.length > 0),
    cell: (task) => {
      const flags = [...task.exceptions].sort(
        (a, b) => FLAG_SEVERITY.indexOf(a) - FLAG_SEVERITY.indexOf(b),
      );
      if (flags.length === 0) return absent('Nothing flagged', 'cell-alert');
      const top = flags[0];
      return el('span', {
        class: `cell-alert sig ${top}`,
        title: flags.map((f) => FLAG_LABEL[f] ?? f).join(' · '),
        text: flags.length > 1 ? `${SHORT_FLAG[top] ?? top} +${flags.length - 1}` : SHORT_FLAG[top] ?? top,
      });
    },
  },
  {
    // What is missing from the RECORD: things the source never established.
    key: 'gaps',
    label: 'Gaps',
    width: '74px',
    show: (tasks) => tasks.some((t) => openClarifications(t).length > 0),
    cell: (task) => {
      const open = openClarifications(task);
      if (open.length === 0) return absent('Nothing outstanding', 'cell-gaps');
      return el('span', {
        class: 'cell-gaps sig needs',
        title: `${open.length} unanswered question(s) about this task:\n\n${open
          .map((c) => `• ${c.detail}`)
          .join('\n\n')}\n\nOpen the task to fill them in.`,
        text: `${open.length} gap${open.length === 1 ? '' : 's'}`,
      });
    },
  },
];

/** The columns worth showing for this particular set of tasks. */
/**
 * A tick box for bulk actions.
 *
 * The row itself is a link, so the box swallows its own click rather than
 * letting it navigate, and tracks state through `opts.selection` instead of
 * the input's own checked flag.
 */
const selectColumn = (opts) => ({
  key: 'select',
  label: '',
  width: '26px',
  cell: (task) => {
    const on = opts.selection.has(task.id);
    const box = el('span', {
      class: `cell-select tickbox${on ? ' on' : ''}`,
      role: 'checkbox',
      'aria-checked': on ? 'true' : 'false',
      'aria-label': `Select ${task.ref}`,
      tabindex: '0',
      text: on ? '✓' : '',
      onclick: (event) => {
        event.preventDefault();
        event.stopPropagation();
        opts.onToggle(task.id);
      },
    });
    // Handed back to the caller so it can repaint without re-querying the DOM
    // for a node it just created.
    opts.register?.(task.id, { box });
    return box;
  },
});

/** Repaint one row's selected state. Pure DOM, no lookups. */
export function paintSelection(entry, on) {
  if (entry.box) {
    entry.box.className = `cell-select tickbox${on ? ' on' : ''}`;
    entry.box.textContent = on ? '✓' : '';
    entry.box.setAttribute('aria-checked', on ? 'true' : 'false');
  }
  if (entry.row) {
    entry.row.className = entry.row.className.replace(' is-selected', '') + (on ? ' is-selected' : '');
  }
}

export function visibleTaskColumns(tasks, opts = {}) {
  const columns = TASK_COLUMNS.filter((column) => !column.show || column.show(tasks, opts));
  return opts.selection ? [selectColumn(opts), ...columns] : columns;
}

export function taskTableHeader(columns) {
  return el(
    'div',
    { class: 'task-trow task-thead' },
    ...columns.map((column) =>
      el('span', { class: column.align === 'center' ? 'ta-center' : '', text: column.label }),
    ),
  );
}

/** One task as a table row. */
export function taskTableRow(task, columns, opts = {}) {
  const row = el(
    'a',
    {
      // Completed work stays visible but recedes, so a group is readable as
      // "what is left" without filtering it first. A task the source left
      // questions on carries an accent edge: click it to answer them.
      class:
        `task-trow${task.status === 'completed' ? ' is-done' : ''}` +
        `${openClarifications(task).length > 0 ? ' needs-info' : ''}`,
      href: `#/tasks/${task.id}`,
      title: task.title,
      dataset: { taskId: task.id },
    },
    ...columns.map((column) => column.cell(task)),
  );
  opts.register?.(task.id, { row });
  return row;
}

export const GROUP_KEYS = {
  workstream: { label: 'Workstream', of: (t) => `${t.workstreamCode} — ${t.workstreamName}` },
  owner: { label: 'Owner', of: (t) => t.ownerName ?? 'Unassigned' },
  status: { label: 'Status', of: (t) => STATUS_LABEL[t.status] ?? t.status },
  milestone: { label: 'Milestone', of: (t) => t.milestoneName ?? 'No milestone' },
  none: { label: 'Nothing', of: null },
};

/** Split tasks into named groups, preserving the order they arrived in. */
export function groupTasks(tasks, key) {
  const group = GROUP_KEYS[key];
  if (!group || group.of === null) return [{ name: null, tasks }];
  const map = new Map();
  for (const task of tasks) {
    const name = group.of(task);
    const list = map.get(name) ?? [];
    list.push(task);
    map.set(name, list);
  }
  return [...map.entries()]
    .map(([name, list]) => ({ name, tasks: list }))
    .sort((a, b) => b.tasks.length - a.tasks.length || a.name.localeCompare(b.name));
}

export function taskGroup(name, tasks, opts = {}) {
  const done = tasks.filter((t) => t.status === 'completed').length;
  const flagged = tasks.filter((t) => t.exceptions.length > 0).length;
  // Columns are chosen once per table so every row lines up, and written as a
  // custom property rather than a fixed class per combination.
  const columns = opts.columns ?? visibleTaskColumns(tasks, opts);

  // "Assign all 14 AMP tasks to X" should be two clicks, not fourteen.
  const allSelected =
    opts.selection !== undefined && tasks.length > 0 && tasks.every((t) => opts.selection.has(t.id));
  const selectAll = opts.selection
    ? el('button', {
        class: 'subtle gselect',
        text: allSelected ? 'Clear group' : 'Select all',
        onclick: () => opts.onToggleGroup(tasks.map((t) => t.id), !allSelected),
      })
    : null;

  const heading =
    name || selectAll
      ? el(
          'div',
          { class: 'task-group-head' },
          name ? el('span', { class: 'gname', text: name }) : null,
          el('span', { class: 'count-pill', text: tasks.length }),
          done > 0 ? el('span', { class: 'gmeta', text: `${done} done` }) : null,
          flagged > 0 ? el('span', { class: 'gmeta flagged', text: `${flagged} flagged` }) : null,
          selectAll,
        )
      : null;

  return el(
    'div',
    { class: 'task-group' },
    heading,
    el(
      'div',
      {
        class: 'task-table',
        style: `--task-cols: ${columns.map((c) => c.width).join(' ')}`,
      },
      taskTableHeader(columns),
      ...tasks.map((task) => taskTableRow(task, columns, opts)),
    ),
  );
}

const capitalise = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);

/** The date line on a task card: "4 Oct 2026 · 2 days late". */
function cardDue(task) {
  if (!task.dueDate) return el('span', { class: 'due none', text: 'No due date' });
  const cls = task.exceptions.includes('OVERDUE')
    ? 'late'
    : task.exceptions.includes('DUE_SOON')
      ? 'soon'
      : '';
  const showRelative = task.status !== 'completed' && typeof task.daysUntilDue === 'number';
  return el(
    'span',
    { class: `due ${cls}` },
    el('span', { text: formatDate(task.dueDate) }),
    showRelative ? el('span', { class: 'sep', text: ' · ' }) : null,
    showRelative ? el('span', { text: capitalise(relativeDays(task.daysUntilDue)) }) : null,
  );
}

/**
 * The exception-list task card.
 *
 * One link per card — the title — stretched over the whole card so clicking
 * anywhere opens the task, while a keyboard user tabs through one stop per
 * card rather than one per field. "View task →" is decoration for that link,
 * so it is hidden from assistive tech instead of duplicating the destination.
 */
export function taskCard(task, opts = {}) {
  const id = `tc-${++sectionSeq}`;
  const urgent = task.exceptions.includes('OVERDUE') || task.exceptions.includes('BLOCKED');
  const tone = urgent ? 'hot' : task.exceptions.includes('DUE_SOON') ? 'warm' : '';

  const note = task.blocker
    ? { label: 'Blocked', text: task.blocker, cls: 'blocker' }
    : task.nextAction
      ? { label: 'Next', text: task.nextAction, cls: '' }
      : null;

  return el(
    'article',
    { class: `task-card ${tone}`, 'aria-labelledby': `${id}-title` },
    el(
      'div',
      { class: 'tc-top' },
      el('span', { class: 'ref', text: task.ref }),
      el(
        'div',
        { class: 'tc-tags' },
        task.priority ? priorityTag(task.priority) : noPriorityTag(),
        statusBadge(task.status),
      ),
    ),
    el(
      'h3',
      { class: 'tc-title', id: `${id}-title` },
      el('a', {
        href: `#/tasks/${task.id}`,
        'aria-label': `${task.ref}: ${task.title}`,
        text: task.title,
      }),
    ),
    el(
      'div',
      { class: 'tc-meta' },
      el('span', { text: `${task.projectCode} · ${task.workstreamName}` }),
      opts.hideOwner
        ? null
        : el('span', {
            class: task.ownerName ? 'tc-owner' : 'tc-owner none',
            text: ownerLabel(task.ownerName),
          }),
    ),
    task.exceptions.length
      ? el(
          'ul',
          { class: 'tc-flags' },
          task.exceptions.map((flag) => el('li', {}, flagTag(flag))),
        )
      : null,
    note
      ? el(
          'div',
          { class: `tc-note ${note.cls}` },
          el('span', { class: 'tc-note-label', text: note.label }),
          el('p', { class: 'tc-note-text', text: note.text }),
        )
      : null,
    el(
      'div',
      { class: 'tc-foot' },
      cardDue(task),
      el('span', { class: 'tc-go', 'aria-hidden': 'true' }, 'View task ', el('span', { class: 'arrow', text: '→' })),
    ),
    typeof task.progress === 'number'
      ? el(
          'div',
          { class: 'tc-progress' },
          progressBar(task.progress),
          el('span', { class: 'tc-pct', text: `${task.progress}%` }),
        )
      : null,
  );
}

export const taskCards = (tasks, opts) => tasks.map((task) => taskCard(task, opts));

// --- feedback -------------------------------------------------------------

let toastTimer;
export function toast(message, bad = false) {
  const node = document.getElementById('toast');
  node.textContent = message;
  node.className = `toast show${bad ? ' bad' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.className = 'toast';
  }, 3200);
}

export function errorBox(error) {
  const box = el('div', { class: 'error-box' }, error.message ?? 'Something went wrong');
  if (error.details?.length) {
    box.append(
      el(
        'ul',
        {},
        error.details.map((d) => el('li', { text: `${d.path}: ${d.message}` })),
      ),
    );
  }
  return box;
}

export function field(label, control, hint) {
  return el(
    'div',
    { class: 'field' },
    el('label', { text: label }),
    control,
    hint ? el('div', { class: 'hint', text: hint }) : null,
  );
}

export function select(options, value, props = {}) {
  const node = el('select', props);
  for (const option of options) {
    node.append(
      el('option', { value: option.value, selected: option.value === value }, option.label),
    );
  }
  return node;
}

export function pageHead(title, subtitle, actions) {
  return el(
    'div',
    { class: 'page-head' },
    el('div', {}, el('h1', { text: title }), subtitle ? el('div', { class: 'sub', text: subtitle }) : null),
    actions ? el('div', { class: 'row' }, actions) : null,
  );
}

export const loading = () => el('div', { class: 'empty', text: 'Loading…' });

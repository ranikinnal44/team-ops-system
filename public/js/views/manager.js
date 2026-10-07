/** Screen 2 — Manager dashboard: summary, exceptions, people, upcoming. */
import { api } from '../api.js';
import {
  el, card, tightCard, listCard, exceptionSection, exceptionGrid, stat, taskRows, pageHead,
  formatDate, toast,
} from '../ui.js';

export async function managerView(mount) {
  const board = await api.managerDashboard();
  const s = board.summary;

  const summary = el(
    'div',
    { class: 'stats' },
    stat('Total', s.total),
    stat('Not Started', s.notStarted),
    stat('In Progress', s.inProgress),
    stat('Blocked', s.blocked, s.blocked > 0 ? 'alert' : ''),
    stat('Review', s.review),
    stat('Completed', s.completed),
    stat('Overdue', s.overdue, s.overdue > 0 ? 'alert' : ''),
    stat('Due Today', s.dueToday, s.dueToday > 0 ? 'warn' : ''),
    stat('Due This Week', s.dueThisWeek),
    stat('No Update', s.noUpdate, s.noUpdate > 0 ? 'warn' : ''),
    stat('No Due Date', s.noDueDate, s.noDueDate > 0 ? 'warn' : ''),
    stat('No Priority', s.noPriority, s.noPriority > 0 ? 'warn' : ''),
  );

  const ex = board.exceptions;
  // Only the buckets with something in them get a card; the rest collapse to
  // one line, so a quiet week does not look like a broken page.
  const exceptions = exceptionGrid([
    { title: 'Overdue', tasks: ex.overdue, emptyText: 'Nothing is overdue.' },
    { title: 'Due within 2 days', tasks: ex.dueWithinTwoDays, emptyText: 'Nothing falls due in the next two days.' },
    { title: 'Blocked', tasks: ex.blocked, emptyText: 'Nothing is blocked.' },
    { title: 'No recent update', tasks: ex.noRecentUpdate, emptyText: 'Everything has been updated recently.' },
  ]);

  /**
   * Before work starts, the useful question is not "what is late" but "is this
   * plan ready to be worked". This replaces the exception lists as the lead
   * when the answer is no.
   */
  const setupPanel = (() => {
    const gaps = [
      s.noPriority > 0 ? { n: s.noPriority, label: 'need a priority', href: '#/tasks?missingPriority=true' } : null,
      s.noDueDate > 0 ? { n: s.noDueDate, label: 'need a deadline', href: '#/tasks?missingDueDate=true' } : null,
    ].filter(Boolean);
    const unassigned = board.summary.total - board.byOwner.reduce((sum, o) => sum + o.total, 0);
    if (unassigned > 0) {
      gaps.unshift({ n: unassigned, label: 'have no owner', href: '#/tasks' });
    }
    if (gaps.length === 0) return null;
    return el(
      'div',
      { class: 'setup-panel' },
      el('div', { class: 'sp-head', text: 'Before this plan can be worked' }),
      el(
        'div',
        { class: 'sp-items' },
        gaps.map((g) =>
          el('a', { class: 'sp-item', href: g.href },
            el('span', { class: 'n', text: g.n }), el('span', { text: g.label })),
        ),
      ),
    );
  })();

  /**
   * Per-workstream roll-up. Columns that are zero for every row are dropped:
   * six of the nine are empty before any work starts, and a table of zeros
   * hides the three numbers that mean something.
   */
  const WS_COLUMNS = [
    { label: 'Open', of: (r) => r.open },
    { label: 'Not started', of: (r) => r.notStarted },
    { label: 'In progress', of: (r) => r.inProgress },
    { label: 'Blocked', of: (r) => r.blocked, tone: 'danger' },
    { label: 'Review', of: (r) => r.review },
    { label: 'Overdue', of: (r) => r.overdue, tone: 'danger' },
    { label: 'No due date', of: (r) => r.noDueDate, tone: 'warn' },
  ];
  const wsColumns = WS_COLUMNS.filter((c) => board.byWorkstream.some((r) => c.of(r) > 0));

  const workstreams = tightCard(
    'By workstream',
    el(
      'table',
      {},
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', { text: 'Workstream' }),
          ...wsColumns.map((c) => el('th', { text: c.label })),
          el('th', { text: 'Done' }),
        ),
      ),
      el(
        'tbody',
        {},
        board.byWorkstream.map((row) =>
          el(
            'tr',
            {},
            el('td', {},
              el('a', { href: `#/tasks?workstreamId=${row.workstreamId}` },
                el('span', { class: 'ref', text: row.code }), ` ${row.name}`)),
            ...wsColumns.map((c) => {
              const value = c.of(row);
              const tone =
                value > 0 && c.tone === 'danger'
                  ? 'color:var(--danger);font-weight:650'
                  : value > 0 && c.tone === 'warn'
                    ? 'color:var(--warn);font-weight:650'
                    : '';
              return el('td', { class: 'num', style: tone, text: value });
            }),
            el('td', { class: 'num', text: `${row.completed}/${row.total}` }),
          ),
        ),
      ),
    ),
  );

  /**
   * Each clarification type links to the task list filtered to the tasks that
   * have it, so the count is a way in rather than just a number. Types with no
   * matching filter fall back to the general clarification view.
   */
  const GAP_FILTER = {
    MISSING_PRIORITY: 'missingPriority=true',
    MISSING_DUE_DATE: 'missingDueDate=true',
    UNCLEAR_OWNER: 'unassigned=true',
  };
  const gapHref = (code) => `#/tasks?${GAP_FILTER[code] ?? 'needsClarification=true'}`;

  const clar = board.clarifications;
  const clarificationCard = card(
    'Requires clarification',
    clar.total === 0
      ? el('div', { class: 'muted small', text: 'Nothing is awaiting clarification.' })
      : el(
          'div',
          {},
          el('div', { class: 'muted small', style: 'margin-bottom:10px',
            text: `${clar.total} open item(s) the source data did not establish. Nothing was guessed.` }),
          el('div', { class: 'row' },
            clar.byCode.map((entry) =>
              el('a', { class: 'btn', href: gapHref(entry.code), title: entry.code },
                `${entry.label} `, el('span', { class: 'count-pill', text: entry.count })))),
        ),
  );

  const people = tightCard(
    'Team progress',
    el(
      'table',
      {},
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', { text: 'Person' }),
          el('th', { text: 'Open' }),
          el('th', { text: 'Overdue' }),
          el('th', { text: 'Blocked' }),
          el('th', { text: 'No update' }),
          el('th', { text: 'Done' }),
          el('th', { text: 'Needs attention first' }),
        ),
      ),
      el(
        'tbody',
        {},
        board.byOwner.map((row) =>
          el(
            'tr',
            {},
            el('td', {}, el('a', { href: `#/my-work?userId=${row.userId}`, text: row.name }),
               el('div', { class: 'small muted', text: row.title ?? '' })),
            el('td', { class: 'num', text: row.open }),
            el('td', { class: 'num', style: row.overdue ? 'color:var(--danger);font-weight:650' : '', text: row.overdue }),
            el('td', { class: 'num', style: row.blocked ? 'color:var(--danger);font-weight:650' : '', text: row.blocked }),
            el('td', { class: 'num', style: row.noUpdate ? 'color:var(--warn);font-weight:650' : '', text: row.noUpdate }),
            el('td', { class: 'num', text: `${row.completed}/${row.total}` }),
            el(
              'td',
              {},
              row.topTask
                ? el('a', { href: `#/tasks/${row.topTask.id}` }, el('span', { class: 'ref', text: row.topTask.ref }), ` ${row.topTask.title}`)
                : el('span', { class: 'muted', text: 'Nothing open' }),
            ),
          ),
        ),
      ),
    ),
  );

  const upcoming = listCard(
    'Upcoming deadlines (next 7 days)',
    taskRows(board.upcoming),
    'No deadlines in the next week.',
    board.upcoming.length,
  );

  const requestsBody = board.pendingDeadlineRequests.length
    ? el(
        'div',
        {},
        board.pendingDeadlineRequests.map((request) =>
          el(
            'div',
            { class: 'comment' },
            el(
              'div',
              { class: 'head' },
              el('a', { class: 'ref', href: `#/tasks/${request.taskId}`, text: request.taskRef }),
              el('span', { class: 'author', text: request.requestedByName }),
              el('span', { class: 'when', text: `${formatDate(request.currentDueDate)} → ${formatDate(request.requestedDueDate)}` }),
            ),
            el('div', { class: 'body', text: request.reason }),
            el(
              'div',
              { class: 'row', style: 'margin-top:8px' },
              el('button', {
                class: 'primary',
                text: 'Approve',
                onclick: async (event) => {
                  event.target.disabled = true;
                  try {
                    await api.decideDeadline(request.id, true, 'Approved from the dashboard.');
                    toast('Deadline updated');
                    managerView(mount);
                  } catch (error) {
                    toast(error.message, true);
                  }
                },
              }),
              el('button', {
                class: 'danger',
                text: 'Reject',
                onclick: async (event) => {
                  event.target.disabled = true;
                  try {
                    await api.decideDeadline(request.id, false, 'Rejected from the dashboard.');
                    toast('Request rejected');
                    managerView(mount);
                  } catch (error) {
                    toast(error.message, true);
                  }
                },
              }),
            ),
          ),
        ),
      )
    : el('div', { class: 'muted small', text: 'No deadline changes are awaiting a decision.' });

  mount.replaceChildren(
    pageHead(
      'Manager dashboard',
      `What is happening, what is late, what is blocked — as of ${formatDate(board.generatedFor)}`,
      el('a', { class: 'btn primary', href: '#/tasks/new', text: '+ New task' }),
    ),
    summary,
    el('div', { style: 'height:16px' }),
    // Each of these is dropped rather than rendered empty.
    ...(setupPanel ? [setupPanel, el('div', { style: 'height:16px' })] : []),
    ...(board.needsAttention.length
      ? [
          tightCard('Needs your intervention', el('div', { class: 'task-list' }, taskRows(board.needsAttention))),
          el('div', { style: 'height:16px' }),
        ]
      : []),
    exceptions,
    el('div', { style: 'height:16px' }),
    ...(board.clarifications.total > 0 ? [clarificationCard] : []),
    ...(board.pendingDeadlineRequests.length > 0
      ? [card('Deadline change requests', requestsBody)]
      : []),
    workstreams,
    ...(board.byOwner.length > 0 ? [people] : []),
    ...(board.upcoming.length > 0 ? [upcoming] : []),
  );
}


/** Screen 3 — Employee dashboard: what to do today, next, and what is stuck. */
import { api, session } from '../api.js';
import {
  el, card, tightCard, listCard, exceptionGrid, emptyState, stat, taskRows, pageHead, formatDate,
} from '../ui.js';

export async function employeeView(mount, params) {
  const targetId = params.get('userId') ?? undefined;
  const board = await api.employeeDashboard(targetId);
  const me = session.user;
  const viewingOther = Boolean(targetId) && targetId !== me?.id;
  const own = { hideOwner: true };
  const s = board.summary;

  // Nobody has been given any of this plan yet. Nine zeroed tiles above eight
  // cards that each say "nothing" is a worse answer than saying it once.
  if (s.total === 0) {
    mount.replaceChildren(
      pageHead(
        viewingOther ? 'Individual board' : 'My work',
        viewingOther ? 'Nothing assigned' : `As of ${formatDate(board.generatedFor)}`,
      ),
      emptyState(
        viewingOther ? 'Nothing is assigned to this person yet' : 'You have no tasks assigned yet',
        viewingOther
          ? 'Tasks appear here once they are given an owner.'
          : 'The build plan is loaded but its tasks have not been given owners. ' +
              'Once a manager assigns you work, it will show up here, most important first.',
        el('a', { class: 'btn', href: '#/tasks', text: 'Browse the plan' }),
      ),
    );
    return;
  }

  const summary = el(
    'div',
    { class: 'stats' },
    stat('My tasks', s.total),
    stat('Due today', s.dueToday, s.dueToday > 0 ? 'warn' : ''),
    stat('Overdue', s.overdue, s.overdue > 0 ? 'alert' : ''),
    stat('Blocked', s.blocked, s.blocked > 0 ? 'alert' : ''),
    stat('In progress', s.inProgress),
    stat('Awaiting review', s.review),
    stat('Needs an update', s.noUpdate, s.noUpdate > 0 ? 'warn' : ''),
    stat('No due date', s.noDueDate, s.noDueDate > 0 ? 'warn' : ''),
    stat('Completed', s.completed),
  );

  const myRequests = board.myDeadlineRequests.length
    ? tightCard(
        'My deadline change requests',
        el(
          'table',
          {},
          el('thead', {}, el('tr', {},
            el('th', { text: 'Task' }), el('th', { text: 'From' }),
            el('th', { text: 'To' }), el('th', { text: 'Status' }))),
          el(
            'tbody',
            {},
            board.myDeadlineRequests.map((r) =>
              el('tr', {},
                el('td', {}, el('a', { href: `#/tasks/${r.taskId}`, class: 'ref', text: r.taskRef })),
                el('td', { text: formatDate(r.currentDueDate) }),
                el('td', { text: formatDate(r.requestedDueDate) }),
                el('td', {}, el('span', { class: `badge s-${r.status === 'approved' ? 'completed' : r.status === 'rejected' ? 'blocked' : 'review'}`, text: r.status }))),
            ),
          ),
        ),
      )
    : null;

  mount.replaceChildren(
    pageHead(
      viewingOther ? 'Individual board' : 'My work',
      `Most important first — as of ${formatDate(board.generatedFor)}`,
      el('a', { class: 'btn', href: '#/tasks', text: 'All my tasks' }),
    ),
    summary,
    el('div', { style: 'height:16px' }),
    ...(board.focus.length > 0
      ? [listCard('Focus — what to do next', taskRows(board.focus.slice(0, 8), { hideOwner: !viewingOther }), '', board.focus.length)]
      : [card(null, el('div', { class: 'muted small', text: 'Nothing open — everything assigned to you is done.' }))]),
    el('div', { style: 'height:16px' }),
    exceptionGrid(
      [
        { title: 'Overdue', tasks: board.overdue, emptyText: 'Nothing overdue.' },
        { title: 'Due today', tasks: board.dueToday, emptyText: 'Nothing due today.' },
        { title: 'Due tomorrow', tasks: board.dueTomorrow, emptyText: 'Nothing due tomorrow.' },
        { title: 'Due this week', tasks: board.dueThisWeek, emptyText: 'Nothing else due this week.' },
        { title: 'Blocked', tasks: board.blocked, emptyText: 'Nothing is blocked.' },
        { title: 'Awaiting review', tasks: board.awaitingReview, emptyText: 'Nothing is waiting on review.' },
        { title: 'No recent update', tasks: board.needsUpdate, emptyText: 'Everything is up to date.' },
        {
          title: 'Owes a daily outcome',
          tasks: board.needsDailyOutcome ?? [],
          emptyText: 'Every task in progress has today\u2019s outcome.',
        },
        { title: 'Recently completed', tasks: board.recentlyCompleted, emptyText: 'Nothing completed recently.' },
      ],
      own,
    ),
    // Spread rather than passing null: replaceChildren would render it as text.
    ...(myRequests ? [el('div', { style: 'height:16px' }), myRequests] : []),
  );
}

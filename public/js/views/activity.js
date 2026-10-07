/** Screen 8 — Activity history feed across tasks. */
import { api } from '../api.js';
import { el, card, pageHead, formatDateTime } from '../ui.js';

const HISTORY_TEXT = {
  created: 'created',
  status_changed: 'status changed',
  progress_changed: 'progress changed',
  field_changed: 'changed',
  blocker_added: 'blocker added',
  blocker_cleared: 'blocker cleared',
  next_action_set: 'next action set',
  evidence_linked: 'evidence linked',
  reassigned: 'reassigned',
  comment_added: 'commented',
  deadline_change_requested: 'deadline change requested',
  deadline_change_approved: 'deadline change approved',
  deadline_change_rejected: 'deadline change rejected',
};

export async function activityView(mount) {
  const entries = await api.activity(100);

  const rows = entries.map((entry) =>
    el(
      'li',
      {},
      el('span', { class: 'when', text: formatDateTime(entry.createdAt) }),
      el(
        'span',
        { class: 'what' },
        el('a', { class: 'ref', href: `#/tasks/${entry.taskId}`, text: entry.taskRef }),
        ' ',
        el('span', { class: 'who', text: entry.actorName }),
        ' ',
        HISTORY_TEXT[entry.kind] ?? entry.kind,
        entry.field && entry.kind === 'field_changed' ? el('strong', { text: ` ${entry.field}` }) : null,
        entry.fromValue && entry.toValue
          ? el('span', {}, ': ', el('span', { class: 'muted', text: entry.fromValue }), ' → ', el('strong', { text: entry.toValue }))
          : entry.toValue
            ? el('span', {}, ': ', el('strong', { text: entry.toValue }))
            : null,
        el('div', { class: 'muted small', text: entry.taskTitle }),
        entry.note ? el('div', { class: 'muted small', text: entry.note }) : null,
      ),
    ),
  );

  mount.replaceChildren(
    pageHead('Activity history', 'Every recorded change, newest first'),
    card(
      null,
      rows.length ? el('ul', { class: 'timeline' }, rows) : el('div', { class: 'muted', text: 'No activity yet.' }),
    ),
  );
}

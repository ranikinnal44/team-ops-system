/** Screen 6 — Create task. Task Assigners and reviewers. */
import { api, session } from '../api.js';
import {
  el,
  card,
  field,
  select,
  pageHead,
  errorBox,
  toast,
  todayIso,
  addDays,
  formatDate,
} from '../ui.js';

export async function createTaskView(mount) {
  if (session.user?.role !== 'manager' && session.user?.role !== 'reviewer') {
    mount.replaceChildren(
      pageHead('Create task', 'Task Assigners and reviewers only'),
      card(null, el('div', { class: 'muted', text: 'Only a Task Assigner or a reviewer can create tasks. Ask one of them to add it.' })),
    );
    return;
  }

  // The form starts at the workstream: with one project there is nothing to pick.
  const [workstreams, users, allTasks, rules] = await Promise.all([
    api.workstreams(),
    api.users(),
    api.tasks(),
    api.rules(),
  ]);
  const maxEffortDays = rules.maxTaskEffortDays;

  const workstreamSel = select(
    workstreams.map((w) => ({ value: w.id, label: `${w.code} — ${w.name}` })),
  );
  const milestoneSel = select([{ value: '', label: '— none —' }]);
  const deliverableSel = select([{ value: '', label: '— none —' }]);

  const titleInput = el('input', { type: 'text', required: true, placeholder: 'What needs to be done?' });
  // "Not assigned" is a real choice: structure is usually laid out before the
  // work is handed to anyone, and the Tasks screen assigns in bulk later.
  const ownerSel = select([
    { value: '', label: '— not assigned yet —' },
    ...users.map((u) => ({ value: u.id, label: u.role ? `${u.name} (${u.role})` : u.name })),
  ]);
  const reviewerSel = select([{ value: '', label: '— none —' }, ...users.map((u) => ({ value: u.id, label: u.name }))]);
  // "Not assigned" is a real, first-class choice rather than a hidden default.
  const prioritySel = select(
    [
      { value: '', label: '— not assigned —' },
      { value: 'P0', label: 'P0 — Critical' },
      { value: 'P1', label: 'P1 — High' },
      { value: 'P2', label: 'P2 — Normal' },
      { value: 'P3', label: 'P3 — Low' },
    ],
    'P2',
  );
  // Both dates are required, and the browser enforces the span before the
  // request is even made. The server checks it again regardless.
  const startInput = el('input', { type: 'date', name: 'startDate', value: '' });
  // The Task Assigner's unit is effort, not dates. The owner proposes the days that
  // spend this budget, and the reviewer agrees them.
  const effortInput = el('input', {
    type: 'number',
    name: 'effortDays',
    required: true,
    min: '1',
    max: String(maxEffortDays),
    value: '1',
  });
  const nextInput = el('input', { type: 'text', placeholder: 'The first step for the owner' });

  const supportBox = el('select', { multiple: true, size: '4' });
  for (const user of users) supportBox.append(el('option', { value: user.id }, user.name));

  const dependencyBox = el('select', { multiple: true, size: '4' });
  for (const task of allTasks.slice(0, 200)) {
    dependencyBox.append(el('option', { value: task.id }, `${task.ref} — ${task.title}`));
  }

  const picked = (node) => [...node.selectedOptions].map((o) => o.value);

  // Nothing day-by-day here: whoever assigns a task budgets the effort, and
  // the owner reports what each day produced once they are working on it.

  async function loadMilestones() {
    if (!workstreamSel.value) {
      milestoneSel.replaceChildren(el('option', { value: '' }, '— none —'));
      deliverableSel.replaceChildren(el('option', { value: '' }, '— none —'));
      return;
    }
    const milestones = await api.milestones(workstreamSel.value);
    // A milestone is optional: forcing one would invent project structure.
    milestoneSel.replaceChildren(
      el('option', { value: '' }, '— none —'),
      ...milestones.map((m) => el('option', { value: m.id }, m.name)),
    );
    await loadDeliverables();
  }

  async function loadDeliverables() {
    const deliverables = milestoneSel.value ? await api.deliverables(milestoneSel.value) : [];
    deliverableSel.replaceChildren(
      el('option', { value: '' }, '— none —'),
      ...deliverables.map((d) => el('option', { value: d.id }, d.name)),
    );
  }

  workstreamSel.addEventListener('change', loadMilestones);
  milestoneSel.addEventListener('change', loadDeliverables);

  const errors = el('div');
  const submit = el('button', { class: 'primary', type: 'submit', text: 'Create task' });

  const form = el(
    'form',
    {
      onsubmit: async (event) => {
        event.preventDefault();
        errors.replaceChildren();
        submit.disabled = true;
        try {
          const created = await api.createTask({
            workstreamId: workstreamSel.value,
            milestoneId: milestoneSel.value || null,
            deliverableId: deliverableSel.value || null,
            title: titleInput.value.trim(),
            ownerId: ownerSel.value || null,
            reviewerId: reviewerSel.value || null,
            supportingMemberIds: picked(supportBox),
            priority: prioritySel.value || null,
            effortDays: Number(effortInput.value),
            // Omitted unless the Task Assigner is scheduling it directly;
            // normally the owner picks the start date themselves.
            ...(startInput.value ? { startDate: startInput.value } : {}),
            dependencyTaskIds: picked(dependencyBox),
            nextAction: nextInput.value.trim() || null,
          });
          toast(`Created ${created.ref}`);
          location.hash = `#/tasks/${created.id}`;
        } catch (error) {
          errors.replaceChildren(errorBox(error));
          submit.disabled = false;
        }
      },
    },
    errors,
    el('div', { class: 'grid-2' },
      field('Workstream', workstreamSel),
      field('Milestone', milestoneSel)),
    field('Deliverable', deliverableSel, 'Optional — groups tasks inside a milestone.'),
    field('Task', titleInput),
    el('div', { class: 'grid-2' },
      field('Owner — single accountable person', ownerSel, 'Leave unassigned if it has not been decided.'),
      field('Reviewer', reviewerSel)),
    el('div', { class: 'grid-2' },
      field('Priority', prioritySel, 'Leave unassigned if it has not been decided.'),
      field(
        'Effort',
        effortInput,
        `Required. Working days of effort, at most ${maxEffortDays}. The owner proposes ` +
          'the dates that spend it.',
      )),
    el('div', { class: 'grid-2' },
      field('Start date', startInput,
        'Optional — normally the owner picks this, and the deadline follows from the budget.')),
    el('div', { class: 'grid-2' },
      field('Supporting members', supportBox, 'Ctrl/Cmd-click to select several.'),
      field('Dependencies', dependencyBox, 'Tasks that must land before this one.')),
    field('Next action', nextInput),
    el('div', { class: 'row' }, submit, el('a', { class: 'btn', href: '#/tasks', text: 'Cancel' })),
  );

  mount.replaceChildren(
    pageHead(
      'Create task',
      `Workstream, reviewer and an effort budget are required — at most ${maxEffortDays} working days. ` +
        'Dates are not set here: the owner proposes the days that spend the budget and the reviewer ' +
        'agrees them. Fill both dates only to schedule the task yourself, which agrees it on the spot. ' +
        'Milestone and priority stay optional — left unset they are flagged for clarification rather ' +
        'than guessed.',
    ),
    card(null, form),
  );

  await loadMilestones();
}

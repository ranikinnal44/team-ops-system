/** Screen 6 — Create task. Task Assigner only. */
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
  daysInRange,
  formatDate,
} from '../ui.js';

export async function createTaskView(mount) {
  if (session.user?.role !== 'manager') {
    mount.replaceChildren(
      pageHead('Create task', 'Task Assigners only'),
      card(null, el('div', { class: 'muted', text: 'Only a Task Assigner can create tasks. Ask your Task Assigner to add it.' })),
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
    ...users.map((u) => ({ value: u.id, label: `${u.name} (${u.role})` })),
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
  const dueInput = el('input', { type: 'date', name: 'dueDate', value: '' });
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

  // --- day-by-day outcomes -------------------------------------------------
  // One input per calendar day the task covers. Text already typed is kept
  // against its date, so nudging the end date does not wipe the other days.
  const outcomeByDate = new Map();
  const dayList = el('div', { class: 'day-plan' });
  const dayNote = el('div', { class: 'hint' });
  const dayBox = el(
    'div',
    { class: 'field day-plan-box' },
    el('label', { text: 'What each day delivers' }),
    dayList,
    dayNote,
  );

  function coveredDays() {
    return daysInRange(startInput.value, dueInput.value).slice(0, maxEffortDays);
  }

  function renderDays() {
    // The due date can never precede the start date, nor run past the limit.
    dueInput.min = startInput.value || '';
    dueInput.max = startInput.value ? addDays(startInput.value, maxEffortDays - 1) : '';
    if (startInput.value && dueInput.value && dueInput.value < startInput.value) {
      dueInput.value = startInput.value;
    }
    if (startInput.value && dueInput.value && dueInput.value > dueInput.max) {
      dueInput.value = dueInput.max;
    }

    const days = coveredDays();
    if (days.length <= 1) {
      dayList.replaceChildren();
      dayNote.textContent =
        'A one-day task is a single outcome — the task itself. Extend the end date to plan day by day.';
      dayBox.className = 'field day-plan-box is-single';
      return;
    }

    dayBox.className = 'field day-plan-box';
    dayNote.textContent = `This task covers ${days.length} days. Each one needs its own outcome.`;
    dayList.replaceChildren(
      ...days.map((day, index) => {
        const input = el('input', {
          type: 'text',
          required: true,
          value: outcomeByDate.get(day) ?? '',
          placeholder: `What is finished by the end of day ${index + 1}?`,
          oninput: (event) => outcomeByDate.set(day, event.target.value),
        });
        return el(
          'div',
          { class: 'day-plan-row' },
          el('span', { class: 'day-plan-label', text: `Day ${index + 1} · ${formatDate(day)}` }),
          input,
        );
      }),
    );
  }

  startInput.addEventListener('change', renderDays);
  dueInput.addEventListener('change', renderDays);

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
          const days = coveredDays();
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
            // Omitted unless the Task Assigner is scheduling the task directly;
            // normally the owner proposes these.
            ...(startInput.value && dueInput.value
              ? { startDate: startInput.value, dueDate: dueInput.value }
              : {}),
            // Only sent for a multi-day task; a one-day task is its own outcome.
            dayPlans:
              days.length > 1
                ? days.map((day) => ({ date: day, outcome: (outcomeByDate.get(day) ?? '').trim() }))
                : [],
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
      field('Start date', startInput, 'Optional — leave blank for the owner to propose.'),
      field('End date', dueInput, `Optional. Must fit the ${maxEffortDays} working-day budget.`)),
    dayBox,
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

  renderDays();
  await loadMilestones();
}

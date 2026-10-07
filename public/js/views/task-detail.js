/** Screens 5 & 8 — Task detail, update form, comments and activity history. */
import { api, session } from '../api.js';
import {
  el, card, field, select, statusBadge, priorityTag, flagTag, progressBar, unassignedTag,
  formatDate, formatDateTime, relativeDays, pageHead, errorBox, toast, addDays, STATUS_LABEL,
  clarificationLabel, clarificationField, factId, daysInRange, todayIso,
} from '../ui.js';

const HISTORY_TEXT = {
  created: 'created the task',
  status_changed: 'changed status',
  progress_changed: 'updated progress',
  field_changed: 'changed',
  blocker_added: 'added a blocker',
  blocker_cleared: 'cleared the blocker',
  next_action_set: 'set the next action',
  evidence_linked: 'linked evidence',
  reassigned: 'reassigned the task',
  comment_added: 'commented',
  deadline_change_requested: 'requested a deadline change',
  deadline_change_approved: 'approved a deadline change',
  deadline_change_rejected: 'rejected a deadline change',
};

function historyLine(entry) {
  const parts = [el('span', { class: 'who', text: entry.actorName }), ' ', HISTORY_TEXT[entry.kind] ?? entry.kind];
  if (entry.field && entry.kind === 'field_changed') parts.push(' ', el('strong', { text: entry.field }));
  if (entry.fromValue && entry.toValue) {
    parts.push(': ', el('span', { class: 'muted', text: entry.fromValue }), ' → ', el('strong', { text: entry.toValue }));
  } else if (entry.toValue) {
    parts.push(': ', el('strong', { text: entry.toValue }));
  }
  if (entry.note) parts.push(el('div', { class: 'muted small', text: entry.note }));
  return el(
    'li',
    {},
    el('span', { class: 'when', text: formatDateTime(entry.createdAt) }),
    el('span', { class: 'what' }, parts),
  );
}

/**
 * The day-by-day outcomes, or an honest statement of why there are none.
 *
 * A one-day task has nothing to break down. A multi-day task that is missing
 * outcomes says so here rather than rendering an empty list, because the
 * clarification raised against it points at this row.
 *
 * Imported work routinely spans weeks — longer than anything this system will
 * accept — and listing forty empty days would be noise, not information. Those
 * say what they are and leave it there.
 */
const SCHEDULE_LABEL = {
  unset: 'Not set — the owner proposes them',
  proposed: 'Awaiting review',
  locked: 'Agreed and locked',
};

function scheduleLabel(task) {
  return SCHEDULE_LABEL[task.scheduleState] ?? task.scheduleState;
}

function dayPlanList(task, maxEffortDays) {
  const days = daysInRange(task.startDate, task.dueDate);
  if (days.length === 0) return el('span', { class: 'muted', text: 'No dates set.' });
  if (days.length === 1) {
    return el('span', { class: 'muted', text: 'Single-day task — the task itself is the outcome.' });
  }
  if (days.length > maxEffortDays && (task.dayPlans ?? []).length === 0) {
    return el('span', {
      class: 'muted',
      text:
        `Runs ${days.length} days — longer than the ${maxEffortDays}-day limit for work added ` +
        'here, so it carries no day-by-day plan. Break it up to plan it day by day.',
    });
  }

  const byDate = new Map((task.dayPlans ?? []).map((p) => [p.date, p.outcome]));
  return el(
    'ol',
    { class: 'day-plan-facts' },
    days.map((day, index) =>
      el(
        'li',
        {},
        el('span', { class: 'day-plan-label', text: `Day ${index + 1} · ${formatDate(day)}` }),
        byDate.has(day)
          ? el('span', { text: byDate.get(day) })
          : el('span', { class: 'muted', text: 'No outcome defined yet.' }),
      ),
    ),
  );
}

export async function taskDetailView(mount, params, taskId) {
  const [data, rules, dayLogs] = await Promise.all([
    api.task(taskId),
    api.rules(),
    api.dayLogs(taskId),
  ]);
  const task = data.task;
  const maxEffortDays = rules.maxTaskEffortDays;
  const me = session.user;
  const isManager = me?.role === 'manager';
  const canDrive = isManager || task.ownerId === me?.id || task.reviewerId === me?.id;
  const isOwner = task.ownerId === me?.id;
  const isReviewer = task.reviewerId === me?.id;
  const isDoer = isOwner || (task.supportingMemberIds ?? []).includes(me?.id);
  const locked = task.scheduleState === 'locked';

  const openClarifications = (task.clarifications ?? []).filter((c) => !c.resolved);

  /**
   * A gap is rendered on the field it is about.
   *
   * The task list says "2 gaps"; the answer to "which two?" has to be visible
   * where the values are, not only in a side panel the reader must correlate
   * by hand. `field` maps a clarification code to a row of this panel.
   */
  const gapsOn = (label) => openClarifications.filter((c) => clarificationField(c.code) === label);

  /** Questions about the whole record rather than one field. */
  const recordGaps = openClarifications.filter((c) => clarificationField(c.code) === null);

  // Lookups the gap editors need, fetched the first time one is opened rather
  // than on every task view.
  let usersPromise = null;
  const loadUsers = () => (usersPromise ??= api.users());
  let milestonesPromise = null;
  const loadMilestones = () => (milestonesPromise ??= api.milestones(task.workstreamId));

  /**
   * How to fill each field a gap can sit on: the control to show, and the
   * patch to send. `updateTask` closes the clarification itself once the value
   * lands, so there is no separate "mark as resolved" step to remember.
   */
  const GAP_FIELD = {
    Owner: {
      managerOnly: true,
      action: 'Assign an owner',
      done: 'Owner assigned',
      build: async () =>
        select(
          [
            { value: '', label: '— choose a person —' },
            ...(await loadUsers()).map((u) => ({ value: u.id, label: `${u.name} (${u.role})` })),
          ],
          task.ownerId ?? '',
        ),
      payload: (node) => (node.value ? { ownerId: node.value } : null),
    },
    Priority: {
      managerOnly: true,
      action: 'Set a priority',
      done: 'Priority set',
      build: () =>
        select(
          [
            { value: '', label: '— choose —' },
            { value: 'P0', label: 'P0 — Critical' },
            { value: 'P1', label: 'P1 — High' },
            { value: 'P2', label: 'P2 — Normal' },
            { value: 'P3', label: 'P3 — Low' },
          ],
          task.priority ?? '',
        ),
      payload: (node) => (node.value ? { priority: node.value } : null),
    },
    'Due date': {
      managerOnly: true,
      action: 'Set a deadline',
      done: 'Deadline set',
      build: () => el('input', { type: 'date', value: task.dueDate ?? addDays(todayIso(), 7) }),
      payload: (node) => (node.value ? { dueDate: node.value } : null),
    },
    Status: {
      managerOnly: false,
      action: 'Set the status',
      done: 'Status set',
      build: () =>
        select(
          [
            { value: task.status, label: `${STATUS_LABEL[task.status]} (current)` },
            ...data.availableTransitions.map((t) => ({ value: t, label: `→ ${STATUS_LABEL[t]}` })),
          ],
          task.status,
        ),
      payload: (node) => (node.value !== task.status ? { status: node.value } : null),
    },
    Progress: {
      managerOnly: false,
      action: 'Record progress',
      done: 'Progress recorded',
      build: () =>
        el('input', { type: 'number', min: '0', max: '100', step: '5', value: task.progress ?? 0 }),
      payload: (node) => (node.value === '' ? null : { progress: Number(node.value) }),
    },
    Supporting: {
      managerOnly: true,
      action: 'Confirm who is supporting',
      done: 'Supporting members confirmed',
      build: async () => {
        const box = el('select', { multiple: true, size: '4' });
        for (const user of await loadUsers()) {
          box.append(el('option', {
            value: user.id,
            selected: task.supportingMemberIds?.includes(user.id),
          }, user.name));
        }
        return box;
      },
      payload: (node) => ({ supportingMemberIds: [...node.selectedOptions].map((o) => o.value) }),
    },
    Hierarchy: {
      managerOnly: true,
      action: 'Attach to a milestone',
      done: 'Milestone attached',
      build: async () => {
        const milestones = await loadMilestones();
        if (milestones.length === 0) {
          return el('div', { class: 'hint',
            text: 'This workstream has no milestones yet — add one from the project screen first.' });
        }
        return select(
          [{ value: '', label: '— choose a milestone —' },
           ...milestones.map((m) => ({ value: m.id, label: m.name }))],
          task.milestoneId ?? '',
        );
      },
      payload: (node) => (node.value ? { milestoneId: node.value } : null),
    },
  };

  /**
   * The control that turns a highlighted gap into a filled field in place —
   * without it the marker says what is missing but gives you nowhere to fix it.
   */
  const fixers = new Map();

  function gapFixer(fieldName) {
    const spec = GAP_FIELD[fieldName];
    if (!spec) return null;
    if (!(spec.managerOnly ? isManager : canDrive)) return null;

    const slot = el('div', { class: 'gap-fix' });

    const showButton = () =>
      slot.replaceChildren(
        el('button', { class: 'btn gap-fix-open', type: 'button', text: spec.action, onclick: showForm }),
      );

    async function showForm() {
      slot.replaceChildren(el('span', { class: 'muted small', text: 'Loading…' }));
      let control;
      try {
        control = await spec.build();
      } catch (error) {
        slot.replaceChildren(errorBox(error));
        return;
      }
      const errors = el('div');
      const save = el('button', { class: 'primary', type: 'submit', text: 'Save' });
      slot.replaceChildren(
        el(
          'form',
          {
            class: 'gap-form',
            onsubmit: async (event) => {
              event.preventDefault();
              const payload = spec.payload(control);
              if (!payload) {
                errors.replaceChildren(errorBox({ message: 'Choose a value first.' }));
                return;
              }
              save.disabled = true;
              try {
                await api.updateTask(task.id, payload);
              } catch (error) {
                errors.replaceChildren(errorBox(error));
                save.disabled = false;
                return;
              }
              toast(spec.done);
              // The value is stored by this point. A refresh that fails must
              // not look like a save that failed, or the next thing you do is
              // type it in again.
              try {
                await taskDetailView(mount, params, taskId);
              } catch {
                toast(`${spec.done}. Reload the page to see it.`, true);
                save.disabled = false;
              }
            },
          },
          errors,
          control,
          el('div', { class: 'row' }, save,
            el('button', { type: 'button', text: 'Cancel', onclick: showButton })),
        ),
      );
    }

    fixers.set(fieldName, showForm);
    showButton();
    return slot;
  }

  const gapNote = (clarification) =>
    el(
      'div',
      { class: 'gap-note' },
      el('span', { class: 'flag NEEDS_INFO', text: 'NEEDS INFO' }),
      el('span', { class: 'gap-why', text: clarificationLabel(clarification.code) }),
      el('div', { class: 'gap-detail', text: clarification.detail }),
      gapFixer(clarificationField(clarification.code)),
    );

  /** One dt/dd pair, carrying whatever gaps belong to that field. */
  function fact(label, ...content) {
    const gaps = gapsOn(label);
    const marked = gaps.length > 0 ? ' has-gap' : '';
    return [
      el('dt', { id: factId(label), class: `fact-label${marked}` }, label,
        gaps.length ? el('span', { class: 'sr-only', text: ' — needs information' }) : null),
      el('dd', { class: `fact-value${marked}` }, ...content, ...gaps.map(gapNote)),
    ];
  }

  // --- facts panel --------------------------------------------------------
  const facts = el(
    'dl',
    { class: 'facts' },
    fact('Owner', task.ownerName ? task.ownerName : unassignedTag()),
    fact('Reviewer', task.reviewerName ?? '—'),
    fact('Supporting', task.supportingMemberNames.join(', ') || '—'),
    fact('Status', statusBadge(task.status)),
    fact('Priority', priorityTag(task.priority),
      task.priority === null ? el('span', { class: 'small muted', text: ' not assigned' }) : null),
    fact('Progress', el('div', { class: 'row' },
      el('span', { class: 'small', text: task.progress === null ? 'unknown' : `${task.progress}%` }),
      el('div', { style: 'flex:1' }, progressBar(task.progress)))),
    task.progressNote ? fact('Reported as', task.progressNote) : null,
    fact('Start date', task.startDate ? formatDate(task.startDate) : 'Not set'),
    fact('Due date',
      task.dueDate === null
        ? el('span', { class: 'due none', text: 'No deadline agreed' })
        : formatDate(task.dueDate),
      task.status !== 'completed' && task.daysUntilDue !== null
        ? el('span', { class: 'muted small', text: ` · ${relativeDays(task.daysUntilDue)}` })
        : null,
      task.originalDueDate && task.dueDate !== task.originalDueDate
        ? el('div', { class: 'small muted', text: `Originally committed: ${formatDate(task.originalDueDate)}` })
        : null),
    fact(
      'Effort budget',
      task.effortDays === null
        ? el('span', { class: 'muted', text: 'not set' })
        : `${task.effortDays} working day${task.effortDays === 1 ? '' : 's'}`,
      task.originalEffortDays !== null && task.originalEffortDays !== task.effortDays
        ? el('div', {
            class: 'small muted',
            text: `Originally estimated: ${task.originalEffortDays} working days.`,
          })
        : null,
    ),
    fact(
      'Dates',
      el('span', { class: `badge schedule-${task.scheduleState}`, text: scheduleLabel(task) }),
      task.scheduleReviewNote
        ? el('div', { class: 'small muted', text: task.scheduleReviewNote })
        : null,
    ),
    fact('Day plan', dayPlanList(task, maxEffortDays)),
    task.sourceTimeline
      ? fact('Planned window', task.sourceTimeline,
          el('div', { class: 'small muted', text: 'Relative week range from the build timeline.' }))
      : null,
    task.sourceDate
      ? fact('Source log date', formatDate(task.sourceDate),
          el('div', { class: 'small muted', text: 'Date the task was logged — not a deadline.' }))
      : null,
    fact('Hierarchy',
      // The plan, opened on this task's own milestone where it has one.
      el('a', {
        href: task.milestoneId
          ? `#/milestones?open=${task.milestoneId}`
          : '#/milestones?groupBy=workstream',
        text: task.projectName,
      }),
      ` › ${task.workstreamName}`,
      task.milestoneName
        ? ` › ${task.milestoneName}${task.deliverableName ? ` › ${task.deliverableName}` : ''}`
        : el('span', { class: 'muted', text: ' › no milestone assigned' })),
    fact('Evidence', task.evidenceUrl
      ? el('a', { href: task.evidenceUrl, target: '_blank', rel: 'noreferrer noopener', text: task.evidenceUrl })
      : el('span', { class: 'muted', text: 'Not linked' })),
    fact('Dependencies', task.dependencyRefs.length
      ? el('div', { class: 'row' }, task.dependencyRefs.map((d) =>
          el('a', { href: `#/tasks/${d.id}`, title: d.title }, el('span', { class: 'ref', text: d.ref }), ' ', statusBadge(d.status))))
      : el('span', { class: 'muted', text: 'None' })),
    fact('Reviewer note', task.reviewNote ?? '—'),
    fact('Created', formatDateTime(task.createdAt),
      task.origin === 'import'
        ? el('div', { class: 'small muted', text: 'Imported record — not created in this system.' })
        : null),
    fact('Last updated', formatDateTime(task.lastUpdatedAt)),
  );

  const sourceBox =
    task.origin === 'import'
      ? el(
          'div',
          { class: 'source-box' },
          el('div', { class: 'label', text: 'Imported record — values exactly as supplied' }),
          el(
            'dl',
            {},
            el('dt', { text: 'Source row' }),
            el('dd', { text: task.sourceRef ?? '—' }),
            el('dt', { text: 'Source owner' }),
            el('dd', { text: task.sourceOwnerLabel ?? '—' }),
            el('dt', { text: 'Source status' }),
            el('dd', { text: task.sourceStatus === null ? '(blank)' : task.sourceStatus }),
            el('dt', { text: 'Source date' }),
            el('dd', { text: task.sourceDate ?? '—' }),
          ),
        )
      : null;

  /** Scroll a facts row into view and flash it, so "which field?" is answered. */
  function revealField(label) {
    const dt = document.getElementById(factId(label));
    if (!dt) return;
    dt.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    const row = [dt, dt.nextSibling].filter(Boolean);
    for (const node of row) node.classList?.add('gap-flash');
    setTimeout(() => {
      for (const node of row) node.classList?.remove('gap-flash');
    }, 1800);
  }

  const gapItem = (c) => {
    const fieldName = clarificationField(c.code);
    return el(
      'div',
      { class: 'clar-item' },
      el(
        'div',
        { class: 'head' },
        el('strong', { text: clarificationLabel(c.code) }),
        fieldName ? el('span', { class: 'gap-field', text: fieldName }) : null,
      ),
      el('div', { class: 'detail', text: c.detail }),
      el(
        'div',
        { class: 'row', style: 'margin-top:7px' },
        fieldName
          ? el('button', {
              class: 'subtle',
              type: 'button',
              text: fixers.has(fieldName) ? `Fix ${fieldName} ↓` : `Show me ${fieldName} ↓`,
              title: fixers.has(fieldName)
                ? `Jump to ${fieldName} in Details and open it for editing`
                : `Highlight the ${fieldName} row in Details`,
              onclick: () => {
                revealField(fieldName);
                fixers.get(fieldName)?.();
              },
            })
          : null,
        isManager
          ? el('button', {
              class: 'subtle',
              type: 'button',
              text: 'Mark as resolved',
              onclick: async (event) => {
                event.target.disabled = true;
                try {
                  await api.resolveClarification(c.id);
                  toast('Marked resolved');
                  taskDetailView(mount, params, taskId);
                } catch (error) {
                  toast(error.message, true);
                  event.target.disabled = false;
                }
              },
            })
          : null,
      ),
    );
  };

  const fieldGaps = openClarifications.filter((c) => clarificationField(c.code) !== null);

  // Titled "Gaps" to match the column in the task list the reader arrived from.
  const clarificationBox = openClarifications.length
    ? card(
        `Gaps (${openClarifications.length})`,
        el(
          'div',
          {},
          el('div', { class: 'muted small', style: 'margin-bottom:10px',
            text: 'The source data did not establish these — nothing has been guessed. ' +
              'Each one is also marked on the field it affects, in Details.' }),
          ...fieldGaps.map(gapItem),
          recordGaps.length
            ? el('div', { class: 'gap-group', text: 'About the record as a whole' })
            : null,
          ...recordGaps.map(gapItem),
        ),
      )
    : null;
  clarificationBox?.setAttribute('id', 'gaps-card');

  const callouts = el('div', {});
  if (task.blocker) {
    callouts.append(el('div', { class: 'callout block' }, el('div', { class: 'label', text: 'Blocked by' }), task.blocker));
  }
  if (task.nextAction) {
    callouts.append(el('div', { class: 'callout next' }, el('div', { class: 'label', text: 'Next action' }), task.nextAction));
  }

  // --- update form --------------------------------------------------------
  const errors = el('div');
  const statusOptions = [
    { value: task.status, label: `${STATUS_LABEL[task.status]} (current)` },
    ...data.availableTransitions.map((s) => ({ value: s, label: `→ ${STATUS_LABEL[s]}` })),
  ];
  const statusSel = select(statusOptions, task.status);
  const progressInput = el('input', { type: 'number', min: '0', max: '100', step: '5', value: task.progress });
  const blockerInput = el('textarea', { placeholder: 'What is stopping this task?' });
  blockerInput.value = task.blocker ?? '';
  const nextInput = el('input', { type: 'text', placeholder: 'The single next step', value: task.nextAction ?? '' });
  const evidenceInput = el('input', { type: 'url', placeholder: 'https://…', value: task.evidenceUrl ?? '' });
  const commentInput = el('textarea', { placeholder: 'Add a note to the activity log (optional)' });

  const updateButton = el('button', { class: 'primary', type: 'submit', text: 'Save update' });

  const updateForm = el(
    'form',
    {
      onsubmit: async (event) => {
        event.preventDefault();
        errors.replaceChildren();
        updateButton.disabled = true;
        const payload = {};
        if (statusSel.value !== task.status) payload.status = statusSel.value;
        if (Number(progressInput.value) !== task.progress) payload.progress = Number(progressInput.value);
        const blocker = blockerInput.value.trim();
        if (blocker !== (task.blocker ?? '')) payload.blocker = blocker === '' ? null : blocker;
        const next = nextInput.value.trim();
        if (next !== (task.nextAction ?? '')) payload.nextAction = next === '' ? null : next;
        const evidence = evidenceInput.value.trim();
        if (evidence !== (task.evidenceUrl ?? '')) payload.evidenceUrl = evidence === '' ? null : evidence;
        if (commentInput.value.trim()) payload.comment = commentInput.value.trim();

        if (Object.keys(payload).length === 0) {
          errors.replaceChildren(errorBox({ message: 'Nothing has changed yet.' }));
          updateButton.disabled = false;
          return;
        }
        try {
          await api.updateTask(task.id, payload);
          toast('Task updated');
          taskDetailView(mount, params, taskId);
        } catch (error) {
          errors.replaceChildren(errorBox(error));
          updateButton.disabled = false;
        }
      },
    },
    errors,
    el('div', { class: 'grid-2' },
      field('Status', statusSel),
      field('% Progress', progressInput)),
    field('Blocker', blockerInput, 'Required while the status is Blocked.'),
    field('Next action', nextInput),
    field('Output / evidence link', evidenceInput),
    field('Comment', commentInput),
    el('div', { class: 'row' }, updateButton),
  );

  // --- schedule ------------------------------------------------------------
  // A manager edits the window and the day outcomes together, because the two
  // are one decision: stretching a task to three days creates two more days
  // that have to say what they deliver.
  const pendingRequest = data.deadlineRequests.find((r) => r.status === 'pending');
  const noDeadlineYet = task.dueDate === null;

  const storedDays = daysInRange(task.startDate, task.dueDate).length;
  const overLimit = storedDays > maxEffortDays;
  const scheduleStart = el('input', { type: 'date', value: task.startDate ?? todayIso() });
  const scheduleEnd = el('input', {
    type: 'date',
    value: task.dueDate ?? task.startDate ?? todayIso(),
  });
  const outcomeByDate = new Map((task.dayPlans ?? []).map((p) => [p.date, p.outcome]));
  const scheduleDays = el('div', { class: 'day-plan' });
  const scheduleNote = el('div', { class: 'hint' });

  const coveredDays = () =>
    daysInRange(scheduleStart.value, scheduleEnd.value).slice(0, maxEffortDays);

  function renderScheduleDays() {
    scheduleEnd.min = scheduleStart.value || '';
    scheduleEnd.max = scheduleStart.value ? addDays(scheduleStart.value, maxEffortDays - 1) : '';
    if (scheduleEnd.value && scheduleEnd.min && scheduleEnd.value < scheduleEnd.min) {
      scheduleEnd.value = scheduleEnd.min;
    }
    if (scheduleEnd.value && scheduleEnd.max && scheduleEnd.value > scheduleEnd.max) {
      scheduleEnd.value = scheduleEnd.max;
    }

    const days = coveredDays();
    if (days.length <= 1) {
      scheduleDays.replaceChildren();
      scheduleNote.textContent = 'A one-day task is a single outcome — the task itself.';
      return;
    }
    scheduleNote.textContent = `${days.length} days, each needing its own outcome.`;
    scheduleDays.replaceChildren(
      ...days.map((day, index) =>
        el(
          'div',
          { class: 'day-plan-row' },
          el('span', { class: 'day-plan-label', text: `Day ${index + 1} · ${formatDate(day)}` }),
          el('input', {
            type: 'text',
            value: outcomeByDate.get(day) ?? '',
            placeholder: `What is finished by the end of day ${index + 1}?`,
            oninput: (event) => outcomeByDate.set(day, event.target.value),
          }),
        ),
      ),
    );
  }
  scheduleStart.addEventListener('change', renderScheduleDays);
  scheduleEnd.addEventListener('change', renderScheduleDays);
  renderScheduleDays();

  const scheduleErrors = el('div');
  const scheduleForm = el(
    'form',
    {
      onsubmit: async (event) => {
        event.preventDefault();
        scheduleErrors.replaceChildren();
        const days = coveredDays();
        try {
          await api.proposeSchedule(task.id, {
            startDate: scheduleStart.value,
            dueDate: scheduleEnd.value,
            dayPlans:
              days.length > 1
                ? days.map((day) => ({ date: day, outcome: (outcomeByDate.get(day) ?? '').trim() }))
                : [],
          });
          // A manager or the reviewer is the person who would approve this
          // anyway, so their own submission is agreed in the same action
          // rather than parked in a queue addressed to themselves.
          if (isManager || isReviewer) {
            await api.decideSchedule(task.id, { approve: true });
            toast('Dates agreed');
          } else {
            toast('Dates sent for review');
          }
          taskDetailView(mount, params, taskId);
        } catch (error) {
          scheduleErrors.replaceChildren(errorBox(error));
        }
      },
    },
    scheduleErrors,
    // An imported task can already run longer than the limit. Saying so beats
    // quietly shortening the dates under the reader.
    overLimit
      ? el('div', { class: 'hint', style: 'margin-bottom:10px' },
          `This task runs ${storedDays} days, from before it was tracked here. Saving will ` +
            `shorten it to at most ${maxEffortDays} days; split off the rest as its own task.`)
      : null,
    el('div', { class: 'grid-2' },
      field('Start date', scheduleStart),
      field('End date', scheduleEnd, `At most ${maxEffortDays} days.`)),
    el('div', { class: 'field' },
      el('label', { text: 'What each day delivers' }), scheduleDays, scheduleNote),
    el('div', { class: 'row' },
      el('button', { class: 'primary', type: 'submit', text: noDeadlineYet ? 'Set schedule' : 'Update schedule' })),
  );

  // --- deadline change request --------------------------------------------
  const deadlineInput = el('input', {
    type: 'date',
    value: task.dueDate ? addDays(task.dueDate, 1) : addDays(todayIso(), 1),
    ...(task.startDate
      ? { min: task.startDate, max: addDays(task.startDate, maxEffortDays - 1) }
      : {}),
  });
  const reasonInput = el('input', { type: 'text', placeholder: 'Why is the date no longer reachable?' });

  const deadlineBody = isManager
    ? el(
        'div',
        {},
        pendingRequest
          ? el(
              'div',
              { class: 'pending-request' },
              el('div', { class: 'small muted', text: `Requested by ${pendingRequest.requestedByName}: ${formatDate(pendingRequest.currentDueDate)} → ${formatDate(pendingRequest.requestedDueDate)}` }),
              el('div', { class: 'small', style: 'margin:6px 0', text: pendingRequest.reason }),
              el('div', { class: 'row' },
                el('button', { class: 'primary', text: 'Approve', onclick: async () => {
                  try { await api.decideDeadline(pendingRequest.id, true, null); toast('Deadline updated'); taskDetailView(mount, params, taskId); }
                  catch (error) { toast(error.message, true); }
                } }),
                el('button', { class: 'danger', text: 'Reject', onclick: async () => {
                  try { await api.decideDeadline(pendingRequest.id, false, null); toast('Request rejected'); taskDetailView(mount, params, taskId); }
                  catch (error) { toast(error.message, true); }
                } })),
              el('div', { class: 'hint', text: 'Approving moves the end date. Any day it adds will need an outcome.' }),
            )
          : null,
        scheduleForm,
      )
    : noDeadlineYet
    ? el('div', { class: 'muted small',
        text: 'This task has no deadline yet. A manager needs to set one before a change can be requested.' })
    : pendingRequest
    ? el(
        'div',
        {},
        el('div', { class: 'small muted', text: `Requested by ${pendingRequest.requestedByName}: ${formatDate(pendingRequest.currentDueDate)} → ${formatDate(pendingRequest.requestedDueDate)}` }),
        el('div', { class: 'small', style: 'margin:6px 0', text: pendingRequest.reason }),
        el('div', { class: 'small muted', text: 'Awaiting a manager decision.' }),
      )
    : el(
        'form',
        {
          onsubmit: async (event) => {
            event.preventDefault();
            try {
              await api.requestDeadline(task.id, {
                requestedDueDate: deadlineInput.value,
                reason: reasonInput.value.trim(),
              });
              toast('Deadline change requested');
              taskDetailView(mount, params, taskId);
            } catch (error) {
              toast(error.message, true);
            }
          },
        },
        field('New end date', deadlineInput,
          task.startDate
            ? `A task runs for at most ${maxEffortDays} days, so this cannot go past ${formatDate(addDays(task.startDate, maxEffortDays - 1))}.`
            : null),
        field('Reason', reasonInput),
        el('button', { type: 'submit', text: 'Request deadline change' }),
      );

  // --- comments -----------------------------------------------------------
  const newComment = el('textarea', { placeholder: 'Write a comment…' });
  const commentsBody = el(
    'div',
    {},
    data.comments.length
      ? data.comments.map((c) =>
          el('div', { class: 'comment' },
            el('div', { class: 'head' },
              el('span', { class: 'author', text: c.authorName }),
              el('span', { class: 'when', text: formatDateTime(c.createdAt) })),
            el('div', { class: 'body', text: c.body })))
      : el('div', { class: 'muted small', text: 'No comments yet.' }),
    el(
      'form',
      {
        style: 'margin-top:12px',
        onsubmit: async (event) => {
          event.preventDefault();
          if (!newComment.value.trim()) return;
          try {
            await api.addComment(task.id, newComment.value.trim());
            toast('Comment added');
            taskDetailView(mount, params, taskId);
          } catch (error) {
            toast(error.message, true);
          }
        },
      },
      newComment,
      el('div', { class: 'row', style: 'margin-top:8px' }, el('button', { type: 'submit', text: 'Add comment' })),
    ),
  );

  const history = card(
    'Activity history',
    el('ul', { class: 'timeline' }, data.history.map(historyLine)),
  );

  // --- the reviewer agrees the proposed dates ------------------------------
  const scheduleDecisionNote = el('input', {
    type: 'text',
    placeholder: 'Optional note — required in spirit when sending back',
  });
  const scheduleDecisionBody =
    task.scheduleState !== 'proposed'
      ? null
      : isReviewer || isManager
        ? el(
            'div',
            {},
            el('div', { class: 'small' },
              `${task.startDate ? formatDate(task.startDate) : '—'} → ` +
              `${task.dueDate ? formatDate(task.dueDate) : '—'}`),
            el('div', { class: 'small muted', style: 'margin:6px 0' },
              'Nothing can start until these are agreed, so this is somebody waiting.'),
            field('Note', scheduleDecisionNote),
            el('div', { class: 'row' },
              el('button', { class: 'primary', text: 'Agree dates', onclick: async () => {
                try {
                  await api.decideSchedule(task.id, { approve: true, note: scheduleDecisionNote.value.trim() || null });
                  toast('Dates agreed');
                  taskDetailView(mount, params, taskId);
                } catch (error) { toast(error.message, true); }
              } }),
              el('button', { class: 'danger', text: 'Send back', onclick: async () => {
                try {
                  await api.decideSchedule(task.id, { approve: false, note: scheduleDecisionNote.value.trim() || null });
                  toast('Sent back to the owner');
                  taskDetailView(mount, params, taskId);
                } catch (error) { toast(error.message, true); }
              } })),
            el('div', { class: 'hint' },
              'Sending back keeps the dates as a draft for the owner to revise.'),
          )
        : el('div', { class: 'small muted' },
            `Waiting on ${task.reviewerName ?? 'the reviewer'} to agree these dates.`);

  // --- the daily outcome log ----------------------------------------------
  const dayLogOutcome = el('input', { type: 'text', placeholder: 'What did today produce?' });
  const dayLogProgress = el('input', { type: 'number', min: '0', max: '100', placeholder: '%' });
  const dayLogErrors = el('div');
  const canLogToday = isDoer && (task.status === 'in_progress' || task.status === 'blocked');

  const dayLogBody = el(
    'div',
    {},
    dayLogs.length === 0
      ? el('div', { class: 'small muted', text: 'Nothing reported yet.' })
      : el('div', { class: 'day-log-list' },
          ...dayLogs.map((log) =>
            el('div', { class: 'day-log-row' },
              el('div', { class: 'small muted' },
                `${formatDate(log.logDate)} · ${log.authorName}` +
                  (log.progress === null ? '' : ` · ${log.progress}%`)),
              el('div', { class: 'small', text: log.outcome }),
              log.blocker ? el('div', { class: 'small flag BLOCKED', text: log.blocker }) : null))),
    dayLogErrors,
    canLogToday
      ? el('form', { style: 'margin-top:10px', onsubmit: async (event) => {
          event.preventDefault();
          try {
            await api.recordDayOutcome(task.id, {
              outcome: dayLogOutcome.value.trim(),
              ...(dayLogProgress.value === '' ? {} : { progress: Number(dayLogProgress.value) }),
            });
            toast('Daily outcome recorded');
            taskDetailView(mount, params, taskId);
          } catch (error) { dayLogErrors.replaceChildren(errorBox(error)); }
        } },
        el('div', { class: 'grid-2' },
          field('Today', dayLogOutcome),
          field('Progress', dayLogProgress, 'Optional — becomes the task progress.')),
        el('div', { class: 'row' },
          el('button', { class: 'primary', type: 'submit', text: 'Record outcome' })))
      : el('div', { class: 'hint' },
          isDoer
            ? 'A daily outcome is recorded while the task is in progress or blocked.'
            : 'Only the owner and supporting members report on a day\u2019s work.'),
  );

  mount.replaceChildren(
    pageHead(
      task.title,
      // A missing milestone is a legitimate state here, so it must not read "null".
      `${task.ref} · ${[task.projectName, task.workstreamName, task.milestoneName]
        .filter(Boolean)
        .join(' › ')}`,
      el('a', { class: 'btn', href: '#/tasks', text: '← All tasks' }),
    ),
    el(
      'div',
      { class: 'row', style: 'margin-bottom:14px' },
      task.exceptions.map(flagTag),
      // The count the task list showed, repeated here with a way into the list.
      openClarifications.length
        ? el('button', {
            class: 'flag NEEDS_INFO gap-jump',
            type: 'button',
            title: 'Jump to the unanswered questions on this task',
            text: `${openClarifications.length} GAP${openClarifications.length === 1 ? '' : 'S'}`,
            onclick: () => {
              const first = fieldGaps[0] ?? recordGaps[0];
              const target = first && clarificationField(first.code);
              if (target) revealField(target);
              else document.getElementById('gaps-card')?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
            },
          })
        : null,
    ),
    el(
      'div',
      { class: 'detail-grid' },
      el(
        'div',
        {},
        card('Details', el('div', {}, callouts, facts, sourceBox)),
        canDrive ? card('Update this task', updateForm) : null,
        card('Daily outcomes', dayLogBody),
        card('Comments', commentsBody),
        history,
      ),
      el(
        'div',
        {},
        clarificationBox,
        scheduleDecisionBody ? card('Dates awaiting review', scheduleDecisionBody) : null,
        card(isManager ? 'Schedule' : 'Deadline', deadlineBody),
      ),
    ),
  );
}

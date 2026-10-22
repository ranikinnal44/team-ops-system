/**
 * Plan — where the project's structure gets built and corrected.
 *
 * Everything before this screen assumed the hierarchy already existed, because
 * the first two datasets arrived by import. Building one by hand needs its own
 * place: create the project, then workstreams, then milestones under them, then
 * the deliverables each milestone carries.
 *
 * Deletes refuse while anything hangs off the node. The server enforces that;
 * this screen just reports the reason.
 */
import { api, session } from '../api.js';
import { isTaskAssigner } from '../access.js';
import { el, card, field, pageHead, emptyState, errorBox, toast, formatDate, loading } from '../ui.js';

const CODE_HINT = '2–8 letters or digits, used in task references like AD-MEC-001.';

/**
 * Which workstreams are open. Kept outside `render()` because every save
 * rebuilds the screen, and folding away the workstream someone is working in
 * would undo their place each time they add a milestone.
 */
const expandedWorkstreams = new Set();
/** Workstreams already rendered once, so an empty one opens itself only the first time. */
const seenWorkstreams = new Set();

/** A small inline form that collapses until it is needed. */
function inlineForm({ label, fields, submitText, onSubmit, open = false, savedMessage = null }) {
  const errors = el('div');
  const body = el('div', { class: 'inline-form-body' });
  const submit = el('button', { class: 'primary', type: 'submit', text: submitText });
  const form = el(
    'form',
    {
      onsubmit: async (event) => {
        event.preventDefault();
        errors.replaceChildren();
        submit.disabled = true;
        try {
          await onSubmit();
          toast(savedMessage ?? `${submitText.replace(/^Add /, '')} saved`);
        } catch (error) {
          errors.replaceChildren(errorBox(error));
          submit.disabled = false;
        }
      },
    },
    errors,
    ...fields,
    el('div', { class: 'row' }, submit),
  );
  body.append(form);

  let shown = open;
  const toggle = el('button', { class: 'subtle', text: shown ? 'Cancel' : label });
  const wrap = el('div', { class: 'inline-form' }, toggle, shown ? body : null);
  toggle.addEventListener('click', () => {
    shown = !shown;
    toggle.textContent = shown ? 'Cancel' : label;
    if (shown) wrap.append(body);
    else body.remove();
  });
  return wrap;
}

const confirmDelete = (what, run) => async () => {
  if (!globalThis.confirm?.(`Delete ${what}? This cannot be undone.`)) return;
  try {
    await run();
    toast(`${what} deleted`);
  } catch (error) {
    toast(error.message, true);
  }
};

export async function planView(mount) {
  const isManager = isTaskAssigner(session.user?.role);
  if (!isManager) {
    mount.replaceChildren(
      pageHead('Plan', 'Task Assigners only'),
      emptyState('Only a Task Assigner can change the plan', 'Ask your Task Assigner to add or edit structure.'),
    );
    return;
  }

  const render = async () => {
    mount.replaceChildren(pageHead('Plan', 'Loading…'), loading());

    const projects = await api.projects();

    // --- nothing exists yet ------------------------------------------------
    if (projects.length === 0) {
      const name = el('input', { type: 'text', placeholder: 'AutoDock', required: true });
      const code = el('input', { type: 'text', placeholder: 'AD', maxlength: '8' });
      const description = el('textarea', { placeholder: 'What is this project for?' });
      mount.replaceChildren(
        pageHead('Plan', 'Start by creating the project everything else hangs off'),
        card(
          'Create the project',
          el(
            'form',
            {
              onsubmit: async (event) => {
                event.preventDefault();
                try {
                  await api.createProject({
                    name: name.value.trim(),
                    code: code.value.trim() || undefined,
                    description: description.value.trim() || null,
                  });
                  toast('Project created');
                  await render();
                } catch (error) {
                  toast(error.message, true);
                }
              },
            },
            field('Project name', name),
            field('Short code', code, `${CODE_HINT} Leave blank to derive it from the name.`),
            field('Description', description),
            el('button', { class: 'primary', type: 'submit', text: 'Create project' }),
          ),
        ),
      );
      return;
    }

    const project = projects[0];
    const tree = await api.project(project.id);
    const totalTasks = tree.totals.total;

    // --- workstream creation ----------------------------------------------
    const wsName = el('input', { type: 'text', placeholder: 'Mechanical Design', required: true });
    const wsCode = el('input', { type: 'text', placeholder: 'MEC', maxlength: '8' });
    const addWorkstream = inlineForm({
      label: '+ Add workstream',
      submitText: 'Add workstream',
      open: tree.workstreams.length === 0,
      fields: [
        field('Name', wsName),
        field('Short code', wsCode, `${CODE_HINT} Leave blank to derive it.`),
      ],
      onSubmit: async () => {
        await api.createWorkstream({
          projectId: project.id,
          name: wsName.value.trim(),
          code: wsCode.value.trim() || undefined,
        });
        await render();
      },
    });

    const sections = tree.workstreams.map((ws) => workstreamCard(ws, render));

    mount.replaceChildren(
      pageHead(
        project.name,
        `${tree.workstreams.length} workstream${tree.workstreams.length === 1 ? '' : 's'} · ` +
          `${totalTasks} task${totalTasks === 1 ? '' : 's'}`,
        el('a', { class: 'btn', href: '#/tasks/new', text: '+ New task' }),
      ),
      projectCard(project, render),
      el('div', { style: 'height:16px' }),
      tree.workstreams.length === 0
        ? card(
            'Workstreams',
            el(
              'div',
              {},
              el('div', { class: 'muted small', style: 'margin-bottom:12px',
                text: 'A workstream is a strand of the project — Mechanical Design, Procurement, Testing. Milestones and tasks sit inside one.' }),
              addWorkstream,
            ),
          )
        : el('div', {}, ...sections, el('div', { style: 'margin-top:14px' }, addWorkstream)),
    );
  };

  await render();
}

function projectCard(project, render) {
  const name = el('input', { type: 'text', value: project.name });
  const code = el('input', { type: 'text', value: project.code, maxlength: '8' });
  const description = el('textarea');
  description.value = project.description ?? '';

  // Renaming a project is rare next to building the structure under it, so the
  // form stays folded away. Saving re-renders, which closes it again.
  const editForm = inlineForm({
    label: 'Edit project',
    submitText: 'Save',
    savedMessage: 'Project updated',
    fields: [
      el('div', { class: 'grid-2' }, field('Name', name), field('Short code', code, CODE_HINT)),
      field('Description', description),
    ],
    onSubmit: async () => {
      await api.updateProject(project.id, {
        name: name.value.trim(),
        code: code.value.trim(),
        description: description.value.trim() || null,
      });
      await render();
    },
  });

  return card(
    'Project',
    el(
      'div',
      {},
      el(
        'div',
        { class: 'plan-head' },
        el('span', { class: 'ref', text: project.code }),
        el('strong', { text: project.name }),
      ),
      project.description
        ? el('div', { class: 'small muted', style: 'margin:4px 0', text: project.description })
        : null,
      editForm,
    ),
  );
}

function workstreamCard(ws, render) {
  const w = ws.workstream;
  const taskCount = ws.totals.total;

  const msName = el('input', { type: 'text', placeholder: 'Final Design Validation', required: true });
  const msLabel = el('input', { type: 'text', placeholder: 'W1 - W2', maxlength: '40' });
  const addMilestone = inlineForm({
    label: '+ Add milestone',
    submitText: 'Add milestone',
    open: ws.milestones.length === 0,
    fields: [
      field('Name', msName),
      field('Schedule', msLabel,
        'Optional, and in the plan\'s own words — "W1 - W2", "Q1". A milestone carries no ' +
        'dates: those are agreed on each task, by its owner and reviewer.'),
    ],
    onSubmit: async () => {
      await api.createMilestone({
        workstreamId: w.id,
        name: msName.value.trim(),
        timelineLabel: msLabel.value.trim() || null,
      });
      await render();
    },
  });

  const body = el(
    'div',
    {},
    ws.milestones.length === 0
      ? el('div', { class: 'muted small', style: 'margin:10px 0',
          text: 'No milestones yet. A milestone is a dated outcome; tasks hang off it.' })
      : el('div', {}, ...ws.milestones.map((ms) => milestoneRow(ms, render))),
    addMilestone,
  );

  // An empty workstream opens itself the first time it is seen — the prompt and
  // the add form are the only reason to look at one. After that the last choice
  // stands, including a deliberate collapse.
  if (!seenWorkstreams.has(w.id)) {
    seenWorkstreams.add(w.id);
    if (ws.milestones.length === 0) expandedWorkstreams.add(w.id);
  }
  let shown = expandedWorkstreams.has(w.id);

  const caret = el('button', {
    class: 'subtle',
    text: shown ? '▾' : '▸',
    title: shown ? 'Collapse' : 'Expand',
  });

  const header = el(
    'div',
    { class: 'plan-head', style: 'cursor:pointer' },
    caret,
    el('span', { class: 'ref', text: w.code }),
    el('strong', { text: w.name }),
    el('span', { class: 'small muted', text: `${ws.milestones.length} milestone(s) · ${taskCount} task(s)` }),
    el('span', { class: 'spacer' }),
    el('button', {
      class: 'subtle danger-text',
      text: 'Delete',
      onclick: confirmDelete(`workstream "${w.name}"`, async () => {
        await api.deleteWorkstream(w.id);
        await render();
      }),
    }),
  );

  const wrap = el('div', {}, header, shown ? body : null);

  const setShown = (next) => {
    shown = next;
    caret.textContent = shown ? '▾' : '▸';
    caret.title = shown ? 'Collapse' : 'Expand';
    if (shown) {
      expandedWorkstreams.add(w.id);
      wrap.append(body);
    } else {
      expandedWorkstreams.delete(w.id);
      body.remove();
    }
  };

  caret.addEventListener('click', () => setShown(!shown));
  // The name is the obvious thing to click, so it toggles too. The buttons in
  // the header keep their own handlers.
  header.addEventListener('click', (event) => {
    if (event.target?.closest?.('button')) return;
    setShown(!shown);
  });

  return card(null, wrap);
}

function milestoneRow(ms, render) {
  const m = ms.milestone;

  const mName = el('input', { type: 'text', value: m.name, required: true });
  const mLabel = el('input', {
    type: 'text',
    value: m.timelineLabel ?? '',
    placeholder: 'W1 - W2',
    maxlength: '40',
  });
  const editMilestone = inlineForm({
    label: 'Edit',
    submitText: 'Save',
    savedMessage: 'Milestone updated',
    fields: [
      field('Name', mName),
      field('Schedule', mLabel,
        'Optional, and in the plan\'s own words. A milestone carries no dates: those are ' +
        'agreed on each task, between its owner and its reviewer.'),
    ],
    onSubmit: async () => {
      await api.updateMilestone(m.id, {
        name: mName.value.trim(),
        timelineLabel: mLabel.value.trim() || null,
      });
      await render();
    },
  });

  const dName = el('input', { type: 'text', placeholder: 'Signed-off drawing pack', required: true });
  const dDue = el('input', { type: 'date' });
  const addDeliverable = inlineForm({
    label: '+ Add deliverable',
    submitText: 'Add deliverable',
    fields: [field('Name', dName), field('Due', dDue, 'Optional — only once a date is agreed.')],
    onSubmit: async () => {
      await api.createDeliverable({
        milestoneId: m.id,
        name: dName.value.trim(),
        dueDate: dDue.value || null,
      });
      await render();
    },
  });

  return el(
    'div',
    { class: 'plan-milestone' },
    el(
      'div',
      { class: 'plan-head' },
      el('strong', { text: m.name }),
      m.timelineLabel
        ? el('span', { class: 'timeline-chip', text: m.timelineLabel })
        : el('span', { class: 'small muted', text: 'dates are set per task' }),
      el('span', { class: 'small muted', text: `${ms.totals.total} task(s)` }),
      el('span', { class: 'spacer' }),
      el('button', {
        class: 'subtle danger-text',
        text: 'Delete',
        onclick: confirmDelete(`milestone "${m.name}"`, async () => {
          await api.deleteMilestone(m.id);
          await render();
        }),
      }),
    ),
    ms.deliverables.length > 0
      ? el('div', { class: 'small muted', style: 'margin:4px 0' },
          `Deliverables: ${ms.deliverables.map((d) => d.name).join(', ')}`)
      : null,
    el('div', { class: 'row', style: 'gap:6px' }, editMilestone, addDeliverable),
  );
}

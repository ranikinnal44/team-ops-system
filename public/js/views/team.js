/**
 * Screen 9 — Team.
 *
 * The roster everyone can read, and that a Task Assigner can add to and edit. Any
 * change re-renders the whole screen from the server rather than patching the
 * DOM, so what is on screen is always what the API actually stored.
 */
import { api, session } from '../api.js';
import {
  el, card, field, select, stat, pageHead, errorBox, toast, initials, roleLabel, emptyState,
} from '../ui.js';

const ROLE_OPTIONS = [
  { value: 'employee', label: 'Member' },
  { value: 'reviewer', label: 'Reviewer' },
  { value: 'manager', label: 'Task Assigner' },
];

const roleBadge = (role) => el('span', { class: `badge role-${role}`, text: roleLabel(role) });

export async function teamView(mount) {
  const isManager = session.user?.role === 'manager';
  // The router keeps other roles out, but a pasted link should not render a
  // half-page and then fail on the fetch.
  if (!isManager) {
    mount.replaceChildren(
      pageHead('Team', 'Task Assigners only'),
      emptyState(
        'The team roster is Task Assigner-only',
        'Ask your Task Assigner who to speak to. The people you work with are named on the tasks you share.',
      ),
    );
    return;
  }
  let editingId = null;
  let showInactive = false;

  async function reload() {
    const members = await api.team(isManager && showInactive ? true : undefined);
    mount.replaceChildren(...screen(members));
  }

  /** The "add a team member" form. Task Assigner only. */
  function addForm() {
    const name = el('input', { type: 'text', required: true, placeholder: 'Full name' });
    const email = el('input', { type: 'email', required: true, placeholder: 'name@example.com' });
    const role = select(ROLE_OPTIONS, 'employee');
    const title = el('input', { type: 'text', placeholder: 'e.g. Mechanical Design Engineer' });
    const passcode = el('input', { type: 'text', required: true, minlength: '6', placeholder: 'At least 6 characters' });

    const errors = el('div');
    const submit = el('button', { class: 'primary', type: 'submit', text: 'Add member' });

    const form = el(
      'form',
      {
        onsubmit: async (event) => {
          event.preventDefault();
          errors.replaceChildren();
          submit.disabled = true;
          try {
            const created = await api.addTeamMember({
              name: name.value.trim(),
              email: email.value.trim(),
              role: role.value,
              title: title.value.trim() || null,
              passcode: passcode.value,
            });
            toast(`${created.name} added to the team`);
            await reload();
          } catch (error) {
            errors.replaceChildren(errorBox(error));
            submit.disabled = false;
          }
        },
      },
      errors,
      el('div', { class: 'grid-2' }, field('Name', name), field('Email', email, 'Used to sign in. Must be unique.')),
      el('div', { class: 'grid-2' },
        field('Role', role, 'Task Assigners plan the work; reviewers confirm dates and sign off what is done.'),
        field('Designation', title, 'Optional — what they do on the team.')),
      field('Passcode', passcode,
        'Theirs alone, and how they sign in. Tell it to them — nobody can read it back afterwards, ' +
        'only replace it.'),
      el('div', { class: 'row' }, submit),
    );

    return card('Add a team member', form);
  }

  /** A member row switched into edit mode. Task Assigner only. */
  function editRow(member) {
    const name = el('input', { type: 'text', value: member.name });
    const role = select(ROLE_OPTIONS, member.role);
    const title = el('input', { type: 'text', value: member.title ?? '', placeholder: 'Designation' });
    const errors = el('div');
    const save = el('button', { class: 'primary', type: 'submit', text: 'Save' });

    const form = el(
      'form',
      {
        onsubmit: async (event) => {
          event.preventDefault();
          errors.replaceChildren();
          save.disabled = true;
          try {
            await api.updateTeamMember(member.id, {
              name: name.value.trim(),
              role: role.value,
              title: title.value.trim() || null,
            });
            toast(`${name.value.trim()} updated`);
            editingId = null;
            await reload();
          } catch (error) {
            errors.replaceChildren(errorBox(error));
            save.disabled = false;
          }
        },
      },
      errors,
      el('div', { class: 'grid-3' },
        field('Name', name),
        field('Role', role),
        field('Designation', title)),
      el(
        'div',
        { class: 'row' },
        save,
        el('button', {
          type: 'button',
          text: 'Cancel',
          onclick: async () => {
            editingId = null;
            await reload();
          },
        }),
      ),
    );

    return el('tr', { class: 'team-edit' }, el('td', { colspan: '5' }, form));
  }

  /**
   * Replace somebody's passcode. There is no "show" — the server stores a hash
   * and can only be given a new one.
   */
  function resetPasscodeButton(member) {
    return el('button', {
      type: 'button',
      text: 'Passcode',
      onclick: async (event) => {
        const next = globalThis.prompt?.(`New passcode for ${member.name} (at least 6 characters):`);
        if (!next) return;
        event.target.disabled = true;
        try {
          await api.resetPasscode(member.id, next);
          toast(`${member.name}'s passcode changed — tell them what it is`);
        } catch (error) {
          toast(error.message, true);
        }
        event.target.disabled = false;
      },
    });
  }

  function setActive(member, active) {
    return el('button', {
      class: active ? '' : 'danger',
      type: 'button',
      text: active ? 'Reactivate' : 'Deactivate',
      onclick: async (event) => {
        event.target.disabled = true;
        try {
          await api.updateTeamMember(member.id, { active });
          toast(`${member.name} ${active ? 'reactivated' : 'deactivated'}`);
          await reload();
        } catch (error) {
          toast(error.message, true);
          event.target.disabled = false;
        }
      },
    });
  }

  function memberRow(member) {
    const person = el(
      'div',
      { class: 'person' },
      el('span', { class: 'avatar', 'aria-hidden': 'true', text: initials(member.name) }),
      el(
        'div',
        { class: 'who' },
        el('div', { class: 'nm' }, member.name,
          member.active ? null : el('span', { class: 'badge s-not_started', text: 'Inactive' })),
        // Omitted rather than captioned: no source document states job titles,
        // and a placeholder on every row is noise, not information.
        member.title ? el('div', { class: 'small muted', text: member.title }) : null,
      ),
    );

    // A Task Assigner can open anyone's board; a member only ever sees their own.
    const canOpenBoard = isManager || member.id === session.user?.id;

    return el(
      'tr',
      { class: member.active ? '' : 'inactive' },
      el('td', {}, person),
      el('td', {}, el('a', { class: 'small', href: `mailto:${member.email}`, text: member.email })),
      el('td', {}, roleBadge(member.role)),
      el(
        'td',
        { class: 'num' },
        member.openTasks === null
          ? el('span', { class: 'muted', text: '—' })
          : el('span', {}, `${member.openTasks} open`,
              el('span', { class: 'small muted', text: ` / ${member.totalTasks}` })),
      ),
      el(
        'td',
        {},
        el(
          'div',
          { class: 'row actions' },
          canOpenBoard
            ? el('a', { class: 'btn', href: `#/my-work?userId=${member.id}`, text: 'Board' })
            : null,
          isManager
            ? el('button', {
                type: 'button',
                text: 'Edit',
                onclick: async () => {
                  editingId = member.id;
                  await reload();
                },
              })
            : null,
          isManager ? resetPasscodeButton(member) : null,
          isManager ? setActive(member, !member.active) : null,
        ),
      ),
    );
  }

  function roster(members) {
    const body = el(
      'tbody',
      {},
      members.flatMap((member) =>
        editingId === member.id ? [memberRow(member), editRow(member)] : [memberRow(member)],
      ),
    );

    const table = el(
      'table',
      { class: 'team-table' },
      el('thead', {}, el('tr', {},
        el('th', { text: 'Person' }),
        el('th', { text: 'Email' }),
        el('th', { text: 'Role' }),
        el('th', { class: 'num', text: 'Tasks' }),
        el('th', { text: 'Actions' }))),
      body,
    );

    const toggle = isManager
      ? el('label', { class: 'row small inline-check' },
          el('input', {
            type: 'checkbox',
            checked: showInactive,
            onchange: async (event) => {
              showInactive = event.target.checked;
              await reload();
            },
          }),
          'Show deactivated')
      : null;

    const section = card('Team members', table, toggle);
    section.querySelector('.body').className = 'body tight';
    return section;
  }

  function screen(members) {
    const active = members.filter((m) => m.active);
    const summary = el(
      'div',
      { class: 'stats' },
      stat('Members', active.length),
      stat('Task Assigners', active.filter((m) => m.role === 'manager').length),
      stat('Reviewers', active.filter((m) => m.role === 'reviewer').length),
      stat('Members', active.filter((m) => m.role === 'employee').length),
      ...(isManager
        ? [stat('Open tasks', active.reduce((sum, m) => sum + (m.openTasks ?? 0), 0))]
        : []),
    );

    return [
      pageHead(
        'Team',
        isManager
          ? 'Everyone on the team, what they do, and how much open work they hold.'
          : 'Everyone on the team and what they do.',
      ),
      summary,
      el('div', { style: 'height:16px' }),
      isManager ? addForm() : null,
      isManager ? el('div', { style: 'height:16px' }) : null,
      roster(members),
    ].filter(Boolean);
  }

  await reload();
}

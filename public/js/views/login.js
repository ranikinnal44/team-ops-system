/** Screen 1 — Login / user selection. */
import { api, session } from '../api.js';
import { el, card, field, errorBox, initials, toast } from '../ui.js';

export async function loginView(mount) {
  const state = await api.authState().catch(() => ({ needsBootstrap: false }));

  // A system with nobody in it cannot be signed into, so the first screen it
  // shows is how to create the first manager rather than an empty picker.
  if (state.needsBootstrap) {
    return bootstrapView(mount);
  }

  const users = await api.selectableUsers();
  let selected = users.find((u) => u.role === 'manager') ?? users[0];

  const passcode = el('input', { type: 'password', value: 'demo1234', autocomplete: 'current-password' });
  const errors = el('div');
  const submit = el('button', { class: 'primary', type: 'submit', text: 'Sign in' });

  const picker = el('div', { class: 'user-pick' });
  const renderPicker = () => {
    picker.replaceChildren(
      ...users.map((user) =>
        el(
          'button',
          {
            type: 'button',
            class: user.id === selected?.id ? 'selected' : '',
            onclick: () => {
              selected = user;
              renderPicker();
            },
          },
          el('span', { class: 'avatar', text: initials(user.name) }),
          el(
            'span',
            {},
            el('div', { class: 'nm', text: user.name }),
            el('div', { class: 'rl', text: `${user.role === 'manager' ? 'Manager' : 'Employee'} · ${user.title ?? ''}` }),
          ),
        ),
      ),
    );
  };
  renderPicker();

  const form = el(
    'form',
    {
      onsubmit: async (event) => {
        event.preventDefault();
        errors.replaceChildren();
        submit.disabled = true;
        try {
          const result = await api.login(selected.email, passcode.value);
          session.save(result.token, result.user);
          toast(`Signed in as ${result.user.name}`);
          location.hash = result.user.role === 'manager' ? '#/manager' : '#/my-work';
        } catch (error) {
          errors.replaceChildren(errorBox(error));
        } finally {
          submit.disabled = false;
        }
      },
    },
    errors,
    el('label', { text: 'Select a user' }),
    picker,
    field('Passcode', passcode, 'Shared demo passcode, set by AUTH_PASSCODE in .env'),
    el('div', { class: 'row' }, submit),
  );

  mount.replaceChildren(
    el(
      'div',
      { class: 'login-wrap' },
      el(
        'div',
        { class: 'login' },
        el('h1', { text: 'Team Ops' }),
        el('div', { class: 'sub', text: 'Team task management and accountability — Layer 1' }),
        card(null, form),
        el('div', {
          class: 'notice',
          text:
            'DEMO DATA is loaded. Sign in as the Manager to see the team-wide exception view, or as an Employee to see a personal work queue.',
        }),
      ),
    ),
  );
}

/** First run: create the manager who will set everything else up. */
async function bootstrapView(mount) {
  const name = el('input', { type: 'text', placeholder: 'Your name', required: true });
  const email = el('input', { type: 'email', placeholder: 'you@example.com', required: true });
  const title = el('input', { type: 'text', placeholder: 'Engineering Manager' });
  const passcode = el('input', { type: 'password', autocomplete: 'current-password', required: true });
  const errors = el('div');
  const submit = el('button', { class: 'primary', type: 'submit', text: 'Create manager and sign in' });

  const form = el(
    'form',
    {
      onsubmit: async (event) => {
        event.preventDefault();
        errors.replaceChildren();
        submit.disabled = true;
        try {
          const result = await api.bootstrap({
            name: name.value.trim(),
            email: email.value.trim(),
            title: title.value.trim() || null,
            passcode: passcode.value,
          });
          session.save(result.token, result.user);
          toast(`Welcome, ${result.user.name}`);
          location.hash = '#/plan';
        } catch (error) {
          errors.replaceChildren(errorBox(error));
          submit.disabled = false;
        }
      },
    },
    errors,
    field('Your name', name),
    field('Email', email, 'Used to sign in. It is not emailed anywhere.'),
    field('Title', title, 'Optional.'),
    field('Passcode', passcode, 'The shared passcode from AUTH_PASSCODE in .env'),
    el('div', { class: 'row' }, submit),
  );

  mount.replaceChildren(
    el(
      'div',
      { class: 'login-wrap' },
      el(
        'div',
        { class: 'login' },
        el('h1', { text: 'Team Ops' }),
        el('div', { class: 'sub', text: 'No one has been set up yet — start by creating yourself as manager.' }),
        card(null, form),
        el('div', {
          class: 'notice',
          text:
            'You will be a manager, so you can create the project, its workstreams and milestones, ' +
            'and add the rest of the team. Everyone signs in with this same shared passcode.',
        }),
      ),
    ),
  );
}

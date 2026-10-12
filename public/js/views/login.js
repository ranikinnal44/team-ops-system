/** Screen 1 — Login / user selection. */
import { api, session } from '../api.js';
import { el, card, field, errorBox, initials, roleLabel, toast } from '../ui.js';

/**
 * Who the last sign-in on THIS browser was.
 *
 * Kept so a returning person gets one button instead of retyping their
 * address. It is a convenience, not a credential — it survives signing out,
 * and holding it grants nothing without the passcode.
 */
const LAST_SIGN_IN = 'teamops.lastSignIn';

const rememberSignIn = (user) => {
  try {
    localStorage.setItem(LAST_SIGN_IN, JSON.stringify({ email: user.email, name: user.name }));
  } catch {
    /* private browsing — they type their address next time */
  }
};

const lastSignIn = () => {
  try {
    const raw = localStorage.getItem(LAST_SIGN_IN);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const forgetSignIn = () => {
  try {
    localStorage.removeItem(LAST_SIGN_IN);
  } catch {
    /* nothing to forget */
  }
};

export async function loginView(mount) {
  const state = await api.authState().catch(() => ({ needsBootstrap: false }));

  // A system with nobody in it cannot be signed into, so the first screen it
  // shows is how to create the first Task Assigner rather than an empty form.
  if (state.needsBootstrap) {
    return bootstrapView(mount);
  }

  // Returning on this browser: show the one name rather than asking for it
  // again. Anyone else clicks "Sign in as someone else".
  let known = lastSignIn();

  const render = () => {
    const email = el('input', {
      type: 'email',
      autocomplete: 'username',
      required: true,
      placeholder: 'you@company.com',
      value: known?.email ?? '',
    });
    const passcode = el('input', {
      type: 'password',
      autocomplete: 'current-password',
      required: true,
    });
    const errors = el('div');
    const submit = el('button', { class: 'primary', type: 'submit', text: 'Sign in' });

    const identity = known
      ? el(
          'div',
          { class: 'known-user' },
          el('span', { class: 'avatar', text: initials(known.name) }),
          el(
            'span',
            {},
            el('div', { style: 'font-weight:600;color:var(--text)', text: known.name }),
            el('div', { class: 'small muted', text: known.email }),
          ),
          el('span', { class: 'spacer' }),
          el('button', {
            class: 'subtle',
            type: 'button',
            text: 'Not you?',
            onclick: () => {
              forgetSignIn();
              known = null;
              render();
            },
          }),
        )
      : field('Email', email, 'The address your Task Assigner registered for you.');

    const form = el(
      'form',
      {
        onsubmit: async (event) => {
          event.preventDefault();
          errors.replaceChildren();
          submit.disabled = true;
          try {
            const address = known?.email ?? email.value.trim();
            const result = await api.login(address, passcode.value);
            rememberSignIn(result.user);
            session.save(result.token, result.user);
            toast(`Signed in as ${result.user.name}`);
            location.hash = result.user.role === 'employee' ? '#/my-work' : '#/manager';
          } catch (error) {
            errors.replaceChildren(errorBox(error));
            passcode.value = '';
          } finally {
            submit.disabled = false;
          }
        },
      },
      errors,
      identity,
      field('Passcode', passcode, 'Set for you by your Task Assigner. They can replace it, not read it.'),
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
          el('div', {
            class: 'sub',
            text: known ? 'Welcome back' : 'Team task management and accountability',
          }),
          card(null, form),
          el('div', {
            class: 'notice',
            text: 'No account? Ask a Task Assigner to add you — there is no self sign-up.',
          }),
        ),
      ),
    );
    (known ? passcode : email).focus?.();
  };

  render();
}

async function bootstrapView(mount) {
  const name = el('input', { type: 'text', placeholder: 'Your name', required: true });
  const email = el('input', { type: 'email', placeholder: 'you@example.com', required: true });
  const title = el('input', { type: 'text', placeholder: 'Engineering Manager' });
  const joinCode = el('input', { type: 'password', autocomplete: 'one-time-code', required: true });
  const passcode = el('input', {
    type: 'password', autocomplete: 'new-password', required: true, minlength: '6',
  });
  const errors = el('div');
  const submit = el('button', { class: 'primary', type: 'submit', text: 'Create Task Assigner and sign in' });

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
            joinCode: joinCode.value,
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
    field('Join code', joinCode, 'AUTH_JOIN_CODE in .env — it only authorises this first account.'),
    field('Your passcode', passcode,
      'Yours alone, at least 6 characters. Everyone you add afterwards gets their own.'),
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
        el('div', { class: 'sub', text: 'No one has been set up yet — start by creating yourself as Task Assigner.' }),
        card(null, form),
        el('div', {
          class: 'notice',
          text:
            'You will be a Task Assigner, so you can create the project, its workstreams and milestones, ' +
            'and add the rest of the team. Everyone signs in with this same shared passcode.',
        }),
      ),
    ),
  );
}

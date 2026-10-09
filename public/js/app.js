/**
 * Application shell and hash router.
 *
 * Routes are declared once, the chrome is rendered once, and each view owns
 * the content area. No framework, no build step.
 */
import { api, session } from './api.js';
import { el, clear, initials, roleLabel, errorBox, toast } from './ui.js';
import { loginView } from './views/login.js';
import { managerView } from './views/manager.js';
import { employeeView } from './views/employee.js';
import { taskListView } from './views/task-list.js';
import { taskDetailView } from './views/task-detail.js';
import { createTaskView } from './views/create-task.js';
import { milestonesView } from './views/milestones.js';
import { activityView } from './views/activity.js';
import { planView } from './views/plan.js';
import { teamView } from './views/team.js';

const app = document.getElementById('app');

const ROUTES = [
  { pattern: /^\/login$/, view: loginView, chrome: false },
  { pattern: /^\/manager$/, view: managerView, managerOnly: true },
  { pattern: /^\/my-work$/, view: employeeView },
  { pattern: /^\/tasks\/new$/, view: createTaskView, managerOnly: true },
  { pattern: /^\/tasks\/([^/]+)$/, view: taskDetailView },
  { pattern: /^\/tasks$/, view: taskListView },
  { pattern: /^\/plan$/, view: planView, managerOnly: true },
  { pattern: /^\/milestones$/, view: milestonesView },
  { pattern: /^\/team$/, view: teamView, managerOnly: true },
  { pattern: /^\/activity$/, view: activityView },
];

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, search = ''] = raw.split('?');
  return { path, params: new URLSearchParams(search) };
}

function chrome(activePath) {
  const user = session.user;
  const isManager = user?.role === 'manager';
  // A reviewer sees the whole board, so the dashboard is theirs too — they
  // just cannot change the plan behind it.
  const seesAll = isManager || user?.role === 'reviewer';

  const links = [
    seesAll ? { href: '#/manager', label: 'Dashboard' } : null,
    { href: '#/my-work', label: 'My work' },
    { href: '#/tasks', label: 'Tasks' },
    isManager ? { href: '#/plan', label: 'Plan' } : null,
    { href: '#/milestones', label: 'Milestones' },
    isManager ? { href: '#/team', label: 'Team' } : null,
    { href: '#/activity', label: 'Activity' },
  ].filter(Boolean);

  const nav = el(
    'nav',
    { class: 'tabs' },
    links.map((link) =>
      el('a', {
        href: link.href,
        class: activePath.startsWith(link.href.slice(1)) ? 'active' : '',
        text: link.label,
      }),
    ),
  );

  return el(
    'div',
    {},
    datasetBanner(),
    el(
      'header',
      { class: 'topbar' },
      el('div', { class: 'brand' }, el('span', { class: 'mark', text: '✓' }), 'Team Ops'),
      nav,
      el(
        'div',
        { class: 'whoami' },
        el('span', { class: 'avatar', text: initials(user?.name) }),
        el('span', {}, el('div', { style: 'font-weight:600;color:var(--text)', text: user?.name ?? '' }),
          el('div', { text: roleLabel(user?.role) })),
        el('button', {
          class: 'subtle',
          text: 'Sign out',
          onclick: async () => {
            try {
              await api.logout();
            } catch {
              /* the local session is cleared either way */
            }
            session.clear();
            location.hash = '#/login';
          },
        }),
      ),
    ),
    el('main', { id: 'content' }),
  );
}

/** Which dataset is loaded, fetched once at boot from /api/health. */
let datasetInfo = null;

/**
 * Says plainly whether the screen is showing demo content or real project
 * data, so the two can never be mistaken for one another.
 */
function datasetBanner() {
  if (datasetInfo === 'DEMO') {
    return el('div', { class: 'demo-banner', text: 'DEMO DATA — sample team, projects and tasks' });
  }
  if (datasetInfo === 'AUTO_DOCK') {
    return el('div', {
      class: 'dataset-banner',
      text: 'AUTODOCK — project data imported from the team daily task log',
    });
  }
  return null;
}

let currentChromeFor = null;

async function render() {
  const { path, params } = parseHash();

  if (!session.token && path !== '/login') {
    location.hash = '#/login';
    return;
  }

  if (path === '/' || path === '') {
    location.hash = session.user?.role === 'employee' ? '#/my-work' : '#/manager';
    return;
  }

  // The Project screen laid out the same payload the Milestones screen does,
  // so it folded into it. Links to it keep working.
  if (path === '/project' || path.startsWith('/project/')) {
    location.hash = '#/milestones?groupBy=workstream';
    return;
  }

  const match = ROUTES.map((route) => ({ route, hit: route.pattern.exec(path) })).find((r) => r.hit);

  if (!match) {
    renderInto(el('div', { class: 'empty', text: `No screen at ${path}` }), path);
    return;
  }

  const { route, hit } = match;

  if (route.chrome === false) {
    currentChromeFor = null;
    clear(app);
    await route.view(app, params);
    return;
  }

  if (route.managerOnly && session.user?.role !== 'manager') {
    location.hash = '#/my-work';
    return;
  }

  const content = ensureChrome(path);
  content.replaceChildren(el('div', { class: 'empty', text: 'Loading…' }));
  try {
    await route.view(content, params, hit[1]);
  } catch (error) {
    content.replaceChildren(errorBox(error));
    if (error.status !== 401) toast(error.message, true);
  }
}

function ensureChrome(path) {
  const signature = `${session.user?.id ?? ''}|${path.split('/')[1] ?? ''}`;
  if (currentChromeFor !== signature) {
    clear(app);
    app.append(chrome(path));
    currentChromeFor = signature;
  }
  return document.getElementById('content');
}

function renderInto(node, path) {
  ensureChrome(path).replaceChildren(node);
}

window.addEventListener('hashchange', render);

/** Verify the stored session before first paint so a stale token logs out cleanly. */
async function boot() {
  try {
    const health = await api.health();
    datasetInfo = health.dataset ?? null;
  } catch {
    datasetInfo = null;
  }
  if (session.token) {
    try {
      const me = await api.me();
      session.save(session.token, { ...session.user, ...me });
    } catch {
      session.clear();
      location.hash = '#/login';
    }
  }
  await render();
}

boot();

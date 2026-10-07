/**
 * Thin API client. Every call goes through `request`, so session handling and
 * error shaping live in exactly one place.
 */

const TOKEN_KEY = 'team-ops.token';
const USER_KEY = 'team-ops.user';

export const session = {
  get token() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  get user() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  save(token, user) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch {
      /* private browsing — the session simply will not persist */
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch {
      /* ignore */
    }
  },
};

export class ApiError extends Error {
  constructor(status, payload) {
    const detail = payload?.error;
    super(detail?.message ?? `Request failed (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.code = detail?.code ?? 'UNKNOWN';
    this.details = detail?.details ?? [];
  }
}

async function request(method, path, body) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const token = session.token;
  if (token) headers.authorization = `Bearer ${token}`;

  const response = await fetch(path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const text = await response.text();
  let payload = null;
  try {
    payload = text === '' ? null : JSON.parse(text);
  } catch {
    payload = null;
  }

  if (!response.ok) {
    if (response.status === 401 && token) {
      session.clear();
      location.hash = '#/login';
    }
    throw new ApiError(response.status, payload);
  }
  return payload;
}

const qs = (params) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
};

export const api = {
  health: () => request('GET', '/api/health'),
  selectableUsers: () => request('GET', '/api/auth/users'),
  authState: () => request('GET', '/api/auth/state'),
  bootstrap: (payload) => request('POST', '/api/auth/bootstrap', payload),
  login: (email, passcode) => request('POST', '/api/auth/login', { email, passcode }),
  logout: () => request('POST', '/api/auth/logout'),
  me: () => request('GET', '/api/auth/me'),

  users: () => request('GET', '/api/users'),
  team: (includeInactive) => request('GET', `/api/team${qs({ includeInactive })}`),
  addTeamMember: (payload) => request('POST', '/api/team', payload),
  updateTeamMember: (id, payload) => request('PATCH', `/api/team/${id}`, payload),

  projects: () => request('GET', '/api/projects'),
  project: (id) => request('GET', `/api/projects/${id}`),
  createProject: (payload) => request('POST', '/api/projects', payload),
  updateProject: (id, payload) => request('PATCH', `/api/projects/${id}`, payload),
  deleteProject: (id) => request('DELETE', `/api/projects/${id}`),
  workstreams: (projectId) => request('GET', `/api/workstreams${qs({ projectId })}`),
  createWorkstream: (payload) => request('POST', '/api/workstreams', payload),
  updateWorkstream: (id, payload) => request('PATCH', `/api/workstreams/${id}`, payload),
  deleteWorkstream: (id) => request('DELETE', `/api/workstreams/${id}`),
  milestones: (workstreamId) => request('GET', `/api/milestones${qs({ workstreamId })}`),
  createMilestone: (payload) => request('POST', '/api/milestones', payload),
  updateMilestone: (id, payload) => request('PATCH', `/api/milestones/${id}`, payload),
  deleteMilestone: (id) => request('DELETE', `/api/milestones/${id}`),
  deliverables: (milestoneId) => request('GET', `/api/deliverables${qs({ milestoneId })}`),
  createDeliverable: (payload) => request('POST', '/api/deliverables', payload),
  updateDeliverable: (id, payload) => request('PATCH', `/api/deliverables/${id}`, payload),
  deleteDeliverable: (id) => request('DELETE', `/api/deliverables/${id}`),

  rules: () => request('GET', '/api/meta/rules'),

  tasks: (filters) => request('GET', `/api/tasks${qs(filters)}`),
  task: (id) => request('GET', `/api/tasks/${id}`),
  createTask: (payload) => request('POST', '/api/tasks', payload),
  updateTask: (id, payload) => request('PATCH', `/api/tasks/${id}`, payload),
  addComment: (id, body) => request('POST', `/api/tasks/${id}/comments`, { body }),
  requestDeadline: (id, payload) => request('POST', `/api/tasks/${id}/deadline-requests`, payload),
  deadlineRequests: (status) => request('GET', `/api/deadline-requests${qs({ status })}`),
  decideDeadline: (id, approve, note) =>
    request('POST', `/api/deadline-requests/${id}/decision`, { approve, note: note || null }),

  resolveClarification: (id, resolved = true) =>
    request('POST', `/api/clarifications/${id}/resolve`, { resolved }),

  bulkAssign: (payload) => request('POST', '/api/tasks/bulk-assign', payload),

  managerDashboard: () => request('GET', '/api/dashboard/manager'),
  employeeDashboard: (userId) => request('GET', `/api/dashboard/employee${qs({ userId })}`),
  activity: (limit) => request('GET', `/api/activity${qs({ limit })}`),
};

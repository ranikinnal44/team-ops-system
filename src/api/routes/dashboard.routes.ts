import type { Route } from '../http.ts';
import { managerDashboard, employeeDashboard } from '../../services/dashboard.service.ts';
import {
  clarificationQueue,
  resolveClarification,
} from '../../services/clarification.service.ts';
import { object, bool, optional, parseOrThrow } from '../../lib/validate.ts';

export const dashboardRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/dashboard/manager',
    handler: ({ db, actor }) => managerDashboard(db, actor),
  },
  {
    method: 'GET',
    path: '/api/dashboard/employee',
    handler: ({ db, actor, query }) =>
      employeeDashboard(db, actor, query.get('userId') ?? undefined),
  },
  {
    // The "Requires Clarification" queue: everything the source did not establish.
    method: 'GET',
    path: '/api/clarifications',
    handler: ({ db, actor }) => clarificationQueue(db, actor),
  },
  {
    method: 'POST',
    path: '/api/clarifications/:id/resolve',
    handler: ({ db, actor, params, body }) => {
      const input = parseOrThrow(object({ resolved: optional(bool()) }), body ?? {});
      return resolveClarification(db, actor, params.id as string, input.resolved ?? true);
    },
  },
];

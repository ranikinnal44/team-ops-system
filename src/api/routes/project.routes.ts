import type { Route } from '../http.ts';
import * as projects from '../../services/project.service.ts';
import * as userRepo from '../../repositories/user.repo.ts';
import {
  object, str, optional, nullable, isoDate, bool, arrayOf, parseOrThrow,
} from '../../lib/validate.ts';

const CODE = /^[A-Za-z0-9]{2,8}$/;

const patchProjectSchema = object({
  name: optional(str({ max: 120 })),
  code: optional(str({ max: 8, pattern: CODE })),
  description: optional(nullable(str({ max: 2000 }))),
  leadId: optional(nullable(str({ max: 64 }))),
});

const patchWorkstreamSchema = object({
  name: optional(str({ max: 120 })),
  code: optional(str({ max: 8, pattern: CODE })),
  description: optional(nullable(str({ max: 2000 }))),
});

const patchMilestoneSchema = object({
  name: optional(str({ max: 160 })),
  description: optional(nullable(str({ max: 2000 }))),
  targetDate: optional(nullable(isoDate())),
  // Movable, never clearable.
  startDate: optional(isoDate()),
  endDate: optional(isoDate()),
  timelineLabel: optional(nullable(str({ max: 40 }))),
  longLeadItems: optional(arrayOf(str({ max: 300 }), { max: 40 })),
});

const patchDeliverableSchema = object({
  name: optional(str({ max: 160 })),
  description: optional(nullable(str({ max: 2000 }))),
  dueLabel: optional(nullable(str({ max: 40 }))),
  dueDate: optional(isoDate()),
  critical: optional(bool()),
});

const projectSchema = object({
  name: str({ max: 120 }),
  code: optional(str({ max: 8, pattern: CODE })),
  description: optional(nullable(str({ max: 2000 }))),
  leadId: optional(nullable(str({ max: 64 }))),
});

const workstreamSchema = object({
  projectId: str({ max: 64 }),
  name: str({ max: 120 }),
  code: optional(str({ max: 8, pattern: CODE })),
  description: optional(nullable(str({ max: 2000 }))),
});

const milestoneSchema = object({
  workstreamId: str({ max: 64 }),
  name: str({ max: 160 }),
  description: optional(nullable(str({ max: 2000 }))),
  targetDate: optional(nullable(isoDate())),
  // Required: the work underneath a milestone inherits its span.
  startDate: isoDate(),
  endDate: isoDate(),
  timelineLabel: optional(nullable(str({ max: 40 }))),
  longLeadItems: optional(arrayOf(str({ max: 300 }), { max: 40 })),
});

const deliverableSchema = object({
  milestoneId: str({ max: 64 }),
  name: str({ max: 160 }),
  description: optional(nullable(str({ max: 2000 }))),
  dueLabel: optional(nullable(str({ max: 40 }))),
  // Required: a deliverable is a dated outcome, so the date is the record.
  dueDate: isoDate(),
  critical: optional(bool()),
});

export const projectRoutes: Route[] = [
  {
    method: 'GET',
    path: '/api/users',
    handler: ({ db }) => userRepo.listUsers(db, { activeOnly: true }),
  },
  {
    method: 'GET',
    path: '/api/projects',
    handler: ({ db, actor }) => projects.listProjects(db, actor),
  },
  {
    method: 'POST',
    path: '/api/projects',
    status: 201,
    handler: ({ db, actor, body }) => projects.createProject(db, actor, parseOrThrow(projectSchema, body)),
  },
  {
    method: 'GET',
    path: '/api/projects/:id',
    handler: ({ db, actor, params }) => projects.getProjectTree(db, actor, params.id as string),
  },
  {
    method: 'PATCH',
    path: '/api/projects/:id',
    handler: ({ db, actor, params, body }) =>
      projects.updateProject(db, actor, params.id as string, parseOrThrow(patchProjectSchema, body)),
  },
  {
    method: 'DELETE',
    path: '/api/projects/:id',
    handler: ({ db, actor, params }) => {
      projects.deleteProject(db, actor, params.id as string);
      return { ok: true };
    },
  },
  {
    method: 'GET',
    path: '/api/workstreams',
    handler: ({ db, actor, query }) =>
      projects.listWorkstreams(db, actor, query.get('projectId') ?? undefined),
  },
  {
    method: 'POST',
    path: '/api/workstreams',
    status: 201,
    handler: ({ db, actor, body }) =>
      projects.createWorkstream(db, actor, parseOrThrow(workstreamSchema, body)),
  },
  {
    method: 'PATCH',
    path: '/api/workstreams/:id',
    handler: ({ db, actor, params, body }) =>
      projects.updateWorkstream(db, actor, params.id as string, parseOrThrow(patchWorkstreamSchema, body)),
  },
  {
    method: 'DELETE',
    path: '/api/workstreams/:id',
    handler: ({ db, actor, params }) => {
      projects.deleteWorkstream(db, actor, params.id as string);
      return { ok: true };
    },
  },
  {
    method: 'GET',
    path: '/api/milestones',
    handler: ({ db, actor, query }) =>
      projects.listMilestones(db, actor, query.get('workstreamId') ?? undefined),
  },
  {
    method: 'POST',
    path: '/api/milestones',
    status: 201,
    handler: ({ db, actor, body }) =>
      projects.createMilestone(db, actor, parseOrThrow(milestoneSchema, body)),
  },
  {
    method: 'PATCH',
    path: '/api/milestones/:id',
    handler: ({ db, actor, params, body }) =>
      projects.updateMilestone(db, actor, params.id as string, parseOrThrow(patchMilestoneSchema, body)),
  },
  {
    method: 'DELETE',
    path: '/api/milestones/:id',
    handler: ({ db, actor, params }) => {
      projects.deleteMilestone(db, actor, params.id as string);
      return { ok: true };
    },
  },
  {
    method: 'GET',
    path: '/api/deliverables',
    handler: ({ db, actor, query }) =>
      projects.listDeliverables(db, actor, query.get('milestoneId') ?? undefined),
  },
  {
    method: 'POST',
    path: '/api/deliverables',
    status: 201,
    handler: ({ db, actor, body }) =>
      projects.createDeliverable(db, actor, parseOrThrow(deliverableSchema, body)),
  },
  {
    method: 'PATCH',
    path: '/api/deliverables/:id',
    handler: ({ db, actor, params, body }) =>
      projects.updateDeliverable(db, actor, params.id as string, parseOrThrow(patchDeliverableSchema, body)),
  },
  {
    method: 'DELETE',
    path: '/api/deliverables/:id',
    handler: ({ db, actor, params }) => {
      projects.deleteDeliverable(db, actor, params.id as string);
      return { ok: true };
    },
  },
];

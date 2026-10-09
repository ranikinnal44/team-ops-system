import type { Route } from '../http.ts';
import { queryList } from '../http.ts';
import * as tasks from '../../services/task.service.ts';
import { sortTasks, SortKey } from '../../services/dashboard.service.ts';
import {
  object,
  str,
  int,
  bool,
  isoDate,
  url,
  oneOf,
  arrayOf,
  optional,
  nullable,
  parseOrThrow,
} from '../../lib/validate.ts';
import { TASK_STATUSES, PRIORITIES, type TaskStatus, type Priority } from '../../domain/enums.ts';
import { MAX_DAY_OUTCOME_LENGTH } from '../../domain/task-schedule.ts';
import { MAX_DAY_LOG_OUTCOME_LENGTH } from '../../services/task.service.ts';
import { TRANSITIONS } from '../../domain/status-machine.ts';
import { config } from '../../config/index.ts';
import { Capability } from '../../domain/permissions.ts';

/**
 * One calendar day of a multi-day task and what it is meant to produce. The
 * service checks the dates against the task's own range; this only checks shape.
 */
const dayPlanSchema = object({
  date: isoDate(),
  outcome: str({ max: MAX_DAY_OUTCOME_LENGTH }),
});

/**
 * A day's reported outcome. `logDate` defaults to today in the service; the
 * rules about who may write it and when live there too.
 */
const dayLogSchema = object({
  logDate: optional(isoDate()),
  outcome: str({ max: MAX_DAY_LOG_OUTCOME_LENGTH }),
  progress: optional(nullable(int({ min: 0, max: 100 }))),
  blocker: optional(nullable(str({ max: 2000 }))),
});

const proposeScheduleSchema = object({
  startDate: isoDate(),
  dueDate: isoDate(),
  dayPlans: optional(arrayOf(dayPlanSchema)),
});

const scheduleDecisionSchema = object({
  approve: bool(),
  note: optional(nullable(str({ max: 2000 }))),
});

const createSchema = object({
  workstreamId: str({ max: 64 }),
  milestoneId: optional(nullable(str({ max: 64 }))),
  deliverableId: optional(nullable(str({ max: 64 }))),
  title: str({ max: 200 }),
  description: optional(nullable(str({ max: 5000 }))),
  // Optional, like priority: a plan is often written before anyone is given
  // the work, and an unassigned task says so rather than being parked on
  // whoever happened to create it. The Tasks screen assigns them in bulk.
  ownerId: optional(nullable(str({ max: 64 }))),
  // Required at creation: work is signed off by someone other than whoever
  // did it, so a task with no reviewer could never reach Completed.
  reviewerId: str({ max: 64 }),
  supportingMemberIds: optional(arrayOf(str({ max: 64 }), { max: 20 })),
  // Omitted or null means "not assigned yet" rather than a guessed default.
  priority: optional(nullable(oneOf(PRIORITIES))),
  // Required, unlike every other scheduling field: work with no agreed start
  // and end cannot be chased, so it is refused at the door.
  // The Task Assigner budgets effort; the owner proposes the dates that spend it.
  effortDays: int({ min: 1, max: 365 }),
  startDate: optional(isoDate()),
  dueDate: optional(isoDate()),
  // Required by the service once the task covers more than one day.
  dayPlans: optional(arrayOf(dayPlanSchema, { max: 31 })),
  dependencyTaskIds: optional(arrayOf(str({ max: 64 }), { max: 20 })),
  nextAction: optional(nullable(str({ max: 500 }))),
});

const updateSchema = object({
  /** What the caller last saw. Present, it makes a clashing edit a 409. */
  expectedLastUpdatedAt: optional(str({ max: 40 })),
  status: optional(oneOf(TASK_STATUSES)),
  progress: optional(int({ min: 0, max: 100 })),
  blocker: optional(nullable(str({ max: 2000 }))),
  nextAction: optional(nullable(str({ max: 500 }))),
  evidenceUrl: optional(nullable(url())),
  title: optional(str({ max: 200 })),
  description: optional(nullable(str({ max: 5000 }))),
  ownerId: optional(str({ max: 64 })),
  reviewerId: optional(nullable(str({ max: 64 }))),
  effortDays: optional(int({ min: 1, max: 365 })),
  supportingMemberIds: optional(arrayOf(str({ max: 64 }), { max: 20 })),
  priority: optional(nullable(oneOf(PRIORITIES))),
  // Movable, but never clearable: a task without a start and an end cannot be
  // chased, and that holds for the whole of its life, not just its creation.
  startDate: optional(isoDate()),
  dueDate: optional(isoDate()),
  dayPlans: optional(arrayOf(dayPlanSchema, { max: 31 })),
  milestoneId: optional(nullable(str({ max: 64 }))),
  deliverableId: optional(nullable(str({ max: 64 }))),
  dependencyTaskIds: optional(arrayOf(str({ max: 64 }), { max: 20 })),
  progressNote: optional(nullable(str({ max: 200 }))),
  reviewNote: optional(nullable(str({ max: 2000 }))),
  comment: optional(str({ max: 5000 })),
});

const commentSchema = object({ body: str({ max: 5000 }) });

const deadlineRequestSchema = object({
  requestedDueDate: isoDate(),
  reason: str({ max: 1000 }),
});

const decisionSchema = object({
  approve: bool(),
  note: optional(nullable(str({ max: 1000 }))),
});

const SORT_KEYS = ['priority', 'dueDate', 'status', 'attention'] as const;

const bulkAssignSchema = object({
  taskIds: arrayOf(str({ max: 64 }), { max: 500 }),
  ownerId: optional(nullable(str({ max: 64 }))),
  priority: optional(nullable(oneOf(PRIORITIES))),
});

export const taskRoutes: Route[] = [
  {
    // Assign an owner and/or priority across a selection in one request.
    method: 'POST',
    path: '/api/tasks/bulk-assign',
    handler: ({ db, actor, body }) => {
      const input = parseOrThrow(bulkAssignSchema, body);
      return tasks.bulkAssign(db, actor, {
        taskIds: input.taskIds,
        ...(input.ownerId !== undefined ? { ownerId: input.ownerId } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
      });
    },
  },
  {
    method: 'GET',
    path: '/api/tasks',
    handler: ({ db, actor, query }) => {
      const statuses = queryList(query, 'status').filter((s) =>
        (TASK_STATUSES as readonly string[]).includes(s),
      ) as TaskStatus[];
      const priorities = queryList(query, 'priority').filter((p) =>
        (PRIORITIES as readonly string[]).includes(p),
      ) as Priority[];

      const result = tasks.listTasks(db, actor, {
        ...(query.get('ownerId') ? { ownerId: query.get('ownerId') as string } : {}),
        // A reviewer's queue: the repository has always supported this, but
        // without it on the route there was no way to ask "what is waiting on me".
        ...(query.get('reviewerId') ? { reviewerId: query.get('reviewerId') as string } : {}),
        ...(query.get('projectId') ? { projectId: query.get('projectId') as string } : {}),
        ...(query.get('workstreamId') ? { workstreamId: query.get('workstreamId') as string } : {}),
        ...(query.get('milestoneId') ? { milestoneId: query.get('milestoneId') as string } : {}),
        ...(query.get('search') ? { search: query.get('search') as string } : {}),
        ...(query.get('needsClarification') === 'true' ? { needsClarification: true } : {}),
        ...(query.get('missingPriority') === 'true' ? { missingPriority: true } : {}),
        ...(query.get('missingDueDate') === 'true' ? { missingDueDate: true } : {}),
        ...(query.get('unassigned') === 'true' ? { unassigned: true } : {}),
        ...(query.get('dueOnOrBefore') ? { dueOnOrBefore: query.get('dueOnOrBefore') as string } : {}),
        ...(statuses.length > 0 ? { statuses } : {}),
        ...(priorities.length > 0 ? { priorities } : {}),
      });

      const requested = query.get('sort') ?? SortKey.Attention;
      const sortKey = (SORT_KEYS as readonly string[]).includes(requested)
        ? (requested as SortKey)
        : SortKey.Attention;
      const exception = query.get('exception');
      const filtered = exception
        ? result.filter((t) => t.exceptions.includes(exception as never))
        : result;
      return sortTasks(filtered, sortKey);
    },
  },
  {
    method: 'POST',
    path: '/api/tasks',
    status: 201,
    capability: Capability.CreateTask,
    handler: ({ db, actor, body }) => tasks.createTask(db, actor, parseOrThrow(createSchema, body)),
  },
  {
    method: 'GET',
    path: '/api/tasks/:id',
    handler: ({ db, actor, params }) => {
      const task = tasks.getTask(db, actor, params.id as string);
      return {
        task,
        availableTransitions: tasks.availableTransitions(task, actor),
        comments: tasks.listComments(db, actor, task.id),
        history: tasks.listHistory(db, actor, task.id),
        deadlineRequests: tasks
          .listDeadlineRequests(db, actor)
          .filter((r) => r.taskId === task.id),
      };
    },
  },
  {
    method: 'PATCH',
    path: '/api/tasks/:id',
    handler: ({ db, actor, params, body }) =>
      tasks.updateTask(db, actor, params.id as string, parseOrThrow(updateSchema, body)),
  },
  {
    method: 'GET',
    path: '/api/tasks/:id/history',
    handler: ({ db, actor, params }) => tasks.listHistory(db, actor, params.id as string),
  },
  {
    method: 'GET',
    path: '/api/tasks/:id/comments',
    handler: ({ db, actor, params }) => tasks.listComments(db, actor, params.id as string),
  },
  {
    method: 'POST',
    path: '/api/tasks/:id/comments',
    status: 201,
    handler: ({ db, actor, params, body }) =>
      tasks.addComment(db, actor, params.id as string, parseOrThrow(commentSchema, body).body),
  },
  {
    method: 'POST',
    path: '/api/tasks/:id/schedule',
    handler: ({ db, actor, params, body }) =>
      tasks.proposeSchedule(db, actor, params.id as string, parseOrThrow(proposeScheduleSchema, body)),
  },
  {
    method: 'POST',
    path: '/api/tasks/:id/schedule/decision',
    handler: ({ db, actor, params, body }) =>
      tasks.decideSchedule(db, actor, params.id as string, parseOrThrow(scheduleDecisionSchema, body)),
  },
  {
    method: 'GET',
    path: '/api/tasks/:id/day-logs',
    handler: ({ db, actor, params }) => tasks.listDayLogs(db, actor, params.id as string),
  },
  {
    method: 'POST',
    path: '/api/tasks/:id/day-logs',
    status: 201,
    handler: ({ db, actor, params, body }) =>
      tasks.recordDayOutcome(db, actor, params.id as string, parseOrThrow(dayLogSchema, body)),
  },
  {
    method: 'POST',
    path: '/api/tasks/:id/deadline-requests',
    status: 201,
    handler: ({ db, actor, params, body }) =>
      tasks.requestDeadlineChange(db, actor, params.id as string, parseOrThrow(deadlineRequestSchema, body)),
  },
  {
    method: 'GET',
    path: '/api/deadline-requests',
    handler: ({ db, actor, query }) => {
      const status = query.get('status');
      return tasks.listDeadlineRequests(
        db,
        actor,
        status === 'pending' || status === 'approved' || status === 'rejected' ? { status } : {},
      );
    },
  },
  {
    method: 'POST',
    path: '/api/deadline-requests/:id/decision',
    handler: ({ db, actor, params, body }) => {
      const input = parseOrThrow(decisionSchema, body);
      return tasks.decideDeadlineChange(db, actor, params.id as string, {
        approve: input.approve,
        note: input.note ?? null,
      });
    },
  },
  {
    method: 'GET',
    path: '/api/activity',
    handler: ({ db, actor, query }) =>
      tasks.listActivityFeed(db, actor, Number(query.get('limit') ?? 60) || 60),
  },
  {
    // Lets the UI render legal status choices without duplicating the rules.
    method: 'GET',
    path: '/api/meta/transitions',
    auth: false,
    handler: () => TRANSITIONS,
  },
  {
    // Same reason: the create form enforces the span limit as you type, and
    // reads it from here rather than hard-coding a second copy of the policy.
    method: 'GET',
    path: '/api/meta/rules',
    auth: false,
    handler: () => ({
      maxTaskEffortDays: config.rules.maxTaskEffortDays,
      dueSoonDays: config.rules.dueSoonDays,
      noUpdateWorkingDays: config.rules.noUpdateWorkingDays,
      dailyUpdateWorkingDays: config.rules.dailyUpdateWorkingDays,
    }),
  },
];

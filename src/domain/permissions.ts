/**
 * Role and field-level authorisation.
 *
 * Two separate questions are answered here:
 *   1. Capability  — may this role perform this kind of action at all?
 *   2. Field policy — which columns of a task may this role write?
 *
 * Keeping both as data (rather than scattered `if (role === ...)` checks) means
 * the rules are testable in isolation and visible in one place.
 */
import { Role } from './enums.ts';
import { forbidden, notFound } from '../lib/errors.ts';

export const Capability = {
  CreateProject: 'project:create',
  CreateWorkstream: 'workstream:create',
  CreateMilestone: 'milestone:create',
  CreateDeliverable: 'deliverable:create',
  CreateTask: 'task:create',
  ViewAllTasks: 'task:view_all',
  ReassignTask: 'task:reassign',
  DecideDeadlineRequest: 'deadline_request:decide',
  RequestDeadlineChange: 'deadline_request:create',
  ViewTeamProgress: 'dashboard:team',
  /**
   * See the roster: who exists, their role, their email.
   *
   * Separate from ManageTeam because viewing and changing are different
   * questions — they simply have the same answer, which is "a manager".
   * Knowing who holds which role is organisational information, not
   * something needed to do or to review the work.
   */
  ViewTeam: 'team:view',
  ResolveClarification: 'clarification:resolve',
  ManageTeam: 'team:manage',
  ManageSupply: 'supply:manage',
  BulkAssignTasks: 'task:bulk_assign',
} as const;
export type Capability = (typeof Capability)[keyof typeof Capability];

const MANAGER_CAPABILITIES: readonly Capability[] = [
  Capability.CreateProject,
  Capability.CreateWorkstream,
  Capability.CreateMilestone,
  Capability.CreateDeliverable,
  Capability.CreateTask,
  Capability.ViewAllTasks,
  Capability.ReassignTask,
  Capability.DecideDeadlineRequest,
  Capability.ViewTeamProgress,
  Capability.ViewTeam,
  Capability.ResolveClarification,
  Capability.ManageTeam,
  Capability.ManageSupply,
  Capability.BulkAssignTasks,
];

const EMPLOYEE_CAPABILITIES: readonly Capability[] = [Capability.RequestDeadlineChange];

/**
 * A reviewer decides, they do not plan: no creating structure or tasks, no
 * reassignment, no team management. They see every task because they cannot
 * review what they cannot find, and they may own work of their own, which is
 * why they keep the right to ask for an extension like anyone else.
 */
const REVIEWER_CAPABILITIES: readonly Capability[] = [
  Capability.ViewAllTasks,
  Capability.ViewTeamProgress,
  Capability.DecideDeadlineRequest,
  Capability.RequestDeadlineChange,
];

export const CAPABILITIES_BY_ROLE: Record<Role, readonly Capability[]> = {
  [Role.Manager]: MANAGER_CAPABILITIES,
  [Role.Reviewer]: REVIEWER_CAPABILITIES,
  [Role.Employee]: EMPLOYEE_CAPABILITIES,
};

/**
 * Whether a role sees the whole board rather than only its own work.
 *
 * Read-only breadth, nothing more: a reviewer has to be able to find what is
 * waiting on them, which is not the same as being able to change it.
 */
export const seesAllWork = (role: Role): boolean =>
  role === Role.Manager || role === Role.Reviewer;

export const can = (role: Role, capability: Capability): boolean =>
  CAPABILITIES_BY_ROLE[role].includes(capability);

export function assertCan(role: Role, capability: Capability): void {
  if (!can(role, capability)) {
    throw forbidden(`Your role (${role}) is not permitted to perform "${capability}".`);
  }
}

/**
 * Task fields an employee may write on a task they are involved in.
 * Everything outside this list — owner, project, priority, due date — is
 * manager-only, which is what the "no silent reassignment or deadline
 * extension" rule comes down to.
 */
export const EMPLOYEE_WRITABLE_TASK_FIELDS = [
  'status',
  'progress',
  'blocker',
  'nextAction',
  'evidenceUrl',
] as const;

export const MANAGER_WRITABLE_TASK_FIELDS = [
  ...EMPLOYEE_WRITABLE_TASK_FIELDS,
  'title',
  'description',
  'ownerId',
  'reviewerId',
  'supportingMemberIds',
  'priority',
  'effortDays',
  'startDate',
  'dueDate',
  'dayPlans',
  'milestoneId',
  'deliverableId',
  'dependencyTaskIds',
] as const;

export type TaskField = (typeof MANAGER_WRITABLE_TASK_FIELDS)[number];

export const WRITABLE_TASK_FIELDS_BY_ROLE: Record<Role, readonly TaskField[]> = {
  [Role.Manager]: MANAGER_WRITABLE_TASK_FIELDS,
  // A reviewer writes no more than an employee does. Their authority is
  // exercised through the decisions — schedule, review, extension — not by
  // editing the task underneath whoever owns it.
  [Role.Reviewer]: EMPLOYEE_WRITABLE_TASK_FIELDS,
  [Role.Employee]: EMPLOYEE_WRITABLE_TASK_FIELDS,
};

/** Human-facing reason used when an employee attempts a manager-only field. */
const FIELD_DENIAL_REASON: Partial<Record<TaskField, string>> = {
  ownerId: 'Only a manager can reassign a task owner.',
  priority: 'Only a manager can change priority.',
  dueDate: 'Request a deadline change instead — a manager must approve it.',
  effortDays: 'Only a manager can change the effort budget.',
  startDate: 'Only a manager can change the start date.',
  dayPlans: 'Only a manager can change what each day of the task delivers.',
  milestoneId: 'Only a manager can move a task to another milestone.',
  deliverableId: 'Only a manager can move a task to another deliverable.',
  reviewerId: 'Only a manager can change the reviewer.',
  supportingMemberIds: 'Only a manager can change supporting members.',
  dependencyTaskIds: 'Only a manager can change dependencies.',
  title: 'Only a manager can rename a task.',
  description: 'Only a manager can edit the task description.',
};

export const canWriteTaskField = (role: Role, field: TaskField): boolean =>
  WRITABLE_TASK_FIELDS_BY_ROLE[role].includes(field);

export function assertCanWriteTaskFields(role: Role, fields: readonly string[]): void {
  const denied = fields.filter((f) => !canWriteTaskField(role, f as TaskField));
  if (denied.length === 0) return;
  const reasons = denied.map((f) => FIELD_DENIAL_REASON[f as TaskField] ?? `"${f}" is read-only for your role.`);
  throw forbidden(`${[...new Set(reasons)].join(' ')} (fields: ${denied.join(', ')})`);
}

/** Who an employee counts as "involved" for: owner, supporter or reviewer. */
export type TaskParticipants = {
  /** `null` for work nobody has been assigned yet. */
  readonly ownerId: string | null;
  readonly reviewerId: string | null;
  readonly supportingMemberIds: readonly string[];
};

export const isParticipant = (task: TaskParticipants, userId: string): boolean =>
  (task.ownerId !== null && task.ownerId === userId) ||
  (task.reviewerId !== null && task.reviewerId === userId) ||
  task.supportingMemberIds.includes(userId);

export const canViewTask = (role: Role, task: TaskParticipants, userId: string): boolean =>
  seesAllWork(role) || isParticipant(task, userId);

export function assertCanViewTask(role: Role, task: TaskParticipants, userId: string): void {
  if (!canViewTask(role, task, userId)) {
    throw forbidden('You can only view tasks you are assigned to.');
  }
}

/**
 * Updating is narrower than viewing: a supporting member or reviewer can see a
 * task, but only the owner (or a manager) drives its status and progress.
 */
export const canUpdateTask = (role: Role, task: TaskParticipants, userId: string): boolean =>
  role === Role.Manager ||
  (task.ownerId !== null && task.ownerId === userId) ||
  (task.reviewerId !== null && task.reviewerId === userId);

export function assertCanUpdateTask(role: Role, task: TaskParticipants, userId: string): void {
  if (!canUpdateTask(role, task, userId)) {
    throw forbidden('Only the task owner, its reviewer or a manager can update this task.');
  }
}

/**
 * Which workstreams an actor may see.
 *
 * A manager sees the whole plan. An employee sees only the workstreams they
 * hold work in — the structure around someone else's workstream is as
 * invisible to them as the tasks inside it.
 *
 * Kept as a value rather than a predicate over the database so this stays pure
 * and the caller resolves the ids once per request instead of per node.
 */
export type WorkstreamScope =
  /** Every workstream, present and future. */
  | { readonly kind: 'all' }
  /** Exactly these ids and no others. */
  | { readonly kind: 'some'; readonly ids: ReadonlySet<string> };

export const ALL_WORKSTREAMS: WorkstreamScope = { kind: 'all' };

export const workstreamScope = (ids: Iterable<string>): WorkstreamScope => ({
  kind: 'some',
  ids: new Set(ids),
});

/** The scope a role implies, given the workstreams the user participates in. */
export const scopeForRole = (role: Role, participantWorkstreamIds: Iterable<string>): WorkstreamScope =>
  seesAllWork(role) ? ALL_WORKSTREAMS : workstreamScope(participantWorkstreamIds);

export const canViewWorkstream = (scope: WorkstreamScope, workstreamId: string): boolean =>
  scope.kind === 'all' || scope.ids.has(workstreamId);

/**
 * Refuses as "not found" rather than "forbidden" on purpose: an employee has
 * no business learning that a workstream they cannot see exists at all.
 */
export function assertCanViewWorkstream(scope: WorkstreamScope, workstreamId: string): void {
  if (!canViewWorkstream(scope, workstreamId)) throw notFound('Workstream');
}

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
import { forbidden } from '../lib/errors.ts';

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
  Capability.ResolveClarification,
  Capability.ManageTeam,
  Capability.ManageSupply,
  Capability.BulkAssignTasks,
];

const EMPLOYEE_CAPABILITIES: readonly Capability[] = [Capability.RequestDeadlineChange];

export const CAPABILITIES_BY_ROLE: Record<Role, readonly Capability[]> = {
  [Role.Manager]: MANAGER_CAPABILITIES,
  [Role.Employee]: EMPLOYEE_CAPABILITIES,
};

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
  [Role.Employee]: EMPLOYEE_WRITABLE_TASK_FIELDS,
};

/** Human-facing reason used when an employee attempts a manager-only field. */
const FIELD_DENIAL_REASON: Partial<Record<TaskField, string>> = {
  ownerId: 'Only a manager can reassign a task owner.',
  priority: 'Only a manager can change priority.',
  dueDate: 'Request a deadline change instead — a manager must approve it.',
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
  role === Role.Manager || isParticipant(task, userId);

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

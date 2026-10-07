/**
 * Project hierarchy management. Creation is manager-only; reads are open to
 * every authenticated user so employees can see where their work sits.
 */
import type { Database } from '../db/connection.ts';
import { transaction } from '../db/connection.ts';
import * as repo from '../repositories/hierarchy.repo.ts';
import * as taskRepo from '../repositories/task.repo.ts';
import * as userRepo from '../repositories/user.repo.ts';
import type { Actor, Project, Workstream, Milestone, Deliverable, TaskView } from '../domain/types.ts';
import { Role, TaskStatus } from '../domain/enums.ts';
import {
  Capability,
  assertCan,
  scopeForRole,
  canViewWorkstream,
  assertCanViewWorkstream,
  type WorkstreamScope,
} from '../domain/permissions.ts';
import { suggestCode } from '../lib/ids.ts';
import { conflict, notFound, validationError } from '../lib/errors.ts';
import { todayDate, type IsoDate } from '../lib/dates.ts';
import { toTaskViews } from './task.service.ts';

const CODE_PATTERN = /^[A-Z0-9]{2,8}$/;

function assertCode(code: string, path: string): void {
  if (!CODE_PATTERN.test(code)) {
    throw validationError('Invalid code', [
      { path, message: 'must be 2–8 uppercase letters or digits' },
    ]);
  }
}

export function createProject(
  db: Database,
  actor: Actor,
  input: { code?: string; name: string; description?: string | null; leadId?: string | null },
): Project {
  assertCan(actor.role, Capability.CreateProject);
  const code = (input.code ?? suggestCode(input.name, 4)).toUpperCase();
  assertCode(code, 'code');
  if (repo.findProjectByCode(db, code)) {
    throw conflict(`A project with code "${code}" already exists.`);
  }
  if (input.leadId && !userRepo.findUserById(db, input.leadId)) throw notFound('Project lead');
  return repo.createProject(db, { ...input, code });
}

export function createWorkstream(
  db: Database,
  actor: Actor,
  input: { projectId: string; code?: string; name: string; description?: string | null },
): Workstream {
  assertCan(actor.role, Capability.CreateWorkstream);
  if (!repo.findProjectById(db, input.projectId)) throw notFound('Project');
  const code = (input.code ?? suggestCode(input.name, 3)).toUpperCase();
  assertCode(code, 'code');
  const taken = repo.listWorkstreams(db, input.projectId).some((w) => w.code === code);
  if (taken) throw conflict(`Workstream code "${code}" is already used in this project.`);
  return repo.createWorkstream(db, { ...input, code });
}

export function createMilestone(
  db: Database,
  actor: Actor,
  input: {
    workstreamId: string;
    name: string;
    description?: string | null;
    targetDate?: IsoDate | null;
    // Required: everything planned underneath a milestone sits inside its span.
    startDate: IsoDate;
    endDate: IsoDate;
  },
): Milestone {
  assertCan(actor.role, Capability.CreateMilestone);
  if (!repo.findWorkstreamById(db, input.workstreamId)) throw notFound('Workstream');
  if (input.endDate < input.startDate) {
    throw validationError('The milestone ends before it starts', [
      { path: 'endDate', message: 'must be on or after the start date' },
    ]);
  }
  return repo.createMilestone(db, input);
}

export function createDeliverable(
  db: Database,
  actor: Actor,
  input: { milestoneId: string; name: string; description?: string | null; dueDate: IsoDate },
): Deliverable {
  assertCan(actor.role, Capability.CreateDeliverable);
  if (!repo.findMilestoneById(db, input.milestoneId)) throw notFound('Milestone');
  return repo.createDeliverable(db, input);
}

/**
 * The workstreams this actor may see, resolved once per request.
 *
 * A manager gets the whole plan. An employee gets the workstreams they hold
 * work in, so the structure they can browse matches the tasks they can open
 * rather than advertising a plan they have no part in.
 */
export function workstreamScopeFor(db: Database, actor: Actor): WorkstreamScope {
  return scopeForRole(actor.role, taskRepo.listParticipantWorkstreamIds(db, actor.id));
}

/** Projects with at least one workstream the actor can see. */
export function listProjects(db: Database, actor: Actor): Project[] {
  const scope = workstreamScopeFor(db, actor);
  if (scope.kind === 'all') return repo.listProjects(db);
  const visibleProjects = new Set(
    repo.listWorkstreams(db).filter((w) => canViewWorkstream(scope, w.id)).map((w) => w.projectId),
  );
  return repo.listProjects(db).filter((p) => visibleProjects.has(p.id));
}

export function listWorkstreams(db: Database, actor: Actor, projectId?: string): Workstream[] {
  const scope = workstreamScopeFor(db, actor);
  return repo.listWorkstreams(db, projectId).filter((w) => canViewWorkstream(scope, w.id));
}

export function listMilestones(db: Database, actor: Actor, workstreamId?: string): Milestone[] {
  const scope = workstreamScopeFor(db, actor);
  if (workstreamId !== undefined) assertCanViewWorkstream(scope, workstreamId);
  return repo
    .listMilestones(db, workstreamId)
    .filter((m) => canViewWorkstream(scope, m.workstreamId));
}

export function listDeliverables(db: Database, actor: Actor, milestoneId?: string): Deliverable[] {
  const scope = workstreamScopeFor(db, actor);
  if (scope.kind === 'all') return repo.listDeliverables(db, milestoneId);
  // A deliverable reaches its workstream through its milestone, so resolve
  // that mapping once rather than looking it up per row.
  const visibleMilestones = new Set(
    repo.listMilestones(db).filter((m) => canViewWorkstream(scope, m.workstreamId)).map((m) => m.id),
  );
  if (milestoneId !== undefined && !visibleMilestones.has(milestoneId)) throw notFound('Milestone');
  return repo.listDeliverables(db, milestoneId).filter((d) => visibleMilestones.has(d.milestoneId));
}

/**
 * The whole tree for one project, with per-node task roll-ups. Backs the
 * Project View screen.
 */
export type ProjectTree = {
  project: Project;
  totals: StatusTotals;
  workstreams: {
    workstream: Workstream;
    totals: StatusTotals;
    milestones: {
      milestone: Milestone;
      totals: StatusTotals;
      deliverables: Deliverable[];
      tasks: TaskView[];
    }[];
    /** Tasks in this workstream that have no milestone assigned yet. */
    unassignedTasks: TaskView[];
  }[];
};

export type StatusTotals = {
  total: number;
  notStarted: number;
  inProgress: number;
  blocked: number;
  review: number;
  completed: number;
  overdue: number;
  completionPercent: number;
};

export function summariseStatuses(tasks: readonly TaskView[]): StatusTotals {
  const count = (status: TaskStatus): number => tasks.filter((t) => t.status === status).length;
  const completed = count(TaskStatus.Completed);
  return {
    total: tasks.length,
    notStarted: count(TaskStatus.NotStarted),
    inProgress: count(TaskStatus.InProgress),
    blocked: count(TaskStatus.Blocked),
    review: count(TaskStatus.Review),
    completed,
    overdue: tasks.filter((t) => t.exceptions.includes('OVERDUE')).length,
    completionPercent: tasks.length === 0 ? 0 : Math.round((completed / tasks.length) * 100),
  };
}

export function getProjectTree(
  db: Database,
  actor: Actor,
  projectId: string,
  now = new Date(),
): ProjectTree {
  const project = repo.findProjectById(db, projectId) ?? repo.findProjectByCode(db, projectId);
  if (!project) throw notFound('Project');

  // Employees see only the workstreams they hold work in, and only their own
  // tasks inside them. A project they have no part in is reported as missing
  // rather than as an empty shell, which would still confirm it exists.
  const scope = workstreamScopeFor(db, actor);
  const visibleWorkstreams = repo
    .listWorkstreams(db, project.id)
    .filter((w) => canViewWorkstream(scope, w.id));
  if (visibleWorkstreams.length === 0 && scope.kind === 'some') throw notFound('Project');

  const taskScope = actor.role === Role.Manager ? {} : { participantId: actor.id };
  const tasks = toTaskViews(
    db,
    taskRepo.listTasks(db, { projectId: project.id, ...taskScope }),
    todayDate(now),
  );
  const byMilestone = new Map<string, TaskView[]>();
  // Tasks whose milestone has not been decided yet still belong to a
  // workstream and must stay visible, not vanish from the project view.
  const unassignedByWorkstream = new Map<string, TaskView[]>();
  for (const task of tasks) {
    if (task.milestoneId === null) {
      const list = unassignedByWorkstream.get(task.workstreamId) ?? [];
      list.push(task);
      unassignedByWorkstream.set(task.workstreamId, list);
      continue;
    }
    const list = byMilestone.get(task.milestoneId) ?? [];
    list.push(task);
    byMilestone.set(task.milestoneId, list);
  }

  const byAttention = (a: TaskView, b: TaskView): number => b.attentionScore - a.attentionScore;

  const workstreams = visibleWorkstreams.map((workstream) => {
    const milestones = repo.listMilestones(db, workstream.id).map((milestone) => {
      const milestoneTasks = byMilestone.get(milestone.id) ?? [];
      return {
        milestone,
        totals: summariseStatuses(milestoneTasks),
        deliverables: repo.listDeliverables(db, milestone.id),
        tasks: milestoneTasks.sort(byAttention),
      };
    });
    const unassigned = (unassignedByWorkstream.get(workstream.id) ?? []).sort(byAttention);
    const workstreamTasks = [...milestones.flatMap((m) => m.tasks), ...unassigned];
    return {
      workstream,
      totals: summariseStatuses(workstreamTasks),
      milestones,
      unassignedTasks: unassigned,
    };
  });

  return { project, totals: summariseStatuses(tasks), workstreams };
}

/** Create a project with its workstreams in one call — used by the seed. */
export function createProjectWithWorkstreams(
  db: Database,
  actor: Actor,
  input: {
    code: string;
    name: string;
    description?: string | null;
    leadId?: string | null;
    workstreams: { code?: string; name: string; description?: string | null }[];
  },
): { project: Project; workstreams: Workstream[] } {
  return transaction(db, () => {
    const project = createProject(db, actor, input);
    const workstreams = input.workstreams.map((ws) =>
      createWorkstream(db, actor, { ...ws, projectId: project.id }),
    );
    return { project, workstreams };
  });
}

// --- editing and removal ---------------------------------------------------

/**
 * Deleting structure refuses while anything hangs off it.
 *
 * A cascade here would be a month of work disappearing behind one click, with
 * no undo. Emptying the node first is a nuisance exactly once; losing tasks
 * silently is a nuisance forever.
 */
function assertEmpty(
  db: Database,
  kind: 'project' | 'workstream' | 'milestone' | 'deliverable',
  id: string,
): void {
  const children = repo.countChildren(db, kind, id);
  const blocking = Object.entries(children).filter(([, n]) => n > 0);
  if (blocking.length === 0) return;
  const detail = blocking.map(([what, n]) => `${n} ${what}`).join(', ');
  throw conflict(
    `This ${kind} still holds ${detail}. Move or delete them first — deleting it would take them too.`,
  );
}

export function updateProject(
  db: Database,
  actor: Actor,
  id: string,
  patch: { name?: string; code?: string; description?: string | null; leadId?: string | null },
): Project {
  assertCan(actor.role, Capability.CreateProject);
  if (!repo.findProjectById(db, id)) throw notFound('Project');
  if (patch.code !== undefined) {
    const code = patch.code.toUpperCase();
    assertCode(code, 'code');
    const clash = repo.findProjectByCode(db, code);
    if (clash && clash.id !== id) throw conflict(`A project with code "${code}" already exists.`);
    patch.code = code;
  }
  repo.updateProject(db, id, patch);
  const updated = repo.findProjectById(db, id);
  if (!updated) throw notFound('Project');
  return updated;
}

export function updateWorkstream(
  db: Database,
  actor: Actor,
  id: string,
  patch: { name?: string; code?: string; description?: string | null },
): Workstream {
  assertCan(actor.role, Capability.CreateWorkstream);
  const existing = repo.findWorkstreamById(db, id);
  if (!existing) throw notFound('Workstream');
  if (patch.code !== undefined) {
    const code = patch.code.toUpperCase();
    assertCode(code, 'code');
    const clash = repo
      .listWorkstreams(db, existing.projectId)
      .some((w) => w.code === code && w.id !== id);
    if (clash) throw conflict(`Workstream code "${code}" is already used in this project.`);
    patch.code = code;
  }
  repo.updateWorkstream(db, id, patch);
  const updated = repo.findWorkstreamById(db, id);
  if (!updated) throw notFound('Workstream');
  return updated;
}

export function updateMilestone(
  db: Database,
  actor: Actor,
  id: string,
  patch: Parameters<typeof repo.updateMilestone>[2],
): Milestone {
  assertCan(actor.role, Capability.CreateMilestone);
  const existing = repo.findMilestoneById(db, id);
  if (!existing) throw notFound('Milestone');
  // Checked against what is stored, not just against the patch: moving one end
  // past the other is the same mistake whether or not both arrive together.
  const start = patch.startDate ?? existing.startDate;
  const end = patch.endDate ?? existing.endDate;
  if (start !== null && end !== null && end < start) {
    throw validationError('The milestone ends before it starts', [
      { path: 'endDate', message: 'must be on or after the start date' },
    ]);
  }
  repo.updateMilestone(db, id, patch);
  const updated = repo.findMilestoneById(db, id);
  if (!updated) throw notFound('Milestone');
  return updated;
}

export function updateDeliverable(
  db: Database,
  actor: Actor,
  id: string,
  patch: Parameters<typeof repo.updateDeliverable>[2],
): Deliverable {
  assertCan(actor.role, Capability.CreateDeliverable);
  if (!repo.findDeliverableById(db, id)) throw notFound('Deliverable');
  repo.updateDeliverable(db, id, patch);
  const updated = repo.findDeliverableById(db, id);
  if (!updated) throw notFound('Deliverable');
  return updated;
}

export function deleteProject(db: Database, actor: Actor, id: string): void {
  assertCan(actor.role, Capability.CreateProject);
  if (!repo.findProjectById(db, id)) throw notFound('Project');
  assertEmpty(db, 'project', id);
  repo.deleteProject(db, id);
}

export function deleteWorkstream(db: Database, actor: Actor, id: string): void {
  assertCan(actor.role, Capability.CreateWorkstream);
  if (!repo.findWorkstreamById(db, id)) throw notFound('Workstream');
  assertEmpty(db, 'workstream', id);
  repo.deleteWorkstream(db, id);
}

export function deleteMilestone(db: Database, actor: Actor, id: string): void {
  assertCan(actor.role, Capability.CreateMilestone);
  if (!repo.findMilestoneById(db, id)) throw notFound('Milestone');
  assertEmpty(db, 'milestone', id);
  repo.deleteMilestone(db, id);
}

export function deleteDeliverable(db: Database, actor: Actor, id: string): void {
  assertCan(actor.role, Capability.CreateDeliverable);
  if (!repo.findDeliverableById(db, id)) throw notFound('Deliverable');
  assertEmpty(db, 'deliverable', id);
  repo.deleteDeliverable(db, id);
}

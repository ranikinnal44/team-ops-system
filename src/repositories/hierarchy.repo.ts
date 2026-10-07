/**
 * The Project > Workstream > Milestone > Deliverable hierarchy.
 */
import type { Database } from '../db/connection.ts';
import { toBool, fromBool, toText } from '../db/connection.ts';
import type { Project, Workstream, Milestone, Deliverable } from '../domain/types.ts';
import { newId } from '../lib/ids.ts';
import { nowTimestamp, type IsoDate } from '../lib/dates.ts';

// --- projects -------------------------------------------------------------

type ProjectRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  lead_id: string | null;
  archived: number;
  created_at: string;
};

const mapProject = (row: ProjectRow): Project => ({
  id: row.id,
  code: row.code,
  name: row.name,
  description: toText(row.description),
  leadId: toText(row.lead_id),
  archived: toBool(row.archived),
  createdAt: row.created_at,
});

export type NewProject = { code: string; name: string; description?: string | null; leadId?: string | null };

export function createProject(db: Database, input: NewProject): Project {
  const project: Project = {
    id: newId(),
    code: input.code.toUpperCase(),
    name: input.name,
    description: input.description ?? null,
    leadId: input.leadId ?? null,
    archived: false,
    createdAt: nowTimestamp(),
  };
  db.prepare(
    `INSERT INTO projects (id, code, name, description, lead_id, archived, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    project.id,
    project.code,
    project.name,
    project.description,
    project.leadId,
    fromBool(project.archived),
    project.createdAt,
  );
  return project;
}

export function findProjectById(db: Database, id: string): Project | null {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
  return row ? mapProject(row) : null;
}

export function findProjectByCode(db: Database, code: string): Project | null {
  const row = db.prepare('SELECT * FROM projects WHERE code = ?').get(code.toUpperCase()) as
    | ProjectRow
    | undefined;
  return row ? mapProject(row) : null;
}

export function listProjects(db: Database): Project[] {
  return (db.prepare('SELECT * FROM projects ORDER BY archived, name').all() as ProjectRow[]).map(
    mapProject,
  );
}

// --- workstreams ----------------------------------------------------------

type WorkstreamRow = {
  id: string;
  project_id: string;
  code: string;
  name: string;
  description: string | null;
  created_at: string;
};

const mapWorkstream = (row: WorkstreamRow): Workstream => ({
  id: row.id,
  projectId: row.project_id,
  code: row.code,
  name: row.name,
  description: toText(row.description),
  createdAt: row.created_at,
});

export type NewWorkstream = {
  projectId: string;
  code: string;
  name: string;
  description?: string | null;
};

export function createWorkstream(db: Database, input: NewWorkstream): Workstream {
  const workstream: Workstream = {
    id: newId(),
    projectId: input.projectId,
    code: input.code.toUpperCase(),
    name: input.name,
    description: input.description ?? null,
    createdAt: nowTimestamp(),
  };
  db.prepare(
    `INSERT INTO workstreams (id, project_id, code, name, description, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    workstream.id,
    workstream.projectId,
    workstream.code,
    workstream.name,
    workstream.description,
    workstream.createdAt,
  );
  return workstream;
}

export function findWorkstreamById(db: Database, id: string): Workstream | null {
  const row = db.prepare('SELECT * FROM workstreams WHERE id = ?').get(id) as
    | WorkstreamRow
    | undefined;
  return row ? mapWorkstream(row) : null;
}

export function listWorkstreams(db: Database, projectId?: string): Workstream[] {
  const rows = (
    projectId
      ? db.prepare('SELECT * FROM workstreams WHERE project_id = ? ORDER BY name').all(projectId)
      : db.prepare('SELECT * FROM workstreams ORDER BY name').all()
  ) as WorkstreamRow[];
  return rows.map(mapWorkstream);
}

// --- milestones -----------------------------------------------------------

type MilestoneRow = {
  id: string;
  workstream_id: string;
  name: string;
  description: string | null;
  target_date: string | null;
  timeline_label: string | null;
  start_date: string | null;
  end_date: string | null;
  long_lead_items: string | null;
  source_ref: string | null;
  created_at: string;
};

const mapMilestone = (row: MilestoneRow): Milestone => ({
  id: row.id,
  workstreamId: row.workstream_id,
  name: row.name,
  description: toText(row.description),
  targetDate: toText(row.target_date),
  timelineLabel: toText(row.timeline_label),
  startDate: toText(row.start_date),
  endDate: toText(row.end_date),
  // Stored one per line; empty string means none rather than one blank item.
  longLeadItems: (row.long_lead_items ?? '').split('\n').filter(Boolean),
  sourceRef: toText(row.source_ref),
  createdAt: row.created_at,
});

export type NewMilestone = {
  workstreamId: string;
  name: string;
  description?: string | null;
  targetDate?: IsoDate | null;
  timelineLabel?: string | null;
  startDate: IsoDate;
  endDate: IsoDate;
  longLeadItems?: readonly string[];
  sourceRef?: string | null;
};

export function createMilestone(db: Database, input: NewMilestone): Milestone {
  const milestone: Milestone = {
    id: newId(),
    workstreamId: input.workstreamId,
    name: input.name,
    description: input.description ?? null,
    targetDate: input.targetDate ?? null,
    timelineLabel: input.timelineLabel ?? null,
    startDate: input.startDate,
    endDate: input.endDate,
    longLeadItems: input.longLeadItems ?? [],
    sourceRef: input.sourceRef ?? null,
    createdAt: nowTimestamp(),
  };
  db.prepare(
    `INSERT INTO milestones
       (id, workstream_id, name, description, target_date,
        timeline_label, start_date, end_date, long_lead_items, source_ref, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    milestone.id,
    milestone.workstreamId,
    milestone.name,
    milestone.description,
    milestone.targetDate,
    milestone.timelineLabel,
    milestone.startDate,
    milestone.endDate,
    milestone.longLeadItems.join('\n'),
    milestone.sourceRef,
    milestone.createdAt,
  );
  return milestone;
}

export function findMilestoneById(db: Database, id: string): Milestone | null {
  const row = db.prepare('SELECT * FROM milestones WHERE id = ?').get(id) as
    | MilestoneRow
    | undefined;
  return row ? mapMilestone(row) : null;
}

export function listMilestones(db: Database, workstreamId?: string): Milestone[] {
  const rows = (
    workstreamId
      ? db
          .prepare(
            `SELECT * FROM milestones WHERE workstream_id = ?
             ORDER BY (start_date IS NULL), start_date, target_date, name`,
          )
          .all(workstreamId)
      : db
          .prepare(
            'SELECT * FROM milestones ORDER BY (start_date IS NULL), start_date, target_date, name',
          )
          .all()
  ) as MilestoneRow[];
  return rows.map(mapMilestone);
}

/**
 * Resolve the full ancestry of a milestone in one query. Task creation needs
 * the project and workstream codes to mint a reference.
 */
export type MilestoneAncestry = {
  milestoneId: string;
  milestoneName: string;
  workstreamId: string;
  workstreamCode: string;
  workstreamName: string;
  projectId: string;
  projectCode: string;
  projectName: string;
};

export type WorkstreamAncestry = {
  workstreamId: string;
  workstreamCode: string;
  workstreamName: string;
  projectId: string;
  projectCode: string;
  projectName: string;
};

/**
 * Resolve a workstream to its project. Task references are minted from this,
 * so it must work for tasks that have no milestone yet.
 */
export function findWorkstreamAncestry(db: Database, workstreamId: string): WorkstreamAncestry | null {
  const row = db
    .prepare(
      `SELECT w.id AS workstream_id, w.code AS workstream_code, w.name AS workstream_name,
              p.id AS project_id,    p.code AS project_code,    p.name AS project_name
       FROM workstreams w
       JOIN projects p ON p.id = w.project_id
       WHERE w.id = ?`,
    )
    .get(workstreamId) as Record<string, string> | undefined;
  if (!row) return null;
  return {
    workstreamId: row.workstream_id as string,
    workstreamCode: row.workstream_code as string,
    workstreamName: row.workstream_name as string,
    projectId: row.project_id as string,
    projectCode: row.project_code as string,
    projectName: row.project_name as string,
  };
}

export function findMilestoneAncestry(db: Database, milestoneId: string): MilestoneAncestry | null {
  const row = db
    .prepare(
      `SELECT m.id   AS milestone_id,   m.name AS milestone_name,
              w.id   AS workstream_id,  w.code AS workstream_code, w.name AS workstream_name,
              p.id   AS project_id,     p.code AS project_code,    p.name AS project_name
       FROM milestones m
       JOIN workstreams w ON w.id = m.workstream_id
       JOIN projects    p ON p.id = w.project_id
       WHERE m.id = ?`,
    )
    .get(milestoneId) as Record<string, string> | undefined;
  if (!row) return null;
  return {
    milestoneId: row.milestone_id as string,
    milestoneName: row.milestone_name as string,
    workstreamId: row.workstream_id as string,
    workstreamCode: row.workstream_code as string,
    workstreamName: row.workstream_name as string,
    projectId: row.project_id as string,
    projectCode: row.project_code as string,
    projectName: row.project_name as string,
  };
}

// --- deliverables ---------------------------------------------------------

type DeliverableRow = {
  id: string;
  milestone_id: string;
  name: string;
  description: string | null;
  due_label: string | null;
  due_date: string | null;
  critical: number;
  source_ref: string | null;
  created_at: string;
};

const mapDeliverable = (row: DeliverableRow): Deliverable => ({
  id: row.id,
  milestoneId: row.milestone_id,
  name: row.name,
  description: toText(row.description),
  dueLabel: toText(row.due_label),
  dueDate: toText(row.due_date),
  critical: toBool(row.critical),
  sourceRef: toText(row.source_ref),
  createdAt: row.created_at,
});

export type NewDeliverable = {
  milestoneId: string;
  name: string;
  description?: string | null;
  dueLabel?: string | null;
  dueDate: IsoDate;
  critical?: boolean;
  sourceRef?: string | null;
};

export function createDeliverable(db: Database, input: NewDeliverable): Deliverable {
  const deliverable: Deliverable = {
    id: newId(),
    milestoneId: input.milestoneId,
    name: input.name,
    description: input.description ?? null,
    dueLabel: input.dueLabel ?? null,
    dueDate: input.dueDate,
    critical: input.critical ?? false,
    sourceRef: input.sourceRef ?? null,
    createdAt: nowTimestamp(),
  };
  db.prepare(
    `INSERT INTO deliverables
       (id, milestone_id, name, description, due_label, due_date, critical, source_ref, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    deliverable.id,
    deliverable.milestoneId,
    deliverable.name,
    deliverable.description,
    deliverable.dueLabel,
    deliverable.dueDate,
    fromBool(deliverable.critical),
    deliverable.sourceRef,
    deliverable.createdAt,
  );
  return deliverable;
}

export function findDeliverableById(db: Database, id: string): Deliverable | null {
  const row = db.prepare('SELECT * FROM deliverables WHERE id = ?').get(id) as
    | DeliverableRow
    | undefined;
  return row ? mapDeliverable(row) : null;
}

export function listDeliverables(db: Database, milestoneId?: string): Deliverable[] {
  const rows = (
    milestoneId
      ? db.prepare('SELECT * FROM deliverables WHERE milestone_id = ? ORDER BY name').all(milestoneId)
      : db.prepare('SELECT * FROM deliverables ORDER BY name').all()
  ) as DeliverableRow[];
  return rows.map(mapDeliverable);
}

/**
 * Reserve the next task number for a project. The insert-or-increment and the
 * read happen inside the caller's transaction, so two concurrent task
 * creations can never be handed the same sequence.
 */
export function nextTaskSequence(db: Database, projectId: string): number {
  db.prepare(
    `INSERT INTO task_ref_sequences (project_id, next_sequence)
     VALUES (?, 1)
     ON CONFLICT(project_id) DO UPDATE SET next_sequence = next_sequence + 1`,
  ).run(projectId);
  const row = db
    .prepare('SELECT next_sequence FROM task_ref_sequences WHERE project_id = ?')
    .get(projectId) as { next_sequence: number };
  return row.next_sequence;
}

// --- editing and removal ---------------------------------------------------
//
// Structure gets built up by hand, so it also has to be correctable. Deletes
// refuse rather than cascade: losing a workstream should never silently take
// a month of tasks with it.

export function updateProject(
  db: Database,
  id: string,
  patch: { name?: string; code?: string; description?: string | null; leadId?: string | null },
): void {
  const columns: Record<string, string> = {
    name: 'name',
    code: 'code',
    description: 'description',
    leadId: 'lead_id',
  };
  applyPatch(db, 'projects', columns, id, patch);
}

export function updateWorkstream(
  db: Database,
  id: string,
  patch: { name?: string; code?: string; description?: string | null },
): void {
  applyPatch(db, 'workstreams', { name: 'name', code: 'code', description: 'description' }, id, patch);
}

export function updateMilestone(
  db: Database,
  id: string,
  patch: {
    name?: string;
    description?: string | null;
    targetDate?: IsoDate | null;
    startDate?: IsoDate;
    endDate?: IsoDate;
    timelineLabel?: string | null;
    longLeadItems?: readonly string[];
  },
): void {
  const { longLeadItems, ...rest } = patch;
  const columns: Record<string, string> = {
    name: 'name',
    description: 'description',
    targetDate: 'target_date',
    startDate: 'start_date',
    endDate: 'end_date',
    timelineLabel: 'timeline_label',
  };
  const normalised: Record<string, unknown> = { ...rest };
  if (longLeadItems !== undefined) {
    columns.longLeadItems = 'long_lead_items';
    normalised.longLeadItems = longLeadItems.join('\n');
  }
  applyPatch(db, 'milestones', columns, id, normalised);
}

export function updateDeliverable(
  db: Database,
  id: string,
  patch: {
    name?: string;
    description?: string | null;
    dueLabel?: string | null;
    dueDate?: IsoDate;
    critical?: boolean;
  },
): void {
  const { critical, ...rest } = patch;
  const columns: Record<string, string> = {
    name: 'name',
    description: 'description',
    dueLabel: 'due_label',
    dueDate: 'due_date',
  };
  const normalised: Record<string, unknown> = { ...rest };
  if (critical !== undefined) {
    columns.critical = 'critical';
    normalised.critical = fromBool(critical);
  }
  applyPatch(db, 'deliverables', columns, id, normalised);
}

function applyPatch(
  db: Database,
  table: string,
  columns: Record<string, string>,
  id: string,
  patch: Record<string, unknown>,
): void {
  const entries = Object.entries(patch).filter(([key]) => key in columns && patch[key] !== undefined);
  if (entries.length === 0) return;
  const assignments = entries.map(([key]) => `${columns[key]} = ?`).join(', ');
  db.prepare(`UPDATE ${table} SET ${assignments} WHERE id = ?`).run(
    ...entries.map(([, value]) => value as string | number | null),
    id,
  );
}

/** How many records hang off a node, so a delete can refuse with a reason. */
export function countChildren(
  db: Database,
  kind: 'project' | 'workstream' | 'milestone' | 'deliverable',
  id: string,
): Record<string, number> {
  const one = (sql: string): number => (db.prepare(sql).get(id) as { n: number }).n;
  switch (kind) {
    case 'project':
      return {
        workstreams: one('SELECT COUNT(*) n FROM workstreams WHERE project_id = ?'),
        tasks: one(
          `SELECT COUNT(*) n FROM tasks t JOIN workstreams w ON w.id = t.workstream_id
           WHERE w.project_id = ?`,
        ),
      };
    case 'workstream':
      return {
        milestones: one('SELECT COUNT(*) n FROM milestones WHERE workstream_id = ?'),
        tasks: one('SELECT COUNT(*) n FROM tasks WHERE workstream_id = ?'),
      };
    case 'milestone':
      return {
        deliverables: one('SELECT COUNT(*) n FROM deliverables WHERE milestone_id = ?'),
        tasks: one('SELECT COUNT(*) n FROM tasks WHERE milestone_id = ?'),
        supplyItems: one('SELECT COUNT(*) n FROM supply_items WHERE milestone_id = ?'),
      };
    case 'deliverable':
      return { tasks: one('SELECT COUNT(*) n FROM tasks WHERE deliverable_id = ?') };
  }
}

export function deleteProject(db: Database, id: string): void {
  db.prepare('DELETE FROM projects WHERE id = ?').run(id);
}
export function deleteWorkstream(db: Database, id: string): void {
  db.prepare('DELETE FROM workstreams WHERE id = ?').run(id);
}
export function deleteMilestone(db: Database, id: string): void {
  db.prepare('DELETE FROM milestones WHERE id = ?').run(id);
}
export function deleteDeliverable(db: Database, id: string): void {
  db.prepare('DELETE FROM deliverables WHERE id = ?').run(id);
}

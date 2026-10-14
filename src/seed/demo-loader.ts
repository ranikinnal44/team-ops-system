/**
 * Demo dataset loader.
 *
 * Materialises the declarative demo dataset. Kept alongside the real AutoDock
 * import so development and tests have a dataset that exercises every status,
 * exception and deadline path — which real imported data deliberately does not,
 * because it carries no deadlines.
 */
import type { Database } from '../db/connection.ts';
import { transaction } from '../db/connection.ts';
import * as userRepo from '../repositories/user.repo.ts';
import { hashPasscode } from '../lib/passcode.ts';
import { seedPasscode } from './passcodes.ts';
import * as hierarchyRepo from '../repositories/hierarchy.repo.ts';
import * as taskRepo from '../repositories/task.repo.ts';
import * as activityRepo from '../repositories/activity.repo.ts';
import * as deadlineRepo from '../repositories/deadline.repo.ts';
import { DEMO_DATA, type DemoDataset, type DemoTask } from './demo-data.ts';
import { TaskStatus, HistoryKind, STATUS_LABEL, PRIORITY_LABEL, ScheduleState } from '../domain/enums.ts';
import { formatTaskRef } from '../lib/ids.ts';
import {
  todayDate,
  addDays,
  formatDateHuman,
  daysBetween,
  workingDaysInclusive,
  nextWorkingDay,
  type IsoDate,
  type IsoTimestamp,
} from '../lib/dates.ts';
import { describeSchedule } from '../domain/task-schedule.ts';

/** An ISO timestamp `days` before now, at a fixed hour, for stable ordering. */
function atDaysAgo(days: number, hour = 10, minute = 0): IsoTimestamp {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

type Resolved = {
  users: Map<string, string>;
  milestones: Map<string, string>;
  deliverables: Map<string, string>;
  tasks: Map<string, string>;
};

/**
 * Build a believable activity log for a seeded task from its end state, so the
 * Activity History screen has something real to show on first run.
 */
function synthesiseHistory(
  db: Database,
  taskId: string,
  task: DemoTask,
  ownerName: string,
  createdAt: IsoTimestamp,
  createdDaysAgo: number,
  lastUpdatedAt: IsoTimestamp,
  actorId: string,
  ownerId: string,
): void {
  const today = todayDate();
  const startDate = addDays(today, task.startInDays);
  const dueDate = addDays(today, task.dueInDays);
  activityRepo.appendHistory(db, {
    taskId,
    actorId,
    kind: HistoryKind.Created,
    note:
      `Task created and assigned to ${ownerName}, ` +
      `${describeSchedule(startDate, dueDate)} (${PRIORITY_LABEL[task.priority]}).`,
    createdAt,
  });

  if (task.dayOutcomes && task.dayOutcomes.length > 1) {
    activityRepo.appendHistory(db, {
      taskId,
      actorId,
      kind: HistoryKind.FieldChanged,
      field: 'dayPlans',
      fromValue: null,
      toValue: task.dayOutcomes
        .map((outcome, i) => `${formatDateHuman(addDays(startDate, i))}: ${outcome}`)
        .join(' \u00b7 '),
      note: `Outcomes defined for each of the ${task.dayOutcomes.length} days.`,
      createdAt,
    });
  }

  if (task.status === TaskStatus.NotStarted) return;

  // Work begins after it was raised, which is not the same as its start date:
  // a task can be re-planned into a window near its deadline long after it
  // was created.
  const startedAt = atDaysAgo(Math.max(1, createdDaysAgo - 1), 9, 30);
  activityRepo.appendHistory(db, {
    taskId,
    actorId: ownerId,
    kind: HistoryKind.StatusChanged,
    field: 'status',
    fromValue: STATUS_LABEL[TaskStatus.NotStarted],
    toValue: STATUS_LABEL[TaskStatus.InProgress],
    createdAt: startedAt,
  });

  if ((task.progress ?? 0) > 0) {
    activityRepo.appendHistory(db, {
      taskId,
      actorId: ownerId,
      kind: HistoryKind.ProgressChanged,
      field: 'progress',
      fromValue: '0%',
      toValue: `${task.progress}%`,
      createdAt: lastUpdatedAt,
    });
  }

  if (task.blocker) {
    activityRepo.appendHistory(db, {
      taskId,
      actorId: ownerId,
      kind: HistoryKind.BlockerAdded,
      field: 'blocker',
      fromValue: null,
      toValue: task.blocker,
      createdAt: lastUpdatedAt,
    });
  }

  if (task.evidenceUrl) {
    activityRepo.appendHistory(db, {
      taskId,
      actorId: ownerId,
      kind: HistoryKind.EvidenceLinked,
      field: 'evidenceUrl',
      fromValue: null,
      toValue: task.evidenceUrl,
      createdAt: lastUpdatedAt,
    });
  }

  if (task.status !== TaskStatus.InProgress) {
    activityRepo.appendHistory(db, {
      taskId,
      actorId: ownerId,
      kind: HistoryKind.StatusChanged,
      field: 'status',
      fromValue: STATUS_LABEL[TaskStatus.InProgress],
      toValue: STATUS_LABEL[task.status],
      createdAt: lastUpdatedAt,
    });
  }
}

/**
 * Demo dates land on working days.
 *
 * The offsets are plain calendar days from "today", so running the seed on the
 * wrong weekday used to put a task entirely on a Saturday — a window with no
 * working days in it, which cannot be worked, budgeted or extended. Nudging
 * each end forward to the next working day keeps the dataset close to what it
 * says while making every task a real one.
 */
const demoStart = (today: IsoDate, startInDays: number): IsoDate =>
  nextWorkingDay(addDays(today, startInDays));

const demoDue = (today: IsoDate, startInDays: number, dueInDays: number): IsoDate => {
  const start = demoStart(today, startInDays);
  const due = nextWorkingDay(addDays(today, dueInDays));
  return daysBetween(start, due) < 0 ? start : due;
};

const demoEffort = (today: IsoDate, startInDays: number, dueInDays: number): number =>
  workingDaysInclusive(demoStart(today, startInDays), demoDue(today, startInDays, dueInDays)) || 1;

export function seedDemo(db: Database, dataset: DemoDataset = DEMO_DATA): void {
  const today = todayDate();
  const resolved: Resolved = {
    users: new Map(),
    milestones: new Map(),
    deliverables: new Map(),
    tasks: new Map(),
  };

  transaction(db, () => {
    for (const demoUser of dataset.users) {
      const user = userRepo.createUser(db, {
        name: demoUser.name,
        email: demoUser.email,
        role: demoUser.role,
        title: demoUser.title,
        // Each person gets their own; the seed prints them at the end.
        passcodeHash: hashPasscode(seedPasscode(demoUser.email)),
      });
      resolved.users.set(demoUser.key, user.id);
    }

    const requireUser = (key: string): string => {
      const id = resolved.users.get(key);
      if (!id) throw new Error(`Demo data references unknown user key "${key}"`);
      return id;
    };

    const projectIdByKey = new Map<string, string>();
    for (const demoProject of dataset.projects) {
      const project = hierarchyRepo.createProject(db, {
        code: demoProject.code,
        name: demoProject.name,
        description: demoProject.description,
        leadId: requireUser(demoProject.leadKey),
      });
      projectIdByKey.set(demoProject.key, project.id);

      for (const demoWorkstream of demoProject.workstreams) {
        const workstream = hierarchyRepo.createWorkstream(db, {
          projectId: project.id,
          code: demoWorkstream.code,
          name: demoWorkstream.name,
        });
        for (const demoMilestone of demoWorkstream.milestones) {
          const milestone = hierarchyRepo.createMilestone(db, {
            workstreamId: workstream.id,
            name: demoMilestone.name,
            // Milestones hold no dates; the demo data's `targetInDays` is left
            // for the tasks under them, which is where dates live now.
            timelineLabel: `~${demoMilestone.targetInDays} days out`,
          });
          resolved.milestones.set(demoMilestone.key, milestone.id);
          for (const demoDeliverable of demoMilestone.deliverables ?? []) {
            const deliverable = hierarchyRepo.createDeliverable(db, {
              milestoneId: milestone.id,
              name: demoDeliverable.name,
            });
            resolved.deliverables.set(demoDeliverable.key, deliverable.id);
          }
        }
      }
    }

    const managerId = requireUser(dataset.users.find((u) => u.role === 'manager')?.key ?? 'mgr');

    // Pass 1: create every task, so dependencies can be resolved afterwards.
    for (const demoTask of dataset.tasks) {
      const milestoneId = resolved.milestones.get(demoTask.milestoneKey);
      if (!milestoneId) {
        throw new Error(`Demo data references unknown milestone key "${demoTask.milestoneKey}"`);
      }
      const ancestry = hierarchyRepo.findMilestoneAncestry(db, milestoneId);
      if (!ancestry) throw new Error(`Milestone ${milestoneId} has no ancestry`);

      const sequence = hierarchyRepo.nextTaskSequence(db, ancestry.projectId);
      const ref = formatTaskRef(ancestry.projectCode, ancestry.workstreamCode, sequence);
      const ownerId = requireUser(demoTask.ownerKey);

      const taskId = taskRepo.insertTask(db, {
        ref,
        workstreamId: ancestry.workstreamId,
        milestoneId,
        deliverableId: demoTask.deliverableKey
          ? (resolved.deliverables.get(demoTask.deliverableKey) ?? null)
          : null,
        title: demoTask.title,
        description: demoTask.description,
        ownerId,
        reviewerId: demoTask.reviewerKey ? requireUser(demoTask.reviewerKey) : null,
        priority: demoTask.priority,
        status: demoTask.status,
        progress: demoTask.progress ?? (demoTask.status === TaskStatus.Completed ? 100 : 0),
        // Snapped to working days. Counting plain calendar days from "today"
        // puts a task on a Saturday whenever the seed is run on the wrong
        // weekday, and a task with no working days in it cannot be worked,
        // extended, or honestly budgeted.
        startDate: demoStart(today, demoTask.startInDays),
        dueDate: demoDue(today, demoTask.startInDays, demoTask.dueInDays),
        // Demo tasks arrive already scheduled, so the dataset exercises
        // working tasks rather than a backlog of unscheduled ones.
        effortDays: demoEffort(today, demoTask.startInDays, demoTask.dueInDays),
        scheduleState: ScheduleState.Locked,
        nextAction: demoTask.nextAction ?? null,
        createdById: managerId,
        supportingMemberIds: (demoTask.supportKeys ?? []).map(requireUser),
        dependencyTaskIds: [],
      });
      resolved.tasks.set(demoTask.key, taskId);

      taskRepo.updateTaskColumns(db, taskId, {
        blocker: demoTask.blocker ?? null,
        evidenceUrl: demoTask.evidenceUrl ?? null,
      });

      const createdDaysAgo = demoTask.createdDaysAgo ?? Math.max(0, -demoTask.startInDays);
      const updatedDaysAgo = demoTask.lastUpdatedDaysAgo ?? 0;
      const createdAt = atDaysAgo(createdDaysAgo, 9, 0);
      const lastUpdatedAt = atDaysAgo(updatedDaysAgo, 15, 30);
      taskRepo.overrideTaskTimestamps(db, taskId, {
        createdAt,
        lastUpdatedAt,
        completedAt: demoTask.status === TaskStatus.Completed ? lastUpdatedAt : null,
      });

      const ownerName = dataset.users.find((u) => u.key === demoTask.ownerKey)?.name ?? 'Unknown';
      synthesiseHistory(
        db,
        taskId,
        demoTask,
        ownerName,
        createdAt,
        createdDaysAgo,
        lastUpdatedAt,
        managerId,
        ownerId,
      );

      for (const comment of demoTask.comments ?? []) {
        activityRepo.insertComment(db, {
          taskId,
          authorId: requireUser(comment.authorKey),
          body: comment.body,
          createdAt: atDaysAgo(comment.daysAgo, 14, 0),
        });
      }
    }

    // Pass 2: wire dependencies now that every task id exists.
    for (const demoTask of dataset.tasks) {
      if (!demoTask.dependsOnKeys || demoTask.dependsOnKeys.length === 0) continue;
      const taskId = resolved.tasks.get(demoTask.key);
      if (!taskId) continue;
      const dependencyIds = demoTask.dependsOnKeys.map((key) => {
        const id = resolved.tasks.get(key);
        if (!id) throw new Error(`Demo data references unknown task key "${key}"`);
        return id;
      });
      taskRepo.replaceDependencies(db, taskId, dependencyIds);
    }

    for (const request of dataset.deadlineRequests) {
      const taskId = resolved.tasks.get(request.taskKey);
      if (!taskId) throw new Error(`Demo data references unknown task key "${request.taskKey}"`);
      const task = taskRepo.findTaskById(db, taskId);
      if (!task || task.dueDate === null) continue;
      const createdAt = atDaysAgo(request.daysAgo, 11, 0);
      // The demo asks for one more working day than the task is budgeted.
      const currentEffortDays = task.effortDays ?? 1;
      deadlineRepo.insertDeadlineRequest(db, {
        taskId,
        requestedById: requireUser(request.requestedByKey),
        currentEffortDays,
        requestedEffortDays: currentEffortDays + 1,
        reason: request.reason,
        createdAt,
      });
      activityRepo.appendHistory(db, {
        taskId,
        actorId: requireUser(request.requestedByKey),
        kind: HistoryKind.DeadlineChangeRequested,
        field: 'effortDays',
        fromValue: `${currentEffortDays} working days`,
        toValue: `${currentEffortDays + 1} working days`,
        note: request.reason,
        createdAt,
      });
    }
  });
}


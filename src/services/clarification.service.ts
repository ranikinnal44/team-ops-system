/**
 * The "Requires Clarification" queue.
 *
 * Everything the import could not establish lands here instead of being
 * defaulted. Managers work the queue; employees see only items on their own
 * tasks, so the list is actionable rather than a wall of project-wide noise.
 */
import type { Database } from '../db/connection.ts';
import * as clarificationRepo from '../repositories/clarification.repo.ts';
import * as taskRepo from '../repositories/task.repo.ts';
import type { Actor, TaskView, TaskClarification } from '../domain/types.ts';
import { Role, CLARIFICATION_LABEL, type ClarificationCode } from '../domain/enums.ts';
import { Capability, assertCan, assertCanViewTask } from '../domain/permissions.ts';
import { notFound } from '../lib/errors.ts';
import { todayDate } from '../lib/dates.ts';
import { toTaskViews } from './task.service.ts';

export type ClarificationGroup = {
  code: ClarificationCode;
  label: string;
  count: number;
  items: { task: TaskView; clarification: TaskClarification }[];
};

export type ClarificationQueue = {
  totalItems: number;
  totalTasks: number;
  groups: ClarificationGroup[];
};

/**
 * Grouped by reason, so a manager can clear one *kind* of gap in one pass —
 * setting 32 deadlines is one sitting, not 32 separate decisions.
 */
export function clarificationQueue(
  db: Database,
  actor: Actor,
  now = new Date(),
): ClarificationQueue {
  const scope = actor.role === Role.Manager ? {} : { participantId: actor.id };
  const tasks = toTaskViews(
    db,
    taskRepo.listTasks(db, { ...scope, needsClarification: true }),
    todayDate(now),
  );
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const grouped = clarificationRepo.listForTasks(
    db,
    tasks.map((t) => t.id),
    { unresolvedOnly: true },
  );

  const groups = new Map<ClarificationCode, ClarificationGroup>();
  let totalItems = 0;
  for (const [taskId, items] of grouped) {
    const task = byId.get(taskId);
    if (!task) continue;
    for (const clarification of items) {
      totalItems += 1;
      const existing = groups.get(clarification.code) ?? {
        code: clarification.code,
        label: CLARIFICATION_LABEL[clarification.code] ?? clarification.code,
        count: 0,
        items: [],
      };
      existing.count += 1;
      existing.items.push({ task, clarification });
      groups.set(clarification.code, existing);
    }
  }

  for (const group of groups.values()) {
    group.items.sort((a, b) => a.task.ref.localeCompare(b.task.ref));
  }

  return {
    totalItems,
    totalTasks: tasks.length,
    groups: [...groups.values()].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
  };
}

/**
 * Dismiss an item without changing the task — for cases a manager judges to be
 * fine as they stand (a duplicate that is genuinely two pieces of work, say).
 * Filling the gap for real resolves it automatically from `updateTask`.
 */
export function resolveClarification(
  db: Database,
  actor: Actor,
  clarificationId: string,
  resolved = true,
): TaskClarification {
  assertCan(actor.role, Capability.ResolveClarification);
  const existing = clarificationRepo.findById(db, clarificationId);
  if (!existing) throw notFound('Clarification');
  const task = taskRepo.findTaskById(db, existing.taskId);
  if (!task) throw notFound('Task');
  assertCanViewTask(actor.role, task, actor.id);

  clarificationRepo.setResolved(db, clarificationId, actor.id, resolved);
  const updated = clarificationRepo.findById(db, clarificationId);
  if (!updated) throw notFound('Clarification');
  return updated;
}

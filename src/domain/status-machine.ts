/**
 * Task status machine.
 *
 * Only the transitions declared here are legal; everything else is rejected.
 *
 * `allow` is deliberately NOT a role test. "The assigned reviewer" is a
 * relationship to one task, not a rank, and a boolean `managerOnly` flag
 * cannot express it. So each transition names who may drive it, and the caller
 * supplies that relationship along with the role:
 *
 *   participant  anyone who may update the task at all (owner or reviewer)
 *   reviewer     the task's assigned reviewer — or a Task Assigner, who is the
 *                escape valve when a reviewer is away
 *   Task Assigner      a Task Assigner only
 *
 * The point of the `reviewer` tier: an owner cannot sign off their own work.
 * Both exits from Review are reviewer-gated, because leaving only the exit to
 * Completed gated would let an owner pull a task back to In Progress and walk
 * it to Completed the long way round.
 */
import { TaskStatus, STATUS_LABEL, Role } from './enums.ts';
import { invalidTransition } from '../lib/errors.ts';
import { isTaskAssigner } from './permissions.ts';

export const TransitionAllow = {
  Participant: 'participant',
  Reviewer: 'reviewer',
  Manager: 'manager',
} as const;
export type TransitionAllow = (typeof TransitionAllow)[keyof typeof TransitionAllow];

export type TransitionRule = {
  readonly from: TaskStatus;
  readonly to: TaskStatus;
  readonly allow: TransitionAllow;
};

/**
 * The actor's relationship to the task being moved. `isReviewer` is what the
 * review gate turns on; a Task Assigner satisfies it regardless, so an absent
 * reviewer never deadlocks a task.
 */
export type TransitionActor = {
  readonly role: Role;
  readonly isOwner: boolean;
  readonly isReviewer: boolean;
};

export function satisfies(actor: TransitionActor, allow: TransitionAllow): boolean {
  if (isTaskAssigner(actor.role)) return true;
  switch (allow) {
    case TransitionAllow.Participant:
      return true;
    case TransitionAllow.Reviewer:
      return actor.isReviewer;
    case TransitionAllow.Manager:
      return false;
  }
}

export const TRANSITIONS: readonly TransitionRule[] = [
  { from: TaskStatus.NotStarted, to: TaskStatus.InProgress, allow: TransitionAllow.Participant },
  { from: TaskStatus.InProgress, to: TaskStatus.Blocked, allow: TransitionAllow.Participant },
  // The owner applies for review; they do not grant it.
  { from: TaskStatus.InProgress, to: TaskStatus.Review, allow: TransitionAllow.Participant },
  { from: TaskStatus.Blocked, to: TaskStatus.InProgress, allow: TransitionAllow.Participant },
  // Signing work off is the reviewer's job, never the owner's.
  { from: TaskStatus.Review, to: TaskStatus.Completed, allow: TransitionAllow.Reviewer },
  // Sending it back is equally the reviewer's, or an owner would simply
  // withdraw from review and complete the task by another route.
  { from: TaskStatus.Review, to: TaskStatus.InProgress, allow: TransitionAllow.Reviewer },
  // Reopening finished work is a correction, so it is reserved for Task Assigners.
  { from: TaskStatus.Completed, to: TaskStatus.InProgress, allow: TransitionAllow.Manager },
];

export function allowedTransitions(
  from: TaskStatus,
  actor: TransitionActor,
): readonly TaskStatus[] {
  return TRANSITIONS.filter((t) => t.from === from && satisfies(actor, t.allow)).map((t) => t.to);
}

export function canTransition(from: TaskStatus, to: TaskStatus, actor: TransitionActor): boolean {
  return allowedTransitions(from, actor).includes(to);
}

/** Throws an `AppError` describing the legal moves when the transition is not allowed. */
export function assertTransition(from: TaskStatus, to: TaskStatus, actor: TransitionActor): void {
  if (from === to) return; // no-op updates are tolerated, not recorded as a change
  if (canTransition(from, to, actor)) return;

  // A move that only the reviewer may make gets its own message: "not allowed
  // from this status" would be misleading when the status is fine and the
  // person is not.
  const rule = TRANSITIONS.find((t) => t.from === from && t.to === to);
  if (rule && rule.allow === TransitionAllow.Reviewer && !actor.isReviewer) {
    throw invalidTransition(
      `Only this task's reviewer can move it from "${STATUS_LABEL[from]}" to ` +
        `"${STATUS_LABEL[to]}". Work is signed off by the person reviewing it, not by its owner.`,
    );
  }

  const legal = allowedTransitions(from, actor);
  const legalText =
    legal.length > 0 ? legal.map((s) => STATUS_LABEL[s]).join(', ') : 'no transitions';
  throw invalidTransition(
    `Cannot move a task from "${STATUS_LABEL[from]}" to "${STATUS_LABEL[to]}". ` +
      `Allowed from "${STATUS_LABEL[from]}" for you: ${legalText}.`,
  );
}

/**
 * The progress percentage implied by a status change, or `null` when the
 * status does not dictate one. Keeps "Completed at 40%" out of the data.
 */
export function progressForStatus(status: TaskStatus): number | null {
  if (status === TaskStatus.Completed) return 100;
  if (status === TaskStatus.NotStarted) return 0;
  return null;
}

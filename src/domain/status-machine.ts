/**
 * Task status machine.
 *
 * Only the transitions declared here are legal; everything else is rejected.
 * `manager_only` transitions exist so a reviewer can reopen work that was
 * closed in error — employees cannot perform them.
 */
import { TaskStatus, STATUS_LABEL, Role } from './enums.ts';
import { invalidTransition } from '../lib/errors.ts';

export type TransitionRule = {
  readonly from: TaskStatus;
  readonly to: TaskStatus;
  readonly managerOnly: boolean;
};

export const TRANSITIONS: readonly TransitionRule[] = [
  { from: TaskStatus.NotStarted, to: TaskStatus.InProgress, managerOnly: false },
  { from: TaskStatus.InProgress, to: TaskStatus.Blocked, managerOnly: false },
  { from: TaskStatus.InProgress, to: TaskStatus.Review, managerOnly: false },
  { from: TaskStatus.Blocked, to: TaskStatus.InProgress, managerOnly: false },
  { from: TaskStatus.Review, to: TaskStatus.Completed, managerOnly: false },
  { from: TaskStatus.Review, to: TaskStatus.InProgress, managerOnly: false },
  // Reopening finished work is a correction, so it is reserved for managers.
  { from: TaskStatus.Completed, to: TaskStatus.InProgress, managerOnly: true },
];

export function allowedTransitions(from: TaskStatus, role: Role): readonly TaskStatus[] {
  return TRANSITIONS.filter((t) => t.from === from && (!t.managerOnly || role === Role.Manager)).map(
    (t) => t.to,
  );
}

export function canTransition(from: TaskStatus, to: TaskStatus, role: Role): boolean {
  return allowedTransitions(from, role).includes(to);
}

/** Throws an `AppError` describing the legal moves when the transition is not allowed. */
export function assertTransition(from: TaskStatus, to: TaskStatus, role: Role): void {
  if (from === to) return; // no-op updates are tolerated, not recorded as a change
  if (canTransition(from, to, role)) return;

  const legal = allowedTransitions(from, role);
  const legalText =
    legal.length > 0 ? legal.map((s) => STATUS_LABEL[s]).join(', ') : 'no transitions';
  throw invalidTransition(
    `Cannot move a task from "${STATUS_LABEL[from]}" to "${STATUS_LABEL[to]}". ` +
      `Allowed from "${STATUS_LABEL[from]}" for this role: ${legalText}.`,
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

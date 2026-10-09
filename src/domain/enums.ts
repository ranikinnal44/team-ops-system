/**
 * Closed vocabularies. Declared as frozen const objects rather than TS `enum`
 * so the source stays erasable (Node strips types at runtime, no transpile).
 */

export const TaskStatus = {
  NotStarted: 'not_started',
  InProgress: 'in_progress',
  Blocked: 'blocked',
  Review: 'review',
  Completed: 'completed',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];
export const TASK_STATUSES = Object.values(TaskStatus) as readonly TaskStatus[];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  not_started: 'Not Started',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  review: 'Review',
  completed: 'Completed',
};

export const Priority = {
  P0: 'P0',
  P1: 'P1',
  P2: 'P2',
  P3: 'P3',
} as const;
export type Priority = (typeof Priority)[keyof typeof Priority];
export const PRIORITIES = Object.values(Priority) as readonly Priority[];

export const PRIORITY_LABEL: Record<Priority, string> = {
  P0: 'P0 — Critical',
  P1: 'P1 — High',
  P2: 'P2 — Normal',
  P3: 'P3 — Low',
};

/** Lower sorts first: P0 is the most urgent. */
export const PRIORITY_RANK: Record<Priority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

export const Role = {
  Manager: 'manager',
  /**
   * Confirms what other people commit to: the dates an owner proposes, the
   * work they submit as done, and the extensions they ask for. Reviews only
   * the tasks they are named on, and can see everything in order to find them.
   */
  Reviewer: 'reviewer',
  Employee: 'employee',
} as const;
export type Role = (typeof Role)[keyof typeof Role];
export const ROLES = Object.values(Role) as readonly Role[];

/**
 * How settled a task's dates are.
 *
 * The manager sets a budget in working days; the employee proposes the dates
 * that spend it; the reviewer approves them. Once approved the dates are
 * locked and only an approved deadline extension moves them.
 */
export const ScheduleState = {
  /** No dates proposed yet, or a proposal was sent back. */
  Unset: 'unset',
  /** Dates submitted by the owner, awaiting the reviewer. */
  Proposed: 'proposed',
  /** Approved and immutable. */
  Locked: 'locked',
} as const;
export type ScheduleState = (typeof ScheduleState)[keyof typeof ScheduleState];
export const SCHEDULE_STATES = Object.values(ScheduleState) as readonly ScheduleState[];

export const SCHEDULE_STATE_LABEL: Record<ScheduleState, string> = {
  unset: 'Dates not set',
  proposed: 'Dates awaiting review',
  locked: 'Dates agreed',
};

/** Exception flags produced by the rule engine in `exceptions.ts`. */
export const ExceptionFlag = {
  Overdue: 'OVERDUE',
  DueSoon: 'DUE_SOON',
  NoRecentUpdate: 'NO_RECENT_UPDATE',
  Blocked: 'BLOCKED',
  /** In progress, but nobody has said what the last working day produced. */
  MissingDailyUpdate: 'MISSING_DAILY_UPDATE',
  /** Assigned, budgeted, but the owner has not proposed dates yet. */
  ScheduleNotSet: 'SCHEDULE_NOT_SET',
  /** Dates proposed; the reviewer has not decided, so work cannot start. */
  ScheduleAwaitingReview: 'SCHEDULE_AWAITING_REVIEW',
} as const;
export type ExceptionFlag = (typeof ExceptionFlag)[keyof typeof ExceptionFlag];
export const EXCEPTION_FLAGS = Object.values(ExceptionFlag) as readonly ExceptionFlag[];

export const EXCEPTION_LABEL: Record<ExceptionFlag, string> = {
  OVERDUE: 'Overdue',
  DUE_SOON: 'Due within 2 days',
  NO_RECENT_UPDATE: 'No recent update',
  BLOCKED: 'Blocked',
  MISSING_DAILY_UPDATE: 'No daily outcome logged',
  SCHEDULE_NOT_SET: 'Needs dates from its owner',
  SCHEDULE_AWAITING_REVIEW: 'Dates awaiting review',
};

/** Kinds of entries in the task activity log. */
export const HistoryKind = {
  Created: 'created',
  /** The record was loaded from an external source, not created in the app. */
  Imported: 'imported',
  StatusChanged: 'status_changed',
  ProgressChanged: 'progress_changed',
  FieldChanged: 'field_changed',
  BlockerAdded: 'blocker_added',
  BlockerCleared: 'blocker_cleared',
  NextActionSet: 'next_action_set',
  EvidenceLinked: 'evidence_linked',
  DayOutcomeRecorded: 'day_outcome_recorded',
  ScheduleProposed: 'schedule_proposed',
  ScheduleApproved: 'schedule_approved',
  ScheduleRejected: 'schedule_rejected',
  EffortChanged: 'effort_changed',
  Reassigned: 'reassigned',
  CommentAdded: 'comment_added',
  DeadlineChangeRequested: 'deadline_change_requested',
  DeadlineChangeApproved: 'deadline_change_approved',
  DeadlineChangeRejected: 'deadline_change_rejected',
} as const;
export type HistoryKind = (typeof HistoryKind)[keyof typeof HistoryKind];

export const DeadlineRequestStatus = {
  Pending: 'pending',
  Approved: 'approved',
  Rejected: 'rejected',
} as const;
export type DeadlineRequestStatus =
  (typeof DeadlineRequestStatus)[keyof typeof DeadlineRequestStatus];

/** Where a record came from. Imported rows keep their raw source values. */
export const Origin = {
  App: 'app',
  Import: 'import',
} as const;
export type Origin = (typeof Origin)[keyof typeof Origin];

/**
 * Reasons a record needs a human decision.
 *
 * The importer raises these instead of guessing. Each one means "the source
 * did not establish this", never "the system failed".
 */
export const ClarificationCode = {
  MissingDueDate: 'MISSING_DUE_DATE',
  /** A multi-day task has days with no stated outcome. */
  MissingDayOutcomes: 'MISSING_DAY_OUTCOMES',
  MissingPriority: 'MISSING_PRIORITY',
  MissingStatus: 'MISSING_STATUS',
  AmbiguousStatus: 'AMBIGUOUS_STATUS',
  UnclearOwner: 'UNCLEAR_OWNER',
  MissingReviewer: 'MISSING_REVIEWER',
  MissingEffortDays: 'MISSING_EFFORT_DAYS',
  OwnershipTransfer: 'OWNERSHIP_TRANSFER',
  MissingMilestone: 'MISSING_MILESTONE',
  MissingDeliverable: 'MISSING_DELIVERABLE',
  TruncatedSourceText: 'TRUNCATED_SOURCE_TEXT',
  PossibleDuplicate: 'POSSIBLE_DUPLICATE',
  MayNeedDecomposition: 'MAY_NEED_DECOMPOSITION',
  UnknownProgress: 'UNKNOWN_PROGRESS',
  /** The workstream was inferred by the importer, not stated in the source. */
  UnclearClassification: 'UNCLEAR_CLASSIFICATION',
  /** A participant was read out of free text rather than a structured field. */
  InferredSupport: 'INFERRED_SUPPORT',
} as const;
export type ClarificationCode = (typeof ClarificationCode)[keyof typeof ClarificationCode];

export const CLARIFICATION_LABEL: Record<ClarificationCode, string> = {
  MISSING_DUE_DATE: 'Needs a deadline',
  MISSING_DAY_OUTCOMES: 'Needs an outcome for each day',
  MISSING_PRIORITY: 'Needs a priority',
  MISSING_STATUS: 'Status not stated in source',
  AMBIGUOUS_STATUS: 'Source status could not be mapped',
  UNCLEAR_OWNER: 'Primary owner unclear',
  MISSING_REVIEWER: 'Needs a reviewer',
  MISSING_EFFORT_DAYS: 'Needs an effort estimate',
  OWNERSHIP_TRANSFER: 'Ownership transfer noted in source',
  MISSING_MILESTONE: 'Not attached to a milestone',
  MISSING_DELIVERABLE: 'No deliverable identified',
  TRUNCATED_SOURCE_TEXT: 'Source text appears truncated',
  POSSIBLE_DUPLICATE: 'Possible duplicate or overlap',
  MAY_NEED_DECOMPOSITION: 'May need splitting into several tasks',
  UNKNOWN_PROGRESS: 'Progress not quantified in source',
  UNCLEAR_CLASSIFICATION: 'Workstream inferred, needs confirmation',
  INFERRED_SUPPORT: 'Supporting member read from the task wording',
};

/**
 * Entity shapes shared across repositories, services and the API layer.
 * These are the domain's view of the data — repositories map SQL rows onto them.
 */
import type {
  TaskStatus,
  Priority,
  Role,
  HistoryKind,
  ExceptionFlag,
  DeadlineRequestStatus,
  Origin,
  ClarificationCode,
  ScheduleState,
} from './enums.ts';
import type { IsoDate, IsoTimestamp } from '../lib/dates.ts';

export type User = {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: Role;
  readonly title: string | null;
  readonly active: boolean;
  readonly createdAt: IsoTimestamp;
};

export type Project = {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly leadId: string | null;
  readonly archived: boolean;
  readonly createdAt: IsoTimestamp;
};

export type Workstream = {
  readonly id: string;
  readonly projectId: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly createdAt: IsoTimestamp;
};

export type Milestone = {
  readonly id: string;
  readonly workstreamId: string;
  readonly name: string;
  readonly description: string | null;
  /**
   * Verbatim relative schedule from a plan, e.g. "W1 - W2". A milestone holds
   * no calendar dates: those are agreed per task, between its owner and its
   * reviewer, once someone is accountable for the work.
   */
  readonly timelineLabel: string | null;
  /** External constraints and risks, one per line — not task dependencies. */
  readonly longLeadItems: readonly string[];
  readonly sourceRef: string | null;
  readonly createdAt: IsoTimestamp;
};

export type Deliverable = {
  readonly id: string;
  readonly milestoneId: string;
  readonly name: string;
  readonly description: string | null;
  /** The plan's own wording for when it is due, e.g. "by W1 end". */
  readonly dueLabel: string | null;
  readonly dueDate: IsoDate | null;
  /** Highlighted as critical in the source. */
  readonly critical: boolean;
  readonly sourceRef: string | null;
  readonly createdAt: IsoTimestamp;
};

/**
 * What one calendar day of a multi-day task is meant to produce.
 *
 * A task covering more than a single day carries one of these per day, so the
 * commitment is day-by-day rather than a single outcome at the far end.
 */
export type TaskDayPlan = {
  readonly date: IsoDate;
  readonly outcome: string;
};

export type Task = {
  readonly id: string;
  /** Human-readable reference, e.g. AD-MEC-001. */
  readonly ref: string;
  /** Workstream is the required parent; milestone and deliverable are optional. */
  readonly workstreamId: string;
  readonly milestoneId: string | null;
  readonly deliverableId: string | null;
  readonly title: string;
  readonly description: string | null;
  /** `null` means the task has not been assigned to anyone yet. */
  readonly ownerId: string | null;
  readonly reviewerId: string | null;
  /** `null` means the priority has not been assigned yet, not that it is low. */
  readonly priority: Priority | null;
  readonly status: TaskStatus;
  /** `null` means unknown, which is not the same as 0%. */
  readonly progress: number | null;
  /** Qualitative progress kept verbatim from the source, e.g. "70-80% Done". */
  readonly progressNote: string | null;
  /**
   * The Task Assigner's budget, in working days. Set at creation; raised only by an
   * approved deadline extension, which preserves the original below.
   */
  readonly effortDays: number | null;
  /** The first estimate, never changed, so slippage stays measurable. */
  readonly originalEffortDays: number | null;
  readonly scheduleState: ScheduleState;
  readonly scheduleProposedById: string | null;
  readonly scheduleProposedAt: IsoTimestamp | null;
  readonly scheduleApprovedById: string | null;
  readonly scheduleApprovedAt: IsoTimestamp | null;
  /** Why a proposal was sent back, shown to the owner when they re-propose. */
  readonly scheduleReviewNote: string | null;
  /** Proposed by the owner, agreed by the reviewer. Null until then. */
  readonly startDate: IsoDate | null;
  readonly dueDate: IsoDate | null;
  /** The deadline first committed to; preserved across approved changes. */
  readonly originalDueDate: IsoDate | null;
  /** The date the record carried in its source. NOT a deadline. */
  readonly sourceDate: IsoDate | null;
  readonly blocker: string | null;
  readonly nextAction: string | null;
  readonly evidenceUrl: string | null;
  readonly reviewNote: string | null;
  readonly origin: Origin;
  readonly sourceRef: string | null;
  readonly sourceStatus: string | null;
  readonly sourceOwnerLabel: string | null;
  /** Relative schedule this task came from, e.g. "W4 - W6". */
  readonly sourceTimeline: string | null;
  readonly createdById: string | null;
  readonly createdAt: IsoTimestamp;
  readonly lastUpdatedAt: IsoTimestamp;
  readonly completedAt: IsoTimestamp | null;
  readonly supportingMemberIds: readonly string[];
  readonly dependencyTaskIds: readonly string[];
  /** One entry per calendar day, ordered by date. Empty for a single-day task. */
  readonly dayPlans: readonly TaskDayPlan[];
};

export type TaskClarification = {
  readonly id: string;
  readonly taskId: string;
  readonly code: ClarificationCode;
  readonly detail: string;
  readonly resolved: boolean;
  readonly resolvedById: string | null;
  readonly resolvedAt: IsoTimestamp | null;
  readonly createdAt: IsoTimestamp;
};

/** Denormalised context the UI needs to render a task without extra round-trips. */
export type TaskContext = {
  readonly projectId: string;
  readonly projectCode: string;
  readonly projectName: string;
  readonly workstreamId: string;
  readonly workstreamCode: string;
  readonly workstreamName: string;
  readonly milestoneName: string | null;
  readonly deliverableName: string | null;
  readonly ownerName: string | null;
  readonly reviewerName: string | null;
  /** Most recent day a daily outcome was logged, or `null` if never. */
  readonly lastDayLogDate: IsoDate | null;
};

/**
 * One day's reported outcome on a task.
 *
 * The counterpart to `TaskDayPlan`: the plan says what a day was meant to
 * produce, this says what it did. Written by whoever is doing the work.
 */
export type TaskDayLog = {
  readonly id: string;
  readonly taskId: string;
  readonly authorId: string;
  readonly authorName: string;
  readonly logDate: IsoDate;
  readonly outcome: string;
  readonly progress: number | null;
  readonly blocker: string | null;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
};

export type TaskView = Task &
  TaskContext & {
    readonly exceptions: readonly ExceptionFlag[];
    readonly attentionScore: number;
    /** `null` when no deadline has been set. */
    readonly daysUntilDue: number | null;
    readonly clarifications: readonly TaskClarification[];
    readonly supportingMemberNames: readonly string[];
    readonly dependencyRefs: readonly { id: string; ref: string; title: string; status: TaskStatus }[];
  };

export type TaskHistoryEntry = {
  readonly id: string;
  readonly taskId: string;
  readonly actorId: string | null;
  /** Who the change is attributed to; "Imported record" for source data. */
  readonly actorName: string;
  readonly source: Origin;
  readonly kind: HistoryKind;
  readonly field: string | null;
  readonly fromValue: string | null;
  readonly toValue: string | null;
  readonly note: string | null;
  readonly createdAt: IsoTimestamp;
};

export type Comment = {
  readonly id: string;
  readonly taskId: string;
  readonly authorId: string;
  readonly authorName: string;
  readonly body: string;
  readonly createdAt: IsoTimestamp;
};

export type DeadlineChangeRequest = {
  readonly id: string;
  readonly taskId: string;
  readonly taskRef: string;
  readonly taskTitle: string;
  readonly requestedById: string;
  readonly requestedByName: string;
  readonly currentEffortDays: number;
  readonly requestedEffortDays: number;
  readonly reason: string;
  readonly status: DeadlineRequestStatus;
  readonly decidedById: string | null;
  readonly decidedByName: string | null;
  readonly decisionNote: string | null;
  readonly createdAt: IsoTimestamp;
  readonly decidedAt: IsoTimestamp | null;
};

export type Session = {
  readonly token: string;
  readonly userId: string;
  readonly expiresAt: IsoTimestamp;
};

/** The authenticated caller, threaded through every service call. */
export type Actor = {
  readonly id: string;
  readonly name: string;
  readonly role: Role;
};

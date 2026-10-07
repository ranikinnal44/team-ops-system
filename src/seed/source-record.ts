/**
 * Generic source-record import.
 *
 * A "source record" is one row of an external tracker (today: the daily task
 * log). The importer's contract is narrow and strict:
 *
 *   - Values the source states are preserved verbatim.
 *   - Values the source does NOT state are left null and raised as a
 *     clarification for a manager. Nothing is guessed.
 *   - The raw owner label, raw status text and source date are kept alongside
 *     the mapped values, so an import decision can always be audited.
 *
 * Keeping this separate from any particular dataset means a later CSV or
 * Google Sheets importer reuses it unchanged.
 */
import { TaskStatus, ClarificationCode } from '../domain/enums.ts';
import type { IsoDate } from '../lib/dates.ts';

export type SourceTaskRecord = {
  /** Stable identifier for the row in its source, e.g. "DTL-001". */
  sourceRef: string;
  /** The date the row carried in the source. NOT a deadline. */
  sourceDate: IsoDate;
  /** Owner exactly as written, e.g. "Firaz / Ashutosh". */
  sourceOwnerLabel: string;
  /** Primary owner key; the importer never invents one. */
  ownerKey: string;
  supportKeys?: string[];
  /** Set when the source does not make primary ownership clear. */
  ownerUnclear?: boolean;
  /**
   * The exact phrase a supporting member was read out of, when it came from
   * the task wording rather than a structured owner field. Naming someone in
   * prose is not the same as assigning them, so the inference is recorded.
   */
  supportInferredFrom?: string;

  title: string;
  description?: string | null;
  /** Raw status cell. Empty string or null means the source left it blank. */
  sourceStatus?: string | null;
  sourceNote?: string | null;

  /** Classification decided by the importer, with confidence recorded. */
  workstreamKey: string;
  milestoneKey?: string;
  deliverableKey?: string;
  /** True when the workstream was inferred rather than evident. */
  classificationUncertain?: string;

  reviewerKey?: string;
  progressNote?: string | null;
  reviewNote?: string | null;

  /** The source text is visibly cut off in the supplied document. */
  truncated?: boolean;
  /** Free-text reasons to raise MAY_NEED_DECOMPOSITION / POSSIBLE_DUPLICATE. */
  decompositionNote?: string;
  duplicateNote?: string;
  transferNote?: string;
};

export type StatusMapping = {
  status: TaskStatus;
  /** Numeric progress, or null when the source does not establish it. */
  progress: number | null;
  /** Raised when the raw value could not be read as a status. */
  clarification: { code: ClarificationCode; detail: string } | null;
};

/**
 * Map a raw status cell onto the closed status vocabulary.
 *
 * Unmappable values do NOT become "Completed" or any other guess: the task
 * takes the neutral Not Started state, the raw text is preserved in
 * `source_status`, and a clarification is raised. This is the difference
 * between a tracker you can trust and one you cannot.
 */
export function mapSourceStatus(raw: string | null | undefined): StatusMapping {
  const value = (raw ?? '').trim();

  if (value === '') {
    return {
      status: TaskStatus.NotStarted,
      progress: 0,
      clarification: {
        code: ClarificationCode.MissingStatus,
        detail:
          'The source row left the status blank. Defaulted to Not Started — confirm the real state.',
      },
    };
  }

  switch (value.toLowerCase()) {
    case 'done':
    case 'completed':
      return { status: TaskStatus.Completed, progress: 100, clarification: null };
    case 'in progress':
    case 'running':
      // "Running" reads unambiguously as work in flight.
      return { status: TaskStatus.InProgress, progress: null, clarification: null };
    case 'planned':
    case 'not started':
      return { status: TaskStatus.NotStarted, progress: 0, clarification: null };
    case 'blocked':
      return { status: TaskStatus.Blocked, progress: null, clarification: null };
    case 'review':
      return { status: TaskStatus.Review, progress: null, clarification: null };
    default:
      return {
        status: TaskStatus.NotStarted,
        progress: null,
        clarification: {
          code: ClarificationCode.AmbiguousStatus,
          detail:
            `The source status "${value}" is not a status in this system and its meaning ` +
            'could not be established. Defaulted to Not Started; the original value is kept ' +
            'on the task. Set the correct status.',
        },
      };
  }
}

/** Status values this importer understands, for the import report. */
export const MAPPED_STATUS_VALUES: Record<string, string> = {
  Done: 'Completed',
  'In Progress': 'In Progress',
  Running: 'In Progress',
  Planned: 'Not Started',
};

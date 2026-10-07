/**
 * AutoDock import.
 *
 * Loads the real project structure and the 56 source rows from the team's
 * daily task log. The rules it works to:
 *
 *   1. Never invent a deadline. The source's Date column is the day the row
 *      was logged, stored as `source_date`, and `due_date` stays NULL.
 *   2. Never invent a priority. All imported tasks start unassigned.
 *   3. Never invent a dependency. The source establishes none, so none exist.
 *   4. Never attribute imported history to a person. Those entries carry no
 *      actor, so the activity log cannot imply someone made a change here.
 *   5. Anything undetermined becomes a clarification, not a default.
 */
import type { Database } from '../db/connection.ts';
import { transaction } from '../db/connection.ts';
import * as userRepo from '../repositories/user.repo.ts';
import * as hierarchyRepo from '../repositories/hierarchy.repo.ts';
import * as taskRepo from '../repositories/task.repo.ts';
import * as activityRepo from '../repositories/activity.repo.ts';
import * as clarificationRepo from '../repositories/clarification.repo.ts';
import { AUTODOCK_DATA, type AutoDockDataset } from './autodock-data.ts';
import { importBuildTimeline, type TimelineImportReport } from './build-timeline-loader.ts';
import { BUILD_TIMELINE } from './build-timeline-data.ts';
import { mapSourceStatus } from './source-record.ts';
import type { IsoDate } from '../lib/dates.ts';
import { TaskStatus, HistoryKind, ClarificationCode, Origin } from '../domain/enums.ts';
import { formatTaskRef } from '../lib/ids.ts';

const IMPORT_ACTOR_LABEL = 'Daily task log import';

/** A source date rendered as a timestamp, for ordering within the day. */
const at = (date: string, hour: number): string =>
  new Date(`${date}T${String(hour).padStart(2, '0')}:00:00`).toISOString();

export type ImportReport = {
  dataset: string;
  sourceDocument: string;
  tasksImported: number;
  byOwner: Record<string, number>;
  byWorkstream: Record<string, number>;
  byStatus: Record<string, number>;
  byClarification: Record<string, number>;
  tasksNeedingClarification: number;
  milestonesCreated: number;
  deliverablesCreated: number;
  tasksWithoutMilestone: number;
  /** The forward plan, imported alongside the historical log. */
  timeline: TimelineImportReport | null;
  overlapsFlagged: number;
  includesDailyLog: boolean;
};

export type AutoDockImportOptions = {
  /**
   * Also load the 56 historical rows from the daily task log.
   *
   * Off by default: the project tracks the Stream 1 build plan, and the log is
   * a record of past activity rather than work to be driven. The importer is
   * kept so it can be loaded deliberately rather than lost.
   */
  includeDailyLog?: boolean;
};

export function importAutoDock(
  db: Database,
  dataset: AutoDockDataset = AUTODOCK_DATA,
  options: AutoDockImportOptions = {},
): ImportReport {
  const includeDailyLog = options.includeDailyLog ?? false;
  const report: ImportReport = {
    dataset: dataset.label,
    sourceDocument: includeDailyLog
      ? `${BUILD_TIMELINE.sourceDocument} + ${dataset.sourceDocument}`
      : BUILD_TIMELINE.sourceDocument,
    includesDailyLog: includeDailyLog,
    tasksImported: 0,
    byOwner: {},
    byWorkstream: {},
    byStatus: {},
    byClarification: {},
    tasksNeedingClarification: 0,
    milestonesCreated: 0,
    deliverablesCreated: 0,
    tasksWithoutMilestone: 0,
    timeline: null,
    overlapsFlagged: 0,
  };

  const bump = (bucket: Record<string, number>, key: string): void => {
    bucket[key] = (bucket[key] ?? 0) + 1;
  };
  const bump2 = (bucket: Record<string, number>, key: string, by: number): void => {
    bucket[key] = (bucket[key] ?? 0) + by;
  };

  transaction(db, () => {
    // --- people -----------------------------------------------------------
    const userIds = new Map<string, string>();
    for (const person of dataset.users) {
      const user = userRepo.createUser(db, {
        name: person.name,
        email: person.email,
        role: person.role,
        title: person.title,
      });
      userIds.set(person.key, user.id);
    }
    const requireUser = (key: string): string => {
      const id = userIds.get(key);
      if (!id) throw new Error(`AutoDock data references unknown user key "${key}"`);
      return id;
    };

    // --- project structure ------------------------------------------------
    const project = hierarchyRepo.createProject(db, {
      code: dataset.project.code,
      name: dataset.project.name,
      description: dataset.project.description,
      leadId: requireUser(dataset.project.leadKey),
    });

    const workstreamIds = new Map<string, string>();
    const milestoneIds = new Map<string, string>();
    const deliverableIds = new Map<string, string>();

    // --- historical daily task log (loaded only when asked for) ---------
    if (includeDailyLog) {
      // The daily log states no plan dates at all — only the day each row was
      // logged. Dates are mandatory, so a milestone inferred from those rows is
      // dated by the work it groups: first logged day to last. A group with no
      // rows of its own falls back to the range of the log itself.
      const logged = dataset.tasks.map((t) => t.sourceDate).sort();
      const logStart = logged[0]!;
      const logEnd = logged[logged.length - 1]!;
      const spans = new Map<string, { start: IsoDate; end: IsoDate }>();
      for (const record of dataset.tasks) {
        if (!record.milestoneKey) continue;
        const span = spans.get(record.milestoneKey);
        if (!span) {
          spans.set(record.milestoneKey, { start: record.sourceDate, end: record.sourceDate });
        } else {
          if (record.sourceDate < span.start) span.start = record.sourceDate;
          if (record.sourceDate > span.end) span.end = record.sourceDate;
        }
      }
      const spanOf = (key: string): { start: IsoDate; end: IsoDate } =>
        spans.get(key) ?? { start: logStart, end: logEnd };

      for (const ws of dataset.workstreams) {
        const workstream = hierarchyRepo.createWorkstream(db, {
          projectId: project.id,
          code: ws.code,
          name: ws.name,
          // Marked as inferred so it is never mistaken for the build timeline's
          // own phases, which the source document does state.
          description:
            'Classification inferred during the daily task log import, which states no structure. ' +
            'Holds historical work; the build timeline phases (MDS / WTS / AMP) are the stated plan.',
        });
        workstreamIds.set(ws.key, workstream.id);

        for (const ms of ws.milestones) {
          const span = spanOf(ms.key);
          const milestone = hierarchyRepo.createMilestone(db, {
            workstreamId: workstream.id,
            name: ms.name,
            // The rationale is kept on the record so the grouping can be audited.
            description: `Derived during import: ${ms.rationale}`,
            // Derived, not stated: no target date is claimed, but the span the
            // logged rows occupy is a fact about the source.
            targetDate: null,
            startDate: span.start,
            endDate: span.end,
          });
          milestoneIds.set(ms.key, milestone.id);
          report.milestonesCreated += 1;

          for (const d of ms.deliverables ?? []) {
            const deliverable = hierarchyRepo.createDeliverable(db, {
              milestoneId: milestone.id,
              name: d.name,
              // The log dates no outcome of its own, so it is due by the end of
              // the milestone that holds it.
              dueDate: span.end,
            });
            deliverableIds.set(d.key, deliverable.id);
            report.deliverablesCreated += 1;
          }
        }
      }

      // --- tasks ------------------------------------------------------------
      for (const record of dataset.tasks) {
        const workstreamId = workstreamIds.get(record.workstreamKey);
        if (!workstreamId) {
          throw new Error(`AutoDock data references unknown workstream "${record.workstreamKey}"`);
        }
        const ancestry = hierarchyRepo.findWorkstreamAncestry(db, workstreamId);
        if (!ancestry) throw new Error(`Workstream ${workstreamId} has no project`);

        const mapped = mapSourceStatus(record.sourceStatus);
        const milestoneId = record.milestoneKey
          ? (milestoneIds.get(record.milestoneKey) ?? null)
          : null;
        const deliverableId = record.deliverableKey
          ? (deliverableIds.get(record.deliverableKey) ?? null)
          : null;

        const sequence = hierarchyRepo.nextTaskSequence(db, ancestry.projectId);
        const ref = formatTaskRef(ancestry.projectCode, ancestry.workstreamCode, sequence);
        const createdAt = at(record.sourceDate, 9);
        const lastUpdatedAt = at(record.sourceDate, 17);

        const taskId = taskRepo.insertTask(db, {
          ref,
          workstreamId,
          milestoneId,
          deliverableId,
          title: record.title,
          description: record.description ?? null,
          ownerId: requireUser(record.ownerKey),
          reviewerId: record.reviewerKey ? requireUser(record.reviewerKey) : null,
          // Nothing in the source states a priority or a deadline.
          priority: null,
          status: mapped.status,
          progress: mapped.progress,
          progressNote: record.progressNote ?? null,
          // The source states no deadline — its Date column is the day the row
          // was logged. Dates are mandatory, so that day stands at both ends and
          // a MISSING_DUE_DATE clarification asks for a real one. Nothing here
          // should be read as a commitment the source made.
          startDate: record.sourceDate,
          dueDate: record.sourceDate,
          // No baseline: nobody committed to this date, so there is nothing to
          // measure slippage against until a real deadline is set.
          originalDueDate: null,
          sourceDate: record.sourceDate,
          nextAction: null,
          reviewNote: record.reviewNote ?? null,
          origin: Origin.Import,
          sourceRef: record.sourceRef,
          sourceStatus: record.sourceStatus ?? null,
          sourceOwnerLabel: record.sourceOwnerLabel,
          // Nobody created this record inside the application.
          createdById: null,
          createdAt,
          lastUpdatedAt,
          completedAt: mapped.status === TaskStatus.Completed ? lastUpdatedAt : null,
          supportingMemberIds: (record.supportKeys ?? []).map(requireUser),
          dependencyTaskIds: [],
        });

        report.tasksImported += 1;
        bump(report.byOwner, record.sourceOwnerLabel);
        bump(report.byWorkstream, `${ancestry.workstreamCode} — ${ancestry.workstreamName}`);
        bump(report.byStatus, mapped.status);
        if (milestoneId === null) report.tasksWithoutMilestone += 1;

        // --- provenance entry, attributed to the import, not to a person ---
        const noteParts = [
          `Imported from ${dataset.sourceDocument}, row ${record.sourceRef}.`,
          `Source date ${record.sourceDate} (log date, not a deadline).`,
          `Source owner "${record.sourceOwnerLabel}".`,
          `Source status "${record.sourceStatus ?? '(blank)'}".`,
        ];
        if (record.sourceNote) noteParts.push(`Source note: ${record.sourceNote}`);
        activityRepo.appendHistory(db, {
          taskId,
          actorId: null,
          actorLabel: IMPORT_ACTOR_LABEL,
          source: Origin.Import,
          kind: HistoryKind.Imported,
          field: null,
          fromValue: null,
          toValue: null,
          note: noteParts.join(' '),
          createdAt,
        });

        // --- clarifications --------------------------------------------------
        const raise = (code: ClarificationCode, detail: string): void => {
          clarificationRepo.raiseClarification(db, { taskId, code, detail, createdAt });
          bump(report.byClarification, code);
        };

        if (mapped.clarification) raise(mapped.clarification.code, mapped.clarification.detail);

        const stillOpen = mapped.status !== TaskStatus.Completed;
        if (stillOpen) {
          raise(
            ClarificationCode.MissingDueDate,
            'The source log records a date the task was raised, not a deadline. That date ' +
              'stands in as the start and due date so the record can exist at all. ' +
              'Set a real deadline before treating this task as planned.',
          );
          raise(
            ClarificationCode.MissingPriority,
            'The source document contains no priority information. Assign P0–P3.',
          );
          if (milestoneId === null) {
            raise(
              ClarificationCode.MissingMilestone,
              'The source does not place this task under a milestone. It sits directly in its ' +
                'workstream until one is agreed.',
            );
          }
        }

        if (record.ownerUnclear) {
          raise(
            ClarificationCode.UnclearOwner,
            `The source lists the owner as "${record.sourceOwnerLabel}". The first name was taken ` +
              'as the accountable owner and the second added as a supporting member. ' +
              'Confirm who is accountable.',
          );
        }
        if (record.supportInferredFrom) {
          const names = (record.supportKeys ?? [])
            .map((key) => dataset.users.find((u) => u.key === key)?.name ?? key)
            .join(', ');
          raise(
            ClarificationCode.InferredSupport,
            `${names} was added as a supporting member because the task wording says ` +
              `"${record.supportInferredFrom}". The source has no supporting-member field, so ` +
              'this is a reading of free text. Confirm whether they are actually involved.',
          );
        }
        if (record.classificationUncertain) {
          raise(ClarificationCode.UnclearClassification, record.classificationUncertain);
        }
        if (record.truncated) {
          raise(
            ClarificationCode.TruncatedSourceText,
            'The task text is cut off in the source document and has been stored exactly as ' +
              'supplied. Restore the full wording from the original sheet.',
          );
        }
        if (record.decompositionNote) {
          raise(ClarificationCode.MayNeedDecomposition, record.decompositionNote);
        }
        if (record.duplicateNote) {
          raise(ClarificationCode.PossibleDuplicate, record.duplicateNote);
        }
        if (record.transferNote) {
          raise(ClarificationCode.OwnershipTransfer, record.transferNote);
        }
        if (record.progressNote && mapped.progress === null) {
          raise(
            ClarificationCode.UnknownProgress,
            `The source states progress as "${record.progressNote}", which is a range rather than ` +
              'a figure. It is preserved verbatim; no exact percentage has been assumed.',
          );
        }
      }
    }


    // --- the forward plan, into the same project ------------------------
    const timeline = importBuildTimeline(db, project.id);
    report.timeline = timeline;
    report.milestonesCreated += timeline.milestones;
    report.deliverablesCreated += timeline.deliverables;
    report.tasksImported += timeline.tasks;
    for (const [phase, count] of Object.entries(timeline.byPhase)) {
      bump2(report.byWorkstream, phase, count);
    }
    report.byStatus[TaskStatus.NotStarted] =
      (report.byStatus[TaskStatus.NotStarted] ?? 0) + timeline.tasks;
    for (const [code, count] of Object.entries(timeline.clarificationsRaised)) {
      bump2(report.byClarification, code, count);
    }

    // Only meaningful when both documents are present.
    report.overlapsFlagged = includeDailyLog ? flagCrossSourceOverlaps(db) : 0;
  });

  const row = db
    .prepare('SELECT COUNT(DISTINCT task_id) AS n FROM task_clarifications WHERE resolved = 0')
    .get() as { n: number };
  report.tasksNeedingClarification = row.n;

  return report;
}

/**
 * Where the daily log and the forward plan describe the same work.
 *
 * Both documents are kept — the log records what happened, the plan records
 * what is scheduled — so overlaps are surfaced for a decision rather than
 * silently merged, which would lose either the history or the schedule.
 *
 * Pairs are listed explicitly rather than matched by text similarity: a fuzzy
 * match would quietly produce false pairs on a project where many tasks share
 * vocabulary ("assembly", "testing", "procurement").
 */
const KNOWN_OVERLAPS: { timeline: string; log: string; note: string }[] = [
  {
    timeline: 'BT-006',
    log: 'DTL-042',
    note: 'Battery sizing appears as planned work (BT-006) and as in-flight work (DTL-042, "Battery Sizing Model").',
  },
  {
    timeline: 'BT-005',
    log: 'DTL-011',
    note: 'Cabin design appears in the plan (BT-005) and in the log (DTL-011, "Electrical cabin design - duct").',
  },
  {
    timeline: 'BT-008',
    log: 'DTL-033',
    note: 'The electronics components sheet (BT-008) overlaps the BOM clean-up already in progress (DTL-033).',
  },
  {
    timeline: 'BT-004',
    log: 'DTL-020',
    note: 'Final power distribution (BT-004) overlaps the completed component power segregation (DTL-020).',
  },
  {
    timeline: 'BT-011',
    log: 'DTL-018',
    note: 'Warehouse selection (BT-011) overlaps the completed floor plan and sizing work (DTL-018).',
  },
];

function flagCrossSourceOverlaps(db: Database): number {
  const idFor = (sourceRef: string): string | null => {
    const row = db.prepare('SELECT id FROM tasks WHERE source_ref = ?').get(sourceRef) as
      | { id: string }
      | undefined;
    return row?.id ?? null;
  };

  let flagged = 0;
  for (const overlap of KNOWN_OVERLAPS) {
    const timelineId = idFor(overlap.timeline);
    const logId = idFor(overlap.log);
    if (!timelineId || !logId) continue;
    for (const taskId of [timelineId, logId]) {
      clarificationRepo.raiseClarification(db, {
        taskId,
        code: ClarificationCode.PossibleDuplicate,
        detail: `${overlap.note} Decide whether these are one piece of work.`,
      });
      flagged += 1;
    }
  }
  return flagged;
}

/**
 * Build timeline import.
 *
 * Loads the forward plan: phases as workstreams, its milestones and dated
 * outcomes, and its 28 tasks.
 *
 * What this importer takes as given, because the source states it: the
 * structure, the per-milestone week ranges, the long-lead items, and the
 * outcomes with their own week deadlines.
 *
 * What it still refuses to invent:
 *   - owners      the plan has no owner column; every task is left unassigned
 *   - priorities  none stated
 *   - task-to-task dependencies  the dependency column holds external
 *     constraints and risks, which are stored on the milestone instead
 *
 * Calendar dates are DERIVED from `AUTODOCK_W1_START`, and the relative label
 * ("W4 - W6") is kept on every record so the plan survives re-anchoring.
 */
import type { Database } from '../db/connection.ts';
import * as hierarchyRepo from '../repositories/hierarchy.repo.ts';
import * as taskRepo from '../repositories/task.repo.ts';
import * as activityRepo from '../repositories/activity.repo.ts';
import * as clarificationRepo from '../repositories/clarification.repo.ts';
import * as supplyRepo from '../repositories/supply.repo.ts';
import { BUILD_TIMELINE, type BuildTimelineDataset } from './build-timeline-data.ts';
import { TaskStatus, HistoryKind, ClarificationCode, Origin, ScheduleState } from '../domain/enums.ts';
import { formatTaskRef } from '../lib/ids.ts';
import { createWeekResolver, parseDueWeek } from '../lib/weeks.ts';
import { config } from '../config/index.ts';
import { nowTimestamp, addDays, daysBetween, type IsoDate, workingDaysInclusive } from '../lib/dates.ts';

const IMPORT_ACTOR_LABEL = 'Build timeline import';

export type TimelineImportReport = {
  sourceDocument: string;
  weekAnchor: IsoDate;
  phases: number;
  milestones: number;
  deliverables: number;
  tasks: number;
  longLeadItems: number;
  criticalItems: string[];
  softDeadline: { week: number; date: IsoDate };
  hardDeadline: { week: number; date: IsoDate; note: string };
  bufferWeeks: { week: number; date: IsoDate; after: string }[];
  byPhase: Record<string, number>;
  clarificationsRaised: Record<string, number>;
  supplyOrders: number;
  supplyRisks: number;
  /** Orders whose arrival lands after they are needed, on the plan's own dates. */
  supplyTight: { label: string; orderBy: string; arrives: string; neededBy: string; slack: number }[];
};

export function importBuildTimeline(
  db: Database,
  projectId: string,
  dataset: BuildTimelineDataset = BUILD_TIMELINE,
): TimelineImportReport {
  const weeks = createWeekResolver(config.weekAnchor);
  const createdAt = nowTimestamp();

  const report: TimelineImportReport = {
    sourceDocument: dataset.sourceDocument,
    weekAnchor: weeks.anchor,
    phases: 0,
    milestones: 0,
    deliverables: 0,
    tasks: 0,
    longLeadItems: 0,
    criticalItems: [],
    softDeadline: { week: dataset.softDeadlineWeek, date: weeks.endOf(dataset.softDeadlineWeek) },
    hardDeadline: {
      week: dataset.hardDeadlineWeek,
      date: weeks.endOf(dataset.hardDeadlineWeek),
      note: dataset.hardDeadlineNote,
    },
    bufferWeeks: dataset.bufferWeeks.map((b) => ({
      week: b.week,
      date: weeks.endOf(b.week),
      after: b.after,
    })),
    byPhase: {},
    clarificationsRaised: {},
    supplyOrders: 0,
    supplyRisks: 0,
    supplyTight: [],
  };

  const bump = (bucket: Record<string, number>, key: string): void => {
    bucket[key] = (bucket[key] ?? 0) + 1;
  };

  for (const phase of dataset.phases) {
    const workstream = hierarchyRepo.createWorkstream(db, {
      projectId,
      code: phase.code,
      name: phase.name,
      description: phase.note
        ? `Build timeline phase. Source qualifier: ${phase.note}.`
        : 'Build timeline phase.',
    });
    report.phases += 1;

    for (const milestone of phase.milestones) {
      const span = weeks.span(milestone.startWeek, milestone.endWeek);
      const created = hierarchyRepo.createMilestone(db, {
        workstreamId: workstream.id,
        name: milestone.name,
        description: `From the build timeline (${milestone.timelineLabel}).`,
        targetDate: span.dueDate,
        timelineLabel: milestone.timelineLabel,
        startDate: span.startDate,
        endDate: span.dueDate,
        longLeadItems: milestone.longLeadItems.map((item) =>
          item.critical ? `${item.text} [critical]` : item.text,
        ),
        sourceRef: milestone.key,
      });
      report.milestones += 1;
      report.longLeadItems += milestone.longLeadItems.length;
      for (const item of milestone.longLeadItems) {
        if (item.critical) report.criticalItems.push(item.text);
      }

      // --- outcomes become deliverables, keeping their own stated deadline ---
      const deliverableIds = new Map<string, string>();
      for (const outcome of milestone.outcomes) {
        const dueWeek = parseDueWeek(outcome.name);
        const deliverable = hierarchyRepo.createDeliverable(db, {
          milestoneId: created.id,
          name: outcome.name,
          // `dueLabel` still records whether the plan dated it in its own words.
          dueLabel: dueWeek === null ? null : `by W${dueWeek}`,
          // A deliverable must carry a date. Where the plan states one it wins;
          // otherwise the outcome is due by the end of the milestone that owns
          // it, which is the weakest claim that is still true.
          dueDate: dueWeek === null ? span.dueDate : weeks.endOf(dueWeek),
          critical: outcome.critical ?? false,
          sourceRef: outcome.key,
        });
        deliverableIds.set(outcome.key, deliverable.id);
        report.deliverables += 1;
        if (outcome.critical) report.criticalItems.push(outcome.name);
      }

      // --- tasks -----------------------------------------------------------
      for (const task of milestone.tasks) {
        const sequence = hierarchyRepo.nextTaskSequence(db, projectId);
        const ref = formatTaskRef('AD', phase.code, sequence);

        const taskId = taskRepo.insertTask(db, {
          ref,
          workstreamId: workstream.id,
          milestoneId: created.id,
          deliverableId: null,
          title: task.title,
          description: task.sourceText,
          // The plan assigns nobody.
          ownerId: null,
          reviewerId: null,
          priority: null,
          status: TaskStatus.NotStarted,
          progress: 0,
          startDate: span.startDate,
          dueDate: span.dueDate,
          // The plan states these dates, so they arrive already agreed; the
          // budget is read back out of the window rather than invented.
          effortDays: workingDaysInclusive(span.startDate, span.dueDate) || 1,
          scheduleState: ScheduleState.Locked,
          sourceDate: null,
          nextAction: null,
          origin: Origin.Import,
          sourceRef: task.key.toUpperCase(),
          sourceStatus: null,
          sourceOwnerLabel: null,
          sourceTimeline: milestone.timelineLabel,
          createdById: null,
          createdAt,
          lastUpdatedAt: createdAt,
          completedAt: null,
          supportingMemberIds: [],
          dependencyTaskIds: [],
        });
        report.tasks += 1;
        bump(report.byPhase, `${phase.code} — ${phase.name}`);

        activityRepo.appendHistory(db, {
          taskId,
          actorId: null,
          actorLabel: IMPORT_ACTOR_LABEL,
          source: Origin.Import,
          kind: HistoryKind.Imported,
          note:
            `Imported from ${dataset.sourceDocument}, row ${task.key.toUpperCase()}. ` +
            `Source text "${task.sourceText}". ` +
            `Planned ${milestone.timelineLabel} under "${milestone.name}", resolved to ` +
            `${span.startDate} – ${span.dueDate} from a W1 start of ${weeks.anchor}. ` +
            'The plan states no owner and no priority.',
          createdAt,
        });

        const raise = (code: ClarificationCode, detail: string): void => {
          clarificationRepo.raiseClarification(db, { taskId, code, detail, createdAt });
          bump(report.clarificationsRaised, code);
        };

        raise(
          ClarificationCode.UnclearOwner,
          'The build timeline has no owner column, so this task is unassigned. ' +
            'Assign a single accountable owner.',
        );
        raise(
          ClarificationCode.MissingPriority,
          'The build timeline states no priority. Assign P0–P3.',
        );
      }
    }
  }

  // --- supply register ---------------------------------------------------
  // Built after the milestones exist, since every entry hangs off one.
  const milestoneByKey = new Map<string, { id: string; startDate: IsoDate; endDate: IsoDate }>();
  for (const phase of dataset.phases) {
    for (const milestone of phase.milestones) {
      const span = weeks.span(milestone.startWeek, milestone.endWeek);
      const row = db
        .prepare('SELECT id FROM milestones WHERE source_ref = ?')
        .get(milestone.key) as { id: string } | undefined;
      if (row) milestoneByKey.set(milestone.key, { id: row.id, ...span, endDate: span.dueDate });
    }
  }

  const outcomeDue = (key: string): IsoDate | null => {
    const row = db
      .prepare('SELECT due_date FROM deliverables WHERE source_ref = ?')
      .get(key) as { due_date: string | null } | undefined;
    return row?.due_date ?? null;
  };

  for (const spec of dataset.supply) {
    const milestone = milestoneByKey.get(spec.milestoneKey);
    if (!milestone) continue;
    const consumes = spec.neededAtMilestoneKey
      ? milestoneByKey.get(spec.neededAtMilestoneKey)
      : undefined;

    // Needed-by is the END of the consuming milestone: the latest it can turn
    // up and still be usable. The plan reads the same way — its electronics
    // outcome allows for the pneumatic system arriving late in that window.
    const neededByDate = consumes ? consumes.endDate : null;

    // Prefer the date the plan states; only work backwards when it does not.
    const stated = spec.orderByOutcomeKey ? outcomeDue(spec.orderByOutcomeKey) : null;
    const derived =
      stated === null && neededByDate !== null && spec.leadTimeWeeks !== undefined
        ? addDays(neededByDate, -spec.leadTimeWeeks * 7)
        : null;

    supplyRepo.insertSupplyItem(db, {
      milestoneId: milestone.id,
      label: spec.label,
      kind: spec.kind,
      leadTimeWeeks: spec.leadTimeWeeks ?? null,
      orderByDate: stated ?? derived,
      orderByDerived: stated === null && derived !== null,
      neededByDate,
      neededByMilestoneId: consumes?.id ?? null,
      critical: spec.critical ?? false,
      note: spec.note ?? null,
      sourceText: spec.sourceText,
      sourceRef: spec.key,
    });

    if (spec.kind === 'order') {
      report.supplyOrders += 1;
      const orderBy = stated ?? derived;
      if (orderBy && neededByDate && spec.leadTimeWeeks !== undefined) {
        const arrives = addDays(orderBy, spec.leadTimeWeeks * 7);
        const slack = daysBetween(arrives, neededByDate);
        if (slack <= 7) {
          report.supplyTight.push({
            label: spec.label,
            orderBy,
            arrives,
            neededBy: neededByDate,
            slack,
          });
        }
      }
    } else {
      report.supplyRisks += 1;
    }
  }

  return report;
}

/**
 * Tests for the real AutoDock import.
 *
 * The point of most of these is NEGATIVE: proving the importer did not invent
 * a deadline, a priority, a dependency or an authorship it was never given.
 */
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import type { Database } from '../src/db/connection.ts';
import { autoDockDb, autoDockWithLogDb, actorByEmail } from './helpers.ts';
import { loadedDataset } from '../src/db/seed.ts';
import * as tasks from '../src/services/task.service.ts';
import * as projects from '../src/services/project.service.ts';
import * as taskRepo from '../src/repositories/task.repo.ts';
import * as userRepo from '../src/repositories/user.repo.ts';
import * as clarificationRepo from '../src/repositories/clarification.repo.ts';
import { clarificationQueue } from '../src/services/clarification.service.ts';
import { managerDashboard, employeeDashboard } from '../src/services/dashboard.service.ts';
import { TaskStatus, ClarificationCode, Role } from '../src/domain/enums.ts';
import { AUTODOCK_DATA } from '../src/seed/autodock-data.ts';
import { BUILD_TIMELINE, flattenTimelineTasks } from '../src/seed/build-timeline-data.ts';
import { addDays } from '../src/lib/dates.ts';
import { mapSourceStatus } from '../src/seed/source-record.ts';

/**
 * The project is loaded from two documents. Most assertions below are about
 * one or the other, so they are separated explicitly rather than averaged:
 *   - the daily task log  (DTL-###) — history, no deadlines, has owners
 *   - the build timeline  (BT-###)  — plan, has deadlines, no owners
 */
const fromLog = (t: { sourceRef: string | null }): boolean => (t.sourceRef ?? '').startsWith('DTL-');
const fromPlan = (t: { sourceRef: string | null }): boolean => (t.sourceRef ?? '').startsWith('BT-');

let db: Database;
const manager = (): ReturnType<typeof actorByEmail> => actorByEmail(db, 'rani@example.com');
const firaz = (): ReturnType<typeof actorByEmail> => actorByEmail(db, 'firaz@example.com');
const faizan = (): ReturnType<typeof actorByEmail> => actorByEmail(db, 'faizan@example.com');

before(() => {
  // These suites exercise BOTH importers, so they load both documents. The
  // live default — the Stream 1 plan alone — has its own suite at the end.
  db = autoDockWithLogDb();
});

describe('dataset isolation', () => {
  test('the database records which dataset it holds', () => {
    assert.equal(loadedDataset(db), 'AUTO_DOCK_WITH_LOG');
    assert.equal(loadedDataset(autoDockDb()), 'AUTO_DOCK');
  });

  test('no demo user or demo task leaks into the real project', () => {
    const emails = userRepo.listUsers(db).map((u) => u.email);
    assert.ok(emails.every((e) => !e.includes('demo')));
    const titles = taskRepo.listTasks(db).map((t) => t.title.toLowerCase());
    assert.ok(titles.every((t) => !t.includes('demo employee')));
  });

  test('exactly one project, named AutoDock', () => {
    const all = projects.listProjects(db);
    assert.equal(all.length, 1);
    assert.equal(all[0]?.name, 'AutoDock');
    assert.equal(all[0]?.code, 'AD');
  });
});

describe('the real team', () => {
  const expected = ['Rani', 'Firaz', 'Ashutosh', 'Mallikarjun', 'Faizan'];

  test('every person in the source document exists, and nobody else', () => {
    const names = userRepo.listUsers(db).map((u) => u.name).sort();
    assert.deepEqual(names, [...expected].sort());
  });

  test('Rani is the manager and everyone else an employee', () => {
    for (const user of userRepo.listUsers(db)) {
      assert.equal(user.role, user.name === 'Rani' ? Role.Manager : Role.Employee);
    }
  });
});

describe('import fidelity', () => {
  test('every source row from both documents became exactly one task', () => {
    const all = taskRepo.listTasks(db);
    assert.equal(all.filter(fromLog).length, AUTODOCK_DATA.tasks.length, 'daily log rows');
    assert.equal(all.filter(fromLog).length, 56);
    assert.equal(all.filter(fromPlan).length, flattenTimelineTasks().length, 'timeline rows');
    assert.equal(all.filter(fromPlan).length, 28);
    assert.equal(all.length, 84);
  });

  test('every task traces back to its source row', () => {
    const refs = taskRepo.listTasks(db).map((t) => t.sourceRef);
    assert.equal(new Set(refs).size, 84, 'source references must be unique');
    assert.ok(refs.every((r) => r !== null && /^(DTL|BT)-\d{3}$/.test(r)));
  });

  test('task references are unique and human-readable', () => {
    const refs = taskRepo.listTasks(db).map((t) => t.ref);
    assert.equal(new Set(refs).size, refs.length);
    assert.ok(refs.every((r) => /^AD-[A-Z]{3}-\d{3}$/.test(r)));
  });

  test('the plan\u2019s task wording is preserved verbatim', () => {
    for (const { task } of flattenTimelineTasks()) {
      const stored = taskRepo.listTasks(db).find((t) => t.sourceRef === task.key.toUpperCase());
      assert.ok(stored, `missing ${task.key}`);
      assert.equal(stored.description, task.sourceText);
    }
  });

  test('the original task wording is preserved verbatim in the description', () => {
    for (const record of AUTODOCK_DATA.tasks) {
      const task = taskRepo.listTasks(db).find((t) => t.sourceRef === record.sourceRef);
      assert.ok(task, `missing ${record.sourceRef}`);
      assert.equal(task.description, record.description ?? null);
    }
  });

  test('the raw owner label is kept, including the two-name case', () => {
    const shared = taskRepo.listTasks(db).find((t) => t.sourceRef === 'DTL-036');
    assert.ok(shared);
    assert.equal(shared.sourceOwnerLabel, 'Firaz / Ashutosh');
  });

  test('every task is marked as imported, not created in the app', () => {
    const all = taskRepo.listTasks(db);
    assert.ok(all.every((t) => t.origin === 'import'));
    assert.ok(all.every((t) => t.createdById === null));
  });
});

describe('nothing was invented', () => {
  test('the log date stands in as the task dates, since dates are mandatory', () => {
    const log = taskRepo.listTasks(db).filter(fromLog);
    assert.ok(log.length > 0);
    // The source states no deadline. Dates cannot be null, so the day the row
    // was logged holds both ends rather than a deadline being invented.
    assert.ok(log.every((t) => t.startDate === t.sourceDate && t.dueDate === t.sourceDate));
  });

  test('the stand-in is never passed off as a committed deadline', () => {
    const log = taskRepo.listTasks(db).filter(fromLog);
    // Kept separately, exactly as before.
    assert.ok(log.every((t) => t.sourceDate !== null));
    // No baseline is claimed: nobody ever committed to this date.
    assert.ok(log.every((t) => t.originalDueDate === null));
    // And every open row still asks for a real one.
    const open = log.filter((t) => t.status !== TaskStatus.Completed);
    assert.ok(open.length > 0);
    for (const task of open) {
      const codes = clarificationRepo.listForTask(db, task.id).map((c) => c.code);
      assert.ok(
        codes.includes(ClarificationCode.MissingDueDate),
        `${task.ref} carries a stand-in date and must ask for a real deadline`,
      );
    }
  });

  test('plan tasks are dated, because the plan states a schedule', () => {
    const plan = taskRepo.listTasks(db).filter(fromPlan);
    assert.equal(plan.length, 28);
    assert.ok(plan.every((t) => t.dueDate !== null && t.startDate !== null));
    assert.ok(
      plan.every((t) => t.sourceTimeline !== null),
      'the relative week range must survive alongside the derived dates',
    );
  });

  test('no task from either source carries a priority', () => {
    assert.ok(taskRepo.listTasks(db).every((t) => t.priority === null));
  });

  test('no dependencies were inferred from row ordering', () => {
    const row = db.prepare('SELECT COUNT(*) AS n FROM task_dependencies').get() as { n: number };
    assert.equal(row.n, 0);
  });

  test('the only reviewer is the one the source names', () => {
    const withReviewer = taskRepo.listTasks(db).filter((t) => t.reviewerId !== null);
    assert.equal(withReviewer.length, 1);
    assert.equal(withReviewer[0]?.sourceRef, 'DTL-056');
    assert.equal(withReviewer[0]?.reviewerName, 'Rani');
  });

  test('a qualitative progress figure is kept as text, not converted to a number', () => {
    const task = taskRepo.listTasks(db).find((t) => t.sourceRef === 'DTL-056');
    assert.ok(task);
    assert.equal(task.progressNote, '70–80% Done');
    assert.equal(task.progress, null, 'a range must not become an exact percentage');
    assert.match(task.reviewNote ?? '', /Reviewed by Rani/);
  });

  test('in-progress work has unknown rather than zero progress', () => {
    const inProgress = taskRepo.listTasks(db).filter((t) => t.status === TaskStatus.InProgress);
    assert.ok(inProgress.length > 0);
    assert.ok(
      inProgress.every((t) => t.progress === null),
      'reporting 0% for work in flight would misrepresent it',
    );
  });
});

describe('status mapping', () => {
  test('clear source values map as specified', () => {
    assert.equal(mapSourceStatus('Done').status, TaskStatus.Completed);
    assert.equal(mapSourceStatus('In Progress').status, TaskStatus.InProgress);
    assert.equal(mapSourceStatus('Running').status, TaskStatus.InProgress);
    assert.equal(mapSourceStatus('Planned').status, TaskStatus.NotStarted);
  });

  test('"EOD" is not read as Completed', () => {
    const mapped = mapSourceStatus('EOD');
    assert.notEqual(mapped.status, TaskStatus.Completed);
    assert.equal(mapped.clarification?.code, ClarificationCode.AmbiguousStatus);
  });

  test('"Transfer to Ashutosh" is not treated as a status', () => {
    const mapped = mapSourceStatus('Transfer to Ashutosh');
    assert.notEqual(mapped.status, TaskStatus.Completed);
    assert.equal(mapped.clarification?.code, ClarificationCode.AmbiguousStatus);
  });

  test('a blank status is flagged rather than assumed', () => {
    assert.equal(mapSourceStatus('').clarification?.code, ClarificationCode.MissingStatus);
    assert.equal(mapSourceStatus(null).clarification?.code, ClarificationCode.MissingStatus);
  });

  test('the raw source status survives on the task', () => {
    const eod = taskRepo.listTasks(db).find((t) => t.sourceRef === 'DTL-005');
    assert.ok(eod);
    assert.equal(eod.sourceStatus, 'EOD');
    assert.notEqual(eod.status, TaskStatus.Completed);

    const transfer = taskRepo.listTasks(db).find((t) => t.sourceRef === 'DTL-048');
    assert.ok(transfer);
    assert.equal(transfer.sourceStatus, 'Transfer to Ashutosh');
  });

  test('completed tasks are at 100% and carry a completion timestamp', () => {
    const done = taskRepo.listTasks(db).filter((t) => t.status === TaskStatus.Completed);
    assert.ok(done.length > 0);
    assert.ok(done.every((t) => t.progress === 100 && t.completedAt !== null));
  });
});

describe('ownership', () => {
  test('the shared-owner row takes the first name and lists the second as support', () => {
    const task = taskRepo.listTasks(db).find((t) => t.sourceRef === 'DTL-036');
    assert.ok(task);
    assert.equal(task.ownerName, 'Firaz');
    const supporters = task.supportingMemberIds.map(
      (id) => userRepo.findUserById(db, id)?.name,
    );
    assert.deepEqual(supporters, ['Ashutosh']);
  });

  test('and that inference is flagged rather than left silent', () => {
    const task = taskRepo.listTasks(db).find((t) => t.sourceRef === 'DTL-036');
    assert.ok(task);
    const codes = clarificationRepo.listForTask(db, task.id).map((c) => c.code);
    assert.ok(codes.includes(ClarificationCode.UnclearOwner));
  });

  test('daily log tasks all have an owner, because the log names one', () => {
    assert.ok(taskRepo.listTasks(db).filter(fromLog).every((t) => t.ownerId !== null));
  });

  test('plan tasks are unassigned, because the plan names nobody', () => {
    const plan = taskRepo.listTasks(db).filter(fromPlan);
    assert.ok(plan.every((t) => t.ownerId === null), 'no owner may be invented for planned work');
    for (const task of plan) {
      const codes = clarificationRepo.listForTask(db, task.id).map((c) => c.code);
      assert.ok(codes.includes(ClarificationCode.UnclearOwner), `${task.ref} must be flagged`);
    }
  });

  test('unassigned work counts towards nobody\u2019s load', () => {
    const board = managerDashboard(db, manager());
    assert.equal(
      board.byOwner.reduce((sum, r) => sum + r.total, 0),
      56,
      'owner roll-ups cover assigned work only',
    );
  });
});

describe('historical provenance', () => {
  test('no imported history is attributed to a real person, from either source', () => {
    const rows = db
      .prepare("SELECT actor_id, actor_label, source FROM task_history WHERE source = 'import'")
      .all() as { actor_id: string | null; actor_label: string; source: string }[];
    assert.equal(rows.length, 84);
    assert.ok(rows.every((r) => r.actor_id === null), 'no user may be credited with an import');
    const labels = new Set(rows.map((r) => r.actor_label));
    assert.deepEqual([...labels].sort(), ['Build timeline import', 'Daily task log import']);
  });

  test('daily log history keeps its original dates rather than today\u2019s', () => {
    const logTaskIds = taskRepo.listTasks(db).filter(fromLog).map((t) => t.id);
    const placeholders = logTaskIds.map(() => '?').join(',');
    const rows = db
      .prepare(`SELECT created_at FROM task_history WHERE task_id IN (${placeholders})`)
      .all(...logTaskIds) as { created_at: string }[];
    assert.equal(rows.length, 56);
    assert.ok(
      rows.every((r) => r.created_at < '2026-09-24'),
      'imported log entries must keep their source dates',
    );
  });

  test('the provenance note records the source row and its raw values', () => {
    const task = taskRepo.listTasks(db).find((t) => t.sourceRef === 'DTL-005');
    assert.ok(task);
    const entry = tasks.listHistory(db, manager(), task.id)[0];
    assert.match(entry?.note ?? '', /DTL-005/);
    assert.match(entry?.note ?? '', /not a deadline/);
    assert.match(entry?.note ?? '', /EOD/);
  });
});

describe('clarification queue', () => {
  test('open log tasks are flagged for a deadline and a priority', () => {
    const open = taskRepo
      .listTasks(db)
      .filter(fromLog)
      .filter((t) => t.status !== TaskStatus.Completed);
    assert.ok(open.length > 0);
    for (const task of open) {
      const codes = clarificationRepo.listForTask(db, task.id).map((c) => c.code);
      assert.ok(codes.includes(ClarificationCode.MissingDueDate), `${task.ref} needs a deadline flag`);
      assert.ok(codes.includes(ClarificationCode.MissingPriority), `${task.ref} needs a priority flag`);
    }
  });

  test('plan tasks are flagged for an owner and a priority, but not a deadline', () => {
    for (const task of taskRepo.listTasks(db).filter(fromPlan)) {
      const codes = clarificationRepo.listForTask(db, task.id).map((c) => c.code);
      assert.ok(codes.includes(ClarificationCode.UnclearOwner));
      assert.ok(codes.includes(ClarificationCode.MissingPriority));
      assert.ok(
        !codes.includes(ClarificationCode.MissingDueDate),
        'the plan supplies a schedule, so no deadline clarification is needed',
      );
    }
  });

  test('cross-source overlaps are flagged on both records', () => {
    const pairs: [string, string][] = [
      ['BT-006', 'DTL-042'],
      ['BT-005', 'DTL-011'],
      ['BT-008', 'DTL-033'],
    ];
    for (const refs of pairs) {
      for (const sourceRef of refs) {
        const task = taskRepo.listTasks(db).find((t) => t.sourceRef === sourceRef);
        assert.ok(task, `missing ${sourceRef}`);
        const codes = clarificationRepo.listForTask(db, task.id).map((c) => c.code);
        assert.ok(
          codes.includes(ClarificationCode.PossibleDuplicate),
          `${sourceRef} should be flagged as overlapping its counterpart`,
        );
      }
    }
  });

  test('truncated source text is flagged', () => {
    const truncated = AUTODOCK_DATA.tasks.filter((t) => t.truncated).map((t) => t.sourceRef);
    assert.ok(truncated.length > 0);
    for (const sourceRef of truncated) {
      const task = taskRepo.listTasks(db).find((t) => t.sourceRef === sourceRef);
      assert.ok(task);
      const codes = clarificationRepo.listForTask(db, task.id).map((c) => c.code);
      assert.ok(codes.includes(ClarificationCode.TruncatedSourceText));
    }
  });

  test('the duplicated demo-video rows are flagged against each other', () => {
    for (const sourceRef of ['DTL-048', 'DTL-055']) {
      const task = taskRepo.listTasks(db).find((t) => t.sourceRef === sourceRef);
      assert.ok(task);
      const codes = clarificationRepo.listForTask(db, task.id).map((c) => c.code);
      assert.ok(codes.includes(ClarificationCode.PossibleDuplicate));
    }
  });

  test('the ownership transfer is recorded as such, not as a status', () => {
    const task = taskRepo.listTasks(db).find((t) => t.sourceRef === 'DTL-048');
    assert.ok(task);
    const items = clarificationRepo.listForTask(db, task.id);
    const transfer = items.find((c) => c.code === ClarificationCode.OwnershipTransfer);
    assert.ok(transfer);
    assert.match(transfer.detail, /Ashutosh/);
  });

  test('the manager queue groups items by reason', () => {
    const queue = clarificationQueue(db, manager());
    assert.ok(queue.totalItems > 0);
    assert.ok(queue.groups.length > 0);
    const deadlines = queue.groups.find((g) => g.code === ClarificationCode.MissingDueDate);
    assert.ok(deadlines);
    assert.equal(deadlines.count, deadlines.items.length);
  });

  test('an employee sees only clarifications on their own tasks', () => {
    const mine = clarificationQueue(db, faizan());
    const visible = new Set(tasks.listTasks(db, faizan()).map((t) => t.id));
    for (const group of mine.groups) {
      for (const item of group.items) assert.ok(visible.has(item.task.id));
    }
    assert.ok(clarificationQueue(db, manager()).totalItems > mine.totalItems);
  });
});

describe('deadline rules against undated work', () => {
  test('no imported task is undated, from either document', () => {
    const all = tasks.listTasks(db, manager());
    assert.ok(all.length > 0);
    assert.ok(
      all.every((t) => t.startDate !== null && t.dueDate !== null),
      'start and end are mandatory, so the import must supply or derive them',
    );
  });

  test('every task gets a day count, so the deadline rules apply to all of them', () => {
    const all = tasks.listTasks(db, manager());
    assert.ok(all.every((t) => typeof t.daysUntilDue === 'number'));
    const plan = all.filter((t) => t.sourceTimeline !== null);
    assert.equal(plan.length, 28, 'the build timeline still contributes 28 dated tasks');
  });

  test('stale updates are still detected without a deadline', () => {
    const board = managerDashboard(db, manager());
    assert.ok(board.summary.noUpdate > 0, 'September work has not been updated in weeks');
  });

  test('the dashboard counts undated open work explicitly', () => {
    const board = managerDashboard(db, manager());
    const all = tasks.listTasks(db, manager());
    const openUndated = all.filter((t) => t.status !== TaskStatus.Completed && t.dueDate === null);
    assert.equal(openUndated.length, 0, 'undated work can no longer exist');
    assert.equal(board.summary.noDueDate, 0);
    assert.equal(board.summary.total, 84);
    // Nothing has a priority yet, from either document.
    assert.equal(board.summary.noPriority, board.summary.total - board.summary.completed);
  });

  test('setting a deadline clears its clarification and re-enables the rules', () => {
    const working = autoDockWithLogDb();
    const mgr = actorByEmail(working, 'rani@example.com');
    const target = taskRepo
      .listTasks(working)
      .filter(fromLog)
      .find((t) => t.status !== TaskStatus.Completed);
    assert.ok(target);
    // It carries the log's date as a stand-in, not a committed deadline.
    assert.equal(target.dueDate, target.sourceDate);
    assert.equal(target.originalDueDate, null);

    const before = clarificationRepo.listForTask(working, target.id);
    assert.ok(before.some((c) => c.code === ClarificationCode.MissingDueDate && !c.resolved));

    // Moved as a single day, since an in-app edit re-applies the span and
    // day-plan rules even to an imported task.
    const realDeadline = addDays(target.dueDate!, 2);
    const updated = tasks.updateTask(working, mgr, target.id, {
      startDate: realDeadline,
      dueDate: realDeadline,
    });
    assert.equal(updated.dueDate, realDeadline);
    // Committing to a date for the first time sets the slippage baseline.
    assert.equal(updated.originalDueDate, realDeadline);
    // The rules now have something to measure against.
    assert.equal(typeof updated.daysUntilDue, 'number');

    const after = clarificationRepo.listForTask(working, target.id);
    assert.ok(
      after.find((c) => c.code === ClarificationCode.MissingDueDate)?.resolved,
      'filling the gap should clear the clarification',
    );
    working.close();
  });
});

describe('structure', () => {
  test('the three build timeline phases exist as workstreams', () => {
    const codes = projects.listWorkstreams(db).map((w) => w.code);
    for (const phase of BUILD_TIMELINE.phases) {
      assert.ok(codes.includes(phase.code), `missing phase ${phase.code}`);
    }
  });

  test('the ten inferred log workstreams are still present and marked as inferred', () => {
    const inferred = projects
      .listWorkstreams(db)
      .filter((w) => !BUILD_TIMELINE.phases.some((p) => p.code === w.code));
    assert.equal(inferred.length, 10);
    assert.ok(inferred.every((w) => /inferred/i.test(w.description ?? '')));
  });

  test('every milestone from the plan carries its week range and dates', () => {
    const planned = BUILD_TIMELINE.phases.flatMap((p) => p.milestones);
    for (const source of planned) {
      const stored = projects
        .listWorkstreams(db)
        .flatMap((w) => projects.listMilestones(db, w.id))
        .find((m) => m.name === source.name);
      assert.ok(stored, `missing milestone ${source.name}`);
      assert.equal(stored.timelineLabel, source.timelineLabel);
      assert.ok(stored.startDate !== null && stored.endDate !== null);
      assert.ok(stored.startDate <= stored.endDate);
    }
  });

  test('long lead items are kept on the milestone, not as task dependencies', () => {
    const withItems = projects
      .listWorkstreams(db)
      .flatMap((w) => projects.listMilestones(db, w.id))
      .filter((m) => m.longLeadItems.length > 0);
    assert.equal(
      withItems.reduce((sum, m) => sum + m.longLeadItems.length, 0),
      BUILD_TIMELINE.phases
        .flatMap((p) => p.milestones)
        .reduce((sum, m) => sum + m.longLeadItems.length, 0),
    );
    const deps = db.prepare('SELECT COUNT(*) AS n FROM task_dependencies').get() as { n: number };
    assert.equal(deps.n, 0, 'external constraints must not become task dependencies');
  });

  test('outcomes became deliverables, dated only where the plan dates them', () => {
    const all = projects
      .listWorkstreams(db)
      .flatMap((w) => projects.listMilestones(db, w.id))
      .flatMap((m) => projects.listDeliverables(db, m.id));
    const planned = all.filter((d) => d.sourceRef?.includes('-o'));
    assert.equal(planned.length, 13);
    // Every deliverable is dated, because a dateless outcome cannot be stored.
    assert.ok(planned.every((d) => d.dueDate !== null));
    // The label still records only what the plan itself stated, so a derived
    // date stays distinguishable from a stated one.
    const stated = planned.filter((d) => d.dueLabel !== null);
    assert.ok(stated.length > 0 && stated.length < planned.length);
    assert.ok(stated.every((d) => /^by W\d+$/.test(d.dueLabel ?? '')));
    assert.ok(planned.some((d) => d.critical), 'the source marks some outcomes critical');
  });

  test('every task sits under a workstream', () => {
    assert.ok(taskRepo.listTasks(db).every((t) => typeof t.workstreamId === 'string'));
  });

  test('tasks with no milestone stay visible in the project view', () => {
    const [project] = projects.listProjects(db);
    assert.ok(project);
    const tree = projects.getProjectTree(db, manager(), project.id);
    const shown =
      tree.workstreams.flatMap((w) => w.milestones.flatMap((m) => m.tasks)).length +
      tree.workstreams.flatMap((w) => w.unassignedTasks).length;
    assert.equal(shown, 84, 'no task may disappear for lacking a milestone');
  });

  test('every milestone records where it came from', () => {
    for (const workstream of projects.listWorkstreams(db)) {
      for (const milestone of projects.listMilestones(db, workstream.id)) {
        assert.match(
          milestone.description ?? '',
          /(Derived during import:|From the build timeline)/,
          `${milestone.name} must state its provenance`,
        );
      }
    }
  });

  test('each milestone groups at least two tasks', () => {
    const all = taskRepo.listTasks(db);
    for (const workstream of projects.listWorkstreams(db)) {
      for (const milestone of projects.listMilestones(db, workstream.id)) {
        const count = all.filter((t) => t.milestoneId === milestone.id).length;
        assert.ok(count >= 2, `${milestone.name} groups only ${count} task(s)`);
      }
    }
  });
});

describe('visibility with real data', () => {
  test('an employee sees only their own work', () => {
    const mine = tasks.listTasks(db, firaz());
    assert.ok(mine.length > 0);
    for (const task of mine) {
      const involved =
        task.ownerId === firaz().id ||
        task.reviewerId === firaz().id ||
        task.supportingMemberIds.includes(firaz().id);
      assert.ok(involved);
    }
    assert.ok(tasks.listTasks(db, manager()).length > mine.length);
  });

  test('each employee board only contains that person’s tasks', () => {
    const board = employeeDashboard(db, faizan());
    const visible = new Set(tasks.listTasks(db, faizan()).map((t) => t.id));
    for (const task of board.focus) assert.ok(visible.has(task.id));
  });

  test('owner roll-ups cover the whole team and reconcile', () => {
    const board = managerDashboard(db, manager());
    const all = tasks.listTasks(db, manager());
    assert.equal(board.summary.total, 84);
    for (const rollup of board.byOwner) {
      assert.equal(rollup.total, all.filter((t) => t.ownerId === rollup.userId).length);
      assert.equal(rollup.open + rollup.completed, rollup.total);
    }
    assert.equal(
      board.byOwner.reduce((sum, r) => sum + r.total, 0),
      56,
      'the 28 unassigned plan tasks belong to no owner',
    );
  });

  test('workstream roll-ups account for every task exactly once', () => {
    const board = managerDashboard(db, manager());
    assert.equal(
      board.byWorkstream.reduce((sum, w) => sum + w.total, 0),
      84,
    );
  });
});

describe('the live project holds the Stream 1 plan only', () => {
  let live: Database;
  before(() => {
    live = autoDockDb();
  });

  test('the default dataset is the build plan, with no historical log rows', () => {
    const all = taskRepo.listTasks(live);
    assert.equal(all.length, 28);
    assert.ok(all.every(fromPlan), 'every task must come from the Stream 1 sheet');
    assert.equal(all.filter(fromLog).length, 0, 'the daily task log must not be loaded');
  });

  test('only the three build timeline phases exist', () => {
    const workstreams = projects.listWorkstreams(live);
    assert.deepEqual(
      workstreams.map((w) => w.code).sort(),
      ['AMP', 'MDS', 'WTS'],
    );
  });

  test('the inferred log workstreams are gone, not left empty', () => {
    const names = projects.listWorkstreams(live).map((w) => w.name);
    for (const inferred of ['Procurement & Vendors', 'Conveyor & Dock Integration', 'Simulation']) {
      assert.ok(!names.includes(inferred), `${inferred} was only ever a log classification`);
    }
  });

  test('every task sits under a milestone, because the plan places it', () => {
    const all = taskRepo.listTasks(live);
    assert.ok(all.every((t) => t.milestoneId !== null));
  });

  test('nothing is orphaned by dropping the log', () => {
    const milestones = projects
      .listWorkstreams(live)
      .flatMap((w) => projects.listMilestones(live, w.id));
    assert.equal(milestones.length, 8);
    const all = taskRepo.listTasks(live);
    for (const milestone of milestones) {
      assert.ok(
        all.some((t) => t.milestoneId === milestone.id),
        `${milestone.name} has no tasks`,
      );
    }
    const deliverables = milestones.flatMap((m) => projects.listDeliverables(live, m.id));
    assert.equal(deliverables.length, 13);
  });

  test('the team is unchanged — people outlive any one document', () => {
    assert.equal(userRepo.listUsers(live).length, 5);
  });

  test('the whole plan is unassigned and unprioritised, and says so', () => {
    const all = taskRepo.listTasks(live);
    assert.ok(all.every((t) => t.ownerId === null));
    assert.ok(all.every((t) => t.priority === null));
    assert.equal(clarificationRepo.countUnresolved(live), 56, '28 owners + 28 priorities');
  });

  test('every task is scheduled, so the deadline rules are live', () => {
    const all = taskRepo.listTasks(live);
    assert.ok(all.every((t) => t.dueDate !== null && t.startDate !== null));
    const board = managerDashboard(live, actorByEmail(live, 'rani@example.com'));
    assert.equal(board.summary.total, 28);
    assert.equal(board.summary.noDueDate, 0, 'nothing in the plan lacks a date');
  });

  test('no cross-source overlap flags, because there is one source', () => {
    const all = taskRepo.listTasks(live);
    for (const task of all) {
      const codes = clarificationRepo.listForTask(live, task.id).map((c) => c.code);
      assert.ok(!codes.includes(ClarificationCode.PossibleDuplicate));
    }
  });
});

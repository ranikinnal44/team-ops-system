/**
 * Seed / import runner.
 *
 * Dispatches to a named dataset from `src/seed/registry.ts`. Datasets are data;
 * this file only knows how to clear a database and load one, so replacing the
 * project's content never means touching application code.
 *
 * Loaders write through the repositories rather than the services: records
 * arrive with a history already attached, which the status machine would
 * (correctly) refuse to replay from scratch.
 *
 *   npm run seed                     load the default dataset (AUTO_DOCK)
 *   npm run seed:reset               wipe and reload AUTO_DOCK
 *   npm run seed:demo                wipe and reload DEMO
 *   node src/db/seed.ts --dataset=DEMO --reset
 */
import type { Database } from './connection.ts';
import { createDatabase, transaction } from './connection.ts';
import { config } from '../config/index.ts';
import * as userRepo from '../repositories/user.repo.ts';
import { seedPasscode } from '../seed/passcodes.ts';
import { nowTimestamp } from '../lib/dates.ts';
import {
  DATASETS,
  DATASET_NAMES,
  DEFAULT_DATASET,
  DatasetName,
  isDatasetName,
} from '../seed/registry.ts';
import type { ImportReport } from '../seed/autodock-loader.ts';

const TABLES_IN_DELETE_ORDER = [
  'task_external_links',
  'deadline_change_requests',
  'comments',
  'task_history',
  'task_dependencies',
  'task_supporters',
  'tasks',
  'task_ref_sequences',
  'deliverables',
  'milestones',
  'workstreams',
  'projects',
  'sessions',
  'users',
];

export function clearAll(db: Database): void {
  transaction(db, () => {
    for (const table of TABLES_IN_DELETE_ORDER) db.exec(`DELETE FROM ${table}`);
  });
}

export function isEmpty(db: Database): boolean {
  const row = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  return row.n === 0;
}


/** Which dataset a database currently holds, if it was recorded. */
export function loadedDataset(db: Database): string | null {
  const row = db.prepare("SELECT value FROM schema_meta WHERE key = 'dataset'").get() as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function recordDataset(db: Database, name: string): void {
  db.prepare(
    `INSERT INTO schema_meta (key, value) VALUES ('dataset', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(name);
  db.prepare(
    `INSERT INTO schema_meta (key, value) VALUES ('seeded_at', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(nowTimestamp());
}

/** Load a named dataset into an empty database. */
export function loadDataset(db: Database, name: DatasetName): ImportReport | null {
  const definition = DATASETS[name];
  const report = definition.load(db);
  recordDataset(db, name);
  return report;
}

// --- CLI -------------------------------------------------------------------

function parseDatasetArg(argv: readonly string[]): DatasetName {
  const flag = argv.find((a) => a.startsWith('--dataset='))?.split('=')[1];
  const requested = (flag ?? process.env.SEED_DATASET ?? DEFAULT_DATASET).toUpperCase();
  if (!isDatasetName(requested)) {
    console.error(
      `Unknown dataset "${requested}". Choose one of: ${DATASET_NAMES.join(', ')}`,
    );
    process.exit(1);
  }
  return requested;
}

function printCounts(db: Database): void {
  const tables = [
    'users', 'projects', 'workstreams', 'milestones', 'deliverables',
    'tasks', 'task_history', 'comments', 'task_clarifications',
  ];
  const counts = tables
    .map((table) => {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
      return `${table}=${row.n}`;
    })
    .join('  ');
  console.log(`  ${counts}`);
}

/**
 * Who to sign in as, and with what.
 *
 * Each seeded user has their own passcode now, so the one line that used to
 * say "the passcode is demo1234" would be wrong. These are demo credentials in
 * a demo dataset — printed because nothing can read them back afterwards.
 */
function printCredentials(db: Database): void {
  const users = userRepo.listUsers(db, { activeOnly: true });
  if (users.length === 0) return;
  console.log('\n  ── Sign in as ──────────────────────────────────────────────');
  for (const user of users) {
    const who = `${user.name} (${user.role})`;
    console.log(`     ${who.padEnd(34)} ${user.email.padEnd(28)} ${seedPasscode(user.email)}`);
  }
  console.log('     Each person has their own; a manager can reset any of them.');
}

function printTimeline(report: NonNullable<ImportReport['timeline']>): void {
  console.log(`\n  ── Build timeline — ${report.sourceDocument}`);
  console.log(`     W1 anchored to ${report.weekAnchor} (AUTODOCK_W1_START)`);
  console.log(
    `     ${report.phases} phases, ${report.milestones} milestones, ` +
      `${report.deliverables} deliverables, ${report.tasks} tasks`,
  );
  console.log(
    `     Soft deadline W${report.softDeadline.week} = ${report.softDeadline.date}   ` +
      `Hard deadline W${report.hardDeadline.week} = ${report.hardDeadline.date} (${report.hardDeadline.note})`,
  );
  for (const buffer of report.bufferWeeks) {
    console.log(`     Buffer W${buffer.week} (${buffer.date}) after ${buffer.after}`);
  }
  if (report.criticalItems.length > 0) {
    console.log('     Critical long-lead items flagged in the source:');
    for (const item of [...new Set(report.criticalItems)]) console.log(`       • ${item}`);
  }
}

function printImportReport(report: ImportReport): void {
  const section = (title: string, entries: Record<string, number>): void => {
    console.log(`\n  ${title}`);
    for (const [key, count] of Object.entries(entries).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(count).padStart(3)}  ${key}`);
    }
  };
  console.log(`\n  Source: ${report.sourceDocument}`);
  console.log(`  Tasks imported: ${report.tasksImported}`);
  console.log(`  Milestones created: ${report.milestonesCreated}   Deliverables: ${report.deliverablesCreated}`);
  console.log(`  Tasks with no milestone: ${report.tasksWithoutMilestone}`);
  console.log(`  Tasks needing clarification: ${report.tasksNeedingClarification}`);
  section('By owner (as written in the source)', report.byOwner);
  section('By workstream', report.byWorkstream);
  section('By status', report.byStatus);
  section('Clarifications raised', report.byClarification);
  if (report.timeline) printTimeline(report.timeline);
  if (!report.includesDailyLog) {
    console.log(
      '\n  Tasks are the Stream 1 build plan only. The historical daily task log is not ' +
        'loaded;\n  use `--dataset=AUTO_DOCK_WITH_LOG` to include it.',
    );
  }
  if (report.overlapsFlagged > 0) {
    console.log(
      `\n  ${report.overlapsFlagged} cross-source overlap flag(s) raised where the daily log and ` +
        'the plan describe the same work.',
    );
  }
}

if (import.meta.filename === process.argv[1]) {
  const dataset = parseDatasetArg(process.argv);
  const reset = process.argv.includes('--reset');
  const db = createDatabase();

  if (reset) {
    clearAll(db);
    console.log('• Cleared existing data');
  }
  if (!isEmpty(db)) {
    const current = loadedDataset(db) ?? 'unknown';
    console.log(
      `• Database already holds the ${current} dataset — skipping.\n` +
        '  Use `npm run seed:reset` (AutoDock) or `npm run seed:demo` to replace it.',
    );
  } else {
    const report = loadDataset(db, dataset);
    console.log(`✓ Loaded dataset ${dataset}`);
    console.log(`  ${DATASETS[dataset].label}`);
    printCounts(db);
    if (report) printImportReport(report);
    printCredentials(db);
    console.log(`\n  Database: ${config.databasePath}`);
  }
  db.close();
}

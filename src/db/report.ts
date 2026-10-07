/**
 * Data-quality report.
 *
 * Prints what the import could NOT establish from the source, grouped so a
 * manager can work through it. Read-only: it fixes nothing and assumes nothing.
 *
 *   npm run import:report
 */
import { createDatabase } from './connection.ts';
import { config } from '../config/index.ts';
import { loadedDataset } from './seed.ts';
import { CLARIFICATION_LABEL, type ClarificationCode } from '../domain/enums.ts';

type Row = {
  code: string;
  ref: string;
  title: string;
  owner_name: string;
  source_ref: string | null;
  detail: string;
};

export function printReport(path: string = config.databasePath): void {
  const db = createDatabase(path);
  const dataset = loadedDataset(db) ?? 'unknown';

  const totals = db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM tasks)                                        AS tasks,
         (SELECT COUNT(*) FROM tasks WHERE origin = 'import')                AS imported,
         (SELECT COUNT(*) FROM tasks WHERE due_date IS NULL AND status <> 'completed')  AS no_due,
         (SELECT COUNT(*) FROM tasks WHERE priority IS NULL AND status <> 'completed')  AS no_priority,
         (SELECT COUNT(*) FROM tasks WHERE milestone_id IS NULL)             AS no_milestone,
         (SELECT COUNT(*) FROM task_dependencies)                            AS dependencies,
         (SELECT COUNT(DISTINCT task_id) FROM task_clarifications WHERE resolved = 0) AS flagged,
         (SELECT COUNT(*) FROM task_clarifications WHERE resolved = 0)       AS open_items`,
    )
    .get() as Record<string, number>;

  console.log(`\nDATA QUALITY REPORT — dataset ${dataset}`);
  console.log(`Database: ${config.databasePath}\n`);
  console.log(`  Tasks total                         ${totals.tasks}`);
  console.log(`  ... imported from a source document ${totals.imported}`);
  console.log(`  Open tasks with no deadline         ${totals.no_due}`);
  console.log(`  Open tasks with no priority         ${totals.no_priority}`);
  console.log(`  Tasks with no milestone             ${totals.no_milestone}`);
  console.log(`  Dependencies established            ${totals.dependencies}`);
  console.log(`  Tasks flagged for clarification     ${totals.flagged}`);
  console.log(`  Open clarification items            ${totals.open_items}`);

  const rows = db
    .prepare(
      `SELECT c.code, c.detail, t.ref, t.title, t.source_ref, u.name AS owner_name
       FROM task_clarifications c
       JOIN tasks t ON t.id = c.task_id
       JOIN users u ON u.id = t.owner_id
       WHERE c.resolved = 0
       ORDER BY c.code, t.ref`,
    )
    .all() as Row[];

  let currentCode = '';
  for (const row of rows) {
    if (row.code !== currentCode) {
      currentCode = row.code;
      const label = CLARIFICATION_LABEL[row.code as ClarificationCode] ?? row.code;
      const count = rows.filter((r) => r.code === row.code).length;
      console.log(`\n── ${row.code} — ${label}  (${count})`);
    }
    // The bulk codes repeat the same explanation on every task; list those
    // compactly and give the full detail only where it is task-specific.
    const bulk = ['MISSING_DUE_DATE', 'MISSING_PRIORITY', 'MISSING_MILESTONE'];
    if (bulk.includes(row.code)) {
      console.log(`   ${row.ref.padEnd(12)} ${(row.source_ref ?? '').padEnd(9)} ${row.title.slice(0, 60)}`);
    } else {
      console.log(`   ${row.ref.padEnd(12)} ${(row.source_ref ?? '').padEnd(9)} ${row.title.slice(0, 60)}`);
      console.log(`      → ${row.detail}`);
    }
  }
  console.log();
  db.close();
}

if (import.meta.filename === process.argv[1]) {
  printReport();
}

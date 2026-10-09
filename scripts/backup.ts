/**
 * Point-in-time backups.
 *
 * `VACUUM INTO` is SQLite's own snapshot: it writes a consistent copy even
 * while the server is mid-write, which a file copy of a WAL database does not.
 * The copy is a plain database file — to restore, stop the server and put it
 * where `DATABASE_PATH` points.
 *
 *   npm run backup                 one snapshot, pruned to the last 14
 *   npm run backup -- --keep=30    keep more
 *   npm run backup -- --dir=/mnt/x somewhere off this disk
 *
 * A backup on the same disk as the database survives a mistake, not a dead
 * drive or a stolen laptop. Point `--dir` at another machine for that.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config, PROJECT_ROOT } from '../src/config/index.ts';

const PREFIX = 'team-ops-';
const DEFAULT_KEEP = 14;

const argValue = (name: string): string | null => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

export function backup(
  databasePath = config.databasePath,
  directory = resolve(PROJECT_ROOT, 'backups'),
  keep = DEFAULT_KEEP,
): { file: string; bytes: number; pruned: string[] } {
  mkdirSync(directory, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = join(directory, `${PREFIX}${stamp}.db`);

  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    // Single-quoted path: a directory name with a quote in it would otherwise
    // break the statement, and VACUUM INTO takes no parameters.
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }

  // Oldest first, so the newest `keep` survive.
  const existing = readdirSync(directory)
    .filter((name) => name.startsWith(PREFIX) && name.endsWith('.db'))
    .sort();
  const pruned = existing.slice(0, Math.max(0, existing.length - keep));
  for (const name of pruned) unlinkSync(join(directory, name));

  return { file, bytes: statSync(file).size, pruned };
}

if (import.meta.filename === process.argv[1]) {
  const keep = Number(argValue('keep') ?? DEFAULT_KEEP);
  const directory = argValue('dir') ?? resolve(PROJECT_ROOT, 'backups');
  const result = backup(config.databasePath, directory, Number.isFinite(keep) ? keep : DEFAULT_KEEP);
  const mb = (result.bytes / 1_048_576).toFixed(2);
  console.log(`✓ Backed up ${config.databasePath}`);
  console.log(`  → ${result.file}  (${mb} MB)`);
  if (result.pruned.length > 0) {
    console.log(`  Pruned ${result.pruned.length} older snapshot(s), keeping ${keep}.`);
  }
  console.log('  Restore: stop the server, then copy this file over data/team-ops.db');
}

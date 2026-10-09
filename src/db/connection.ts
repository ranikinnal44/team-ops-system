/**
 * SQLite connection management.
 *
 * Uses the runtime's built-in `node:sqlite` — no native build step, no ORM.
 * A single shared connection is used by the server; tests open isolated
 * in-memory databases via `createDatabase(':memory:')`.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config, PROJECT_ROOT } from '../config/index.ts';

export type Database = DatabaseSync;

const SCHEMA_PATH = resolve(PROJECT_ROOT, 'src', 'db', 'schema.sql');

export function readSchema(): string {
  return readFileSync(SCHEMA_PATH, 'utf8');
}

/**
 * Open a database WITHOUT applying the schema.
 *
 * Needed by the migrator: `schema.sql` indexes columns that an older database
 * has not got yet, so applying it first fails before anything can be migrated.
 */
export function openDatabase(path: string = config.databasePath): Database {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  return db;
}

/** Open a database and make sure the schema is present. */
export function createDatabase(path: string = config.databasePath): Database {
  const db = openDatabase(path);
  try {
    db.exec(readSchema());
  } catch (error) {
    db.close();
    // An existing database too old for the current schema fails here, on a
    // column an index needs. Say what to run rather than leaking raw SQL.
    throw new Error(
      `This database does not match the current schema (${(error as Error).message}).\n` +
        '  Bring it up to date in place, keeping your data:\n' +
        '    npm run migrate',
    );
  }
  return db;
}

let shared: Database | undefined;

/** The process-wide connection used by the HTTP server. */
export function getDatabase(): Database {
  shared ??= createDatabase();
  return shared;
}

export function closeDatabase(): void {
  shared?.close();
  shared = undefined;
}

/**
 * Run `fn` inside a transaction. Nested calls join the outer transaction
 * rather than opening a second one (SQLite has no nested BEGIN).
 */
export function transaction<T>(db: Database, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** SQLite stores booleans as 0/1. */
export const toBool = (value: unknown): boolean => value === 1 || value === true;
export const fromBool = (value: boolean): number => (value ? 1 : 0);

/** SQLite returns `null` for NULL; narrow it to a typed nullable string. */
export const toText = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

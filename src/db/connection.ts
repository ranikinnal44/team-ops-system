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

/** Open a database and make sure the schema is present. */
export function createDatabase(path: string = config.databasePath): Database {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(readSchema());
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

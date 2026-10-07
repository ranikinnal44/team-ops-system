/**
 * Central configuration. Every environment-dependent value in the system is
 * resolved here exactly once, so no other module reads `process.env` directly.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function str(key: string, fallback: string): string {
  const raw = process.env[key];
  return raw === undefined || raw === '' ? fallback : raw;
}

function int(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid integer for environment variable ${key}: "${raw}"`);
  }
  return parsed;
}

function bool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

/**
 * What "W1" means on the calendar. The build timeline is written in relative
 * weeks, so this single value anchors the entire schedule. Unset, it defaults
 * to the Monday of the current week.
 */
function weekAnchor(): string {
  const raw = process.env.AUTODOCK_W1_START;
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export type AppConfig = {
  readonly port: number;
  readonly host: string;
  readonly databasePath: string;
  readonly authPasscode: string;
  readonly sessionTtlHours: number;
  readonly rules: {
    readonly dueSoonDays: number;
    readonly noUpdateWorkingDays: number;
    /** Working days a task may run without a daily outcome before it is chased. */
    readonly dailyUpdateWorkingDays: number;
    /**
     * Largest effort budget, in WORKING days, a task may carry. Work that
     * needs longer is a milestone, not a task, and has to be broken down.
     */
    readonly maxTaskEffortDays: number;
  };
  /** Calendar date that project week W1 starts from. */
  readonly weekAnchor: string;
  readonly integrations: {
    readonly driveEnabled: boolean;
    readonly githubEnabled: boolean;
    readonly calendarEnabled: boolean;
    readonly notificationsEnabled: boolean;
  };
};

export function loadConfig(): AppConfig {
  const dbPath = str('DATABASE_PATH', './data/team-ops.db');
  return {
    port: int('PORT', 4000),
    host: str('HOST', '127.0.0.1'),
    databasePath: dbPath === ':memory:' ? dbPath : resolve(PROJECT_ROOT, dbPath),
    authPasscode: str('AUTH_PASSCODE', 'demo1234'),
    sessionTtlHours: int('SESSION_TTL_HOURS', 12),
    rules: {
      dueSoonDays: int('DUE_SOON_DAYS', 2),
      noUpdateWorkingDays: int('NO_UPDATE_WORKING_DAYS', 2),
      dailyUpdateWorkingDays: int('DAILY_UPDATE_WORKING_DAYS', 1),
      // MAX_TASK_SPAN_DAYS is the old name for the same cap; still read so an
      // existing .env keeps working.
      maxTaskEffortDays: int('MAX_TASK_EFFORT_DAYS', int('MAX_TASK_SPAN_DAYS', 5)),
    },
    weekAnchor: weekAnchor(),
    integrations: {
      driveEnabled: bool('INTEGRATION_DRIVE_ENABLED', false),
      githubEnabled: bool('INTEGRATION_GITHUB_ENABLED', false),
      calendarEnabled: bool('INTEGRATION_CALENDAR_ENABLED', false),
      notificationsEnabled: bool('NOTIFICATIONS_ENABLED', false),
    },
  };
}

export const config: AppConfig = loadConfig();

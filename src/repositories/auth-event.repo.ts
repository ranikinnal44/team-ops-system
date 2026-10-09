/**
 * The authentication audit trail.
 *
 * Task history already records who changed what. This records who got in, who
 * failed, and whose credentials or role were changed — the questions you only
 * ask after something has gone wrong, when it is too late to start collecting.
 *
 * It doubles as the throttle's memory: failures are counted out of this table
 * rather than kept in process memory, so a restart does not reset an attack.
 */
import type { Database } from '../db/connection.ts';
import { newId } from '../lib/ids.ts';
import { nowTimestamp, type IsoTimestamp } from '../lib/dates.ts';

export const AuthEventKind = {
  LoginSuccess: 'login_success',
  LoginFailure: 'login_failure',
  Throttled: 'throttled',
  Logout: 'logout',
  Bootstrap: 'bootstrap',
  PasscodeReset: 'passcode_reset',
  RoleChange: 'role_change',
} as const;
export type AuthEventKind = (typeof AuthEventKind)[keyof typeof AuthEventKind];

export type NewAuthEvent = {
  kind: AuthEventKind;
  /** Lowercased; the address that was TRIED, which may belong to nobody. */
  email?: string | null;
  userId?: string | null;
  ip?: string | null;
  detail?: string | null;
};

export function record(db: Database, event: NewAuthEvent): void {
  db.prepare(
    `INSERT INTO auth_events (id, kind, email, user_id, ip, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId(),
    event.kind,
    event.email?.toLowerCase() ?? null,
    event.userId ?? null,
    event.ip ?? null,
    event.detail ?? null,
    nowTimestamp(),
  );
}

/**
 * Failures for an email since its last success, within `since`.
 *
 * Counting from the last success is what makes a correct passcode clear the
 * slate: somebody who mistypes four times and then gets in is not one attempt
 * away from being locked out for the rest of the window.
 */
export function failuresSince(
  db: Database,
  key: { email: string } | { ip: string },
  since: IsoTimestamp,
): number {
  const column = 'email' in key ? 'email' : 'ip';
  const value = 'email' in key ? key.email.toLowerCase() : key.ip;

  const lastSuccess = db
    .prepare(
      `SELECT created_at FROM auth_events
        WHERE ${column} = ? AND kind = '${AuthEventKind.LoginSuccess}'
        ORDER BY created_at DESC LIMIT 1`,
    )
    .get(value) as { created_at: string } | undefined;

  const from = lastSuccess && lastSuccess.created_at > since ? lastSuccess.created_at : since;
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM auth_events
        WHERE ${column} = ? AND kind = '${AuthEventKind.LoginFailure}' AND created_at > ?`,
    )
    .get(value, from) as { n: number };
  return row.n;
}

/** Most recent events first — for an admin screen, or a question after the fact. */
export function listRecent(db: Database, limit = 100): Record<string, unknown>[] {
  return db
    .prepare('SELECT * FROM auth_events ORDER BY created_at DESC LIMIT ?')
    .all(limit) as Record<string, unknown>[];
}

/**
 * Users and sessions. Repositories hold SQL only — no business rules.
 */
import type { Database } from '../db/connection.ts';
import { toBool, fromBool, toText } from '../db/connection.ts';
import type { User, Session } from '../domain/types.ts';
import type { Role } from '../domain/enums.ts';
import { newId, newToken } from '../lib/ids.ts';
import { nowTimestamp } from '../lib/dates.ts';

type UserRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  title: string | null;
  active: number;
  created_at: string;
};

const mapUser = (row: UserRow): User => ({
  id: row.id,
  name: row.name,
  email: row.email,
  role: row.role as Role,
  title: toText(row.title),
  active: toBool(row.active),
  createdAt: row.created_at,
});

export type NewUser = {
  name: string;
  email: string;
  role: Role;
  title?: string | null;
};

export function createUser(db: Database, input: NewUser): User {
  const user: User = {
    id: newId(),
    name: input.name,
    email: input.email.toLowerCase(),
    role: input.role,
    title: input.title ?? null,
    active: true,
    createdAt: nowTimestamp(),
  };
  db.prepare(
    `INSERT INTO users (id, name, email, role, title, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(user.id, user.name, user.email, user.role, user.title, fromBool(user.active), user.createdAt);
  return user;
}

export type UserPatch = {
  name?: string;
  role?: Role;
  title?: string | null;
  active?: boolean;
};

/** Partial update. Email is immutable here: it is the login identity. */
export function updateUser(db: Database, id: string, patch: UserPatch): void {
  const columns: string[] = [];
  const values: (string | number | null)[] = [];
  if (patch.name !== undefined) {
    columns.push('name = ?');
    values.push(patch.name);
  }
  if (patch.role !== undefined) {
    columns.push('role = ?');
    values.push(patch.role);
  }
  if (patch.title !== undefined) {
    columns.push('title = ?');
    values.push(patch.title);
  }
  if (patch.active !== undefined) {
    columns.push('active = ?');
    values.push(fromBool(patch.active));
  }
  if (columns.length === 0) return;
  values.push(id);
  db.prepare(`UPDATE users SET ${columns.join(', ')} WHERE id = ?`).run(...values);
}

export function findUserById(db: Database, id: string): User | null {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  return row ? mapUser(row) : null;
}

export function findUserByEmail(db: Database, email: string): User | null {
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase()) as
    | UserRow
    | undefined;
  return row ? mapUser(row) : null;
}

export function listUsers(db: Database, opts: { activeOnly?: boolean } = {}): User[] {
  const sql = opts.activeOnly
    ? 'SELECT * FROM users WHERE active = 1 ORDER BY role, name'
    : 'SELECT * FROM users ORDER BY role, name';
  return (db.prepare(sql).all() as UserRow[]).map(mapUser);
}

/** Name lookup used by read models that render owner/reviewer/author names. */
export function userNameMap(db: Database): Map<string, string> {
  const rows = db.prepare('SELECT id, name FROM users').all() as { id: string; name: string }[];
  return new Map(rows.map((r) => [r.id, r.name]));
}

// --- sessions -------------------------------------------------------------

export function createSession(db: Database, userId: string, ttlHours: number): Session {
  const token = newToken();
  const expiresAt = new Date(Date.now() + ttlHours * 3_600_000).toISOString();
  db.prepare(
    'INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
  ).run(token, userId, expiresAt, nowTimestamp());
  return { token, userId, expiresAt };
}

export function findSession(db: Database, token: string): Session | null {
  const row = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token) as
    | { token: string; user_id: string; expires_at: string }
    | undefined;
  if (!row) return null;
  return { token: row.token, userId: row.user_id, expiresAt: row.expires_at };
}

export function deleteSession(db: Database, token: string): void {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function purgeExpiredSessions(db: Database): void {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(nowTimestamp());
}

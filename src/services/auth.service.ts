/**
 * Authentication and session handling.
 *
 * Layer 1 deliberately ships a *user-selection* login: the caller picks a
 * seeded user and supplies the shared passcode from the environment. This is
 * enough to exercise and test the role model; it is NOT production
 * authentication, and is called out in the README's Known Limitations.
 *
 * The seam is here: replacing this service with SSO or per-user credentials
 * changes nothing in the API routes, which only ever see an `Actor`.
 */
import { timingSafeEqual } from 'node:crypto';
import type { Database } from '../db/connection.ts';
import * as userRepo from '../repositories/user.repo.ts';
import type { Actor, User, Session } from '../domain/types.ts';
import { config } from '../config/index.ts';
import { unauthenticated, forbidden, conflict } from '../lib/errors.ts';
import { Role } from '../domain/enums.ts';

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export type LoginResult = { session: Session; user: User };

export function login(db: Database, email: string, passcode: string): LoginResult {
  if (!constantTimeEquals(passcode, config.authPasscode)) {
    throw unauthenticated('Incorrect passcode.');
  }
  const user = userRepo.findUserByEmail(db, email);
  if (!user) throw unauthenticated('No user with that email address.');
  if (!user.active) throw forbidden('This account is deactivated.');

  userRepo.purgeExpiredSessions(db);
  const session = userRepo.createSession(db, user.id, config.sessionTtlHours);
  return { session, user };
}

export function logout(db: Database, token: string): void {
  userRepo.deleteSession(db, token);
}

/** Resolve a bearer token to the acting user, or throw 401. */
export function authenticate(db: Database, token: string | null): Actor {
  if (!token) throw unauthenticated();
  const session = userRepo.findSession(db, token);
  if (!session) throw unauthenticated('Session not found. Please sign in again.');
  if (Date.parse(session.expiresAt) <= Date.now()) {
    userRepo.deleteSession(db, token);
    throw unauthenticated('Session expired. Please sign in again.');
  }
  const user = userRepo.findUserById(db, session.userId);
  if (!user || !user.active) throw unauthenticated('Account is no longer active.');
  return { id: user.id, name: user.name, role: user.role };
}

/**
 * Whether the system has anyone in it yet.
 *
 * A database with no users cannot be signed into, which makes a clean install
 * unusable until someone is created. `bootstrapFirstManager` is the one way
 * in, and it closes the moment it succeeds.
 */
export const needsBootstrap = (db: Database): boolean =>
  userRepo.listUsers(db, { activeOnly: false }).length === 0;

/**
 * Create the first manager on an empty system.
 *
 * Guarded two ways: it refuses once any user exists, and it still demands the
 * shared passcode, so an exposed port is no easier to walk into than before.
 */
export function bootstrapFirstManager(
  db: Database,
  input: { name: string; email: string; passcode: string; title?: string | null },
): LoginResult {
  if (!constantTimeEquals(input.passcode, config.authPasscode)) {
    throw unauthenticated('Incorrect passcode.');
  }
  if (!needsBootstrap(db)) {
    throw conflict('This system already has users. Sign in, then add people from the Team screen.');
  }
  const user = userRepo.createUser(db, {
    name: input.name,
    email: input.email,
    role: Role.Manager,
    title: input.title ?? null,
  });
  const session = userRepo.createSession(db, user.id, config.sessionTtlHours);
  return { session, user };
}

/** The directory shown on the login screen; never includes credentials. */
export function listSelectableUsers(db: Database): User[] {
  return userRepo.listUsers(db, { activeOnly: true });
}

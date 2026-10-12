/**
 * Authentication and session handling.
 *
 * Each person has their own passcode, stored as a scrypt hash on their user
 * row. The login screen asks for an address rather than listing the team, so
 * reaching the port tells you nothing about who works here, and one leaked
 * code no longer signs in as everybody.
 *
 * `config.joinCode` is a different thing: it authorises creating the FIRST
 * Task Assigner on an empty system, where there is nobody to grant anything yet.
 *
 * Still NOT production authentication — no rate limiting, no lockout, no
 * second factor. See the README's Known Limitations.
 */
import { timingSafeEqual } from 'node:crypto';
import { hashPasscode, verifyPasscode, passcodeProblem } from '../lib/passcode.ts';
import type { Database } from '../db/connection.ts';
import * as userRepo from '../repositories/user.repo.ts';
import type { Actor, User, Session } from '../domain/types.ts';
import { config } from '../config/index.ts';
import { unauthenticated, forbidden, conflict, validationError, tooManyRequests } from '../lib/errors.ts';
import * as authEventRepo from '../repositories/auth-event.repo.ts';
import type { IsoTimestamp } from '../lib/dates.ts';
import { Role } from '../domain/enums.ts';

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export type LoginResult = { session: Session; user: User };

/** Where a request came from, for the audit trail and the throttle. */
export type RequestOrigin = { ip?: string | null };

const windowStart = (now: Date): IsoTimestamp =>
  new Date(now.getTime() - config.auth.lockoutMinutes * 60_000).toISOString();

/**
 * Refuse while an email or an address is over its failure budget.
 *
 * Counted per email AND per address: per email alone, one attacker working
 * through the staff list never trips it; per address alone, a distributed
 * attempt on one account never does. The lockout is a cooling window, not a
 * permanent lock — nobody has to be unlocked by hand.
 */
function assertNotThrottled(db: Database, email: string, origin: RequestOrigin, now: Date): void {
  const since = windowStart(now);
  const wait = `Too many failed attempts. Try again in ${config.auth.lockoutMinutes} minutes.`;

  if (authEventRepo.failuresSince(db, { email }, since) >= config.auth.maxFailuresPerEmail) {
    authEventRepo.record(db, {
      kind: authEventRepo.AuthEventKind.Throttled,
      email,
      ip: origin.ip,
      detail: 'email over the failure budget',
    });
    throw tooManyRequests(wait);
  }
  if (
    origin.ip &&
    authEventRepo.failuresSince(db, { ip: origin.ip }, since) >= config.auth.maxFailuresPerIp
  ) {
    authEventRepo.record(db, {
      kind: authEventRepo.AuthEventKind.Throttled,
      email,
      ip: origin.ip,
      detail: 'address over the failure budget',
    });
    throw tooManyRequests(wait);
  }
}

export function login(
  db: Database,
  email: string,
  passcode: string,
  origin: RequestOrigin = {},
  now = new Date(),
): LoginResult {
  assertNotThrottled(db, email, origin, now);

  const user = userRepo.findUserByEmail(db, email);
  // One message for both halves: which of the two was wrong is not something
  // an unauthenticated caller is owed.
  const denied = (): never => {
    authEventRepo.record(db, {
      kind: authEventRepo.AuthEventKind.LoginFailure,
      email,
      userId: user?.id ?? null,
      ip: origin.ip,
      detail: user ? 'wrong passcode' : 'no such account',
    });
    throw unauthenticated('Incorrect email or passcode.');
  };
  if (!user) return denied();
  if (!verifyPasscode(passcode, userRepo.findPasscodeHash(db, { id: user.id }))) return denied();
  if (!user.active) {
    authEventRepo.record(db, {
      kind: authEventRepo.AuthEventKind.LoginFailure,
      email,
      userId: user.id,
      ip: origin.ip,
      detail: 'account deactivated',
    });
    throw forbidden('This account is deactivated.');
  }

  userRepo.purgeExpiredSessions(db);
  const session = userRepo.createSession(db, user.id, config.sessionTtlHours);
  authEventRepo.record(db, {
    kind: authEventRepo.AuthEventKind.LoginSuccess,
    email,
    userId: user.id,
    ip: origin.ip,
  });
  return { session, user };
}

export function logout(db: Database, token: string, origin: RequestOrigin = {}): void {
  const session = userRepo.findSession(db, token);
  userRepo.deleteSession(db, token);
  if (session) {
    authEventRepo.record(db, {
      kind: authEventRepo.AuthEventKind.Logout,
      userId: session.userId,
      ip: origin.ip,
    });
  }
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
 * Create the first Task Assigner on an empty system.
 *
 * Guarded two ways: it refuses once any user exists, and it still demands the
 * shared passcode, so an exposed port is no easier to walk into than before.
 */
export function bootstrapFirstManager(
  db: Database,
  input: {
    name: string;
    email: string;
    /** Authorises the bootstrap. */
    joinCode: string;
    /** Becomes this Task Assigner's own passcode. */
    passcode: string;
    title?: string | null;
  },
): LoginResult {
  if (!constantTimeEquals(input.joinCode, config.joinCode)) {
    throw unauthenticated('Incorrect join code.');
  }
  if (!needsBootstrap(db)) {
    throw conflict('This system already has users. Sign in, then add people from the Team screen.');
  }
  const problem = passcodeProblem(input.passcode);
  if (problem) {
    throw validationError('That passcode cannot be used', [{ path: 'passcode', message: problem }]);
  }
  const user = userRepo.createUser(db, {
    name: input.name,
    email: input.email,
    role: Role.Manager,
    title: input.title ?? null,
    passcodeHash: hashPasscode(input.passcode),
  });
  const session = userRepo.createSession(db, user.id, config.sessionTtlHours);
  authEventRepo.record(db, {
    kind: authEventRepo.AuthEventKind.Bootstrap,
    email: user.email,
    userId: user.id,
    detail: 'first Task Assigner created',
  });
  return { session, user };
}

/** The directory shown on the login screen; never includes credentials. */
export function listSelectableUsers(db: Database): User[] {
  return userRepo.listUsers(db, { activeOnly: true });
}

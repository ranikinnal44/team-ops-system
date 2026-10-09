/**
 * The team roster.
 *
 * Reading the directory is manager-only, as changing it is. Who is on the
 * team and which role each person holds is organisational information; doing
 * the work, and reviewing it, needs neither. Names still reach everyone else
 * the only way they are needed — on the tasks those people are named on.
 *
 * Two invariants are enforced here rather than left to the caller:
 *   1. The team never loses its last active manager, which would leave nobody
 *      able to create tasks, decide deadlines or manage the roster.
 *   2. Nobody is deactivated while they still own open work. Every task has a
 *      single accountable owner; deactivating one silently breaks that, so the
 *      work must be reassigned first.
 */
import type { Database } from '../db/connection.ts';
import * as userRepo from '../repositories/user.repo.ts';
import * as taskRepo from '../repositories/task.repo.ts';
import type { Actor, User } from '../domain/types.ts';
import { Role, TaskStatus } from '../domain/enums.ts';
import { Capability, assertCan } from '../domain/permissions.ts';
import { conflict, notFound, validationError } from '../lib/errors.ts';
import { hashPasscode, passcodeProblem } from '../lib/passcode.ts';
import * as authEventRepo from '../repositories/auth-event.repo.ts';

/** A roster entry, with how much work the person is carrying. */
export type TeamMember = User & {
  readonly openTasks: number;
  readonly totalTasks: number;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type NewTeamMember = {
  name: string;
  email: string;
  role: Role;
  title?: string | null;
  /** Their own passcode, set by whoever adds them and changeable later. */
  passcode: string;
};

export type TeamMemberPatch = {
  name?: string;
  role?: Role;
  title?: string | null;
  active?: boolean;
};

/** Open task counts per owner. Status lives in the domain, not in SQL. */
function openTaskCounts(db: Database): Map<string, number> {
  const counts = new Map<string, number>();
  for (const task of taskRepo.listTasks(db)) {
    if (task.status === TaskStatus.Completed) continue;
    // Unassigned work belongs to nobody's load.
    if (task.ownerId === null) continue;
    counts.set(task.ownerId, (counts.get(task.ownerId) ?? 0) + 1);
  }
  return counts;
}

export function listTeam(
  db: Database,
  actor: Actor,
  opts: { includeInactive?: boolean } = {},
): TeamMember[] {
  assertCan(actor.role, Capability.ViewTeam);
  const users = userRepo.listUsers(db, { activeOnly: !opts.includeInactive });

  const open = openTaskCounts(db);
  const total = taskRepo.countTasksByOwner(db);

  return users.map((user) => ({
    ...user,
    openTasks: open.get(user.id) ?? 0,
    totalTasks: total.get(user.id) ?? 0,
  }));
}

export function addTeamMember(db: Database, actor: Actor, input: NewTeamMember): User {
  assertCan(actor.role, Capability.ManageTeam);

  const email = input.email.trim().toLowerCase();
  if (!EMAIL.test(email)) {
    throw validationError('Invalid email address', [
      { path: 'email', message: 'must be a valid email address' },
    ]);
  }
  if (userRepo.findUserByEmail(db, email)) {
    throw conflict(`${email} is already on the team.`);
  }

  const problem = passcodeProblem(input.passcode);
  if (problem) {
    throw validationError('That passcode cannot be used', [{ path: 'passcode', message: problem }]);
  }

  return userRepo.createUser(db, {
    name: input.name.trim(),
    email,
    role: input.role,
    title: input.title?.trim() || null,
    passcodeHash: hashPasscode(input.passcode),
  });
}

/**
 * Give somebody a new passcode.
 *
 * A manager can reset anyone's, which is how a forgotten one is recovered —
 * there is no email round trip here. Nobody can read an existing passcode
 * back, including the manager doing the reset: only replace it.
 */
export function resetPasscode(db: Database, actor: Actor, userId: string, passcode: string): User {
  assertCan(actor.role, Capability.ManageTeam);
  const user = userRepo.findUserById(db, userId);
  if (!user) throw notFound('User');

  const problem = passcodeProblem(passcode);
  if (problem) {
    throw validationError('That passcode cannot be used', [{ path: 'passcode', message: problem }]);
  }
  userRepo.setPasscodeHash(db, user.id, hashPasscode(passcode));
  // Every session issued under the old passcode dies with it. Resetting
  // somebody's code because it leaked is pointless if whoever has it stays
  // signed in until the token expires.
  const ended = userRepo.deleteSessionsForUser(db, user.id);
  authEventRepo.record(db, {
    kind: authEventRepo.AuthEventKind.PasscodeReset,
    email: user.email,
    userId: user.id,
    detail: `reset by ${actor.name}; ${ended} session(s) ended`,
  });
  return user;
}

export function updateTeamMember(
  db: Database,
  actor: Actor,
  userId: string,
  patch: TeamMemberPatch,
): User {
  assertCan(actor.role, Capability.ManageTeam);

  const user = userRepo.findUserById(db, userId);
  if (!user) throw notFound('Team member');

  const losingManager =
    user.role === Role.Manager &&
    ((patch.role !== undefined && patch.role !== Role.Manager) || patch.active === false);
  if (losingManager) assertAnotherManagerRemains(db, user.id);

  if (patch.active === false) {
    if (user.id === actor.id) {
      throw validationError('You cannot deactivate your own account.', [
        { path: 'active', message: 'ask another manager to do this' },
      ]);
    }
    assertNoOpenWork(db, user);
  }

  // A role is carried in the session's actor on every request, so a change to
  // it only takes effect once the holder signs in again. Ending their sessions
  // is what makes "you are no longer a manager" true immediately.
  if (patch.role !== undefined && patch.role !== user.role) {
    const ended = userRepo.deleteSessionsForUser(db, user.id);
    authEventRepo.record(db, {
      kind: authEventRepo.AuthEventKind.RoleChange,
      email: user.email,
      userId: user.id,
      detail: `${user.role} → ${patch.role} by ${actor.name}; ${ended} session(s) ended`,
    });
  }

  userRepo.updateUser(db, userId, {
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.role !== undefined ? { role: patch.role } : {}),
    ...(patch.title !== undefined ? { title: patch.title?.trim() || null } : {}),
    ...(patch.active !== undefined ? { active: patch.active } : {}),
  });

  const updated = userRepo.findUserById(db, userId);
  if (!updated) throw notFound('Team member');
  return updated;
}

function assertAnotherManagerRemains(db: Database, excludingUserId: string): void {
  const others = userRepo
    .listUsers(db, { activeOnly: true })
    .filter((u) => u.role === Role.Manager && u.id !== excludingUserId);
  if (others.length === 0) {
    throw conflict(
      'This is the only active manager. Promote someone else to manager first, ' +
        'otherwise nobody could assign work or approve deadline changes.',
    );
  }
}

function assertNoOpenWork(db: Database, user: User): void {
  const open = taskRepo
    .listTasks(db, { ownerId: user.id })
    .filter((task) => task.status !== TaskStatus.Completed);
  if (open.length === 0) return;
  const refs = open.slice(0, 5).map((t) => t.ref).join(', ');
  const more = open.length > 5 ? `, and ${open.length - 5} more` : '';
  throw conflict(
    `${user.name} still owns ${open.length} open task(s): ${refs}${more}. ` +
      'Reassign them before deactivating the account.',
  );
}

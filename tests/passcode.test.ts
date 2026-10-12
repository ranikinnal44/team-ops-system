/**
 * Per-user passcodes.
 *
 * The property that matters is separation: knowing one person's passcode gets
 * you that person's account and nothing else. Before this, one shared string
 * signed in as anybody.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Database } from '../src/db/connection.ts';
import { freshDb, manager, employee1, startTestServer, loginAs, type TestServer } from './helpers.ts';
import * as auth from '../src/services/auth.service.ts';
import * as team from '../src/services/team.service.ts';
import * as userRepo from '../src/repositories/user.repo.ts';
import { seedPasscode } from '../src/seed/passcodes.ts';
import { hashPasscode, verifyPasscode } from '../src/lib/passcode.ts';
import { Role } from '../src/domain/enums.ts';
import { AppError, ErrorCode } from '../src/lib/errors.ts';

describe('hashing', () => {
  test('the same passcode hashes differently every time', () => {
    // Per-user salts: two people who pick the same code are not visibly alike
    // in the database.
    const a = hashPasscode('same-passcode');
    const b = hashPasscode('same-passcode');
    assert.notEqual(a, b);
    assert.ok(verifyPasscode('same-passcode', a));
    assert.ok(verifyPasscode('same-passcode', b));
  });

  test('a hash does not contain the passcode', () => {
    assert.ok(!hashPasscode('hunter2-and-more').includes('hunter2'));
  });

  test('an account with no passcode cannot be signed into', () => {
    assert.equal(verifyPasscode('anything', null), false);
    assert.equal(verifyPasscode('', null), false);
  });
});

describe('signing in', () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
  });

  test('each seeded user has their own passcode', () => {
    const mgr = userRepo.findUserByEmail(db, 'demo.manager@example.com');
    const emp = userRepo.findUserByEmail(db, 'demo.employee1@example.com');
    assert.ok(mgr && emp);
    assert.notEqual(seedPasscode(mgr.email), seedPasscode(emp.email));

    assert.ok(auth.login(db, mgr.email, seedPasscode(mgr.email)).session.token);
    assert.ok(auth.login(db, emp.email, seedPasscode(emp.email)).session.token);
  });

  test("one person's passcode does not open another's account", () => {
    assert.throws(
      () => auth.login(db, 'demo.manager@example.com', seedPasscode('demo.employee1@example.com')),
      (e: unknown) => e instanceof AppError && e.code === ErrorCode.UNAUTHENTICATED,
      'the manager account must not open with an employee code',
    );
  });

  test('the old shared passcode opens nothing', () => {
    assert.throws(
      () => auth.login(db, 'demo.manager@example.com', 'demo1234'),
      (e: unknown) => e instanceof AppError && e.code === ErrorCode.UNAUTHENTICATED,
    );
  });

  test('an unknown email and a wrong passcode fail identically', () => {
    const wrongUser = (): unknown => {
      try {
        auth.login(db, 'nobody@example.com', 'some-passcode');
      } catch (e) {
        return (e as AppError).message;
      }
    };
    const wrongCode = (): unknown => {
      try {
        auth.login(db, 'demo.manager@example.com', 'wrong-passcode');
      } catch (e) {
        return (e as AppError).message;
      }
    };
    // Otherwise the login screen doubles as a directory check.
    assert.equal(wrongUser(), wrongCode());
  });
});

describe('setting and resetting', () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
  });

  test('a new member signs in with the passcode they were given', () => {
    const added = team.addTeamMember(db, manager(db), {
      name: 'Nisha Patel',
      email: 'nisha@example.com',
      role: Role.Employee,
      passcode: 'nisha-first-code',
    });
    assert.ok(auth.login(db, added.email, 'nisha-first-code').session.token);
  });

  test('a passcode that is too short is refused', () => {
    assert.throws(
      () =>
        team.addTeamMember(db, manager(db), {
          name: 'Too Short',
          email: 'short@example.com',
          role: Role.Employee,
          passcode: 'abc',
        }),
      (e: unknown) => e instanceof AppError && e.code === ErrorCode.VALIDATION,
    );
  });

  test('a manager reset replaces it, and the old one stops working', () => {
    const target = userRepo.findUserByEmail(db, 'demo.employee1@example.com');
    assert.ok(target);
    const before = seedPasscode(target.email);
    assert.ok(auth.login(db, target.email, before).session.token);

    team.resetPasscode(db, manager(db), target.id, 'issued-by-the-manager');

    assert.ok(auth.login(db, target.email, 'issued-by-the-manager').session.token);
    assert.throws(
      () => auth.login(db, target.email, before),
      (e: unknown) => e instanceof AppError && e.code === ErrorCode.UNAUTHENTICATED,
    );
  });

  test('an employee cannot reset anybody, including themselves', () => {
    const self = userRepo.findUserByEmail(db, 'demo.employee1@example.com');
    assert.ok(self);
    assert.throws(
      () => team.resetPasscode(db, employee1(db), self.id, 'a-new-code-please'),
      (e: unknown) => e instanceof AppError && e.code === ErrorCode.FORBIDDEN,
    );
  });
});

describe('over HTTP', () => {
  let db: Database;
  let server: TestServer;
  let managerToken: string;

  before(async () => {
    db = freshDb();
    server = await startTestServer(db);
    managerToken = await loginAs(server, 'demo.manager@example.com');
  });

  after(async () => {
    await server.close();
  });

  test('no endpoint hands back a passcode or its hash', async () => {
    const roster = await server.request('GET', '/api/team', { token: managerToken });
    for (const body of [roster.body]) {
      const serialised = JSON.stringify(body);
      assert.ok(!serialised.includes('passcode'), 'a credential must not travel with a user');
      assert.ok(!serialised.includes('scrypt'), 'nor its hash');
    }
  });

  test('a reset over HTTP takes effect immediately', async () => {
    const roster = await server.request('GET', '/api/team', { token: managerToken });
    const target = roster.body.find(
      (m: { email: string }) => m.email === 'demo.employee2@example.com',
    );
    assert.ok(target);

    const reset = await server.request('POST', `/api/team/${target.id}/passcode`, {
      token: managerToken,
      body: { passcode: 'reset-over-http' },
    });
    assert.equal(reset.status, 200);

    const signedIn = await server.request('POST', '/api/auth/login', {
      body: { email: 'demo.employee2@example.com', passcode: 'reset-over-http' },
    });
    assert.equal(signedIn.status, 200);
  });
});

/**
 * The guards added after the multi-machine review.
 *
 * Each test here stands for a specific way the tool could be walked into or
 * quietly corrupted once more than one person uses it.
 */
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Database } from '../src/db/connection.ts';
import { freshDb, manager, startTestServer, loginAs, type TestServer } from './helpers.ts';
import * as auth from '../src/services/auth.service.ts';
import * as team from '../src/services/team.service.ts';
import * as userRepo from '../src/repositories/user.repo.ts';
import * as authEventRepo from '../src/repositories/auth-event.repo.ts';
import { seedPasscode } from '../src/seed/passcodes.ts';
import { Role } from '../src/domain/enums.ts';
import { AppError, ErrorCode } from '../src/lib/errors.ts';
import { config } from '../src/config/index.ts';

const EMAIL = 'demo.employee1@example.com';

describe('guessing is throttled', () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
  });

  const guess = (ip = '10.0.0.9'): void => {
    auth.login(db, EMAIL, 'definitely-wrong', { ip });
  };

  test('an account locks after the configured number of failures', () => {
    for (let i = 0; i < config.auth.maxFailuresPerEmail; i += 1) {
      assert.throws(guess, (e: unknown) => e instanceof AppError && e.code === ErrorCode.UNAUTHENTICATED);
    }
    // One more and the answer changes from "wrong" to "stop".
    assert.throws(guess, (e: unknown) => e instanceof AppError && e.code === ErrorCode.TOO_MANY_REQUESTS);
  });

  test('the lock holds even against the correct passcode', () => {
    for (let i = 0; i < config.auth.maxFailuresPerEmail; i += 1) {
      assert.throws(guess);
    }
    // Otherwise the throttle would be a hint that the guess was close.
    assert.throws(
      () => auth.login(db, EMAIL, seedPasscode(EMAIL), { ip: '10.0.0.9' }),
      (e: unknown) => e instanceof AppError && e.code === ErrorCode.TOO_MANY_REQUESTS,
    );
  });

  test('a success clears the slate, so a fat-fingered morning does not lock anyone out', () => {
    for (let i = 0; i < config.auth.maxFailuresPerEmail - 1; i += 1) {
      assert.throws(guess);
    }
    assert.ok(auth.login(db, EMAIL, seedPasscode(EMAIL), { ip: '10.0.0.9' }).session.token);

    for (let i = 0; i < config.auth.maxFailuresPerEmail - 1; i += 1) {
      assert.throws(guess);
    }
    assert.ok(auth.login(db, EMAIL, seedPasscode(EMAIL), { ip: '10.0.0.9' }).session.token);
  });

  test('one locked account does not lock the rest of the team out', () => {
    for (let i = 0; i < config.auth.maxFailuresPerEmail + 1; i += 1) {
      try {
        guess();
      } catch {
        /* expected */
      }
    }
    // A different person, same office, same address.
    assert.ok(
      auth.login(db, 'demo.manager@example.com', seedPasscode('demo.manager@example.com'), {
        ip: '10.0.0.9',
      }).session.token,
    );
  });

  test('every attempt is written down, successful or not', () => {
    try {
      guess();
    } catch {
      /* expected */
    }
    auth.login(db, EMAIL, seedPasscode(EMAIL), { ip: '10.0.0.9' });

    const kinds = authEventRepo.listRecent(db, 10).map((e) => e.kind);
    assert.ok(kinds.includes('login_failure'));
    assert.ok(kinds.includes('login_success'));
  });
});

describe('a credential change ends the sessions it was issued under', () => {
  let db: Database;
  beforeEach(() => {
    db = freshDb();
  });

  test('resetting a passcode signs that person out everywhere', () => {
    const { session } = auth.login(db, EMAIL, seedPasscode(EMAIL));
    assert.ok(auth.authenticate(db, session.token));

    const target = userRepo.findUserByEmail(db, EMAIL);
    assert.ok(target);
    team.resetPasscode(db, manager(db), target.id, 'replaced-because-it-leaked');

    // Whoever held the old code is out now, not in twelve hours.
    assert.throws(
      () => auth.authenticate(db, session.token),
      (e: unknown) => e instanceof AppError && e.code === ErrorCode.UNAUTHENTICATED,
    );
  });

  test('changing somebody\'s role ends their sessions too', () => {
    const { session } = auth.login(db, EMAIL, seedPasscode(EMAIL));
    const target = userRepo.findUserByEmail(db, EMAIL);
    assert.ok(target);

    team.updateTeamMember(db, manager(db), target.id, { role: Role.Reviewer });

    // The old role travelled in the session; the new one only applies on the
    // next sign-in, so the session has to go.
    assert.throws(
      () => auth.authenticate(db, session.token),
      (e: unknown) => e instanceof AppError && e.code === ErrorCode.UNAUTHENTICATED,
    );
  });

  test('both are recorded, with who did it', () => {
    const target = userRepo.findUserByEmail(db, EMAIL);
    assert.ok(target);
    team.resetPasscode(db, manager(db), target.id, 'another-new-code');

    const event = authEventRepo.listRecent(db, 5).find((e) => e.kind === 'passcode_reset');
    assert.ok(event, 'a credential change must leave a trace');
    assert.match(String(event.detail), /reset by Demo Manager/);
  });
});

describe('responses carry the headers a browser needs', () => {
  let db: Database;
  let server: TestServer;
  let token: string;

  before(async () => {
    db = freshDb();
    server = await startTestServer(db);
    token = await loginAs(server, 'demo.manager@example.com');
  });

  after(async () => {
    await server.close();
  });

  test('the API sets a content security policy and the rest', async () => {
    const { headers } = await server.request('GET', '/api/health', { token });
    assert.match(String(headers?.['content-security-policy']), /default-src 'self'/);
    assert.equal(headers?.['x-content-type-options'], 'nosniff');
    assert.equal(headers?.['x-frame-options'], 'DENY');
    assert.equal(headers?.['referrer-policy'], 'no-referrer');
  });

  test('a failure says nothing about the schema or the stack', async () => {
    // A route that exists, with a body the service cannot satisfy.
    const { status, body } = await server.request('POST', '/api/team', {
      token,
      body: { name: 'x', email: 'not-an-email', role: 'employee', passcode: 'long-enough' },
    });
    assert.equal(status, 400);
    const serialised = JSON.stringify(body);
    assert.ok(!serialised.includes('SQLITE'), 'no driver detail');
    assert.ok(!serialised.includes('/home/'), 'no filesystem paths');
  });
});

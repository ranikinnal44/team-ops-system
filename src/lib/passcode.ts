/**
 * Per-user passcodes.
 *
 * Stored as a scrypt hash with a per-user salt, never in the clear: a database
 * file that leaks should not hand over working credentials, and nobody —
 * including a Task Assigner resetting someone's code — should be able to read back
 * what another person chose.
 *
 * Still not production authentication: there is no rate limiting, no lockout
 * and no second factor. What it does fix is the shared secret that let one
 * leaked string sign in as anybody.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** Deliberately the Node defaults: enough to be slow, cheap enough for a demo login. */
const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_LENGTH = 32;
const SALT_BYTES = 16;

export const MIN_PASSCODE_LENGTH = 6;
export const MAX_PASSCODE_LENGTH = 128;

const derive = (passcode: string, salt: Buffer): Buffer =>
  scryptSync(passcode, salt, KEY_LENGTH, { N: COST, r: BLOCK_SIZE, p: PARALLELISM });

/** `scrypt$<cost>$<salt hex>$<key hex>` — self-describing, so the cost can change later. */
export function hashPasscode(passcode: string): string {
  const salt = randomBytes(SALT_BYTES);
  return `scrypt$${COST}$${salt.toString('hex')}$${derive(passcode, salt).toString('hex')}`;
}

/**
 * Constant-time check against a stored hash.
 *
 * A user with no passcode set verifies as false rather than as "anything
 * goes": an account that cannot be signed into is the safe reading.
 */
export function verifyPasscode(passcode: string, stored: string | null): boolean {
  if (!stored) return false;
  const [scheme, cost, saltHex, keyHex] = stored.split('$');
  if (scheme !== 'scrypt' || !cost || !saltHex || !keyHex) return false;

  const expected = Buffer.from(keyHex, 'hex');
  const actual = scryptSync(passcode, Buffer.from(saltHex, 'hex'), expected.length, {
    N: Number(cost),
    r: BLOCK_SIZE,
    p: PARALLELISM,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Why a passcode is unusable, or null when it is fine. */
export function passcodeProblem(passcode: string): string | null {
  if (passcode.length < MIN_PASSCODE_LENGTH) {
    return `must be at least ${MIN_PASSCODE_LENGTH} characters`;
  }
  if (passcode.length > MAX_PASSCODE_LENGTH) {
    return `must be at most ${MAX_PASSCODE_LENGTH} characters`;
  }
  if (passcode.trim() !== passcode) return 'must not start or end with a space';
  return null;
}

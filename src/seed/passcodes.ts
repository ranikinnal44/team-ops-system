/**
 * Demo credentials.
 *
 * Every seeded user gets their OWN passcode, derived from their email so the
 * seed can print it and a test can reproduce it without a fixture file. These
 * are demo credentials in a demo dataset: predictable on purpose, and no basis
 * for anything that matters.
 *
 * A passcode somebody sets through the app is theirs and unrelated to this.
 */
import { MIN_PASSCODE_LENGTH } from '../lib/passcode.ts';

export function seedPasscode(email: string): string {
  const local = (email.split('@')[0] ?? 'user').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const candidate = `${local}123`;
  return candidate.length >= MIN_PASSCODE_LENGTH
    ? candidate
    : candidate.padEnd(MIN_PASSCODE_LENGTH, '0');
}

import { randomUUID, randomBytes } from 'node:crypto';

/** Surrogate key for every entity. */
export const newId = (): string => randomUUID();

export const newToken = (): string => randomBytes(32).toString('base64url');

/**
 * Human-readable task reference, e.g. `AD-MAN-001`:
 *   <project code>-<workstream code>-<zero-padded sequence>
 *
 * The sequence is scoped to the project/workstream pair and supplied by the
 * repository inside the same transaction as the insert, which is what keeps
 * references unique under concurrent creation.
 */
export function formatTaskRef(projectCode: string, workstreamCode: string, sequence: number): string {
  return `${projectCode}-${workstreamCode}-${String(sequence).padStart(3, '0')}`;
}

/**
 * Derive a short uppercase code from a name, e.g. "Manipulation" -> "MAN",
 * "Warehouse Automation" -> "WA". Used to suggest codes; callers may override.
 */
export function suggestCode(name: string, length = 3): string {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return 'GEN';
  if (words.length >= 2) {
    return words
      .map((w) => w[0] ?? '')
      .join('')
      .slice(0, length);
  }
  return (words[0] ?? '').slice(0, length);
}

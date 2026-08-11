/**
 * Scout-X scrape IDs: SX + 2 digits + 2 letters + 2 digits (e.g. SX47KX19).
 * Parallel to internal UUID (recording_meta.id); never replaces it.
 */

export const SCOUT_ID_PATTERN = /^SX\d{2}[A-Z]{2}\d{2}$/;

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function randomDigit(): string {
  return String(Math.floor(Math.random() * 10));
}

function randomLetter(): string {
  return LETTERS[Math.floor(Math.random() * LETTERS.length)];
}

/** Normalize user input: trim + uppercase. Returns null if empty. */
export function normalizeScoutIdInput(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().toUpperCase();
  return s.length ? s : null;
}

export function isValidScoutId(value: string): boolean {
  return SCOUT_ID_PATTERN.test(value);
}

/** Generate one candidate ID (may collide; callers should retry). */
export function generateScoutId(): string {
  return `SX${randomDigit()}${randomDigit()}${randomLetter()}${randomLetter()}${randomDigit()}${randomDigit()}`;
}

/**
 * Generate a scoutId that is unique for `existsCheck`.
 * `existsCheck` should return true if the id is already taken.
 */
export async function generateUniqueScoutId(
  existsCheck: (id: string) => Promise<boolean>,
  maxAttempts = 32
): Promise<string> {
  for (let i = 0; i < maxAttempts; i += 1) {
    const candidate = generateScoutId();
    if (!(await existsCheck(candidate))) {
      return candidate;
    }
  }
  throw new Error('Failed to allocate a unique Scout-X ID');
}

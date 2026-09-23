/**
 * Scout-X company IDs: CX- + 8 uppercase alphanumerics (e.g. CX-A1B2C3D4).
 * Distinct from automation Scout IDs (SX47KX19).
 */

export const COMPANY_ID_PATTERN = /^CX-[A-Z0-9]{8}$/;

const ALPHANUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function randomAlphanum(): string {
  return ALPHANUM[Math.floor(Math.random() * ALPHANUM.length)];
}

/** Normalize user input: trim + uppercase. Returns null if empty. */
export function normalizeCompanyIdInput(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().toUpperCase();
  return s.length ? s : null;
}

export function isValidCompanyId(value: string): boolean {
  return COMPANY_ID_PATTERN.test(value);
}

/** Generate one candidate ID (may collide; callers should retry). */
export function generateCompanyId(): string {
  let suffix = '';
  for (let i = 0; i < 8; i += 1) {
    suffix += randomAlphanum();
  }
  return `CX-${suffix}`;
}

/**
 * Generate a companyId that is unique for `existsCheck`.
 * `existsCheck` should return true if the id is already taken.
 */
export async function generateUniqueCompanyId(
  existsCheck: (id: string) => Promise<boolean>,
  maxAttempts = 32
): Promise<string> {
  for (let i = 0; i < maxAttempts; i += 1) {
    const candidate = generateCompanyId();
    if (!(await existsCheck(candidate))) {
      return candidate;
    }
  }
  throw new Error('Failed to allocate a unique company ID');
}

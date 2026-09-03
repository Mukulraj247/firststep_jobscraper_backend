/**
 * Frozen job-category taxonomy, shared by the board API filter and the UI badges.
 *
 * This list must stay in lockstep with job-tagger/backend/classifier/audit.py
 * (FROZEN_CATEGORIES) — the sidecar refuses to load rules that drift from it, and
 * frozenJobCategories.test.ts asserts the two stay equal.
 */

export const FROZEN_JOB_CATEGORIES = [
  'Software Engineering',
  'Frontend Development',
  'Backend Development',
  'Full Stack Development',
  'Mobile Application Development',
  'DevOps',
  'Site Reliability Engineering',
  'Cloud Engineering',
  'Platform Engineering',
  'Data Engineering',
  'Data Analyst',
  'Data Science',
  'Machine Learning Engineer',
  'AI Engineer',
  'QA / Testing',
  'Cybersecurity',
  'Network Engineering',
  'Product Management',
  'Project Management',
  'UI/UX Design',
  'Technical Support',
  'SAP',
  'Salesforce',
  'ERP',
  'Blockchain / Web3',
  'Embedded Systems',
  'Electrical Engineering',
  'Game Development',
  'System Administration',
  'Solution Architecture',
] as const;

/** Guard against unbounded `$in` lists from a crafted query string. */
export const MAX_FROZEN_CATEGORY_FILTERS = 10;

/** Case- and spacing-insensitive key so "qa/testing" resolves to "QA / Testing". */
function taxonomyKey(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

const CANONICAL_BY_KEY = new Map<string, string>(
  FROZEN_JOB_CATEGORIES.map((name) => [taxonomyKey(name), name]),
);

export function canonicalFrozenCategory(value: string): string | null {
  return CANONICAL_BY_KEY.get(taxonomyKey(value)) || null;
}

/**
 * Parse a `frozenCategory` query value (repeated param or comma-separated) into
 * canonical taxonomy names. Unknown names are dropped so the filter can never
 * become an open-ended scan, and order follows the taxonomy for stable cache keys.
 */
export function normalizeFrozenCategoryFilter(raw: unknown): string[] {
  const parts: string[] = [];
  const push = (value: unknown) => {
    for (const piece of String(value ?? '').split(',')) {
      const trimmed = piece.trim();
      if (trimmed) parts.push(trimmed);
    }
  };

  if (Array.isArray(raw)) raw.forEach(push);
  else if (raw != null) push(raw);

  const selected = new Set<string>();
  for (const part of parts) {
    const canonical = canonicalFrozenCategory(part);
    if (canonical) selected.add(canonical);
  }

  return FROZEN_JOB_CATEGORIES.filter((name) => selected.has(name)).slice(
    0,
    MAX_FROZEN_CATEGORY_FILTERS,
  );
}

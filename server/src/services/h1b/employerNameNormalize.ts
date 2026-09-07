/**
 * Normalize employer / brand names for H-1B gov ↔ board matching.
 * Applied to both DOL legal entity names and job-board company names.
 */

const LEGAL_SUFFIX_RE =
  /\b(incorporated|corporation|company|limited|llc|l\.?l\.?c\.?|inc\.?|corp\.?|ltd\.?|co\.?|lp\.?|l\.?l\.?p\.?|plc|p\.?a\.?|p\.?c\.?|pllc)\b\.?/gi;

const NOISE_RE = /\b(d\/?b\/?a|dba|attn|attention|formerly|f\/?k\/?a)\b/gi;

export type NormalizedEmployerName = {
  /** Display-ish cleaned string (uppercased words collapsed). */
  display: string;
  /** Lowercase token string with spaces (for fuzzy / token overlap). */
  normalized: string;
  /** Lowercase alphanumerics only (exact bucket key). */
  key: string;
  tokens: string[];
};

/** Tokens that rarely distinguish employers when scoring overlap. */
export const STOP_TOKENS = new Set([
  'the',
  'and',
  'of',
  'for',
  'services',
  'service',
  'technologies',
  'technology',
  'solutions',
  'solution',
  'systems',
  'system',
  'group',
  'usa',
  'us',
  'america',
  'american',
  'international',
  'global',
  'north',
  'holdings',
  'holding',
  'partners',
  'partner',
  'consulting',
  'software',
]);

export function employerNameNormalize(raw: string): NormalizedEmployerName {
  let s = String(raw || '')
    .normalize('NFKC')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .trim();

  if (!s) {
    return { display: '', normalized: '', key: '', tokens: [] };
  }

  // Drop parenthetical state / junk: "(CA)", "(US)"
  s = s.replace(/\([^)]{0,40}\)/g, ' ');
  s = s.replace(NOISE_RE, ' ');
  s = s.replace(LEGAL_SUFFIX_RE, ' ');
  // Treat domain dots / ampersands as separators so AMAZON.COM → amazon + com
  s = s.replace(/[.&+_\-']/g, ' ');
  s = s.replace(/[^\w\s]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();

  // Strip leading THE
  s = s.replace(/^the\s+/i, '').trim();

  const normalized = s.toLowerCase().replace(/\s+/g, ' ').trim();
  const key = normalized.replace(/[^a-z0-9]/g, '');
  const tokens = normalized
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ''))
    .filter((t) => t.length >= 2 && !STOP_TOKENS.has(t) && t !== 'com' && t !== 'net' && t !== 'org');

  return {
    display: s,
    normalized,
    key,
    tokens,
  };
}

/** Significant-token Jaccard similarity in [0, 1]. */
export function tokenJaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const t of setA) {
    if (setB.has(t)) inter += 1;
  }
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Simple Levenshtein ratio in [0, 1] for short keys (cap length for safety). */
export function levenshteinRatio(a: string, b: string): number {
  const s = (a || '').slice(0, 64);
  const t = (b || '').slice(0, 64);
  if (!s && !t) return 1;
  if (!s || !t) return 0;
  const m = s.length;
  const n = t.length;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  const dist = dp[n];
  return 1 - dist / Math.max(m, n);
}

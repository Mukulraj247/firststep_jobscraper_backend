import { isAggregatorHostUrl } from './aggregatorIdentity';
import { isBoardQualityPass, isJunkDescription, normalizeJobDescription } from './jobPageParser';

/** Hard cap — total lifetime attempts per HC listing (not per day). */
export const HIRING_CAFE_ENRICHMENT_MAX_ATTEMPTS = parseInt(
  process.env.HIRING_CAFE_ENRICHMENT_MAX_ATTEMPTS ||
    process.env.JOB_ENRICHMENT_MAX_ATTEMPTS ||
    '10',
  10
);

export const HIRING_CAFE_ENRICHMENT_EXHAUSTED = 'hiring_cafe_enrichment_exhausted';

/** Backoff after failed attempt N (1-based): 15m → 1h → 3h → 6h → 12h → 24h… */
const BACKOFF_MS = [
  15 * 60_000,
  60 * 60_000,
  3 * 60 * 60_000,
  6 * 60 * 60_000,
  12 * 60 * 60_000,
] as const;

export function hiringCafeEnrichmentBackoffMs(attemptAfterFail: number): number {
  const n = Math.max(1, Math.floor(attemptAfterFail || 1));
  if (n <= BACKOFF_MS.length) return BACKOFF_MS[n - 1];
  return 24 * 60 * 60_000;
}

export function shouldRequeueHiringCafeAfterAttempt(attemptsAfterThisFail: number): boolean {
  return attemptsAfterThisFail < HIRING_CAFE_ENRICHMENT_MAX_ATTEMPTS;
}

/**
 * Comma/semicolon-heavy skill lists without job-description prose.
 * Matches the partial HC scrape pattern (skills field dumped into description).
 */
export function isSkillsDumpDescription(text: string): boolean {
  const raw = normalizeJobDescription(text);
  if (!raw || raw.length < 80) return false;

  const commaCount = (raw.match(/,/g) || []).length;
  if (commaCount < 8) return false;

  const sentenceEnds = (raw.match(/[.!?](\s|$)/g) || []).length;
  const hasJdProse =
    /\b(responsibilit|qualifications?|requirements?|about the (?:role|job|position)|you will|we are looking)\b/i.test(
      raw
    );

  // Many commas, almost no sentences, no JD language → skills dump.
  if (sentenceEnds <= 1 && !hasJdProse) return true;

  // Extremely comma-dense relative to length (avg token short).
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 12) {
    const avgLen = parts.reduce((n, p) => n + p.length, 0) / parts.length;
    if (avgLen <= 28 && sentenceEnds <= 2 && !hasJdProse) return true;
  }

  return false;
}

export function isHiringCafeBoardReady(opts: {
  title?: string;
  companyName?: string;
  description?: string;
  applyUrl?: string;
  jobUrl?: string;
}): boolean {
  const company = String(opts.companyName || '').trim();
  if (!company) return false;

  const applyUrl = String(opts.applyUrl || '').trim();
  if (!applyUrl || isAggregatorHostUrl(applyUrl)) return false;

  const description = String(opts.description || '').trim();
  if (isSkillsDumpDescription(description) || isJunkDescription(description)) return false;

  return isBoardQualityPass({
    title: opts.title,
    description,
    jobUrl: opts.jobUrl || applyUrl,
  });
}

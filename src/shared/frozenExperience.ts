/**
 * Frozen experience taxonomies for job board + future cluster membership.
 * Two tags per job:
 *   - frozenExperienceLevels (at most one): career level from title + YOE
 *   - frozenExperienceYears (0–1): year band from the highest YOE requirement
 *
 * Never guess a years band with no evidence — empty array is correct.
 */

export const FROZEN_EXPERIENCE_LEVELS = [
  'Entry Level',
  'Mid-Senior Level',
  'Senior Level',
  'People Manager Level',
  'Leadership Level',
] as const;

export type FrozenExperienceLevel = (typeof FROZEN_EXPERIENCE_LEVELS)[number];

export const FROZEN_EXPERIENCE_YEARS = [
  '0-3',
  '3-5',
  '5-7',
  '7-10',
  '10-15',
  '15+',
] as const;

export type FrozenExperienceYearBand = (typeof FROZEN_EXPERIENCE_YEARS)[number];

export const MAX_FROZEN_EXPERIENCE_LEVEL_FILTERS = 5;
export const MAX_FROZEN_EXPERIENCE_YEAR_FILTERS = 6;
/** One band per job — the band of the highest extracted YOE requirement. */
export const MAX_FROZEN_EXPERIENCE_YEARS_PER_JOB = 1;

/** Rules version — bump when scoring / aliases change (backfill key). */
export const EXPERIENCE_RULES_VERSION = 'exp-2026-09-6';

export type ExperienceResolveMethod =
  | 'hc_structured'
  | 'scrape_badge'
  | 'rules'
  | 'title_only'
  | 'none';

export type ExperienceResolveInput = {
  title?: string;
  description?: string;
  /** minimumQualifications + preferredQualifications joined, or raw arrays. */
  qualifications?: string | string[];
  seniorityLevel?: string;
  /** Hiring Cafe min_industry_and_role_yoe (or equivalent). */
  minYoe?: number | null;
  /** Hiring Cafe max_industry_and_role_yoe when present. */
  maxYoe?: number | null;
  isAggregator?: boolean;
};

export type ExperienceResolveResult = {
  frozenExperienceLevels: string[];
  frozenExperienceYears: string[];
  method: ExperienceResolveMethod;
  rulesVersion: string;
  matchedSignals: string[];
  /** Max extracted year for jobExperience numeric field (0 if none). */
  jobExperience: number;
  titleScore: number;
  yearsScore: number;
};

function taxonomyKey(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9+/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const LEVEL_ALIASES: Record<string, FrozenExperienceLevel> = {
  intern: 'Entry Level',
  internship: 'Entry Level',
  'entry level': 'Entry Level',
  entry: 'Entry Level',
  junior: 'Entry Level',
  'new grad': 'Entry Level',
  associate: 'Entry Level',
  'mid level': 'Mid-Senior Level',
  mid: 'Mid-Senior Level',
  'mid senior': 'Mid-Senior Level',
  'mid-senior': 'Mid-Senior Level',
  'mid-senior level': 'Mid-Senior Level',
  intermediate: 'Mid-Senior Level',
  senior: 'Senior Level',
  'senior level': 'Senior Level',
  staff: 'Senior Level',
  principal: 'Senior Level',
  lead: 'Senior Level',
  manager: 'People Manager Level',
  'people manager': 'People Manager Level',
  'people manager level': 'People Manager Level',
  'engineering manager': 'People Manager Level',
  director: 'Leadership Level',
  'leadership level': 'Leadership Level',
  leadership: 'Leadership Level',
  vp: 'Leadership Level',
  'vice president': 'Leadership Level',
  executive: 'Leadership Level',
  'c suite': 'Leadership Level',
  cto: 'Leadership Level',
  ceo: 'Leadership Level',
};

const CANONICAL_LEVEL_BY_KEY = new Map<string, FrozenExperienceLevel>(
  FROZEN_EXPERIENCE_LEVELS.map((name) => [taxonomyKey(name), name])
);

for (const [alias, canonical] of Object.entries(LEVEL_ALIASES)) {
  CANONICAL_LEVEL_BY_KEY.set(taxonomyKey(alias), canonical);
}

const CANONICAL_YEAR_BY_KEY = new Map<string, FrozenExperienceYearBand>(
  FROZEN_EXPERIENCE_YEARS.map((name) => [taxonomyKey(name), name])
);

export function canonicalExperienceLevel(value: string): FrozenExperienceLevel | null {
  const key = taxonomyKey(value);
  if (!key) return null;
  return CANONICAL_LEVEL_BY_KEY.get(key) || null;
}

export function canonicalExperienceYearBand(value: string): FrozenExperienceYearBand | null {
  const key = taxonomyKey(value);
  if (!key) return null;
  return CANONICAL_YEAR_BY_KEY.get(key) || null;
}

export function normalizeExperienceLevelFilter(raw: unknown): string[] {
  return normalizeTaxonomyFilter(raw, FROZEN_EXPERIENCE_LEVELS, canonicalExperienceLevel, MAX_FROZEN_EXPERIENCE_LEVEL_FILTERS);
}

export function normalizeExperienceYearFilter(raw: unknown): string[] {
  return normalizeTaxonomyFilter(raw, FROZEN_EXPERIENCE_YEARS, canonicalExperienceYearBand, MAX_FROZEN_EXPERIENCE_YEAR_FILTERS);
}

function normalizeTaxonomyFilter<T extends string>(
  raw: unknown,
  order: readonly T[],
  canonicalize: (value: string) => T | null,
  max: number
): string[] {
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
    const canonical = canonicalize(part);
    if (canonical) selected.add(canonical);
  }
  return order.filter((name) => selected.has(name)).slice(0, max);
}

/** Lower-inclusive, upper-exclusive bands; 15+ is open-ended. */
export function bandForYear(n: number): FrozenExperienceYearBand | null {
  if (!Number.isFinite(n) || n < 0 || n > 30) return null;
  if (n < 3) return '0-3';
  if (n < 5) return '3-5';
  if (n < 7) return '5-7';
  if (n < 10) return '7-10';
  if (n < 15) return '10-15';
  return '15+';
}

/**
 * Map extracted YOE numbers to at most one band — the band of the highest year.
 * Secondary mentions (preferred quals, niche skills with lower YOE) must not
 * produce a second chip; the filter signal is the bar to clear, not every number
 * that appears in the JD.
 */
export function bandsForYears(years: number[]): FrozenExperienceYearBand[] {
  const valid = years.filter((n) => Number.isFinite(n) && n >= 0 && n <= 30);
  if (!valid.length) return [];
  const band = bandForYear(Math.max(...valid));
  return band ? [band] : [];
}

/**
 * Map a closed YOE range to one band.
 * Uses the high end of the half-open interval [lo, hi) so "5-7 years" stays in
 * 5-7 (not 7-10), while still reflecting the upper requirement.
 */
export function bandsForYearRange(lo: number, hi: number): FrozenExperienceYearBand[] {
  const low = Math.max(0, Math.min(lo, hi));
  const high = Math.min(30, Math.max(lo, hi));
  if (low === high) {
    const band = bandForYear(low);
    return band ? [band] : [];
  }
  // Representative point just below the exclusive upper bound.
  const representative = Math.max(low, high - 0.01);
  const band = bandForYear(representative);
  return band ? [band] : [];
}

export type ExtractedYears = {
  /** Distinct year numbers found (for banding + max). */
  years: number[];
  /** Explicit ranges found as [lo, hi]. */
  ranges: Array<[number, number]>;
  signals: string[];
};

/**
 * Windows that look like YOE but are not job requirements.
 * "18 years of age", "for more than 25 years" (company history), etc.
 */
const REJECT_CONTEXT_RE =
  /\b(founded|in business|over the last|in the last|past\s+\d+\s+years?|years?\s+ago|anniversary|established|since\s+\d{4}|years?\s+of\s+age|of\s+age|must\s+be\s+\d+|older\s+than|younger\s+than|track\s+record\s+spans|spans\s+nearly|revolutioniz\w*\s+.{0,40}for\s+more\s+than|for\s+more\s+than\s+\d+\s+years?|more\s+than\s+\d+\s+years?\s+(?:in\s+providing|of\s+service|globally|as\s+a)|nearly\s+\d+\s+years?\s+(?:in|of)|over\s+\d+\s+years?\s+(?:of\s+)?(?:service|operation|history|providing))\b/i;

function hasExperienceContext(window: string): boolean {
  if (REJECT_CONTEXT_RE.test(window)) return false;
  // Require a real experience cue — bare "N years" alone is too loose
  // (matches company age, "18 years of age", program length, etc.).
  if (
    /\b(experience|exp\.?|yoe|qualification|required|require|minimum|prefer(?:red)?|background)\b/i.test(
      window
    )
  ) {
    return true;
  }
  // Common short form: "5+ years in data engineering" / "5 years as an ISSO"
  return /\byears?\s*\+?\s+(?:in|with|as)\b/i.test(window);
}

/**
 * Match-local reject: the matched span itself must not be an age / duration phrase.
 * Catches "18 years of age" even when surrounding text mentions "experience" elsewhere.
 */
function isNonYoeYearPhrase(raw: string, matchIndex: number, matchLen: number): boolean {
  const after = raw.slice(matchIndex + matchLen, matchIndex + matchLen + 24).toLowerCase();
  const before = raw.slice(Math.max(0, matchIndex - 30), matchIndex).toLowerCase();
  if (/^\s*of\s+age\b/.test(after)) return true;
  if (/^\s*old\b/.test(after)) return true;
  if (/\b(age|aged)\s*$/.test(before) && /\byears?\b/.test(raw.slice(matchIndex, matchIndex + matchLen))) {
    return true;
  }
  // "for more than 25 years" / "more than 25 years" without "experience" right after
  if (
    /\b(for\s+)?(more\s+than|over|nearly|almost)\s*$/.test(before) &&
    !/\bexperience\b/i.test(after.slice(0, 20))
  ) {
    return true;
  }
  // Internship program length: "10-week", "12 week summer" — handled separately if needed
  return false;
}

function clampYear(n: number): number | null {
  if (!Number.isFinite(n)) return null;
  if (n <= 0 || n > 30) return null;
  // Reject 4-digit calendar years that slipped through.
  if (n >= 1900 && n <= 2100) return null;
  return Math.round(n * 10) / 10;
}

/**
 * Extract YOE numbers and ranges from free text.
 * Matches: 6 years, 6+ years, 5-7 years, 5 to 7 years, minimum of 6 years, at least 8 years, 18 months.
 */
export function extractExperienceYears(text: string): ExtractedYears {
  const raw = String(text || '');
  const years: number[] = [];
  const ranges: Array<[number, number]> = [];
  const signals: string[] = [];
  const seen = new Set<string>();

  const pushYear = (n: number, signal: string, matchIndex?: number, matchLen?: number) => {
    const v = clampYear(n);
    if (v == null) return;
    // Very high numbers are almost never YOE requirements (company age, "30 years of
    // excellence"). Only accept ≥15 when the match is explicitly "years of experience".
    if (v >= 15 && matchIndex != null && matchLen != null) {
      const around = raw
        .slice(matchIndex, Math.min(raw.length, matchIndex + matchLen + 28))
        .toLowerCase();
      if (!/\byears?\s+of\s+experience\b/.test(around) && !/\b\d+\s*\+?\s*yoe\b/.test(around)) {
        return;
      }
    }
    const key = `y:${v}`;
    if (seen.has(key)) return;
    seen.add(key);
    years.push(v);
    signals.push(signal);
  };

  const pushRange = (lo: number, hi: number, signal: string, matchIndex?: number, matchLen?: number) => {
    const a = clampYear(lo);
    const b = clampYear(hi);
    if (a == null || b == null) return;
    const low = Math.min(a, b);
    const high = Math.max(a, b);
    const key = `r:${low}-${high}`;
    if (seen.has(key)) return;
    seen.add(key);
    ranges.push([low, high]);
    // Also sample endpoints as years for max / level scoring.
    pushYear(low, signal, matchIndex, matchLen);
    pushYear(high, signal, matchIndex, matchLen);
    signals.push(signal);
  };

  const considerMatch = (matchIndex: number, matchLen: number, apply: () => void) => {
    if (isNonYoeYearPhrase(raw, matchIndex, matchLen)) return;
    const start = Math.max(0, matchIndex - 40);
    const end = Math.min(raw.length, matchIndex + matchLen + 40);
    const window = raw.slice(start, end);
    if (!hasExperienceContext(window)) return;
    apply();
  };

  // Ranges: 5-7 years / 5 – 7 years / 5 to 7 years
  const rangeRe =
    /(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)\s*\+?\s*years?(?:\s+of\s+experience)?/gi;
  for (const m of raw.matchAll(rangeRe)) {
    const lo = parseFloat(m[1]);
    const hi = parseFloat(m[2]);
    const idx = m.index ?? 0;
    considerMatch(idx, m[0].length, () => {
      pushRange(lo, hi, `range:${lo}-${hi}`, idx, m[0].length);
    });
  }

  // Months: 18 months / 18+ months of experience
  const monthsRe =
    /(\d+(?:\.\d+)?)\s*\+?\s*months?(?:\s+of\s+experience)?/gi;
  for (const m of raw.matchAll(monthsRe)) {
    const months = parseFloat(m[1]);
    const idx = m.index ?? 0;
    considerMatch(idx, m[0].length, () => {
      pushYear(months / 12, `months:${months}`, idx, m[0].length);
    });
  }

  // Single: 6 years / 6+ years / 6 years of experience / at least 8 years / minimum of 6 years
  const singleRe =
    /(?:(?:at\s+least|minimum\s+of|min(?:imum)?\.?\s*(?:of)?)\s+)?(\d+(?:\.\d+)?)\s*\+?\s*(?:\+|plus\s+)?years?(?:\s+of\s+experience)?/gi;
  for (const m of raw.matchAll(singleRe)) {
    // Skip if this match is part of an already-handled range (digit-digit years).
    const full = m[0];
    if (/\d\s*(?:-|–|—|to)\s*\d/.test(raw.slice(Math.max(0, (m.index ?? 0) - 8), (m.index ?? 0) + full.length))) {
      continue;
    }
    const n = parseFloat(m[1]);
    const idx = m.index ?? 0;
    considerMatch(idx, full.length, () => {
      pushYear(n, `years:${n}`, idx, full.length);
    });
  }

  return { years, ranges, signals };
}

function yearsPoints(maxYear: number): number {
  if (maxYear <= 0) return 0;
  if (maxYear <= 1) return 1;
  if (maxYear <= 3) return 2;
  if (maxYear <= 5) return 3;
  if (maxYear <= 7) return 5;
  if (maxYear <= 9) return 6;
  if (maxYear <= 14) return 8;
  return 10;
}

type TitleSignals = {
  score: number;
  signals: string[];
  isExec: boolean;
  isManager: boolean;
  /** Junior / associate / new-grad — soft Entry bias, overridden by high YOE. */
  isJunior: boolean;
  /** Intern / internship — hard Entry + 0-3; ignore inflated YOE. */
  isIntern: boolean;
};

function scoreTitle(title: string): TitleSignals {
  const t = String(title || '').toLowerCase();
  const signals: string[] = [];
  let score = 0;
  let isExec = false;
  let isManager = false;
  let isJunior = false;
  let isIntern = false;

  const hit = (re: RegExp, label: string, pts: number) => {
    if (re.test(t)) {
      signals.push(`title:${label}`);
      score += pts;
      return true;
    }
    return false;
  };

  // Exec family — checked before points matter.
  if (
    /\b(chief|cto|ceo|cfo|coo|ciso|cpo)\b/.test(t) ||
    /\bvice\s+president\b|\bvp\b/.test(t) ||
    /\bdirector\b/.test(t) ||
    /\bpresident\b/.test(t) ||
    /\bpartner\b/.test(t) ||
    /\bhead\s+of\b/.test(t)
  ) {
    isExec = true;
    signals.push('title:exec');
  }

  // Manager family (not "product manager" as exec — still people-manager-ish for EM;
  // "product manager" / "program manager" / "project manager" are IC-ish but plan says
  // manager → People Manager. Keep "manager" as manager family except when clearly IC title
  // patterns like "product manager" without engineering manager — plan: manager → People Manager.
  if (/\b(engineering\s+manager|people\s+manager|hiring\s+manager)\b/.test(t) || /\bmanager\b/.test(t)) {
    // Exclude non-people "manager" compound roles that are typically IC.
    const icManager =
      /\b(product|project|program|account|office|case|property|stage|brand)\s+manager\b/.test(t) &&
      !/\bengineering\s+manager\b/.test(t);
    if (!icManager) {
      isManager = true;
      signals.push('title:manager');
    }
  }

  // Intern is a hard early-career signal (separate from junior/associate).
  if (/\b(intern|internship)\b/.test(t)) {
    isIntern = true;
    isJunior = true;
    signals.push('title:intern');
    score += 1;
  } else if (hit(/\b(new\s*grad|junior|associate)\b/, 'junior', 1)) {
    isJunior = true;
  }
  hit(/\b(senior|sr\.?)\b/, 'senior', 3);
  hit(/\b(lead|staff)\b/, 'lead_staff', 3);
  hit(/\b(principal|distinguished|fellow)\b/, 'principal', 4);
  // Seniority-implying nouns (architect / specialist) when no other level word.
  if (!/\b(intern|junior|associate|senior|sr\.?|lead|staff|principal)\b/.test(t)) {
    hit(/\b(architect|specialist)\b/, 'architect_specialist', 3);
  }

  return { score, signals, isExec, isManager, isJunior, isIntern };
}

function levelFromIcScore(total: number): FrozenExperienceLevel {
  if (total <= 3) return 'Entry Level';
  if (total <= 8) return 'Mid-Senior Level';
  return 'Senior Level';
}

function joinQualifications(qualifications?: string | string[]): string {
  if (!qualifications) return '';
  if (Array.isArray(qualifications)) return qualifications.filter(Boolean).join('\n');
  return String(qualifications);
}

function contentParts(input: ExperienceResolveInput): string {
  const quals = joinQualifications(input.qualifications);
  return [input.description || '', quals].filter(Boolean).join('\n');
}

/**
 * Resolve frozen experience level + year bands for a job.
 */
export function resolveFrozenExperience(input: ExperienceResolveInput): ExperienceResolveResult {
  const matchedSignals: string[] = [];
  const titleInfo = scoreTitle(input.title || '');
  matchedSignals.push(...titleInfo.signals);

  // --- Year evidence ---
  const yearSet = new Set<number>();
  const rangeList: Array<[number, number]> = [];

  const minYoe =
    typeof input.minYoe === 'number' && Number.isFinite(input.minYoe) && input.minYoe > 0
      ? input.minYoe
      : null;
  const maxYoe =
    typeof input.maxYoe === 'number' && Number.isFinite(input.maxYoe) && input.maxYoe > 0
      ? input.maxYoe
      : null;

  // Internships: ignore structured YOE (often garbage / company-age bleed) and text
  // extraction for banding — force Entry + 0-3 below.
  let usedHcStructured = false;
  if (!titleInfo.isIntern && (minYoe != null || maxYoe != null)) {
    usedHcStructured = true;
    const lo = minYoe ?? maxYoe!;
    const hi = maxYoe ?? minYoe!;
    if (minYoe != null && maxYoe != null && minYoe !== maxYoe) {
      rangeList.push([Math.min(lo, hi), Math.max(lo, hi)]);
      matchedSignals.push(`hc_yoe_range:${Math.min(lo, hi)}-${Math.max(lo, hi)}`);
    } else {
      yearSet.add(lo);
      matchedSignals.push(`hc_yoe:${lo}`);
    }
    yearSet.add(lo);
    yearSet.add(hi);
  } else if (titleInfo.isIntern && (minYoe != null || maxYoe != null)) {
    matchedSignals.push('intern_ignore_structured_yoe');
  }

  const extracted = extractExperienceYears(contentParts(input));
  if (!titleInfo.isIntern) {
    for (const y of extracted.years) yearSet.add(y);
    for (const r of extracted.ranges) rangeList.push(r);
    matchedSignals.push(...extracted.signals);
  } else if (extracted.years.length || extracted.ranges.length) {
    matchedSignals.push('intern_ignore_extracted_yoe');
  }

  let allYears = [...yearSet].filter((n) => n > 0 && n <= 30).sort((a, b) => a - b);
  let maxYear = allYears.length ? Math.max(...allYears) : 0;

  // Intern titles: hard Entry + 0-3. Company blurbs ("25 years") and age lines must
  // never become the years chip.
  if (titleInfo.isIntern) {
    allYears = [];
    maxYear = 0;
    rangeList.length = 0;
    matchedSignals.push('intern_force_entry_0_3');
  }

  const yPts = yearsPoints(maxYear);
  if (maxYear > 0) matchedSignals.push(`years_points:${yPts}`);

  // One band only: the highest YOE requirement. Prefer an explicit range's
  // representative when that range's high end is the max (so "5-7 years" → 5-7
  // rather than 7-10); otherwise band the max single number.
  let frozenExperienceYears: FrozenExperienceYearBand[] = [];
  if (titleInfo.isIntern) {
    frozenExperienceYears = ['0-3'];
  } else if (maxYear > 0) {
    const coveringRange = rangeList
      .filter(([lo, hi]) => hi >= maxYear && lo <= maxYear)
      .sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
    if (coveringRange) {
      frozenExperienceYears = bandsForYearRange(coveringRange[0], coveringRange[1]);
      matchedSignals.push(`years_band_from_range:${coveringRange[0]}-${coveringRange[1]}`);
    } else {
      frozenExperienceYears = bandsForYears([maxYear]);
      matchedSignals.push(`years_band_from_max:${maxYear}`);
    }
  }

  // --- Level ---
  const badgeLevel = canonicalExperienceLevel(String(input.seniorityLevel || ''));
  if (badgeLevel) matchedSignals.push(`badge:${input.seniorityLevel}`);

  let rulesLevel: FrozenExperienceLevel | null = null;
  let method: ExperienceResolveMethod = 'none';

  if (titleInfo.isIntern) {
    rulesLevel = 'Entry Level';
    method = 'title_only';
  } else if (titleInfo.isExec) {
    rulesLevel = 'Leadership Level';
    method = allYears.length || usedHcStructured ? 'rules' : 'title_only';
  } else if (titleInfo.isManager) {
    if (maxYear > 0 && maxYear <= 2) {
      rulesLevel = 'Mid-Senior Level';
      matchedSignals.push('manager_demoted_low_yoe');
    } else {
      rulesLevel = 'People Manager Level';
    }
    method = allYears.length || usedHcStructured ? 'rules' : 'title_only';
  } else {
    const titleScore = titleInfo.score;
    const total = titleScore + yPts;
    matchedSignals.push(`title_score:${titleScore}`, `total_score:${total}`);
    if (titleScore > 0 || maxYear > 0 || usedHcStructured) {
      if (allYears.length || usedHcStructured) {
        rulesLevel = levelFromIcScore(total);
        // Untitled / non-junior IC asking for 4+ years is at least Mid-Senior
        // (years_points alone for 4–5y was 3 → Entry under the 0–3 threshold).
        if (
          maxYear >= 4 &&
          !titleInfo.isJunior &&
          rulesLevel === 'Entry Level'
        ) {
          rulesLevel = 'Mid-Senior Level';
          matchedSignals.push('floor_mid_yoe_ge_4');
        }
        // Junior/associate titles: Entry only when YOE is low or missing.
        // "Junior ISSO, 5+ years" is Mid-Senior + 5-7 — not Entry + 5-7.
        if (titleInfo.isJunior && maxYear >= 4) {
          if (rulesLevel === 'Entry Level') {
            rulesLevel = 'Mid-Senior Level';
          }
          matchedSignals.push('junior_high_yoe_no_entry_ceiling');
        } else if (titleInfo.isJunior && rulesLevel !== 'Entry Level') {
          rulesLevel = 'Entry Level';
          matchedSignals.push('junior_ceiling_entry');
        }
        method = 'rules';
      } else {
        // Title-only: do not treat missing YOE as 0 years (would push senior→Entry).
        if (titleScore >= 4) rulesLevel = 'Senior Level';
        else if (titleScore >= 3) rulesLevel = 'Mid-Senior Level';
        else rulesLevel = 'Entry Level';
        method = 'title_only';
      }
    }
  }

  // Precedence: scrape_badge wins for level when present — except a bad Entry/Intern
  // badge must not override a real 4+ YOE requirement (would create Entry + 5-7 chips).
  let finalLevel: FrozenExperienceLevel | null = rulesLevel;
  if (titleInfo.isIntern) {
    finalLevel = 'Entry Level';
    method = 'title_only';
  } else if (badgeLevel) {
    const badgeIsEarly =
      badgeLevel === 'Entry Level' ||
      /intern/i.test(String(input.seniorityLevel || ''));
    if (
      badgeIsEarly &&
      maxYear >= 4 &&
      rulesLevel &&
      rulesLevel !== 'Entry Level'
    ) {
      matchedSignals.push(`badge_entry_overridden_by_yoe:${badgeLevel}`);
      finalLevel = rulesLevel;
      method = usedHcStructured ? 'hc_structured' : 'rules';
    } else {
      if (rulesLevel && rulesLevel !== badgeLevel) {
        matchedSignals.push(`rules_level:${rulesLevel}`);
        matchedSignals.push(`badge_wins:${badgeLevel}`);
      }
      finalLevel = badgeLevel;
      method = 'scrape_badge';
    }
  } else if (usedHcStructured && method === 'rules') {
    method = 'hc_structured';
  }

  if (!finalLevel && !frozenExperienceYears.length) {
    return {
      frozenExperienceLevels: [],
      frozenExperienceYears: [],
      method: 'none',
      rulesVersion: EXPERIENCE_RULES_VERSION,
      matchedSignals,
      jobExperience: maxYear > 0 ? Math.min(30, Math.floor(maxYear)) : 0,
      titleScore: titleInfo.score,
      yearsScore: yPts,
    };
  }

  return {
    frozenExperienceLevels: finalLevel ? [finalLevel] : [],
    frozenExperienceYears,
    method: finalLevel || frozenExperienceYears.length ? method : 'none',
    rulesVersion: EXPERIENCE_RULES_VERSION,
    matchedSignals,
    jobExperience: titleInfo.isIntern
      ? 0
      : maxYear > 0
        ? Math.min(30, Math.floor(maxYear))
        : 0,
    titleScore: titleInfo.score,
    yearsScore: yPts,
  };
}

/** Content hash inputs for idempotent enrichment skip. */
export function experienceContentHashParts(input: ExperienceResolveInput): string {
  const quals = joinQualifications(input.qualifications);
  return [
    String(input.title || '').trim(),
    String(input.description || '').trim().slice(0, 4000),
    quals.slice(0, 2000),
    String(input.seniorityLevel || '').trim(),
    String(input.minYoe ?? ''),
    String(input.maxYoe ?? ''),
  ].join('\n|\n');
}

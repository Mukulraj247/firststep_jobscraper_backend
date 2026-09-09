import { FIRSTSTEP, RADIUS, hiddenScrollbarSx, tint } from '../../components/dashboard/ops/dashboardTokens';
import { formatIstYmd, istHourOf, istMinuteOf } from '../../shared/opsTimezone';

export const JOB_BOARD_FILTER_CONTROLS = [
  'search',
  'added',
  'category',
  'frozenCategory',
  'frozenIndustry',
  'frozenExperienceLevel',
  'frozenExperienceYear',
  'location',
  'workMode',
  'jobType',
] as const;

export type JobBoardAddedPreset = '1h' | '6h' | '24h' | '7d' | 'all';

export const ADDED_DATE_PRESETS: Array<{ value: JobBoardAddedPreset; label: string }> = [
  { value: '1h', label: 'Last 1h' },
  { value: '6h', label: 'Last 6h' },
  { value: '24h', label: 'Last 24h' },
  { value: '7d', label: 'Last 7d' },
  { value: 'all', label: 'All' },
];

/** Hiring Cafe, Accel, and LinkedIn are aggregator providers — not their own Source chips. */
export const JOB_BOARD_SOURCE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'aggregator', label: 'Aggregator' },
];

export const WORK_MODE_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'Remote', label: 'Remote' },
  { value: 'Hybrid', label: 'Hybrid' },
  { value: 'Onsite', label: 'Onsite' },
] as const;

export const JOB_TYPE_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'Full time', label: 'Full time' },
  { value: 'Part time', label: 'Part time' },
  { value: 'Contract', label: 'Contract' },
  { value: 'Internship', label: 'Internship' },
  { value: 'Temporary', label: 'Temporary' },
  { value: 'Freelance', label: 'Freelance' },
] as const;

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const ADDED_MS: Record<Exclude<JobBoardAddedPreset, 'all'>, number> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

export type JobBoardFilterState = {
  q: string;
  added: JobBoardAddedPreset;
  category: string;
  /** Frozen taxonomy multi-select; a job matches when it carries any selected name. */
  frozenCategories?: string[];
  frozenIndustries?: string[];
  frozenExperienceLevels?: string[];
  frozenExperienceYears?: string[];
  location: string;
  workMode: string;
  jobType: string;
  source?: string;
  h1bSponsorFriendly?: boolean;
  h1bFy2026Match?: boolean;
};

/**
 * Badge copy for DOL-backed H-1B signals (separate from JD visaSponsorship chip).
 */
export function h1bSponsorBadgeLabel(data: {
  h1bEligible?: boolean;
  h1bCompanyScore?: string;
  h1bRoleScore?: string;
  h1bMappingStatus?: string;
}): string | null {
  if (!data.h1bEligible) return null;
  const status = String(data.h1bMappingStatus || 'none');
  if (status === 'rejected' || status === 'none') return null;
  const company = String(data.h1bCompanyScore || 'unknown');
  const role = String(data.h1bRoleScore || 'unknown');
  if (company === 'high' && role === 'high') return 'H-1B sponsor (role match)';
  if (company === 'high') return 'H-1B sponsor (company)';
  if (company === 'medium') return 'Possible H-1B sponsor';
  return null;
}

export function h1bSponsorTooltip(data: {
  h1bFilingCount?: number;
  h1bDataAsOf?: string | Date | null;
  h1bMatchedGovEmployer?: string;
}): string {
  const n = typeof data.h1bFilingCount === 'number' ? data.h1bFilingCount : 0;
  const asOf = data.h1bDataAsOf
    ? new Date(data.h1bDataAsOf).toISOString().slice(0, 10)
    : null;
  const gov = String(data.h1bMatchedGovEmployer || '').trim();
  const parts = [
    n > 0 ? `Based on ${n.toLocaleString()} DOL filings` : 'Based on DOL LCA data',
    asOf ? `data as of ${asOf}` : null,
    gov ? `matched ${gov}` : null,
  ].filter(Boolean);
  return parts.join(' · ');
}

/** FY2026 job-level filing match chip (strict title overlap vs FY2026 certified titles). */
export function fy2026FilingMatchBadgeLabel(data: {
  h1bFy2026Match?: boolean;
}): string | null {
  return data.h1bFy2026Match ? 'FY2026 H-1B filing match' : null;
}

export function fy2026FilingMatchTooltip(data: {
  h1bFy2026MatchedTitle?: string;
  h1bFy2026CertifiedCount?: number;
  h1bFy2026DataAsOf?: string | Date | null;
  h1bFy2026TitleConfidence?: number;
}): string {
  const title = String(data.h1bFy2026MatchedTitle || '').trim();
  const n = typeof data.h1bFy2026CertifiedCount === 'number' ? data.h1bFy2026CertifiedCount : 0;
  const asOf = data.h1bFy2026DataAsOf
    ? new Date(data.h1bFy2026DataAsOf).toISOString().slice(0, 10)
    : null;
  const conf =
    typeof data.h1bFy2026TitleConfidence === 'number' && data.h1bFy2026TitleConfidence > 0
      ? `${Math.round(data.h1bFy2026TitleConfidence * 100)}% title overlap`
      : null;
  const parts = [
    title ? `Matched DOL title “${title}”` : null,
    n > 0 ? `${n.toLocaleString()} FY2026 certified filings` : 'FY2026 DOL filings to date',
    conf,
    asOf ? `data as of ${asOf}` : null,
  ].filter(Boolean);
  return parts.join(' · ') || 'FY2026 DOL filings to date';
}

/**
 * Normalize a frozen-category selection: trim, drop blanks/duplicates, and sort by
 * the facet's (taxonomy) order so chips keep a stable position as the user picks
 * them and the request/cache key does not change with click order.
 * Names the facet no longer offers are kept, at the end, so an active filter never
 * disappears silently.
 */
export function orderFrozenCategories(
  selected: readonly string[],
  facetOrder: readonly string[] = [],
): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const item of selected) {
    const name = String(item || '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    cleaned.push(name);
  }
  const rank = (item: string) => {
    const index = facetOrder.indexOf(item);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  return cleaned.sort((a, b) => rank(a) - rank(b));
}

export function addedSinceMs(
  preset: JobBoardAddedPreset,
  nowMs: number = Date.now(),
): number | null {
  if (preset === 'all') return null;
  return nowMs - ADDED_MS[preset];
}

export function hasActiveJobBoardFilters(value: JobBoardFilterState): boolean {
  return Boolean(
    value.q.trim()
    || (value.added && value.added !== 'all')
    || value.category
    || value.frozenCategories?.length
    || value.frozenIndustries?.length
    || value.frozenExperienceLevels?.length
    || value.frozenExperienceYears?.length
    || value.location
    || value.workMode
    || value.jobType
    || value.source
    || value.h1bSponsorFriendly
    || value.h1bFy2026Match,
  );
}

function toMs(value: unknown): number | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

export function resolveJobDisplayInstant(
  posted: unknown,
  createdAt: unknown,
  nowMs: number = Date.now(),
): number | null {
  const postedMs = toMs(posted);
  const createdMs = toMs(createdAt);
  if (postedMs != null && postedMs <= nowMs) return postedMs;
  if (createdMs != null) return createdMs;
  return postedMs;
}

export function formatJobBoardDate(value: unknown): string {
  const ms = typeof value === 'number' ? value : toMs(value);
  if (ms == null) return '';
  const ymd = formatIstYmd(ms);
  const [, month, day] = ymd.split('-');
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${ymd.slice(0, 4)}`;
}

export function formatRunJobAddedAt(value: unknown): string {
  const ms = typeof value === 'number' ? value : toMs(value);
  if (ms == null) return '';
  const ymd = formatIstYmd(ms);
  const [, month, day] = ymd.split('-');
  const hour = istHourOf(ms);
  const minute = istMinuteOf(ms);
  const period = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour % 12 || 12;
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${ymd.slice(0, 4)}, ${h12}:${String(minute).padStart(2, '0')} ${period} IST`;
}

/** Let MainPage scroll the whole job board; do not pin the hero while cards scroll. */
export function jobBoardPageRootOverflow(): 'visible' {
  return 'visible';
}

export const JOB_BOARD_HERO_LAYOUT = 'split' as const;

export function jobBoardHidesScrollbar(): boolean {
  return true;
}

export function jobBoardScrollSx() {
  return {
    overflow: 'auto' as const,
    ...hiddenScrollbarSx,
  };
}

export function formatFacetOptionLabel(value: string, max = 42): string {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trim()}…`;
}

export function jobBoardFilterChipSx(selected: boolean) {
  return {
    fontWeight: 700,
    borderRadius: RADIUS.pill,
    ...(selected
      ? { bgcolor: FIRSTSTEP.tealDark, color: '#fff' }
      : { borderColor: FIRSTSTEP.border, color: FIRSTSTEP.navy }),
  };
}

export function jobBoardFacetListboxSx() {
  return {
    maxHeight: 280,
    overflowY: 'auto' as const,
    '&::-webkit-scrollbar': { width: 8 },
    '&::-webkit-scrollbar-thumb': {
      bgcolor: tint(FIRSTSTEP.teal, 0.45),
      borderRadius: 8,
    },
  };
}

export function formatJobBoardRelative(value: unknown, nowMs: number = Date.now()): string {
  const ms = typeof value === 'number' ? value : toMs(value);
  if (ms == null) return '';
  const diffMs = nowMs - ms;
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days < 0) return formatJobBoardDate(ms);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return formatJobBoardDate(ms);
}

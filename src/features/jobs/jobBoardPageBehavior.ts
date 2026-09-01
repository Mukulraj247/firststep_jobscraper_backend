import { FIRSTSTEP, RADIUS, hiddenScrollbarSx, tint } from '../../components/dashboard/ops/dashboardTokens';
import { formatIstYmd, istHourOf, istMinuteOf } from '../../shared/opsTimezone';

export const JOB_BOARD_FILTER_CONTROLS = [
  'search',
  'added',
  'category',
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
  location: string;
  workMode: string;
  jobType: string;
  source?: string;
};

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
    || value.location
    || value.workMode
    || value.jobType
    || value.source,
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

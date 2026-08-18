import { FIRSTSTEP, tint } from '../../components/dashboard/ops/dashboardTokens';

export type RunsContentState =
  | 'first-load-skeleton'
  | 'load-error'
  | 'account-empty'
  | 'filtered-empty'
  | 'rows';

export const HERO_OVERLINE = 'Run history';
export const HERO_TITLE = 'All Runs';
export const HERO_SUBTITLE =
  'Browse every automation run — filter by status, date, jobs added, or duration, then drill into logs and output.';
export const HERO_REFRESH_VARIANT = 'outlined' as const;

export const FILTER_CONTROL_IDS = {
  search: 'runs-filter-search',
  date: 'runs-filter-date',
  status: 'runs-filter-status',
  jobs: 'runs-filter-jobs',
  duration: 'runs-filter-duration',
  clearAll: 'runs-filter-clear-all',
} as const;

export const FILTER_LABEL_IDS = {
  status: 'runs-filter-status-label',
  jobs: 'runs-filter-jobs-label',
  duration: 'runs-filter-duration-label',
} as const;

export const RUN_STATUS_FILTER_OPTIONS = [
  { value: '', label: 'Any status' },
  { value: 'running', label: 'Running' },
  { value: 'queued,pending', label: 'Queued / pending' },
  { value: 'completed,success', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'aborted', label: 'Aborted' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'dead', label: 'Dead' },
] as const;

export const JOBS_FILTER_OPTIONS = [
  { value: '', label: 'Any jobs count' },
  { value: '0', label: 'Exactly 0 jobs' },
  { value: 'gt2', label: 'More than 2 jobs' },
  { value: 'gt3', label: 'More than 3 jobs' },
  { value: 'gt4', label: 'More than 4 jobs' },
] as const;

export const DURATION_FILTER_OPTIONS = [
  { value: '', label: 'Any duration' },
  { value: 'lt5', label: 'Under 5 minutes' },
  { value: 'lt30', label: 'Under 30 minutes' },
  { value: 'gt30', label: 'Over 30 minutes' },
  { value: 'gt60', label: 'Over 1 hour' },
] as const;

export type RunsFiltersValue = {
  searchInput: string;
  date: string;
  status: string;
  jobsAdded: string;
  duration: string;
};

export function hasActiveRunFilters(value: RunsFiltersValue): boolean {
  return Boolean(
    value.searchInput.trim()
    || value.date
    || value.status
    || value.jobsAdded
    || value.duration,
  );
}

export function automationCountLabel(count: number): string {
  return `${count} automation${count === 1 ? '' : 's'}`;
}

export function resultRangeLabel(from: number, to: number, total: number): string {
  if (total === 0) return 'No automations';
  return `Showing ${from}–${to} of ${total}`;
}

export function activeFilterPills(value: RunsFiltersValue): Array<{ key: string; label: string }> {
  const pills: Array<{ key: string; label: string }> = [];
  const trimmed = value.searchInput.trim();

  if (trimmed) {
    pills.push({ key: 'q', label: `Search: ${trimmed}` });
  }
  if (value.date) {
    pills.push({ key: 'date', label: `Date: ${value.date}` });
  }
  if (value.status) {
    const statusLabel = RUN_STATUS_FILTER_OPTIONS.find((option) => option.value === value.status)?.label;
    if (statusLabel) pills.push({ key: 'status', label: `Status: ${statusLabel}` });
  }
  if (value.jobsAdded) {
    const jobsLabel = JOBS_FILTER_OPTIONS.find((option) => option.value === value.jobsAdded)?.label;
    if (jobsLabel) pills.push({ key: 'jobs', label: `Jobs: ${jobsLabel}` });
  }
  if (value.duration) {
    const durationLabel = DURATION_FILTER_OPTIONS.find((option) => option.value === value.duration)?.label;
    if (durationLabel) pills.push({ key: 'duration', label: `Duration: ${durationLabel}` });
  }

  return pills;
}

export function resolveRunsContentState({
  isLoading,
  isError,
  hasLoadedData,
  rowCount,
  hasActiveFilters,
}: {
  isLoading: boolean;
  isError: boolean;
  hasLoadedData: boolean;
  rowCount: number;
  hasActiveFilters: boolean;
}): RunsContentState {
  if (isLoading && !hasLoadedData) return 'first-load-skeleton';
  if (isError) return 'load-error';
  if (rowCount === 0 && hasActiveFilters) return 'filtered-empty';
  if (rowCount === 0) return 'account-empty';
  return 'rows';
}

export function groupMetaLabel(type: 'lastRun' | 'jobs' | 'runCount', value: string | number): string {
  if (type === 'lastRun') return `Last: ${value}`;
  if (type === 'jobs') return `${value} job${value === 1 ? '' : 's'} added`;
  return `${value} run${value === 1 ? '' : 's'}`;
}

export const GROUP_META_CHIP_SX = {
  height: 26,
  fontSize: '0.75rem',
  fontWeight: 600,
  borderRadius: '999px',
  bgcolor: tint(FIRSTSTEP.navy, 0.06),
  color: FIRSTSTEP.navy,
  border: '1px solid',
  borderColor: tint(FIRSTSTEP.navy, 0.1),
  '& .MuiChip-label': { px: 1.25 },
} as const;

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms > 48 * 60 * 60 * 1000) return '—';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function formatRelativeTime(value?: string | null): string {
  if (!value) return '—';
  const then = new Date(value).getTime();
  if (!Number.isFinite(then) || then <= 0) return '—';
  const diffMs = Date.now() - then;
  const abs = Math.abs(diffMs);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < minute) return 'just now';
  if (abs < hour) {
    const mins = Math.round(abs / minute);
    return diffMs >= 0 ? `${mins}m ago` : `in ${mins}m`;
  }
  if (abs < day) {
    const hours = Math.round(abs / hour);
    return diffMs >= 0 ? `${hours}h ago` : `in ${hours}h`;
  }
  if (abs < 7 * day) {
    const days = Math.round(abs / day);
    return diffMs >= 0 ? `${days}d ago` : `in ${days}d`;
  }
  return new Date(value).toLocaleDateString();
}

export type JobsFilterParams = {
  jobsAddedExact?: number;
  minJobsAdded?: number;
};

export type DurationFilterParams = {
  minDurationMs?: number;
  maxDurationMs?: number;
};

export function jobsFilterParamsFromValue(jobsAddedFilter: string): JobsFilterParams {
  switch (jobsAddedFilter) {
    case '0':
      return { jobsAddedExact: 0 };
    case 'gt2':
      return { minJobsAdded: 3 };
    case 'gt3':
      return { minJobsAdded: 4 };
    case 'gt4':
      return { minJobsAdded: 5 };
    default:
      return {};
  }
}

export function durationFilterParamsFromValue(durationFilter: string): DurationFilterParams {
  switch (durationFilter) {
    case 'lt5':
      return { maxDurationMs: 5 * 60 * 1000 };
    case 'lt30':
      return { maxDurationMs: 30 * 60 * 1000 };
    case 'gt30':
      return { minDurationMs: 30 * 60 * 1000 };
    case 'gt60':
      return { minDurationMs: 60 * 60 * 1000 };
    default:
      return {};
  }
}

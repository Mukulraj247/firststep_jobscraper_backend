import * as cronParser from 'cron-parser';

export interface CronFields {
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
}

export interface CronValidationResult {
  valid: boolean;
  error?: string;
}

export function buildCron(fields: CronFields): string {
  const { minute, hour, dayOfMonth, month, dayOfWeek } = fields;
  return `${minute} ${hour} ${dayOfMonth} ${month} ${dayOfWeek}`;
}

export function validateCron(cron: string): CronValidationResult {
  if (!cron || typeof cron !== 'string') {
    return { valid: false, error: 'Cron expression is required' };
  }
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) {
    return { valid: false, error: 'Cron must have exactly 5 fields (minute hour day month weekday)' };
  }
  try {
    cronParser.parseExpression(cron);
    return { valid: true };
  } catch (err: any) {
    return { valid: false, error: err.message || 'Invalid cron expression' };
  }
}

export function parseCronToFields(cron: string): CronFields | null {
  if (!cron) return null;
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  return { minute, hour, dayOfMonth, month, dayOfWeek };
}

export function computeNextRuns(
  cron: string,
  timezone: string,
  count: number = 3
): Date[] {
  try {
    const interval = cronParser.parseExpression(cron, { tz: timezone });
    const results: Date[] = [];
    for (let i = 0; i < count; i++) {
      results.push(interval.next().toDate());
    }
    return results;
  } catch {
    return [];
  }
}

export function formatNextRun(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function computeNextRunRelative(
  cron: string,
  timezone: string
): { relative: string; absolute: string; nextDate: Date | null } {
  const next = computeNextRuns(cron, timezone, 1)[0] || null;
  if (!next) return { relative: '—', absolute: '—', nextDate: null };
  return formatRelativeToNow(next, timezone);
}

/** Prefer server `nextRunAt` (interval-from-save) over recomputing wall-clock cron. */
export function formatRelativeToNow(
  next: Date,
  timezone: string = 'UTC'
): { relative: string; absolute: string; nextDate: Date } {
  const now = new Date();
  const diffMs = next.getTime() - now.getTime();

  if (diffMs < 0) {
    return { relative: '—', absolute: formatNextRun(next, timezone), nextDate: next };
  }

  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  let relative: string;
  if (days > 0) {
    relative = days === 1 ? 'in 1 day' : `in ${days} days`;
  } else if (hours > 0) {
    relative =
      minutes > 0
        ? hours === 1
          ? `in 1 hr ${minutes} min${minutes === 1 ? '' : 's'}`
          : `in ${hours} hrs ${minutes} min${minutes === 1 ? '' : 's'}`
        : hours === 1
          ? 'in 1 hr'
          : `in ${hours} hrs`;
  } else if (minutes > 0) {
    relative = minutes === 1 ? 'in 1 min' : `in ${minutes} mins`;
  } else {
    relative = seconds <= 5 ? 'now' : `in ${seconds}s`;
  }

  return {
    relative,
    absolute: formatNextRun(next, timezone),
    nextDate: next,
  };
}

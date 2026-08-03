import cronParser from 'cron-parser';
import moment from 'moment-timezone';

/** Minimum gap between two consecutive schedule fires (product policy). */
export const MIN_SCHEDULE_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Wall-clock cron presets that should instead run as true intervals from
 * schedule-save / last-run time — so "Every 15 min" automations do not all
 * pile up on :00/:15/:30/:45 and overload the scraper.
 */
const INTERVAL_CRON_TO_MS: Record<string, number> = {
  '*/15 * * * *': 15 * 60 * 1000,
  '*/30 * * * *': 30 * 60 * 1000,
  '0 * * * *': 60 * 60 * 1000,
  '0 */6 * * *': 6 * 60 * 60 * 1000,
  '0 */12 * * *': 12 * 60 * 60 * 1000,
};

const INTERVAL_MS_TO_HUMAN: Record<number, string> = {
  [15 * 60 * 1000]: '15 minutes',
  [30 * 60 * 1000]: '30 minutes',
  [60 * 60 * 1000]: '1 hour',
  [6 * 60 * 60 * 1000]: '6 hours',
  [12 * 60 * 60 * 1000]: '12 hours',
};

export function normalizeCronExpression(cron: string): string {
  return cron.trim().replace(/\s+/g, ' ');
}

/** Map known short presets to interval ms, or null for calendar cron. */
export function intervalMsFromCron(cron: string | null | undefined): number | null {
  if (!cron || typeof cron !== 'string') return null;
  return INTERVAL_CRON_TO_MS[normalizeCronExpression(cron)] ?? null;
}

/** Agenda `repeatEvery` human-interval string for a known preset ms value. */
export function humanIntervalFromMs(everyMs: number): string | null {
  return INTERVAL_MS_TO_HUMAN[everyMs] ?? null;
}

export function computeNextRunFromInterval(everyMs: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + everyMs);
}

// Function to compute next run date based on the cron pattern and timezone
export function computeNextRun(cronExpression: string, timezone: string) {
  try {
    const interval = cronParser.parseExpression(cronExpression, { tz: timezone });
    return interval.next().toDate();
  } catch (err) {
    console.error('Error parsing cron expression:', err);
    return null;
  }
}

/**
 * Validate a cron expression / timezone pair. Returns a tuple of
 * `[valid, errorMessage?]`. Shared by the automation routes so both
 * PUT /automations/:id/schedule and PUT /automations/:id/config reject
 * malformed input with a consistent 400 error.
 */
export function validateCron(
  cronExpression: string,
  timezone: string = 'UTC'
): { ok: true } | { ok: false; error: string } {
  if (typeof cronExpression !== 'string' || !cronExpression.trim()) {
    return { ok: false, error: 'Cron expression is required' };
  }
  if (!moment.tz.zone(timezone)) {
    return { ok: false, error: `Invalid timezone: ${timezone}` };
  }
  try {
    cronParser.parseExpression(cronExpression.trim(), { tz: timezone });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: `Invalid cron expression: ${err?.message || 'parse error'}` };
  }
}

/**
 * Ensures the shortest gap between two consecutive fires is at least 15 minutes.
 * Uses the first two `next()` times from cron-parser (same tz as validateCron).
 */
export function validateMinimumScheduleInterval(
  cronExpression: string,
  timezone: string = 'UTC'
): { ok: true } | { ok: false; error: string } {
  const trimmed = cronExpression.trim();
  try {
    const interval = cronParser.parseExpression(trimmed, {
      tz: timezone,
      currentDate: new Date(),
    });
    const first = interval.next().toDate();
    const second = interval.next().toDate();
    const diffMs = second.getTime() - first.getTime();
    if (diffMs < MIN_SCHEDULE_INTERVAL_MS) {
      const mins = Math.max(1, Math.round(diffMs / 60_000));
      return {
        ok: false,
        error: `Schedule interval must be at least 15 minutes (this expression fires every ~${mins} minute(s))`,
      };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: `Invalid cron expression: ${err?.message || 'parse error'}` };
  }
}

/**
 * Full validation for automation recurring schedules: syntax, timezone, and 15-minute minimum interval.
 */
export function validateAutomationScheduleCron(
  cronExpression: string,
  timezone: string = 'UTC'
): { ok: true } | { ok: false; error: string } {
  const syntax = validateCron(cronExpression, timezone);
  if (!syntax.ok) {
    return syntax;
  }
  return validateMinimumScheduleInterval(cronExpression, timezone);
}

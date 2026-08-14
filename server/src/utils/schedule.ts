import cronParser from 'cron-parser';
import moment from 'moment-timezone';

/** Minimum gap between two consecutive schedule fires (product policy). */
export const MIN_SCHEDULE_INTERVAL_MS = 15 * 60 * 1000;

/** Minimum gap between any two automations' scheduled start times (spread-out policy). */
export const MIN_AUTOMATION_GAP_MS = 90_000;

/**
 * Wall-clock cron presets that should instead run as true intervals from
 * schedule-save / last-run time — so short presets do not all pile up on
 * shared clock ticks, and daily/weekly presets do not all fire at midnight.
 */
const INTERVAL_CRON_TO_MS: Record<string, number> = {
  '*/15 * * * *': 15 * 60 * 1000,
  '*/30 * * * *': 30 * 60 * 1000,
  '0 * * * *': 60 * 60 * 1000,
  '0 */6 * * *': 6 * 60 * 60 * 1000,
  '0 */12 * * *': 12 * 60 * 60 * 1000,
  // Calendar presets → interval + per-robot hash stagger (same path as short presets).
  '0 0 * * *': 24 * 60 * 60 * 1000,
  '0 0 */2 * *': 2 * 24 * 60 * 60 * 1000,
  '0 0 */3 * *': 3 * 24 * 60 * 60 * 1000,
  '0 0 * * 1': 7 * 24 * 60 * 60 * 1000,
  '0 0 1 * *': 30 * 24 * 60 * 60 * 1000,
};

const INTERVAL_MS_TO_HUMAN: Record<number, string> = {
  [15 * 60 * 1000]: '15 minutes',
  [30 * 60 * 1000]: '30 minutes',
  [60 * 60 * 1000]: '1 hour',
  [6 * 60 * 60 * 1000]: '6 hours',
  [12 * 60 * 60 * 1000]: '12 hours',
  [24 * 60 * 60 * 1000]: '1 day',
  [2 * 24 * 60 * 60 * 1000]: '2 days',
  [3 * 24 * 60 * 60 * 1000]: '3 days',
  [7 * 24 * 60 * 60 * 1000]: '1 week',
  [30 * 24 * 60 * 60 * 1000]: '30 days',
};

export function normalizeCronExpression(cron: string): string {
  return cron.trim().replace(/\s+/g, ' ');
}

/** Map known stagger presets to interval ms, or null for free-form calendar cron. */
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

/** Grace after dueAt before catch-up fires (default 2m — avoid racing Agenda). */
export function getScheduleCatchupGraceMs(): number {
  const fromEnv = parseInt(process.env.SCHEDULE_CATCHUP_GRACE_MS || '', 10);
  if (!Number.isNaN(fromEnv) && fromEnv >= 0) return fromEnv;
  return 120_000;
}

/** How often the missed-schedule sweep runs (default 2m). */
export function getScheduleCatchupIntervalMs(): number {
  const fromEnv = parseInt(process.env.SCHEDULE_CATCHUP_INTERVAL_MS || '', 10);
  if (!Number.isNaN(fromEnv) && fromEnv > 0) return fromEnv;
  return 120_000;
}

/** Max overdue robots to enqueue per sweep pass (default 40). */
export function getScheduleCatchupMaxRobots(): number {
  const fromEnv = parseInt(process.env.SCHEDULE_CATCHUP_MAX_ROBOTS || '', 10);
  if (!Number.isNaN(fromEnv) && fromEnv > 0) return fromEnv;
  return 40;
}

const toTime = (value: Date | string | number | null | undefined): number | null => {
  if (value == null) return null;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
};

/**
 * True when a scheduled robot is past due by more than graceMs.
 *
 * Interval: dueAt = lastRunAt + everyMs; if no lastRunAt, use nextRunAt when past.
 * Calendar cron (no everyMs): dueAt = nextRunAt when that timestamp is in the past.
 * No timestamps yet → not overdue (wait for rehydrate/sync to set nextRunAt).
 */
export function isScheduleOverdue(opts: {
  lastRunAt?: Date | string | number | null;
  nextRunAt?: Date | string | number | null;
  everyMs?: number | null;
  now?: Date | number;
  graceMs: number;
}): boolean {
  const now = opts.now instanceof Date ? opts.now.getTime() : (opts.now ?? Date.now());
  const grace = Math.max(0, opts.graceMs);
  const lastMs = toTime(opts.lastRunAt ?? null);
  const nextMs = toTime(opts.nextRunAt ?? null);
  const everyMs =
    typeof opts.everyMs === 'number' && opts.everyMs > 0 ? opts.everyMs : null;

  let dueAt: number | null = null;
  if (everyMs && lastMs != null) {
    dueAt = lastMs + everyMs;
  } else if (nextMs != null) {
    dueAt = nextMs;
  }

  if (dueAt == null) return false;
  return now >= dueAt + grace;
}

/**
 * Find the earliest time at or after `preferredMs` that sits at least `gapMs`
 * away from every occupied timestamp (system-wide schedule packing).
 */
export function findPackedNextRunAt(
  occupiedTimesMs: Array<number | null | undefined>,
  preferredMs: number,
  gapMs: number = MIN_AUTOMATION_GAP_MS
): Date {
  const gap = Math.max(1, gapMs);
  const preferred = Number.isFinite(preferredMs) ? preferredMs : Date.now();
  const sorted = occupiedTimesMs
    .map((t) => (typeof t === 'number' && Number.isFinite(t) ? t : NaN))
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b);

  let candidate = preferred;
  for (let i = 0; i < 100_000; i++) {
    let conflictUntil: number | null = null;
    for (const t of sorted) {
      if (Math.abs(t - candidate) < gap) {
        conflictUntil = conflictUntil == null ? t + gap : Math.max(conflictUntil, t + gap);
      }
    }
    if (conflictUntil == null) {
      return new Date(candidate);
    }
    candidate = Math.max(candidate + gap, conflictUntil);
  }
  return new Date(candidate);
}

/** Minimum delay before a freshly scheduled first run (avoid immediate stampede). */
export const MIN_FIRST_RUN_DELAY_MS = 60_000;

/**
 * Pick a randomized first-run timestamp inside the interval window, then the
 * caller should pack it with {@link findPackedNextRunAt} against other robots.
 * Offset is in [minDelayMs, everyMs] (clamped when everyMs is short).
 */
export function randomPreferredStartMs(
  everyMs: number,
  now: Date = new Date(),
  minDelayMs: number = MIN_FIRST_RUN_DELAY_MS
): number {
  const floor = Math.max(0, Math.min(minDelayMs, everyMs));
  const span = Math.max(1, everyMs - floor);
  const offset = floor + Math.floor(Math.random() * span);
  return now.getTime() + offset;
}

/**
 * @deprecated Shared wall-clock phase hours caused stampede UX ("everything at 3am").
 * Kept for any legacy callers; new scheduling uses {@link randomPreferredStartMs}.
 */
export function preferredPhaseHoursForInterval(_everyMs: number): number[] {
  return [];
}

/**
 * @deprecated Prefer {@link randomPreferredStartMs}. Returns a single random slot
 * for API compatibility with /schedule/suggestions.
 */
export function suggestPreferredStartSlots(
  everyMs: number,
  _timezone: string = 'UTC',
  now: Date = new Date(),
  _count: number = 4
): Date[] {
  if (!everyMs || everyMs <= 0) return [];
  return [new Date(randomPreferredStartMs(everyMs, now))];
}

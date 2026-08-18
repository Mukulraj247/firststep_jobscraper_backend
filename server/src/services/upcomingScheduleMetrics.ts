import cronParser from 'cron-parser';
import {
  resolveEffectiveScheduleState,
} from './automationScheduler';
import { intervalMsFromCron } from '../utils/schedule';

export type UpcomingScheduleMetrics = {
  /** Automations with an active schedule that fires at least once in the window. */
  automationsWithRuns: number;
  /** Total scheduled trigger count across all active automations in the window. */
  totalScheduledRuns: number;
  /** Automations with schedule enabled (may be 0 fires if interval exceeds window). */
  activeScheduledAutomations: number;
  /** ISO timestamp when the forward-looking window starts (now). */
  forecastFrom: string;
  /** ISO timestamp when the forward-looking window ends. */
  forecastUntil: string;
};

function readScheduleTimestamps(robot: any) {
  const root = robot?.schedule;
  const saas = robot?.recording_meta?.saasConfig?.schedule;
  const lastRaw = root?.lastRunAt ?? saas?.lastRunAt ?? null;
  const nextRaw = root?.nextRunAt ?? saas?.nextRunAt ?? null;
  return {
    lastRunAt: lastRaw != null ? new Date(lastRaw) : null,
    nextRunAt: nextRaw != null ? new Date(nextRaw) : null,
  };
}

function countIntervalFires(firstMs: number, endMs: number, everyMs: number): number {
  if (everyMs <= 0 || firstMs > endMs) return 0;
  return Math.floor((endMs - firstMs) / everyMs) + 1;
}

function resolveFirstIntervalFireMs(
  nowMs: number,
  everyMs: number,
  timestamps: { lastRunAt: Date | null; nextRunAt: Date | null },
): number {
  const nextMs = timestamps.nextRunAt?.getTime();
  if (nextMs != null) {
    if (nextMs >= nowMs) return nextMs;
    // Overdue — treat as firing at the start of the window, then every interval.
    return nowMs;
  }
  const lastMs = timestamps.lastRunAt?.getTime();
  if (lastMs != null) {
    let candidate = lastMs + everyMs;
    while (candidate < nowMs) candidate += everyMs;
    return candidate;
  }
  return nowMs;
}

function countCronFires(
  cron: string,
  timezone: string,
  startMs: number,
  endMs: number,
): number {
  try {
    const interval = cronParser.parseExpression(cron.trim(), {
      tz: timezone || 'UTC',
      currentDate: new Date(startMs),
    });
    let count = 0;
    while (count < 10_000) {
      const next = interval.next().toDate().getTime();
      if (next > endMs) break;
      count += 1;
    }
    return count;
  } catch {
    return 0;
  }
}

function countAutomationFiresInWindow(
  robot: any,
  startMs: number,
  endMs: number,
): number {
  const schedule = resolveEffectiveScheduleState(robot);
  if (!schedule.enabled) return 0;

  const cronExpr = (schedule.cron || '').trim();
  const everyMs =
    (typeof schedule.every === 'number' && schedule.every > 0 ? schedule.every : null) ??
    intervalMsFromCron(cronExpr);

  const timestamps = readScheduleTimestamps(robot);

  if (everyMs) {
    const firstMs = resolveFirstIntervalFireMs(startMs, everyMs, timestamps);
    return countIntervalFires(firstMs, endMs, everyMs);
  }

  if (cronExpr) {
    return countCronFires(cronExpr, schedule.timezone || 'UTC', startMs, endMs);
  }

  return 0;
}

/** Count upcoming schedule activity from now until now + windowMs. */
export function computeUpcomingScheduleMetrics(
  robots: any[],
  windowMs: number,
  now: Date = new Date(),
): UpcomingScheduleMetrics {
  const startMs = now.getTime();
  const endMs = startMs + Math.max(0, windowMs);

  let automationsWithRuns = 0;
  let totalScheduledRuns = 0;
  let activeScheduledAutomations = 0;

  for (const robot of robots) {
    const schedule = resolveEffectiveScheduleState(robot);
    if (!schedule.enabled) continue;
    activeScheduledAutomations += 1;

    const fires = countAutomationFiresInWindow(robot, startMs, endMs);
    if (fires <= 0) continue;

    automationsWithRuns += 1;
    totalScheduledRuns += fires;
  }

  return {
    automationsWithRuns,
    totalScheduledRuns,
    activeScheduledAutomations,
    forecastFrom: now.toISOString(),
    forecastUntil: new Date(endMs).toISOString(),
  };
}

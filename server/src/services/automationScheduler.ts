import logger from '../logger';
import Robot from '../models/Robot';
import Run from '../models/Run';
import { getAgenda, scheduleRecurringTrigger, cancelScheduledTrigger, ScheduleTriggerData } from '../queue/scraperQueue';
import { createQueuedAutomationRun } from './automationRun';
import { Job } from 'agenda';
import moment from 'moment-timezone';
import {
  computeNextRun,
  computeNextRunFromInterval,
  findPackedNextRunAt,
  getScheduleCatchupGraceMs,
  getScheduleCatchupIntervalMs,
  getScheduleCatchupMaxRobots,
  humanIntervalFromMs,
  intervalMsFromCron,
  isScheduleOverdue,
  MIN_AUTOMATION_GAP_MS,
  randomPreferredStartMs,
} from '../utils/schedule';

type StoredSchedule = {
  enabled?: boolean;
  cron?: string;
  every?: number; // interval in milliseconds
  timezone?: string;
  jobId?: string;
  updatedAt?: string;
  lastRunAt?: Date | null;
  nextRunAt?: Date | null;
};

const ACTIVE_RUN_STATUSES = ['pending', 'queued', 'running', 'scheduled'] as const;

const getScheduleJobId = (automationId: string) => `automation-schedule:${automationId}`;

const normalizeTimezone = (rawTz: string): string => {
  const deprecatedTimezones: Record<string, string> = {
    'Asia/Calcutta': 'Asia/Kolkata',
    'Asia/Karachi': 'Asia/Karachi',
    EST: 'America/New_York',
    CST: 'America/Chicago',
    MST: 'America/Denver',
    PST: 'America/Los_Angeles',
  };
  const mapped = deprecatedTimezones[rawTz] || rawTz;
  return moment.tz.zone(mapped) ? mapped : 'UTC';
};

export const buildAutomationScheduleState = (input?: Partial<StoredSchedule> | null): StoredSchedule => ({
  enabled: !!input?.enabled && (!!input?.cron || !!input?.every),
  cron: input?.cron || '',
  every: input?.every,
  timezone: input?.timezone || 'UTC',
  jobId: input?.jobId || '',
  updatedAt: input?.updatedAt || new Date().toISOString(),
  lastRunAt: input?.lastRunAt != null ? new Date(input.lastRunAt) : null,
  nextRunAt: input?.nextRunAt != null ? new Date(input.nextRunAt) : null,
});

/**
 * Same merge as `rehydrateAutomationSchedules`: root `schedule` wins if enabled, else
 * `saasConfig.schedule` (Chrome extension saves here). Prevents Agenda from skipping fires when
 * only one of the two is populated.
 */
export function resolveEffectiveScheduleState(robot: any): StoredSchedule {
  const fromRoot = buildAutomationScheduleState(robot?.schedule);
  const fromSaas = buildAutomationScheduleState(robot?.recording_meta?.saasConfig?.schedule);
  if (fromRoot.enabled) return fromRoot;
  if (fromSaas.enabled) return fromSaas;
  // Both disabled (or empty): prefer whichever actually holds cron/every (pause/resume keeps cron in saasConfig).
  const rootHas = !!(fromRoot.cron || fromRoot.every);
  const saasHas = !!(fromSaas.cron || fromSaas.every);
  if (saasHas && !rootHas) return fromSaas;
  if (rootHas && !saasHas) return fromRoot;
  // Both carry interval metadata — saasConfig is canonical after API saves.
  if (saasHas && rootHas) return fromSaas;
  return fromRoot;
}

/** Prefer root timestamps (written on fire); fall back to saasConfig. */
function readScheduleTimestamps(robot: any, schedule: StoredSchedule): {
  lastRunAt: Date | null;
  nextRunAt: Date | null;
} {
  const root = robot?.schedule;
  const saas = robot?.recording_meta?.saasConfig?.schedule;
  const lastRaw = root?.lastRunAt ?? saas?.lastRunAt ?? schedule.lastRunAt ?? null;
  const nextRaw = root?.nextRunAt ?? saas?.nextRunAt ?? schedule.nextRunAt ?? null;
  return {
    lastRunAt: lastRaw != null ? new Date(lastRaw) : null,
    nextRunAt: nextRaw != null ? new Date(nextRaw) : null,
  };
}

async function hasActiveRunForRobot(robotMetaId: string): Promise<boolean> {
  const existing = await Run.findOne({
    robotMetaId,
    status: { $in: [...ACTIVE_RUN_STATUSES] },
  })
    .select({ _id: 1 })
    .lean();
  return !!existing;
}

function computeScheduleAdvance(
  schedule: StoredSchedule,
  from: Date = new Date()
): { lastRunAt: Date; nextRunAt: Date | null; everyMs: number | null } {
  const tz = normalizeTimezone(schedule.timezone || 'UTC');
  const cronExpr = schedule.cron || '';
  const everyMs =
    (typeof schedule.every === 'number' && schedule.every > 0 ? schedule.every : null) ??
    intervalMsFromCron(cronExpr);
  const nextRunAt = everyMs
    ? computeNextRunFromInterval(everyMs, from)
    : cronExpr
      ? computeNextRun(cronExpr, tz)
      : null;
  return { lastRunAt: from, nextRunAt, everyMs };
}

async function persistScheduleAdvance(
  robotId: any,
  advance: { lastRunAt: Date; nextRunAt: Date | null; everyMs: number | null }
): Promise<void> {
  await Robot.updateOne(
    { _id: robotId },
    {
      $set: {
        'schedule.lastRunAt': advance.lastRunAt,
        'schedule.nextRunAt': advance.nextRunAt,
        ...(advance.everyMs ? { 'schedule.every': advance.everyMs } : {}),
      },
    }
  );
}

async function collectOccupiedNextRunAts(excludeAutomationId?: string): Promise<number[]> {
  const occupied = new Set<number>();

  const robots = await Robot.find({
    $or: [{ 'schedule.enabled': true }, { 'recording_meta.saasConfig.schedule.enabled': true }],
  })
    .select('recording_meta.id schedule.nextRunAt recording_meta.saasConfig.schedule.nextRunAt')
    .lean();

  for (const robot of robots as any[]) {
    const id = robot?.recording_meta?.id;
    if (excludeAutomationId && id === excludeAutomationId) continue;
    const nextRaw =
      robot?.schedule?.nextRunAt ?? robot?.recording_meta?.saasConfig?.schedule?.nextRunAt ?? null;
    if (nextRaw == null) continue;
    const ms = new Date(nextRaw).getTime();
    if (!Number.isNaN(ms) && ms > Date.now() - MIN_AUTOMATION_GAP_MS) {
      occupied.add(ms);
    }
  }

  try {
    const agenda = await getAgenda();
    const jobs = await agenda.jobs({
      name: 'schedule-triggers',
      nextRunAt: { $gte: new Date(Date.now() - MIN_AUTOMATION_GAP_MS) },
    });
    for (const job of jobs || []) {
      const id = (job.attrs?.data as any)?.automationId;
      if (excludeAutomationId && id === excludeAutomationId) continue;
      const next = job.attrs?.nextRunAt;
      if (!next) continue;
      const ms = new Date(next).getTime();
      if (!Number.isNaN(ms)) occupied.add(ms);
    }
  } catch (err: any) {
    logger.log('warn', `collectOccupiedNextRunAts Agenda lookup failed: ${err?.message || err}`);
  }

  return Array.from(occupied);
}

export async function syncAutomationSchedule(
  robot: any,
  userId: number,
  timezone: string = 'UTC',
  options?: {
    preserveNextRunAt?: boolean;
    preferredNextRunAt?: Date | string | null;
    /** When true, recompute a packed first fire (schedule create/update). */
    packSlots?: boolean;
  }
): Promise<StoredSchedule> {
  const rawNextSchedule = robot?.recording_meta?.saasConfig?.schedule ?? robot?.schedule;
  const nextSchedule = buildAutomationScheduleState(rawNextSchedule);
  const jobId = getScheduleJobId(robot.recording_meta.id);

  const finalTz = normalizeTimezone(timezone || 'UTC');

  // Disable path: the caller is either turning the schedule off or the robot was never scheduled.
  // We MUST call cancelScheduledTrigger here to remove any lingering Agenda job so the cron stops.
  if (!nextSchedule.enabled || (!nextSchedule.cron && !nextSchedule.every)) {
    await cancelScheduledTrigger(robot.recording_meta.id);
    return {
      enabled: false,
      cron: nextSchedule.cron,
      every: nextSchedule.every,
      jobId,
      updatedAt: new Date().toISOString(),
      timezone: finalTz,
      lastRunAt: null,
      nextRunAt: null,
    };
  }

  // Enable / update path: `scheduleRecurringTrigger` uses `unique({'data.automationId': ... })`
  // so the save upserts in place. No pre-cancel needed — that would be two Mongo ops (delete +
  // insert) instead of one (upsert) and leaves a brief window where the trigger is missing.
  const cronExpr = nextSchedule.cron || '';
  const everyMs =
    (typeof nextSchedule.every === 'number' && nextSchedule.every > 0
      ? nextSchedule.every
      : null) ?? intervalMsFromCron(cronExpr);
  const humanInterval = everyMs ? humanIntervalFromMs(everyMs) : null;

  let forcedNextRunAt: Date | null = null;
  if (!options?.preserveNextRunAt) {
    const existingNextRaw =
      robot?.schedule?.nextRunAt ?? robot?.recording_meta?.saasConfig?.schedule?.nextRunAt ?? null;
    const existingMs = existingNextRaw != null ? new Date(existingNextRaw).getTime() : NaN;
    const hasFutureNext = !Number.isNaN(existingMs) && existingMs > Date.now();
    const shouldRepack = !!options?.packSlots || options?.preferredNextRunAt != null || !hasFutureNext;

    if (!shouldRepack && hasFutureNext) {
      forcedNextRunAt = new Date(existingMs);
    } else {
      // Interval presets: ignore client preferred wall-clock slots; assign a random
      // first run inside the interval window, then pack against other robots.
      let preferredMs: number | null = null;
      if (everyMs && humanInterval) {
        preferredMs = randomPreferredStartMs(everyMs);
      } else {
        const preferredRaw = options?.preferredNextRunAt;
        if (preferredRaw != null) {
          const t = new Date(preferredRaw).getTime();
          if (!Number.isNaN(t) && t > Date.now()) preferredMs = t;
        }
        if (preferredMs == null && cronExpr) {
          const nextCron = computeNextRun(cronExpr, finalTz);
          preferredMs = nextCron ? nextCron.getTime() : Date.now() + MIN_AUTOMATION_GAP_MS;
        }
      }
      if (preferredMs != null) {
        const occupied = await collectOccupiedNextRunAts(robot.recording_meta.id);
        forcedNextRunAt = findPackedNextRunAt(occupied, preferredMs, MIN_AUTOMATION_GAP_MS);
        logger.log(
          'info',
          `Packed nextRunAt for ${robot.recording_meta.id}: preferred=${new Date(preferredMs).toISOString()} packed=${forcedNextRunAt.toISOString()} (gap=${MIN_AUTOMATION_GAP_MS}ms, occupied=${occupied.length})`
        );
      }
    }
  }

  const agendaNextRunAt = await scheduleRecurringTrigger(
    robot.recording_meta.id,
    String(userId),
    cronExpr,
    finalTz,
    jobId,
    humanInterval && everyMs
      ? {
          everyMs,
          humanInterval,
          preserveNextRunAt: !!options?.preserveNextRunAt,
          forcedNextRunAt,
        }
      : {
          preserveNextRunAt: !!options?.preserveNextRunAt,
          forcedNextRunAt,
        }
  );

  const scheduleType =
    everyMs && humanInterval
      ? `interval ${humanInterval} (from save/last-run)`
      : `cron ${cronExpr}`;
  logger.log('info', `Scheduled automation ${robot.recording_meta.id} with ${scheduleType} in timezone ${finalTz}`);

  // Prefer Agenda's nextRunAt (may be preserved across rehydrate). Else interval-from-now or cron tick.
  const computedNextRunAt =
    agendaNextRunAt ||
    (everyMs && humanInterval
      ? computeNextRunFromInterval(everyMs)
      : cronExpr
        ? computeNextRun(cronExpr, finalTz)
        : null);

  // Preserve lastRunAt across rehydrate when present on the robot.
  const existingLast =
    robot?.schedule?.lastRunAt != null ? new Date(robot.schedule.lastRunAt) : null;

  return {
    enabled: true,
    cron: cronExpr,
    every: everyMs || undefined,
    jobId,
    timezone: finalTz,
    updatedAt: new Date().toISOString(),
    lastRunAt: options?.preserveNextRunAt ? existingLast : null,
    nextRunAt: computedNextRunAt,
  };
}

async function processScheduledRun(job: Job<ScheduleTriggerData>) {
  const { automationId, userId } = job.attrs.data;

  logger.log('info', `Processing scheduled run: automationId=${automationId}, userId=${userId}`);

  let searchUserId: any = userId;
  if (/^[0-9a-fA-F]{24}$/.test(userId)) {
      searchUserId = { $in: [userId, new (require('mongoose').Types.ObjectId)(userId)] };
  } else if (!isNaN(Number(userId)) && userId.trim() !== '') {
      searchUserId = { $in: [userId, Number(userId)] };
  }

  const robot = await Robot.findOne({
    userId: searchUserId,
    'recording_meta.id': automationId,
  }).lean();

  if (!robot) {
    throw new Error(`Scheduled automation ${automationId} not found`);
  }

  const schedule = resolveEffectiveScheduleState(robot);
  if (!schedule.enabled || (!schedule.cron && !schedule.every)) {
    logger.log(
      'warn',
      `Skipping scheduled automation ${automationId}: merged schedule has no cron/every (check robot.schedule and recording_meta.saasConfig.schedule). ` +
        `enabled=${!!schedule.enabled} cron=${schedule.cron ? 'set' : 'empty'}`
    );
    return;
  }

  // Single-flight: do not stack on an in-flight/pending run (e.g. catch-up already queued).
  if (await hasActiveRunForRobot(automationId)) {
    logger.log(
      'info',
      `Skipping scheduled automation ${automationId}: active run already pending/running`
    );
    return;
  }

  const scheduleJobId = (schedule.jobId || '').replace('automation-schedule:', '') || undefined;
  const normalizedUserId = isNaN(Number(userId)) ? userId : Number(userId);

  const result = await createQueuedAutomationRun(robot, normalizedUserId, {
    source: 'scheduled',
    scheduleJobId: scheduleJobId || undefined,
  });

  const advance = computeScheduleAdvance(schedule, new Date());
  await persistScheduleAdvance((robot as any)._id, advance);

  logger.log(
    'info',
    `Scheduled automation ${automationId} enqueued run ${result.runId}. nextRunAt: ${advance.nextRunAt}`
  );
}

let scheduleProcessorRegistered = false;
let catchupTimer: NodeJS.Timeout | null = null;

export async function registerScheduleProcessor(): Promise<void> {
  if (scheduleProcessorRegistered) return;
  const agenda = await getAgenda();
  (agenda as any).define('schedule-triggers', processScheduledRun);
  scheduleProcessorRegistered = true;
  logger.log('info', 'Schedule trigger processor registered with Agenda');
}

export async function startAutomationScheduleWorker() {
  // Agenda worker is started via getAgenda().start() in scraperQueue.ts
  // This function is kept for API compatibility
}

export async function stopAutomationScheduleWorker() {
  stopMissedScheduleCatchupLoop();
  // Agenda worker stops via closeAgenda() during shutdown
}

/**
 * Enqueue at most one catch-up run per overdue scheduled robot.
 * Idempotent with single-flight against pending/running Runs.
 */
export async function sweepMissedSchedules(options?: {
  maxRobots?: number;
  graceMs?: number;
  now?: Date;
}): Promise<number> {
  const maxRobots = options?.maxRobots ?? getScheduleCatchupMaxRobots();
  const graceMs = options?.graceMs ?? getScheduleCatchupGraceMs();
  const now = options?.now ?? new Date();

  const robots: any[] = await Robot.find({
    $or: [
      { 'schedule.enabled': true },
      { 'recording_meta.saasConfig.schedule.enabled': true },
    ],
  })
    .limit(Math.max(maxRobots * 4, 100))
    .lean();

  let enqueued = 0;

  for (const robot of robots) {
    if (enqueued >= maxRobots) break;

    const schedule = resolveEffectiveScheduleState(robot);
    if (!schedule.enabled || (!schedule.cron && !schedule.every)) continue;

    const cronExpr = schedule.cron || '';
    const everyMs =
      (typeof schedule.every === 'number' && schedule.every > 0 ? schedule.every : null) ??
      intervalMsFromCron(cronExpr);
    const { lastRunAt, nextRunAt } = readScheduleTimestamps(robot, schedule);

    if (
      !isScheduleOverdue({
        lastRunAt,
        nextRunAt,
        everyMs,
        now,
        graceMs,
      })
    ) {
      continue;
    }

    const automationId = robot.recording_meta?.id;
    if (!automationId) continue;

    if (await hasActiveRunForRobot(automationId)) {
      continue;
    }

    try {
      const userId = robot.userId;
      const normalizedUserId = isNaN(Number(userId)) ? userId : Number(userId);
      const scheduleJobId = (schedule.jobId || '').replace('automation-schedule:', '') || undefined;

      const result = await createQueuedAutomationRun(robot, normalizedUserId, {
        source: 'scheduled',
        scheduleJobId: scheduleJobId || undefined,
      });

      const advance = computeScheduleAdvance(schedule, now);
      await persistScheduleAdvance(robot._id, advance);
      enqueued += 1;
      logger.log(
        'info',
        `Catch-up enqueued for automation ${automationId} run ${result.runId}. nextRunAt: ${advance.nextRunAt}`
      );
    } catch (error: any) {
      logger.log(
        'error',
        `Catch-up failed for automation ${automationId}: ${error?.message || error}`
      );
    }
  }

  if (enqueued > 0) {
    logger.log('info', `Missed-schedule sweep enqueued ${enqueued} catch-up run(s)`);
  }
  return enqueued;
}

/**
 * Run one sweep immediately, then on an interval. Safe to call once per process.
 */
export function startMissedScheduleCatchupLoop(): void {
  if (catchupTimer) return;
  const intervalMs = getScheduleCatchupIntervalMs();

  const run = () => {
    void sweepMissedSchedules().catch((error: any) => {
      logger.log('error', `Missed-schedule sweep error: ${error?.message || error}`);
    });
  };

  run();
  catchupTimer = setInterval(run, intervalMs);
  if (typeof catchupTimer.unref === 'function') catchupTimer.unref();
  logger.log('info', `Missed-schedule catch-up loop started (every ${intervalMs}ms)`);
}

export function stopMissedScheduleCatchupLoop(): void {
  if (catchupTimer) {
    clearInterval(catchupTimer);
    catchupTimer = null;
  }
}

export async function rehydrateAutomationSchedules() {
  await registerScheduleProcessor();
  // Only load robots that may have an enabled schedule — avoid full-collection scan.
  const robots: any[] = await Robot.find({
    $or: [
      { 'schedule.enabled': true },
      { 'recording_meta.saasConfig.schedule.enabled': true },
    ],
  }).lean();

  const REHYDRATE_BATCH = 8;
  for (let i = 0; i < robots.length; i += REHYDRATE_BATCH) {
    const batch = robots.slice(i, i + REHYDRATE_BATCH);
    await Promise.all(
      batch.map(async (robot) => {
        const schedule = buildAutomationScheduleState(robot.schedule);
        const saasSchedule = buildAutomationScheduleState(robot.recording_meta?.saasConfig?.schedule);
        const activeSchedule = schedule.enabled ? schedule : saasSchedule;
        if (!activeSchedule.enabled) {
          return;
        }

        try {
          // Prefer robot.schedule over saasConfig.schedule since saasConfig may not always be populated
          const sourceSchedule = schedule.enabled ? robot.schedule : robot.recording_meta?.saasConfig?.schedule;
          const synced = await syncAutomationSchedule(
            { ...robot, schedule: sourceSchedule },
            robot.userId,
            activeSchedule.timezone || 'UTC',
            { preserveNextRunAt: true }
          );
          // Only update DB if schedule was successfully synced (enabled: true)
          // Avoid overwriting valid schedule data with disabled state
          if (synced.enabled) {
            await Robot.updateOne(
              { _id: robot._id },
              { $set: { schedule: synced } }
            );
          }
        } catch (error: any) {
          logger.log('error', `Failed to rehydrate automation schedule ${robot.recording_meta?.id}: ${error.message}`);
        }
      })
    );
  }
}

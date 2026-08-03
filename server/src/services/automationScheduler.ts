import logger from '../logger';
import Robot from '../models/Robot';
import { getAgenda, scheduleRecurringTrigger, cancelScheduledTrigger, ScheduleTriggerData } from '../queue/scraperQueue';
import { createQueuedAutomationRun } from './automationRun';
import { Job } from 'agenda';
import moment from 'moment-timezone';
import {
  computeNextRun,
  computeNextRunFromInterval,
  humanIntervalFromMs,
  intervalMsFromCron,
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

const getScheduleJobId = (automationId: string) => `automation-schedule:${automationId}`;

export const buildAutomationScheduleState = (input?: Partial<StoredSchedule> | null): StoredSchedule => ({
  enabled: !!input?.enabled && (!!input?.cron || !!input?.every),
  cron: input?.cron || '',
  every: input?.every,
  timezone: input?.timezone || 'UTC',
  jobId: input?.jobId || '',
  updatedAt: input?.updatedAt || new Date().toISOString(),
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

export async function syncAutomationSchedule(
  robot: any,
  userId: number,
  timezone: string = 'UTC',
  options?: { preserveNextRunAt?: boolean }
): Promise<StoredSchedule> {
  const rawNextSchedule = robot?.recording_meta?.saasConfig?.schedule ?? robot?.schedule;
  const nextSchedule = buildAutomationScheduleState(rawNextSchedule);
  const jobId = getScheduleJobId(robot.recording_meta.id);

  const deprecatedTimezones: Record<string, string> = {
    'Asia/Calcutta': 'Asia/Kolkata',
    'Asia/Karachi': 'Asia/Karachi',
    'EST': 'America/New_York',
    'CST': 'America/Chicago',
    'MST': 'America/Denver',
    'PST': 'America/Los_Angeles',
  };
  const rawTz = timezone || 'UTC';
  const finalTz = deprecatedTimezones[rawTz] && moment.tz.zone(deprecatedTimezones[rawTz])
    ? deprecatedTimezones[rawTz]
    : (moment.tz.zone(rawTz) ? rawTz : 'UTC');

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
        }
      : undefined
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

  const scheduleJobId = (schedule.jobId || '').replace('automation-schedule:', '') || undefined;
  const normalizedUserId = isNaN(Number(userId)) ? userId : Number(userId);

  const result = await createQueuedAutomationRun(robot, normalizedUserId, {
    source: 'scheduled',
    scheduleJobId: scheduleJobId || undefined,
  });

  // Update lastRunAt and nextRunAt on the robot schedule
  const rawTz = schedule.timezone || 'UTC';
  const deprecatedTimezones: Record<string, string> = {
    'Asia/Calcutta': 'Asia/Kolkata',
    'EST': 'America/New_York',
    'CST': 'America/Chicago',
    'MST': 'America/Denver',
    'PST': 'America/Los_Angeles',
  };
  const tz = deprecatedTimezones[rawTz] || rawTz;
  const cronExpr = schedule.cron || '';
  const lastRunAt = new Date();
  const everyMs =
    (typeof schedule.every === 'number' && schedule.every > 0 ? schedule.every : null) ??
    intervalMsFromCron(cronExpr);
  const nextRunAt = everyMs
    ? computeNextRunFromInterval(everyMs, lastRunAt)
    : cronExpr
      ? computeNextRun(cronExpr, tz)
      : null;

  await Robot.updateOne(
    { _id: (robot as any)._id },
    {
      $set: {
        'schedule.lastRunAt': lastRunAt,
        'schedule.nextRunAt': nextRunAt,
        ...(everyMs ? { 'schedule.every': everyMs } : {}),
      },
    }
  );

  logger.log('info', `Scheduled automation ${automationId} enqueued run ${result.runId}. nextRunAt: ${nextRunAt}`);
}

let scheduleProcessorRegistered = false;

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
  // Agenda worker stops via closeAgenda() during shutdown
  // This function is kept for API compatibility
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

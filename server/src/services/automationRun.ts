import { v4 as uuid } from 'uuid';
import Run from '../models/Run';
import Robot from '../models/Robot';
import { enqueueScraperRun, requeueScraperRun } from '../queue/scraperQueue';
import { getAutomationConfig } from './automation';
import logger from '../logger';

/** Default: only re-check runs that have been pending this long (periodic poller). */
const STALE_PENDING_MS = 3 * 60 * 1000;

export type ReenqueuePendingOptions = {
  /** Skip age check when `0` (e.g. right after server start so nothing sits pending for 3+ minutes). */
  minAgeMs?: number;
  maxRuns?: number;
};

/**
 * Idempotently ensures an Agenda `scraper-jobs` row exists for `pending` runs (same `runId` =
 * insertOnly). Call on a timer with default min age, or once at startup with `minAgeMs: 0`.
 */
export async function reenqueueStalePendingScraperRuns(options?: ReenqueuePendingOptions): Promise<void> {
  try {
    const minAgeMs = options?.minAgeMs ?? STALE_PENDING_MS;
    const maxRuns = options?.maxRuns ?? 40;
    const runs = await Run.find({ status: 'pending' }).limit(maxRuns).lean();
    const now = Date.now();
    let ensured = 0;
    for (const run of runs) {
      const started = new Date(run.startedAt).getTime();
      if (Number.isNaN(started) || now - started < minAgeMs) {
        continue;
      }
      if (run.runByUserId === null || run.runByUserId === undefined) {
        continue;
      }
      const robot: any = await Robot.findOne({ 'recording_meta.id': run.robotMetaId }).lean();
      if (!robot) {
        continue;
      }
      // Use `requeueScraperRun` (not `enqueueScraperRun`) so we correctly handle the case where
      // an Agenda `scraper-jobs` doc for this runId already exists in a terminal state (failed
      // mid-run, but the worker's retry-enqueue didn't land). `enqueueScraperRun`'s insertOnly
      // upsert would silently no-op in that case and leave the run pending forever.
      await requeueScraperRun({
        automationId: run.robotMetaId,
        runId: run.runId,
        userId: String(run.runByUserId),
        config: {
          ...getAutomationConfig(robot),
          ...(run.interpreterSettings?.runtimeConfig || {}),
        },
        _attemptsMade: run.retryCount || 0,
      });
      ensured += 1;
    }
    if (ensured > 0) {
      logger.log('info', `Stale pending run check: ensured Agenda scraper job for ${ensured} run(s)`);
    }
  } catch (err: any) {
    logger.log('warn', `reenqueueStalePendingScraperRuns: ${err?.message || err}`);
  }
}

export async function createQueuedAutomationRun(
  robot: any,
  userId: any,
  options?: {
    source?: 'manual' | 'scheduled';
    scheduleJobId?: string | null;
    runtimeConfig?: Record<string, any>;
  }
) {
  const runId = uuid();
  const browserId = uuid();
  const source = options?.source || 'manual';

  try {
    await Run.create({
      status: source === 'scheduled' ? 'scheduled' : 'pending',
      name: robot.recording_meta.name,
      robotId: robot._id ? robot._id.toString() : robot.id,
      robotMetaId: robot.recording_meta.id,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      browserId,
      interpreterSettings: {
        maxConcurrency: 1,
        maxRepeats: 1,
        debug: true,
        runtimeConfig: {
          ...getAutomationConfig(robot),
          ...(options?.runtimeConfig || {}),
        },
      },
      log: source === 'scheduled'
        ? `[SCHEDULE] Run created by scheduler${options?.scheduleJobId ? ` (${options.scheduleJobId})` : ''}`
        : '[QUEUE] Run created and waiting for Agenda worker',
      runId,
      runByUserId: userId,
      runByScheduleId: source === 'scheduled' ? (options?.scheduleJobId || uuid()) : null,
      serializableOutput: {},
      binaryOutput: {},
      duration: null,
      errorMessage: null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.log('error', `Failed to create Run document for robot ${robot.recording_meta.id}: ${message}`);
    throw new Error(`Failed to create Run document: ${message}`);
  }

  const job = await enqueueScraperRun({
    automationId: robot.recording_meta.id,
    runId,
    userId: String(userId),
    config: {
      ...getAutomationConfig(robot),
      ...(options?.runtimeConfig || {}),
    },
  });

  const jobId = job.attrs._id?.toString() || 'unknown';
  await Run.updateOne({ runId }, { $set: {
    queueJobId: jobId,
    status: 'pending',
    log: source === 'scheduled'
      ? `[SCHEDULE] Agenda job ${jobId} enqueued by scheduler`
      : `[QUEUE] Agenda job ${jobId} enqueued`,
  } });

  return {
    browserId,
    runId,
    queued: true,
    queueJobId: jobId,
  };
}

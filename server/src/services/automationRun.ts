import { v4 as uuid } from 'uuid';
import mongoose from 'mongoose';
import Run from '../models/Run';
import Robot from '../models/Robot';
import { enqueueScraperRun, requeueScraperRun } from '../queue/scraperQueue';
import { getAutomationConfig } from './automation';
import logger from '../logger';
import { toOperationalRunConfig } from './automationConfigView';
import { normalizeOwnerIdForWrite } from '../utils/ownerId';
import { normalizeFailureReason } from '../utils/failureReason';

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
    if (mongoose.connection.readyState !== 1) {
      return;
    }
    const minAgeMs = options?.minAgeMs ?? STALE_PENDING_MS;
    const maxRuns = options?.maxRuns ?? 40;
    const runs = await Run.find({ status: 'pending' }).limit(maxRuns).lean();
    const now = Date.now();

    const eligible = runs.filter((run) => {
      const started = new Date(run.startedAt).getTime();
      if (Number.isNaN(started) || now - started < minAgeMs) {
        return false;
      }
      if (run.runByUserId === null || run.runByUserId === undefined) {
        return false;
      }
      return !!run.robotMetaId;
    });

    if (eligible.length === 0) {
      return;
    }

    const robotIds = [...new Set(eligible.map((run) => run.robotMetaId))];
    const robots = await Robot.find({ 'recording_meta.id': { $in: robotIds } }).lean();
    const robotsByMetaId = new Map(
      robots.map((robot: any) => [robot.recording_meta?.id, robot])
    );

    let ensured = 0;
    for (const run of eligible) {
      const robot: any = robotsByMetaId.get(run.robotMetaId);
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
        config: toOperationalRunConfig({
          ...getAutomationConfig(robot),
          ...(run.interpreterSettings?.runtimeConfig || {}),
        }),
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
    lineage?: {
      retryOfRunId: string;
      originalRunId: string;
      retrySequence: number;
      retryRequestKey: string;
    };
    admission?: {
      activeAutomationKey: string;
      accountActiveSlot: number;
    };
  }
) {
  const runId = uuid();
  const browserId = uuid();
  const source = options?.source || 'manual';
  const ownerId = normalizeOwnerIdForWrite(userId);
  const sortAt = new Date();
  const operationalConfig = toOperationalRunConfig({
    ...getAutomationConfig(robot),
    ...(options?.runtimeConfig || {}),
  });

  try {
    await Run.create({
      status: source === 'scheduled' ? 'scheduled' : 'pending',
      name: robot.recording_meta.name,
      robotId: robot._id ? robot._id.toString() : robot.id,
      robotMetaId: robot.recording_meta.id,
      scoutId:
        typeof robot.recording_meta.scoutId === 'string' && robot.recording_meta.scoutId.trim()
          ? String(robot.recording_meta.scoutId).trim().toUpperCase()
          : null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      browserId,
      interpreterSettings: {
        maxConcurrency: 1,
        maxRepeats: 1,
        debug: true,
        runtimeConfig: operationalConfig,
      },
      log: source === 'scheduled'
        ? `[SCHEDULE] Run created by scheduler${options?.scheduleJobId ? ` (${options.scheduleJobId})` : ''}`
        : '[QUEUE] Run created and waiting for Agenda worker',
      runId,
      ownerId,
      sortAt,
      ...(options?.lineage || {}),
      ...(options?.admission || {}),
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
    if ((err as any)?.code === 11000) {
      throw err;
    }
    throw new Error(`Failed to create Run document: ${message}`);
  }

  let job;
  try {
    job = await enqueueScraperRun({
      automationId: robot.recording_meta.id,
      runId,
      userId: String(userId),
      config: operationalConfig,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const finishedAt = new Date().toISOString();
    await Run.updateOne(
      { runId },
      {
        $set: {
          status: 'failed',
          finishedAt,
          errorMessage: message,
          normalizedFailureReason: normalizeFailureReason({ errorMessage: message }),
          log: `[QUEUE] Failed to enqueue Agenda job: ${message}`,
        },
        $unset: {
          activeAutomationKey: 1,
          accountActiveSlot: 1,
        },
      }
    );
    logger.log('error', `Failed to enqueue Run ${runId}: ${message}`);
    throw err;
  }

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

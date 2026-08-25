/**
 * Atlas / free-tier retention: purge bulky run, extracted, and job-board docs.
 * Never deletes robots, users, proxy, ops-digest settings, or scrape profiles.
 */
import mongoose from 'mongoose';
import { Job } from 'agenda';
import Run from '../models/Run';
import ExtractedData from '../models/ExtractedData';
import JobBoardListing from '../models/JobBoardListing';
import logger from '../logger';
import { getAgenda } from '../queue/scraperQueue';
import {
  isFailureRunStatus,
  isTerminalRunStatus,
} from './runLifecycle';

export const DATA_RETENTION_JOB = 'data-retention';

const SUCCESS_TERMINAL_STATUSES = ['completed', 'success', 'aborted'] as const;

export type RetentionSettings = {
  enabled: boolean;
  dryRun: boolean;
  successDays: number;
  failureDays: number;
  extractedOrphanDays: number;
  jobBoardDays: number;
  batchSize: number;
  batchDelayMs: number;
  schedule: string;
};

export type RetentionSummary = {
  dryRun: boolean;
  failureRuns: number;
  successRuns: number;
  extractedFromRuns: number;
  extractedOrphans: number;
  jobBoard: number;
};

export function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = parseInt(process.env[name] || '', 10);
  if (!Number.isFinite(raw) || raw < 1) return fallback;
  return raw;
}

export function isTruthyEnv(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw == null || raw === '') return defaultValue;
  return !['0', 'false', 'no', 'off'].includes(raw.trim().toLowerCase());
}

export function getRetentionSettings(): RetentionSettings {
  return {
    enabled: isTruthyEnv('RETENTION_ENABLED', true),
    dryRun: isTruthyEnv('RETENTION_DRY_RUN', false),
    successDays: parsePositiveIntEnv('RETENTION_RUN_SUCCESS_DAYS', 7),
    failureDays: parsePositiveIntEnv('RETENTION_RUN_FAILURE_DAYS', 30),
    extractedOrphanDays: parsePositiveIntEnv('RETENTION_EXTRACTED_ORPHAN_DAYS', 30),
    jobBoardDays: parsePositiveIntEnv('RETENTION_JOB_BOARD_DAYS', 60),
    batchSize: parsePositiveIntEnv('RETENTION_BATCH_SIZE', 500),
    batchDelayMs: parsePositiveIntEnv('RETENTION_BATCH_DELAY_MS', 100),
    schedule: (process.env.RETENTION_SCHEDULE || '15 4 * * *').trim() || '15 4 * * *',
  };
}

export function daysAgo(days: number, now = new Date()): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export function objectIdAt(date: Date): mongoose.Types.ObjectId {
  return mongoose.Types.ObjectId.createFromTime(Math.floor(date.getTime() / 1000));
}

/** Match docs older than cutoff via sortAt, or legacy rows with no sortAt via _id time. */
export function staleDateClause(cutoff: Date): Record<string, unknown> {
  return {
    $or: [
      { sortAt: { $lt: cutoff } },
      {
        $and: [
          { $or: [{ sortAt: null }, { sortAt: { $exists: false } }] },
          { _id: { $lt: objectIdAt(cutoff) } },
        ],
      },
    ],
  };
}

export type RunRetentionBucket = 'keep' | 'failure' | 'success';

export function classifyRunRetention(status?: string | null): RunRetentionBucket {
  if (!isTerminalRunStatus(status)) return 'keep';
  if (isFailureRunStatus(status)) return 'failure';
  return 'success';
}

export function shouldPurgeRun(
  run: { status?: string | null; sortAt?: Date | string | null; _id?: mongoose.Types.ObjectId },
  now: Date,
  settings: Pick<RetentionSettings, 'successDays' | 'failureDays'>
): boolean {
  const bucket = classifyRunRetention(run.status);
  if (bucket === 'keep') return false;
  const cutoff = daysAgo(bucket === 'failure' ? settings.failureDays : settings.successDays, now);
  const sortAt = run.sortAt ? new Date(run.sortAt) : null;
  if (sortAt && !Number.isNaN(sortAt.getTime())) {
    return sortAt < cutoff;
  }
  if (!run._id) return false;
  return run._id.getTimestamp() < cutoff;
}

export function shouldPurgeJobListing(
  listing: { lastSeenAt?: Date | string | null },
  now: Date,
  settings: Pick<RetentionSettings, 'jobBoardDays'>
): boolean {
  if (!listing.lastSeenAt) return false;
  const seen = new Date(listing.lastSeenAt);
  if (Number.isNaN(seen.getTime())) return false;
  return seen < daysAgo(settings.jobBoardDays, now);
}

export function shouldPurgeOrphanExtracted(
  row: { createdAt?: Date | string | null },
  now: Date,
  settings: Pick<RetentionSettings, 'extractedOrphanDays'>
): boolean {
  if (!row.createdAt) return false;
  const created = new Date(row.createdAt);
  if (Number.isNaN(created.getTime())) return false;
  return created < daysAgo(settings.extractedOrphanDays, now);
}

export function buildFailureRunFilter(cutoff: Date): Record<string, unknown> {
  return {
    status: { $in: ['failed', 'dead'] },
    ...staleDateClause(cutoff),
  };
}

export function buildSuccessRunFilter(cutoff: Date): Record<string, unknown> {
  return {
    status: { $in: [...SUCCESS_TERMINAL_STATUSES] },
    ...staleDateClause(cutoff),
  };
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function purgeRunBatches(
  filter: Record<string, unknown>,
  settings: RetentionSettings
): Promise<{ runs: number; extracted: number }> {
  let runs = 0;
  let extracted = 0;

  if (settings.dryRun) {
    runs = await Run.countDocuments(filter);
    return { runs, extracted: 0 };
  }

  while (true) {
    const docs = await Run.find(filter)
      .select({ _id: 1, runId: 1 })
      .limit(settings.batchSize)
      .lean();
    if (docs.length === 0) break;

    const runIds = docs.map((d) => d.runId).filter(Boolean);
    if (runIds.length > 0) {
      const extractedResult = await ExtractedData.deleteMany({ runId: { $in: runIds } });
      extracted += extractedResult.deletedCount ?? 0;
    }

    const ids = docs.map((d) => d._id);
    const runResult = await Run.deleteMany({ _id: { $in: ids } });
    runs += runResult.deletedCount ?? 0;

    await sleep(settings.batchDelayMs);
  }

  return { runs, extracted };
}

async function purgeExtractedOrphans(settings: RetentionSettings, cutoff: Date): Promise<number> {
  const filter = { createdAt: { $lt: cutoff } };
  if (settings.dryRun) {
    return ExtractedData.countDocuments(filter);
  }

  let deleted = 0;
  while (true) {
    const docs = await ExtractedData.find(filter)
      .select({ _id: 1 })
      .limit(settings.batchSize)
      .lean();
    if (docs.length === 0) break;
    const result = await ExtractedData.deleteMany({
      _id: { $in: docs.map((d) => d._id) },
    });
    deleted += result.deletedCount ?? 0;
    await sleep(settings.batchDelayMs);
  }
  return deleted;
}

async function purgeJobBoard(settings: RetentionSettings, cutoff: Date): Promise<number> {
  const filter = { lastSeenAt: { $lt: cutoff } };
  if (settings.dryRun) {
    return JobBoardListing.countDocuments(filter);
  }

  let deleted = 0;
  while (true) {
    const docs = await JobBoardListing.find(filter)
      .select({ _id: 1 })
      .limit(settings.batchSize)
      .lean();
    if (docs.length === 0) break;
    const result = await JobBoardListing.deleteMany({
      _id: { $in: docs.map((d) => d._id) },
    });
    deleted += result.deletedCount ?? 0;
    await sleep(settings.batchDelayMs);
  }
  return deleted;
}

export async function runDataRetention(
  now = new Date(),
  settings = getRetentionSettings()
): Promise<RetentionSummary> {
  const failureCutoff = daysAgo(settings.failureDays, now);
  const successCutoff = daysAgo(settings.successDays, now);
  const extractedCutoff = daysAgo(settings.extractedOrphanDays, now);
  const jobBoardCutoff = daysAgo(settings.jobBoardDays, now);

  const failed = await purgeRunBatches(buildFailureRunFilter(failureCutoff), settings);
  const succeeded = await purgeRunBatches(buildSuccessRunFilter(successCutoff), settings);
  const extractedOrphans = await purgeExtractedOrphans(settings, extractedCutoff);
  const jobBoard = await purgeJobBoard(settings, jobBoardCutoff);

  const summary: RetentionSummary = {
    dryRun: settings.dryRun,
    failureRuns: failed.runs,
    successRuns: succeeded.runs,
    extractedFromRuns: failed.extracted + succeeded.extracted,
    extractedOrphans,
    jobBoard,
  };

  logger.log(
    'info',
    `Data retention ${settings.dryRun ? 'dry-run' : 'purge'} ` +
      `failureRuns=${summary.failureRuns} successRuns=${summary.successRuns} ` +
      `extractedFromRuns=${summary.extractedFromRuns} extractedOrphans=${summary.extractedOrphans} ` +
      `jobBoard=${summary.jobBoard}`
  );

  return summary;
}

let retentionRegistered = false;

export async function registerDataRetentionJob(): Promise<void> {
  if (retentionRegistered) return;
  retentionRegistered = true;

  const agenda = await getAgenda();
  const settings = getRetentionSettings();

  (agenda as any).define(DATA_RETENTION_JOB, async (_job: Job) => {
    logger.log('info', 'Data retention job started');
    await runDataRetention();
  });

  if (!settings.enabled) {
    logger.log('info', 'Data retention defined but RETENTION_ENABLED=false — not scheduling');
    await agenda.cancel({ name: DATA_RETENTION_JOB });
    return;
  }

  await (agenda as any).every(settings.schedule, DATA_RETENTION_JOB, {}, { timezone: 'UTC' });
  logger.log(
    'info',
    `Data retention scheduled (${settings.schedule} UTC, dryRun=${settings.dryRun})`
  );
}

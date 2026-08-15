import { unlink } from 'fs/promises';
import Robot from '../models/Robot';
import Run from '../models/Run';
import ExtractedData from '../models/ExtractedData';
import { cancelScheduledTrigger, enqueueAbortRun, getAgenda } from '../queue/scraperQueue';
import { getSessionStatePath } from '../storage/sessionState';
import { removeFirebaseObjectsForRunIds } from '../storage/firebaseStorage';
import { abortRun } from '../workers/execution';
import { killScrapeChildForRun } from '../workers/scrapeJobSupervisor';
import logger from '../logger';

/** Runs that may still hold a scraper concurrency slot or Chromium process. */
const ACTIVE_RUN_STATUSES = ['pending', 'queued', 'scheduled', 'running', 'aborting'] as const;

/** How long to wait for scraper-worker abort jobs to kill children before deleting run docs. */
function getAbortWaitMs(): number {
  const raw = process.env.DELETE_AUTOMATION_ABORT_WAIT_MS;
  const parsed = raw === undefined || raw === '' ? 4000 : Number.parseInt(raw, 10);
  const ms = Number.isFinite(parsed) ? parsed : 4000;
  return Math.min(Math.max(ms, 0), 30_000);
}

async function removeStoredObjectsForRunIds(runIds: string[]): Promise<void> {
  if (runIds.length === 0) return;
  try {
    await removeFirebaseObjectsForRunIds(runIds, 'maxun-run-screenshots');
  } catch (e: any) {
    logger.log('warn', `Object storage cleanup for deleted automation (partial or skipped): ${e?.message || e}`);
  }
}

async function abortInFlightRunsForAutomation(
  userId: string | number,
  automationId: string,
  runs: Array<{ runId?: string; status?: string }>
): Promise<string[]> {
  const active = runs.filter(
    (r) => r.runId && ACTIVE_RUN_STATUSES.includes((r.status || '') as (typeof ACTIVE_RUN_STATUSES)[number])
  );
  if (active.length === 0) return [];

  const activeRunIds = active.map((r) => String(r.runId));
  const finishedAt = new Date().toLocaleString();
  const abortMessage = 'Automation deleted — in-flight scrape aborted';

  await Run.updateMany(
    { robotMetaId: automationId, runId: { $in: activeRunIds } },
    {
      $set: {
        status: 'aborted',
        errorMessage: abortMessage,
        finishedAt,
        log: abortMessage,
      },
    }
  );

  for (const runId of activeRunIds) {
    // Best-effort in this process (works when embedded workers / same scraper process).
    await killScrapeChildForRun(runId).catch((error: any) => {
      logger.log('warn', `killScrapeChildForRun on delete (${runId}): ${error?.message || error}`);
    });
    await abortRun(runId, String(userId)).catch((error: any) => {
      logger.log('warn', `abortRun on delete (${runId}): ${error?.message || error}`);
    });
    // Ensure the scraper worker process (PM2 scoutx-scraper) also kills the child.
    try {
      await enqueueAbortRun(String(userId), runId);
    } catch (error: any) {
      logger.log('warn', `enqueueAbortRun on delete (${runId}): ${error?.message || error}`);
    }
  }

  const abortWaitMs = getAbortWaitMs();
  logger.log(
    'info',
    `Aborting ${activeRunIds.length} in-flight run(s) before deleting automation ${automationId} (wait ${abortWaitMs}ms)`
  );
  if (abortWaitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, abortWaitMs));
  }
  return activeRunIds;
}

/**
 * Permanently removes an automation and all related data: Agenda jobs (schedules, scraper,
 * execute-run, etc.), runs, extracted rows, Playwright session state file, and Firebase Storage
 * objects under each runId prefix in `maxun-run-screenshots` (when Firebase is configured).
 *
 * In-flight scrapes are aborted first (status + kill scrape child / browser) so deleting a
 * running automation does not leave Chromium holding the scraper concurrency slot.
 */
export async function deleteAutomationCascade(userId: string | number, automationId: string): Promise<void> {
  const robot: any = await Robot.findOne({
    userId,
    'recording_meta.id': automationId,
  });

  if (!robot) {
    const err: any = new Error('Automation not found');
    err.statusCode = 404;
    throw err;
  }

  const runs = await Run.find({ robotMetaId: automationId }).select('runId status').lean();
  const runIds = runs.map((r: any) => r.runId).filter(Boolean) as string[];

  await abortInFlightRunsForAutomation(userId, automationId, runs as any);

  await cancelScheduledTrigger(automationId);

  const agenda = await getAgenda();
  const orClauses: Record<string, unknown>[] = [
    { name: 'scraper-jobs', 'data.automationId': automationId },
    { name: 'schedule-triggers', 'data.automationId': automationId },
  ];
  if (runIds.length > 0) {
    orClauses.push(
      { name: 'scraper-jobs', 'data.runId': { $in: runIds } },
      { name: 'execute-run', 'data.runId': { $in: runIds } },
      { name: 'execute-run-user', 'data.runId': { $in: runIds } },
      { name: 'abort-run', 'data.runId': { $in: runIds } },
    );
  }
  const deletedJobs = await agenda.cancel({ $or: orClauses });
  logger.log('info', `Removed ${deletedJobs ?? 0} Agenda job(s) for automation ${automationId}`);

  await removeStoredObjectsForRunIds(runIds);

  try {
    const sessionPath = await getSessionStatePath(String(userId), automationId);
    await unlink(sessionPath);
  } catch {
    // no session file
  }

  await ExtractedData.deleteMany({ robotMetaId: automationId });
  const runDel = await Run.deleteMany({ robotMetaId: automationId });
  await Robot.deleteOne({ _id: robot._id });

  logger.log(
    'info',
    `Deleted automation ${automationId}: ${runDel.deletedCount ?? 0} run(s), extracted data, schedules, and queue jobs`
  );
}

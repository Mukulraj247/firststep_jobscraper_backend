/**
 * Recovers orphaned runs left in running/scheduled after a crash or hard kill.
 * Extracted from routes/storage so the scraper worker can call it without importing the Express router.
 */
import logger from '../logger';
import Run from '../models/Run';
import { enqueueScraperRun } from '../queue/scraperQueue';
import { getScrapeHeartbeatStaleMs, isRunningLeaseStale } from '../utils/scrapeHeartbeat';
import { toOperationalRunConfig } from './automationConfigView';

export type RecoverOrphanedRunsOptions = {
  /**
   * Worker processes have no recording browserPool — treat every running/scheduled
   * run as orphaned. API boot keeps the live-browser check.
   */
  assumeNoBrowsers?: boolean;
};

type BrowserLookup = {
  getRemoteBrowser: (browserId: string) => unknown;
  deleteRemoteBrowser: (browserId: string) => void;
};

async function resolveBrowserPool(): Promise<BrowserLookup | null> {
  try {
    const { browserPool } = await import('../server');
    return browserPool as BrowserLookup;
  } catch {
    return null;
  }
}

/**
 * Recovers orphaned runs that were left in "running" status due to instance crashes.
 * Running leases with a fresh heartbeatAt are left alone (still owned by a live worker).
 */
export async function recoverOrphanedRuns(options?: RecoverOrphanedRunsOptions): Promise<void> {
  try {
    logger.log('info', 'Starting recovery of orphaned runs...');

    // Recover runs that were mid-flight when the server died. Exclude `pending` — those are
    // waiting on the Agenda scraper queue (placeholder browserId, no real browser yet) and are
    // not crash orphans; treating them here bumped retryCount on every restart.
    const orphanedRuns = await Run.find({
      status: { $in: ['running', 'scheduled'] },
    }).sort({ startedAt: 1 });

    if (orphanedRuns.length === 0) {
      logger.log('info', 'No orphaned runs found');
      return;
    }

    logger.log('info', `Found ${orphanedRuns.length} candidate orphaned run(s) to inspect`);

    const pool = options?.assumeNoBrowsers ? null : await resolveBrowserPool();
    const staleMs = getScrapeHeartbeatStaleMs();
    const now = Date.now();

    for (const run of orphanedRuns) {
      try {
        const runData = run.toJSON();

        if (runData.status === 'running') {
          const stale = isRunningLeaseStale({
            heartbeatAt: runData.heartbeatAt,
            startedAt: runData.startedAt,
            now,
            staleMs,
          });
          if (!stale) {
            logger.log(
              'info',
              `Run ${runData.runId} still has a fresh scrape heartbeat — skipping reclaim`
            );
            continue;
          }
        }

        logger.log('info', `Recovering orphaned run: ${runData.runId} (status=${runData.status})`);

        const browser =
          !options?.assumeNoBrowsers && runData.browserId && pool
            ? pool.getRemoteBrowser(runData.browserId)
            : null;

        if (!browser) {
          const retryCount = runData.retryCount || 0;

          if (retryCount < 3) {
            run.status = 'pending';
            run.retryCount = retryCount + 1;
            run.serializableOutput = {};
            run.binaryOutput = {};
            run.browserId = '';
            run.errorMessage = null;
            run.heartbeatAt = null;
            run.log = runData.log
              ? `${runData.log}\n[RETRY ${retryCount + 1}/3] Re-queuing due to server crash`
              : `[RETRY ${retryCount + 1}/3] Re-queuing due to server crash`;
            await run.save();

            const scraperJob = await enqueueScraperRun({
              automationId: runData.robotMetaId,
              runId: runData.runId,
              userId: String(runData.runByUserId || ''),
              config: toOperationalRunConfig(runData.interpreterSettings?.runtimeConfig || {}),
            });

            logger.log(
              'info',
              `Re-queued crashed run ${runData.runId} as scraper job ${scraperJob.attrs._id} (retry ${retryCount + 1}/3)`
            );
          } else {
            const crashRecoveryMessage = `Dead letter: max crash-recovery retries exceeded (3/3).`;

            run.status = 'dead';
            run.finishedAt = new Date().toISOString();
            run.errorMessage = crashRecoveryMessage;
            run.heartbeatAt = null;
            run.log = runData.log ? `${runData.log}\n${crashRecoveryMessage}` : crashRecoveryMessage;
            await run.save();

            logger.log('warn', `Max retries reached for run ${runData.runId}, marked as dead`);
          }

          if (runData.browserId && pool) {
            try {
              pool.deleteRemoteBrowser(runData.browserId);
              logger.log('info', `Cleaned up stale browser reference: ${runData.browserId}`);
            } catch (cleanupError: any) {
              logger.log(
                'warn',
                `Failed to cleanup browser reference ${runData.browserId}: ${cleanupError.message}`
              );
            }
          }
        } else {
          logger.log('info', `Run ${runData.runId} browser still active, not orphaned`);
        }
      } catch (runError: any) {
        logger.log('error', `Failed to recover run ${run.runId}: ${runError.message}`);
      }
    }

    logger.log('info', `Orphaned run recovery completed. Processed ${orphanedRuns.length} runs.`);
  } catch (error: any) {
    logger.log('error', `Failed to recover orphaned runs: ${error.message}`);
  }
}

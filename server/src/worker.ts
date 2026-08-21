import dotenv from 'dotenv';
dotenv.config();

import logger from './logger';
import mongoose, { connectDB, syncDB } from './storage/db';
import { startWorkers } from './pgboss-worker';
import { startScraperWorker, stopScraperWorker, setScraperShuttingDown } from './workers/scraperWorker';
import {
  rehydrateAutomationSchedules,
  startAutomationScheduleWorker,
  stopAutomationScheduleWorker,
  startMissedScheduleCatchupLoop,
} from './services/automationScheduler';
import { registerOpsDigestJob } from './services/opsDigest';
import { drainAndCloseAgenda, getScrapeDrainMs } from './queue/scraperQueue';
import { closeBrowserReusePool } from './services/browserReusePool';
import { setChromiumSlotProcessKind } from './services/chromiumSlotLease';
import {
  killUntrackedPlaywrightChromium,
  startOrphanChromiumReaper,
  stopOrphanChromiumReaper,
} from './services/browserProcess';
import { recoverOrphanedRuns } from './services/orphanRunRecovery';
import { warnIfConstrainedScraperFingerprint } from './utils/prodEnvGuard';
import { isSchedulerEnabled } from './utils/schedulerEnabled';

let shuttingDown = false;

async function startWorkerRuntime() {
  warnIfConstrainedScraperFingerprint((level, msg) => logger.log(level as any, msg));

  setChromiumSlotProcessKind('scraper');
  await connectDB();
  await syncDB();

  // Recover runs left mid-flight after a previous hard kill (API boot alone won't help in PM2 split).
  await recoverOrphanedRuns({ assumeNoBrowsers: true });

  await startWorkers();
  await startScraperWorker();
  startOrphanChromiumReaper();

  if (isSchedulerEnabled()) {
    await startAutomationScheduleWorker();
    await rehydrateAutomationSchedules();
    startMissedScheduleCatchupLoop();
    try {
      await registerOpsDigestJob();
    } catch (digestError: any) {
      logger.log('error', `Failed to register ops digest job: ${digestError?.message || digestError}`);
    }
  } else {
    logger.log('info', 'SCHEDULER_ENABLED=false — scraper-only (skip schedule rehydrate / catch-up / ops digest)');
  }

  logger.log('info', 'Worker runtime started');
}

async function shutdown(signal: string) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  setScraperShuttingDown(true);

  logger.log('info', `${signal} received, shutting down worker runtime (drain ${getScrapeDrainMs()}ms)...`);
  let exitCode = 0;

  try {
    if (isSchedulerEnabled()) {
      await stopAutomationScheduleWorker();
    }
  } catch (error: any) {
    exitCode = 1;
    logger.log('error', `Failed to stop automation schedule worker: ${error.message}`);
  }

  try {
    // Timed drain first so in-flight jobs can finish; then unlock + close.
    await drainAndCloseAgenda({ drainMs: getScrapeDrainMs() });
  } catch (error: any) {
    exitCode = 1;
    logger.log('error', `Failed to drain/close Agenda: ${error.message}`);
  }

  try {
    // Kill any scrape children still alive after drain timeout / incomplete drain.
    await stopScraperWorker();
  } catch (error: any) {
    exitCode = 1;
    logger.log('error', `Failed to stop scraper worker: ${error.message}`);
  }

  try {
    stopOrphanChromiumReaper();
    await closeBrowserReusePool();
    await killUntrackedPlaywrightChromium().catch(() => {});
  } catch (error: any) {
    exitCode = 1;
    logger.log('error', `Failed to close browser reuse pool: ${error.message}`);
  }

  try {
    await mongoose.connection.close();
  } catch (error: any) {
    exitCode = 1;
    logger.log('error', `Failed to close database connection: ${error.message}`);
  }

  process.exit(exitCode);
}

startWorkerRuntime().catch((error: any) => {
  logger.log('error', `Failed to start worker runtime: ${error.message}`);
  process.exit(1);
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('uncaughtException', (error) => {
  logger.log('error', `Worker uncaught exception: ${error.message}`);
  void shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  logger.log('error', `Worker unhandled rejection: ${message}`);
  void shutdown('unhandledRejection');
});

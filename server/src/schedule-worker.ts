/**
 * Dedicated Agenda schedule process — no Chromium / scraper worker.
 *
 * Registers schedule-triggers, rehydrates robot schedules, missed catch-up,
 * and ops digest. Pair with scoutx-scraper SCHEDULER_ENABLED=false in PM2.
 *
 *   npm run worker:scheduler
 *   Dev: npm run worker:scheduler:dev
 */
import dotenv from 'dotenv';
dotenv.config();

import logger from './logger';
import mongoose, { connectDB, syncDB } from './storage/db';
import {
  rehydrateAutomationSchedules,
  startAutomationScheduleWorker,
  stopAutomationScheduleWorker,
  startMissedScheduleCatchupLoop,
  stopMissedScheduleCatchupLoop,
} from './services/automationScheduler';
import { registerOpsDigestJob } from './services/opsDigest';
import { registerDataRetentionJob } from './services/dataRetention';
import { drainAndCloseAgenda, getScrapeDrainMs } from './queue/scraperQueue';

let shuttingDown = false;

async function startSchedulerRuntime() {
  await connectDB();
  await syncDB();

  await startAutomationScheduleWorker();
  await rehydrateAutomationSchedules();
  startMissedScheduleCatchupLoop();
  try {
    await registerOpsDigestJob();
    await registerDataRetentionJob();
  } catch (digestError: any) {
    logger.log('error', `Failed to register ops digest/retention jobs: ${digestError?.message || digestError}`);
  }

  logger.log('info', 'Scheduler runtime started (no scraper / Chromium)');
}

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.log('info', `${signal} received, shutting down scheduler runtime...`);
  let exitCode = 0;

  try {
    stopMissedScheduleCatchupLoop();
  } catch (error: any) {
    exitCode = 1;
    logger.log('error', `Failed to stop missed schedule catch-up: ${error.message}`);
  }

  try {
    await stopAutomationScheduleWorker();
  } catch (error: any) {
    exitCode = 1;
    logger.log('error', `Failed to stop automation schedule worker: ${error.message}`);
  }

  try {
    // Schedule-side drain only — no scrape children / browser pool on this process.
    await drainAndCloseAgenda({ drainMs: Math.min(getScrapeDrainMs(), 15_000) });
  } catch (error: any) {
    exitCode = 1;
    logger.log('error', `Failed to drain/close Agenda: ${error.message}`);
  }

  try {
    await mongoose.connection.close();
  } catch (error: any) {
    exitCode = 1;
    logger.log('error', `Failed to close database connection: ${error.message}`);
  }

  process.exit(exitCode);
}

startSchedulerRuntime().catch((error: any) => {
  logger.log('error', `Failed to start scheduler runtime: ${error.message}`);
  process.exit(1);
});

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});

process.on('uncaughtException', (error) => {
  logger.log('error', `Scheduler uncaught exception: ${error.message}`);
  void shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  logger.log('error', `Scheduler unhandled rejection: ${message}`);
  void shutdown('unhandledRejection');
});

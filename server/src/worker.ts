import dotenv from 'dotenv';
dotenv.config();

import logger from './logger';
import mongoose, { connectDB, syncDB } from './storage/db';
import { startWorkers } from './pgboss-worker';
import { startScraperWorker, stopScraperWorker } from './workers/scraperWorker';
import { rehydrateAutomationSchedules, startAutomationScheduleWorker, stopAutomationScheduleWorker } from './services/automationScheduler';
import { registerOpsDigestJob } from './services/opsDigest';
import { closeAgenda } from './queue/scraperQueue';
import { closeBrowserReusePool } from './services/browserReusePool';

let shuttingDown = false;

async function startWorkerRuntime() {
  await connectDB();
  await syncDB();

  await startWorkers();
  await startScraperWorker();
  await startAutomationScheduleWorker();
  await rehydrateAutomationSchedules();
  try {
    await registerOpsDigestJob();
  } catch (digestError: any) {
    logger.log('error', `Failed to register ops digest job: ${digestError?.message || digestError}`);
  }

  logger.log('info', 'Worker runtime started');
}

async function shutdown(signal: string) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  logger.log('info', `${signal} received, shutting down worker runtime...`);
  let exitCode = 0;

  try {
    await stopScraperWorker();
  } catch (error: any) {
    exitCode = 1;
    logger.log('error', `Failed to stop scraper worker: ${error.message}`);
  }

  try {
    await stopAutomationScheduleWorker();
  } catch (error: any) {
    exitCode = 1;
    logger.log('error', `Failed to stop automation schedule worker: ${error.message}`);
  }

  try {
    await closeAgenda();
  } catch (error: any) {
    exitCode = 1;
    logger.log('error', `Failed to close Agenda queue: ${error.message}`);
  }

  try {
    await closeBrowserReusePool();
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

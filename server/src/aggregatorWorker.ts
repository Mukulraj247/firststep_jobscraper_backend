/**
 * Dedicated Hiring Cafe / aggregator worker.
 * Processes Agenda `aggregator-jobs` only (career scrapers stay on `scraper-jobs`).
 *
 *   npm run worker:aggregators
 *   npm run worker:aggregators:dev
 */
import dotenv from 'dotenv';
dotenv.config();

import logger from './logger';
import mongoose, { connectDB, syncDB } from './storage/db';
import {
  startAggregatorWorker,
  stopScraperWorker,
  setScraperShuttingDown,
} from './workers/scraperWorker';
import { drainAndCloseAgenda, getScrapeDrainMs } from './queue/scraperQueue';
import { closeBrowserReusePool } from './services/browserReusePool';
import {
  killUntrackedPlaywrightChromium,
  startOrphanChromiumReaper,
  stopOrphanChromiumReaper,
} from './services/browserProcess';

let shuttingDown = false;

async function main() {
  await connectDB();
  await syncDB();
  await startAggregatorWorker();
  startOrphanChromiumReaper();
  logger.log('info', 'Aggregator worker runtime started');
}

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  setScraperShuttingDown(true);
  logger.log('info', `${signal} received, shutting down aggregator worker...`);
  stopOrphanChromiumReaper();
  try {
    await stopScraperWorker();
  } catch (error: any) {
    logger.log('error', `stopScraperWorker: ${error.message}`);
  }
  try {
    await drainAndCloseAgenda({ drainMs: getScrapeDrainMs() });
  } catch (error: any) {
    logger.log('error', `drainAndCloseAgenda: ${error.message}`);
  }
  try {
    await closeBrowserReusePool();
  } catch {
    /* ignore */
  }
  try {
    killUntrackedPlaywrightChromium();
  } catch {
    /* ignore */
  }
  try {
    await mongoose.connection.close();
  } catch (error: any) {
    logger.log('error', `Failed to close database: ${error.message}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((error: any) => {
  logger.log('error', `Failed to start aggregator worker: ${error.message}`);
  process.exit(1);
});

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

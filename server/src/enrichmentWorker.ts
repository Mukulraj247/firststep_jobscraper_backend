/**
 * Dedicated low-CPU job-board enrichment process.
 * Fetches detail pages via ATS APIs / scrape.do / Playwright (IBM Careers WAF).
 *
 *   UV_THREADPOOL_SIZE=8 NODE_OPTIONS='--max-old-space-size=512' npm run worker:enrichment
 *   Dev (ts-node needs more heap): npm run worker:enrichment:dev
 */
import dotenv from 'dotenv';
dotenv.config();

if (!process.env.UV_THREADPOOL_SIZE) {
  process.env.UV_THREADPOOL_SIZE = '8';
}

import logger from './logger';
import mongoose, { connectDB, syncDB } from './storage/db';
import { startJobEnrichmentLoop, stopJobEnrichmentLoop } from './workers/jobEnrichmentWorker';

let shuttingDown = false;

async function main() {
  await connectDB();
  await syncDB();

  if (!process.env.SCRAPE_DO_TOKEN) {
    logger.log(
      'warn',
      'SCRAPE_DO_TOKEN is not set — enrichment will mark scrape.do rows as failed until configured'
    );
  }

  // Fire-and-forget loop; process stays alive until signal.
  void startJobEnrichmentLoop();
  logger.log('info', 'Job enrichment worker runtime started');
}

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.log('info', `${signal} received, shutting down enrichment worker...`);
  stopJobEnrichmentLoop();
  try {
    await mongoose.connection.close();
  } catch (error: any) {
    logger.log('error', `Failed to close database connection: ${error.message}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((error: any) => {
  logger.log('error', `Failed to start enrichment worker: ${error.message}`);
  process.exit(1);
});

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

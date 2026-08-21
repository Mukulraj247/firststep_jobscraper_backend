/**
 * Disposable scrape job child process entry.
 * Started by scrapeJobSupervisor — connects Mongo, runs one job, exits.
 * Does not listen on HTTP.
 */
import dotenv from 'dotenv';
dotenv.config();

import logger from '../logger';
import { connectDB, syncDB } from '../storage/db';
import { closeBrowserReusePool } from '../services/browserReusePool';
import { killUntrackedPlaywrightChromium } from '../services/browserProcess';
import { setChromiumSlotProcessKind } from '../services/chromiumSlotLease';
import type { ScraperJobData } from '../queue/scraperQueue';
import { runScraperJobPayload } from './scraperWorker';
import { closeAgenda } from '../queue/scraperQueue';

type StartMessage = { type: 'start'; data: ScraperJobData };

async function shutdown(): Promise<void> {
  try {
    await closeBrowserReusePool();
  } catch {
    /* ignore */
  }
  try {
    await killUntrackedPlaywrightChromium();
  } catch {
    /* ignore */
  }
  try {
    await closeAgenda();
  } catch {
    /* ignore */
  }
}

async function runJob(data: ScraperJobData): Promise<void> {
  setChromiumSlotProcessKind('scraper');
  await connectDB();
  await syncDB();
  await runScraperJobPayload(data);
}

function sendResult(ok: boolean, message?: string): void {
  if (typeof process.send === 'function') {
    try {
      process.send(ok ? { type: 'result', ok: true } : { type: 'result', ok: false, message: message || 'failed' });
    } catch {
      /* parent may be gone */
    }
  }
}

async function main(): Promise<void> {
  process.env.SCRAPE_JOB_CHILD = '1';

  const startFromArgv = (): StartMessage | null => {
    const raw = process.argv.find((a) => a.startsWith('--job='));
    if (!raw) return null;
    try {
      const data = JSON.parse(decodeURIComponent(raw.slice('--job='.length))) as ScraperJobData;
      return { type: 'start', data };
    } catch {
      return null;
    }
  };

  const boot = startFromArgv();
  if (boot) {
    try {
      await runJob(boot.data);
      sendResult(true);
      await shutdown();
      process.exit(0);
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      const isDrift = error?.name === 'RunDriftError';
      logger.log(isDrift ? 'warn' : 'error', `scrapeJobChild failed: ${message}`);
      sendResult(isDrift ? true : false, isDrift ? undefined : message);
      await shutdown();
      process.exit(isDrift ? 0 : 1);
    }
    return;
  }

  process.on('message', async (msg: StartMessage) => {
    if (!msg || msg.type !== 'start' || !msg.data) return;
    try {
      await runJob(msg.data);
      sendResult(true);
      await shutdown();
      process.exit(0);
    } catch (error: any) {
      const message = error instanceof Error ? error.message : String(error);
      const isDrift = error?.name === 'RunDriftError';
      // Drift already persisted terminal status — treat as successful child completion for Agenda.
      logger.log(isDrift ? 'warn' : 'error', `scrapeJobChild failed: ${message}`);
      sendResult(isDrift ? true : false, isDrift ? undefined : message);
      await shutdown();
      process.exit(isDrift ? 0 : 1);
    }
  });

  // Ready signal so parent knows IPC is live (optional).
  if (typeof process.send === 'function') {
    try {
      process.send({ type: 'ready' });
    } catch {
      /* ignore */
    }
  }
}

main().catch(async (error) => {
  logger.log('error', `scrapeJobChild boot failed: ${error?.message || error}`);
  sendResult(false, String(error?.message || error));
  await shutdown();
  process.exit(1);
});

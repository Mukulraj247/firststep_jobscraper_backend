/**
 * Force-close Playwright browsers and reap orphaned chrome-headless-shell processes.
 *
 * Job timeouts only reject a Node Promise.race — Chromium keeps running unless we
 * explicitly close/kill it. Track local browser PIDs and SIGKILL leftovers.
 *
 * IMPORTANT: With SCRAPE_JOB_CHILD_PROCESS, Chromium runs inside forked children.
 * The parent process has an empty pool + empty trackedPids — a naive reaper would
 * SIGKILL the child's browsers mid-job ("Target page, context or browser has been closed").
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { Browser } from 'playwright-core';
import logger from '../logger';

const execFileAsync = promisify(execFile);

const trackedPids = new Set<number>();

const CLOSE_TIMEOUT_MS = parseInt(process.env.BROWSER_CLOSE_TIMEOUT_MS || '4000', 10);
const REAPER_INTERVAL_MS = parseInt(process.env.CHROMIUM_ORPHAN_REAPER_MS || '60000', 10);
const REAPER_ENABLED = process.env.CHROMIUM_ORPHAN_REAPER !== 'false';

let reaperTimer: NodeJS.Timeout | null = null;
let poolEmptyCheck: (() => boolean) | null = null;
/** Return true when scrape child processes may own live Chromium (parent must not reap). */
let scrapeChildrenActiveCheck: (() => boolean) | null = null;

type BrowserWithProcess = Browser & {
  process?: () => { pid?: number } | null;
};

export function registerBrowserPid(browser: Browser | null | undefined): number | null {
  try {
    const pid = (browser as BrowserWithProcess | null | undefined)?.process?.()?.pid;
    if (pid && Number.isFinite(pid) && pid > 0) {
      trackedPids.add(pid);
      return pid;
    }
  } catch {
    /* remote browsers have no local process */
  }
  return null;
}

export function unregisterBrowserPid(pid: number | null | undefined): void {
  if (pid && Number.isFinite(pid)) trackedPids.delete(pid);
}

export function getTrackedBrowserPids(): number[] {
  return [...trackedPids];
}

export function setOrphanReaperPoolEmptyCheck(fn: () => boolean): void {
  poolEmptyCheck = fn;
}

export function setOrphanReaperScrapeChildrenCheck(fn: () => boolean): void {
  scrapeChildrenActiveCheck = fn;
}

/** Close gracefully, then SIGKILL the local Chromium process if still alive. */
export async function forceCloseBrowser(
  browser: Browser | null | undefined,
  label = 'browser'
): Promise<void> {
  if (!browser) return;

  let pid: number | null = null;
  try {
    pid = (browser as BrowserWithProcess).process?.()?.pid ?? null;
    if (pid) trackedPids.add(pid);
  } catch {
    pid = null;
  }

  try {
    await Promise.race([
      browser.close(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`browser.close timeout after ${CLOSE_TIMEOUT_MS}ms`)), CLOSE_TIMEOUT_MS)
      ),
    ]);
  } catch (error: any) {
    logger.log('warn', `forceCloseBrowser(${label}): close failed — ${error?.message || error}`);
  }

  if (pid && Number.isFinite(pid)) {
    try {
      process.kill(pid, 0);
      process.kill(pid, 'SIGKILL');
      logger.log('warn', `forceCloseBrowser(${label}): SIGKILL pid ${pid}`);
    } catch {
      /* already dead */
    }
    trackedPids.delete(pid);
  }
}

export type KillOrphanOptions = {
  /** After we already SIGKILL'd a scrape child tree — allow sweeping leftovers. */
  force?: boolean;
};

/**
 * Kill chrome-headless-shell PIDs that we did not launch (or lost track of).
 * Only safe when no pooled / active browsers remain — otherwise child renderers
 * of a live browser would be killed mid-job.
 */
export async function killUntrackedPlaywrightChromium(
  options: KillOrphanOptions = {}
): Promise<number> {
  if (process.platform === 'win32') return 0;
  if (!options.force) {
    if (trackedPids.size > 0) return 0;
    if (poolEmptyCheck && !poolEmptyCheck()) return 0;
    // Parent scraper + child isolation: Chromium lives in forked children.
    if (scrapeChildrenActiveCheck?.()) {
      return 0;
    }
    // Extra guard: never reap from parent while child-isolation is on unless forced.
    const inChild = process.env.SCRAPE_JOB_CHILD === '1';
    const childIsolationFlag = String(process.env.SCRAPE_JOB_CHILD_PROCESS ?? 'true')
      .trim()
      .toLowerCase();
    const childIsolationOn = !(
      childIsolationFlag === 'false' ||
      childIsolationFlag === '0' ||
      childIsolationFlag === 'no' ||
      childIsolationFlag === 'off'
    );
    if (!inChild && childIsolationOn) {
      return 0;
    }
  }

  let stdout = '';
  try {
    const result = await execFileAsync(
      'pgrep',
      ['-af', 'chrome-headless-shell|chromium_headless_shell'],
      { timeout: 5000, maxBuffer: 1024 * 1024 }
    );
    stdout = result.stdout || '';
  } catch (error: any) {
    // pgrep exits 1 when no matches
    if (error?.code === 1 || error?.status === 1) return 0;
    logger.log('warn', `orphan chromium pgrep failed: ${error?.message || error}`);
    return 0;
  }

  let killed = 0;
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!/ms-playwright|chrome-headless-shell|chromium_headless_shell/i.test(trimmed)) continue;
    const pid = parseInt(trimmed.split(/\s+/)[0], 10);
    if (!Number.isFinite(pid) || pid <= 1 || trackedPids.has(pid)) continue;
    try {
      process.kill(pid, 'SIGKILL');
      killed += 1;
    } catch {
      /* gone */
    }
  }

  if (killed > 0) {
    logger.log('warn', `Orphan Chromium reaper killed ${killed} untracked chrome-headless-shell process(es)`);
  }
  return killed;
}

export function startOrphanChromiumReaper(): void {
  if (!REAPER_ENABLED || reaperTimer || process.platform === 'win32') return;

  // Parent with child isolation must not run the periodic reaper — children own Chromium.
  const inChild = process.env.SCRAPE_JOB_CHILD === '1';
  const childIsolationFlag = String(process.env.SCRAPE_JOB_CHILD_PROCESS ?? 'true')
    .trim()
    .toLowerCase();
  const childIsolationOn = !(
    childIsolationFlag === 'false' ||
    childIsolationFlag === '0' ||
    childIsolationFlag === 'no' ||
    childIsolationFlag === 'off'
  );
  if (!inChild && childIsolationOn) {
    logger.log(
      'info',
      'Chromium orphan reaper skipped in parent (SCRAPE_JOB_CHILD_PROCESS) — children own browsers'
    );
    return;
  }

  reaperTimer = setInterval(() => {
    void killUntrackedPlaywrightChromium().catch((error: any) => {
      logger.log('warn', `Orphan Chromium reaper error: ${error?.message || error}`);
    });
  }, REAPER_INTERVAL_MS);
  if (typeof reaperTimer.unref === 'function') reaperTimer.unref();
  logger.log('info', `Chromium orphan reaper started (every ${REAPER_INTERVAL_MS}ms)`);
}

export function stopOrphanChromiumReaper(): void {
  if (reaperTimer) {
    clearInterval(reaperTimer);
    reaperTimer = null;
  }
}

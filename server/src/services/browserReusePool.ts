import type { Browser, BrowserContext, Page } from 'playwright-core';
import logger from '../logger';
import { BrowserLaunchProfile, connectToRemoteBrowser } from '../browser-management/browserConnection';
import { applyStealthOverrides } from './unblocker';
import {
  getBrowserPoolIdleTtlMs,
  getBrowserPoolMaxAgeMs,
  getBrowserPoolMaxJobs,
  getBrowserPoolRssLimitBytes,
  getDefaultMaxPagesPerBrowser,
  isLowMemoryMode,
  shouldRetirePooledBrowser,
  shouldRetirePoolForRss,
} from '../utils/memoryMode';
import {
  forceCloseBrowser,
  registerBrowserPid,
  setOrphanReaperPoolEmptyCheck,
  killUntrackedPlaywrightChromium,
} from './browserProcess';
import {
  claimChromiumSlot,
  getChromiumSlotProcessKind,
  releaseChromiumSlot,
  type ChromiumSlotHandle,
  type ChromiumSlotKind,
} from './chromiumSlotLease';

interface PooledBrowserEntry {
  key: string;
  browser: Browser;
  activePages: number;
  maxPages: number;
  lastUsedAt: number;
  closing: boolean;
  acquiredAt: number;
  createdAt: number;
  /** Successful page leases served from this browser process. */
  jobsServed: number;
}

interface PooledPageLease {
  key: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  /** Droplet-wide Chromium slot (released in releasePooledPage). */
  chromiumSlot?: ChromiumSlotHandle;
}

interface AcquirePooledPageOptions {
  profile?: BrowserLaunchProfile & {
    userAgent?: string;
    storageStatePath?: string;
    locale?: string;
    poolIsolationKey?: string;
  };
  maxPagesPerBrowser?: number;
  blockResources?: boolean;
  /** Override process default (`scraper` | `aggregator`). */
  chromiumSlotKind?: ChromiumSlotKind;
  chromiumSlotRunId?: string;
}

const pooledBrowsers = new Map<string, PooledBrowserEntry>();
const IDLE_BROWSER_TTL_MS = getBrowserPoolIdleTtlMs();
const MAX_JOBS = getBrowserPoolMaxJobs();
const MAX_AGE_MS = getBrowserPoolMaxAgeMs();
const RSS_LIMIT_BYTES = getBrowserPoolRssLimitBytes();
const CLEANUP_INTERVAL_MS = parseInt(process.env.BROWSER_POOL_CLEANUP_INTERVAL_MS || '15000', 10);
/** Force-evict browsers held past job timeout (+ grace) even if activePages > 0. */
const STALE_IN_USE_MS = parseInt(
  process.env.BROWSER_POOL_STALE_IN_USE_MS ||
    String(Math.max(parseInt(process.env.SCRAPER_JOB_TIMEOUT_MS || '120000', 10), 120000) + 60000),
  10
);

let cleanupTimer: NodeJS.Timeout | null = null;

const adAndAnalyticsPatterns = [
  'doubleclick.net',
  'googletagmanager.com',
  'google-analytics.com',
  'adservice.google.com',
  'segment.io',
  'facebook.net',
  'hotjar.com',
  'intercom.io',
  'scorecardresearch.com',
  // Intentionally NOT a bare "analytics" substring — that aborted main-frame
  // navigations to job boards whose query contained keywords like "data+analytics".
];

/** Exported for unit tests. Used by pooled contexts when blockResources is on. */
export const shouldBlockRequest = (url: string, resourceType: string) => {
  // Never abort navigations / websockets. Substring ad rules must not match
  // the document URL (e.g. ?keyword=data+analytics → net::ERR_FAILED).
  if (resourceType === 'document' || resourceType === 'websocket') {
    return false;
  }
  if (resourceType === 'image' || resourceType === 'font' || resourceType === 'media') {
    return true;
  }
  if (isLowMemoryMode() && resourceType === 'stylesheet') {
    return true;
  }
  const lower = url.toLowerCase();
  return adAndAnalyticsPatterns.some((pattern) => lower.includes(pattern));
};

const buildPoolKey = (profile?: AcquirePooledPageOptions['profile']) =>
  JSON.stringify({
    browserType: profile?.browserType || 'playwright',
    headless: profile?.headless ?? true,
    useStealth: profile?.useStealth ?? true,
    proxyServer: profile?.proxy?.server || '',
    proxyUsername: profile?.proxy?.username || '',
    isolationKey: profile?.poolIsolationKey || '',
    disableHttp2: !!profile?.disableHttp2,
  });

setOrphanReaperPoolEmptyCheck(() => pooledBrowsers.size === 0);

async function retireEntry(key: string, entry: PooledBrowserEntry, reason: string): Promise<void> {
  if (entry.closing) return;
  entry.closing = true;
  logger.log('info', `Retiring pooled browser ${key} (${reason})`);
  try {
    await forceCloseBrowser(entry.browser, `retire:${key}`);
  } finally {
    pooledBrowsers.delete(key);
  }
}

const ensureCleanupLoop = () => {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(async () => {
    const now = Date.now();
    const rss = process.memoryUsage().rss;
    if (shouldRetirePoolForRss(rss, RSS_LIMIT_BYTES) && pooledBrowsers.size > 0) {
      const idle = [...pooledBrowsers.entries()].filter(
        ([, entry]) => !entry.closing && entry.activePages === 0
      );
      const inUse = [...pooledBrowsers.values()].filter(
        (entry) => !entry.closing && entry.activePages > 0
      ).length;
      if (idle.length > 0) {
        logger.log(
          'warn',
          `Process RSS ${Math.round(rss / 1048576)}MiB >= pool limit ${Math.round(RSS_LIMIT_BYTES / 1048576)}MiB — retiring ${idle.length} idle pooled browser(s)${inUse ? ` (deferring ${inUse} in-use)` : ''}`
        );
        for (const [key, entry] of idle) {
          await retireEntry(key, entry, `rss-limit rss=${rss}`);
        }
      } else if (inUse > 0) {
        logger.log(
          'warn',
          `Process RSS ${Math.round(rss / 1048576)}MiB >= pool limit ${Math.round(RSS_LIMIT_BYTES / 1048576)}MiB — deferring retire for ${inUse} in-use browser(s)`
        );
      }
    }

    for (const [key, entry] of pooledBrowsers.entries()) {
      if (entry.closing) continue;

      const heldMs = now - (entry.acquiredAt || entry.lastUsedAt);
      const stuckInUse = entry.activePages > 0 && heldMs > STALE_IN_USE_MS;
      const idleExpired =
        entry.activePages === 0 &&
        IDLE_BROWSER_TTL_MS >= 0 &&
        now - entry.lastUsedAt >= IDLE_BROWSER_TTL_MS;
      const ageExpired =
        entry.activePages === 0 &&
        shouldRetirePooledBrowser({
          jobsServed: entry.jobsServed,
          createdAt: entry.createdAt,
          now,
          maxJobs: MAX_JOBS,
          maxAgeMs: MAX_AGE_MS,
        });

      if (!stuckInUse && !idleExpired && !ageExpired) continue;

      if (stuckInUse) {
        logger.log(
          'warn',
          `Force-evicting stuck pooled browser ${key} (activePages=${entry.activePages}, held ${Math.round(heldMs / 1000)}s > ${Math.round(STALE_IN_USE_MS / 1000)}s)`
        );
      }

      await retireEntry(
        key,
        entry,
        stuckInUse ? 'stuck-in-use' : ageExpired ? 'max-age-or-jobs' : 'idle-ttl'
      );
    }

    if (pooledBrowsers.size === 0) {
      await killUntrackedPlaywrightChromium().catch(() => {});
    }
  }, CLEANUP_INTERVAL_MS);
  if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();
};

async function getOrCreateBrowser(options: AcquirePooledPageOptions): Promise<PooledBrowserEntry> {
  ensureCleanupLoop();
  const key = buildPoolKey(options.profile);
  const maxPages = options.maxPagesPerBrowser || getDefaultMaxPagesPerBrowser();

  if (!isLowMemoryMode()) {
    const existing = pooledBrowsers.get(key);
    if (existing && !existing.closing && existing.activePages < existing.maxPages) {
      const rss = process.memoryUsage().rss;
      if (shouldRetirePoolForRss(rss, RSS_LIMIT_BYTES)) {
        logger.log(
          'warn',
          `Process RSS ${Math.round(rss / 1048576)}MiB >= pool limit before reuse — retiring idle pooled browsers`
        );
        for (const [k, e] of [...pooledBrowsers.entries()]) {
          if (e.closing || e.activePages > 0) continue;
          await retireEntry(k, e, `rss-limit-before-reuse rss=${rss}`);
        }
        // Prefer reusing an in-use browser over spawning another Chromium under pressure.
        const still = pooledBrowsers.get(key);
        if (still && !still.closing && still.activePages < still.maxPages) {
          still.lastUsedAt = Date.now();
          return still;
        }
      } else if (
        shouldRetirePooledBrowser({
          jobsServed: existing.jobsServed,
          createdAt: existing.createdAt,
          maxJobs: MAX_JOBS,
          maxAgeMs: MAX_AGE_MS,
        })
      ) {
        await retireEntry(
          key,
          existing,
          `cap jobsServed=${existing.jobsServed} ageMs=${Date.now() - existing.createdAt}`
        );
      } else {
        existing.lastUsedAt = Date.now();
        return existing;
      }
    }
  }

  const browser = await connectToRemoteBrowser(undefined, options.profile);
  registerBrowserPid(browser);
  const now = Date.now();
  const created: PooledBrowserEntry = {
    key,
    browser,
    activePages: 0,
    maxPages,
    lastUsedAt: now,
    acquiredAt: now,
    createdAt: now,
    jobsServed: 0,
    closing: false,
  };
  pooledBrowsers.set(key, created);
  logger.log('info', `Created pooled browser ${key} with max ${maxPages} pages`);
  return created;
}

export async function acquirePooledPage(options: AcquirePooledPageOptions = {}): Promise<PooledPageLease> {
  const chromiumSlot = await claimChromiumSlot({
    kind: options.chromiumSlotKind || getChromiumSlotProcessKind(),
    runId: options.chromiumSlotRunId,
  });

  let entry: PooledBrowserEntry;
  try {
    entry = await getOrCreateBrowser(options);
  } catch (error) {
    await releaseChromiumSlot(chromiumSlot).catch(() => {});
    throw error;
  }

  entry.activePages += 1;
  entry.lastUsedAt = Date.now();
  entry.acquiredAt = Date.now();

  try {
    const locale = options.profile?.locale || 'en-US';
    const viewport = isLowMemoryMode()
      ? { width: 1280, height: 720 }
      : { width: 1366, height: 900 };
    const context = await entry.browser.newContext({
      userAgent: options.profile?.userAgent,
      locale,
      viewport,
      extraHTTPHeaders: {
        'Accept-Language': `${locale},${locale.split('-')[0]};q=0.9`,
      },
      storageState: options.profile?.storageStatePath || undefined,
    });

    if (options.profile?.useStealth !== false) {
      await applyStealthOverrides(context, options.profile?.userAgent);
    }

    if (options.blockResources !== false) {
      await context.route('**/*', async (route) => {
        const request = route.request();
        if (shouldBlockRequest(request.url(), request.resourceType())) {
          await route.abort();
          return;
        }
        await route.continue();
      });
    }

    const page = await context.newPage();
    entry.jobsServed += 1;
    return {
      key: entry.key,
      browser: entry.browser,
      context,
      page,
      chromiumSlot,
    };
  } catch (error) {
    entry.activePages = Math.max(0, entry.activePages - 1);
    entry.lastUsedAt = Date.now();
    // Sick browser after create/context failure — evict the whole process.
    await evictBrowserFromPool(entry.key).catch(() => {});
    await releaseChromiumSlot(chromiumSlot).catch(() => {});
    throw error;
  }
}

export async function releasePooledPage(lease: PooledPageLease | null | undefined): Promise<void> {
  if (!lease) return;
  try {
    try {
      if (!lease.page.isClosed()) {
        lease.page.removeAllListeners();
        await lease.page.close({ runBeforeUnload: false }).catch(() => {});
      }
    } catch {
      /* page already dead */
    }
  } finally {
    await lease.context.close().catch(() => {});
    const entry = pooledBrowsers.get(lease.key);
    if (entry) {
      entry.activePages = Math.max(0, entry.activePages - 1);
      entry.lastUsedAt = Date.now();
      if (entry.activePages === 0 && (isLowMemoryMode() || IDLE_BROWSER_TTL_MS === 0)) {
        await evictBrowserFromPool(lease.key);
      } else if (
        entry.activePages === 0 &&
        (shouldRetirePoolForRss(process.memoryUsage().rss, RSS_LIMIT_BYTES) ||
          shouldRetirePooledBrowser({
            jobsServed: entry.jobsServed,
            createdAt: entry.createdAt,
            maxJobs: MAX_JOBS,
            maxAgeMs: MAX_AGE_MS,
          }))
      ) {
        await evictBrowserFromPool(lease.key);
      }
    }
    await releaseChromiumSlot(lease.chromiumSlot).catch(() => {});
  }
}

export async function evictBrowserFromPool(key: string): Promise<void> {
  const entry = pooledBrowsers.get(key);
  if (!entry) return;
  entry.closing = true;
  try {
    await forceCloseBrowser(entry.browser, `evict:${key}`);
  } finally {
    pooledBrowsers.delete(key);
  }
}

export async function closeBrowserReusePool(): Promise<void> {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  const keys = [...pooledBrowsers.keys()];
  for (const key of keys) {
    const entry = pooledBrowsers.get(key);
    if (!entry) continue;
    entry.closing = true;
    try {
      await forceCloseBrowser(entry.browser, `shutdown:${key}`);
    } finally {
      pooledBrowsers.delete(key);
    }
  }
  pooledBrowsers.clear();
  await killUntrackedPlaywrightChromium().catch(() => {});
}

export function getPooledBrowserCount(): number {
  return pooledBrowsers.size;
}

export { shouldRetirePooledBrowser };

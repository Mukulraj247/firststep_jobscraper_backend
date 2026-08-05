import type { Browser, BrowserContext, Page } from 'playwright-core';
import logger from '../logger';
import { BrowserLaunchProfile, connectToRemoteBrowser } from '../browser-management/browserConnection';
import { applyStealthOverrides } from './unblocker';
import {
  getBrowserPoolIdleTtlMs,
  getDefaultMaxPagesPerBrowser,
  isLowMemoryMode,
} from '../utils/memoryMode';

interface PooledBrowserEntry {
  key: string;
  browser: Browser;
  activePages: number;
  maxPages: number;
  lastUsedAt: number;
  closing: boolean;
}

interface PooledPageLease {
  key: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
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
}

const pooledBrowsers = new Map<string, PooledBrowserEntry>();
const IDLE_BROWSER_TTL_MS = getBrowserPoolIdleTtlMs();
const CLEANUP_INTERVAL_MS = parseInt(process.env.BROWSER_POOL_CLEANUP_INTERVAL_MS || '15000', 10);

let cleanupTimer: NodeJS.Timeout | null = null;

const adAndAnalyticsPatterns = [
  'doubleclick.net',
  'googletagmanager.com',
  'google-analytics.com',
  'adservice.google.com',
  'analytics',
  'segment.io',
  'facebook.net',
  'hotjar.com',
  'intercom.io',
];

const buildPoolKey = (profile?: AcquirePooledPageOptions['profile']) =>
  JSON.stringify({
    browserType: profile?.browserType || 'playwright',
    headless: profile?.headless ?? true,
    useStealth: profile?.useStealth ?? true,
    proxyServer: profile?.proxy?.server || '',
    proxyUsername: profile?.proxy?.username || '',
    isolationKey: profile?.poolIsolationKey || '',
  });

const shouldBlockRequest = (url: string, resourceType: string) => {
  if (resourceType === 'image' || resourceType === 'font' || resourceType === 'media') {
    return true;
  }
  // Extra cut on constrained hosts: stylesheets are large and rarely needed for
  // CSS-selector list extraction (text/href still resolve without CSS).
  if (isLowMemoryMode() && resourceType === 'stylesheet') {
    return true;
  }
  return adAndAnalyticsPatterns.some((pattern) => url.includes(pattern));
};

const ensureCleanupLoop = () => {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(async () => {
    const now = Date.now();
    for (const [key, entry] of pooledBrowsers.entries()) {
      if (entry.closing || entry.activePages > 0) {
        continue;
      }
      if (now - entry.lastUsedAt < IDLE_BROWSER_TTL_MS) {
        continue;
      }
      entry.closing = true;
      try {
        await entry.browser.close();
      } catch (error: any) {
        logger.log('warn', `Failed to close idle pooled browser ${key}: ${error.message}`);
      } finally {
        pooledBrowsers.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);
};

async function getOrCreateBrowser(options: AcquirePooledPageOptions): Promise<PooledBrowserEntry> {
  ensureCleanupLoop();
  const key = buildPoolKey(options.profile);
  const maxPages = options.maxPagesPerBrowser || getDefaultMaxPagesPerBrowser();

  // Low-memory: never reuse a Chromium process across jobs — reuse often leaves
  // renderer RSS elevated and can briefly stack two browsers during fallbacks.
  if (!isLowMemoryMode()) {
    const existing = pooledBrowsers.get(key);
    if (existing && !existing.closing && existing.activePages < existing.maxPages) {
      existing.lastUsedAt = Date.now();
      return existing;
    }
  }

  const browser = await connectToRemoteBrowser(undefined, options.profile);
  const created: PooledBrowserEntry = {
    key,
    browser,
    activePages: 0,
    maxPages,
    lastUsedAt: Date.now(),
    closing: false,
  };
  pooledBrowsers.set(key, created);
  logger.log('info', `Created pooled browser ${key} with max ${maxPages} pages`);
  return created;
}

export async function acquirePooledPage(options: AcquirePooledPageOptions = {}): Promise<PooledPageLease> {
  const entry = await getOrCreateBrowser(options);
  entry.activePages += 1;
  entry.lastUsedAt = Date.now();

  try {
    const locale = options.profile?.locale || 'en-US';
    const viewport = isLowMemoryMode()
      ? { width: 1280, height: 720 }
      : { width: 1366, height: 900 };
    const context = await entry.browser.newContext({
      userAgent: options.profile?.userAgent,
      locale,
      viewport,
      // Accept-Language aligned with locale — Amazon Jobs, LinkedIn and
      // similar bot-filters look for the mismatch between navigator.language
      // (set via stealth) and the HTTP Accept-Language header.
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
    return {
      key: entry.key,
      browser: entry.browser,
      context,
      page,
    };
  } catch (error) {
    entry.activePages = Math.max(0, entry.activePages - 1);
    entry.lastUsedAt = Date.now();
    throw error;
  }
}

export async function releasePooledPage(lease: PooledPageLease | null | undefined): Promise<void> {
  if (!lease) return;
  try {
    if (!lease.page.isClosed()) {
      lease.page.removeAllListeners();
      await lease.page.close({ runBeforeUnload: false }).catch(() => {});
    }
  } finally {
    await lease.context.close().catch(() => {});
    const entry = pooledBrowsers.get(lease.key);
    if (entry) {
      entry.activePages = Math.max(0, entry.activePages - 1);
      entry.lastUsedAt = Date.now();
      // Free Chromium immediately when idle TTL is 0 or low-memory mode is on.
      if (entry.activePages === 0 && (isLowMemoryMode() || IDLE_BROWSER_TTL_MS === 0)) {
        await evictBrowserFromPool(lease.key);
      }
    }
  }
}

export async function evictBrowserFromPool(key: string): Promise<void> {
  const entry = pooledBrowsers.get(key);
  if (!entry) return;
  entry.closing = true;
  try {
    await entry.browser.close();
  } catch (error: any) {
    logger.log('warn', `Failed to evict pooled browser ${key}: ${error.message}`);
  } finally {
    pooledBrowsers.delete(key);
  }
}

export async function closeBrowserReusePool(): Promise<void> {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
  for (const [key, entry] of pooledBrowsers.entries()) {
    try {
      await entry.browser.close();
    } catch (error: any) {
      logger.log('warn', `Failed to close pooled browser ${key}: ${error.message}`);
    }
  }
  pooledBrowsers.clear();
}

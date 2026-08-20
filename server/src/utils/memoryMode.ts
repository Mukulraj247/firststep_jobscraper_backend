/**
 * Deploy-time memory profile for constrained hosts (e.g. Render free 512MB).
 *
 * Chromium lives outside the V8 heap, so both Node and the browser share the
 * same container RAM. On a 512MB box, Node must stay small (~192MB) and
 * Chromium must be launched lean, used once, and closed immediately.
 */
export const isLowMemoryMode = (): boolean =>
  process.env.LOW_MEMORY_MODE === 'true' ||
  process.env.RENDER_FREE_TIER === 'true';

export const getDefaultMaxPagesPerBrowser = (): number => {
  const fromEnv = parseInt(process.env.BROWSER_POOL_MAX_PAGES || '', 10);
  if (!Number.isNaN(fromEnv) && fromEnv > 0) return fromEnv;
  return isLowMemoryMode() ? 1 : 3;
};

export const getBrowserPoolIdleTtlMs = (): number => {
  const fromEnv = parseInt(process.env.BROWSER_POOL_IDLE_TTL_MS || '', 10);
  if (!Number.isNaN(fromEnv) && fromEnv >= 0) return fromEnv;
  // Close idle Chromium ASAP on constrained hosts — reuse savings are not worth
  // holding 200MB+ after the scrape finishes.
  return isLowMemoryMode() ? 0 : 90_000;
};

/** Max page leases a pooled browser may serve before forced recycle (default 20; low-mem 1). */
export const getBrowserPoolMaxJobs = (): number => {
  const fromEnv = parseInt(process.env.BROWSER_POOL_MAX_JOBS || '', 10);
  if (!Number.isNaN(fromEnv) && fromEnv > 0) return fromEnv;
  return isLowMemoryMode() ? 1 : 20;
};

/** Max wall-clock age of a pooled browser before recycle (default 15m; low-mem 5m). */
export const getBrowserPoolMaxAgeMs = (): number => {
  const fromEnv = parseInt(process.env.BROWSER_POOL_MAX_AGE_MS || '', 10);
  if (!Number.isNaN(fromEnv) && fromEnv >= 0) return fromEnv;
  return isLowMemoryMode() ? 5 * 60_000 : 15 * 60_000;
};

/** Pure helper: retire when jobs or age ceiling hit. */
export function shouldRetirePooledBrowser(opts: {
  jobsServed: number;
  createdAt: number;
  now?: number;
  maxJobs: number;
  maxAgeMs: number;
}): boolean {
  const now = opts.now ?? Date.now();
  if (opts.maxJobs > 0 && opts.jobsServed >= opts.maxJobs) return true;
  if (opts.maxAgeMs > 0 && now - opts.createdAt >= opts.maxAgeMs) return true;
  return false;
}

/**
 * RSS ceiling that triggers retiring idle pooled browsers.
 * Default ≈ 3 GiB so local workers with `--max-old-space-size=2048` are not
 * forced to kill Chromium mid-scrape; low-memory hosts stay tighter (~400 MiB).
 */
export function getBrowserPoolRssLimitBytes(): number {
  const fromEnv = parseInt(process.env.BROWSER_POOL_RSS_LIMIT_BYTES || '', 10);
  if (!Number.isNaN(fromEnv) && fromEnv > 0) return fromEnv;
  return isLowMemoryMode() ? 419_430_400 : 3_221_225_472;
}

/** Pure helper: process RSS at/over limit → recycle the whole pool. */
export function shouldRetirePoolForRss(rssBytes: number, limitBytes?: number): boolean {
  const limit = limitBytes ?? getBrowserPoolRssLimitBytes();
  return limit > 0 && rssBytes >= limit;
}

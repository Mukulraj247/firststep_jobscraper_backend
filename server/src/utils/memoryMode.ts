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

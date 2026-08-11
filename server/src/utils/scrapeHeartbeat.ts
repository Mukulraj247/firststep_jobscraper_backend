/**
 * Lean scrape lease heartbeat: workers stamp run.heartbeatAt while a job is live;
 * orphan recovery reclaims only stale leases.
 */

export function getScrapeHeartbeatMs(): number {
  const fromEnv = parseInt(process.env.SCRAPE_HEARTBEAT_MS || '', 10);
  if (!Number.isNaN(fromEnv) && fromEnv > 0) return fromEnv;
  return 30_000;
}

export function getScrapeHeartbeatStaleMs(): number {
  const fromEnv = parseInt(process.env.SCRAPE_HEARTBEAT_STALE_MS || '', 10);
  if (!Number.isNaN(fromEnv) && fromEnv > 0) return fromEnv;
  return 120_000;
}

/** True when a running run's lease should be treated as orphaned. */
export function isRunningLeaseStale(opts: {
  heartbeatAt?: string | null;
  startedAt?: string | null;
  now?: number;
  staleMs?: number;
}): boolean {
  const now = opts.now ?? Date.now();
  const staleMs = opts.staleMs ?? getScrapeHeartbeatStaleMs();
  const beatMs = opts.heartbeatAt ? Date.parse(opts.heartbeatAt) : NaN;
  if (!Number.isNaN(beatMs)) {
    return now - beatMs >= staleMs;
  }
  const startedMs = opts.startedAt ? Date.parse(opts.startedAt) : NaN;
  if (!Number.isNaN(startedMs)) {
    return now - startedMs >= staleMs;
  }
  // No timestamps — treat as stale so crash orphans without startedAt still reclaim.
  return true;
}

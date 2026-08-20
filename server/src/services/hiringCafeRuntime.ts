/**
 * Runtime knobs for Hiring Cafe aggregator jobs (timeouts, detail scrape budget).
 */

const DEFAULT_AGGREGATOR_TIMEOUT_MS = 600_000;
const DEFAULT_LIST_BASE_MS = 120_000;
const DEFAULT_PER_JOB_MS = 8_000;

export const HIRING_CAFE_DETAIL_GOTO_MS = parseInt(
  process.env.HIRING_CAFE_DETAIL_GOTO_MS || '25000',
  10
);
export const HIRING_CAFE_DETAIL_BETWEEN_MS = parseInt(
  process.env.HIRING_CAFE_DETAIL_BETWEEN_MS || '600',
  10
);
export const HIRING_CAFE_DETAIL_RENDER_MS = parseInt(
  process.env.HIRING_CAFE_DETAIL_RENDER_MS || '8000',
  10
);

/** Estimated wall time for list page + N detail page visits. */
export function computeAggregatorExecutionTimeoutMs(maxJobs: number): number {
  const fromEnv = parseInt(process.env.AGGREGATOR_JOB_TIMEOUT_MS || '', 10);
  if (!Number.isNaN(fromEnv) && fromEnv > 0) return fromEnv;

  const listBase = parseInt(process.env.AGGREGATOR_LIST_BASE_MS || String(DEFAULT_LIST_BASE_MS), 10);
  const perJob = parseInt(process.env.HIRING_CAFE_DETAIL_PER_JOB_MS || String(DEFAULT_PER_JOB_MS), 10);
  const jobs = Math.max(1, Math.min(maxJobs || 40, 80));
  return listBase + jobs * perJob;
}

export function resolveExecutionTimeoutMs(
  isAggregator: boolean,
  maxJobs?: number
): number {
  if (!isAggregator) {
    return parseInt(process.env.SCRAPER_JOB_TIMEOUT_MS || '120000', 10);
  }
  return computeAggregatorExecutionTimeoutMs(maxJobs || 40);
}

export function defaultAggregatorTimeoutMs(): number {
  return parseInt(process.env.AGGREGATOR_JOB_TIMEOUT_MS || String(DEFAULT_AGGREGATOR_TIMEOUT_MS), 10);
}

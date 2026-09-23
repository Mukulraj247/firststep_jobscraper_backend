/**
 * Cluster-scoped home analytics — optimized for many concurrent users.
 *
 * Design:
 * - Never hydrate full job documents for charts/KPIs.
 * - One Mongo `$facet` aggregation per cluster (time buckets + top companies/roles).
 * - Shared in-memory TTL cache keyed by clusterId + range + granularity so every
 *   subscriber of the same cluster reuses the same rollup (near O(clusters), not O(users)).
 */
import JobBoardListing from '../models/JobBoardListing';
import type { ICluster } from '../models/Cluster';
import type { PipelineStage } from 'mongoose';
import { applyJobBoardListFilters } from './jobBoardQuery';
import { clusterToJobQuery } from './clusterFeed';
import { getPortalJobBoardOwnerId } from './portalOwner';
import logger from '../logger';

export type AnalyticsGranularity = 'hour' | 'day' | 'week';

export type AnalyticsBucketRow = { label: string; count: number };

export type ClusterAnalyticsSlice = {
  clusterId: string;
  buckets: Record<string, number>;
  companies: AnalyticsBucketRow[];
  categories: AnalyticsBucketRow[];
  sampleSize: number;
};

const ANALYTICS_CACHE_TTL_MS = 60_000;
const ANALYTICS_CACHE_MAX = 2_000;

type CacheEntry = { expiresAt: number; body: ClusterAnalyticsSlice };
const analyticsCache = new Map<string, CacheEntry>();

export function clearClusterAnalyticsCache(): void {
  analyticsCache.clear();
}

function roundHour(ms: number): number {
  return Math.floor(ms / 3_600_000) * 3_600_000;
}

function cacheKey(
  clusterId: string,
  startMs: number,
  endMs: number,
  granularity: AnalyticsGranularity
): string {
  // Round window ends so concurrent users share keys despite "now" drift.
  return `${clusterId}|${roundHour(startMs)}|${roundHour(endMs)}|${granularity}`;
}

function dateFormatForGranularity(granularity: AnalyticsGranularity): string {
  if (granularity === 'hour') return '%Y-%m-%dT%H';
  if (granularity === 'week') return '%G-W%V'; // ISO week — remapped below to Monday date key
  return '%Y-%m-%d';
}

/** Convert ISO week key (2026-W12) → Monday UTC day key used by the chart. */
function isoWeekToMondayKey(isoWeekKey: string): string | null {
  const m = isoWeekKey.match(/^(\d{4})-W(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  // ISO week: week 1 contains Jan 4; Monday is day 1.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const mondayWeek1 = new Date(jan4);
  mondayWeek1.setUTCDate(jan4.getUTCDate() - day + 1);
  const monday = new Date(mondayWeek1);
  monday.setUTCDate(mondayWeek1.getUTCDate() + (week - 1) * 7);
  const y = monday.getUTCFullYear();
  const mo = String(monday.getUTCMonth() + 1).padStart(2, '0');
  const d = String(monday.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

function topNFromAgg(
  rows: Array<{ _id: string | null; count: number }>,
  n: number
): AnalyticsBucketRow[] {
  return rows
    .map((r) => ({ label: String(r._id || '').trim(), count: r.count || 0 }))
    .filter((r) => r.label && r.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, n);
}

/**
 * Aggregate one published cluster for a time window. Cached across users.
 */
export async function getClusterAnalyticsSlice(opts: {
  cluster: Pick<ICluster, '_id' | 'name' | 'filter' | 'sourceBinding'> & { id?: string };
  startMs: number;
  endMs: number;
  granularity: AnalyticsGranularity;
  ownerId?: string;
}): Promise<ClusterAnalyticsSlice> {
  const clusterId = String((opts.cluster as any).id || opts.cluster._id);
  const key = cacheKey(clusterId, opts.startMs, opts.endMs, opts.granularity);
  const hit = analyticsCache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.body;
  }

  const ownerId = opts.ownerId || getPortalJobBoardOwnerId();
  let match = clusterToJobQuery(opts.cluster, ownerId);
  match = applyJobBoardListFilters(match, {
    lastSeenSince: new Date(opts.startMs),
  });
  // Cap upper bound so the range is selective (helps index use).
  match.lastSeenAt = {
    ...(match.lastSeenAt || {}),
    $gte: new Date(opts.startMs),
    $lte: new Date(opts.endMs),
  };

  const fmt = dateFormatForGranularity(opts.granularity);

  const pipeline: PipelineStage[] = [
    { $match: match },
    {
      $facet: {
        timeline: [
          {
            $group: {
              _id: {
                $dateToString: {
                  format: fmt,
                  date: '$lastSeenAt',
                  timezone: 'UTC',
                },
              },
              count: { $sum: 1 },
            },
          },
        ],
        companies: [
          {
            $group: {
              _id: {
                $cond: [
                  {
                    $and: [
                      { $ne: ['$companyResolvedName', null] },
                      { $ne: ['$companyResolvedName', ''] },
                    ],
                  },
                  '$companyResolvedName',
                  '$companyName',
                ],
              },
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
          { $limit: 8 },
        ],
        categories: [
          {
            $group: {
              _id: {
                $cond: [
                  {
                    $and: [{ $ne: ['$jobCategory', null] }, { $ne: ['$jobCategory', ''] }],
                  },
                  '$jobCategory',
                  '$sectorIndustry',
                ],
              },
              count: { $sum: 1 },
            },
          },
          { $sort: { count: -1 } },
          { $limit: 8 },
        ],
        meta: [{ $count: 'sampleSize' }],
      },
    },
  ];

  let facet: any = {
    timeline: [],
    companies: [],
    categories: [],
    meta: [],
  };

  try {
    const rows = await JobBoardListing.aggregate(pipeline).allowDiskUse(true);
    facet = rows[0] || facet;
  } catch (err: any) {
    logger.log('warn', `cluster analytics aggregate failed: ${err?.message || err}`);
    throw err;
  }

  const buckets: Record<string, number> = {};
  for (const row of facet.timeline || []) {
    let keyStr = String(row._id || '');
    if (opts.granularity === 'week') {
      keyStr = isoWeekToMondayKey(keyStr) || keyStr;
    }
    if (!keyStr) continue;
    buckets[keyStr] = (buckets[keyStr] || 0) + (row.count || 0);
  }

  const body: ClusterAnalyticsSlice = {
    clusterId,
    buckets,
    companies: topNFromAgg(facet.companies || [], 5),
    categories: topNFromAgg(facet.categories || [], 5),
    sampleSize: Number(facet.meta?.[0]?.sampleSize || 0),
  };

  analyticsCache.set(key, { expiresAt: Date.now() + ANALYTICS_CACHE_TTL_MS, body });
  if (analyticsCache.size > ANALYTICS_CACHE_MAX) {
    const first = analyticsCache.keys().next().value;
    if (first) analyticsCache.delete(first);
  }

  return body;
}

export function mergeCompanyCategoryCounts(
  slices: ClusterAnalyticsSlice[],
  n = 5
): { companies: AnalyticsBucketRow[]; categories: AnalyticsBucketRow[]; sampleSize: number } {
  const companies = new Map<string, number>();
  const categories = new Map<string, number>();
  let sampleSize = 0;
  for (const s of slices) {
    sampleSize += s.sampleSize;
    for (const c of s.companies) {
      companies.set(c.label, (companies.get(c.label) || 0) + c.count);
    }
    for (const c of s.categories) {
      categories.set(c.label, (categories.get(c.label) || 0) + c.count);
    }
  }
  const toRows = (map: Map<string, number>) =>
    [...map.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, n);
  return {
    companies: toRows(companies),
    categories: toRows(categories),
    sampleSize,
  };
}

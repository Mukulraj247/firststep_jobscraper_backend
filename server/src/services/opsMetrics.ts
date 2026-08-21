/**
 * Windowed ops metrics for the Scout-X admin Dashboard (session user).
 */
import Run from '../models/Run';
import Robot from '../models/Robot';
import { SCRAPER_JOB_CONCURRENCY } from '../queue/scraperQueue';
import { ownerIdFilter, normalizeOwnerIdForWrite } from '../utils/ownerId';
import {
  endOfIstDay,
  floorToIstUnit,
  formatIstYmd,
  startOfIstDay,
} from '../../../src/shared/opsTimezone';
import { getJobCategoryDashboardTags } from '../constants/tagCatalog';
import {
  buildOwnerRunFilter,
  buildOwnerRunWindowMatch,
  createDashboardSummaryCache,
} from './dashboardQueries';
import {
  isDigitalOceanConfigured,
  peekDigitalOceanDashboardCache,
  type DigitalOceanDashboard,
  type MetricsWindow,
} from './digitalOceanMetrics';
import { computeUpcomingScheduleMetrics } from './upcomingScheduleMetrics';

export type OpsMetricsWindow = '15m' | '30m' | '1h' | '3h' | '6h' | '24h';

const WINDOW_MS: Record<OpsMetricsWindow, number> = {
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '3h': 3 * 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export type OpsMetricsBounds = {
  isCalendarDay: boolean;
  sinceMs: number;
  untilMs: number;
  windowMs: number;
  bucketStarts: number[];
};

export function parseOpsMetricsWindow(raw: unknown): OpsMetricsWindow {
  const v = String(raw || '1h').trim().toLowerCase();
  if (v === '15m' || v === '30m' || v === '1h' || v === '3h' || v === '6h' || v === '24h') {
    return v;
  }
  return '1h';
}

export function parseOpsMetricsDate(raw: unknown): string | null {
  const v = String(raw || '').trim();
  if (!YMD_RE.test(v)) return null;
  try {
    startOfIstDay(v);
    return v;
  } catch {
    return null;
  }
}

export function doWindowForOps(window: OpsMetricsWindow, isCalendarDay: boolean): MetricsWindow {
  if (isCalendarDay) return '24h';
  if (window === '15m' || window === '30m' || window === '1h') return '1h';
  if (window === '3h' || window === '6h') return '6h';
  return '24h';
}

function bucketCount(window: OpsMetricsWindow): number {
  switch (window) {
    case '15m':
      return 5;
    case '30m':
      return 6;
    case '1h':
      return 6;
    case '3h':
      return 6;
    case '6h':
      return 6;
    case '24h':
      return 8;
    default:
      return 6;
  }
}

function alignUnitMs(window: OpsMetricsWindow): number {
  switch (window) {
    case '15m':
      return 3 * 60 * 1000;
    case '30m':
      return 5 * 60 * 1000;
    case '1h':
      return 10 * 60 * 1000;
    case '3h':
      return 30 * 60 * 1000;
    case '6h':
      return 60 * 60 * 1000;
    case '24h':
      return 3 * 60 * 60 * 1000;
    default:
      return 60 * 60 * 1000;
  }
}

export function resolveOpsMetricsBounds(opts: {
  window: OpsMetricsWindow;
  date?: string | null;
  nowMs?: number;
}): OpsMetricsBounds {
  const nowMs = opts.nowMs ?? Date.now();
  const date = opts.date ? parseOpsMetricsDate(opts.date) : null;
  // Today (IST) uses the rolling window so last N hours may cross midnight.
  // Only past/future calendar days use a full midnight–midnight IST day.
  const useCalendarDay = Boolean(date && date !== formatIstYmd(nowMs));
  if (useCalendarDay && date) {
    const sinceMs = startOfIstDay(date).getTime();
    const untilMs = endOfIstDay(date).getTime();
    const bucketMs = 3 * 60 * 60 * 1000;
    return {
      isCalendarDay: true,
      sinceMs,
      untilMs,
      windowMs: untilMs - sinceMs + 1,
      bucketStarts: Array.from({ length: 8 }, (_, i) => sinceMs + i * bucketMs),
    };
  }

  const unit = alignUnitMs(opts.window);
  const count = bucketCount(opts.window);
  const lastStart = floorToIstUnit(nowMs, unit);
  const sinceMs = lastStart - (count - 1) * unit;
  return {
    isCalendarDay: false,
    sinceMs,
    untilMs: nowMs,
    windowMs: WINDOW_MS[opts.window],
    bucketStarts: Array.from({ length: count }, (_, i) => sinceMs + i * unit),
  };
}

function bucketIndexFor(ts: number, bucketStarts: number[], untilMs: number): number {
  for (let i = 0; i < bucketStarts.length; i += 1) {
    const next = i + 1 < bucketStarts.length ? bucketStarts[i + 1] : untilMs + 1;
    if (ts >= bucketStarts[i] && ts < next) return i;
  }
  return -1;
}

function isSuccessStatus(status: string): boolean {
  const s = String(status || '').toLowerCase();
  return s === 'success' || s === 'completed';
}

function isFailedStatus(status: string): boolean {
  const s = String(status || '').toLowerCase();
  return s === 'failed' || s === 'dead' || s === 'aborted';
}

export function opsMetricsCacheKey(
  userId: unknown,
  window: OpsMetricsWindow,
  date?: string | null,
): string {
  const ownerId = normalizeOwnerIdForWrite(userId) || 'none';
  return `ops:${ownerId}:${window}:${date || ''}`;
}

export function resolveDigitalOceanForOpsMetrics(
  cached: DigitalOceanDashboard | undefined,
  configured: boolean,
): DigitalOceanDashboard {
  if (cached) return cached;
  return {
    configured,
    generatedAt: new Date().toISOString(),
    pending: true,
    droplets: [],
  };
}

export type OpsMetricsTagDefinition = {
  tag: string;
  label: string;
  namespace: string;
  namespaceLabel: string;
};

export function rollupOpsMetricsFromRuns(opts: {
  runs: any[];
  bounds: OpsMetricsBounds;
  tagsByMeta: Map<string, string[]>;
  catalog: OpsMetricsTagDefinition[];
}) {
  const inWindow = (opts.runs as any[]).filter((r) => {
    const ts = runTimestampMs(r);
    return ts != null && ts >= opts.bounds.sinceMs && ts <= opts.bounds.untilMs;
  });

  let passed = 0;
  let failed = 0;
  let running = 0;
  let rowsExtracted = 0;
  let jobsAddedToBoard = 0;
  const series = opts.bounds.bucketStarts.map((start) => ({
    t: start,
    label: new Date(start).toISOString(),
    total: 0,
    passed: 0,
    failed: 0,
    jobsAdded: 0,
  }));
  const tagTotals = new Map<string, { jobsAdded: number; runs: number }>();

  for (const r of inWindow) {
    const status = String(r.status || '');
    const jobs = typeof r.jobsAddedToBoard === 'number' ? r.jobsAddedToBoard : 0;
    if (isSuccessStatus(status)) passed += 1;
    else if (isFailedStatus(status)) failed += 1;
    else if (activeStatuses.includes(status.toLowerCase())) running += 1;
    rowsExtracted += typeof r.rowsExtracted === 'number' ? r.rowsExtracted : 0;
    jobsAddedToBoard += jobs;

    const ts = runTimestampMs(r);
    if (ts != null) {
      const idx = bucketIndexFor(ts, opts.bounds.bucketStarts, opts.bounds.untilMs);
      if (idx >= 0) {
        const bucket = series[idx];
        bucket.total += 1;
        if (isSuccessStatus(status)) bucket.passed += 1;
        else if (isFailedStatus(status)) bucket.failed += 1;
        bucket.jobsAdded += jobs;
      }
    }

    const tags = opts.tagsByMeta.get(String(r.robotMetaId)) || [];
    for (const tag of tags) {
      const current = tagTotals.get(tag) || { jobsAdded: 0, runs: 0 };
      current.runs += 1;
      current.jobsAdded += jobs;
      tagTotals.set(tag, current);
    }
  }

  return {
    inWindow,
    totals: {
      runs: inWindow.length,
      passed,
      failed,
      running,
      rowsExtracted,
      jobsAddedToBoard,
    },
    series,
    tags: opts.catalog.map((definition) => {
      const totals = tagTotals.get(definition.tag);
      return {
        tag: definition.tag,
        label: definition.label,
        namespace: definition.namespace,
        namespaceLabel: definition.namespaceLabel,
        jobsAdded: totals?.jobsAdded ?? 0,
        runs: totals?.runs ?? 0,
      };
    }),
  };
}

const activeStatuses = ['running', 'pending', 'queued'];
const opsMetricsResponseCache = createDashboardSummaryCache<any>();

function runTimestampMs(run: any): number | null {
  if (run?.sortAt) {
    const ms = new Date(run.sortAt).getTime();
    if (!Number.isNaN(ms)) return ms;
  }
  const candidates = [run?.finishedAt, run?.startedAt]
    .map((v) => {
      if (!v) return null;
      const ms = Date.parse(String(v));
      return Number.isNaN(ms) ? new Date(String(v)).getTime() : ms;
    })
    .filter((n): n is number => n != null && !Number.isNaN(n));
  return candidates.length ? Math.max(...candidates) : null;
}

export async function buildOpsMetrics(opts: {
  userId: string | number;
  window: OpsMetricsWindow;
  date?: string | null;
  fresh?: boolean;
}) {
  const cacheKey = opsMetricsCacheKey(opts.userId, opts.window, opts.date);
  if (!opts.fresh) {
    const cached = opsMetricsResponseCache.get(cacheKey);
    if (cached) return cached;
  }

  const now = Date.now();
  const bounds = resolveOpsMetricsBounds({
    window: opts.window,
    date: opts.date,
    nowMs: now,
  });
  const since = new Date(bounds.sinceMs);
  const until = new Date(bounds.untilMs);
  const sinceIso = since.toISOString();
  const ownerId = normalizeOwnerIdForWrite(opts.userId);
  const runMatch = buildOwnerRunWindowMatch(opts.userId, since, until);
  const doWindow = doWindowForOps(opts.window, bounds.isCalendarDay);

  let browserPoolStats = { activeBrowsers: 0, browserIds: [] as string[] };
  try {
    const { browserPool } = require('../server');
    const all = browserPool.getAllBrowsers?.() as Map<string, unknown> | undefined;
    if (all) {
      browserPoolStats = {
        activeBrowsers: all.size,
        browserIds: Array.from(all.keys()).slice(0, 50),
      };
    }
  } catch {
    /* pool may be empty during boot */
  }

  const [robots, runs, activeNow, enrichmentMetrics] = await Promise.all([
    Robot.find(ownerIdFilter(opts.userId))
      .select(
        'schedule recording_meta.id recording_meta.tags recording_meta.saasConfig.tags recording_meta.saasConfig.schedule'
      )
      .lean(),
    ownerId
      ? Run.find(runMatch)
          .select(
            'runId status robotMetaId startedAt finishedAt sortAt duration rowsExtracted jobsAddedToBoard'
          )
          .lean()
      : Promise.resolve([]),
    ownerId
      ? Run.countDocuments({
          ...buildOwnerRunFilter(opts.userId),
          status: { $in: activeStatuses },
        })
      : Promise.resolve(0),
    (async () => {
      try {
        const { getScoutXEnrichmentMetrics } = await import('./enrichmentMetrics');
        return await getScoutXEnrichmentMetrics();
      } catch {
        return null;
      }
    })(),
  ]);

  const metaIds = robots
    .map((r: any) => String(r.recording_meta?.id || ''))
    .filter(Boolean);
  const tagsByMeta = new Map<string, string[]>();
  for (const r of robots as any[]) {
    const id = String(r.recording_meta?.id || '');
    const meta = r.recording_meta || {};
    const fromMeta = Array.isArray(meta.tags) ? meta.tags : null;
    const fromSaas = Array.isArray(meta.saasConfig?.tags) ? meta.saasConfig.tags : [];
    const tags = (fromMeta && fromMeta.length ? fromMeta : fromSaas).map((t: any) => String(t));
    if (id) tagsByMeta.set(id, tags);
  }

  const rolled = rollupOpsMetricsFromRuns({
    runs: runs as any[],
    bounds,
    tagsByMeta,
    catalog: getJobCategoryDashboardTags(),
  });

  const forecastWindowMs = bounds.isCalendarDay ? WINDOW_MS['24h'] : bounds.windowMs;
  const upcomingSchedules = computeUpcomingScheduleMetrics(
    robots as any[],
    forecastWindowMs,
    new Date(now),
  );

  const payload = {
    generatedAt: new Date().toISOString(),
    window: opts.window,
    windowMs: bounds.windowMs,
    since: sinceIso,
    until: until.toISOString(),
    date: bounds.isCalendarDay ? parseOpsMetricsDate(opts.date) : null,
    totals: {
      ...rolled.totals,
      activeRunsNow: activeNow,
      automations: metaIds.length,
    },
    series: {
      runs: rolled.series.map((b) => ({
        t: b.t,
        label: b.label,
        total: b.total,
        passed: b.passed,
        failed: b.failed,
      })),
      jobsAdded: rolled.series.map((b) => ({
        t: b.t,
        label: b.label,
        jobsAdded: b.jobsAdded,
      })),
    },
    tags: rolled.tags,
    upcomingSchedules,
    compute: {
      scraperWorkerConcurrency: SCRAPER_JOB_CONCURRENCY,
      scraperJobTimeoutMs: parseInt(process.env.SCRAPER_JOB_TIMEOUT_MS || '120000', 10),
      runEmbeddedWorkers: process.env.RUN_EMBEDDED_WORKERS !== 'false',
      activeBrowsers: browserPoolStats.activeBrowsers,
      activeBrowserIds: browserPoolStats.browserIds,
      memoryUsage: process.memoryUsage(),
      uptimeSeconds: Math.round(process.uptime()),
      enrichment: enrichmentMetrics || {
        creditsSpentToday: 0,
        dailyCreditBudget: parseInt(process.env.SCRAPE_DO_DAILY_CREDIT_BUDGET || '15000', 10),
        creditsSpentLast14Days: 0,
        series14d: [],
        methods14d: [],
      },
    },
    digitalOcean: resolveDigitalOceanForOpsMetrics(
      peekDigitalOceanDashboardCache(doWindow),
      isDigitalOceanConfigured(),
    ),
  };

  opsMetricsResponseCache.set(cacheKey, payload);
  return payload;
}

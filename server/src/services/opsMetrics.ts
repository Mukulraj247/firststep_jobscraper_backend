/**
 * Windowed ops metrics for the Scout-X admin Dashboard (session user).
 */
import Run from '../models/Run';
import Robot from '../models/Robot';
import { SCRAPER_JOB_CONCURRENCY } from '../queue/scraperQueue';
import { ownerIdFilter, normalizeOwnerIdForWrite } from '../utils/ownerId';
import { buildOwnerRunFilter } from './dashboardQueries';
import {
  getDigitalOceanDashboard,
  type MetricsWindow,
} from './digitalOceanMetrics';

export type OpsMetricsWindow = '15m' | '30m' | '1h' | '3h' | '6h' | '24h';

const WINDOW_MS: Record<OpsMetricsWindow, number> = {
  '15m': 15 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '3h': 3 * 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

import { getRoleDashboardTags } from '../constants/tagCatalog';
import { computeUpcomingScheduleMetrics } from './upcomingScheduleMetrics';

export function parseOpsMetricsWindow(raw: unknown): OpsMetricsWindow {
  const v = String(raw || '1h').trim().toLowerCase();
  if (v === '15m' || v === '30m' || v === '1h' || v === '3h' || v === '6h' || v === '24h') {
    return v;
  }
  return '1h';
}

function doWindowForOps(window: OpsMetricsWindow): MetricsWindow {
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

function isSuccessStatus(status: string): boolean {
  const s = String(status || '').toLowerCase();
  return s === 'success' || s === 'completed';
}

function isFailedStatus(status: string): boolean {
  const s = String(status || '').toLowerCase();
  return s === 'failed' || s === 'dead' || s === 'aborted';
}

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
}) {
  const windowMs = WINDOW_MS[opts.window];
  const now = Date.now();
  const since = new Date(now - windowMs);
  const sinceIso = since.toISOString();
  const ownerId = normalizeOwnerIdForWrite(opts.userId);

  const robots = await Robot.find(ownerIdFilter(opts.userId))
    .select(
      'schedule recording_meta.id recording_meta.tags recording_meta.saasConfig.tags recording_meta.saasConfig.schedule'
    )
    .lean();
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

  const activeStatuses = ['running', 'pending', 'queued'];
  const ownerRunFilter = buildOwnerRunFilter(opts.userId);
  const runMatch = {
    ...ownerRunFilter,
    sortAt: { $gte: since },
  };

  const [runs, activeNow, digitalOcean] = await Promise.all([
    ownerId
      ? Run.find(runMatch)
          .select(
            'runId status robotMetaId startedAt finishedAt sortAt duration rowsExtracted jobsAddedToBoard'
          )
          .lean()
      : Promise.resolve([]),
    ownerId
      ? Run.countDocuments({
          ...ownerRunFilter,
          status: { $in: activeStatuses },
        })
      : Promise.resolve(0),
    getDigitalOceanDashboard(doWindowForOps(opts.window)).catch(() => null),
  ]);

  const inWindow = (runs as any[]).filter((r) => {
    const ts = runTimestampMs(r);
    return ts != null && ts >= since.getTime();
  });

  let passed = 0;
  let failed = 0;
  let running = 0;
  let rowsExtracted = 0;
  let jobsAddedToBoard = 0;
  for (const r of inWindow) {
    const status = String(r.status || '');
    if (isSuccessStatus(status)) passed += 1;
    else if (isFailedStatus(status)) failed += 1;
    else if (activeStatuses.includes(status.toLowerCase())) running += 1;
    rowsExtracted += typeof r.rowsExtracted === 'number' ? r.rowsExtracted : 0;
    jobsAddedToBoard += typeof r.jobsAddedToBoard === 'number' ? r.jobsAddedToBoard : 0;
  }

  const sinceMs = since.getTime();
  const buckets = bucketCount(opts.window);
  const bucketMs = windowMs / buckets;
  const series = Array.from({ length: buckets }, (_, i) => {
    const start = sinceMs + i * bucketMs;
    const end = start + bucketMs;
    return {
      t: start,
      label: new Date(start).toISOString(),
      total: 0,
      passed: 0,
      failed: 0,
      jobsAdded: 0,
    };
  });

  for (const r of inWindow) {
    const ts = runTimestampMs(r);
    if (ts == null) continue;
    const idx = Math.min(buckets - 1, Math.max(0, Math.floor((ts - sinceMs) / bucketMs)));
    const bucket = series[idx];
    bucket.total += 1;
    const status = String(r.status || '');
    if (isSuccessStatus(status)) bucket.passed += 1;
    else if (isFailedStatus(status)) bucket.failed += 1;
    bucket.jobsAdded += typeof r.jobsAddedToBoard === 'number' ? r.jobsAddedToBoard : 0;
  }

  const tagJobs: Array<{
    tag: string;
    label: string;
    namespace: string;
    namespaceLabel: string;
    jobsAdded: number;
    runs: number;
  }> = [];
  for (const definition of getRoleDashboardTags()) {
    let jobs = 0;
    let runCount = 0;
    for (const r of inWindow) {
      const tags = tagsByMeta.get(String(r.robotMetaId)) || [];
      if (!tags.includes(definition.tag)) continue;
      runCount += 1;
      jobs += typeof r.jobsAddedToBoard === 'number' ? r.jobsAddedToBoard : 0;
    }
    tagJobs.push({
      tag: definition.tag,
      label: definition.label,
      namespace: definition.namespace,
      namespaceLabel: definition.namespaceLabel,
      jobsAdded: jobs,
      runs: runCount,
    });
  }

  const upcomingSchedules = computeUpcomingScheduleMetrics(
    robots as any[],
    windowMs,
    new Date(now),
  );

  return {
    generatedAt: new Date().toISOString(),
    window: opts.window,
    windowMs,
    since: sinceIso,
    totals: {
      runs: inWindow.length,
      passed,
      failed,
      running,
      rowsExtracted,
      jobsAddedToBoard,
      activeRunsNow: activeNow,
      automations: metaIds.length,
    },
    series: {
      runs: series.map((b) => ({
        t: b.t,
        label: b.label,
        total: b.total,
        passed: b.passed,
        failed: b.failed,
      })),
      jobsAdded: series.map((b) => ({
        t: b.t,
        label: b.label,
        jobsAdded: b.jobsAdded,
      })),
    },
    tags: tagJobs,
    upcomingSchedules,
    compute: {
      scraperWorkerConcurrency: SCRAPER_JOB_CONCURRENCY,
      scraperJobTimeoutMs: parseInt(process.env.SCRAPER_JOB_TIMEOUT_MS || '120000', 10),
      runEmbeddedWorkers: process.env.RUN_EMBEDDED_WORKERS !== 'false',
      activeBrowsers: browserPoolStats.activeBrowsers,
      activeBrowserIds: browserPoolStats.browserIds,
      memoryUsage: process.memoryUsage(),
      uptimeSeconds: Math.round(process.uptime()),
    },
    digitalOcean: digitalOcean || {
      configured: false,
      generatedAt: new Date().toISOString(),
      droplets: [],
      error: 'DigitalOcean metrics unavailable',
    },
  };
}

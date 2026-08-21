/**
 * Scout-X ops digest: 6h run summary (dashboard-aligned) + light infra snapshot via ZeptoMail.
 */
import { Job } from 'agenda';
import Run from '../models/Run';
import Robot from '../models/Robot';
import User from '../models/User';
import JobBoardListing from '../models/JobBoardListing';
import EnrichmentCreditBudget from '../models/EnrichmentCreditBudget';
import logger from '../logger';
import { getAgenda, SCRAPER_JOB_CONCURRENCY } from '../queue/scraperQueue';
import { getDigitalOceanDashboard, DropletComputeSnapshot } from './digitalOceanMetrics';
import { resolveDigestRecipients } from './digestRecipients';
import { isZeptoMailConfigured, sendZeptoMail } from './zeptoMail';

const OPS_DIGEST_JOB = 'ops-digest';
const PASSED_STATUSES = new Set(['success', 'completed']);
const FAILED_STATUSES = new Set(['failed', 'dead']);
const ACTIVE_STATUSES = new Set(['running', 'pending', 'queued']);

/** Brand tokens aligned with the ops dashboard (email-safe hex). */
const BRAND = {
  navy: '#023345',
  navyDeep: '#002941',
  teal: '#4fb3a9',
  tealDark: '#2a8e9e',
  tealDeep: '#357a7a',
  surface: '#f8f9fa',
  border: '#e2e8f0',
  muted: '#64748b',
  success: '#10b981',
  danger: '#d32f2f',
  warning: '#f59e0b',
  white: '#ffffff',
} as const;

export type WindowRunStats = {
  windowHours: number;
  sinceIso: string;
  total: number;
  passed: number;
  failed: number;
  /** Attempts-exhausted dead-letter runs (also counted in failed for totals). */
  dead: number;
  aborted: number;
  active: number;
  other: number;
  byStatus: Record<string, number>;
  avgDurationMs: number | null;
  p95DurationMs: number | null;
  totalRetries: number;
  rowsExtracted: number;
  /** Jobs queued/ready on the board from runs in this window (dashboard “Jobs added”). */
  jobsAddedToBoard: number;
  passRate: number | null;
  topFailures: Array<{ name: string; robotMetaId: string; count: number; lastError: string | null }>;
  /** Selector drift lines: "Robot 100 → 0 (zero_rows)" */
  selectorDrift: Array<{
    name: string;
    robotMetaId: string;
    baseline: number | null;
    current: number;
    anomaly: string;
    escalated: boolean;
  }>;
};

export type OpsDigestPayload = {
  generatedAt: string;
  windows: {
    last6h: WindowRunStats;
    last24h: WindowRunStats;
  };
  lifetimeByStatus: Record<string, number>;
  totals: {
    robots: number;
    users: number;
    lifetimeRuns: number;
  };
  compute: {
    scraperWorkerConcurrency: number;
    scraperJobTimeoutMs: number;
    scraperMaxAttempts: number;
    runEmbeddedWorkers: boolean;
    nodeEnv: string;
    defaultBrowserType: string;
    activeBrowsers: number;
    activeBrowserIds: string[];
    memoryUsage: NodeJS.MemoryUsage;
    uptimeSeconds: number;
    jobBoard: {
      queued: number;
      enriching: number;
      ready: number;
      failed: number;
      creditsSpentToday: number;
      dailyCreditBudget: number;
    };
  };
  digitalOcean: Awaited<ReturnType<typeof getDigitalOceanDashboard>>;
  adminUrl: string | null;
  dashboardUrl: string | null;
  failuresUrl: string | null;
};

function pct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}%`;
}

function fmtDuration(ms?: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function fmtBytes(n?: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function p95(sorted: number[]): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
}

async function getBrowserPoolStats(): Promise<{ activeBrowsers: number; browserIds: string[] }> {
  try {
    const { browserPool } = require('../server');
    const all = browserPool.getAllBrowsers?.() as Map<string, unknown> | undefined;
    if (all) {
      return {
        activeBrowsers: all.size,
        browserIds: Array.from(all.keys()).slice(0, 50),
      };
    }
  } catch {
    /* pool may be empty during boot / worker-only */
  }
  return { activeBrowsers: 0, browserIds: [] };
}

async function aggregateWindow(hours: number): Promise<WindowRunStats> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const sinceIso = since.toISOString();

  const runs: any[] = await Run.find({
    $or: [{ startedAt: { $gte: sinceIso } }, { finishedAt: { $gte: sinceIso } }],
  })
    .select(
      'runId name status robotMetaId duration retryCount errorMessage startedAt finishedAt anomaly anomalyMeta rowsExtracted jobsAddedToBoard',
    )
    .lean();

  const byStatus: Record<string, number> = {};
  let passed = 0;
  let failed = 0;
  let dead = 0;
  let aborted = 0;
  let active = 0;
  let other = 0;
  let totalRetries = 0;
  let rowsExtracted = 0;
  let jobsAddedToBoard = 0;
  const durations: number[] = [];
  const failByRobot = new Map<string, { name: string; count: number; lastError: string | null }>();
  const selectorDrift: WindowRunStats['selectorDrift'] = [];

  for (const run of runs) {
    const status = String(run.status || 'unknown');
    byStatus[status] = (byStatus[status] || 0) + 1;
    if (PASSED_STATUSES.has(status)) passed += 1;
    else if (status === 'dead') {
      dead += 1;
      failed += 1;
    } else if (FAILED_STATUSES.has(status)) failed += 1;
    else if (status === 'aborted') aborted += 1;
    else if (ACTIVE_STATUSES.has(status)) active += 1;
    else other += 1;

    totalRetries += Number(run.retryCount) || 0;
    rowsExtracted += typeof run.rowsExtracted === 'number' ? run.rowsExtracted : 0;
    jobsAddedToBoard += typeof run.jobsAddedToBoard === 'number' ? run.jobsAddedToBoard : 0;

    const d = Number(run.duration);
    if (Number.isFinite(d) && d > 0) durations.push(d);

    if (FAILED_STATUSES.has(status) || status === 'dead' || status === 'aborted') {
      const key = String(run.robotMetaId || 'unknown');
      const prev = failByRobot.get(key) || {
        name: String(run.name || key),
        count: 0,
        lastError: null as string | null,
      };
      prev.count += 1;
      prev.lastError = run.errorMessage ? String(run.errorMessage).slice(0, 200) : prev.lastError;
      failByRobot.set(key, prev);
    }

    if (run.anomaly) {
      selectorDrift.push({
        name: String(run.name || run.robotMetaId || 'Robot'),
        robotMetaId: String(run.robotMetaId || ''),
        baseline:
          run.anomalyMeta?.baseline != null && Number.isFinite(Number(run.anomalyMeta.baseline))
            ? Number(run.anomalyMeta.baseline)
            : null,
        current:
          typeof run.rowsExtracted === 'number'
            ? run.rowsExtracted
            : Number(run.anomalyMeta?.current) || 0,
        anomaly: String(run.anomaly),
        escalated: Boolean(run.anomalyMeta?.escalated),
      });
    }
  }

  durations.sort((a, b) => a - b);
  const avgDurationMs =
    durations.length > 0
      ? Math.round(durations.reduce((s, n) => s + n, 0) / durations.length)
      : null;

  const topFailures = Array.from(failByRobot.entries())
    .map(([robotMetaId, v]) => ({
      robotMetaId,
      name: v.name,
      count: v.count,
      lastError: v.lastError,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const finished = passed + failed + aborted;
  const passRate = finished > 0 ? Math.round((passed / finished) * 100) : null;

  return {
    windowHours: hours,
    sinceIso,
    total: runs.length,
    passed,
    failed,
    dead,
    aborted,
    active,
    other,
    byStatus,
    avgDurationMs,
    p95DurationMs: p95(durations),
    totalRetries,
    rowsExtracted,
    jobsAddedToBoard,
    passRate,
    topFailures,
    selectorDrift: selectorDrift.slice(0, 8),
  };
}

export function isOpsDigestEnabled(): boolean {
  const flag = String(process.env.OPS_DIGEST_ENABLED ?? 'true').trim().toLowerCase();
  if (flag === 'false' || flag === '0' || flag === 'no') return false;
  return true;
}

export async function getOpsDigestConfigStatus(): Promise<{
  enabled: boolean;
  zeptoConfigured: boolean;
  recipients: string[];
  canSend: boolean;
  reason?: string;
}> {
  const enabled = isOpsDigestEnabled();
  const zeptoConfigured = isZeptoMailConfigured();
  const recipients = await resolveDigestRecipients();
  if (!enabled) {
    return {
      enabled,
      zeptoConfigured,
      recipients,
      canSend: false,
      reason: 'OPS_DIGEST_ENABLED is false.',
    };
  }
  if (!zeptoConfigured) {
    return {
      enabled,
      zeptoConfigured,
      recipients,
      canSend: false,
      reason: 'ZeptoMail is not configured.',
    };
  }
  if (!recipients.length) {
    return {
      enabled,
      zeptoConfigured,
      recipients,
      canSend: false,
      reason: 'No digest recipients configured.',
    };
  }
  return { enabled, zeptoConfigured, recipients, canSend: true };
}

export async function buildOpsDigestPayload(): Promise<OpsDigestPayload> {
  const dayKey = new Date().toISOString().slice(0, 10);
  const [last6h, last24h, statusAgg, robotCount, userCount, browserPool, digitalOcean, boardStatus, creditDoc] =
    await Promise.all([
      aggregateWindow(6),
      aggregateWindow(24),
      Run.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Robot.countDocuments(),
      User.countDocuments(),
      getBrowserPoolStats(),
      getDigitalOceanDashboard('6h'),
      JobBoardListing.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      EnrichmentCreditBudget.findById(dayKey).lean(),
    ]);

  const lifetimeByStatus: Record<string, number> = {};
  let lifetimeRuns = 0;
  for (const row of statusAgg) {
    lifetimeByStatus[row._id || 'unknown'] = row.count;
    lifetimeRuns += row.count;
  }

  const boardByStatus: Record<string, number> = {};
  for (const row of boardStatus) {
    boardByStatus[row._id || 'unknown'] = row.count;
  }

  const publicUrl = String(process.env.PUBLIC_URL || process.env.VITE_PUBLIC_URL || '').replace(
    /\/$/,
    ''
  );

  return {
    generatedAt: new Date().toISOString(),
    windows: { last6h, last24h },
    lifetimeByStatus,
    totals: {
      robots: robotCount,
      users: userCount,
      lifetimeRuns,
    },
    compute: {
      scraperWorkerConcurrency: SCRAPER_JOB_CONCURRENCY,
      scraperJobTimeoutMs: parseInt(process.env.SCRAPER_JOB_TIMEOUT_MS || '120000', 10),
      scraperMaxAttempts: parseInt(process.env.SCRAPER_MAX_ATTEMPTS || '3', 10),
      runEmbeddedWorkers: process.env.RUN_EMBEDDED_WORKERS !== 'false',
      nodeEnv: process.env.NODE_ENV || 'development',
      defaultBrowserType: process.env.DEFAULT_BROWSER_TYPE || 'playwright',
      activeBrowsers: browserPool.activeBrowsers,
      activeBrowserIds: browserPool.browserIds,
      memoryUsage: process.memoryUsage(),
      uptimeSeconds: Math.round(process.uptime()),
      jobBoard: {
        queued: boardByStatus.queued || 0,
        enriching: boardByStatus.enriching || 0,
        ready: boardByStatus.ready || 0,
        failed: boardByStatus.failed || 0,
        creditsSpentToday: creditDoc?.creditsSpent || 0,
        dailyCreditBudget: parseInt(process.env.SCRAPE_DO_DAILY_CREDIT_BUDGET || '15000', 10),
      },
    },
    digitalOcean,
    adminUrl: publicUrl ? `${publicUrl}/admin` : null,
    dashboardUrl: publicUrl ? `${publicUrl}/dashboard?window=6h` : null,
    failuresUrl: publicUrl ? `${publicUrl}/failures?window=6h` : null,
  };
}

function metricCard(label: string, value: string | number, accent: string, hint?: string): string {
  return `
    <td style="width:33.33%;padding:6px;vertical-align:top">
      <div style="background:${BRAND.white};border:1px solid ${BRAND.border};border-radius:12px;padding:14px 12px;border-top:3px solid ${accent}">
        <div style="font-size:11px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:${BRAND.muted};margin-bottom:6px">${escapeHtml(label)}</div>
        <div style="font-size:26px;font-weight:700;line-height:1.1;color:${BRAND.navyDeep}">${escapeHtml(String(value))}</div>
        ${hint ? `<div style="font-size:12px;color:${BRAND.muted};margin-top:6px">${escapeHtml(hint)}</div>` : ''}
      </div>
    </td>`;
}

function renderMetricGrid(w: WindowRunStats): string {
  const passHint = w.passRate != null ? `${w.passRate}% of finished` : undefined;
  const failHint = w.dead > 0 ? `${w.dead} dead` : w.aborted > 0 ? `${w.aborted} aborted` : undefined;
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 8px">
      <tr>
        ${metricCard('Runs', w.total, BRAND.navy, `Last ${w.windowHours}h`)}
        ${metricCard('Passed', w.passed, BRAND.success, passHint)}
        ${metricCard('Failed', w.failed, BRAND.danger, failHint)}
      </tr>
      <tr>
        ${metricCard('Jobs added', w.jobsAddedToBoard, BRAND.tealDark, 'Added to board')}
        ${metricCard('Rows scraped', w.rowsExtracted, BRAND.tealDeep)}
        ${metricCard('Active now', w.active, BRAND.teal, w.totalRetries > 0 ? `${w.totalRetries} retries` : undefined)}
      </tr>
    </table>`;
}

function renderGlance24h(w: WindowRunStats): string {
  return `
    <div style="background:${BRAND.surface};border:1px solid ${BRAND.border};border-radius:10px;padding:12px 14px;margin:0 0 20px;font-size:13px;color:${BRAND.navy}">
      <strong style="color:${BRAND.navyDeep}">Last 24h glance</strong>
      <span style="color:${BRAND.muted}"> · </span>
      ${w.total} runs · ${w.passed} passed · ${w.failed} failed ·
      <strong>${w.jobsAddedToBoard}</strong> jobs added · ${w.rowsExtracted} rows
    </div>`;
}

function renderTopFailures(w: WindowRunStats, failuresUrl: string | null): string {
  if (!w.topFailures.length) {
    return `
      <div style="margin:0 0 20px;padding:12px 14px;border-radius:10px;background:#ecfdf5;border:1px solid #a7f3d0;color:#065f46;font-size:14px">
        No failed runs in this window.
      </div>`;
  }

  const rows = w.topFailures
    .map(
      (f) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid ${BRAND.border};font-weight:600;color:${BRAND.navyDeep}">${escapeHtml(f.name)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid ${BRAND.border};text-align:right;font-weight:700;color:${BRAND.danger}">${f.count}</td>
        <td style="padding:10px 12px;border-bottom:1px solid ${BRAND.border};font-size:12px;color:${BRAND.muted}">${escapeHtml(f.lastError || '—')}</td>
      </tr>`,
    )
    .join('');

  return `
    <h3 style="margin:0 0 10px;font-size:15px;color:${BRAND.navyDeep}">Top failures</h3>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:${BRAND.white};border:1px solid ${BRAND.border};border-radius:10px;overflow:hidden;margin:0 0 8px">
      <tr style="background:${BRAND.surface}">
        <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:${BRAND.muted}">Automation</th>
        <th style="padding:8px 12px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:${BRAND.muted}">Count</th>
        <th style="padding:8px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;color:${BRAND.muted}">Last error</th>
      </tr>
      ${rows}
    </table>
    ${
      failuresUrl
        ? `<p style="margin:0 0 20px;font-size:13px"><a href="${escapeHtml(failuresUrl)}" style="color:${BRAND.tealDark};font-weight:600">Open failure dashboard →</a></p>`
        : `<div style="height:12px"></div>`
    }`;
}

function renderSelectorDrift(w: WindowRunStats): string {
  if (!w.selectorDrift.length) return '';
  const rows = w.selectorDrift
    .map((d) => {
      const left = d.baseline != null ? String(d.baseline) : '?';
      const label = d.escalated ? `${d.anomaly}, escalated` : d.anomaly;
      return `
        <tr>
          <td style="padding:8px 12px;border-bottom:1px solid ${BRAND.border}">${escapeHtml(d.name)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid ${BRAND.border};text-align:right;font-family:Consolas,monospace;font-size:12px">${escapeHtml(left)} → ${d.current}</td>
          <td style="padding:8px 12px;border-bottom:1px solid ${BRAND.border};font-size:12px;color:${BRAND.muted}">${escapeHtml(label)}</td>
        </tr>`;
    })
    .join('');

  return `
    <h3 style="margin:0 0 10px;font-size:15px;color:${BRAND.navyDeep}">Selector drift</h3>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:${BRAND.white};border:1px solid ${BRAND.border};border-radius:10px;overflow:hidden;margin:0 0 20px">
      ${rows}
    </table>`;
}

function renderDroplet(d: DropletComputeSnapshot): string {
  const m = d.metrics;
  return `
    <div style="margin:0 0 10px;padding:12px 14px;border:1px solid ${BRAND.border};border-radius:10px;background:${BRAND.white}">
      <div style="font-weight:600;color:${BRAND.navyDeep};margin-bottom:4px">${escapeHtml(d.name)}</div>
      <div style="font-size:12px;color:${BRAND.muted};margin-bottom:10px">
        ${escapeHtml(d.status)} · ${escapeHtml(d.sizeSlug || '—')} · ${escapeHtml(d.region || '—')}
      </div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px">
        <tr>
          <td style="padding:4px 0;color:${BRAND.muted}">CPU</td>
          <td style="padding:4px 0;text-align:right;font-weight:700;color:${BRAND.navyDeep}">${pct(m.cpuPercent.avg ?? m.cpuPercent.latest)} <span style="font-weight:400;color:${BRAND.muted}">(now ${pct(m.cpuPercent.latest)})</span></td>
        </tr>
        <tr>
          <td style="padding:4px 0;color:${BRAND.muted}">Memory</td>
          <td style="padding:4px 0;text-align:right;font-weight:700;color:${BRAND.navyDeep}">${pct(m.memoryUsedPercent.latest)}</td>
        </tr>
      </table>
      ${m.note ? `<p style="font-size:12px;color:${BRAND.danger};margin:8px 0 0">${escapeHtml(m.note)}</p>` : ''}
    </div>`;
}

export function renderOpsDigestHtml(payload: OpsDigestPayload): string {
  const c = payload.compute;
  const w = payload.windows.last6h;
  const w24 = payload.windows.last24h;

  const doBlock = !payload.digitalOcean.configured
    ? `<p style="color:${BRAND.muted};font-size:13px;margin:0">${escapeHtml(payload.digitalOcean.error || 'DigitalOcean not configured.')}</p>`
    : payload.digitalOcean.droplets.map(renderDroplet).join('');

  const primaryLink = payload.dashboardUrl || payload.adminUrl;
  const generatedLabel = new Date(payload.generatedAt).toUTCString();

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${BRAND.surface};font-family:'Segoe UI',Helvetica,Arial,sans-serif;color:${BRAND.navyDeep};line-height:1.45">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.surface};padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:${BRAND.white};border-radius:16px;overflow:hidden;border:1px solid ${BRAND.border}">
        <tr>
          <td style="background:linear-gradient(135deg, ${BRAND.navyDeep} 0%, ${BRAND.navy} 55%, ${BRAND.tealDeep} 120%);padding:22px 24px;color:${BRAND.white}">
            <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.85;margin-bottom:6px">Scout-X Ops</div>
            <div style="font-size:22px;font-weight:700;margin:0 0 6px">Last 6 hours</div>
            <div style="font-size:13px;opacity:0.85">${escapeHtml(generatedLabel)}</div>
            ${
              w.passRate != null
                ? `<div style="margin-top:14px;display:inline-block;background:rgba(79,179,169,0.25);border:1px solid rgba(79,179,169,0.45);border-radius:999px;padding:6px 12px;font-size:13px;font-weight:600">Pass rate ${w.passRate}%</div>`
                : ''
            }
          </td>
        </tr>
        <tr>
          <td style="padding:20px 18px 8px">
            ${renderMetricGrid(w)}
            <p style="margin:4px 12px 16px;font-size:12px;color:${BRAND.muted}">
              Avg duration <b style="color:${BRAND.navy}">${fmtDuration(w.avgDurationMs)}</b>
              · p95 <b style="color:${BRAND.navy}">${fmtDuration(w.p95DurationMs)}</b>
              · ${payload.totals.robots} automations
            </p>
            ${renderGlance24h(w24)}
            ${renderTopFailures(w, payload.failuresUrl)}
            ${renderSelectorDrift(w)}

            <h3 style="margin:0 0 10px;font-size:15px;color:${BRAND.navyDeep}">Job board now</h3>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 20px;font-size:13px">
              <tr>
                <td style="padding:10px;background:${BRAND.surface};border-radius:8px;text-align:center">
                  <div style="color:${BRAND.muted};font-size:11px;text-transform:uppercase">Ready</div>
                  <div style="font-weight:700;font-size:18px;color:${BRAND.navyDeep}">${c.jobBoard.ready}</div>
                </td>
                <td style="width:8px"></td>
                <td style="padding:10px;background:${BRAND.surface};border-radius:8px;text-align:center">
                  <div style="color:${BRAND.muted};font-size:11px;text-transform:uppercase">Queued</div>
                  <div style="font-weight:700;font-size:18px;color:${BRAND.navyDeep}">${c.jobBoard.queued}</div>
                </td>
                <td style="width:8px"></td>
                <td style="padding:10px;background:${BRAND.surface};border-radius:8px;text-align:center">
                  <div style="color:${BRAND.muted};font-size:11px;text-transform:uppercase">Enriching</div>
                  <div style="font-weight:700;font-size:18px;color:${BRAND.navyDeep}">${c.jobBoard.enriching}</div>
                </td>
                <td style="width:8px"></td>
                <td style="padding:10px;background:${BRAND.surface};border-radius:8px;text-align:center">
                  <div style="color:${BRAND.muted};font-size:11px;text-transform:uppercase">Credits</div>
                  <div style="font-weight:700;font-size:18px;color:${BRAND.navyDeep}">${c.jobBoard.creditsSpentToday}<span style="font-size:12px;font-weight:500;color:${BRAND.muted}">/${c.jobBoard.dailyCreditBudget}</span></div>
                </td>
              </tr>
            </table>

            <h3 style="margin:0 0 10px;font-size:15px;color:${BRAND.navyDeep}">Infrastructure</h3>
            <p style="margin:0 0 12px;font-size:13px;color:${BRAND.muted}">
              Workers <b style="color:${BRAND.navy}">${c.scraperWorkerConcurrency}</b>
              · Browsers <b style="color:${BRAND.navy}">${c.activeBrowsers}</b>
              · RSS <b style="color:${BRAND.navy}">${fmtBytes(c.memoryUsage.rss)}</b>
              · Uptime <b style="color:${BRAND.navy}">${fmtDuration(c.uptimeSeconds * 1000)}</b>
            </p>
            ${doBlock}

            ${
              primaryLink
                ? `<p style="margin:24px 0 8px;text-align:center">
                    <a href="${escapeHtml(primaryLink)}" style="display:inline-block;background:${BRAND.teal};color:${BRAND.navyDeep};text-decoration:none;font-weight:700;padding:12px 20px;border-radius:999px">Open dashboard</a>
                  </p>`
                : ''
            }
          </td>
        </tr>
        <tr>
          <td style="padding:16px 24px 22px;font-size:11px;color:${BRAND.muted};text-align:center;border-top:1px solid ${BRAND.border}">
            Sent every 6 hours · metrics cover the last 6 hours of runs
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function renderOpsDigestText(payload: OpsDigestPayload): string {
  const w = payload.windows.last6h;
  const w24 = payload.windows.last24h;
  const lines = [
    `Scout-X Ops Digest — last 6 hours`,
    `Generated ${payload.generatedAt}`,
    payload.dashboardUrl ? `Dashboard: ${payload.dashboardUrl}` : payload.adminUrl ? `Admin: ${payload.adminUrl}` : '',
    '',
    `Runs ${w.total} · Passed ${w.passed}${w.passRate != null ? ` (${w.passRate}%)` : ''} · Failed ${w.failed}`,
    `Jobs added ${w.jobsAddedToBoard} · Rows scraped ${w.rowsExtracted} · Active ${w.active}`,
    `Avg ${fmtDuration(w.avgDurationMs)} · p95 ${fmtDuration(w.p95DurationMs)} · retries ${w.totalRetries}`,
    '',
    `Last 24h — runs ${w24.total} · passed ${w24.passed} · failed ${w24.failed} · jobs added ${w24.jobsAddedToBoard}`,
    '',
    'Top failures:',
    ...(w.topFailures.length
      ? w.topFailures.map((f) => `  ${f.name} ×${f.count}${f.lastError ? ` — ${f.lastError}` : ''}`)
      : ['  (none)']),
  ];

  if (w.selectorDrift.length) {
    lines.push('', 'Selector drift:');
    for (const d of w.selectorDrift) {
      const left = d.baseline != null ? String(d.baseline) : '?';
      const label = d.escalated ? `${d.anomaly}, escalated` : d.anomaly;
      lines.push(`  ${d.name}  ${left} → ${d.current}  (${label})`);
    }
  }

  lines.push(
    '',
    `Job board — ready ${payload.compute.jobBoard.ready} · queued ${payload.compute.jobBoard.queued} · enriching ${payload.compute.jobBoard.enriching} · credits ${payload.compute.jobBoard.creditsSpentToday}/${payload.compute.jobBoard.dailyCreditBudget}`,
    `Workers ${payload.compute.scraperWorkerConcurrency} · browsers ${payload.compute.activeBrowsers} · RSS ${fmtBytes(payload.compute.memoryUsage.rss)}`,
  );

  if (payload.digitalOcean.configured) {
    for (const d of payload.digitalOcean.droplets) {
      lines.push(
        `DO ${d.name} CPU ${pct(d.metrics.cpuPercent.avg ?? d.metrics.cpuPercent.latest)} (now ${pct(d.metrics.cpuPercent.latest)}) mem ${pct(d.metrics.memoryUsedPercent.latest)}`,
      );
    }
  }

  return lines.filter(Boolean).join('\n');
}

export async function sendOpsDigest(options?: { force?: boolean }): Promise<{
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  requestId?: string;
  error?: string;
  payload?: OpsDigestPayload;
}> {
  const status = await getOpsDigestConfigStatus();
  if (!options?.force && !status.canSend) {
    return { ok: false, skipped: true, reason: status.reason };
  }
  if (options?.force) {
    if (!status.zeptoConfigured) {
      return { ok: false, skipped: true, reason: 'ZeptoMail is not configured.' };
    }
    if (!status.recipients.length) {
      return { ok: false, skipped: true, reason: 'No digest recipients configured.' };
    }
  }

  const payload = await buildOpsDigestPayload();
  const w = payload.windows.last6h;
  const subject = `Scout-X Ops · ${w.jobsAddedToBoard} jobs added · ${w.total} runs · ${w.failed} failed (6h)`;
  const result = await sendZeptoMail({
    to: status.recipients,
    subject,
    htmlbody: renderOpsDigestHtml(payload),
    textbody: renderOpsDigestText(payload),
  });

  return { ...result, payload };
}

let opsDigestRegistered = false;

export async function registerOpsDigestJob(): Promise<void> {
  if (opsDigestRegistered) return;
  opsDigestRegistered = true;

  const agenda = await getAgenda();
  (agenda as any).define(OPS_DIGEST_JOB, async (_job: Job) => {
    logger.log('info', 'Ops digest job started');
    const result = await sendOpsDigest();
    if (result.skipped) {
      logger.log('info', `Ops digest skipped: ${result.reason}`);
    } else if (!result.ok) {
      logger.log('error', `Ops digest failed: ${result.error || 'unknown'}`);
    } else {
      logger.log('info', `Ops digest sent (requestId=${result.requestId || 'n/a'})`);
    }
  });

  if (!isOpsDigestEnabled()) {
    logger.log('info', 'Ops digest Agenda job defined but OPS_DIGEST_ENABLED=false — not scheduling');
    await agenda.cancel({ name: OPS_DIGEST_JOB });
    return;
  }

  // Singleton repeating job — agenda.every is safe here (one document per name).
  await (agenda as any).every('6 hours', OPS_DIGEST_JOB);
  logger.log('info', 'Ops digest scheduled every 6 hours via Agenda');
}

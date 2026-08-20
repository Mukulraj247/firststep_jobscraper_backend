/**
 * Scout-X ops digest: run aggregates + Node/DO compute snapshots, ZeptoMail HTML, Agenda job.
 */
import { Job } from 'agenda';
import Run from '../models/Run';
import Robot from '../models/Robot';
import User from '../models/User';
import ExtractedData from '../models/ExtractedData';
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
    .select('runId name status robotMetaId duration retryCount errorMessage startedAt finishedAt anomaly anomalyMeta rowsExtracted')
    .lean();

  const byStatus: Record<string, number> = {};
  let passed = 0;
  let failed = 0;
  let dead = 0;
  let aborted = 0;
  let active = 0;
  let other = 0;
  let totalRetries = 0;
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
    const d = Number(run.duration);
    if (Number.isFinite(d) && d > 0) durations.push(d);

    if (FAILED_STATUSES.has(status)) {
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

  const runIds = runs.map((r) => String(r.runId || '')).filter(Boolean);
  let rowsExtracted = 0;
  if (runIds.length) {
    // Cap to avoid huge $in lists on busy instances
    const sampleIds = runIds.slice(0, 2000);
    const rowAgg = await ExtractedData.aggregate([
      { $match: { runId: { $in: sampleIds } } },
      { $group: { _id: null, count: { $sum: 1 } } },
    ]);
    rowsExtracted = Number(rowAgg[0]?.count) || 0;
  }

  const topFailures = Array.from(failByRobot.entries())
    .map(([robotMetaId, v]) => ({
      robotMetaId,
      name: v.name,
      count: v.count,
      lastError: v.lastError,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

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
    topFailures,
    selectorDrift: selectorDrift.slice(0, 40),
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
  };
}

function renderWindowTable(label: string, w: WindowRunStats): string {
  const statusRows = Object.entries(w.byStatus)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([s, c]) =>
        `<tr><td style="padding:4px 8px;border:1px solid #ddd">${escapeHtml(s)}</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right">${c}</td></tr>`
    )
    .join('');

  const failRows = w.topFailures.length
    ? w.topFailures
        .map(
          (f) =>
            `<tr><td style="padding:4px 8px;border:1px solid #ddd">${escapeHtml(f.name)}</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right">${f.count}</td><td style="padding:4px 8px;border:1px solid #ddd;font-size:12px;color:#666">${escapeHtml(f.lastError || '')}</td></tr>`
        )
        .join('')
    : `<tr><td colspan="3" style="padding:4px 8px;border:1px solid #ddd;color:#666">None</td></tr>`;

  const driftRows = w.selectorDrift.length
    ? w.selectorDrift
        .map((d) => {
          const left = d.baseline != null ? String(d.baseline) : '?';
          const label = d.escalated ? `${d.anomaly}, escalated` : d.anomaly;
          return `<tr><td style="padding:4px 8px;border:1px solid #ddd">${escapeHtml(d.name)}</td><td style="padding:4px 8px;border:1px solid #ddd;text-align:right;font-family:monospace">${escapeHtml(left)} → ${d.current}</td><td style="padding:4px 8px;border:1px solid #ddd;font-size:12px;color:#666">${escapeHtml(label)}</td></tr>`;
        })
        .join('')
    : `<tr><td colspan="3" style="padding:4px 8px;border:1px solid #ddd;color:#666">None</td></tr>`;

  return `
    <h3 style="margin:24px 0 8px">${escapeHtml(label)}</h3>
    <table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:12px">
      <tr>
        <td style="padding:8px 12px;background:#f5f5f5;border:1px solid #ddd"><b>Runs</b><br/>${w.total}</td>
        <td style="padding:8px 12px;background:#e8f5e9;border:1px solid #ddd"><b>Passed</b><br/>${w.passed}</td>
        <td style="padding:8px 12px;background:#ffebee;border:1px solid #ddd"><b>Failed</b><br/>${w.failed}</td>
        <td style="padding:8px 12px;background:#ffcdd2;border:1px solid #ddd"><b>Dead</b><br/>${w.dead}</td>
        <td style="padding:8px 12px;background:#fff3e0;border:1px solid #ddd"><b>Active</b><br/>${w.active}</td>
        <td style="padding:8px 12px;background:#f5f5f5;border:1px solid #ddd"><b>Aborted</b><br/>${w.aborted}</td>
      </tr>
    </table>
    <p style="margin:0 0 8px;font-size:14px">
      Avg duration: <b>${fmtDuration(w.avgDurationMs)}</b> ·
      p95: <b>${fmtDuration(w.p95DurationMs)}</b> ·
      Retries: <b>${w.totalRetries}</b> ·
      Rows extracted: <b>${w.rowsExtracted}</b>
    </p>
    <h4 style="margin:12px 0 4px">By status</h4>
    <table style="border-collapse:collapse">${statusRows || '<tr><td style="padding:4px 8px">—</td></tr>'}</table>
    <h4 style="margin:12px 0 4px">Selector Drift</h4>
    <table style="border-collapse:collapse">
      <tr>
        <th style="padding:4px 8px;border:1px solid #ddd;text-align:left">Automation</th>
        <th style="padding:4px 8px;border:1px solid #ddd;text-align:right">Baseline → current</th>
        <th style="padding:4px 8px;border:1px solid #ddd;text-align:left">Anomaly</th>
      </tr>
      ${driftRows}
    </table>
    <h4 style="margin:12px 0 4px">Top failures</h4>
    <table style="border-collapse:collapse">
      <tr>
        <th style="padding:4px 8px;border:1px solid #ddd;text-align:left">Automation</th>
        <th style="padding:4px 8px;border:1px solid #ddd;text-align:right">Count</th>
        <th style="padding:4px 8px;border:1px solid #ddd;text-align:left">Last error</th>
      </tr>
      ${failRows}
    </table>
  `;
}

function renderDroplet(d: DropletComputeSnapshot): string {
  const m = d.metrics;
  return `
    <div style="margin:12px 0;padding:12px;border:1px solid #ddd;border-radius:6px">
      <div style="font-weight:600">${escapeHtml(d.name)} <span style="color:#666;font-weight:400">(#${d.id})</span></div>
      <div style="font-size:13px;color:#555;margin:4px 0 8px">
        ${escapeHtml(d.status)} · ${escapeHtml(d.sizeSlug || '—')} · ${escapeHtml(d.region || '—')} ·
        ${d.vcpus != null ? `${d.vcpus} vCPU` : '—'} ·
        ${d.memoryMb != null ? `${d.memoryMb} MB RAM` : '—'}
        ${d.priceMonthlyUsd != null ? ` · $${d.priceMonthlyUsd}/mo` : ''}
      </div>
      <table cellpadding="0" cellspacing="0" style="border-collapse:collapse">
        <tr>
          <td style="padding:6px 10px;border:1px solid #ddd">CPU window avg<br/><b>${pct(m.cpuPercent.avg ?? m.cpuPercent.latest)}</b> <span style="color:#666">(now ${pct(m.cpuPercent.latest)} · max ${pct(m.cpuPercent.max)})</span></td>
          <td style="padding:6px 10px;border:1px solid #ddd">Memory used<br/><b>${pct(m.memoryUsedPercent.latest)}</b> <span style="color:#666">(avg ${pct(m.memoryUsedPercent.avg)})</span></td>
          <td style="padding:6px 10px;border:1px solid #ddd">BW in<br/><b>${m.bandwidthInboundMbps.latest != null ? m.bandwidthInboundMbps.latest.toFixed(3) : '—'} Mbps</b></td>
          <td style="padding:6px 10px;border:1px solid #ddd">BW out<br/><b>${m.bandwidthOutboundMbps.latest != null ? m.bandwidthOutboundMbps.latest.toFixed(3) : '—'} Mbps</b></td>
        </tr>
      </table>
      ${m.note ? `<p style="font-size:12px;color:#b71c1c;margin:8px 0 0">${escapeHtml(m.note)}</p>` : ''}
    </div>
  `;
}

export function renderOpsDigestHtml(payload: OpsDigestPayload): string {
  const c = payload.compute;
  const doBlock = !payload.digitalOcean.configured
    ? `<p style="color:#666">${escapeHtml(payload.digitalOcean.error || 'DigitalOcean not configured.')}</p>`
    : payload.digitalOcean.droplets.map(renderDroplet).join('');

  const lifetime = Object.entries(payload.lifetimeByStatus)
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `${escapeHtml(s)}: ${n}`)
    .join(' · ');

  return `<!DOCTYPE html>
<html><body style="font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#222;line-height:1.45;max-width:720px;margin:0 auto;padding:16px">
  <h2 style="margin:0 0 4px">Scout-X Ops Digest</h2>
  <p style="margin:0 0 16px;color:#666;font-size:13px">Generated ${escapeHtml(payload.generatedAt)}</p>
  ${payload.adminUrl ? `<p><a href="${escapeHtml(payload.adminUrl)}">Open admin dashboard</a></p>` : ''}

  ${renderWindowTable('Last 6 hours', payload.windows.last6h)}
  ${renderWindowTable('Last 24 hours', payload.windows.last24h)}

  <h3 style="margin:24px 0 8px">Lifetime</h3>
  <p style="font-size:14px">
    Runs: <b>${payload.totals.lifetimeRuns}</b> ·
    Automations: <b>${payload.totals.robots}</b> ·
    Accounts: <b>${payload.totals.users}</b><br/>
    <span style="color:#555">${lifetime || '—'}</span>
  </p>

  <h3 style="margin:24px 0 8px">Node / process compute</h3>
  <p style="font-size:14px">
    Concurrency: <b>${c.scraperWorkerConcurrency}</b> ·
    Live browsers: <b>${c.activeBrowsers}</b> ·
    Heap: <b>${fmtBytes(c.memoryUsage.heapUsed)}</b> ·
    RSS: <b>${fmtBytes(c.memoryUsage.rss)}</b> ·
    Uptime: <b>${fmtDuration(c.uptimeSeconds * 1000)}</b> ·
    Env: <b>${escapeHtml(c.nodeEnv)}</b> ·
    Browser: <b>${escapeHtml(c.defaultBrowserType)}</b>
  </p>

  <h3 style="margin:24px 0 8px">Job board enrichment</h3>
  <p style="font-size:14px">
    Ready: <b>${c.jobBoard.ready}</b> ·
    Queued: <b>${c.jobBoard.queued}</b> ·
    Enriching: <b>${c.jobBoard.enriching}</b> ·
    Failed: <b>${c.jobBoard.failed}</b> ·
    Credits today: <b>${c.jobBoard.creditsSpentToday}</b> / ${c.jobBoard.dailyCreditBudget}
  </p>

  <h3 style="margin:24px 0 8px">DigitalOcean droplet</h3>
  ${doBlock}

  <p style="margin-top:28px;font-size:12px;color:#888">This email is sent every 6 hours by Scout-X via ZeptoMail.</p>
</body></html>`;
}

export function renderOpsDigestText(payload: OpsDigestPayload): string {
  const w = payload.windows.last6h;
  const lines = [
    `Scout-X Ops Digest @ ${payload.generatedAt}`,
    payload.adminUrl ? `Admin: ${payload.adminUrl}` : '',
    '',
    `Last 6h — runs=${w.total} passed=${w.passed} failed=${w.failed} active=${w.active} aborted=${w.aborted}`,
    `Avg ${fmtDuration(w.avgDurationMs)} · p95 ${fmtDuration(w.p95DurationMs)} · retries=${w.totalRetries} · rows=${w.rowsExtracted}`,
    '',
    'Selector Drift:',
    ...(w.selectorDrift.length
      ? w.selectorDrift.slice(0, 20).map((d) => {
          const left = d.baseline != null ? String(d.baseline) : '?';
          const label = d.escalated ? `${d.anomaly}, escalated` : d.anomaly;
          return `  ${d.name}  ${left} → ${d.current}  (${label})`;
        })
      : ['  (none)']),
    '',
    `Lifetime runs=${payload.totals.lifetimeRuns} robots=${payload.totals.robots} users=${payload.totals.users}`,
    `Heap ${fmtBytes(payload.compute.memoryUsage.heapUsed)} · RSS ${fmtBytes(payload.compute.memoryUsage.rss)} · browsers=${payload.compute.activeBrowsers}`,
    `Job board — ready=${payload.compute.jobBoard.ready} queued=${payload.compute.jobBoard.queued} enriching=${payload.compute.jobBoard.enriching} failed=${payload.compute.jobBoard.failed} credits=${payload.compute.jobBoard.creditsSpentToday}/${payload.compute.jobBoard.dailyCreditBudget}`,
  ];
  if (payload.digitalOcean.configured) {
    for (const d of payload.digitalOcean.droplets) {
      lines.push(
        `DO ${d.name} (#${d.id}) CPU avg ${pct(d.metrics.cpuPercent.avg ?? d.metrics.cpuPercent.latest)} (now ${pct(d.metrics.cpuPercent.latest)}) mem ${pct(d.metrics.memoryUsedPercent.latest)}`
      );
    }
  } else {
    lines.push(`DO: ${payload.digitalOcean.error || 'not configured'}`);
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
  const subject = `Scout-X Ops · ${w.total} runs · ${w.passed} passed · ${w.failed} failed (6h)`;
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

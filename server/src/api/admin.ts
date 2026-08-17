import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { verify } from 'jsonwebtoken';
import moment from 'moment-timezone';
import Run from '../models/Run';
import Robot from '../models/Robot';
import User from '../models/User';
import ExtractedData from '../models/ExtractedData';
import logger from '../logger';
import {
  ADMIN_COOKIE,
  adminCookieOptions,
  getAdminPasswordConfigured,
  requireAdmin,
  signAdminToken,
  timingSafeEqualString,
} from '../middlewares/auth';
import {
  batchExtractedRowCounts,
  buildDashboardStatus,
  computeRunDurationMs,
  getAutomationConfig,
} from '../services/automation';
import { syncAutomationSchedule, resolveEffectiveScheduleState } from '../services/automationScheduler';
import { deleteAutomationCascade } from '../services/deleteAutomation';
import { SCRAPER_JOB_CONCURRENCY } from '../queue/scraperQueue';
import {
  getDigitalOceanDashboard,
  parseMetricsWindow,
} from '../services/digitalOceanMetrics';
import {
  getOpsDigestConfigStatus,
  sendOpsDigest,
} from '../services/opsDigest';
import { ownerIdFilter, ownerIdVariants } from '../utils/ownerId';
import { normalizeAutomationUrl } from '../utils/automationUrl';
import { intervalMsFromCron, validateAutomationScheduleCron } from '../utils/schedule';
import { sanitizeAutomationTags } from '../constants/tagCatalog';
import { isValidScoutId, normalizeScoutIdInput } from '../utils/scoutId';

const router = Router();

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
/** Secure + SameSite=None only work on HTTPS. HTTP Droplet must use lax + secure:false. */
const cookieSecure = (process.env.PUBLIC_URL || '').trim().toLowerCase().startsWith('https:');
const cookieSameSite: 'none' | 'lax' =
  IS_PRODUCTION && cookieSecure ? 'none' : 'lax';

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many admin login attempts. Try again later.' },
});

const parseListPagination = (req: Request) => {
  const rawPage = parseInt(String(req.query.page ?? '1'), 10);
  const rawLimit = parseInt(String(req.query.limit ?? '20'), 10);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;
  // Keep page sizes small — admin UIs should page, not dump thousands of rows.
  const limit = Math.min(50, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 20));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

const triggerLabel = (run: any): string => {
  if (run.runByScheduleId) return 'scheduled';
  if (run.runBySDK) return 'sdk';
  if (run.runByAPI) return 'api';
  if (run.runByUserId) return 'manual';
  return 'unknown';
};

async function buildOwnerMaps(robotMetaIds: string[]) {
  const robots = await Robot.find({ 'recording_meta.id': { $in: robotMetaIds } })
    .select('userId recording_meta.id recording_meta.name recording_meta.url recording_meta.saasConfig')
    .lean();

  const robotByMetaId = new Map<string, any>();
  const userIds = new Set<string>();
  for (const robot of robots) {
    const metaId = robot.recording_meta?.id;
    if (!metaId) continue;
    robotByMetaId.set(metaId, robot);
    if (robot.userId != null) userIds.add(String(robot.userId));
  }

  const users = await User.find({
    _id: { $in: Array.from(userIds).filter((id) => /^[0-9a-fA-F]{24}$/.test(id)) },
  })
    .select('email')
    .lean();

  const emailByUserId = new Map<string, string>();
  for (const u of users) {
    emailByUserId.set(String(u._id), u.email || '');
  }

  // Also try numeric / string ids stored as-is on older robots
  const leftoverIds = Array.from(userIds).filter((id) => !emailByUserId.has(id));
  if (leftoverIds.length) {
    const more = await User.find({
      $or: [{ _id: { $in: leftoverIds } }, { id: { $in: leftoverIds } }],
    })
      .select('email')
      .lean()
      .catch(() => []);
    for (const u of more as any[]) {
      emailByUserId.set(String(u._id), u.email || '');
      if (u.id != null) emailByUserId.set(String(u.id), u.email || '');
    }
  }

  return { robotByMetaId, emailByUserId };
}

function getCompanyName(robot: any): string {
  const meta = robot?.recording_meta || {};
  const fromMeta = typeof meta.companyName === 'string' ? meta.companyName.trim() : '';
  if (fromMeta) return fromMeta;
  const fromSaas =
    typeof meta.saasConfig?.companyName === 'string' ? meta.saasConfig.companyName.trim() : '';
  return fromSaas || '';
}

function getAutomationTags(robot: any): string[] {
  const meta = robot?.recording_meta || {};
  const fromMeta = Array.isArray(meta.tags) ? meta.tags : null;
  if (fromMeta) {
    return fromMeta.map((t: any) => String(t || '').trim()).filter(Boolean);
  }
  const fromSaas = Array.isArray(meta.saasConfig?.tags) ? meta.saasConfig.tags : [];
  return fromSaas.map((t: any) => String(t || '').trim()).filter(Boolean);
}

function getScoutId(robot: any): string | null {
  const id = robot?.recording_meta?.scoutId;
  return typeof id === 'string' && id.trim() ? id.trim().toUpperCase() : null;
}

/** Cross-account resolve by UUID or Scout-X ID (admin only). */
async function findAdminRobotByIdOrScoutId(idOrScout: string) {
  const raw = String(idOrScout || '').trim();
  if (!raw) return null;

  let robot = await Robot.findOne({ 'recording_meta.id': raw });
  if (robot) return robot;

  const scoutId = normalizeScoutIdInput(raw);
  if (scoutId && isValidScoutId(scoutId)) {
    robot = await Robot.findOne({ 'recording_meta.scoutId': scoutId });
  }
  return robot;
}

function mapAdminAutomation(robot: any, latestRun?: any, rowsExtracted: number = 0) {
  const config = getAutomationConfig(robot);
  const eff = resolveEffectiveScheduleState(robot);
  const hasInterval = !!(eff.cron || eff.every);
  const rootSch = robot.schedule || {};
  const nextRunIso =
    rootSch.nextRunAt != null ? new Date(rootSch.nextRunAt).toISOString() : null;
  const lastRunIso =
    rootSch.lastRunAt != null ? new Date(rootSch.lastRunAt).toISOString() : null;
  const schedule =
    eff.enabled || hasInterval
      ? {
          enabled: eff.enabled,
          cron: eff.cron || '',
          every: eff.every,
          timezone: eff.timezone || 'UTC',
          paused: hasInterval && !eff.enabled,
          nextRunAt: nextRunIso,
          lastRunAt: lastRunIso,
        }
      : null;

  return {
    id: robot.recording_meta?.id,
    scoutId: getScoutId(robot),
    name: robot.recording_meta?.name || '',
    companyName: getCompanyName(robot),
    tags: getAutomationTags(robot),
    targetUrl: robot.recording_meta?.url || '',
    createdAt: robot.recording_meta?.createdAt || null,
    updatedAt: robot.recording_meta?.updatedAt || null,
    status: buildDashboardStatus(latestRun),
    lastRunTime: latestRun?.finishedAt || latestRun?.startedAt || null,
    rowsExtracted,
    latestRunId: latestRun?.runId || null,
    webhookUrl: config.webhookUrl || '',
    schedule,
    ownerUserId: robot.userId != null ? String(robot.userId) : null,
  };
}

async function loadLatestRunsByMetaIds(metaIds: string[]) {
  const latestByMeta = new Map<string, any>();
  if (!metaIds.length) return latestByMeta;

  const runs = await Run.find({ robotMetaId: { $in: metaIds } })
    .select('runId robotMetaId status startedAt finishedAt failureReason failureReasonSource')
    .sort({ _id: -1 })
    .lean();

  for (const run of runs) {
    const metaId = String(run.robotMetaId || '');
    if (!metaId || latestByMeta.has(metaId)) continue;
    latestByMeta.set(metaId, run);
  }
  return latestByMeta;
}

function enrichAdminRun(run: any, robot: any | undefined, emailByUserId: Map<string, string>, rowsExtracted: number) {
  const durationMs =
    typeof run.duration === 'number' && run.duration > 0
      ? run.duration
      : computeRunDurationMs(run.startedAt, run.finishedAt);
  const ownerUserId = robot?.userId != null ? String(robot.userId) : null;
  const ownerEmail = ownerUserId ? emailByUserId.get(ownerUserId) || null : null;
  const config = robot ? getAutomationConfig(robot) : {};
  const denormalizedRows =
    typeof run.rowsExtracted === 'number' ? run.rowsExtracted : rowsExtracted;

  return {
    runId: run.runId,
    name: run.name || robot?.recording_meta?.name || 'Run',
    status: run.status,
    robotMetaId: run.robotMetaId,
    robotId: run.robotId || null,
    targetUrl: robot?.recording_meta?.url || null,
    ownerUserId,
    ownerEmail,
    startedAt: run.startedAt || null,
    finishedAt: run.finishedAt || null,
    durationMs,
    durationSeconds: durationMs != null ? Math.round(durationMs / 1000) : null,
    browserId: run.browserId || null,
    retryCount: run.retryCount ?? 0,
    errorMessage: run.errorMessage || null,
    queueJobId: run.queueJobId || null,
    trigger: triggerLabel(run),
    runByUserId: run.runByUserId ?? null,
    runByScheduleId: run.runByScheduleId ?? null,
    runByAPI: !!run.runByAPI,
    runBySDK: !!run.runBySDK,
    rowsExtracted: denormalizedRows,
    anomaly: run.anomaly || null,
    anomalyMeta: run.anomalyMeta || null,
    hasSerializableOutput: !!(run.serializableOutput && Object.keys(run.serializableOutput).length),
    hasBinaryOutput: !!(run.binaryOutput && Object.keys(run.binaryOutput).length),
    screenshotCount:
      run.binaryOutput && typeof run.binaryOutput === 'object'
        ? Object.keys(run.binaryOutput).length
        : 0,
    logBytes: typeof run.log === 'string' ? Buffer.byteLength(run.log, 'utf8') : 0,
    interpreterSettings: run.interpreterSettings || null,
    automationConfigSummary: {
      maxPages: config?.listExtraction?.pagination?.maxPages ?? null,
      paginationMode: config?.listExtraction?.pagination?.mode ?? null,
      autoScroll: !!config?.listExtraction?.autoScroll,
      maxItems: config?.listExtraction?.maxItems ?? null,
      webhookEnabled: !!config?.destinations?.webhook?.enabled || !!config?.webhookUrl,
      scheduleCron: config?.schedule?.cron || null,
    },
  };
}

/**
 * POST /api/admin/login
 * Body: { password }
 */
router.post('/admin/login', adminLoginLimiter, async (req: Request, res: Response) => {
  try {
    if (!getAdminPasswordConfigured()) {
      return res.status(503).json({
        error: 'Admin gate is not configured. Set ADMIN_PASSWORD on the server.',
      });
    }

    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const expected = String(process.env.ADMIN_PASSWORD || '');

    if (!password || !timingSafeEqualString(password, expected)) {
      // Small delay to slow brute force slightly beyond rate limit
      await new Promise((r) => setTimeout(r, 300 + crypto.randomInt(200)));
      return res.status(401).json({ error: 'Invalid admin password' });
    }

    const token = signAdminToken();
    if (!token) {
      return res.status(500).json({ error: 'Server misconfigured (JWT_SECRET)' });
    }

    res.cookie(ADMIN_COOKIE, token, adminCookieOptions(cookieSecure, cookieSameSite));
    logger.log('info', 'Admin session started');
    return res.json({ success: true, expiresInSeconds: 60 * 60 * 12 });
  } catch (error: any) {
    logger.log('error', `Admin login failed: ${error.message}`);
    return res.status(500).json({ error: 'Admin login failed' });
  }
});

router.post('/admin/logout', (_req: Request, res: Response) => {
  res.clearCookie(ADMIN_COOKIE, {
    path: '/',
    secure: cookieSecure,
    sameSite: cookieSameSite,
  });
  return res.json({ success: true });
});

router.get('/admin/session', (req: Request, res: Response) => {
  if (!getAdminPasswordConfigured()) {
    return res.json({ authenticated: false, configured: false });
  }
  // Soft check without failing — UI needs this before showing the form vs dashboard
  const token = req.cookies?.[ADMIN_COOKIE];
  if (!token || !process.env.JWT_SECRET) {
    return res.json({ authenticated: false, configured: true });
  }
  try {
    const payload: any = verify(token, process.env.JWT_SECRET);
    if (payload?.role === 'admin' && payload?.typ === 'admin') {
      return res.json({ authenticated: true, configured: true });
    }
  } catch {
    /* expired */
  }
  return res.json({ authenticated: false, configured: true });
});

/**
 * Ops / compute overview across the whole Scout-X instance.
 */
router.get('/admin/overview', requireAdmin, async (_req: Request, res: Response) => {
  try {
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

    const statusAgg = await Run.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]);
    const byStatus: Record<string, number> = {};
    let totalRuns = 0;
    for (const row of statusAgg) {
      byStatus[row._id || 'unknown'] = row.count;
      totalRuns += row.count;
    }

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const activeStatuses = ['running', 'pending', 'queued'];
    const [runsLast24h, durationStats, robotCount, userCount, activeNow] = await Promise.all([
      Run.countDocuments({
        $or: [{ startedAt: { $gte: since24h } }, { finishedAt: { $gte: since24h } }],
      }),
      Run.aggregate([
        {
          $match: {
            $or: [{ startedAt: { $gte: since24h } }, { finishedAt: { $gte: since24h } }],
            duration: { $gt: 0 },
          },
        },
        {
          $group: {
            _id: null,
            avg: { $avg: '$duration' },
            count: { $sum: 1 },
          },
        },
      ]),
      Robot.countDocuments(),
      User.countDocuments(),
      Run.countDocuments({ status: { $in: activeStatuses } }),
    ]);

    // Approximate p95 from duration values only (small payload even at ~10k runs)
    const durationDocs = await Run.find({
      $or: [{ startedAt: { $gte: since24h } }, { finishedAt: { $gte: since24h } }],
      duration: { $gt: 0 },
    })
      .select('duration')
      .lean();
    const sampleVals = durationDocs
      .map((r: any) => Number(r.duration))
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b);
    const p95DurationMs =
      sampleVals.length > 0
        ? sampleVals[Math.min(sampleVals.length - 1, Math.floor(sampleVals.length * 0.95))]
        : null;
    const avgDurationMs =
      durationStats[0]?.avg != null
        ? Math.round(durationStats[0].avg)
        : sampleVals.length > 0
          ? Math.round(sampleVals.reduce((s, n) => s + n, 0) / sampleVals.length)
          : null;

    return res.json({
      generatedAt: new Date().toISOString(),
      totals: {
        runs: totalRuns,
        robots: robotCount,
        users: userCount,
        activeRunsNow: activeNow,
        runsLast24h,
      },
      byStatus,
      compute: {
        scraperWorkerConcurrency: SCRAPER_JOB_CONCURRENCY,
        scraperJobTimeoutMs: parseInt(process.env.SCRAPER_JOB_TIMEOUT_MS || '120000', 10),
        scraperMaxAttempts: parseInt(process.env.SCRAPER_MAX_ATTEMPTS || '3', 10),
        runEmbeddedWorkers: process.env.RUN_EMBEDDED_WORKERS !== 'false',
        nodeEnv: process.env.NODE_ENV || 'development',
        defaultBrowserType: process.env.DEFAULT_BROWSER_TYPE || 'playwright',
        activeBrowsers: browserPoolStats.activeBrowsers,
        activeBrowserIds: browserPoolStats.browserIds,
        avgDurationMsLast24h: avgDurationMs,
        p95DurationMsLast24h: p95DurationMs,
        memoryUsage: process.memoryUsage(),
        uptimeSeconds: Math.round(process.uptime()),
      },
    });
  } catch (error: any) {
    logger.log('error', `Admin overview failed: ${error.message}`);
    return res.status(500).json({ error: 'Failed to load admin overview' });
  }
});

/**
 * Paginated list of ALL runs (every scout account).
 */
router.get('/admin/runs', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { page, limit, skip } = parseListPagination(req);
    const statusFilter = req.query.status != null ? String(req.query.status).trim() : '';
    const ownerEmailFilter =
      req.query.ownerEmail != null ? String(req.query.ownerEmail).trim().toLowerCase() : '';
    const q = req.query.q != null ? String(req.query.q).trim() : '';

    const match: any = {};
    if (statusFilter) match.status = statusFilter;
    if (q) {
      match.$or = [
        { name: { $regex: q, $options: 'i' } },
        { runId: { $regex: q, $options: 'i' } },
        { robotMetaId: { $regex: q, $options: 'i' } },
        { errorMessage: { $regex: q, $options: 'i' } },
      ];
    }

    // Optional owner email filter → resolve robotMetaIds first
    let ownerMetaFilter: string[] | null = null;
    if (ownerEmailFilter) {
      const users = await User.find({ email: { $regex: `^${ownerEmailFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, $options: 'i' } })
        .select('_id')
        .lean();
      const ids = users.map((u) => u._id);
      const robots = await Robot.find({ userId: { $in: ids } })
        .select('recording_meta.id')
        .lean();
      ownerMetaFilter = robots.map((r) => r.recording_meta?.id).filter(Boolean);
      if (!ownerMetaFilter.length) {
        return res.json({
          runs: [],
          pagination: { page, limit, total: 0, totalPages: 1 },
        });
      }
      match.robotMetaId = { $in: ownerMetaFilter };
    }

    // Prefer indexed find + _id sort: full-collection date conversion sort OOMs (~32MB) at ~10k runs.
    const [total, pageRuns] = await Promise.all([
      Run.countDocuments(match),
      Run.find(match)
        .select(
          'runId name status robotMetaId robotId startedAt finishedAt browserId retryCount duration errorMessage queueJobId runByUserId runByScheduleId runByAPI runBySDK interpreterSettings rowsExtracted anomaly anomalyMeta'
        )
        .sort({ _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);
    const totalPages = total === 0 ? 1 : Math.ceil(total / limit);

    const metaIds = pageRuns
      .map((r: any) => String(r.robotMetaId || ''))
      .filter((id: string) => id.length > 0)
      .filter((id: string, i: number, arr: string[]) => arr.indexOf(id) === i);
    const { robotByMetaId, emailByUserId } = await buildOwnerMaps(metaIds);
    const runIds = pageRuns.map((r: any) => String(r.runId || '')).filter((id: string) => id.length > 0);
    const countMap = await batchExtractedRowCounts(runIds);

    const runs = pageRuns.map((run: any) =>
      enrichAdminRun(run, robotByMetaId.get(run.robotMetaId), emailByUserId, countMap.get(run.runId) || 0)
    );

    return res.json({
      runs,
      pagination: { page, limit, total, totalPages },
    });
  } catch (error: any) {
    logger.log('error', `Admin runs list failed: ${error.message}`);
    return res.status(500).json({ error: 'Failed to fetch admin runs' });
  }
});

/**
 * Full detail for one run (cross-account). Includes logs, outputs summary, extracted rows sample.
 */
router.get('/admin/runs/:runId', requireAdmin, async (req: Request, res: Response) => {
  try {
    const run: any = await Run.findOne({ runId: req.params.runId }).lean();
    if (!run) {
      return res.status(404).json({ error: 'Run not found' });
    }

    const { robotByMetaId, emailByUserId } = await buildOwnerMaps([run.robotMetaId]);
    const robot = robotByMetaId.get(run.robotMetaId);
    const rowsExtracted = await ExtractedData.countDocuments({ runId: run.runId });
    const summary = enrichAdminRun(run, robot, emailByUserId, rowsExtracted);

    const extractedSample = await ExtractedData.find({ runId: run.runId })
      .sort({ createdAt: 1 })
      .limit(20)
      .lean();

    const logText = typeof run.log === 'string' ? run.log : '';
    const logLines = logText ? logText.split('\n').filter(Boolean) : [];
    const binaryEntries =
      run.binaryOutput && typeof run.binaryOutput === 'object'
        ? Object.entries(run.binaryOutput)
        : [];

    return res.json({
      run: {
        ...summary,
        // Cap heavy fields — full history stays in DB; admin page is for inspection, not bulk export.
        logLines: logLines.slice(-200),
        logTruncated: logLines.length > 200,
        serializableOutput: run.serializableOutput || {},
        binaryOutputKeys: binaryEntries.map(([key]) => key),
        screenshots: binaryEntries.slice(0, 3).map(([key, value]) => ({ key, value })),
        screenshotsTruncated: binaryEntries.length > 3,
        rawInterpreterSettings: run.interpreterSettings || null,
      },
      automation: robot
        ? {
            id: robot.recording_meta?.id,
            name: robot.recording_meta?.name,
            targetUrl: robot.recording_meta?.url || '',
            ownerUserId: robot.userId != null ? String(robot.userId) : null,
            ownerEmail: robot.userId != null ? emailByUserId.get(String(robot.userId)) || null : null,
            config: getAutomationConfig(robot),
          }
        : null,
      extractedRowsSample: extractedSample.map((row: any) => ({
        id: String(row.id || row._id),
        source: row.source,
        data: row.data,
        createdAt: row.createdAt,
      })),
      extractedRowsTotal: rowsExtracted,
      extractedRowsTruncated: rowsExtracted > 20,
      durationMs: summary.durationMs,
    });
  } catch (error: any) {
    logger.log('error', `Admin run detail failed: ${error.message}`);
    return res.status(500).json({ error: 'Failed to fetch admin run detail' });
  }
});

/**
 * DigitalOcean droplet compute metrics for the /admin panel.
 * Query: window=1h|6h|24h
 */
router.get('/admin/digitalocean', requireAdmin, async (req: Request, res: Response) => {
  try {
    const window = parseMetricsWindow(
      req.query.window != null ? String(req.query.window) : '6h'
    );
    const dashboard = await getDigitalOceanDashboard(window);
    return res.json(dashboard);
  } catch (error: any) {
    logger.log('error', `Admin DigitalOcean metrics failed: ${error.message}`);
    return res.status(500).json({ error: 'Failed to load DigitalOcean metrics' });
  }
});

/**
 * Paginated accounts with automation counts (includes orphan robot owners).
 * Query: q (email / userId substring), page, limit
 */
router.get('/admin/users', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { page, limit, skip } = parseListPagination(req);
    const q = req.query.q != null ? String(req.query.q).trim() : '';
    const qLower = q.toLowerCase();

    const countAgg = await Robot.aggregate([
      { $group: { _id: '$userId', count: { $sum: 1 } } },
    ]);
    const countByUserId = new Map<string, number>();
    for (const row of countAgg) {
      if (row._id == null) continue;
      countByUserId.set(String(row._id), row.count || 0);
    }

    const users = await User.find({})
      .select('email')
      .lean();

    type AdminUserRow = {
      id: string;
      email: string | null;
      automationCount: number;
      orphan?: boolean;
    };
    const rows: AdminUserRow[] = [];
    const claimedCountKeys = new Set<string>();

    const sumCountsForUser = (userId: string): number => {
      let totalCount = 0;
      const keys = new Set<string>();
      for (const variant of ownerIdVariants(userId)) {
        keys.add(String(variant));
      }
      keys.add(userId);
      for (const key of keys) {
        const n = countByUserId.get(key);
        if (n) {
          totalCount += n;
          claimedCountKeys.add(key);
        }
      }
      return totalCount;
    };

    for (const u of users) {
      const id = String(u._id);
      const email = u.email || null;
      if (q) {
        const emailMatch = email ? email.toLowerCase().includes(qLower) : false;
        const idMatch = id.toLowerCase().includes(qLower);
        if (!emailMatch && !idMatch) continue;
      }
      rows.push({
        id,
        email,
        automationCount: sumCountsForUser(id),
      });
    }

    // Orphan robot owners (userId on robots with no matching User doc)
    for (const [ownerId, count] of countByUserId.entries()) {
      if (claimedCountKeys.has(ownerId)) continue;
      if (q) {
        const idMatch = ownerId.toLowerCase().includes(qLower);
        if (!idMatch) continue;
      }
      claimedCountKeys.add(ownerId);
      rows.push({
        id: ownerId,
        email: null,
        automationCount: count,
        orphan: true,
      });
    }

    rows.sort((a, b) => {
      const ae = (a.email || '').toLowerCase();
      const be = (b.email || '').toLowerCase();
      if (ae && be) return ae.localeCompare(be);
      if (ae) return -1;
      if (be) return 1;
      return a.id.localeCompare(b.id);
    });

    const total = rows.length;
    const totalPages = total === 0 ? 1 : Math.ceil(total / limit);
    const pageRows = rows.slice(skip, skip + limit);

    return res.json({
      users: pageRows,
      pagination: { page, limit, total, totalPages },
    });
  } catch (error: any) {
    logger.log('error', `Admin users list failed: ${error.message}`);
    return res.status(500).json({ error: 'Failed to fetch admin users' });
  }
});

/**
 * Automations owned by a given account (cross-account admin).
 */
router.get('/admin/users/:userId/automations', requireAdmin, async (req: Request, res: Response) => {
  try {
    const userId = String(req.params.userId || '').trim();
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const { page, limit, skip } = parseListPagination(req);
    const ownerFilter = ownerIdFilter(userId);

    const [total, robots] = await Promise.all([
      Robot.countDocuments(ownerFilter),
      Robot.find(ownerFilter)
        .select(
          [
            'userId',
            'schedule',
            'recording_meta.id',
            'recording_meta.scoutId',
            'recording_meta.name',
            'recording_meta.companyName',
            'recording_meta.tags',
            'recording_meta.url',
            'recording_meta.createdAt',
            'recording_meta.updatedAt',
            'recording_meta.saasConfig.webhookUrl',
            'recording_meta.saasConfig.schedule',
            'recording_meta.saasConfig.companyName',
            'recording_meta.saasConfig.tags',
          ].join(' ')
        )
        .sort({ _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    const metaIds = robots
      .map((r: any) => String(r.recording_meta?.id || ''))
      .filter(Boolean);
    const latestByMeta = await loadLatestRunsByMetaIds(metaIds);
    const latestRunIds = Array.from(latestByMeta.values())
      .map((r: any) => String(r.runId || ''))
      .filter(Boolean);
    const rowCounts = await batchExtractedRowCounts(latestRunIds);

    const automations = robots.map((robot: any) => {
      const metaId = String(robot.recording_meta?.id || '');
      const latestRun = latestByMeta.get(metaId);
      const rowsExtracted = latestRun?.runId
        ? rowCounts.get(String(latestRun.runId)) || 0
        : 0;
      return mapAdminAutomation(robot, latestRun, rowsExtracted);
    });

    const totalPages = total === 0 ? 1 : Math.ceil(total / limit);
    return res.json({
      automations,
      pagination: { page, limit, total, totalPages },
    });
  } catch (error: any) {
    logger.log('error', `Admin user automations list failed: ${error.message}`);
    return res.status(500).json({ error: 'Failed to fetch user automations' });
  }
});

/**
 * Ops-friendly update of automation metadata + optional schedule (cross-account).
 * Body: { name?, startUrl?, companyName?, tags?, webhookUrl?, schedule?: { enabled, cron, timezone } }
 */
router.put('/admin/automations/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const robot = await findAdminRobotByIdOrScoutId(req.params.id);
    if (!robot) {
      return res.status(404).json({ error: 'Automation not found' });
    }

    const {
      name,
      startUrl,
      companyName: bodyCompany,
      tags: bodyTags,
      webhookUrl,
      schedule: bodySchedule,
    } = req.body || {};

    const prevSaas = getAutomationConfig(robot) || {};
    const nextSaasConfig: Record<string, any> = { ...prevSaas };

    if (typeof webhookUrl === 'string') {
      nextSaasConfig.webhookUrl = webhookUrl.trim();
    }

    let tagsToSet: string[] | undefined;
    if (bodyTags !== undefined) {
      const tagsResult = sanitizeAutomationTags(bodyTags);
      if (!tagsResult.ok) {
        return res.status(400).json({ error: tagsResult.error });
      }
      tagsToSet = tagsResult.tags;
      nextSaasConfig.tags = tagsToSet;
    }

    const companyName =
      typeof bodyCompany === 'string' ? bodyCompany.trim() : undefined;
    if (companyName !== undefined) {
      nextSaasConfig.companyName = companyName;
    }

    let normalizedStartUrl: string | undefined;
    if (typeof startUrl === 'string' && startUrl.trim()) {
      try {
        normalizedStartUrl = normalizeAutomationUrl(startUrl);
      } catch (e: any) {
        return res.status(400).json({ error: e?.message || 'Invalid start URL' });
      }
    }

    const nextName =
      typeof name === 'string' && name.trim() ? name.trim() : robot.recording_meta?.name;

    let nextMeta: any = {
      ...robot.recording_meta,
      name: nextName,
      updatedAt: new Date().toLocaleString(),
      ...(normalizedStartUrl ? { url: normalizedStartUrl } : {}),
      ...(companyName !== undefined ? { companyName } : {}),
      ...(tagsToSet !== undefined ? { tags: tagsToSet } : {}),
      saasConfig: nextSaasConfig,
    };

    let nextSchedule = robot.schedule;

    if (bodySchedule && typeof bodySchedule === 'object') {
      const { enabled, cron, timezone } = bodySchedule as {
        enabled?: boolean;
        cron?: string | null;
        timezone?: string;
      };

      const existingSaasSchedule = nextSaasConfig.schedule || {};
      const rootSchedule = robot.schedule || {};
      const storedCron =
        (typeof existingSaasSchedule.cron === 'string' && existingSaasSchedule.cron.trim()) ||
        (typeof rootSchedule.cron === 'string' && rootSchedule.cron.trim()) ||
        '';

      if (timezone && !moment.tz.zone(timezone)) {
        return res.status(400).json({ error: 'Invalid timezone' });
      }

      const tz =
        (timezone && moment.tz.zone(timezone) ? timezone : '') ||
        (typeof existingSaasSchedule.timezone === 'string' &&
        moment.tz.zone(existingSaasSchedule.timezone)
          ? existingSaasSchedule.timezone
          : '') ||
        (typeof (rootSchedule as any).timezone === 'string' &&
        moment.tz.zone((rootSchedule as any).timezone)
          ? (rootSchedule as any).timezone
          : '') ||
        'UTC';

      const wantEnabled = !!enabled;
      let nextCron = '';
      if (typeof cron === 'string' && cron.trim()) {
        nextCron = cron.trim();
      } else if (cron === null || cron === undefined || (typeof cron === 'string' && !cron.trim())) {
        if (wantEnabled) {
          return res.status(400).json({ error: 'cron is required when enabling a schedule' });
        }
        nextCron = storedCron;
      }

      if (wantEnabled && !nextCron) {
        return res.status(400).json({ error: 'cron is required when enabling a schedule' });
      }

      if (nextCron) {
        const v = validateAutomationScheduleCron(nextCron, tz);
        if (!v.ok) {
          return res.status(400).json({ error: v.error });
        }
      }

      const scheduleEnabled = wantEnabled && !!nextCron;
      const everyMs = nextCron ? intervalMsFromCron(nextCron) : null;
      nextSaasConfig.schedule = {
        enabled: scheduleEnabled,
        cron: nextCron,
        timezone: tz,
        ...(everyMs ? { every: everyMs } : { every: undefined }),
      };
      nextMeta = {
        ...nextMeta,
        saasConfig: nextSaasConfig,
      };

      nextSchedule = await syncAutomationSchedule(
        {
          ...robot.toJSON(),
          recording_meta: nextMeta,
          schedule: robot.schedule,
        },
        robot.userId,
        tz,
        { packSlots: true }
      );
    }

    robot.recording_meta = nextMeta;
    if (bodySchedule && typeof bodySchedule === 'object') {
      robot.schedule = nextSchedule;
    }
    robot.markModified('recording_meta');
    await robot.save();

    const automationId = String(nextMeta.id || '');
    const latestByMeta = await loadLatestRunsByMetaIds(automationId ? [automationId] : []);
    const latestRun = latestByMeta.get(automationId);
    const rowsExtracted = latestRun?.runId
      ? (await batchExtractedRowCounts([String(latestRun.runId)])).get(String(latestRun.runId)) || 0
      : 0;

    logger.log(
      'info',
      `Admin updated automation ${automationId} (owner=${robot.userId})`
    );

    return res.json({
      success: true,
      automation: mapAdminAutomation(robot.toJSON(), latestRun, rowsExtracted),
    });
  } catch (error: any) {
    logger.log('error', `Admin automation update failed: ${error.message}`);
    return res.status(500).json({ error: 'Failed to update automation' });
  }
});

/**
 * Cascade-delete an automation for any account.
 */
router.delete('/admin/automations/:id', requireAdmin, async (req: Request, res: Response) => {
  try {
    const robot = await findAdminRobotByIdOrScoutId(req.params.id);
    if (!robot) {
      return res.status(404).json({ error: 'Automation not found' });
    }

    const automationId = String(robot.recording_meta?.id || '');
    if (!automationId) {
      return res.status(404).json({ error: 'Automation not found' });
    }

    await deleteAutomationCascade(robot.userId, automationId);
    logger.log(
      'info',
      `Admin deleted automation ${automationId} (owner=${robot.userId})`
    );
    return res.json({ success: true });
  } catch (error: any) {
    if (error?.statusCode === 404) {
      return res.status(404).json({ error: error.message || 'Automation not found' });
    }
    logger.log('error', `Admin automation delete failed: ${error.message}`);
    return res.status(500).json({ error: 'Failed to delete automation' });
  }
});

/**
 * Digest / ZeptoMail configuration status (no secrets).
 */
router.get('/admin/digest/status', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const status = getOpsDigestConfigStatus();
    return res.json({
      ...status,
      interval: '6 hours',
    });
  } catch (error: any) {
    logger.log('error', `Admin digest status failed: ${error.message}`);
    return res.status(500).json({ error: 'Failed to load digest status' });
  }
});

/**
 * Send ops digest immediately (test / manual).
 */
router.post('/admin/digest/test', requireAdmin, async (_req: Request, res: Response) => {
  try {
    const result = await sendOpsDigest({ force: true });
    if (result.skipped) {
      return res.status(400).json({
        success: false,
        skipped: true,
        reason: result.reason,
      });
    }
    if (!result.ok) {
      return res.status(502).json({
        success: false,
        error: result.error || 'Failed to send digest',
      });
    }
    return res.json({
      success: true,
      requestId: result.requestId || null,
      summary: result.payload
        ? {
            generatedAt: result.payload.generatedAt,
            last6h: {
              total: result.payload.windows.last6h.total,
              passed: result.payload.windows.last6h.passed,
              failed: result.payload.windows.last6h.failed,
            },
          }
        : null,
    });
  } catch (error: any) {
    logger.log('error', `Admin digest test failed: ${error.message}`);
    return res.status(500).json({ error: 'Failed to send ops digest' });
  }
});

export default router;

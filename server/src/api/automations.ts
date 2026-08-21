import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { requireSignInOrApiKey } from '../middlewares/auth';
import Robot from '../models/Robot';
import Run from '../models/Run';
import ExtractedData from '../models/ExtractedData';
import logger from '../logger';
import moment from 'moment-timezone';
import { syncAutomationSchedule, resolveEffectiveScheduleState, readRobotScheduleTimestamps, repackAllAutomationSchedules } from '../services/automationScheduler';
import { reconfigureDailySchedulesForOwner } from '../services/scheduleReconfigure';
import {
  applyColumnOverrides,
  applyReadPipelineToExtractedData,
  batchExtractedRowCounts,
  buildDashboardStatus,
  ColumnOverride,
  computeRunDurationMs,
  enrichRunForList,
  enrichRunForSaas,
  extractRowsFromOutput,
  getAutomationConfig,
  mergeRowContextIntoRowData,
  ROW_CONTEXT_KEYS,
  sanitizeRowContextFields,
} from '../services/automation';
import { CANONICAL_JOB_FIELD_ORDER } from '../services/canonicalJobRecord';
import { intervalMsFromCron, suggestPreferredStartSlots, validateAutomationScheduleCron } from '../utils/schedule';
import { deleteAutomationCascade } from '../services/deleteAutomation';
import { DEFAULT_JOB_DATABASE_TARGET_COLUMNS } from '../constants/defaultJobDatabaseColumns';
import { ownerIdFilter, normalizeOwnerIdForWrite } from '../utils/ownerId';
import { normalizeAutomationUrl } from '../utils/automationUrl';
import {
  generateUniqueScoutId,
  isValidScoutId,
  normalizeScoutIdInput,
} from '../utils/scoutId';
import { sanitizeAutomationTags } from '../constants/tagCatalog';
import {
  buildFailureReasonAggregationStages,
  FAILURE_REASON_CODES,
  isAllowedFailureReason,
} from '../utils/failureReason';
import { buildOpsMetrics, doWindowForOps, parseOpsMetricsDate, parseOpsMetricsWindow } from '../services/opsMetrics';
import { getDigitalOceanDashboardCached } from '../services/digitalOceanMetrics';
import { sendOpsDigest } from '../services/opsDigest';
import { mapOpsDigestSendResult, opsDigestStatusBody } from '../services/opsDigestHttp';
import { computeScheduleHeatmap } from '../services/scheduleHeatmap';
import { formatIstYmd, isIstDateOnDayStrip } from '../../../src/shared/opsTimezone';
import {
  accountRobotSummaryCache,
  buildLatestRunPerRobotPipeline,
  buildLatestRunPerRobotMatch,
  buildOwnerRunScope,
  buildRunFailureCountsPipeline,
  buildRunGroupsPipeline,
  buildRunListPaginationPipeline,
  filteredDashboardCacheKey,
  filteredDashboardRunTotalsCache,
  resolveRunListIndexHint,
  ROBOT_DASHBOARD_LIST_SELECT,
  parseRunListDateQuery,
} from '../services/dashboardQueries';
import {
  assertSafeOutboundUrl,
  createUnsafeOutboundUrlResponse,
  isUnsafeOutboundUrlError,
} from '../utils/outboundUrlPolicy';
import { validateDestinationWebhookSettings } from '../utils/webhookDeliverySettings';
import {
  mergeMaskedAutomationConfig,
  toPublicAutomationConfig,
} from '../services/automationConfigView';
import { AdmissionError, runAdmission } from '../services/runAdmission';
import {
  pageLegacyOutputRows,
  pageLogLinesFromEnd,
  redactLogPage,
} from '../services/runDetailPagination';

const router = Router();

const FAILURE_REASONS = new Set<string>(FAILURE_REASON_CODES);

type OutboundConfigurationError = Error & { outboundField?: string };

async function assertSafeConfigurationUrl(rawUrl: unknown, field: 'targetUrl' | 'webhookUrl') {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return;
  try {
    await assertSafeOutboundUrl(rawUrl);
  } catch (error) {
    if (isUnsafeOutboundUrlError(error)) {
      (error as OutboundConfigurationError).outboundField = field;
    }
    throw error;
  }
}

async function assertSafeAutomationConfiguration(input: {
  targetUrl?: unknown;
  webhookUrl?: unknown;
  config?: any;
}) {
  const webhookSettings = input.config?.destinations?.webhook;
  if (webhookSettings && typeof webhookSettings === 'object') {
    validateDestinationWebhookSettings(webhookSettings);
  }
  await assertSafeConfigurationUrl(input.targetUrl, 'targetUrl');
  const webhookCandidates = [
    input.webhookUrl,
    input.config?.webhookUrl,
    input.config?.destinations?.webhook?.url,
  ];
  const checked = new Set<string>();
  for (const candidate of webhookCandidates) {
    if (typeof candidate !== 'string' || !candidate.trim() || checked.has(candidate)) continue;
    checked.add(candidate);
    await assertSafeConfigurationUrl(candidate, 'webhookUrl');
  }
}

function sendUnsafeOutboundUrlResponse(res: any, error: OutboundConfigurationError) {
  const response = createUnsafeOutboundUrlResponse(
    error.outboundField || 'targetUrl',
    error as any
  );
  return res.status(response.status).json(response.body);
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
    const cleaned = fromMeta.map((t: any) => String(t || '').trim()).filter(Boolean);
    return cleaned;
  }
  const fromSaas = Array.isArray(meta.saasConfig?.tags) ? meta.saasConfig.tags : [];
  return fromSaas.map((t: any) => String(t || '').trim()).filter(Boolean);
}

function getScoutId(robot: any): string | null {
  const id = robot?.recording_meta?.scoutId;
  return typeof id === 'string' && id.trim() ? id.trim().toUpperCase() : null;
}

/** Resolve automation by UUID (recording_meta.id) or Scout-X ID. */
async function findRobotByIdOrScoutId(userId: any, idOrScout: string) {
  const owner = ownerIdFilter(userId);
  const raw = String(idOrScout || '').trim();
  if (!raw) return null;

  let robot = await Robot.findOne({ ...owner, 'recording_meta.id': raw });
  if (robot) return robot;

  const scoutId = normalizeScoutIdInput(raw);
  if (scoutId && isValidScoutId(scoutId)) {
    robot = await Robot.findOne({ ...owner, 'recording_meta.scoutId': scoutId });
  }
  return robot;
}

async function scoutIdExistsForUser(userId: any, scoutId: string): Promise<boolean> {
  const existing = await Robot.findOne({
    ...ownerIdFilter(userId),
    'recording_meta.scoutId': scoutId,
  })
    .select('_id')
    .lean();
  return !!existing;
}

function normalizeDatabaseTargetColumns(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const list = raw.map((c) => String(c || '').trim()).filter(Boolean);
  return list;
}

/**
 * Trivial recording used for robots created via the Chrome extension (or any
 * API caller that doesn't supply a full maxun-core workflow). The recording
 * only contains a goto + waitForLoadState so the recorded-path Interpreter
 * (Engine 1) stays happy, but for these "configured" robots we always run
 * Engine 2 (`scraperWorker.processConfiguredListExtraction`) against the
 * `saasConfig.listExtraction` we stored alongside the robot. This comment is
 * here so future readers don't accidentally extend this default with
 * scrapeList actions — do that through `saasConfig.listExtraction` instead.
 */
const defaultWorkflow = (startUrl: string) => ({
  workflow: [
    {
      where: { url: 'about:blank' },
      what: [
        { action: 'goto', args: [startUrl] },
        { action: 'waitForLoadState', args: ['networkidle'] },
      ],
    },
  ],
});

const DEFAULT_LIST_LIMIT = 10;
const MAX_LIST_LIMIT = 100;

const parseListPagination = (req: any) => {
  const rawPage = parseInt(String(req.query.page ?? '1'), 10);
  const rawLimit = parseInt(String(req.query.limit ?? String(DEFAULT_LIST_LIMIT)), 10);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;
  const limit = Math.min(MAX_LIST_LIMIT, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : DEFAULT_LIST_LIMIT));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

const DETAIL_PAGE_DEFAULT = 100;
const DETAIL_PAGE_MAX = 100;

const parseDetailLimit = (raw: unknown) => {
  const value = parseInt(String(raw ?? DETAIL_PAGE_DEFAULT), 10);
  return Math.min(DETAIL_PAGE_MAX, Math.max(1, Number.isFinite(value) ? value : DETAIL_PAGE_DEFAULT));
};

const encodeDetailCursor = (value: Record<string, unknown>) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

const decodeDetailCursor = (raw: unknown): Record<string, any> | null => {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

type SaasRunListQuery = {
  page: number;
  limit: number;
  skip: number;
  empty: boolean;
  match: Record<string, unknown>;
  fromDate: Date | null;
  toDate: Date | null;
  minDurationMs: number | null;
  maxDurationMs: number | null;
  failureReasons: string[];
  excludeHealedFailures: boolean;
};

function parseOptionalNonNegativeNumber(raw: unknown): number | null {
  if (raw == null || String(raw).trim() === '') return null;
  const value = Number(String(raw).trim());
  return Number.isFinite(value) && value >= 0 ? value : null;
}

async function resolveSaasRunListQuery(req: any): Promise<SaasRunListQuery> {
  const { page, limit, skip } = parseListPagination(req);
  const emptyResult = (): SaasRunListQuery => ({
    page,
    limit,
    skip,
    empty: true,
    match: {},
    fromDate: null,
    toDate: null,
    minDurationMs: null,
    maxDurationMs: null,
    failureReasons: [],
    excludeHealedFailures: false,
  });

  const qFilter = req.query.q != null ? String(req.query.q).trim() : '';
  const robotMetaIdFilter = req.query.robotMetaId != null ? String(req.query.robotMetaId).trim() : '';

  const runExtras: Record<string, unknown> = {};
  let robotMetaConstraint: Record<string, unknown> | null = null;

  if (robotMetaIdFilter) {
    const owned = await Robot.findOne({
      ...ownerIdFilter(req.user.id),
      'recording_meta.id': robotMetaIdFilter,
    })
      .select('_id')
      .lean();
    if (!owned) {
      const err: any = new Error('Automation not found');
      err.statusCode = 404;
      throw err;
    }
    robotMetaConstraint = { robotMetaId: robotMetaIdFilter };
  } else if (qFilter) {
    const re = new RegExp(qFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const matchedIds = (await Robot.distinct('recording_meta.id', {
      ...ownerIdFilter(req.user.id),
      $or: [
        { 'recording_meta.name': re },
        { 'recording_meta.companyName': re },
        { 'recording_meta.saasConfig.companyName': re },
        { 'recording_meta.scoutId': re },
      ],
    })) as unknown[];
    const ids = matchedIds.filter(Boolean).map(String);
    if (!ids.length) {
      return emptyResult();
    }
    robotMetaConstraint = { robotMetaId: { $in: ids } };
  }

  if (robotMetaIdFilter && qFilter) {
    const re = new RegExp(qFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const robot = await Robot.findOne({
      ...ownerIdFilter(req.user.id),
      'recording_meta.id': robotMetaIdFilter,
    })
      .select('recording_meta.name recording_meta.companyName recording_meta.scoutId recording_meta.saasConfig')
      .lean();
    if (robot) {
      const name = String(robot.recording_meta?.name || '');
      const company = getCompanyName(robot);
      const scoutId = String(robot.recording_meta?.scoutId || '');
      if (!re.test(name) && !re.test(company) && !re.test(scoutId)) {
        return emptyResult();
      }
    }
  }

  const statusRaw = req.query.status != null ? String(req.query.status).trim() : '';
  if (statusRaw) {
    const statuses = statusRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (statuses.length === 1) {
      runExtras.status = statuses[0];
    } else if (statuses.length > 1) {
      runExtras.status = { $in: statuses };
    }
  }

  const anomalyRaw = req.query.anomaly != null ? String(req.query.anomaly).trim() : '';
  if (anomalyRaw) {
    runExtras.anomaly = anomalyRaw;
  }

  const failureReasonRaw =
    req.query.failureReason != null ? String(req.query.failureReason).trim() : '';
  let failureReasons: string[] = [];
  if (failureReasonRaw) {
    failureReasons = failureReasonRaw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => isAllowedFailureReason(s));
  }

  const minJobsAdded = parseOptionalNonNegativeNumber(req.query.minJobsAdded);
  const maxJobsAdded = parseOptionalNonNegativeNumber(req.query.maxJobsAdded);
  const jobsAddedExact = parseOptionalNonNegativeNumber(req.query.jobsAddedExact);
  if (jobsAddedExact != null) {
    runExtras.jobsAddedToBoard = jobsAddedExact;
  } else {
    const jobsRange: Record<string, number> = {};
    if (minJobsAdded != null) jobsRange.$gte = minJobsAdded;
    if (maxJobsAdded != null) jobsRange.$lte = maxJobsAdded;
    if (Object.keys(jobsRange).length) {
      runExtras.jobsAddedToBoard = jobsRange;
    }
  }

  const minDurationMs = parseOptionalNonNegativeNumber(req.query.minDurationMs);
  const maxDurationMs = parseOptionalNonNegativeNumber(req.query.maxDurationMs);

  const excludeHealedRaw = String(req.query.excludeHealed || '').trim().toLowerCase();
  const excludeHealedFailures =
    excludeHealedRaw === '1'
    || excludeHealedRaw === 'true'
    || excludeHealedRaw === 'yes';

  const { fromDate, toDate } = parseRunListDateQuery({
    date: req.query.date,
    from: req.query.from,
    to: req.query.to,
  });

  const ownedMetaIds = robotMetaIdFilter
    ? [robotMetaIdFilter]
    : ((await Robot.distinct('recording_meta.id', ownerIdFilter(req.user.id))) as unknown[])
        .map(String)
        .filter(Boolean);

  const match = buildOwnerRunScope(req.user.id, ownedMetaIds);
  Object.assign(match, runExtras, robotMetaConstraint || {});

  return {
    page,
    limit,
    skip,
    empty: false,
    match,
    fromDate,
    toDate,
    minDurationMs,
    maxDurationMs,
    failureReasons,
    excludeHealedFailures,
  };
}

/** Mirrors dashboard chips derived from `mapAutomation` schedule output. */
const robotScheduleSummaryFlags = (robot: any): { active: boolean; paused: boolean } => {
  const eff = resolveEffectiveScheduleState(robot);
  const hasInterval = !!(eff.cron || eff.every);
  const cronStr = (eff.cron || '').trim();
  const hasEvery = typeof eff.every === 'number' && eff.every > 0;
  if (!eff.enabled && !hasInterval) {
    return { active: false, paused: false };
  }
  const paused = hasInterval && !eff.enabled;
  const dashboardPaused = paused || (!!cronStr && !eff.enabled);
  const active = !!eff.enabled && (!!cronStr || hasEvery);
  return { active, paused: dashboardPaused };
};

async function computeAccountRobotSummary(userId: any) {
  const cacheKey = `account:${normalizeOwnerIdForWrite(userId)}`;
  const cached = accountRobotSummaryCache.get(cacheKey);
  if (cached) return cached;

  let activeScheduledCount = 0;
  let pausedScheduleCount = 0;
  // Only schedule fields — never pull recording workflows for summary chips.
  const cursor = Robot.find(ownerIdFilter(userId))
    .select('schedule recording_meta.saasConfig.schedule')
    .lean()
    .cursor();
  for await (const robot of cursor) {
    const { active, paused } = robotScheduleSummaryFlags(robot);
    if (active) activeScheduledCount += 1;
    if (paused) pausedScheduleCount += 1;
  }
  const summary = { activeScheduledCount, pausedScheduleCount };
  accountRobotSummaryCache.set(cacheKey, summary);
  return summary;
}

/**
 * Sum latest-run row counts + success/fail chips for every robot matching `ownerFilter`
 * (same filter as the dashboard list, across all pages).
 */
async function computeFilteredDashboardRunTotals(
  userId: any,
  robotMetaIds: string[]
): Promise<{
  rowsExtractedTotal: number;
  successfulCount: number;
  failedCount: number;
  latestRuns: Map<string, any>;
  rowCounts: Map<string, number>;
}> {
  const cacheKey = filteredDashboardCacheKey(userId, robotMetaIds);
  const cached = filteredDashboardRunTotalsCache.get(cacheKey);
  if (cached) {
    return {
      rowsExtractedTotal: cached.rowsExtractedTotal,
      successfulCount: cached.successfulCount,
      failedCount: cached.failedCount,
      latestRuns: new Map(cached.latestRuns),
      rowCounts: new Map(
        cached.latestRuns.map(([metaId, run]: [string, any]) => [
          String(run?.runId || metaId),
          typeof run?.rowsExtracted === 'number' ? run.rowsExtracted : 0,
        ])
      ),
    };
  }

  const latestRuns = await fetchLatestRunPerRobotMetaIds(userId, robotMetaIds);
  let successfulCount = 0;
  let failedCount = 0;
  let rowsExtractedTotal = 0;
  const rowCounts = new Map<string, number>();

  for (const run of latestRuns.values()) {
    const status = buildDashboardStatus(run);
    if (status === 'completed') successfulCount += 1;
    if (status === 'failed') failedCount += 1;
    const rows = typeof run?.rowsExtracted === 'number' ? run.rowsExtracted : 0;
    rowsExtractedTotal += rows;
    if (run?.runId) rowCounts.set(String(run.runId), rows);
  }

  const result = { rowsExtractedTotal, successfulCount, failedCount, latestRuns, rowCounts };
  filteredDashboardRunTotalsCache.set(cacheKey, {
    rowsExtractedTotal,
    successfulCount,
    failedCount,
    latestRuns: Array.from(latestRuns.entries()),
  });
  return result;
}

/**
 * Latest run per robot for the dashboard. Projects only status/time fields and
 * sorts by `_id` (insert order) so we never ship serializableOutput/logs through
 * the aggregation pipeline — that was the main refresh latency source.
 */
async function fetchLatestRunPerRobotMetaIds(
  userId: unknown,
  robotMetaIds: string[]
): Promise<Map<string, any>> {
  const latestRuns = new Map<string, any>();
  const ownerId = normalizeOwnerIdForWrite(userId);
  if (!ownerId || robotMetaIds.length === 0) {
    return latestRuns;
  }

  const match = buildLatestRunPerRobotMatch(userId, robotMetaIds);
  const pipeline = buildLatestRunPerRobotPipeline(userId, robotMetaIds);
  const agg = Run.aggregate(pipeline);
  const hint = resolveRunListIndexHint(match);
  if (hint) agg.hint(hint);
  const rows = await agg;

  for (const row of rows) {
    if (row?.run) {
      latestRuns.set(row._id, row.run);
    }
  }
  return latestRuns;
}

const mapAutomation = (
  robot: any,
  latestRun?: any,
  rowsExtracted: number = 0
) => {
  const config = toPublicAutomationConfig(getAutomationConfig(robot));
  const eff = resolveEffectiveScheduleState(robot);
  const hasInterval = !!(eff.cron || eff.every);
  const scheduleTimestamps = readRobotScheduleTimestamps(robot, eff);
  const nextRunIso = scheduleTimestamps.nextRunAt?.toISOString() ?? null;
  const lastRunIso = scheduleTimestamps.lastRunAt?.toISOString() ?? null;
  const schedule =
    eff.enabled || hasInterval
      ? {
          enabled: eff.enabled,
          cron: eff.cron || '',
          every: eff.every,
          timezone: eff.timezone || 'UTC',
          /** True when cron is stored but triggers are off (paused); use Resume to turn Agenda back on. */
          paused: hasInterval && !eff.enabled,
          nextRunAt: nextRunIso,
          lastRunAt: lastRunIso,
        }
      : null;

  return {
    id: robot.recording_meta.id,
    scoutId: getScoutId(robot),
    name: robot.recording_meta.name,
    companyName: getCompanyName(robot),
    tags: getAutomationTags(robot),
    targetUrl: robot.recording_meta.url || '',
    createdAt: robot.recording_meta.createdAt,
    updatedAt: robot.recording_meta.updatedAt,
    status: buildDashboardStatus(latestRun),
    lastRunTime: latestRun?.finishedAt || latestRun?.startedAt || null,
    rowsExtracted,
    latestRunId: latestRun?.runId || null,
    latestFailureReason: latestRun?.failureReason || null,
    latestFailureReasonSource: latestRun?.failureReasonSource || null,
    webhookConfigured: config.webhookConfigured,
    proxyConfigured: config.proxyConfigured,
    destinationType: config.destinationType,
    config,
    schedule,
  };
};

router.use(requireSignInOrApiKey);

router.get('/dashboard/metrics', async (req: any, res: any) => {
  try {
    const window = parseOpsMetricsWindow(req.query.window);
    const date = parseOpsMetricsDate(req.query.date);
    const fresh = req.query.fresh === '1' || req.query.fresh === 'true';
    const metrics = await buildOpsMetrics({ userId: req.user.id, window, date, fresh });
    return res.json(metrics);
  } catch (error: any) {
    logger.log('error', `Failed to fetch ops dashboard metrics: ${error.message}`);
    return res.status(500).json({ error: 'Failed to fetch dashboard metrics' });
  }
});

router.get('/dashboard/digital-ocean', async (req: any, res: any) => {
  try {
    const window = parseOpsMetricsWindow(req.query.window);
    const date = parseOpsMetricsDate(req.query.date);
    const fresh = req.query.fresh === '1' || req.query.fresh === 'true';
    const doWindow = doWindowForOps(window, Boolean(date));
    const dashboard = await getDigitalOceanDashboardCached(doWindow, { fresh });
    return res.json(dashboard);
  } catch (error: any) {
    logger.log('error', `Failed to fetch DigitalOcean dashboard metrics: ${error.message}`);
    return res.status(500).json({ error: 'Failed to fetch DigitalOcean metrics' });
  }
});

router.get('/dashboard/digest/status', async (_req: any, res: any) => {
  try {
    const { getOpsDigestConfigStatus } = await import('../services/opsDigest');
    return res.json(opsDigestStatusBody(await getOpsDigestConfigStatus()));
  } catch (error: any) {
    logger.log('error', `Failed to fetch ops digest status: ${error.message}`);
    return res.status(500).json({ error: 'Failed to load digest status' });
  }
});

router.put('/dashboard/digest/recipients', async (req: any, res: any) => {
  try {
    const { saveDigestRecipients } = await import('../services/digestRecipients');
    const { getOpsDigestConfigStatus } = await import('../services/opsDigest');
    const recipients = await saveDigestRecipients(req.body?.recipients);
    return res.json({
      ...opsDigestStatusBody(await getOpsDigestConfigStatus()),
      recipients,
    });
  } catch (error: any) {
    logger.log('error', `Failed to save digest recipients: ${error.message}`);
    return res.status(500).json({ error: 'Failed to save digest recipients' });
  }
});

router.post('/dashboard/digest/test', async (_req: any, res: any) => {
  try {
    const mapped = mapOpsDigestSendResult(await sendOpsDigest({ force: true }));
    return res.status(mapped.httpStatus).json(mapped.body);
  } catch (error: any) {
    logger.log('error', `Failed to send ops digest: ${error.message}`);
    return res.status(500).json({ error: 'Failed to send ops digest' });
  }
});

router.get('/dashboard/schedule-heatmap', async (req: any, res: any) => {
  try {
    const requested = parseOpsMetricsDate(req.query.date);
    const date = requested || formatIstYmd(Date.now());
    if (!isIstDateOnDayStrip(date, Date.now())) {
      return res.status(400).json({ error: 'Date must be within 3 days of today IST' });
    }
    const robots = await Robot.find(ownerIdFilter(req.user.id)).lean();
    return res.json(computeScheduleHeatmap(robots, date));
  } catch (error: any) {
    logger.log('error', `Failed to fetch schedule heatmap: ${error.message}`);
    return res.status(500).json({ error: 'Failed to fetch schedule heatmap' });
  }
});

router.get('/dashboard/automations', async (req: any, res: any) => {
  try {
    const { page, limit, skip } = parseListPagination(req);
    const { careerRobotsOnlyMongoClause } = await import('../services/aggregatorIdentity');
    const ownerFilter: any = {
      ...ownerIdFilter(req.user.id),
      ...careerRobotsOnlyMongoClause(),
    };

    const tagsFilterRaw = req.query.tags != null ? String(req.query.tags).trim() : '';
    const tagsFilter = tagsFilterRaw
      ? tagsFilterRaw.split(',').map((t) => t.trim()).filter(Boolean)
      : [];
    if (tagsFilter.length) {
      ownerFilter.$and = [
        ...(ownerFilter.$and || []),
        {
          $or: [
            { 'recording_meta.tags': { $all: tagsFilter } },
            { 'recording_meta.saasConfig.tags': { $all: tagsFilter } },
          ],
        },
      ];
    }

    const qFilter = req.query.q != null ? String(req.query.q).trim() : '';
    if (qFilter) {
      const re = new RegExp(qFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      ownerFilter.$and = [
        ...(ownerFilter.$and || []),
        {
          $or: [
            { 'recording_meta.name': re },
            { 'recording_meta.companyName': re },
            { 'recording_meta.saasConfig.companyName': re },
          ],
        },
      ];
    }

    const idFilter = req.query.id != null ? String(req.query.id).trim() : '';
    if (idFilter) {
      const re = new RegExp(idFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      ownerFilter.$and = [
        ...(ownerFilter.$and || []),
        {
          $or: [
            { 'recording_meta.id': re },
            { 'recording_meta.scoutId': re },
          ],
        },
      ];
    }

    const scheduleCron =
      req.query.scheduleCron != null ? String(req.query.scheduleCron).trim() : '';
    if (scheduleCron === 'none') {
      ownerFilter.$and = [
        ...(ownerFilter.$and || []),
        {
          $and: [
            {
              $or: [
                { 'recording_meta.saasConfig.schedule.cron': { $in: [null, ''] } },
                { 'recording_meta.saasConfig.schedule.cron': { $exists: false } },
              ],
            },
            {
              $or: [
                { 'schedule.cron': { $in: [null, ''] } },
                { 'schedule.cron': { $exists: false } },
              ],
            },
          ],
        },
      ];
    } else if (scheduleCron) {
      ownerFilter.$and = [
        ...(ownerFilter.$and || []),
        {
          $or: [
            { 'recording_meta.saasConfig.schedule.cron': scheduleCron },
            { 'schedule.cron': scheduleCron },
          ],
        },
      ];
    }

    const [summary, total, robots, allMetaIdsRaw] = await Promise.all([
      computeAccountRobotSummary(req.user.id),
      Robot.countDocuments(ownerFilter),
      Robot.find(ownerFilter)
        .select(ROBOT_DASHBOARD_LIST_SELECT.join(' '))
        .sort({ _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Robot.distinct('recording_meta.id', ownerFilter),
    ]);

    const allMetaIds = (allMetaIdsRaw as unknown[])
      .filter(Boolean)
      .map(String);

    const runTotals = await computeFilteredDashboardRunTotals(req.user.id, allMetaIds);

    const summaryOut = {
      totalAutomations: total,
      activeScheduledCount: summary.activeScheduledCount,
      pausedScheduleCount: summary.pausedScheduleCount,
      rowsExtractedTotal: runTotals.rowsExtractedTotal,
      successfulCount: runTotals.successfulCount,
      failedCount: runTotals.failedCount,
    };

    const automations = robots.map((robot: any) => {
      const metaId = robot.recording_meta.id;
      const latestRun = runTotals.latestRuns.get(metaId);
      const rowsExtracted = latestRun?.runId
        ? runTotals.rowCounts.get(String(latestRun.runId)) || 0
        : 0;
      return mapAutomation(robot, latestRun, rowsExtracted);
    });

    const totalPages = total === 0 ? 1 : Math.ceil(total / limit);

    res.json({
      automations,
      pagination: { page, limit, total, totalPages },
      summary: summaryOut,
    });
  } catch (error: any) {
    logger.log('error', `Failed to fetch automation dashboard: ${error.message}`);
    res.status(500).json({ error: 'Failed to fetch automations' });
  }
});

/** Aggregator robots only (Hiring Cafe searches) — excluded from /dashboard/automations. */
router.get('/dashboard/aggregators', async (req: any, res: any) => {
  try {
    const { page, limit, skip } = parseListPagination(req);
    const { aggregatorRobotsOnlyMongoClause, AGGREGATOR_PROVIDER_HIRING_CAFE } = await import(
      '../services/aggregatorIdentity'
    );
    const provider =
      req.query.provider != null
        ? String(req.query.provider).trim()
        : AGGREGATOR_PROVIDER_HIRING_CAFE;
    const ownerFilter: any = {
      ...ownerIdFilter(req.user.id),
      ...aggregatorRobotsOnlyMongoClause(provider || undefined),
    };

    const tagsFilterRaw = req.query.tags != null ? String(req.query.tags).trim() : '';
    const tagsFilter = tagsFilterRaw
      ? tagsFilterRaw.split(',').map((t) => t.trim()).filter(Boolean)
      : [];
    if (tagsFilter.length) {
      ownerFilter.$and = [
        ...(ownerFilter.$and || []),
        {
          $or: [
            { 'recording_meta.tags': { $all: tagsFilter } },
            { 'recording_meta.saasConfig.tags': { $all: tagsFilter } },
          ],
        },
      ];
    }

    const qFilter = req.query.q != null ? String(req.query.q).trim() : '';
    if (qFilter) {
      const re = new RegExp(qFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      ownerFilter.$and = [
        ...(ownerFilter.$and || []),
        {
          $or: [
            { 'recording_meta.name': re },
            { 'recording_meta.companyName': re },
            { 'recording_meta.saasConfig.companyName': re },
          ],
        },
      ];
    }

    const idFilter = req.query.id != null ? String(req.query.id).trim() : '';
    if (idFilter) {
      const re = new RegExp(idFilter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      ownerFilter.$and = [
        ...(ownerFilter.$and || []),
        {
          $or: [
            { 'recording_meta.id': re },
            { 'recording_meta.scoutId': re },
          ],
        },
      ];
    }

    const scheduleCron =
      req.query.scheduleCron != null ? String(req.query.scheduleCron).trim() : '';
    if (scheduleCron === 'none') {
      ownerFilter.$and = [
        ...(ownerFilter.$and || []),
        {
          $and: [
            {
              $or: [
                { 'recording_meta.saasConfig.schedule.cron': { $in: [null, ''] } },
                { 'recording_meta.saasConfig.schedule.cron': { $exists: false } },
              ],
            },
            {
              $or: [
                { 'schedule.cron': { $in: [null, ''] } },
                { 'schedule.cron': { $exists: false } },
              ],
            },
          ],
        },
      ];
    } else if (scheduleCron) {
      ownerFilter.$and = [
        ...(ownerFilter.$and || []),
        {
          $or: [
            { 'recording_meta.saasConfig.schedule.cron': scheduleCron },
            { 'schedule.cron': scheduleCron },
          ],
        },
      ];
    }

    const [total, robots, scheduleRobots, allMetaIdsRaw] = await Promise.all([
      Robot.countDocuments(ownerFilter),
      Robot.find(ownerFilter)
        .select(ROBOT_DASHBOARD_LIST_SELECT.join(' '))
        .sort({ 'recording_meta.updatedAt': -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Robot.find(ownerFilter)
        .select('schedule recording_meta.saasConfig.schedule')
        .lean(),
      Robot.distinct('recording_meta.id', ownerFilter),
    ]);

    let activeScheduledCount = 0;
    let pausedScheduleCount = 0;
    for (const robot of scheduleRobots) {
      const { active, paused } = robotScheduleSummaryFlags(robot);
      if (active) activeScheduledCount += 1;
      if (paused) pausedScheduleCount += 1;
    }

    const allMetaIds = (allMetaIdsRaw as unknown[]).filter(Boolean).map(String);
    const runTotals = await computeFilteredDashboardRunTotals(req.user.id, allMetaIds);

    let jobsAddedToBoardTotal = 0;
    for (const run of runTotals.latestRuns.values()) {
      if (typeof run?.jobsAddedToBoard === 'number') {
        jobsAddedToBoardTotal += run.jobsAddedToBoard;
      }
    }

    const searches = robots.map((robot: any) => {
      const metaId = robot.recording_meta.id;
      const latestRun = runTotals.latestRuns.get(metaId);
      const rowsExtracted = latestRun?.runId
        ? runTotals.rowCounts.get(String(latestRun.runId)) || 0
        : 0;
      return {
        ...mapAutomation(robot, latestRun, rowsExtracted),
        aggregatorProvider:
          robot.recording_meta?.saasConfig?.aggregatorProvider || provider || '',
        targetUrl: robot.recording_meta?.url || '',
        jobsAddedToBoard:
          typeof latestRun?.jobsAddedToBoard === 'number' ? latestRun.jobsAddedToBoard : 0,
      };
    });

    const totalPages = total === 0 ? 1 : Math.ceil(total / limit);
    return res.json({
      provider: provider || AGGREGATOR_PROVIDER_HIRING_CAFE,
      searches,
      pagination: { page, limit, total, totalPages },
      summary: {
        totalAutomations: total,
        activeScheduledCount,
        pausedScheduleCount,
        rowsExtractedTotal: runTotals.rowsExtractedTotal,
        successfulCount: runTotals.successfulCount,
        failedCount: runTotals.failedCount,
        jobsAddedToBoardTotal,
      },
    });
  } catch (error: any) {
    logger.log('error', `Failed to fetch aggregators dashboard: ${error.message}`);
    return res.status(500).json({ error: 'Failed to fetch aggregators' });
  }
});

/**
 * Disable recurring schedules for every automation owned by the caller and cancel Agenda triggers.
 * Does not cancel in-flight scraper runs — those finish or fail on their own.
 */
router.post('/automations/schedules/stop-all', async (req: any, res: any) => {
  try {
    const robots = await Robot.find(ownerIdFilter(req.user.id));
    let stoppedCount = 0;
    const STOP_BATCH = 8;

    for (let i = 0; i < robots.length; i += STOP_BATCH) {
      const batch = robots.slice(i, i + STOP_BATCH);
      const results = await Promise.all(
        batch.map(async (robot) => {
          const effective = resolveEffectiveScheduleState(robot.toJSON());
          if (!effective.enabled || (!effective.cron && !effective.every)) {
            return 0;
          }

          const existingConfig = (robot.recording_meta as any).saasConfig || {};
          const tz =
            (robot.recording_meta as any)?.saasConfig?.schedule?.timezone ||
            (robot.schedule as any)?.timezone ||
            'UTC';

          const preservedCron = (effective.cron || '').trim() || (typeof existingConfig.schedule?.cron === 'string' ? existingConfig.schedule.cron.trim() : '') || '';

          const nextSaasConfig = {
            ...existingConfig,
            schedule: {
              enabled: false,
              cron: preservedCron,
              timezone: tz,
            },
          };

          const nextMeta = {
            ...robot.recording_meta,
            updatedAt: new Date().toLocaleString(),
            saasConfig: nextSaasConfig,
          };

          const nextSchedule = await syncAutomationSchedule(
            {
              ...robot.toJSON(),
              recording_meta: nextMeta,
              schedule: robot.schedule,
            },
            req.user.id,
            tz
          );

          robot.recording_meta = nextMeta;
          robot.schedule = nextSchedule;
          await robot.save();
          return 1;
        })
      );
      stoppedCount += results.reduce((sum: number, n: number) => sum + n, 0);
    }

    logger.log('info', `Stopped all schedules for user ${req.user.id}: ${stoppedCount} automation(s)`);

    return res.json({ success: true, stoppedCount });
  } catch (error: any) {
    logger.log('error', `Failed to stop all schedules: ${error.message}`);
    return res.status(500).json({ error: 'Failed to stop all schedules' });
  }
});

/**
 * Re-enable Agenda triggers for every automation that is paused (cron/every stored, enabled false).
 * Idempotent for already-active schedules.
 */
router.post('/automations/schedules/resume-all', async (req: any, res: any) => {
  try {
    const robots = await Robot.find(ownerIdFilter(req.user.id));
    let resumedCount = 0;

    for (const robot of robots) {
      const effective = resolveEffectiveScheduleState(robot.toJSON());
      const hasInterval = !!(effective.cron || effective.every);
      if (effective.enabled || !hasInterval) {
        continue;
      }

      const existingConfig = (robot.recording_meta as any).saasConfig || {};
      const tz =
        effective.timezone ||
        existingConfig.schedule?.timezone ||
        (robot.schedule as any)?.timezone ||
        'UTC';

      const v = effective.cron
        ? validateAutomationScheduleCron(effective.cron, tz)
        : { ok: true as const };
      if (!v.ok) {
        logger.log(
          'warn',
          `resume-all: skip automation ${robot.recording_meta?.id} — invalid stored cron: ${(v as any).error}`
        );
        continue;
      }

      const nextSaasConfig = {
        ...existingConfig,
        schedule: {
          enabled: true,
          cron: effective.cron || '',
          timezone: tz,
          ...(effective.every != null ? { every: effective.every } : {}),
        },
      };

      const nextMeta = {
        ...robot.recording_meta,
        updatedAt: new Date().toLocaleString(),
        saasConfig: nextSaasConfig,
      };

      const nextSchedule = await syncAutomationSchedule(
        {
          ...robot.toJSON(),
          recording_meta: nextMeta,
          schedule: robot.schedule,
        },
        req.user.id,
        tz,
        { packSlots: true }
      );

      robot.recording_meta = nextMeta;
      robot.schedule = nextSchedule;
      await robot.save();
      resumedCount += 1;
    }

    logger.log('info', `Resumed all pausable schedules for user ${req.user.id}: ${resumedCount} automation(s)`);

    return res.json({ success: true, resumedCount });
  } catch (error: any) {
    logger.log('error', `Failed to resume all schedules: ${error.message}`);
    return res.status(500).json({ error: 'Failed to resume all schedules' });
  }
});

/**
 * Re-spread enabled schedules with random packed first-fire times (sequential slot packing).
 */
router.post('/automations/schedules/repack-all', async (req: any, res: any) => {
  try {
    const { repackedCount, skippedCount } = await repackAllAutomationSchedules(req.user.id);
    logger.log(
      'info',
      `Repacked all schedules for user ${req.user.id}: repacked=${repackedCount} skipped=${skippedCount}`
    );
    return res.json({ success: true, repackedCount, skippedCount });
  } catch (error: any) {
    logger.log('error', `Failed to repack all schedules: ${error.message}`);
    return res.status(500).json({ error: 'Failed to repack all schedules' });
  }
});

/**
 * Evenly re-spread Every-day (24h) schedules only. Hourly and other cadences stay put.
 */
router.post('/automations/schedules/reconfigure-daily', async (req: any, res: any) => {
  try {
    const result = await reconfigureDailySchedulesForOwner(req.user.id);
    logger.log(
      'info',
      `Reconfigured daily schedules for user ${req.user.id}: moved=${result.movedCount} skipped=${result.skippedCount}`
    );
    return res.json({ success: true, ...result });
  } catch (error: any) {
    logger.log('error', `Failed to reconfigure daily schedules: ${error.message}`);
    return res.status(500).json({ error: 'Failed to reconfigure daily schedules' });
  }
});

router.get('/schedule/suggestions', async (req: any, res: any) => {
  try {
    const cron = typeof req.query.cron === 'string' ? req.query.cron.trim() : '';
    const timezone =
      typeof req.query.timezone === 'string' && moment.tz.zone(req.query.timezone)
        ? req.query.timezone
        : 'UTC';
    if (!cron) {
      return res.status(400).json({ error: 'cron query parameter is required' });
    }
    const everyMs = intervalMsFromCron(cron);
    if (!everyMs) {
      return res.json({ suggestions: [], everyMs: null, gapMs: 90_000 });
    }
    const slots = suggestPreferredStartSlots(everyMs, timezone);
    return res.json({
      suggestions: [],
      sampleNextRunAt: slots[0]?.toISOString() || null,
      message:
        'Scout-X assigns a random load-balanced first run; client slot picking is disabled.',
      everyMs,
      gapMs: 90_000,
      timezone,
    });
  } catch (error: any) {
    logger.log('error', `Failed to build schedule suggestions: ${error.message}`);
    return res.status(500).json({ error: 'Failed to build schedule suggestions' });
  }
});

router.get('/tags/catalog', async (_req: any, res: any) => {
  try {
    const { TAG_CATALOG, MAX_AUTOMATION_TAGS } = await import('../constants/tagCatalog');
    return res.json({ catalog: TAG_CATALOG, maxTags: MAX_AUTOMATION_TAGS });
  } catch (error: any) {
    return res.status(500).json({ error: 'Failed to load tag catalog' });
  }
});

router.get('/automations/lookup', async (req: any, res: any) => {
  try {
    const scoutRaw = normalizeScoutIdInput(req.query.scoutId);
    const urlRaw = typeof req.query.url === 'string' ? req.query.url.trim() : '';

    if (!scoutRaw && !urlRaw) {
      return res.status(400).json({ error: 'Provide url or scoutId query parameter' });
    }

    let robot: any = null;

    if (scoutRaw) {
      if (!isValidScoutId(scoutRaw)) {
        return res.status(400).json({ error: 'Invalid Scout-X ID format (expected SX12AB34)' });
      }
      robot = await Robot.findOne({
        ...ownerIdFilter(req.user.id),
        'recording_meta.scoutId': scoutRaw,
      }).lean();
    } else if (urlRaw) {
      let normalized: string;
      try {
        normalized = normalizeAutomationUrl(urlRaw);
      } catch (err: any) {
        return res.status(400).json({ error: err?.message || 'Invalid url' });
      }
      robot = await Robot.findOne({
        ...ownerIdFilter(req.user.id),
        'recording_meta.url': normalized,
      }).lean();
    }

    if (!robot) {
      return res.json({ found: false, automation: null });
    }

    const metaId = robot.recording_meta.id;
    const latestRun =
      (await fetchLatestRunPerRobotMetaIds(req.user.id, [metaId])).get(metaId) ?? null;

    return res.json({
      found: true,
      automation: mapAutomation(robot, latestRun, 0),
    });
  } catch (error: any) {
    logger.log('error', `Automation lookup failed: ${error.message}`);
    return res.status(500).json({ error: 'Failed to look up automation' });
  }
});

router.get('/automations/:id', async (req: any, res: any) => {
  try {
    const robot: any = await findRobotByIdOrScoutId(req.user.id, req.params.id);

    if (!robot) {
      return res.status(404).json({ error: 'Automation not found' });
    }

    const metaId = robot.recording_meta.id;
    const latestRun =
      (await fetchLatestRunPerRobotMetaIds(req.user.id, [metaId])).get(metaId) ?? null;
    const rowsExtracted = latestRun?.runId
      ? (await batchExtractedRowCounts([String(latestRun.runId)])).get(String(latestRun.runId)) || 0
      : 0;

    return res.json({
      automation: mapAutomation(robot, latestRun, rowsExtracted),
      workflow: robot.recording,
      rawRobotId: robot.id,
    });
  } catch (error: any) {
    logger.log('error', `Failed to fetch automation ${req.params.id}: ${error.message}`);
    return res.status(500).json({ error: 'Failed to fetch automation' });
  }
});

router.post('/automations', async (req: any, res: any) => {
  try {
    const {
      name,
      startUrl,
      workflow,
      config,
      webhookUrl,
      scoutId: bodyScoutId,
      companyName: bodyCompany,
      tags: bodyTags,
    } = req.body;

    if (!name || !startUrl) {
      return res.status(400).json({ error: 'name and startUrl are required' });
    }

    const normalizedStartUrl = normalizeAutomationUrl(startUrl);
    await assertSafeAutomationConfiguration({
      targetUrl: normalizedStartUrl,
      webhookUrl,
      config,
    });

    const duplicateUrl = await Robot.findOne({
      ...ownerIdFilter(req.user.id),
      'recording_meta.url': normalizedStartUrl,
    }).lean();

    if (duplicateUrl) {
      return res.status(409).json({
        error: 'An automation with this target URL already exists. Update it instead of creating a duplicate.',
        code: 'DUPLICATE_TARGET_URL',
        automation: {
          id: duplicateUrl.recording_meta.id,
          scoutId: getScoutId(duplicateUrl),
          name: duplicateUrl.recording_meta.name,
          targetUrl: duplicateUrl.recording_meta.url || normalizedStartUrl,
          companyName: getCompanyName(duplicateUrl),
        },
      });
    }

    let scoutId = normalizeScoutIdInput(bodyScoutId);
    if (scoutId) {
      if (!isValidScoutId(scoutId)) {
        return res.status(400).json({ error: 'Invalid Scout-X ID format (expected SX12AB34)' });
      }
      if (await scoutIdExistsForUser(req.user.id, scoutId)) {
        const existing = await Robot.findOne({
          ...ownerIdFilter(req.user.id),
          'recording_meta.scoutId': scoutId,
        }).lean();
        return res.status(409).json({
          error: 'An automation with this Scout-X ID already exists. Update it or delete the old one first.',
          code: 'SCOUT_ID_EXISTS',
          automation: existing
            ? {
                id: existing.recording_meta.id,
                scoutId: getScoutId(existing),
                name: existing.recording_meta.name,
                targetUrl: existing.recording_meta.url || '',
                companyName: getCompanyName(existing),
              }
            : null,
        });
      }
    } else {
      scoutId = await generateUniqueScoutId((id) => scoutIdExistsForUser(req.user.id, id));
    }

    const companyName =
      typeof bodyCompany === 'string'
        ? bodyCompany.trim()
        : typeof (config as any)?.companyName === 'string'
          ? String((config as any).companyName).trim()
          : '';

    if (!companyName) {
      return res.status(400).json({ error: 'companyName is required' });
    }

    const tagsResult = sanitizeAutomationTags(
      bodyTags !== undefined ? bodyTags : (config as any)?.tags
    );
    if (!tagsResult.ok) {
      return res.status(400).json({ error: tagsResult.error });
    }
    const tags = tagsResult.tags;

    const initialTz =
      (config as any)?.schedule?.timezone || (config as any)?.timezone || 'UTC';
    const initialSchedule = (config as any)?.schedule;
    if (
      initialSchedule &&
      initialSchedule.enabled &&
      typeof initialSchedule.cron === 'string' &&
      initialSchedule.cron.trim()
    ) {
      const v = validateAutomationScheduleCron(initialSchedule.cron.trim(), initialTz);
      if (!v.ok) {
        return res.status(400).json({ error: v.error });
      }
    }

    const createdAt = new Date().toLocaleString();
    const robotMetaId = uuid();

    const incomingDbCols = normalizeDatabaseTargetColumns((config as any)?.databaseTargetColumns);
    const resolvedDbCols =
      incomingDbCols !== undefined ? incomingDbCols : [...DEFAULT_JOB_DATABASE_TARGET_COLUMNS];

    const saasIncoming = { ...(config || {}) };
    delete (saasIncoming as any).companyName;
    delete (saasIncoming as any).tags;

    const { applyAggregatorProviderFromUrl } = await import('../services/aggregatorIdentity');
    applyAggregatorProviderFromUrl(normalizedStartUrl, saasIncoming as Record<string, unknown>);

    // Aggregator searches: reuse listExtraction from an existing Hiring Cafe template when omitted.
    const aggregatorProvider = String((saasIncoming as any).aggregatorProvider || '').trim();
    if (aggregatorProvider && !(saasIncoming as any).listExtraction) {
      const template = await Robot.findOne({
        ...ownerIdFilter(req.user.id),
        'recording_meta.saasConfig.aggregatorProvider': aggregatorProvider,
        'recording_meta.saasConfig.listExtraction.itemSelector': { $exists: true, $ne: '' },
      })
        .select('recording_meta.saasConfig.listExtraction')
        .lean();
      const tmplList = (template as any)?.recording_meta?.saasConfig?.listExtraction;
      if (tmplList) {
        (saasIncoming as any).listExtraction = tmplList;
      }
    }

    const robot = await Robot.create({
      id: uuid(),
      userId: normalizeOwnerIdForWrite(req.user.id),
      recording_meta: {
        name,
        id: robotMetaId,
        scoutId,
        companyName,
        tags,
        createdAt,
        updatedAt: createdAt,
        pairs: workflow?.workflow?.length || workflow?.length || 1,
        params: [],
        type: 'extract',
        url: normalizedStartUrl,
        saasConfig: {
          ...saasIncoming,
          webhookUrl: webhookUrl || config?.webhookUrl || '',
          databaseTargetColumns: resolvedDbCols,
          companyName,
          tags,
        },
      },
      recording: Array.isArray(workflow) ? { workflow } : workflow || defaultWorkflow(normalizedStartUrl),
      schedule: null,
      webhooks: null,
    });

    const tz = (config as any)?.schedule?.timezone || (config as any)?.timezone || 'UTC';
    const nextSchedule = await syncAutomationSchedule(robot.toJSON(), req.user.id, tz);
    robot.schedule = nextSchedule;
    await robot.save();
    const publicConfig = toPublicAutomationConfig(getAutomationConfig(robot));

    return res.status(201).json({
      automation: {
        id: robotMetaId,
        scoutId,
        name,
        companyName,
        tags,
        targetUrl: normalizedStartUrl,
        status: 'idle',
        lastRunTime: null,
        rowsExtracted: 0,
        webhookConfigured: publicConfig.webhookConfigured,
        proxyConfigured: publicConfig.proxyConfigured,
        destinationType: publicConfig.destinationType,
        config: publicConfig,
        schedule: nextSchedule,
      },
    });
  } catch (error: any) {
    if (error instanceof RangeError) {
      return res.status(400).json({ error: error.message });
    }
    if (isUnsafeOutboundUrlError(error)) {
      return sendUnsafeOutboundUrlResponse(res, error);
    }
    logger.log('error', `Failed to create automation: ${error.message}`);
    if (error?.code === 11000) {
      const key = String(error?.message || '');
      if (key.includes('scoutId') || key.includes('scout_id')) {
        return res.status(409).json({
          error: 'An automation with this Scout-X ID already exists.',
          code: 'SCOUT_ID_EXISTS',
        });
      }
      return res.status(409).json({
        error:
          'An automation with this name already exists for your account. Open the Maxun dashboard to rename or remove it, then send again — or the extension will use a unique name on the next save.',
        code: 'DUPLICATE_ROBOT_NAME',
      });
    }
    return res.status(500).json({
      error: error?.message || 'Failed to create automation',
    });
  }
});

router.put('/automations/:id/config', async (req: any, res: any) => {
  try {
    const robot = await findRobotByIdOrScoutId(req.user.id, req.params.id);

    if (!robot) {
      return res.status(404).json({ error: 'Automation not found' });
    }

    const { name, startUrl, config, webhookUrl, elementsOnly, companyName: bodyCompany, tags: bodyTags } = req.body;
    const elementsOnlyMode = elementsOnly === true || elementsOnly === 'true';

    if (elementsOnlyMode) {
      const prevSaas = getAutomationConfig(robot) || {};
      const incoming = (config && typeof config === 'object') ? config : {};
      const nextSaasConfig: Record<string, any> = { ...prevSaas };
      if (Object.prototype.hasOwnProperty.call(incoming, 'listExtraction')) {
        nextSaasConfig.listExtraction = (incoming as any).listExtraction;
      }
      if (Object.prototype.hasOwnProperty.call(incoming, 'previewRows')) {
        nextSaasConfig.previewRows = (incoming as any).previewRows;
      }
      if (Object.prototype.hasOwnProperty.call(incoming, 'previewUrl')) {
        nextSaasConfig.previewUrl = (incoming as any).previewUrl;
      }

      // elementsOnly used to ignore tags/company — so "Send to Scout-X" with a
      // duplicate URL silently dropped catalog tags the user had just picked.
      // Apply them when the client sends a non-empty list / company string.
      let tagsToSet: string[] | undefined;
      if (bodyTags !== undefined || (config && Object.prototype.hasOwnProperty.call(config, 'tags'))) {
        const tagsResult = sanitizeAutomationTags(
          bodyTags !== undefined ? bodyTags : (config as any)?.tags
        );
        if (!tagsResult.ok) {
          return res.status(400).json({ error: tagsResult.error });
        }
        if (tagsResult.tags.length > 0) {
          tagsToSet = tagsResult.tags;
          nextSaasConfig.tags = tagsToSet;
        }
      }

      const companyName =
        typeof bodyCompany === 'string'
          ? bodyCompany.trim()
          : typeof (incoming as any).companyName === 'string'
            ? String((incoming as any).companyName).trim()
            : undefined;
      if (companyName) {
        nextSaasConfig.companyName = companyName;
      }

      const { applyAggregatorProviderFromUrl } = await import('../services/aggregatorIdentity');
      applyAggregatorProviderFromUrl(
        String((incoming as any).previewUrl || robot.recording_meta?.url || ''),
        nextSaasConfig
      );

      const nextMeta = {
        ...robot.recording_meta,
        updatedAt: new Date().toLocaleString(),
        ...(companyName ? { companyName } : {}),
        ...(tagsToSet !== undefined ? { tags: tagsToSet } : {}),
        saasConfig: nextSaasConfig,
      };
      robot.recording_meta = nextMeta;
      robot.markModified('recording_meta');
      await robot.save();
      const publicConfig = toPublicAutomationConfig(nextMeta.saasConfig);

      return res.json({
        success: true,
        elementsOnly: true,
        automation: {
          id: nextMeta.id,
          scoutId: getScoutId({ recording_meta: nextMeta }),
          name: nextMeta.name,
          companyName: getCompanyName({ recording_meta: nextMeta }),
          tags: getAutomationTags({ recording_meta: nextMeta }),
          targetUrl: nextMeta.url || '',
          webhookConfigured: publicConfig.webhookConfigured,
          proxyConfigured: publicConfig.proxyConfigured,
          destinationType: publicConfig.destinationType,
          config: publicConfig,
          schedule: robot.schedule,
        },
      });
    }

    const normalizedStartUrl = startUrl ? normalizeAutomationUrl(startUrl) : undefined;
    await assertSafeAutomationConfiguration({
      targetUrl: normalizedStartUrl,
      webhookUrl,
      config,
    });

    // If the caller is updating config.schedule in the same payload, validate
    // the cron now so we don't silently accept garbage then fail at schedule
    // compute time. We also pick this tz up below when syncing.
    const incomingSchedule = (config && (config as any).schedule) || null;
    const incomingTimezone =
      incomingSchedule?.timezone || (robot.schedule as any)?.timezone || 'UTC';
    if (
      incomingSchedule &&
      incomingSchedule.enabled &&
      typeof incomingSchedule.cron === 'string' &&
      incomingSchedule.cron.trim()
    ) {
      const v = validateAutomationScheduleCron(incomingSchedule.cron.trim(), incomingTimezone);
      if (!v.ok) {
        return res.status(400).json({ error: v.error });
      }
    }

    const prevSaas = getAutomationConfig(robot) || {};
    const incoming = mergeMaskedAutomationConfig(prevSaas, config);
    const companyName =
      typeof bodyCompany === 'string'
        ? bodyCompany.trim()
        : typeof (incoming as any).companyName === 'string'
          ? String((incoming as any).companyName).trim()
          : undefined;
    delete (incoming as any).companyName;
    delete (incoming as any).tags;

    let tagsToSet: string[] | undefined;
    if (bodyTags !== undefined || (config && Object.prototype.hasOwnProperty.call(config, 'tags'))) {
      const tagsResult = sanitizeAutomationTags(
        bodyTags !== undefined ? bodyTags : (config as any)?.tags
      );
      if (!tagsResult.ok) {
        return res.status(400).json({ error: tagsResult.error });
      }
      tagsToSet = tagsResult.tags;
    }

    const resolvedCompanyName =
      companyName !== undefined ? companyName : getCompanyName(robot);
    if (!resolvedCompanyName) {
      return res.status(400).json({ error: 'companyName is required' });
    }
    if (companyName !== undefined && !companyName) {
      return res.status(400).json({ error: 'companyName is required' });
    }

    // Preserve extension-authored extraction unless the client explicitly sends listExtraction.
    // Deep-merge destinations so partial updates do not drop sibling destination configs.
    const nextSaasConfig: Record<string, any> = {
      ...prevSaas,
      ...incoming,
      ...(typeof webhookUrl === 'string' && webhookUrl.trim() ? { webhookUrl } : {}),
      companyName: companyName !== undefined ? companyName : getCompanyName(robot),
      ...(tagsToSet !== undefined ? { tags: tagsToSet } : {}),
      destinations: {
        ...((prevSaas as any).destinations || {}),
        ...((incoming as any).destinations || {}),
        webhook: {
          ...((prevSaas as any).destinations?.webhook || {}),
          ...((incoming as any).destinations?.webhook || {}),
          ...(typeof webhookUrl === 'string' && webhookUrl.trim()
            ? { url: webhookUrl || (incoming as any).destinations?.webhook?.url || '' }
            : {}),
        },
        googleSheets: {
          ...((prevSaas as any).destinations?.googleSheets || {}),
          ...((incoming as any).destinations?.googleSheets || {}),
        },
        airtable: {
          ...((prevSaas as any).destinations?.airtable || {}),
          ...((incoming as any).destinations?.airtable || {}),
        },
        database: {
          ...((prevSaas as any).destinations?.database || {}),
          ...((incoming as any).destinations?.database || {}),
        },
      },
    };
    if (!Object.prototype.hasOwnProperty.call(incoming, 'listExtraction') && (prevSaas as any).listExtraction) {
      nextSaasConfig.listExtraction = (prevSaas as any).listExtraction;
    }
    if (!Object.prototype.hasOwnProperty.call(incoming, 'previewRows') && (prevSaas as any).previewRows) {
      nextSaasConfig.previewRows = (prevSaas as any).previewRows;
    }
    if (!Object.prototype.hasOwnProperty.call(incoming, 'previewUrl') && (prevSaas as any).previewUrl) {
      nextSaasConfig.previewUrl = (prevSaas as any).previewUrl;
    }
    if (!Object.prototype.hasOwnProperty.call(incoming, 'columnOverrides') && (prevSaas as any).columnOverrides) {
      nextSaasConfig.columnOverrides = (prevSaas as any).columnOverrides;
    }
    if (tagsToSet !== undefined) {
      nextSaasConfig.tags = tagsToSet;
    }
    if (companyName !== undefined) {
      nextSaasConfig.companyName = companyName;
    }

    const { applyAggregatorProviderFromUrl } = await import('../services/aggregatorIdentity');
    applyAggregatorProviderFromUrl(
      normalizedStartUrl || String(robot.recording_meta?.url || ''),
      nextSaasConfig
    );

    const nextMeta = {
      ...robot.recording_meta,
      ...(name ? { name } : {}),
      ...(normalizedStartUrl ? { url: normalizedStartUrl } : {}),
      companyName: companyName !== undefined ? companyName : getCompanyName(robot),
      ...(tagsToSet !== undefined ? { tags: tagsToSet } : {}),
      updatedAt: new Date().toLocaleString(),
      saasConfig: nextSaasConfig,
    };

    if ((nextSaasConfig as any).schedule?.preferredNextRunAt) {
      delete (nextSaasConfig as any).schedule.preferredNextRunAt;
    }

    const prevSchedule = (prevSaas as any).schedule || {};
    const nextSched = (nextSaasConfig as any).schedule || {};
    const scheduleChanged =
      !!prevSchedule.enabled !== !!nextSched.enabled ||
      String(prevSchedule.cron || '') !== String(nextSched.cron || '') ||
      String(prevSchedule.timezone || '') !== String(nextSched.timezone || '');
    const preferredFromBody =
      req.body?.preferredNextRunAt ||
      (incoming as any)?.schedule?.preferredNextRunAt ||
      null;

    // Re-sync the schedule whenever the payload may have mutated it, so the
    // Agenda job, nextRunAt, and robot.schedule all stay consistent even when
    // the caller only pushed config updates.
    const nextSchedule = await syncAutomationSchedule(
      {
        ...robot.toJSON(),
        recording_meta: nextMeta,
        schedule: robot.schedule,
      },
      req.user.id,
      incomingTimezone,
      scheduleChanged
        ? {
            packSlots: true,
            ...(preferredFromBody ? { preferredNextRunAt: preferredFromBody } : {}),
          }
        : undefined
    );

    robot.recording_meta = nextMeta;
    robot.schedule = nextSchedule;
    robot.markModified('recording_meta');
    await robot.save();
    const publicConfig = toPublicAutomationConfig(nextMeta.saasConfig);

    return res.json({
      success: true,
      automation: {
        id: nextMeta.id,
        scoutId: getScoutId({ recording_meta: nextMeta }),
        name: nextMeta.name,
        companyName: getCompanyName({ recording_meta: nextMeta }),
        tags: getAutomationTags({ recording_meta: nextMeta }),
        targetUrl: nextMeta.url || '',
        webhookConfigured: publicConfig.webhookConfigured,
        proxyConfigured: publicConfig.proxyConfigured,
        destinationType: publicConfig.destinationType,
        config: publicConfig,
        schedule: nextSchedule,
      },
    });
  } catch (error: any) {
    if (error instanceof RangeError) {
      return res.status(400).json({ error: error.message });
    }
    if (isUnsafeOutboundUrlError(error)) {
      return sendUnsafeOutboundUrlResponse(res, error);
    }
    logger.log('error', `Failed to update automation config ${req.params.id}: ${error.message}`);
    return res.status(500).json({ error: 'Failed to update automation config' });
  }
});

router.post('/automations/:id/run', async (req: any, res: any) => {
  try {
    const robot: any = await Robot.findOne({
      ...ownerIdFilter(req.user.id),
      'recording_meta.id': req.params.id,
    }).lean();

    if (!robot) {
      return res.status(404).json({ error: 'Automation not found' });
    }

    const admission = await runAdmission.admitManual({
      ownerId: req.user.id,
      robot,
      runtimeConfig: getAutomationConfig(robot),
    });

    return res.json({
      ...admission.run,
      automationId: robot.recording_meta.id,
    });
  } catch (error: any) {
    if (error instanceof AdmissionError) {
      return res.status(error.statusCode).json({ error: error.message, code: error.code });
    }
    logger.log('error', `Failed to run automation ${req.params.id}: ${error.message}`);
    return res.status(500).json({ error: 'Failed to run automation' });
  }
});

router.post('/runs/:runId/retry', async (req: any, res: any) => {
  try {
    const rawKey = req.get('Idempotency-Key');
    const admission = await runAdmission.admitRetry({
      ownerId: req.user.id,
      runId: req.params.runId,
      requestKey: rawKey || '',
    });
    return res.status(admission.created ? 201 : 200).json({
      ...admission.run,
      previouslyAccepted: !admission.created,
    });
  } catch (error: any) {
    if (error instanceof AdmissionError) {
      return res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
        ...(error.activeRunId ? { activeRunId: error.activeRunId } : {}),
      });
    }
    logger.log('error', `Failed to retry run ${req.params.runId}: ${error.message}`);
    return res.status(500).json({ error: 'Failed to retry run' });
  }
});

router.get('/automations/:id/data', async (req: any, res: any) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '25'), 10)));
    const offset = (page - 1) * limit;

    const robot: any = await Robot.findOne({
      ...ownerIdFilter(req.user.id),
      'recording_meta.id': req.params.id,
    })
      .select('recording_meta.id recording_meta.saasConfig')
      .lean();

    if (!robot) {
      return res.status(404).json({ error: 'Automation not found' });
    }

    const robotMetaId = req.params.id;
    const [total, rows] = await Promise.all([
      ExtractedData.countDocuments({ robotMetaId }),
      ExtractedData.find({ robotMetaId })
        .select('runId source createdAt data')
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .lean(),
    ]);

    const cfg = getAutomationConfig(robot);
    const overrides = cfg.columnOverrides || {};
    const rowContextStored = sanitizeRowContextFields(cfg.rowContext);
    const normalizedTargets = normalizeDatabaseTargetColumns(cfg.databaseTargetColumns);
    const databaseTargetColumns =
      normalizedTargets !== undefined ? normalizedTargets : [...DEFAULT_JOB_DATABASE_TARGET_COLUMNS];
    const transformedRows = rows.map((row: any) => ({
      id: row._id?.toString?.() || row.id,
      runId: row.runId,
      source: row.source,
      createdAt: row.createdAt,
      data: applyReadPipelineToExtractedData(
        row.data,
        row.createdAt ? new Date(row.createdAt) : new Date(),
        overrides,
        cfg.rowContext
      ),
    }));

    const ctxKeySet = new Set<string>(ROW_CONTEXT_KEYS);
    const keySet = new Set(transformedRows.flatMap((row) => Object.keys(row.data || {})));
    ROW_CONTEXT_KEYS.forEach((k) => keySet.add(k));
    const rest = Array.from(keySet).filter((k) => !ctxKeySet.has(k));
    rest.sort((a, b) => a.localeCompare(b));
    const canonicalKeys = CANONICAL_JOB_FIELD_ORDER as readonly string[];
    const canonicalRest = canonicalKeys.filter((k) => !ctxKeySet.has(k) && rest.includes(k));
    const otherRest = rest.filter((k) => !canonicalRest.includes(k));
    const columns = [...ROW_CONTEXT_KEYS, ...canonicalRest, ...otherRest];

    return res.json({
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      columns,
      rows: transformedRows,
      overrides,
      rowContext: rowContextStored,
      databaseTargetColumns,
    });
  } catch (error: any) {
    logger.log('error', `Failed to fetch automation data ${req.params.id}: ${error.message}`);
    return res.status(500).json({ error: 'Failed to fetch automation data' });
  }
});

const COLUMN_NAME_LIMIT = 120;
const COLUMN_NAME_FORBIDDEN = /[,\n\r\t]/;

/**
 * Return the columns produced by the most recent persisted run for an
 * automation. We deliberately scope to the latest run rather than aggregating
 * all-time keys, because users iterate on the extraction config — earlier runs
 * may have stored columns that no longer exist in the current schema and would
 * confuse the Edit columns dialog.
 *
 * Falls back to all-time keys only when no rows exist for the latest run (rare,
 * but covers automations whose latest run produced 0 rows).
 */
async function collectExtractedColumns(robotMetaId: string): Promise<string[]> {
  const latestRow: any = await ExtractedData.findOne({ robotMetaId })
    .sort({ createdAt: -1 })
    .select({ runId: 1 })
    .lean();

  const matchStage: any = latestRow?.runId
    ? { robotMetaId, runId: latestRow.runId }
    : { robotMetaId };

  const result = await ExtractedData.aggregate([
    { $match: matchStage },
    { $project: { kv: { $objectToArray: { $ifNull: ['$data', {}] } } } },
    { $unwind: '$kv' },
    { $group: { _id: '$kv.k' } },
    { $sort: { _id: 1 } },
  ]);
  return result.map((row: any) => String(row._id)).filter((name) => name.length > 0);
}

router.get('/automations/:id/columns', async (req: any, res: any) => {
  try {
    const robot: any = await Robot.findOne({
      ...ownerIdFilter(req.user.id),
      'recording_meta.id': req.params.id,
    }).lean();

    if (!robot) {
      return res.status(404).json({ error: 'Automation not found' });
    }

    const overrides: Record<string, ColumnOverride> = getAutomationConfig(robot).columnOverrides || {};
    const storedKeys = await collectExtractedColumns(req.params.id);

    // Show columns from the latest run plus any saved override original keys
    // (so a user who renamed/cleared a column still sees the row in the dialog).
    const union = new Set<string>(storedKeys);
    Object.keys(overrides).forEach((key) => union.add(key));

    const columns = Array.from(union).sort((a, b) => a.localeCompare(b));

    return res.json({ columns, overrides });
  } catch (error: any) {
    logger.log('error', `Failed to fetch columns for ${req.params.id}: ${error.message}`);
    return res.status(500).json({ error: 'Failed to fetch automation columns' });
  }
});

router.put('/automations/:id/columns', async (req: any, res: any) => {
  try {
    const robot = await Robot.findOne({
      ...ownerIdFilter(req.user.id),
      'recording_meta.id': req.params.id,
    });

    if (!robot) {
      return res.status(404).json({ error: 'Automation not found' });
    }

    const incoming = (req.body && (req.body as any).overrides) || {};
    if (typeof incoming !== 'object' || Array.isArray(incoming)) {
      return res.status(400).json({ error: 'overrides must be an object keyed by original column name' });
    }

    const sanitized: Record<string, ColumnOverride> = {};
    const usedTargets = new Map<string, string>(); // target -> source key

    for (const [originalRaw, valueRaw] of Object.entries(incoming as Record<string, any>)) {
      const original = String(originalRaw || '').trim();
      if (!original) {
        return res.status(400).json({ error: 'Column override keys cannot be empty' });
      }
      if (original.length > COLUMN_NAME_LIMIT) {
        return res.status(400).json({ error: `Column name "${original}" exceeds ${COLUMN_NAME_LIMIT} characters` });
      }

      const entry: ColumnOverride = {};
      if (valueRaw && typeof valueRaw === 'object') {
        if (typeof valueRaw.rename === 'string') {
          const trimmed = valueRaw.rename.trim();
          if (trimmed.length > 0) {
            if (trimmed.length > COLUMN_NAME_LIMIT) {
              return res.status(400).json({ error: `Rename "${trimmed}" exceeds ${COLUMN_NAME_LIMIT} characters` });
            }
            if (COLUMN_NAME_FORBIDDEN.test(trimmed)) {
              return res.status(400).json({ error: `Rename "${trimmed}" cannot contain commas, tabs, or newlines` });
            }
            if (trimmed !== original) {
              entry.rename = trimmed;
            }
          }
        }
        if (valueRaw.clear === true) {
          entry.clear = true;
        }
        if (valueRaw.omit === true) {
          entry.omit = true;
        }
      }

      if (entry.omit && entry.clear) {
        return res.status(400).json({
          error: 'Remove column cannot be combined with clear values; choose one.',
        });
      }

      // Drop empty entries so we don't store no-op overrides
      if (!entry.rename && !entry.clear && !entry.omit) continue;

      if (!entry.omit) {
        const target = entry.rename || original;
        const conflict = usedTargets.get(target);
        if (conflict && conflict !== original) {
          return res.status(400).json({
            error: `Two columns cannot map to the same name "${target}" (sources: ${conflict}, ${original})`,
          });
        }
        usedTargets.set(target, original);
      }

      sanitized[original] = entry;
    }

    // Persist via $set on dotted paths. recording_meta is Schema.Types.Mixed —
    // updating with $set guarantees Mongo writes the new override map atomically
    // without relying on Mongoose's change-detection on Mixed sub-paths (which
    // can silently miss nested mutations and lead to "the tick disappears after
    // refresh" bugs).
    const $set: Record<string, unknown> = {
      'recording_meta.updatedAt': new Date().toLocaleString(),
      'recording_meta.saasConfig.columnOverrides': sanitized,
    };

    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'rowContext')) {
      $set['recording_meta.saasConfig.rowContext'] = sanitizeRowContextFields((req.body as any).rowContext);
    }

    const updated = await Robot.findOneAndUpdate(
      { _id: robot._id },
      { $set },
      { new: true }
    ).lean();

    const persisted = (updated as any)?.recording_meta?.saasConfig?.columnOverrides || {};
    const persistedCtx = sanitizeRowContextFields((updated as any)?.recording_meta?.saasConfig?.rowContext);
    return res.json({ overrides: persisted, rowContext: persistedCtx });
  } catch (error: any) {
    logger.log('error', `Failed to update columns for ${req.params.id}: ${error.message}`);
    return res.status(500).json({ error: 'Failed to update automation columns' });
  }
});

router.get('/runs/groups', async (req: any, res: any) => {
  try {
    const query = await resolveSaasRunListQuery(req);
    if (query.empty) {
      return res.json({
        groups: [],
        pagination: { page: query.page, limit: query.limit, total: 0, totalPages: 1 },
      });
    }

    const failureReasonStages = buildFailureReasonAggregationStages(query.failureReasons);
    const pipeline = buildRunGroupsPipeline({
      match: query.match,
      skip: query.skip,
      limit: query.limit,
      fromDate: query.fromDate,
      toDate: query.toDate,
      minDurationMs: query.minDurationMs,
      maxDurationMs: query.maxDurationMs,
      excludeHealedFailures: query.excludeHealedFailures,
      failureReasonPageStages: failureReasonStages.page,
    });

    const indexHint = resolveRunListIndexHint(query.match);
    const groupsAgg = Run.aggregate(pipeline);
    if (indexHint) groupsAgg.hint(indexHint);
    const agg = await groupsAgg;
    const bucket = agg[0] || { pageGroups: [], totals: [] };
    const total = bucket.totals[0]?.total ?? 0;
    const totalPages = total === 0 ? 1 : Math.ceil(total / query.limit);
    const pageGroups = bucket.pageGroups || [];

    const pageMetaIds = [
      ...new Set(pageGroups.map((g: any) => g._id).filter(Boolean)),
    ];
    const pageRobots = pageMetaIds.length
      ? await Robot.find({
          ...ownerIdFilter(req.user.id),
          'recording_meta.id': { $in: pageMetaIds },
        })
          .select(
            'recording_meta.id recording_meta.name recording_meta.url recording_meta.companyName recording_meta.scoutId recording_meta.saasConfig'
          )
          .lean()
      : [];
    const robotById = new Map(pageRobots.map((r: any) => [r.recording_meta.id, r]));

    const groups = pageGroups.map((group: any) => {
      const robot = robotById.get(group._id);
      const latestRun = group.latestRun || {};
      const extractedCount = typeof latestRun.rowsExtracted === 'number' ? latestRun.rowsExtracted : 0;
      const hydrated = enrichRunForList(latestRun, robot, extractedCount);
      return {
        robotMetaId: group._id,
        name: robot?.recording_meta?.name || hydrated.name || 'Automation',
        companyName: getCompanyName(robot) || hydrated.companyName || '',
        runCount: typeof group.runCount === 'number' ? group.runCount : 0,
        latestRun: hydrated,
      };
    });

    return res.json({
      groups,
      pagination: { page: query.page, limit: query.limit, total, totalPages },
    });
  } catch (error: any) {
    if (error?.statusCode === 404) {
      return res.status(404).json({ error: error.message || 'Automation not found' });
    }
    logger.log('error', `Failed to fetch run groups: ${error.message}`);
    return res.status(500).json({ error: 'Failed to fetch run groups' });
  }
});

router.delete('/runs/:id', async (req: any, res: any) => {
  try {
    const runId = String(req.params.id || '').trim();
    if (!runId) {
      return res.status(400).json({ error: 'Run id is required' });
    }

    const run: any = await Run.findOne({ runId }).select('runId robotMetaId ownerId runByUserId').lean();
    if (!run) {
      return res.status(404).json({ error: 'Run not found' });
    }

    const robot = await Robot.findOne({
      ...ownerIdFilter(req.user.id),
      'recording_meta.id': run.robotMetaId,
    })
      .select('_id')
      .lean();
    if (!robot) {
      return res.status(404).json({ error: 'Run not found' });
    }

    await Run.deleteOne({ runId });
    return res.json({ success: true });
  } catch (error: any) {
    logger.log('error', `Failed to delete run ${req.params.id}: ${error.message}`);
    return res.status(500).json({ error: 'Failed to delete run' });
  }
});

router.get('/runs/:id', async (req: any, res: any) => {
  try {
    const run: any = await Run.findOne({ runId: req.params.id })
      .select('-serializableOutput -binaryOutput -log')
      .lean();

    if (!run) {
      return res.status(404).json({ error: 'Run not found' });
    }

    const robot: any = await Robot.findOne({
      ...ownerIdFilter(req.user.id),
      'recording_meta.id': run.robotMetaId,
    }).lean();

    if (!robot) {
      return res.status(404).json({ error: 'Run not found' });
    }

    const publicRun = await enrichRunForSaas(run, robot);
    return res.json({
      run: publicRun,
      automation: {
        id: robot.recording_meta.id,
        scoutId: getScoutId(robot),
        name: robot.recording_meta.name,
        companyName: getCompanyName(robot),
        targetUrl: robot.recording_meta.url || '',
      },
      durationMs: computeRunDurationMs(run.startedAt, run.finishedAt),
    });
  } catch (error: any) {
    logger.log('error', `Failed to fetch run ${req.params.id}: ${error.message}`);
    return res.status(500).json({ error: 'Failed to fetch run details' });
  }
});

router.get('/runs/:id/logs', async (req: any, res: any) => {
  try {
    const [run]: any[] = await Run.aggregate([
      { $match: { runId: req.params.id } },
      {
        $project: {
          runId: 1,
          robotMetaId: 1,
          interpreterSettings: 1,
          logLength: { $strLenCP: { $ifNull: ['$log', ''] } },
        },
      },
    ]);
    if (!run) return res.status(404).json({ error: 'Run not found' });

    const robot: any = await Robot.findOne({
      ...ownerIdFilter(req.user.id),
      'recording_meta.id': run.robotMetaId,
    }).lean();
    if (!robot) return res.status(404).json({ error: 'Run not found' });

    const limit = parseDetailLimit(req.query.limit);
    const cursor = decodeDetailCursor(req.query.cursor);
    const logLength = typeof run.logLength === 'number' ? run.logLength : 0;
    const end = typeof cursor?.end === 'number' && cursor.end >= 0
      ? Math.min(Math.floor(cursor.end), logLength)
      : logLength;
    const page = await pageLogLinesFromEnd({
      end,
      limit,
      readChunk: async (start, length) => {
        const [result]: any[] = await Run.aggregate([
          { $match: { runId: req.params.id } },
          {
            $project: {
              chunk: {
                $substrCP: [{ $ifNull: ['$log', ''] }, start, length],
              },
            },
          },
        ]);
        return typeof result?.chunk === 'string' ? result.chunk : '';
      },
    });
    const logs = redactLogPage(page.lines, run, robot);
    return res.json({
      logs,
      nextCursor: page.nextEnd !== null ? encodeDetailCursor({ end: page.nextEnd }) : null,
      hasMore: page.nextEnd !== null,
    });
  } catch (error: any) {
    logger.log('error', `Failed to fetch run logs ${req.params.id}: ${error.message}`);
    return res.status(500).json({ error: 'Failed to fetch run logs' });
  }
});

router.get('/runs/:id/rows', async (req: any, res: any) => {
  try {
    const run: any = await Run.findOne({ runId: req.params.id }).select('runId robotMetaId').lean();
    if (!run) return res.status(404).json({ error: 'Run not found' });

    const robot: any = await Robot.findOne({
      ...ownerIdFilter(req.user.id),
      'recording_meta.id': run.robotMetaId,
    }).lean();
    if (!robot) return res.status(404).json({ error: 'Run not found' });

    const limit = parseDetailLimit(req.query.limit);
    const cursor = decodeDetailCursor(req.query.cursor);
    const outputOffset =
      typeof cursor?.outputOffset === 'number' && cursor.outputOffset >= 0
        ? Math.floor(cursor.outputOffset)
        : null;
    const cfg = getAutomationConfig(robot);
    const overrides = cfg.columnOverrides || {};

    if (outputOffset !== null) {
      const outputRun: any = await Run.findOne({ runId: run.runId }).select('serializableOutput').lean();
      const fallback = pageLegacyOutputRows(outputRun?.serializableOutput, cfg, outputOffset, limit);
      return res.json({
        rows: fallback.rows.map((row) => ({
          id: row.id,
          source: row.source,
          createdAt: null,
          data: applyReadPipelineToExtractedData(
            row.data,
            new Date(),
            overrides,
            cfg.rowContext
          ),
        })),
        nextCursor:
          fallback.nextOffset !== null
            ? encodeDetailCursor({ outputOffset: fallback.nextOffset })
            : null,
      });
    }

    const createdAt = cursor?.createdAt ? new Date(cursor.createdAt) : null;
    const after =
      createdAt && !Number.isNaN(createdAt.getTime()) && typeof cursor?.id === 'string'
        ? {
            $or: [
              { createdAt: { $gt: createdAt } },
              { createdAt, _id: { $gt: cursor.id } },
            ],
          }
        : {};
    const storedRows = await ExtractedData.find({ runId: run.runId, ...after })
      .select('source data createdAt')
      .sort({ createdAt: 1, _id: 1 })
      .limit(limit + 1)
      .lean();
    if (!cursor && storedRows.length === 0) {
      const outputRun: any = await Run.findOne({ runId: run.runId }).select('serializableOutput').lean();
      const fallback = pageLegacyOutputRows(outputRun?.serializableOutput, cfg, 0, limit);
      return res.json({
        rows: fallback.rows.map((row) => ({
          id: row.id,
          source: row.source,
          createdAt: null,
          data: applyReadPipelineToExtractedData(
            row.data,
            new Date(),
            overrides,
            cfg.rowContext
          ),
        })),
        nextCursor:
          fallback.nextOffset !== null
            ? encodeDetailCursor({ outputOffset: fallback.nextOffset })
            : null,
      });
    }
    const hasMore = storedRows.length > limit;
    const pageRows = hasMore ? storedRows.slice(0, limit) : storedRows;
    const rows = pageRows.map((row: any) => ({
      id: row._id?.toString?.() || row.id,
      source: row.source,
      createdAt: row.createdAt,
      data: applyReadPipelineToExtractedData(
        row.data,
        row.createdAt ? new Date(row.createdAt) : new Date(),
        overrides,
        cfg.rowContext
      ),
    }));
    const last = pageRows[pageRows.length - 1];
    return res.json({
      rows,
      nextCursor:
        hasMore && last
          ? encodeDetailCursor({ id: last._id?.toString?.() || last.id, createdAt: last.createdAt })
          : null,
    });
  } catch (error: any) {
    logger.log('error', `Failed to fetch run rows ${req.params.id}: ${error.message}`);
    return res.status(500).json({ error: 'Failed to fetch run rows' });
  }
});

router.patch('/runs/:id/failure-reason', async (req: any, res: any) => {
  try {
    const run: any = await Run.findOne({ runId: req.params.id });
    if (!run) {
      return res.status(404).json({ error: 'Run not found' });
    }

    const robot: any = await Robot.findOne({
      ...ownerIdFilter(req.user.id),
      'recording_meta.id': run.robotMetaId,
    })
      .select('_id')
      .lean();

    if (!robot) {
      return res.status(404).json({ error: 'Run not found' });
    }

    const { failureReason, confirmed } = req.body as {
      failureReason?: string | null;
      confirmed?: boolean;
    };

    if (failureReason === null || failureReason === '') {
      run.failureReason = null;
      run.failureReasonSource = 'override';
      run.normalizedFailureReason = null;
    } else {
      const reason = String(failureReason || '').trim();
      if (!FAILURE_REASONS.has(reason)) {
        return res.status(400).json({
          error: `Unsupported failureReason. Allowed: ${[...FAILURE_REASONS].join(', ')}`,
        });
      }
      run.failureReason = reason;
      run.failureReasonSource = confirmed === true ? 'confirmed' : 'override';
      run.normalizedFailureReason = reason;
    }

    await run.save();

    return res.json({
      success: true,
      runId: run.runId,
      failureReason: run.failureReason,
      failureReasonSource: run.failureReasonSource,
      normalizedFailureReason: run.normalizedFailureReason,
    });
  } catch (error: any) {
    logger.log('error', `Failed to update failure reason for ${req.params.id}: ${error.message}`);
    return res.status(500).json({ error: 'Failed to update failure reason' });
  }
});

router.put('/automations/:id/schedule', async (req: any, res: any) => {
  try {
    const robot = await Robot.findOne({
      ...ownerIdFilter(req.user.id),
      'recording_meta.id': req.params.id,
    });

    if (!robot) {
      return res.status(404).json({ error: 'Automation not found' });
    }

    const { enabled, cron, timezone, preferredNextRunAt } = req.body as {
      enabled?: boolean;
      cron?: string | null;
      timezone?: string;
      preferredNextRunAt?: string | null;
    };

    const existingConfig = (robot.recording_meta as any).saasConfig || {};
    const existingSaasSchedule = existingConfig.schedule || {};
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
      (typeof existingSaasSchedule.timezone === 'string' && moment.tz.zone(existingSaasSchedule.timezone)
        ? existingSaasSchedule.timezone
        : '') ||
      (typeof (rootSchedule as any).timezone === 'string' && moment.tz.zone((rootSchedule as any).timezone)
        ? (rootSchedule as any).timezone
        : '') ||
      'UTC';
    const wantEnabled = !!enabled;

    let nextCron = '';
    if (typeof cron === 'string' && cron.trim()) {
      nextCron = cron.trim();
    } else if (cron === null || cron === undefined || (typeof cron === 'string' && !cron.trim())) {
      // Pause / modal-off: client often omits cron — keep stored expression so Resume works.
      if (wantEnabled) {
        return res.status(400).json({ error: 'cron is required when enabling a schedule' });
      }
      nextCron = storedCron;
    }

    if (wantEnabled && !nextCron) {
      return res.status(400).json({ error: 'cron is required when enabling a schedule' });
    }

    if (wantEnabled && nextCron) {
      const v = validateAutomationScheduleCron(nextCron, tz);
      if (!v.ok) {
        return res.status(400).json({ error: v.error });
      }
    } else if (!wantEnabled && nextCron) {
      const v = validateAutomationScheduleCron(nextCron, tz);
      if (!v.ok) {
        return res.status(400).json({ error: v.error });
      }
    }

    const scheduleEnabled = wantEnabled && !!nextCron;
    const everyMs = nextCron ? intervalMsFromCron(nextCron) : null;

    const nextSaasConfig = {
      ...existingConfig,
      schedule: {
        enabled: scheduleEnabled,
        cron: nextCron,
        timezone: tz,
        ...(everyMs ? { every: everyMs } : { every: undefined }),
      },
    };

    const nextMeta = {
      ...robot.recording_meta,
      updatedAt: new Date().toLocaleString(),
      saasConfig: nextSaasConfig,
    };

    const nextSchedule = await syncAutomationSchedule(
      {
        ...robot.toJSON(),
        recording_meta: nextMeta,
        schedule: robot.schedule,
      },
      req.user.id,
      tz,
      preferredNextRunAt ? { preferredNextRunAt, packSlots: true } : { packSlots: true }
    );

    robot.recording_meta = nextMeta;
    robot.schedule = nextSchedule;
    await robot.save();

    logger.log(
      'info',
      `Updated schedule for automation ${req.params.id}: enabled=${nextSchedule.enabled}, cron=${nextSchedule.cron ? 'set' : 'empty'}`
    );

    return res.json({
      success: true,
      schedule: nextSchedule,
    });
  } catch (error: any) {
    logger.log('error', `Failed to update schedule for automation ${req.params.id}: ${error.message}`);
    return res.status(500).json({ error: 'Failed to update schedule' });
  }
});

router.delete('/automations/:id', async (req: any, res: any) => {
  try {
    await deleteAutomationCascade(req.user.id, req.params.id);
    return res.json({ success: true });
  } catch (error: any) {
    if (error?.statusCode === 404) {
      return res.status(404).json({ error: error.message || 'Automation not found' });
    }
    logger.log('error', `Failed to delete automation ${req.params.id}: ${error.message}`);
    return res.status(500).json({ error: 'Failed to delete automation' });
  }
});

router.get('/runs', async (req: any, res: any) => {
  try {
    const query = await resolveSaasRunListQuery(req);
    if (query.empty) {
      return res.json({
        runs: [],
        pagination: { page: query.page, limit: query.limit, total: 0, totalPages: 1 },
        countsByReason: Object.fromEntries(FAILURE_REASON_CODES.map((c) => [c, 0])),
      });
    }

    const countsMatch = { ...query.match };
    const failureReasonStages = buildFailureReasonAggregationStages(query.failureReasons);

    const pipeline = buildRunListPaginationPipeline({
      match: query.match,
      skip: query.skip,
      limit: query.limit,
      fromDate: query.fromDate,
      toDate: query.toDate,
      minDurationMs: query.minDurationMs,
      maxDurationMs: query.maxDurationMs,
      excludeHealedFailures: query.excludeHealedFailures,
      failureReasonPageStages: failureReasonStages.page,
    });

    const countsPipeline = buildRunFailureCountsPipeline({
      match: countsMatch,
      fromDate: query.fromDate,
      toDate: query.toDate,
      minDurationMs: query.minDurationMs,
      maxDurationMs: query.maxDurationMs,
      excludeHealedFailures: query.excludeHealedFailures,
      failureReasonCountStages: failureReasonStages.counts,
    });

    const indexHint = resolveRunListIndexHint(query.match);
    const runListAgg = Run.aggregate(pipeline);
    const countsAggQuery = Run.aggregate(countsPipeline);
    if (indexHint) {
      runListAgg.hint(indexHint);
      countsAggQuery.hint(indexHint);
    }
    const [agg, countsAgg] = await Promise.all([runListAgg, countsAggQuery]);
    const bucket = agg[0] || { pageRuns: [], totals: [] };
    const total = bucket.totals[0]?.total ?? 0;
    const totalPages = total === 0 ? 1 : Math.ceil(total / query.limit);

    const countsByReason: Record<string, number> = {};
    for (const code of FAILURE_REASON_CODES) {
      countsByReason[code] = 0;
    }
    for (const row of countsAgg || []) {
      const key = String(row._id || 'unknown');
      countsByReason[key] = (countsByReason[key] || 0) + (row.count || 0);
    }

    const pageRuns = bucket.pageRuns || [];
    const pageMetaIds = [...new Set(pageRuns.map((r: any) => r.robotMetaId).filter(Boolean))];
    const pageRobots = pageMetaIds.length
      ? await Robot.find({
          ...ownerIdFilter(req.user.id),
          'recording_meta.id': { $in: pageMetaIds },
        })
          .select(
            'recording_meta.id recording_meta.name recording_meta.url recording_meta.companyName recording_meta.scoutId recording_meta.saasConfig'
          )
          .lean()
      : [];
    const robotById = new Map(pageRobots.map((r: any) => [r.recording_meta.id, r]));

    const hydratedRuns = pageRuns.map((run: any) => {
      const robot = robotById.get(run.robotMetaId);
      const extractedCount = typeof run.rowsExtracted === 'number' ? run.rowsExtracted : 0;
      return enrichRunForList(run, robot, extractedCount);
    });

    return res.json({
      runs: hydratedRuns,
      pagination: { page: query.page, limit: query.limit, total, totalPages },
      countsByReason,
    });
  } catch (error: any) {
    if (error?.statusCode === 404) {
      return res.status(404).json({ error: error.message || 'Automation not found' });
    }
    logger.log('error', `Failed to fetch runs for SaaS API: ${error.message}`);
    return res.status(500).json({ error: 'Failed to fetch runs' });
  }
});

export default router;

import { Router } from 'express';
import { v4 as uuid } from 'uuid';
import { requireSignInOrApiKey } from '../middlewares/auth';
import Robot from '../models/Robot';
import Run from '../models/Run';
import ExtractedData from '../models/ExtractedData';
import logger from '../logger';
import moment from 'moment-timezone';
import { createQueuedAutomationRun } from '../services/automationRun';
import { syncAutomationSchedule, resolveEffectiveScheduleState } from '../services/automationScheduler';
import {
  applyColumnOverrides,
  applyReadPipelineToExtractedData,
  buildDashboardStatus,
  ColumnOverride,
  computeRunDurationMs,
  enrichRunForSaas,
  extractRowsFromOutput,
  getAutomationConfig,
  mergeRowContextIntoRowData,
  ROW_CONTEXT_KEYS,
  sanitizeRowContextFields,
} from '../services/automation';
import { CANONICAL_JOB_FIELD_ORDER } from '../services/canonicalJobRecord';
import { validateAutomationScheduleCron } from '../utils/schedule';
import { deleteAutomationCascade } from '../services/deleteAutomation';
import { DEFAULT_JOB_DATABASE_TARGET_COLUMNS } from '../constants/defaultJobDatabaseColumns';

const router = Router();

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

const normalizeAutomationUrl = (value: string) => {
  const trimmedValue = String(value || '').trim();

  if (!trimmedValue) {
    throw new Error('startUrl is required');
  }

  const collapsedProtocolValue = trimmedValue.replace(/^(https?:\/\/)+/i, (match) =>
    match.toLowerCase().startsWith('https://') ? 'https://' : 'http://'
  );

  const normalizedCandidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(collapsedProtocolValue)
    ? collapsedProtocolValue
    : `https://${collapsedProtocolValue}`;

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(normalizedCandidate);
  } catch {
    throw new Error('Invalid startUrl');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('startUrl must use http or https');
  }

  return parsedUrl.toString();
};

const parseStoredRunDate = (value?: string | null): number => {
  if (!value || typeof value !== 'string') return 0;

  const native = new Date(value).getTime();
  if (!Number.isNaN(native)) {
    return native;
  }

  const match = value.trim().match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4}),\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i
  );

  if (!match) return 0;

  const [, first, second, year, hourText, minuteText, secondText, meridiemRaw] = match;
  let day = parseInt(first, 10);
  let month = parseInt(second, 10);

  // Stored values in this app are commonly emitted as DD/MM/YYYY on some environments.
  // If the second token is clearly a day, swap to MM/DD parsing; otherwise default to DD/MM.
  if (day <= 12 && month > 12) {
    day = parseInt(second, 10);
    month = parseInt(first, 10);
  }

  let hour = parseInt(hourText, 10);
  const minute = parseInt(minuteText, 10);
  const secondValue = parseInt(secondText || '0', 10);
  const meridiem = (meridiemRaw || '').toLowerCase();

  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;

  return new Date(parseInt(year, 10), month - 1, day, hour, minute, secondValue).getTime();
};

const getRunSortTime = (run?: any): number => {
  if (!run) return 0;
  return Math.max(parseStoredRunDate(run.finishedAt), parseStoredRunDate(run.startedAt));
};

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
  let activeScheduledCount = 0;
  let pausedScheduleCount = 0;
  const cursor = Robot.find({ userId }).select('schedule recording_meta').lean().cursor();
  for await (const robot of cursor) {
    const { active, paused } = robotScheduleSummaryFlags(robot);
    if (active) activeScheduledCount += 1;
    if (paused) pausedScheduleCount += 1;
  }
  return { activeScheduledCount, pausedScheduleCount };
}

/** Latest run per robotMetaId for a bounded id set (aggregation; avoids loading all runs for the account). */
async function fetchLatestRunPerRobotMetaIds(robotMetaIds: string[]): Promise<Map<string, any>> {
  const latestRuns = new Map<string, any>();
  if (robotMetaIds.length === 0) {
    return latestRuns;
  }

  const pipeline: any[] = [
    { $match: { robotMetaId: { $in: robotMetaIds } } },
    {
      $addFields: {
        _sa: {
          $convert: { input: { $ifNull: ['$startedAt', ''] }, to: 'date', onError: null, onNull: null },
        },
        _fa: {
          $convert: { input: { $ifNull: ['$finishedAt', ''] }, to: 'date', onError: null, onNull: null },
        },
      },
    },
    {
      $addFields: {
        _sortTs: {
          $max: [{ $ifNull: ['$_sa', new Date(0)] }, { $ifNull: ['$_fa', new Date(0)] }],
        },
      },
    },
    { $sort: { _sortTs: -1, _id: -1 } },
    {
      $group: {
        _id: '$robotMetaId',
        run: { $first: '$$ROOT' },
      },
    },
  ];

  const rows = await Run.aggregate(pipeline);
  for (const row of rows) {
    const r = row.run;
    if (!r) continue;
    delete r._sa;
    delete r._fa;
    delete r._sortTs;
    latestRuns.set(row._id, r);
  }
  return latestRuns;
}

const mapAutomation = async (robot: any, latestRun?: any) => {
  const rowsExtracted = latestRun
    ? await ExtractedData.countDocuments({ runId: latestRun.runId })
    : 0;

  const eff = resolveEffectiveScheduleState(robot);
  const hasInterval = !!(eff.cron || eff.every);
  const rootSch = robot.schedule || {};
  const nextRunIso =
    rootSch.nextRunAt != null
      ? new Date(rootSch.nextRunAt).toISOString()
      : null;
  const lastRunIso =
    rootSch.lastRunAt != null
      ? new Date(rootSch.lastRunAt).toISOString()
      : null;
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
    name: robot.recording_meta.name,
    targetUrl: robot.recording_meta.url || '',
    createdAt: robot.recording_meta.createdAt,
    updatedAt: robot.recording_meta.updatedAt,
    status: buildDashboardStatus(latestRun),
    lastRunTime: latestRun?.finishedAt || latestRun?.startedAt || null,
    rowsExtracted,
    latestRunId: latestRun?.runId || null,
    webhookUrl: getAutomationConfig(robot).webhookUrl || '',
    config: getAutomationConfig(robot),
    schedule,
  };
};

router.use(requireSignInOrApiKey);

router.get('/dashboard/automations', async (req: any, res: any) => {
  try {
    const { page, limit, skip } = parseListPagination(req);

    const [summary, total, robots] = await Promise.all([
      computeAccountRobotSummary(req.user.id),
      Robot.countDocuments({ userId: req.user.id }),
      Robot.find({ userId: req.user.id }).sort({ _id: -1 }).skip(skip).limit(limit).lean(),
    ]);

    const summaryOut = {
      totalAutomations: total,
      activeScheduledCount: summary.activeScheduledCount,
      pausedScheduleCount: summary.pausedScheduleCount,
    };

    const pageIds = robots.map((robot: any) => robot.recording_meta.id);
    const latestRuns = await fetchLatestRunPerRobotMetaIds(pageIds);

    const automations = await Promise.all(
      robots.map((robot: any) => mapAutomation(robot, latestRuns.get(robot.recording_meta.id)))
    );

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

/**
 * Disable recurring schedules for every automation owned by the caller and cancel Agenda triggers.
 * Does not cancel in-flight scraper runs — those finish or fail on their own.
 */
router.post('/automations/schedules/stop-all', async (req: any, res: any) => {
  try {
    const robots = await Robot.find({ userId: req.user.id });
    let stoppedCount = 0;

    for (const robot of robots) {
      const effective = resolveEffectiveScheduleState(robot.toJSON());
      if (!effective.enabled || (!effective.cron && !effective.every)) {
        continue;
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
      stoppedCount += 1;
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
    const robots = await Robot.find({ userId: req.user.id });
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
        tz
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

router.get('/automations/:id', async (req: any, res: any) => {
  try {
    const robot: any = await Robot.findOne({
      userId: req.user.id,
      'recording_meta.id': req.params.id,
    }).lean();

    if (!robot) {
      return res.status(404).json({ error: 'Automation not found' });
    }

    const allRuns = await Run.find({ robotMetaId: req.params.id }).lean();
    const latestRun = allRuns.length > 0
      ? allRuns.sort((a: any, b: any) => getRunSortTime(b) - getRunSortTime(a))[0]
      : null;

    return res.json({
      automation: await mapAutomation(robot, latestRun),
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
    const { name, startUrl, workflow, config, webhookUrl } = req.body;

    if (!name || !startUrl) {
      return res.status(400).json({ error: 'name and startUrl are required' });
    }

    const normalizedStartUrl = normalizeAutomationUrl(startUrl);

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

    const robot = await Robot.create({
      id: uuid(),
      userId: req.user.id,
      recording_meta: {
        name,
        id: robotMetaId,
        createdAt,
        updatedAt: createdAt,
        pairs: workflow?.workflow?.length || workflow?.length || 1,
        params: [],
        type: 'extract',
        url: normalizedStartUrl,
        saasConfig: {
          ...(config || {}),
          webhookUrl: webhookUrl || config?.webhookUrl || '',
          databaseTargetColumns: resolvedDbCols,
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

    return res.status(201).json({
        automation: {
          id: robotMetaId,
          name,
          targetUrl: normalizedStartUrl,
          status: 'idle',
          lastRunTime: null,
          rowsExtracted: 0,
        config: getAutomationConfig(robot),
        schedule: nextSchedule,
      },
    });
  } catch (error: any) {
    logger.log('error', `Failed to create automation: ${error.message}`);
    if (error?.code === 11000) {
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
    const robot = await Robot.findOne({
      userId: req.user.id,
      'recording_meta.id': req.params.id,
    });

    if (!robot) {
      return res.status(404).json({ error: 'Automation not found' });
    }

    const { name, startUrl, config, webhookUrl } = req.body;
    const normalizedStartUrl = startUrl ? normalizeAutomationUrl(startUrl) : undefined;

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

    const nextMeta = {
      ...robot.recording_meta,
      ...(name ? { name } : {}),
      ...(normalizedStartUrl ? { url: normalizedStartUrl } : {}),
      updatedAt: new Date().toLocaleString(),
      saasConfig: {
        ...(getAutomationConfig(robot) || {}),
        ...(config || {}),
        ...(webhookUrl !== undefined ? { webhookUrl } : {}),
      },
    };

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
      incomingTimezone
    );

    robot.recording_meta = nextMeta;
    robot.schedule = nextSchedule;
    await robot.save();

    return res.json({
      success: true,
      automation: {
        id: nextMeta.id,
        name: nextMeta.name,
        targetUrl: nextMeta.url || '',
        config: nextMeta.saasConfig || {},
        schedule: nextSchedule,
      },
    });
  } catch (error: any) {
    logger.log('error', `Failed to update automation config ${req.params.id}: ${error.message}`);
    return res.status(500).json({ error: 'Failed to update automation config' });
  }
});

router.post('/automations/:id/run', async (req: any, res: any) => {
  try {
    const robot: any = await Robot.findOne({
      userId: req.user.id,
      'recording_meta.id': req.params.id,
    }).lean();

    if (!robot) {
      return res.status(404).json({ error: 'Automation not found' });
    }

    const result = await createQueuedAutomationRun(robot, req.user.id, {
      source: 'manual',
      runtimeConfig: getAutomationConfig(robot),
    });

    return res.json({
      ...result,
      automationId: robot.recording_meta.id,
    });
  } catch (error: any) {
    logger.log('error', `Failed to run automation ${req.params.id}: ${error.message}`);
    return res.status(500).json({ error: 'Failed to run automation' });
  }
});

router.get('/automations/:id/data', async (req: any, res: any) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '25'), 10)));
    const offset = (page - 1) * limit;

    const robot: any = await Robot.findOne({
      userId: req.user.id,
      'recording_meta.id': req.params.id,
    }).lean();

    if (!robot) {
      return res.status(404).json({ error: 'Automation not found' });
    }

    const total = await ExtractedData.countDocuments({ robotMetaId: req.params.id });
    const rows = await ExtractedData.find({ robotMetaId: req.params.id })
      .sort({ createdAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean();

    const cfg = getAutomationConfig(robot);
    const overrides = cfg.columnOverrides || {};
    const rowContextStored = sanitizeRowContextFields(cfg.rowContext);
    const normalizedTargets = normalizeDatabaseTargetColumns(cfg.databaseTargetColumns);
    const databaseTargetColumns =
      normalizedTargets !== undefined ? normalizedTargets : [...DEFAULT_JOB_DATABASE_TARGET_COLUMNS];
    const transformedRows = rows.map((row: any) => ({
      id: row.id,
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
      userId: req.user.id,
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
      userId: req.user.id,
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

router.get('/runs/:id', async (req: any, res: any) => {
  try {
    const run: any = await Run.findOne({ runId: req.params.id }).lean();

    if (!run) {
      return res.status(404).json({ error: 'Run not found' });
    }

    const robot: any = await Robot.findOne({
      userId: req.user.id,
      'recording_meta.id': run.robotMetaId,
    }).lean();

    if (!robot) {
      return res.status(404).json({ error: 'Run not found' });
    }

    const extractedFromDb = await ExtractedData.find({ runId: run.runId })
      .sort({ createdAt: 1 })
      .lean();

    const robotCfg = getAutomationConfig(robot);
    const overrides = robotCfg.columnOverrides || {};

    /** When nothing was persisted (0-row extraction, or rare persistence gaps), still surface output from the run document. */
    let extractedRowsPayload = extractedFromDb.map((row: any) => ({
      id: row.id,
      source: row.source,
      data: applyReadPipelineToExtractedData(
        row.data,
        row.createdAt ? new Date(row.createdAt) : new Date(),
        overrides,
        robotCfg.rowContext
      ),
      createdAt: row.createdAt,
    }));

    if (extractedRowsPayload.length === 0 && run.serializableOutput && typeof run.serializableOutput === 'object') {
      const cfg = getAutomationConfig(robot);
      const synthetic = extractRowsFromOutput(run.serializableOutput, cfg);
      extractedRowsPayload = synthetic.map((row, index) => ({
        id: `from-run-output-${index}`,
        source: row.source,
        data: mergeRowContextIntoRowData(applyColumnOverrides(row.data, overrides), cfg.rowContext),
        createdAt: null as Date | null,
      }));
    }

    return res.json({
      run: await enrichRunForSaas(run, robot),
      automation: {
        id: robot.recording_meta.id,
        name: robot.recording_meta.name,
        targetUrl: robot.recording_meta.url || '',
      },
      extractedRows: extractedRowsPayload,
      durationMs: computeRunDurationMs(run.startedAt, run.finishedAt),
      logs: typeof run.log === 'string' ? run.log.split('\n').filter(Boolean) : [],
    });
  } catch (error: any) {
    logger.log('error', `Failed to fetch run ${req.params.id}: ${error.message}`);
    return res.status(500).json({ error: 'Failed to fetch run details' });
  }
});

router.put('/automations/:id/schedule', async (req: any, res: any) => {
  try {
    const robot = await Robot.findOne({
      userId: req.user.id,
      'recording_meta.id': req.params.id,
    });

    if (!robot) {
      return res.status(404).json({ error: 'Automation not found' });
    }

    const { enabled, cron, timezone } = req.body as { enabled?: boolean; cron?: string | null; timezone?: string };

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

    const nextSaasConfig = {
      ...existingConfig,
      schedule: {
        enabled: scheduleEnabled,
        cron: nextCron,
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
    const { page, limit, skip } = parseListPagination(req);
    const robots = await Robot.find({ userId: req.user.id }).lean();
    const allowedRobotIds = new Set(robots.map((robot: any) => robot.recording_meta.id));
    const robotMetaIdFilter = req.query.robotMetaId != null ? String(req.query.robotMetaId) : '';

    const match: any =
      robotMetaIdFilter
        ? { robotMetaId: robotMetaIdFilter }
        : { robotMetaId: { $in: Array.from(allowedRobotIds) } };

    if (robotMetaIdFilter && !allowedRobotIds.has(robotMetaIdFilter)) {
      return res.status(404).json({ error: 'Automation not found' });
    }

    const pipeline: any[] = [
      { $match: match },
      {
        $addFields: {
          _sa: {
            $convert: { input: { $ifNull: ['$startedAt', ''] }, to: 'date', onError: null, onNull: null },
          },
          _fa: {
            $convert: { input: { $ifNull: ['$finishedAt', ''] }, to: 'date', onError: null, onNull: null },
          },
        },
      },
      {
        $addFields: {
          _sortTs: {
            $max: [{ $ifNull: ['$_sa', new Date(0)] }, { $ifNull: ['$_fa', new Date(0)] }],
          },
        },
      },
      { $sort: { _sortTs: -1, _id: -1 } },
      {
        $facet: {
          pageRuns: [{ $skip: skip }, { $limit: limit }],
          totals: [{ $count: 'total' }],
        },
      },
    ];

    const agg = await Run.aggregate(pipeline);
    const bucket = agg[0] || { pageRuns: [], totals: [] };
    const total = bucket.totals[0]?.total ?? 0;
    const totalPages = total === 0 ? 1 : Math.ceil(total / limit);

    const pageRunsRaw = bucket.pageRuns || [];
    const pageRuns = pageRunsRaw.map((run: any) => {
      const copy = { ...run };
      delete copy._sa;
      delete copy._fa;
      delete copy._sortTs;
      return copy;
    });

    const hydratedRuns = await Promise.all(
      pageRuns.map(async (run: any) => {
        const robot = robots.find((candidate: any) => candidate.recording_meta.id === run.robotMetaId);
        return enrichRunForSaas(run, robot);
      })
    );

    return res.json({
      runs: hydratedRuns,
      pagination: { page, limit, total, totalPages },
    });
  } catch (error: any) {
    logger.log('error', `Failed to fetch runs for SaaS API: ${error.message}`);
    return res.status(500).json({ error: 'Failed to fetch runs' });
  }
});

export default router;

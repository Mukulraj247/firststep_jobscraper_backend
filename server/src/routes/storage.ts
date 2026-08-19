import { Router } from 'express';
import mongoose from 'mongoose';
import logger from "../logger";
import { createRemoteBrowserForRun, destroyRemoteBrowser, getActiveBrowserIdByState } from "../browser-management/controller";
import { browserPool } from "../server";
import { v4 as uuid } from "uuid";
import moment from 'moment-timezone';
import cron from 'node-cron';
import { requireSignIn } from '../middlewares/auth';
import Robot from '../models/Robot';
import Run from '../models/Run';
import { AuthenticatedRequest } from './record';
import { computeNextRun } from '../utils/schedule';
import { capture } from "../utils/analytics";
import { encrypt } from '../utils/auth';
import { cancelScheduledWorkflow, scheduleWorkflow } from '../storage/schedule';
import { enqueueScraperRun, enqueueAbortRun, enqueueExecuteRun } from '../queue/scraperQueue';
import { getAutomationConfig } from '../services/automation';
import {
  toOperationalRunConfig,
  toPublicRunDto,
} from '../services/automationConfigView';
import { recoverOrphanedRuns } from '../services/orphanRunRecovery';
export { recoverOrphanedRuns };
import {
  DEFAULT_OUTPUT_FORMATS,
  parseOutputFormats,
  SEARCH_SCRAPE_OUTPUT_FORMAT_OPTIONS,
  SCRAPE_OUTPUT_FORMAT_OPTIONS,
  OutputFormat,
} from '../constants/output-formats';
import { processWorkflowActions } from '../utils/workflowHelpers';
import { ownerIdFilter, normalizeOwnerIdForWrite } from '../utils/ownerId';
import {
  clampCrawlLimit,
  clampSearchLimit,
  assertCrawlFormatsAllowed,
} from '../constants/robotCreateLimits';

export const router = Router();
export { processWorkflowActions };

async function isRobotNameTaken(name: string, userId: number | string, excludeId?: string): Promise<boolean> {
  const normalised = name.trim().toLowerCase();
  const robots = await Robot.find(ownerIdFilter(userId)).lean();
  
  const matching = robots.filter((r: any) => {
    const robotName = r.recording_meta?.name?.trim().toLowerCase();
    return robotName === normalised;
  });
  
  if (matching.length === 0) return false;
  if (excludeId) {
    return matching.some((r: any) => r.recording_meta.id !== excludeId);
  }
  return true;
}

/**
 * Logs information about recordings API.
 */
router.all('/', requireSignIn, (req, res, next) => {
  logger.log('debug', `The recordings API was invoked: ${req.url}`)
  next() // pass control to the next handler
})

const DEFAULT_RUNS_LIMIT = 50;
const MAX_RUNS_LIMIT = 100;

function parsePagination(query: any, defaultLimit: number, maxLimit: number) {
  const rawPage = parseInt(String(query?.page ?? '1'), 10);
  const rawLimit = parseInt(String(query?.limit ?? String(defaultLimit)), 10);
  const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;
  const limit = Math.min(maxLimit, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : defaultLimit));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

/**
 * GET endpoint for getting a recording.
 */
router.get('/recordings/:id', requireSignIn, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).send({ error: 'Unauthorized' });
    }
    const data: any = await Robot.findOne({
      ...ownerIdFilter(req.user.id),
      'recording_meta.id': req.params.id,
    }).lean();

    if (data?.recording?.workflow) {
      data.recording.workflow = processWorkflowActions(
        data.recording.workflow,
      );
    }

    return res.send(data);
  } catch (e) {
    logger.log('info', 'Error while reading robots');
    return res.send(null);
  }
})

router.get(('/recordings/:id/runs'), requireSignIn, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        statusCode: 401,
        messageCode: "error",
        message: "Unauthorized",
      });
    }

    const robot = await Robot.findOne({
      ...ownerIdFilter(req.user.id),
      'recording_meta.id': req.params.id,
    })
      .select('_id')
      .lean();

    if (!robot) {
      return res.status(404).json({
        statusCode: 404,
        messageCode: "error",
        message: "Recording not found",
      });
    }

    const { page, limit, skip } = parsePagination(
      req.query,
      DEFAULT_RUNS_LIMIT,
      MAX_RUNS_LIMIT
    );

    const [totalCount, runs] = await Promise.all([
      Run.countDocuments({ robotMetaId: req.params.id }),
      Run.find({ robotMetaId: req.params.id })
        .sort({ _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    const formattedRuns = runs.map(formatRunResponse);
    const response = {
      statusCode: 200,
      messageCode: "success",
      runs: {
        totalCount,
        page,
        limit,
        items: formattedRuns,
      },
    };

    res.status(200).json(response);
  } catch (error) {
    console.error("Error fetching runs:", error);
    res.status(500).json({
      statusCode: 500,
      messageCode: "error",
      message: "Failed to retrieve runs",
    });
  }
})

function formatRunResponse(run: any) {
  const formattedRun = {
    id: run._id || run.id,
    status: run.status,
    name: run.name,
    robotId: run.robotMetaId, // Renaming robotMetaId to robotId
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    runId: run.runId,
    runByUserId: run.runByUserId,
    runByScheduleId: run.runByScheduleId,
    runByAPI: run.runByAPI,
    data: {},
    screenshot: null,
  };

  if (run.serializableOutput && run.serializableOutput['item-0']) {
    formattedRun.data = run.serializableOutput['item-0'];
  } else if (run.binaryOutput && run.binaryOutput['item-0']) {
    formattedRun.screenshot = run.binaryOutput['item-0'];
  }

  return formattedRun;
}

interface CredentialInfo {
  value: string;
  type: string;
}

interface Credentials {
  [key: string]: CredentialInfo;
}

function handleWorkflowActions(workflow: any[], credentials: Credentials) {
  return workflow.map(step => {
    if (!step.what) return step;

    const newWhat: any[] = [];
    const processedSelectors = new Set<string>();

    for (let i = 0; i < step.what.length; i++) {
      const action = step.what[i];

      if (!action?.action || !action?.args?.[0]) {
        newWhat.push(action);
        continue;
      }

      const selector = action.args[0];
      const credential = credentials[selector];

      if (!credential) {
        newWhat.push(action);
        continue;
      }

      if (action.action === 'click') {
        newWhat.push(action);

        if (!processedSelectors.has(selector) &&
          i + 1 < step.what.length &&
          (step.what[i + 1].action === 'type' || step.what[i + 1].action === 'press')) {

          newWhat.push({
            action: 'type',
            args: [selector, encrypt(credential.value), credential.type]
          });

          newWhat.push({
            action: 'waitForLoadState',
            args: ['networkidle']
          });

          processedSelectors.add(selector);

          while (i + 1 < step.what.length &&
            (step.what[i + 1].action === 'type' ||
              step.what[i + 1].action === 'press' ||
              step.what[i + 1].action === 'waitForLoadState')) {
            i++;
          }
        }
      } else if ((action.action === 'type' || action.action === 'press') &&
        !processedSelectors.has(selector)) {
        newWhat.push({
          action: 'type',
          args: [selector, encrypt(credential.value), credential.type]
        });

        newWhat.push({
          action: 'waitForLoadState',
          args: ['networkidle']
        });

        processedSelectors.add(selector);

        // Skip subsequent type/press/waitForLoadState actions for this selector
        while (i + 1 < step.what.length &&
          (step.what[i + 1].action === 'type' ||
            step.what[i + 1].action === 'press' ||
            step.what[i + 1].action === 'waitForLoadState')) {
          i++;
        }
      }
    }

    return {
      ...step,
      what: newWhat
    };
  });
}

/**
 * PUT endpoint to update the name and limit of a robot.
 */
router.put('/recordings/:id', requireSignIn, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const { name, limits, credentials, targetUrl, workflow: incomingWorkflow, formats } = req.body;

    if (!name && !limits && !credentials && !targetUrl && !incomingWorkflow && formats === undefined) {
      return res.status(400).json({ error: 'Either "name", "limits", "credentials", "target_url", "workflow" or "formats" must be provided.' });
    }

    const robot: any = await Robot.findOne({ 'recording_meta.id': id });
    if (!robot) {
      return res.status(404).json({ error: 'Robot not found.' });
    }

    let workflow: any[] = Array.isArray(incomingWorkflow)
      ? JSON.parse(JSON.stringify(incomingWorkflow))
      : (Array.isArray(robot.recording?.workflow) ? [...robot.recording.workflow] : []);

    if (targetUrl) {
      if (robot.recording_meta?.type === 'scrape') {
        workflow = workflow.map((step: any) => {
          const updatedWhere = step.where?.url && step.where.url !== 'about:blank'
            ? { ...step.where, url: targetUrl }
            : step.where;

          const updatedWhat = (step.what || []).map((action: any) => {
            if (action.action === 'goto' && action.args?.length) {
              return { ...action, args: [targetUrl, ...action.args.slice(1)] };
            }
            if (action.action === 'scrape' && action.args?.[0] && typeof action.args[0] === 'object') {
              return { ...action, args: [{ ...action.args[0], url: targetUrl }, ...action.args.slice(1)] };
            }
            return action;
          });

          return { ...step, where: updatedWhere, what: updatedWhat };
        });
      } else {
        const entryStep = [...workflow].reverse().find((s: any) => s.where?.url === 'about:blank');
        const originalEntryUrl: string | null = entryStep?.what?.find(
          (action: any) => action.action === 'goto' && action.args?.length
        )?.args?.[0] ?? null;

        let gotoUpdated = false;
        let whereUpdateStopped = false;

        workflow = [...workflow].reverse().map((step: any) => {
          let updatedWhere = step.where;
          if (originalEntryUrl && step.where?.url !== 'about:blank' && !whereUpdateStopped) {
            if (step.where?.url === originalEntryUrl) {
              updatedWhere = { ...step.where, url: targetUrl };
            } else {
              whereUpdateStopped = true;
            }
          }

          const updatedWhat = (step.what || []).map((action: any) => {
            if (!gotoUpdated && action.action === 'goto' && action.args?.[0] === originalEntryUrl) {
              gotoUpdated = true;
              return { ...action, args: [targetUrl, ...action.args.slice(1)] };
            }
            return action;
          });

          return { ...step, where: updatedWhere, what: updatedWhat };
        }).reverse();
      }
    }

    if (credentials) {
      workflow = handleWorkflowActions(workflow, credentials);
    }

    if (limits && Array.isArray(limits) && limits.length > 0) {
      for (const limitInfo of limits) {
        const { pairIndex, actionIndex, argIndex, limit } = limitInfo;

        const pair = workflow[pairIndex];
        if (!pair || !pair.what) continue;

        const action = pair.what[actionIndex];
        if (!action || !action.args) continue;

        const arg = action.args[argIndex];
        if (!arg || typeof arg !== 'object') continue;

        (arg as { limit: number }).limit = limit;
      }
    }

    let normalizedFormats: OutputFormat[] | undefined;
    
    let searchMode: string | undefined;
    if (robot.recording_meta?.type === 'search') {
      const searchAction = workflow
        .flatMap((pair: any) => pair.what || [])
        .find((action: any) => action?.action === 'search');
      searchMode = searchAction?.args?.[0]?.mode;
    }

    if (formats !== undefined || (robot.recording_meta?.type === 'search' && searchMode === 'discover')) {
      let allowedFormats: readonly OutputFormat[] | undefined;
      if (robot.recording_meta?.type === 'scrape') {
        allowedFormats = SCRAPE_OUTPUT_FORMAT_OPTIONS;
      } else if (robot.recording_meta?.type === 'search' && searchMode === 'scrape') {
        allowedFormats = SEARCH_SCRAPE_OUTPUT_FORMAT_OPTIONS;
      }

      const { validFormats, invalidFormats } = parseOutputFormats(formats, allowedFormats);

      if (invalidFormats.length > 0) {
        return res.status(400).json({
          error: `Invalid formats: ${invalidFormats.map(String).join(', ')}`,
        });
      }

      if (robot.recording_meta?.type === 'crawl') {
        normalizedFormats = validFormats.length > 0 ? validFormats : [...DEFAULT_OUTPUT_FORMATS];
      } else if (robot.recording_meta?.type === 'scrape') {
        normalizedFormats = validFormats.length > 0 ? validFormats : [...DEFAULT_OUTPUT_FORMATS];
      } else if (robot.recording_meta?.type === 'search') {
        if (searchMode === 'discover') {
          normalizedFormats = [];
        } else {
          normalizedFormats = validFormats.length > 0 ? validFormats : [...DEFAULT_OUTPUT_FORMATS];
        }
      } else {
        normalizedFormats = validFormats;
      }
    }

    let trimmedName: string | undefined;
    if (name !== undefined) {
      if (typeof name !== 'string') {
        return res.status(400).json({ error: 'Robot name must be a string.' });
      }
      trimmedName = name.trim();
      if (!trimmedName) {
        return res.status(400).json({ error: 'Robot name cannot be empty.' });
      }
      if (trimmedName.toLowerCase() !== robot.recording_meta.name.trim().toLowerCase()) {
        const nameTaken = await isRobotNameTaken(trimmedName, robot.userId as number, id);
        if (nameTaken) {
          return res.status(409).json({ error: `A robot with the name "${trimmedName}" already exists.` });
        }
      }
    }

    let updatedMeta = { ...robot.recording_meta };
    if (trimmedName) updatedMeta.name = trimmedName;
    if (targetUrl) updatedMeta.url = targetUrl;
    if (normalizedFormats !== undefined) updatedMeta.formats = normalizedFormats;

    const updates: any = {
      recording: { ...robot.recording, workflow },
      recording_meta: updatedMeta,
    };

    await Robot.updateOne({ 'recording_meta.id': id }, { $set: updates });

    logger.log('info', `Robot with ID ${id} was updated successfully.`);

    return res.status(200).json({ message: 'Robot updated successfully', robot });
  } catch (error: any) {
    if (error.code === 11000) {
      return res.status(409).json({ error: 'A robot with this name already exists.' });
    }
    // Safely handle the error type
    if (error instanceof Error) {
      logger.log('error', `Error updating robot with ID ${req.params.id}: ${error.message}`);
      return res.status(500).json({ error: error.message });
    } else {
      logger.log('error', `Unknown error updating robot with ID ${req.params.id}`);
      return res.status(500).json({ error: 'An unknown error occurred.' });
    }
  }
});

/**
 * POST endpoint for creating a markdown robot
 */
router.post('/recordings/scrape', requireSignIn, async (req: AuthenticatedRequest, res) => {
  try {
    const { url, name, formats } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'The "url" field is required.' });
    }

    if (!req.user) {
      return res.status(401).send({ error: 'Unauthorized' });
    }

    // Validate URL format
    try {
      new URL(url);
    } catch (err) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    const { validFormats: scrapeFormats, invalidFormats } = parseOutputFormats(
      formats,
      SCRAPE_OUTPUT_FORMAT_OPTIONS
    );

    if (invalidFormats.length > 0) {
      return res.status(400).json({
        error: `Invalid formats: ${invalidFormats.map(String).join(', ')}`,
      });
    }

    const finalFormats = scrapeFormats.length > 0 ? scrapeFormats : DEFAULT_OUTPUT_FORMATS;

    const robotName = (typeof name === 'string' ? name.trim() : '') || `Markdown Robot - ${new URL(url).hostname}`;
    if (!robotName) {
      return res.status(400).json({ error: 'Robot name cannot be empty.' });
    }

    if (await isRobotNameTaken(robotName, req.user.id)) {
      return res.status(409).json({ error: `A robot with the name "${robotName}" already exists.` });
    }

    if (scrapeFormats.length === 0 && formats !== undefined) {
      return res.status(400).json({ error: 'At least one output format must be selected.' });
    }

    const currentTimestamp = new Date().toLocaleString();
    const robotId = uuid();

    const newRobot = await Robot.create({
      userId: normalizeOwnerIdForWrite(req.user.id),
      recording_meta: {
        name: robotName,
        id: robotId,
        createdAt: currentTimestamp,
        updatedAt: currentTimestamp,
        pairs: 0,
        params: [],
        type: 'scrape',
        url: url,
        formats: finalFormats,
      },
      recording: { workflow: [] },
      google_sheet_email: null,
      google_sheet_name: null,
      google_sheet_id: null,
      google_access_token: null,
      google_refresh_token: null,
      schedule: null,
    });

    logger.log('info', `Markdown robot created with id: ${newRobot._id}`);
    capture(
      'maxun-oss-robot-created',
      {
        robot_meta: newRobot.recording_meta,
        recording: newRobot.recording,
      }
    )

    return res.status(201).json({
      message: 'Markdown robot created successfully.',
      robot: newRobot,
    });
  } catch (error: any) {
    if (error.code === 11000) {
      return res.status(409).json({ error: 'A robot with this name already exists.' });
    }
    if (error instanceof Error) {
      logger.log('error', `Error creating markdown robot: ${error.message}`);
      return res.status(500).json({ error: error.message });
    } else {
      logger.log('error', 'Unknown error creating markdown robot');
      return res.status(500).json({ error: 'An unknown error occurred.' });
    }
  }
});

/**
 * DELETE endpoint for deleting a recording from the storage.
 */
router.delete('/recordings/:id', requireSignIn, async (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    return res.status(401).send({ error: 'Unauthorized' });
  }
  try {
    await Robot.deleteOne({ 'recording_meta.id': req.params.id });
    capture(
      'maxun-oss-robot-deleted',
      {
        robotId: req.params.id,
        user_id: req.user?.id,
        deleted_at: new Date().toISOString(),
      }
    )
    return res.send(true);
  } catch (e) {
    const { message } = e as Error;
    logger.log('info', `Error while deleting a recording with name: ${req.params.fileName}.json`);
    return res.send(false);
  }
});

/**
 * POST endpoint to duplicate a robot with a new target URL.
 */
router.post('/recordings/:id/duplicate', requireSignIn, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const { targetUrl, newName } = req.body;

    if (!targetUrl) {
      return res.status(400).json({ error: 'The "targetUrl" field is required.' });
    }

    try {
      const parsed = new URL(targetUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return res.status(400).json({ error: 'The "targetUrl" must use http or https protocol.' });
      }
    } catch {
      return res.status(400).json({ error: 'The "targetUrl" must be a valid URL.' });
    }

    const originalRobot: any = await Robot.findOne({
      'recording_meta.id': id,
    });

    if (!originalRobot) {
      return res.status(404).json({ error: 'Original robot not found.' });
    }

    const lastWord = targetUrl.split('/').filter(Boolean).pop() || 'Unnamed';
    const duplicateName = (newName?.trim() || `${originalRobot.recording_meta.name} (${lastWord})`).trim();

    if (await isRobotNameTaken(duplicateName, originalRobot.userId as number)) {
      return res.status(409).json({ error: `A robot with the name "${duplicateName}" already exists.` });
    }

    const steps: any[] = originalRobot.recording.workflow;
    const entryStep = steps.findLast((step: any) => step.where?.url === 'about:blank');
    const originalEntryUrl: string | null = entryStep?.what?.find(
      (action: any) => action.action === 'goto' && action.args?.length
    )?.args?.[0] ?? null;

    let gotoUpdated = false;
    let whereUpdateStopped = false;

    const workflow = [...steps].reverse().map((step: any) => {
      let updatedWhere = step.where;

      if (originalEntryUrl && step.where?.url !== 'about:blank' && !whereUpdateStopped) {
        if (step.where?.url === originalEntryUrl) {
          updatedWhere = { ...step.where, url: targetUrl };
        } else {
          whereUpdateStopped = true;
        }
      }

      const updatedWhat = step.what.map((action: any) => {
        if (!gotoUpdated && action.action === 'goto' && action.args?.[0] === originalEntryUrl) {
          gotoUpdated = true;
          return { ...action, args: [targetUrl, ...action.args.slice(1)] };
        }
        return action;
      });

      return { ...step, where: updatedWhere, what: updatedWhat };
    }).reverse();

    const currentTimestamp = new Date().toLocaleString();

    const newRobot = await Robot.create({
      userId: normalizeOwnerIdForWrite(originalRobot.userId),
      recording_meta: {
        ...originalRobot.recording_meta,
        id: uuid(),
        name: duplicateName,
        url: targetUrl,
        createdAt: currentTimestamp,
        updatedAt: currentTimestamp,
      },
      recording: { ...originalRobot.recording, workflow },
      google_sheet_email: null,
      google_sheet_name: null,
      google_sheet_id: null,
      google_access_token: null,
      google_refresh_token: null,
      airtable_base_id: null,
      airtable_base_name: null,
      airtable_table_name: null,
      airtable_table_id: null,
      airtable_access_token: null,
      airtable_refresh_token: null,
      webhooks: null,
      schedule: null,
    });

    logger.log('info', `Robot with ID ${id} duplicated successfully as ${newRobot._id}.`);

    return res.status(201).json({
      message: 'Robot duplicated and target URL updated successfully.',
      robot: newRobot,
    });
  } catch (error) {
    if (error instanceof Error) {
      logger.log('error', `Error duplicating robot with ID ${req.params.id}: ${error.message}`);
      return res.status(500).json({ error: error.message });
    } else {
      logger.log('error', `Unknown error duplicating robot with ID ${req.params.id}`);
      return res.status(500).json({ error: 'An unknown error occurred.' });
    }
  }
});

/**
 * GET endpoint for getting an array of runs from the storage.
 */
router.get('/runs', requireSignIn, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) {
      return res.status(401).send({ error: 'Unauthorized' });
    }
    const robots = await Robot.find(ownerIdFilter(req.user.id))
      .select('recording_meta.id')
      .lean();
    const allowedRobotIds = robots
      .map((r: any) => r.recording_meta?.id)
      .filter(Boolean);

    // Production safety: never dump full outputs/logs for list views.
    // Cap results; prefer GET /api/runs for paginated SaaS UI.
    const rawLimit = parseInt(String((req.query as any)?.limit ?? '100'), 10);
    const limit = Math.min(100, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 100));

    const data = await Run.find({ robotMetaId: { $in: allowedRobotIds } })
      .select('-serializableOutput -binaryOutput -log')
      .sort({ _id: -1 })
      .limit(limit)
      .lean();
    return res.send(data);
  } catch (e) {
    logger.log('info', 'Error while reading runs');
    return res.status(500).send({ error: 'Failed to fetch runs' });
  }
});

/**
 * DELETE endpoint for deleting a run from the storage.
 */
router.delete('/runs/:id', requireSignIn, async (req: AuthenticatedRequest, res) => {
  if (!req.user) {
    return res.status(401).send({ error: 'Unauthorized' });
  }
  try {
    const run = await Run.findOne({ runId: req.params.id }).select('runId robotMetaId').lean();
    if (!run) {
      return res.status(404).send({ error: 'Run not found' });
    }
    const robot = await Robot.findOne({
      ...ownerIdFilter(req.user.id),
      'recording_meta.id': (run as any).robotMetaId,
    })
      .select('_id')
      .lean();
    if (!robot) {
      return res.status(404).send({ error: 'Run not found' });
    }
    await Run.deleteOne({ runId: req.params.id });
    capture(
      'maxun-oss-run-deleted',
      {
        runId: req.params.id,
        user_id: req.user?.id,
        deleted_at: new Date().toISOString(),
      }
    )
    return res.send(true);
  } catch (e) {
    const { message } = e as Error;
    logger.log('info', `Error while deleting a run with name: ${req.params.fileName}.json`);
    return res.send(false);
  }
});

/**
 * PUT endpoint for starting a remote browser instance and saving run metadata to the storage.
 * Making it ready for interpretation and returning a runId.
 * 
 * All scraper runs are enqueued through Agenda for execution.
 */
router.put('/runs/:id', requireSignIn, async (req: AuthenticatedRequest, res) => {
  try {
    const recording: any = await Robot.findOne({
      'recording_meta.id': req.params.id
    }).lean();

    if (!recording || !recording.recording_meta || !recording.recording_meta.id) {
      return res.status(404).send({ error: 'Recording not found' });
    }

    if (!req.user) {
      return res.status(401).send({ error: 'Unauthorized' });
    }

    const runId = uuid();

    const placeholderBrowserId = uuid();
    const operationalConfig = toOperationalRunConfig({
      ...getAutomationConfig(recording),
      ...(req.body?.runtimeConfig || {}),
    });

    await Run.create({
      status: 'pending',
      name: recording.recording_meta.name,
      robotId: recording._id?.toString() || recording.id,
      robotMetaId: recording.recording_meta.id,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      browserId: placeholderBrowserId,
      interpreterSettings: {
        ...req.body,
        runtimeConfig: operationalConfig,
      },
      log: '[QUEUE] Run created and waiting for Agenda worker',
      runId,
      runByUserId: req.user.id,
      serializableOutput: {},
      binaryOutput: {},
      duration: null,
      errorMessage: null,
    });

    try {
      const job = await enqueueScraperRun({
        automationId: recording.recording_meta.id,
        runId,
        userId: String(req.user.id),
        config: operationalConfig,
      });

      const jobId = job.attrs._id?.toString() || 'unknown';
      await Run.updateOne({ runId }, {
        $set: {
          queueJobId: jobId,
          log: `[QUEUE] Agenda job ${jobId} enqueued`,
        }
      });
    } catch (queueError: any) {
      logger.log('error', `Failed to enqueue Agenda scraper job: ${queueError.message}`);
      await Run.updateOne({ runId }, {
        $set: {
          status: 'failed',
          finishedAt: new Date().toISOString(),
          errorMessage: queueError.message,
          log: `[QUEUE] Failed to enqueue Agenda job: ${queueError.message}`,
        }
      });
      return res.status(503).send({ error: 'Unable to enqueue run, please try again later' });
    }

    return res.send({
      browserId: placeholderBrowserId,
      runId,
      robotMetaId: recording.recording_meta.id,
      queued: true
    });
  } catch (e) {
    const { message } = e as Error;
    logger.log('error', `Error while creating a run with robot id: ${req.params.id} - ${message}`);    
    return res.status(500).send({ error: 'Internal server error' });
  }
});

/**
 * GET endpoint for getting a run from the storage.
 */
router.get('/runs/run/:id', requireSignIn, async (req, res) => {
  try {
    const run = await Run.findOne({ runId: req.params.id }).lean();
    if (!run) {
      return res.status(404).send(null);
    }
    const robot: any = await Robot.findOne({
      ...ownerIdFilter((req as AuthenticatedRequest).user?.id || ''),
      'recording_meta.id': run.robotMetaId,
    }).lean();
    if (!robot) return res.status(404).send(null);
    return res.send(toPublicRunDto(run, robot, { detail: true }));
  } catch (e) {
    const { message } = e as Error;
    logger.log('error', `Error ${message} while reading a run with id: ${req.params.id}.json`);
    return res.send(null);
  }
});

/**
 * PUT endpoint for finishing a run and saving it to the storage.
 */
router.post('/runs/run/:id', requireSignIn, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) { return res.status(401).send({ error: 'Unauthorized' }); }

    const run = await Run.findOne({ runId: req.params.id });
    if (!run) {
      return res.status(404).send(false);
    }

    const plainRun = run.toJSON();

    const recording: any = await Robot.findOne({ 'recording_meta.id': plainRun.robotMetaId }).lean();
    if (!recording) {
      return res.status(404).send(false);
    }

    try {
      const job = await enqueueScraperRun({
        automationId: plainRun.robotMetaId,
        runId: req.params.id,
        userId: String(req.user.id),
        config: toOperationalRunConfig({
          ...getAutomationConfig(recording),
          ...(plainRun.interpreterSettings?.runtimeConfig || {}),
        })
      });

      run.status = 'pending';
      const jobId = job.attrs._id?.toString() || 'unknown';
      run.queueJobId = jobId;
      run.errorMessage = null;
      run.finishedAt = '';
      run.log = `[QUEUE] Agenda job ${jobId} re-enqueued`;
      await run.save();

      logger.log('info', `Queued Agenda run execution job with ID: ${jobId} for run: ${req.params.id}`);
      return res.send({ success: true, queued: true, runId: req.params.id, queueJobId: jobId });
    } catch (queueError: any) {
      logger.log('error', `Failed to queue Agenda run execution: ${queueError.message}`);
      run.status = 'failed';
      run.finishedAt = new Date().toISOString();
      run.errorMessage = queueError.message;
      await run.save();
      return res.status(503).send({ error: 'Failed to queue run execution' });
    }
  } catch (e) {
    const { message } = e as Error;
    // If error occurs, set run status to failed
    const run = await Run.findOne({ runId: req.params.id });
    if (run) {
      run.status = 'failed';
      run.finishedAt = new Date().toISOString();
      await run.save();
    }
    logger.log('info', `Error while running a robot with id: ${req.params.id} - ${message}`);
    capture(
      'maxun-oss-run-created',
      {
        runId: req.params.id,
        user_id: req.user?.id,
        created_at: new Date().toISOString(),
        status: 'failed',
        error_message: message,
        source: 'manual'
      }
    );
    return res.send(false);
  }
});

router.put('/schedule/:id/', requireSignIn, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const { runEvery, runEveryUnit, startFrom, dayOfMonth, atTimeStart, atTimeEnd, timezone } = req.body;

    const robot = await Robot.findOne({ 'recording_meta.id': id });
    if (!robot) {
      return res.status(404).json({ error: 'Robot not found' });
    }

    // Validate required parameters
    if (!runEvery || !runEveryUnit || !startFrom || !atTimeStart || !atTimeEnd || !timezone) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Validate time zone
    if (!moment.tz.zone(timezone)) {
      return res.status(400).json({ error: 'Invalid timezone' });
    }

    // Validate and parse start and end times
    const [startHours, startMinutes] = atTimeStart.split(':').map(Number);
    const [endHours, endMinutes] = atTimeEnd.split(':').map(Number);

    if (isNaN(startHours) || isNaN(startMinutes) || isNaN(endHours) || isNaN(endMinutes) ||
      startHours < 0 || startHours > 23 || startMinutes < 0 || startMinutes > 59 ||
      endHours < 0 || endHours > 23 || endMinutes < 0 || endMinutes > 59) {
      return res.status(400).json({ error: 'Invalid time format' });
    }

    const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    if (!days.includes(startFrom)) {
      return res.status(400).json({ error: 'Invalid start day' });
    }

    // Build cron expression based on run frequency and starting day
    let cronExpression;
    const dayIndex = days.indexOf(startFrom);

    switch (runEveryUnit) {
      case 'MINUTES':
        cronExpression = `*/${runEvery} * * * *`;
        break;
      case 'HOURS':
        cronExpression = `${startMinutes} */${runEvery} * * *`;
        break;
      case 'DAYS':
        cronExpression = `${startMinutes} ${startHours} */${runEvery} * *`;
        break;
      case 'WEEKS':
        cronExpression = `${startMinutes} ${startHours} * * ${dayIndex}`;
        break;
      case 'MONTHS':
        // todo: handle leap year
        cronExpression = `${startMinutes} ${startHours} ${dayOfMonth} */${runEvery} *`;
        if (startFrom !== 'SUNDAY') {
          cronExpression += ` ${dayIndex}`;
        }
        break;
      default:
        return res.status(400).json({ error: 'Invalid runEveryUnit' });
    }

    // Validate cron expression
    if (!cronExpression || !cron.validate(cronExpression)) {
      return res.status(400).json({ error: 'Invalid cron expression generated' });
    }

    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
      await cancelScheduledWorkflow(id);
    } catch (cancelError) {
      logger.log('warn', `Failed to cancel existing schedule for robot ${id}: ${cancelError}`);
    }

    await scheduleWorkflow(id, req.user.id, cronExpression, timezone);

    const nextRunAt = computeNextRun(cronExpression, timezone);

    robot.schedule = {
      runEvery,
      runEveryUnit,
      startFrom,
      dayOfMonth,
      atTimeStart,
      atTimeEnd,
      timezone,
      cronExpression,
      lastRunAt: undefined,
      nextRunAt: nextRunAt || undefined,
    };
    await robot.save();

    capture(
      'maxun-oss-robot-scheduled',
      {
        robotId: id,
        user_id: req.user.id,
        scheduled_at: new Date().toISOString(),
      }
    )

    // Fetch updated schedule details after setting it
    const updatedRobot = await Robot.findOne({ 'recording_meta.id': id });

    res.status(200).json({
      message: 'success',
      robot: updatedRobot,
    });
  } catch (error) {
    console.error('Error scheduling workflow:', error);
    res.status(500).json({ error: 'Failed to schedule workflow' });
  }
});


// Endpoint to get schedule details
router.get('/schedule/:id', requireSignIn, async (req, res) => {
  try {
    const robot: any = await Robot.findOne({ 'recording_meta.id': req.params.id }).lean();

    if (!robot) {
      return res.status(404).json({ error: 'Robot not found' });
    }

    return res.status(200).json({
      schedule: robot.schedule
    });

  } catch (error) {
    console.error('Error getting schedule:', error);
    res.status(500).json({ error: 'Failed to get schedule' });
  }
});

// Endpoint to delete schedule
router.delete('/schedule/:id', requireSignIn, async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;

    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const robot = await Robot.findOne({ 'recording_meta.id': id });
    if (!robot) {
      return res.status(404).json({ error: 'Robot not found' });
    }

    // Cancel the scheduled job in Agenda
    try {
      await cancelScheduledWorkflow(id);
    } catch (error) {
      logger.log('error', `Error cancelling scheduled job for robot ${id}: ${error}`);
      // Continue with robot update even if cancellation fails
    }

    // Delete the schedule from the robot
    robot.schedule = null;
    await robot.save();

    capture(
      'maxun-oss-robot-schedule-deleted',
      {
        robotId: id,
        user_id: req.user?.id,
        unscheduled_at: new Date().toISOString(),
      }
    )

    res.status(200).json({ message: 'Schedule deleted successfully' });

  } catch (error) {
    console.error('Error deleting schedule:', error);
    res.status(500).json({ error: 'Failed to delete schedule' });
  }
});

/**
 * POST endpoint for aborting a current interpretation of the run.
 */
router.post('/runs/abort/:id', requireSignIn, async (req: AuthenticatedRequest, res) => {
  try {
    if (!req.user) { return res.status(401).send({ error: 'Unauthorized' }); }
    
    const run = await Run.findOne({ runId: req.params.id });
    
    if (!run) {
      return res.status(404).send({ error: 'Run not found' });
    }

    if (!['running', 'queued'].includes(run.status)) {
      return res.status(400).send({ 
        error: `Cannot abort run with status: ${run.status}` 
      });
    }

    const isQueued = run.status === 'queued';

    run.status = 'aborting';
    await run.save();

    if (isQueued) {
      run.status = 'aborted';
      run.finishedAt = new Date().toISOString();
      run.log = 'Run aborted while queued';
      await run.save();
      
      return res.send({ 
        success: true, 
        message: 'Queued run aborted',
        isQueued: true 
      });
    }

    // Immediately stop interpreter like cloud version
    try {
      const browser = browserPool.getRemoteBrowser(run.browserId);
      if (browser && browser.interpreter) {
        logger.log('info', `Immediately stopping interpreter for run ${req.params.id}`);
        await browser.interpreter.stopInterpretation();
      }
    } catch (immediateStopError: any) {
      logger.log('warn', `Failed to immediately stop interpreter: ${immediateStopError.message}`);
    }

    const job = await enqueueAbortRun(String(req.user.id), req.params.id);
    const jobId = job.attrs._id?.toString() || 'unknown';
    logger.log('info', `Abort signal sent for run ${req.params.id}, job ID: ${jobId}`);

    return res.send({
      success: true,
      message: 'Run stopped immediately, cleanup queued',
      jobId,
      isQueued: false
    });    
    
  } catch (e) {
    const { message } = e as Error;
    logger.log('error', `Error aborting run ${req.params.id}: ${message}`);
    return res.status(500).send({ error: 'Failed to abort run' });
  }
});

// Circuit breaker for database connection issues
let consecutiveDbErrors = 0;
const MAX_CONSECUTIVE_ERRORS = 3;
const CIRCUIT_BREAKER_COOLDOWN = 30000;
let circuitBreakerOpenUntil = 0;

async function processQueuedRuns() {
  try {
    if (mongoose.connection.readyState !== 1) {
      return;
    }
    if (Date.now() < circuitBreakerOpenUntil) {
      return;
    }
    const queuedRun = await Run.findOne({
      status: 'queued',
    }).sort({ startedAt: 1 });
    consecutiveDbErrors = 0;
    if (!queuedRun) return;

    const userId = queuedRun.runByUserId;
    if (userId === null || userId === undefined) {
      queuedRun.status = 'failed';
      queuedRun.finishedAt = new Date().toISOString();
      queuedRun.log = 'Queued run is missing runByUserId';
      await queuedRun.save();
      return;
    }
    
    const canCreateBrowser = await browserPool.hasAvailableBrowserSlots(String(userId), "run");
    
    if (canCreateBrowser) {
      logger.log('info', `Processing queued run ${queuedRun.runId} for user ${userId}`);
      
      const recording: any = await Robot.findOne({
        'recording_meta.id': queuedRun.robotMetaId
      }).lean();

      if (!recording) {
        queuedRun.status = 'failed';
        queuedRun.finishedAt = new Date().toISOString();
        queuedRun.log = 'Recording not found';
        await queuedRun.save();
        return;
      }

      try {
        const newBrowserId = await createRemoteBrowserForRun(String(userId));

        logger.log('info', `Created and initialized browser ${newBrowserId} for queued run ${queuedRun.runId}`);

        queuedRun.status = 'running';
        queuedRun.browserId = newBrowserId;
        queuedRun.log = 'Browser created and ready for execution';
        await queuedRun.save();

        const job = await enqueueExecuteRun({
          userId: String(userId),
          runId: queuedRun.runId,
          browserId: newBrowserId,
        });

        const jobId = job.attrs._id?.toString() || 'unknown';
        logger.log('info', `Queued execution for run ${queuedRun.runId} with ready browser ${newBrowserId}, job ID: ${jobId}`);
        
      } catch (browserError: any) {
        logger.log('error', `Failed to create browser for queued run: ${browserError.message}`);
        queuedRun.status = 'failed';
        queuedRun.finishedAt = new Date().toISOString();
        queuedRun.log = `Failed to create browser: ${browserError.message}`;
        await queuedRun.save();
      }
    }
  } catch (error: any) {
    consecutiveDbErrors++;

    if (consecutiveDbErrors >= MAX_CONSECUTIVE_ERRORS) {
      circuitBreakerOpenUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN;
      logger.log('error', `Circuit breaker opened after ${MAX_CONSECUTIVE_ERRORS} consecutive errors. Cooling down for ${CIRCUIT_BREAKER_COOLDOWN/1000}s`);
    }

    logger.log('error', `Error processing queued runs (${consecutiveDbErrors}/${MAX_CONSECUTIVE_ERRORS}): ${error.message}`);
  }
}

/**
 * POST endpoint for creating a crawl robot
 * @route POST /recordings/crawl
 * @auth requireSignIn - JWT authentication required
 */
router.post('/recordings/crawl', requireSignIn, async (req: AuthenticatedRequest, res) => {
  try {
    const { url, name, crawlConfig, formats } = req.body;

    if (!url || !crawlConfig) {
      return res.status(400).json({ error: 'URL and crawl configuration are required.' });
    }

    if (!req.user) {
      return res.status(401).send({ error: 'Unauthorized' });
    }

    try {
      new URL(url);
    } catch (err) {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    const robotName = (typeof name === 'string' ? name.trim() : '') || `Crawl Robot - ${new URL(url).hostname}`;
    if (!robotName) {
      return res.status(400).json({ error: 'Robot name cannot be empty.' });
    }

    if (await isRobotNameTaken(robotName, req.user.id)) {
      return res.status(409).json({ error: `A robot with the name "${robotName}" already exists.` });
    }

    const { validFormats: requestedFormats, invalidFormats } = parseOutputFormats(formats);
    if (invalidFormats.length > 0) {
      return res.status(400).json({
        error: `Invalid formats: ${invalidFormats.map(String).join(', ')}`,
      });
    }

    // Crawl always needs formats; use defaults even if explicit empty array is provided
    const crawlFormats: OutputFormat[] = requestedFormats.length > 0
      ? requestedFormats
      : [...DEFAULT_OUTPUT_FORMATS];

    const limit = clampCrawlLimit(crawlConfig?.limit);
    try {
      assertCrawlFormatsAllowed(crawlFormats, limit);
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
    const cappedCrawlConfig = { ...crawlConfig, limit };

    const currentTimestamp = new Date().toLocaleString('en-US');
    const robotId = uuid();

    const newRobot = await Robot.create({
      userId: normalizeOwnerIdForWrite(req.user.id),
      recording_meta: {
        name: robotName,
        id: robotId,
        createdAt: currentTimestamp,
        updatedAt: currentTimestamp,
        pairs: 1,
        params: [],
        type: 'crawl',
        url: url,
        formats: crawlFormats,
      },
      recording: {
        workflow: [
          {
            where: { url },
            what: [
              { action: 'flag', args: ['generated'] },
              {
                action: 'crawl',
                args: [cappedCrawlConfig],
                name: 'Crawl'
              }
            ]
          },
          {
            where: { url: 'about:blank' },
            what: [
              {
                action: 'goto',
                args: [url]
              },
              {
                action: 'waitForLoadState',
                args: ['networkidle']
              }
            ]
          }
        ]
      },
      google_sheet_email: null,
      google_sheet_name: null,
      google_sheet_id: null,
      google_access_token: null,
      google_refresh_token: null,
      airtable_base_id: null,
      airtable_base_name: null,
      airtable_table_name: null,
      airtable_table_id: null,
      airtable_access_token: null,
      airtable_refresh_token: null,
      schedule: null,
      webhooks: null
    });

    logger.log('info', `Crawl robot created with id: ${newRobot._id}`);
    capture('maxun-oss-robot-created', {
      userId: req.user.id.toString(),
      robotId: robotId,
      robotName: robotName,
      url: url,
      robotType: 'crawl',
      crawlConfig: crawlConfig,
      robot_meta: newRobot.recording_meta,
      recording: newRobot.recording,
    });

    return res.status(201).json({
      message: 'Crawl robot created successfully.',
      robot: newRobot,
    });
  } catch (error: any) {
    if (error.code === 11000) {
      return res.status(409).json({ error: 'A robot with this name already exists.' });
    }
    if (error instanceof Error) {
      logger.log('error', `Error creating crawl robot: ${error.message}`);
      return res.status(500).json({ error: error.message });
    } else {
      logger.log('error', 'Unknown error creating crawl robot');
      return res.status(500).json({ error: 'An unknown error occurred.' });
    }
  }
});

/**
 * POST endpoint for creating a search robot
 * @route POST /recordings/search
 * @auth requireSignIn - JWT authentication required
 */
router.post('/recordings/search', requireSignIn, async (req: AuthenticatedRequest, res) => {
  try {
    const { searchConfig, name, formats } = req.body;

    if (!searchConfig || !searchConfig.query) {
      return res.status(400).json({ error: 'Search configuration with query is required.' });
    }

    if (!req.user) {
      return res.status(401).send({ error: 'Unauthorized' });
    }

    const robotName = (typeof name === 'string' ? name.trim() : '') || `Search Robot - ${searchConfig.query.substring(0, 50)}`;
    if (!robotName) {
      return res.status(400).json({ error: 'Robot name cannot be empty.' });
    }

    if (await isRobotNameTaken(robotName, req.user.id)) {
      return res.status(409).json({ error: `A robot with the name "${robotName}" already exists.` });
    }

    const { validFormats: requestedFormats, invalidFormats } = parseOutputFormats(
      formats,
      searchConfig.mode === 'scrape' ? SEARCH_SCRAPE_OUTPUT_FORMAT_OPTIONS : undefined
    );
    if (invalidFormats.length > 0) {
      return res.status(400).json({
        error: `Invalid formats: ${invalidFormats.map(String).join(', ')}`,
      });
    }

    let searchFormats: OutputFormat[];
    if (searchConfig.mode === 'discover') {
      // Discover-mode: always empty, ignore caller input
      searchFormats = [];
    } else {
      // Scrape-mode: apply defaults if empty
      searchFormats = requestedFormats.length > 0 ? requestedFormats : [...DEFAULT_OUTPUT_FORMATS];
    }

    const cappedSearchConfig = {
      ...searchConfig,
      limit: clampSearchLimit(searchConfig.limit),
    };

    const currentTimestamp = new Date().toLocaleString('en-US');
    const robotId = uuid();

    const newRobot = await Robot.create({
      userId: normalizeOwnerIdForWrite(req.user.id),
      recording_meta: {
        name: robotName,
        id: robotId,
        createdAt: currentTimestamp,
        updatedAt: currentTimestamp,
        pairs: 1,
        params: [],
        type: 'search',
        formats: searchFormats,
      },
      recording: {
        workflow: [
          {
            where: { url: 'about:blank' },
            what: [{
              action: 'search',
              args: [cappedSearchConfig],
              name: 'Search'
            }]
          }
        ]
      },
      google_sheet_email: null,
      google_sheet_name: null,
      google_sheet_id: null,
      google_access_token: null,
      google_refresh_token: null,
      airtable_base_id: null,
      airtable_base_name: null,
      airtable_table_name: null,
      airtable_table_id: null,
      airtable_access_token: null,
      airtable_refresh_token: null,
      schedule: null,
      webhooks: null
    });

    logger.log('info', `Search robot created with id: ${newRobot._id}`);
    capture('maxun-oss-robot-created', {
      userId: req.user.id.toString(),
      robotId: robotId,
      robotName: robotName,
      robotType: 'search',
      searchQuery: searchConfig.query,
      searchProvider: searchConfig.provider || 'duckduckgo',
      searchLimit: searchConfig.limit || 10,
      robot_meta: newRobot.recording_meta,
      recording: newRobot.recording,
    });

    return res.status(201).json({
      message: 'Search robot created successfully.',
      robot: newRobot,
    });
  } catch (error: any) {
    if (error.code === 11000) {
      return res.status(409).json({ error: 'A robot with this name already exists.' });
    }
    if (error instanceof Error) {
      logger.log('error', `Error creating search robot: ${error.message}`);
      return res.status(500).json({ error: error.message });
    } else {
      logger.log('error', 'Unknown error creating search robot');
      return res.status(500).json({ error: 'An unknown error occurred.' });
    }
  }
});

export { processQueuedRuns };

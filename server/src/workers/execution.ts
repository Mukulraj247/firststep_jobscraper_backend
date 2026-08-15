/**
 * Shared execution logic for run processing.
 * Works with any queue (Agenda, BullMQ, etc.).
 */
import { Job as AgendaJob } from 'agenda';
import { Page } from 'playwright-core';
import logger from '../logger';
import Run from '../models/Run';
import Robot from '../models/Robot';
import { capture } from '../utils/analytics';
import { addGoogleSheetUpdateTask, googleSheetUpdateTasks, processGoogleSheetUpdates } from '../workflow-management/integrations/gsheet';
import { addAirtableUpdateTask, airtableUpdateTasks, processAirtableUpdates } from '../workflow-management/integrations/airtable';
import { sendWebhook } from '../routes/webhook';
import { BinaryOutputService } from '../storage/binaryOutputService';
import { convertPageToMarkdown, convertPageToHTML, convertPageToScreenshot } from '../markdownify/scrape';
import { processRobotOutputFormats } from '../utils/output-post-processor';
import { getInterpretationFailureReason, hasExpectedRobotOutput } from '../utils/output-validation';
import { applyAutomationRuntimeConfig, dispatchAutomationWebhook, persistExtractedDataForRun } from '../services/automation';
import {
  warmUpBeforeAutomation,
  getUnblockOptionsFromRuntimeConfig,
  attachCloudflareWaitOnNavigation,
} from '../services/unblocker';
import { destroyRemoteBrowser } from '../browser-management/controller';
import { AddGeneratedFlags, withTimeout } from '../utils/workflowHelpers';
import { killScrapeChildForRun } from './scrapeJobSupervisor';

export interface ExecuteRunData {
  userId: string;
  runId: string;
  browserId?: string;
}

function emitToBrowserNamespace(browserId: string | null | undefined, event: string, payload: any) {
  if (!browserId) return;
  try {
    const { io } = require('../server');
    io.of(browserId).emit(event, payload);
  } catch {}
}

function emitToQueuedRunUser(userId: string | null | undefined, event: string, payload: any) {
  if (!userId) return;
  try {
    const { io } = require('../server');
    io.of('/queued-run').to(`user-${userId}`).emit(event, payload);
  } catch {}
}

function emitRunEvent(
  browserId: string | null | undefined,
  userId: string | null | undefined,
  event: string,
  payload: any,
) {
  emitToBrowserNamespace(browserId, event, payload);
  emitToQueuedRunUser(userId, event, payload);
}

async function triggerIntegrationUpdates(runId: string, robotMetaId: string): Promise<void> {
  try {
    addGoogleSheetUpdateTask(runId, { robotId: robotMetaId, runId, status: 'pending', retries: 5 });
    addAirtableUpdateTask(runId, { robotId: robotMetaId, runId, status: 'pending', retries: 5 });

    withTimeout(processAirtableUpdates(), 65000, 'Airtable update')
      .catch(err => logger.log('error', `Airtable update error: ${err.message}`));
    withTimeout(processGoogleSheetUpdates(), 65000, 'Google Sheets update')
      .catch(err => logger.log('error', `Google Sheets update error: ${err.message}`));
  } catch (err: any) {
    logger.log('error', `Failed to update integrations for run: ${runId}: ${err.message}`);
  }
}

export async function processRunExecution(job: AgendaJob<ExecuteRunData> | { data: ExecuteRunData }) {
  const BROWSER_INIT_TIMEOUT = 60000;
  const BROWSER_PAGE_TIMEOUT = 15000;

  const data = (job as AgendaJob<ExecuteRunData>).attrs?.data ?? (job as { data: ExecuteRunData }).data;
  logger.log('info', `Processing run execution job for runId: ${data.runId}, browserId: ${data.browserId}`);

  let browser: any;

  try {
    const run = await Run.findOne({ runId: data.runId });
    if (!run) {
      logger.log('error', `Run ${data.runId} not found in database`);
      return { success: false };
    }

    if (run.status === 'aborted' || run.status === 'aborting') {
      logger.log('info', `Run ${data.runId} has status ${run.status}, skipping execution`);
      return { success: true };
    }

    if (run.status === 'queued') {
      logger.log('info', `Run ${data.runId} has status 'queued', skipping stale execution job`);
      return { success: true };
    }

    const plainRun = run.toJSON();
    const browserId = data.browserId || plainRun.browserId;

    if (!browserId) {
      throw new Error(`No browser ID available for run ${data.runId}`);
    }

    logger.log('info', `Looking for browser ${browserId} for run ${data.runId}`);

    const browserWaitStart = Date.now();
    let lastLogTime = 0;
    let pollAttempts = 0;
    const MAX_POLL_ATTEMPTS = Math.ceil(BROWSER_INIT_TIMEOUT / 2000);

    while (!browser && (Date.now() - browserWaitStart) < BROWSER_INIT_TIMEOUT && pollAttempts < MAX_POLL_ATTEMPTS) {
      const currentTime = Date.now();
      pollAttempts++;

      const { browserPool } = require('../server');
      const browserStatus = browserPool.getBrowserStatus(browserId);
      if (browserStatus === null) throw new Error(`Browser slot ${browserId} does not exist in pool`);
      if (browserStatus === 'failed') throw new Error(`Browser ${browserId} initialization failed`);

      if (currentTime - lastLogTime > 10000) {
        logger.log('info', `Browser ${browserId} not ready yet (status: ${browserStatus}), waiting... (${Math.round((currentTime - browserWaitStart) / 1000)}s elapsed)`);
        lastLogTime = currentTime;
      }

      await new Promise(resolve => setTimeout(resolve, 2000));
      browser = browserPool.getRemoteBrowser(browserId);
    }

    if (!browser) {
      const { browserPool } = require('../server');
      const finalStatus = browserPool.getBrowserStatus(browserId);
      throw new Error(`Browser ${browserId} not found in pool after ${BROWSER_INIT_TIMEOUT / 1000}s timeout (final status: ${finalStatus})`);
    }

    logger.log('info', `Browser ${browserId} found and ready for execution`);

    try {
      const recording: any = await Robot.findOne({ 'recording_meta.id': plainRun.robotMetaId }).lean();
      if (!recording) throw new Error(`Recording for run ${data.runId} not found`);

      let currentPage = browser.getCurrentPage();

      const pageWaitStart = Date.now();
      let lastPageLogTime = 0;
      let pageAttempts = 0;
      const MAX_PAGE_ATTEMPTS = 15;

      while (!currentPage && (Date.now() - pageWaitStart) < BROWSER_PAGE_TIMEOUT && pageAttempts < MAX_PAGE_ATTEMPTS) {
        const currentTime = Date.now();
        pageAttempts++;
        if (currentTime - lastPageLogTime > 5000) {
          logger.log('info', `Page not ready for browser ${browserId}, waiting... (${Math.round((currentTime - pageWaitStart) / 1000)}s elapsed)`);
          lastPageLogTime = currentTime;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
        currentPage = browser.getCurrentPage();
      }

      if (!currentPage) throw new Error(`No current page available for browser ${browserId} after ${BROWSER_PAGE_TIMEOUT / 1000}s timeout`);

      await applyAutomationRuntimeConfig(currentPage, recording);

      if (recording.recording_meta.type === 'scrape') {
        logger.log('info', `Executing scrape robot for run ${data.runId}`);

        const formats = recording.recording_meta.formats || ['markdown'];

        run.status = 'running';
        run.log = `Converting page to ${formats.join(', ')}`;
        await run.save();

        try {
          const url = recording.recording_meta.url;
          if (!url) throw new Error('No URL specified for markdown robot');

          let markdown = '';
          let html = '';
          const serializableOutput: any = {};
          const binaryOutput: any = {};
          const SCRAPE_TIMEOUT = 120000;

          if (formats.includes('markdown')) {
            const timeoutPromise = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`Markdown conversion timed out after ${SCRAPE_TIMEOUT / 1000}s`)), SCRAPE_TIMEOUT)
            );
            markdown = await Promise.race([convertPageToMarkdown(url, currentPage), timeoutPromise]);
            serializableOutput.markdown = [{ content: markdown }];
          }

          if (formats.includes('html')) {
            const timeoutPromise = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`HTML conversion timed out after ${SCRAPE_TIMEOUT / 1000}s`)), SCRAPE_TIMEOUT)
            );
            html = await Promise.race([convertPageToHTML(url, currentPage), timeoutPromise]);
            serializableOutput.html = [{ content: html }];
          }

          if (formats.includes('screenshot-visible')) {
            const timeoutPromise = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`Screenshot conversion timed out after ${SCRAPE_TIMEOUT / 1000}s`)), SCRAPE_TIMEOUT)
            );
            const screenshotBuffer = await Promise.race([convertPageToScreenshot(url, currentPage, false), timeoutPromise]);
            binaryOutput['screenshot-visible'] = { data: screenshotBuffer.toString('base64'), mimeType: 'image/png' };
          }

          if (formats.includes('screenshot-fullpage')) {
            const timeoutPromise = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error(`Screenshot conversion timed out after ${SCRAPE_TIMEOUT / 1000}s`)), SCRAPE_TIMEOUT)
            );
            const screenshotBuffer = await Promise.race([convertPageToScreenshot(url, currentPage, true), timeoutPromise]);
            binaryOutput['screenshot-fullpage'] = { data: screenshotBuffer.toString('base64'), mimeType: 'image/png' };
          }

          run.status = 'success';
          run.finishedAt = new Date().toLocaleString();
          run.log = `${formats.join(', ').toUpperCase()} conversion completed successfully`;
          run.serializableOutput = serializableOutput;
          run.binaryOutput = binaryOutput;
          await run.save();

          let uploadedBinaryOutput: Record<string, string> = {};
          if (Object.keys(binaryOutput).length > 0) {
            const binaryOutputService = new BinaryOutputService('maxun-run-screenshots');
            uploadedBinaryOutput = await binaryOutputService.uploadAndStoreBinaryOutput(run, binaryOutput);
            run.binaryOutput = uploadedBinaryOutput;
            await run.save();
          }

          logger.log('info', `Markdown robot execution completed for run ${data.runId}`);

          emitRunEvent(browserId, data.userId, 'run-completed', {
            runId: data.runId,
            robotMetaId: plainRun.robotMetaId,
            robotName: recording.recording_meta.name,
            status: 'success',
            finishedAt: new Date().toLocaleString(),
          });

          const webhookPayload: any = {
            runId: data.runId, robotId: plainRun.robotMetaId, robotName: recording.recording_meta.name,
            status: 'success', finishedAt: new Date().toLocaleString(),
          };
          if (formats.includes('markdown')) webhookPayload.markdown = markdown;
          if (formats.includes('html')) webhookPayload.html = html;
          if (uploadedBinaryOutput['screenshot-visible']) webhookPayload.screenshot_visible = uploadedBinaryOutput['screenshot-visible'];
          if (uploadedBinaryOutput['screenshot-fullpage']) webhookPayload.screenshot_fullpage = uploadedBinaryOutput['screenshot-fullpage'];
          await sendWebhook(plainRun.robotMetaId, 'run_completed', webhookPayload);

          capture('maxun-oss-run-created', {
            runId: data.runId, user_id: data.userId, status: 'success',
            robot_type: 'scrape', formats, source: 'manual',
          });

          await destroyRemoteBrowser(browserId, data.userId);
          return { success: true };

        } catch (error: any) {
          logger.log('error', `${formats.join(', ')} conversion failed for run ${data.runId}: ${error.message}`);
          run.status = 'failed';
          run.finishedAt = new Date().toLocaleString();
          run.log = `${formats.join(', ').toUpperCase()} conversion failed: ${error.message}`;
          await run.save();

          emitRunEvent(browserId, data.userId, 'run-completed', {
            runId: data.runId, robotMetaId: plainRun.robotMetaId,
            robotName: recording.recording_meta.name, status: 'failed',
            finishedAt: new Date().toLocaleString(),
          });

          capture('maxun-oss-run-created', {
            runId: data.runId, user_id: data.userId, status: 'failed',
            robot_type: 'scrape', formats, source: 'manual',
          });

          await destroyRemoteBrowser(browserId, data.userId);
          throw error;
        }
      }

      const isRunAborted = async (): Promise<boolean> => {
        try {
          const currentRun = await Run.findOne({ runId: data.runId });
          return currentRun ? (currentRun.status === 'aborted' || currentRun.status === 'aborting') : false;
        } catch {
          return false;
        }
      };

      logger.log('info', `Starting workflow execution for run ${data.runId}`);
      run.status = 'running';
      run.log = 'Workflow execution started';
      await run.save();

      emitRunEvent(browserId, data.userId, 'run-started', {
        runId: data.runId, robotMetaId: plainRun.robotMetaId,
        robotName: recording.recording_meta.name, status: 'running',
        startedAt: new Date().toLocaleString(),
      });

      browser.interpreter.setRunId(data.runId);

      const INTERPRETATION_TIMEOUT = 600000;
      const runtimeCfg = (plainRun.interpreterSettings as { runtimeConfig?: Record<string, unknown> } | undefined)?.runtimeConfig;
      const unblockOpts = getUnblockOptionsFromRuntimeConfig(runtimeCfg);
      await warmUpBeforeAutomation(currentPage, unblockOpts);
      const stopCloudflareNavWait = attachCloudflareWaitOnNavigation(currentPage.context(), unblockOpts);

      let interpretationInfo;
      try {
        const interpretationPromise = browser.interpreter.InterpretRecording(
          AddGeneratedFlags(recording.recording),
          currentPage,
          (newPage: Page) => { currentPage = newPage; },
          plainRun.interpreterSettings,
        );
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Workflow interpretation timed out after ${INTERPRETATION_TIMEOUT / 1000}s`)), INTERPRETATION_TIMEOUT)
        );
        interpretationInfo = await Promise.race([interpretationPromise, timeoutPromise]);
      } finally {
        stopCloudflareNavWait();
      }

      if (await isRunAborted()) {
        logger.log('info', `Run ${data.runId} was aborted during execution`);
        try { await browser.interpreter.clearState(); } catch {}
        await destroyRemoteBrowser(plainRun.browserId, data.userId);
        return { success: true };
      }

      logger.log('info', `Workflow execution completed for run ${data.runId}`);

      const finalRun = await Run.findById(run._id);
      const categorizedOutput = {
        scrapeSchema: finalRun?.serializableOutput?.scrapeSchema || {},
        scrapeList: finalRun?.serializableOutput?.scrapeList || {},
        crawl: finalRun?.serializableOutput?.crawl || {},
        search: finalRun?.serializableOutput?.search || {},
      };

      // Smart job extraction fallback
      const hasAnyExtractedData =
        Object.values(categorizedOutput.scrapeSchema).some((v: any) => Array.isArray(v) && v.length > 0) ||
        Object.values(categorizedOutput.scrapeList).some((v: any) => Array.isArray(v) && v.length > 0);

      if (!hasAnyExtractedData && currentPage && !currentPage.isClosed()) {
        logger.log('info', `No data extracted by workflow for run ${data.runId}. Attempting smart job extraction fallback...`);
        try {
          await currentPage.waitForTimeout(3000);
          await currentPage.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await currentPage.waitForTimeout(2000);
          await currentPage.evaluate(() => window.scrollTo(0, 0));
          await currentPage.waitForTimeout(1000);
          const fs = require('fs');
          const path = require('path');
          const scriptPath = path.join(__dirname, 'workflow-management/scripts/smartJobExtractor.js');
          const scriptContent = fs.readFileSync(scriptPath, 'utf-8');
          const smartRows = await currentPage.evaluate(scriptContent);
          if (Array.isArray(smartRows) && smartRows.length > 0) {
            logger.log('info', `Smart job extractor found ${smartRows.length} items for run ${data.runId}`);
            categorizedOutput.scrapeList['Job Listings'] = smartRows;
            if (finalRun) {
              finalRun.serializableOutput = { ...(finalRun.serializableOutput || {}), scrapeList: { ...(finalRun.serializableOutput?.scrapeList || {}), 'Job Listings': smartRows } };
              await finalRun.save();
            }
          }
        } catch (smartError: any) {
          logger.log('warn', `Smart job extraction fallback failed for run ${data.runId}: ${smartError.message}`);
        }
      }

      let binaryOutput: Record<string, any> = { ...(interpretationInfo.binaryOutput || {}) };

      const robotType = recording.recording_meta.type;
      const outputFormats = (recording.recording_meta as any).formats as string[] | undefined;
      if (robotType === 'crawl' || robotType === 'search') {
        const processedOutput = await processRobotOutputFormats({
          robotType, outputFormats,
          categorizedOutput: { crawl: categorizedOutput.crawl as Record<string, any>, search: categorizedOutput.search as Record<string, any> },
          currentPage, initialBinaryOutput: binaryOutput,
        });
        categorizedOutput.crawl = processedOutput.categorizedOutput.crawl;
        categorizedOutput.search = processedOutput.categorizedOutput.search;
        binaryOutput = processedOutput.binaryOutput;

        const hasOutput = hasExpectedRobotOutput(robotType, {
          crawl: categorizedOutput.crawl as Record<string, any>,
          search: categorizedOutput.search as Record<string, any>,
        }, outputFormats, binaryOutput);
        if (!hasOutput) {
          const humanRobotType = robotType.charAt(0).toUpperCase() + robotType.slice(1);
          throw new Error(getInterpretationFailureReason(interpretationInfo.log, `${humanRobotType} run completed without producing output data`));
        }
      }

      const binaryOutputService = new BinaryOutputService('maxun-run-screenshots');
      const uploadedBinaryOutput = Object.keys(binaryOutput).length > 0
        ? await binaryOutputService.uploadAndStoreBinaryOutput(run, binaryOutput)
        : {};

      if (await isRunAborted()) {
        logger.log('info', `Run ${data.runId} was aborted while processing results`);
        return { success: true };
      }

      run.status = 'success';
      run.finishedAt = new Date().toLocaleString();
      run.log = interpretationInfo.log.join('\n');
      run.binaryOutput = uploadedBinaryOutput;
      run.serializableOutput = {
        ...(finalRun?.serializableOutput || {}),
        crawl: categorizedOutput.crawl,
        search: categorizedOutput.search,
      };
      await run.save();

      let totalSchemaItemsExtracted = 0;
      let totalListItemsExtracted = 0;
      const extractedScreenshotsCount = Object.keys(uploadedBinaryOutput).length;

      if (categorizedOutput.scrapeSchema) {
        Object.values(categorizedOutput.scrapeSchema).forEach((schemaResult: any) => {
          if (Array.isArray(schemaResult)) totalSchemaItemsExtracted += schemaResult.length;
          else if (schemaResult && typeof schemaResult === 'object') totalSchemaItemsExtracted += 1;
        });
      }
      if (categorizedOutput.scrapeList) {
        Object.values(categorizedOutput.scrapeList).forEach((listResult: any) => {
          if (Array.isArray(listResult)) totalListItemsExtracted += listResult.length;
        });
      }

      const totalRowsExtracted = totalSchemaItemsExtracted + totalListItemsExtracted;

      capture('maxun-oss-run-created', {
        runId: data.runId, user_id: data.userId, created_at: new Date().toISOString(),
        status: 'success', totalRowsExtracted, schemaItemsExtracted: totalSchemaItemsExtracted,
        listItemsExtracted: totalListItemsExtracted, extractedScreenshotsCount,
        source: 'manual',
      });

      emitRunEvent(browserId, data.userId, 'run-completed', {
        runId: data.runId, robotMetaId: plainRun.robotMetaId,
        robotName: recording.recording_meta.name, status: 'success',
        finishedAt: new Date().toLocaleString(),
      });

      await sendWebhook(plainRun.robotMetaId, 'run_completed', {
        robot_id: plainRun.robotMetaId, run_id: data.runId, robot_name: recording.recording_meta.name,
        status: 'success', started_at: plainRun.startedAt, finished_at: new Date().toLocaleString(),
        extracted_data: {
          captured_texts: Object.keys(categorizedOutput.scrapeSchema || {}).length > 0
            ? Object.entries(categorizedOutput.scrapeSchema).reduce((acc, [name, value]) => { acc[name] = Array.isArray(value) ? value : [value]; return acc; }, {} as Record<string, any[]>)
            : {},
          captured_lists: categorizedOutput.scrapeList,
          crawl_data: categorizedOutput.crawl,
          search_data: categorizedOutput.search,
          captured_texts_count: totalSchemaItemsExtracted,
          captured_lists_count: totalListItemsExtracted,
          screenshots_count: extractedScreenshotsCount,
        },
        metadata: { browser_id: plainRun.browserId, user_id: data.userId },
      });

      const refreshedRun = await Run.findOne({ runId: data.runId });
      if (refreshedRun) {
        const extractedRows = await persistExtractedDataForRun(refreshedRun, recording);
        await dispatchAutomationWebhook(refreshedRun, recording, extractedRows);
      }

      await triggerIntegrationUpdates(plainRun.runId, plainRun.robotMetaId);
      await destroyRemoteBrowser(browserId, data.userId);
      logger.log('info', `Browser ${browserId} destroyed after successful run ${data.runId}`);

      return { success: true };

    } catch (executionError: any) {
      logger.log('error', `Run execution failed for run ${data.runId}: ${executionError.message}`);

      let partialDataExtracted = false;
      try {
        const hasData = (run.serializableOutput &&
          ((run.serializableOutput.scrapeSchema && run.serializableOutput.scrapeSchema.length > 0) ||
            (run.serializableOutput.scrapeList && Object.keys(run.serializableOutput.scrapeList).length > 0) ||
            (run.serializableOutput.crawl && Object.keys(run.serializableOutput.crawl).length > 0) ||
            (run.serializableOutput.search && Object.keys(run.serializableOutput.search).length > 0))) ||
          (run.binaryOutput && Object.keys(run.binaryOutput).length > 0);
        if (hasData) {
          await triggerIntegrationUpdates(plainRun.runId, plainRun.robotMetaId);
          partialDataExtracted = true;
        }
      } catch {}

      run.status = 'failed';
      run.finishedAt = new Date().toLocaleString();
      run.log = `Failed: ${executionError.message}`;
      await run.save();

      try {
        const recording: any = await Robot.findOne({ 'recording_meta.id': run.robotMetaId }).lean();
        emitRunEvent(browserId, data.userId, 'run-completed', {
          runId: data.runId, robotMetaId: plainRun.robotMetaId,
          robotName: recording?.recording_meta?.name || 'Unknown Robot', status: 'failed',
          finishedAt: new Date().toLocaleString(), hasPartialData: partialDataExtracted,
        });
      } catch {}

      const recording: any = await Robot.findOne({ 'recording_meta.id': run.robotMetaId }).lean();
      await sendWebhook(plainRun.robotMetaId, 'run_failed', {
        robot_id: plainRun.robotMetaId, run_id: data.runId,
        robot_name: recording?.recording_meta?.name || 'Unknown Robot',
        status: 'failed', started_at: plainRun.startedAt, finished_at: new Date().toLocaleString(),
        error: { message: executionError.message, stack: executionError.stack, type: 'ExecutionError' },
        partial_data_extracted: partialDataExtracted,
        metadata: { browser_id: plainRun.browserId, user_id: data.userId },
      });

      capture('maxun-oss-run-created', {
        runId: data.runId, user_id: data.userId, created_at: new Date().toISOString(),
        status: 'failed', error_message: executionError.message,
        partial_data_extracted: partialDataExtracted,
        totalRowsExtracted: 0,
        source: 'manual',
      });

      try {
        if (browser?.interpreter) {
          await browser.interpreter.clearState();
        }
      } catch (clearError: any) {
        logger.warn(`Failed to clear interpreter state on error: ${clearError.message}`);
      }

      await destroyRemoteBrowser(browserId, data.userId);
      logger.log('info', `Browser ${browserId} destroyed after failed run`);

      return { success: false, partialDataExtracted };
    }

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.log('error', `Failed to process run execution job: ${errorMessage}`);

    try {
      const run = await Run.findOne({ runId: data.runId });
      if (run) {
        run.status = 'failed';
        run.finishedAt = new Date().toLocaleString();
        run.log = `Failed: ${errorMessage}`;
        await run.save();

        const recording: any = await Robot.findOne({ 'recording_meta.id': run.robotMetaId }).lean();
        await sendWebhook(run.robotMetaId, 'run_failed', {
          robot_id: run.robotMetaId, run_id: data.runId,
          robot_name: recording?.recording_meta?.name || 'Unknown Robot',
          status: 'failed', started_at: run.startedAt, finished_at: new Date().toLocaleString(),
          error: { message: errorMessage },
          metadata: { browser_id: run.browserId, user_id: data.userId },
        });

        emitRunEvent(run.browserId, data.userId, 'run-completed', {
          runId: data.runId, robotMetaId: run.robotMetaId,
          robotName: recording?.recording_meta?.name || 'Unknown Robot',
          status: 'failed', finishedAt: new Date().toLocaleString(),
        });
      }
    } catch {}

    return { success: false };
  }
}

export async function abortRun(runId: string, userId: string): Promise<boolean> {
  try {
    // Hard-stop child-isolated scrapes in this process (no-op on API-only processes).
    await killScrapeChildForRun(runId).catch((error: any) => {
      logger.log('warn', `killScrapeChildForRun failed for ${runId}: ${error?.message || error}`);
    });

    const run = await Run.findOne({ runId });
    if (!run) {
      logger.log('warn', `Run ${runId} not found or does not belong to user ${userId}`);
      return false;
    }

    const plainRun = run.toJSON();
    const recording: any = await Robot.findOne({ 'recording_meta.id': plainRun.robotMetaId }).lean();
    const robotName = recording?.recording_meta?.name || 'Unknown Robot';

    let browser;
    try {
      const { browserPool } = require('../server');
      browser = plainRun.browserId ? browserPool.getRemoteBrowser(plainRun.browserId) : null;
    } catch {
      browser = null;
    }

    // Already aborted (e.g. delete cascade) — still destroy browser if this process owns it.
    if (run.status === 'aborted') {
      if (browser && plainRun.browserId) {
        try {
          await destroyRemoteBrowser(plainRun.browserId, userId);
        } catch (cleanupError) {
          logger.log('warn', `Failed to clean up browser for already-aborted run ${runId}: ${cleanupError}`);
        }
      }
      return true;
    }

    if (run.status === 'completed' || run.status === 'success' || run.status === 'failed' || run.status === 'dead') {
      return false;
    }

    run.status = 'aborting';
    await run.save();

    if (!browser) {
      run.status = 'aborted';
      run.finishedAt = new Date().toLocaleString();
      run.log = 'Aborted: Browser not found or already closed';
      await run.save();
      emitToBrowserNamespace(plainRun.browserId, 'run-aborted', { runId, robotName, status: 'aborted', finishedAt: new Date().toLocaleString() });
      return true;
    }

    run.status = 'aborted';
    run.finishedAt = new Date().toLocaleString();
    run.log = 'Run aborted by user';
    await run.save();

    const hasData = (run.serializableOutput &&
      ((run.serializableOutput.scrapeSchema && run.serializableOutput.scrapeSchema.length > 0) ||
        (run.serializableOutput.scrapeList && Object.keys(run.serializableOutput.scrapeList).length > 0))) ||
      (run.binaryOutput && Object.keys(run.binaryOutput).length > 0);

    if (hasData) {
      await triggerIntegrationUpdates(runId, plainRun.robotMetaId);
    }

    emitToBrowserNamespace(plainRun.browserId, 'run-aborted', { runId, robotName, status: 'aborted', finishedAt: new Date().toLocaleString() });

    try {
      await new Promise(resolve => setTimeout(resolve, 500));
      await destroyRemoteBrowser(plainRun.browserId, userId);
      logger.log('info', `Browser ${plainRun.browserId} destroyed successfully after abort`);
    } catch (cleanupError) {
      logger.log('warn', `Failed to clean up browser for aborted run ${runId}: ${cleanupError}`);
    }

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.log('error', `Failed to abort run ${runId}: ${errorMessage}`);
    return false;
  }
}

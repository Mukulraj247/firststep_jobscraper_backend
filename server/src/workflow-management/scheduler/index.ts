import { v4 as uuid } from "uuid";
import { io, Socket } from "socket.io-client";
import { createRemoteBrowserForRun, destroyRemoteBrowser } from '../../browser-management/controller';
import logger from '../../logger';
import { browserPool } from "../../server";
const getIo = () => require('../../server').io;
import { addGoogleSheetUpdateTask, googleSheetUpdateTasks, processGoogleSheetUpdates } from "../integrations/gsheet";
import Robot from "../../models/Robot";
import Run from "../../models/Run";
import { BinaryOutputService } from "../../storage/binaryOutputService";
import { capture } from "../../utils/analytics";
import { Page } from "playwright-core";
import { sendWebhook } from "../../routes/webhook";
import { addAirtableUpdateTask, airtableUpdateTasks, processAirtableUpdates } from "../integrations/airtable";
import { convertPageToMarkdown, convertPageToHTML, convertPageToScreenshot } from "../../markdownify/scrape";
import { processRobotOutputFormats } from "../../utils/output-post-processor";
import { getInterpretationFailureReason, hasExpectedRobotOutput } from "../../utils/output-validation";
import { applyAutomationRuntimeConfig, dispatchAutomationWebhook, persistExtractedDataForRun } from "../../services/automation";
import {
  warmUpBeforeAutomation,
  getUnblockOptionsFromRuntimeConfig,
  attachCloudflareWaitOnNavigation,
} from "../../services/unblocker";
import { AddGeneratedFlags, withTimeout } from "../../utils/workflowHelpers";

async function createWorkflowAndStoreMetadata(id: string, userId: string) {
  try {
    const recording: any = await Robot.findOne({
      'recording_meta.id': id
    }).lean();

    if (!recording || !recording.recording_meta || !recording.recording_meta.id) {
      return {
        success: false,
        error: 'Recording not found'
      };
    }

    const browserId = createRemoteBrowserForRun(userId);
    const runId = uuid();

    const run = await Run.create({
      status: 'scheduled',
      name: recording.recording_meta.name,
      robotId: recording._id?.toString() || recording.id,
      robotMetaId: recording.recording_meta.id,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      browserId,
      interpreterSettings: { maxConcurrency: 1, maxRepeats: 1, debug: true },
      log: '',
      runId,
      runByScheduleId: uuid(),
      serializableOutput: {},
      binaryOutput: {},
      retryCount: 0
    });

    const plainRun = run.toJSON();

    try {
      const runScheduledData = {
        runId: plainRun.runId,
        robotMetaId: plainRun.robotMetaId,
        robotName: plainRun.name,
        status: 'scheduled',
        startedAt: plainRun.startedAt,
        runByUserId: plainRun.runByUserId,
        runByScheduleId: plainRun.runByScheduleId,
        runByAPI: plainRun.runByAPI || false,
        browserId: plainRun.browserId
      };

      getIo().of('/queued-run').to(`user-${userId}`).emit('run-scheduled', runScheduledData);
      logger.log('info', `Scheduled run notification sent for run: ${plainRun.runId} to user-${userId}`);
    } catch (socketError: any) {
      logger.log('warn', `Failed to send run-scheduled notification for run ${plainRun.runId}: ${socketError.message}`);
    }

    return {
      browserId,
      runId: plainRun.runId,
    }

  } catch (e) {
    const { message } = e as Error;
    logger.log('info', `Error while scheduling a run with id: ${id}`);
    console.log(`Error while scheduling a run with id: ${id}:`, message);
    return {
      success: false,
      error: message,
    };
  }
}

async function triggerIntegrationUpdates(runId: string, robotMetaId: string): Promise<void> {
  try {
    addGoogleSheetUpdateTask(runId, {
      robotId: robotMetaId,
      runId: runId,
      status: 'pending',
      retries: 5,
    });

    addAirtableUpdateTask(runId, {
      robotId: robotMetaId,
      runId: runId,
      status: 'pending',
      retries: 5,
    });

    withTimeout(processAirtableUpdates(), 65000, 'Airtable update')
      .catch(err => logger.log('error', `Airtable update error: ${err.message}`));

    withTimeout(processGoogleSheetUpdates(), 65000, 'Google Sheets update')
      .catch(err => logger.log('error', `Google Sheets update error: ${err.message}`));
  } catch (err: any) {
    logger.log('error', `Failed to update integrations for run: ${runId}: ${err.message}`);
  }
}

async function executeRun(id: string, userId: string) {
  let browser: any = null;

  try {
    const run = await Run.findOne({ runId: id });
    if (!run) {
      return {
        success: false,
        error: 'Run not found'
      }
    }

    const plainRun = run.toJSON();

    if (run.status === 'aborted' || run.status === 'aborting') {
      logger.log('info', `Scheduled Run ${id} has status ${run.status}, skipping execution`);
      return {
        success: false,
        error: `Run has status ${run.status}`
      }
    }

    if (run.status === 'queued') {
      logger.log('info', `Scheduled Run ${id} has status 'queued', skipping stale execution - will be handled by recovery`);
      return {
        success: false,
        error: 'Run is queued and will be handled by recovery'
      }
    }

    const retryCount = plainRun.retryCount || 0;
    if (retryCount >= 3) {
      logger.log('warn', `Scheduled Run ${id} has exceeded max retries (${retryCount}/3), marking as failed`);
      const recording: any = await Robot.findOne({ 'recording_meta.id': plainRun.robotMetaId, userId }).lean();

      run.status = 'failed';
      run.finishedAt = new Date().toLocaleString();
      run.log = plainRun.log ? `${plainRun.log}\nMax retries exceeded (3/3) - Run failed after multiple attempts.` : `Max retries exceeded (3/3) - Run failed after multiple attempts.`;
      await run.save();

      try {
        const failureSocketData = {
          runId: plainRun.runId,
          robotMetaId: plainRun.robotMetaId,
          robotName: recording ? recording.recording_meta.name : 'Unknown Robot',
          status: 'failed',
          finishedAt: new Date().toLocaleString()
        };

        getIo().of(run.browserId).emit('run-completed', failureSocketData);
        getIo().of('/queued-run').to(`user-${userId}`).emit('run-completed', failureSocketData);
      } catch (socketError: any) {
        logger.log('warn', `Failed to emit failure event in main catch: ${socketError.message}`);
      }

      return {
        success: false,
        error: 'Max retries exceeded'
      }
    }

    const recording: any = await Robot.findOne({ 'recording_meta.id': plainRun.robotMetaId }).lean();
    if (!recording) {
      return {
        success: false,
        error: 'Recording not found'
      }
    }

    browser = browserPool.getRemoteBrowser(plainRun.browserId);
    if (!browser) {
      throw new Error('Could not access browser');
    }

    let currentPage = await browser.getCurrentPage();
    if (!currentPage) {
      throw new Error('Could not create a new page');
    }

    await applyAutomationRuntimeConfig(currentPage, recording);

    if (recording.recording_meta.type === 'scrape') {
      logger.log('info', `Executing scrape robot for scheduled run ${id}`);

      const formats = recording.recording_meta.formats || ['markdown'];

      run.status = 'running';
      run.log = `Converting page to: ${formats.join(', ')}`;
      await run.save();

      try {
        const runStartedData = {
          runId: plainRun.runId,
          robotMetaId: plainRun.robotMetaId,
          robotName: recording.recording_meta.name,
          status: 'running',
          startedAt: plainRun.startedAt
        };

        getIo().of('/queued-run').to(`user-${userId}`).emit('run-started', runStartedData);
        logger.log(
          'info',
          `Markdown robot run started notification sent for run: ${plainRun.runId} to user-${userId}`
        );
      } catch (socketError: any) {
        logger.log(
          'warn',
          `Failed to send run-started notification for markdown robot run ${plainRun.runId}: ${socketError.message}`
        );
      }

      try {
        const url = recording.recording_meta.url;

        if (!url) {
          throw new Error('No URL specified for markdown robot');
        }

        let markdown = '';
        let html = '';
        const serializableOutput: any = {};
        const binaryOutput: any = {};

        const SCRAPE_TIMEOUT = 120000;

        // Markdown conversion
        if (formats.includes("markdown")) {
          const markdownPromise = convertPageToMarkdown(url, currentPage);
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`Markdown conversion timed out after ${SCRAPE_TIMEOUT / 1000}s`)), SCRAPE_TIMEOUT);
          });
          markdown = await Promise.race([markdownPromise, timeoutPromise]);
          serializableOutput.markdown = [{ content: markdown }];
        }

        if (formats.includes("html")) {
          const htmlPromise = convertPageToHTML(url, currentPage);
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`HTML conversion timed out after ${SCRAPE_TIMEOUT / 1000}s`)), SCRAPE_TIMEOUT);
          });
          html = await Promise.race([htmlPromise, timeoutPromise]);
          serializableOutput.html = [{ content: html }];
        }

        if (formats.includes("screenshot-visible")) {
          const screenshotPromise = convertPageToScreenshot(url, currentPage, false);
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`Screenshot conversion timed out after ${SCRAPE_TIMEOUT / 1000}s`)), SCRAPE_TIMEOUT);
          });
          const screenshotBuffer = await Promise.race([screenshotPromise, timeoutPromise]);

          if (!binaryOutput['screenshot-visible']) {
            binaryOutput['screenshot-visible'] = {
              data: screenshotBuffer.toString('base64'),
              mimeType: 'image/png'
            };
          }
        }

        // Screenshot - full page
        if (formats.includes("screenshot-fullpage")) {
          const screenshotPromise = convertPageToScreenshot(url, currentPage, true);
          const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error(`Screenshot conversion timed out after ${SCRAPE_TIMEOUT / 1000}s`)), SCRAPE_TIMEOUT);
          });
          const screenshotBuffer = await Promise.race([screenshotPromise, timeoutPromise]);

          if (!binaryOutput['screenshot-fullpage']) {
            binaryOutput['screenshot-fullpage'] = {
              data: screenshotBuffer.toString('base64'),
              mimeType: 'image/png'
            };
          }
        }

        run.status = 'success';
        run.finishedAt = new Date().toLocaleString();
        run.log = `${formats.join(', ')} conversion completed successfully`;
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

        logger.log('info', `Markdown robot execution completed for scheduled run ${id}`);

        // Run-completed socket notifications
        try {
          const completionData = {
            runId: plainRun.runId,
            robotMetaId: plainRun.robotMetaId,
            robotName: recording.recording_meta.name,
            status: 'success',
            finishedAt: new Date().toLocaleString()
          };

          getIo().of(plainRun.browserId).emit('run-completed', completionData);
          getIo().of('/queued-run').to(`user-${userId}`).emit('run-completed', completionData);
        } catch (socketError: any) {
          logger.log(
            'warn',
            `Failed to send run-completed notification for markdown robot run ${id}: ${socketError.message}`
          );
        }

        // Webhook payload
        const webhookPayload: any = {
          robot_id: plainRun.robotMetaId,
          run_id: plainRun.runId,
          robot_name: recording.recording_meta.name,
          status: 'success',
          started_at: plainRun.startedAt,
          finished_at: new Date().toLocaleString(),
          metadata: {
            browser_id: plainRun.browserId,
            user_id: userId,
          }
        };

        if (formats.includes('markdown')) webhookPayload.markdown = markdown;
        if (formats.includes('html')) webhookPayload.html = html;
        if (uploadedBinaryOutput['screenshot-visible']) webhookPayload.screenshot_visible = uploadedBinaryOutput['screenshot-visible'];
        if (uploadedBinaryOutput['screenshot-fullpage']) webhookPayload.screenshot_fullpage = uploadedBinaryOutput['screenshot-fullpage'];

        try {
          await sendWebhook(plainRun.robotMetaId, 'run_completed', webhookPayload);
          logger.log(
            'info',
            `Webhooks sent successfully for markdown robot scheduled run ${plainRun.runId}`
          );
        } catch (webhookError: any) {
          logger.log(
            'warn',
            `Failed to send webhooks for markdown robot run ${plainRun.runId}: ${webhookError.message}`
          );
        }

        capture("maxun-oss-run-created", {
          runId: plainRun.runId,
          user_id: userId,
          status: "success",
          robot_type: "scrape",
          formats,
          source: "scheduled"
        });

        await destroyRemoteBrowser(plainRun.browserId, userId);

        return true;

      } catch (error: any) {
        logger.log('error', `${formats.join(', ')} conversion failed for scheduled run ${id}: ${error.message}`);

        run.status = 'failed';
        run.finishedAt = new Date().toLocaleString();
        run.log = `${formats.join(', ')} conversion failed: ${error.message}`;
        await run.save();

        try {
          const failureData = {
            runId: plainRun.runId,
            robotMetaId: plainRun.robotMetaId,
            robotName: recording.recording_meta.name,
            status: 'failed',
            finishedAt: new Date().toLocaleString()
          };

          getIo().of(plainRun.browserId).emit('run-completed', failureData);
          getIo().of('/queued-run').to(`user-${userId}`).emit('run-completed', failureData);
        } catch (socketError: any) {
          logger.log(
            'warn',
            `Failed to send run-failed notification for markdown robot run ${id}: ${socketError.message}`
          );
        }

        capture("maxun-oss-run-created", {
          runId: plainRun.runId,
          user_id: userId,
          status: "failed",
          robot_type: "scrape",
          formats,
          source: "scheduled"
        });

        await destroyRemoteBrowser(plainRun.browserId, userId);

        throw error;
      }
    }

    plainRun.status = 'running';

    try {
      const runStartedData = {
        runId: plainRun.runId,
        robotMetaId: plainRun.robotMetaId,
        robotName: recording ? recording.recording_meta.name : 'Unknown Robot',
        status: 'running',
        startedAt: plainRun.startedAt
      };

      getIo().of('/queued-run').to(`user-${userId}`).emit('run-started', runStartedData);
      logger.log('info', `Run started notification sent for run: ${plainRun.runId} to user-${userId}`);
    } catch (socketError: any) {
      logger.log('warn', `Failed to send run-started notification for run ${plainRun.runId}: ${socketError.message}`);
    }

    const workflow = AddGeneratedFlags(recording.recording);

    // Set run ID for real-time data persistence
    browser.interpreter.setRunId(id);

    const INTERPRETATION_TIMEOUT = 600000;

    const runtimeCfg = (plainRun.interpreterSettings as { runtimeConfig?: Record<string, unknown> } | undefined)
      ?.runtimeConfig;
    const unblockOpts = getUnblockOptionsFromRuntimeConfig(runtimeCfg);
    await warmUpBeforeAutomation(currentPage, unblockOpts);
    const stopCloudflareNavWait = attachCloudflareWaitOnNavigation(currentPage.context(), unblockOpts);

    let interpretationInfo;
    try {
      const interpretationPromise = browser.interpreter.InterpretRecording(
        workflow, currentPage, (newPage: Page) => currentPage = newPage, plainRun.interpreterSettings
      );

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Workflow interpretation timed out after ${INTERPRETATION_TIMEOUT / 1000}s`)), INTERPRETATION_TIMEOUT);
      });

      interpretationInfo = await Promise.race([interpretationPromise, timeoutPromise]);
    } finally {
      stopCloudflareNavWait();
    }

    const finalRun = await Run.findById(run._id);
    const categorizedOutput = {
      scrapeSchema: finalRun?.serializableOutput?.scrapeSchema || {},
      scrapeList: finalRun?.serializableOutput?.scrapeList || {},
      crawl: finalRun?.serializableOutput?.crawl || {},
      search: finalRun?.serializableOutput?.search || {}
    };

    let binaryOutput: Record<string, any> = {
      ...(interpretationInfo.binaryOutput || {})
    };

    const robotType = recording.recording_meta.type;
    const outputFormats = (recording.recording_meta as any).formats as string[] | undefined;

    if (robotType === 'crawl' || robotType === 'search') {
      const processedOutput = await processRobotOutputFormats({
        robotType,
        outputFormats,
        categorizedOutput: {
          crawl: categorizedOutput.crawl as Record<string, any>,
          search: categorizedOutput.search as Record<string, any>,
        },
        currentPage,
        initialBinaryOutput: binaryOutput,
      });

      categorizedOutput.crawl = processedOutput.categorizedOutput.crawl;
      categorizedOutput.search = processedOutput.categorizedOutput.search;
      binaryOutput = processedOutput.binaryOutput;

      run.serializableOutput = {
        ...(finalRun?.serializableOutput || {}),
        crawl: categorizedOutput.crawl,
        search: categorizedOutput.search,
      };
      await run.save();

      const hasOutput = hasExpectedRobotOutput(robotType, {
        crawl: categorizedOutput.crawl as Record<string, any>,
        search: categorizedOutput.search as Record<string, any>
      });

      if (!hasOutput) {
        const humanRobotType = robotType.charAt(0).toUpperCase() + robotType.slice(1);
        const fallbackReason = `${humanRobotType} run completed without producing output data`;
        throw new Error(getInterpretationFailureReason(interpretationInfo.log, fallbackReason));
      }
    }

    const binaryOutputService = new BinaryOutputService('maxun-run-screenshots');
    const uploadedBinaryOutput = Object.keys(binaryOutput).length > 0
      ? await binaryOutputService.uploadAndStoreBinaryOutput(run, binaryOutput)
      : {};

    await destroyRemoteBrowser(plainRun.browserId, userId);

    run.status = 'success';
    run.finishedAt = new Date().toLocaleString();
    run.log = interpretationInfo.log.join('\n');
    run.binaryOutput = uploadedBinaryOutput;
    await run.save();

    // Get metrics from persisted data for analytics and webhooks
    let totalSchemaItemsExtracted = 0;
    let totalListItemsExtracted = 0;
    let extractedScreenshotsCount = Object.keys(uploadedBinaryOutput).length;

    if (categorizedOutput) {
      if (categorizedOutput.scrapeSchema) {
        Object.values(categorizedOutput.scrapeSchema).forEach((schemaResult: any) => {
          if (Array.isArray(schemaResult)) {
            totalSchemaItemsExtracted += schemaResult.length;
          } else if (schemaResult && typeof schemaResult === 'object') {
            totalSchemaItemsExtracted += 1;
          }
        });
      }

      if (categorizedOutput.scrapeList) {
        Object.values(categorizedOutput.scrapeList).forEach((listResult: any) => {
          if (Array.isArray(listResult)) {
            totalListItemsExtracted += listResult.length;
          }
        });
      }
    }

    const totalRowsExtracted = totalSchemaItemsExtracted + totalListItemsExtracted;

    capture(
      'maxun-oss-run-created',
      {
        runId: id,
        created_at: new Date().toISOString(),
        status: 'success',
        totalRowsExtracted,
        schemaItemsExtracted: totalSchemaItemsExtracted,
        listItemsExtracted: totalListItemsExtracted,
        extractedScreenshotsCount,
        source: 'scheduled'
      }
    );

    try {
      const completionData = {
        runId: plainRun.runId,
        robotMetaId: plainRun.robotMetaId,
        robotName: recording.recording_meta.name,
        status: 'success',
        finishedAt: new Date().toLocaleString()
      };

      getIo().of(plainRun.browserId).emit('run-completed', completionData);
      getIo().of('/queued-run').to(`user-${userId}`).emit('run-completed', completionData);
    } catch (emitError: any) {
      logger.log('warn', `Failed to emit success event: ${emitError.message}`);
    }

    const webhookPayload = {
      robot_id: plainRun.robotMetaId,
      run_id: plainRun.runId,
      robot_name: recording.recording_meta.name,
      status: 'success',
      started_at: plainRun.startedAt,
      finished_at: new Date().toLocaleString(),
      extracted_data: {
        captured_texts: Object.keys(categorizedOutput.scrapeSchema || {}).length > 0
          ? Object.entries(categorizedOutput.scrapeSchema).reduce((acc, [name, value]) => {
            acc[name] = Array.isArray(value) ? value : [value];
            return acc;
          }, {} as Record<string, any[]>)
          : {},
        captured_lists: categorizedOutput.scrapeList,
        crawl_data: categorizedOutput.crawl,
        search_data: categorizedOutput.search,
        captured_texts_count: totalSchemaItemsExtracted,
        captured_lists_count: totalListItemsExtracted,
        screenshots_count: extractedScreenshotsCount
      },
      metadata: {
        browser_id: plainRun.browserId,
        user_id: userId,
      }
    };

    try {
      await sendWebhook(plainRun.robotMetaId, 'run_completed', webhookPayload);
      logger.log('info', `Webhooks sent successfully for completed run ${plainRun.runId}`);
    } catch (webhookError: any) {
      logger.log('error', `Failed to send webhooks for run ${plainRun.runId}: ${webhookError.message}`);
    }

    const refreshedRun = await Run.findOne({ runId: plainRun.runId });
    if (refreshedRun) {
      const extractedRows = await persistExtractedDataForRun(refreshedRun, recording);
      await dispatchAutomationWebhook(refreshedRun, recording, extractedRows);
    }

    await triggerIntegrationUpdates(plainRun.runId, plainRun.robotMetaId);
    return true;
  } catch (error: any) {
    logger.log('info', `Error while running a robot with id: ${id} - ${error.message}`);
    const run = await Run.findOne({ runId: id });
    if (run) {
      if (browser) {
        try {
          if (browser.interpreter) {
            await browser.interpreter.clearState();
          }
          await destroyRemoteBrowser(run.browserId, userId);
        } catch (cleanupError: any) {
          logger.error(`Failed to cleanup browser in error handler: ${cleanupError.message}`);
        }
      }

      run.status = 'failed';
      run.finishedAt = new Date().toLocaleString();
      await run.save();

      const recording: any = await Robot.findOne({ 'recording_meta.id': run.robotMetaId }).lean();

      // Trigger webhooks for run failure
      const failedWebhookPayload = {
        robot_id: run.robotMetaId,
        run_id: run.runId,
        robot_name: recording ? recording.recording_meta.name : 'Unknown Robot',
        status: 'failed',
        started_at: run.startedAt,
        finished_at: new Date().toLocaleString(),
        error: {
          message: error.message,
          stack: error.stack,
          type: error.name || 'ExecutionError'
        },
        metadata: {
          browser_id: run.browserId,
          user_id: userId,
        }
      };

      try {
        await sendWebhook(run.robotMetaId, 'run_failed', failedWebhookPayload);
        logger.log('info', `Failure webhooks sent successfully for run ${run.runId}`);
      } catch (webhookError: any) {
        logger.log('error', `Failed to send failure webhooks for run ${run.runId}: ${webhookError.message}`);
      }

      try {
        const failureSocketData = {
          runId: run.runId,
          robotMetaId: run.robotMetaId,
          robotName: recording ? recording.recording_meta.name : 'Unknown Robot',
          status: 'failed',
          finishedAt: new Date().toLocaleString()
        };

        getIo().of(run.browserId).emit('run-completed', failureSocketData);
        getIo().of('/queued-run').to(`user-${userId}`).emit('run-completed', failureSocketData);
      } catch (socketError: any) {
        logger.log('warn', `Failed to emit failure event in main catch: ${socketError.message}`);
      }
      capture(
        'maxun-oss-run-created',
        {
          runId: id,
          created_at: new Date().toISOString(),
          status: 'failed',
          source: 'scheduled'
        }
      );
    }
    return false;
  }
}

async function readyForRunHandler(browserId: string, id: string, userId: string, socket: Socket) {
  try {
    const interpretation = await executeRun(id, userId);

    if (interpretation) {
      logger.log('info', `Interpretation of ${id} succeeded`);
    } else {
      logger.log('error', `Interpretation of ${id} failed`);
      await destroyRemoteBrowser(browserId, userId);
    }

    resetRecordingState(browserId, id);

  } catch (error: any) {
    logger.error(`Error during readyForRunHandler: ${error.message}`);
    await destroyRemoteBrowser(browserId, userId);
  } finally {
    cleanupSocketConnection(socket, browserId, id);
  }
}

function resetRecordingState(browserId: string, id: string) {
  browserId = '';
  id = '';
}

export async function handleRunRecording(id: string, userId: string) {
  let socket: Socket | null = null;

  try {
    const result = await createWorkflowAndStoreMetadata(id, userId);
    const { browserId, runId: newRunId } = result;

    if (!browserId || !newRunId || !userId) {
      throw new Error('browserId or runId or userId is undefined');
    }

    const CONNECTION_TIMEOUT = 30000;

    socket = io(`${process.env.BACKEND_URL ? process.env.BACKEND_URL : 'http://localhost:5000'}/${browserId}`, {
      transports: ['websocket'],
      rejectUnauthorized: false,
      timeout: CONNECTION_TIMEOUT,
    });

    const readyHandler = () => readyForRunHandler(browserId, newRunId, userId, socket!);

    socket.on('ready-for-run', readyHandler);

    socket.on('connect_error', (error: Error) => {
      logger.error(`Socket connection error for scheduled run ${newRunId}: ${error.message}`);
      cleanupSocketConnection(socket!, browserId, newRunId);
    });

    socket.on('disconnect', () => {
      cleanupSocketConnection(socket!, browserId, newRunId);
    });

    logger.log('info', `Running robot: ${id}`);

  } catch (error: any) {
    logger.error('Error running recording:', error);
    if (socket) {
      cleanupSocketConnection(socket, '', '');
    }
  }
}

function cleanupSocketConnection(socket: Socket, browserId: string, id: string) {
  try {
    socket.removeAllListeners();
    socket.disconnect();

    if (browserId) {
      const socketServer = getIo();
      const namespace = socketServer.of(browserId);
      namespace.removeAllListeners();
      namespace.disconnectSockets(true);
      const nsps = (socketServer as any)._nsps;
      if (nsps && nsps.has(`/${browserId}`)) {
        nsps.delete(`/${browserId}`);
        logger.log('debug', `Deleted namespace /${browserId} from io._nsps Map`);
      }
    }

    logger.log('info', `Cleaned up socket connection for browserId: ${browserId}, runId: ${id}`);
  } catch (error: any) {
    logger.error(`Error cleaning up socket connection: ${error.message}`);
  }
}

export { createWorkflowAndStoreMetadata };

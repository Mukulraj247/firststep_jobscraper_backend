/**
 * Recording worker using Agenda (MongoDB-based).
 * Replaces the previous BullMQ + Redis implementation.
 */
import { Job as AgendaJob } from 'agenda';
import logger from './logger';
import dotenv from 'dotenv';
import {
  initializeRemoteBrowserForRecording,
  destroyRemoteBrowser,
  interpretWholeWorkflow,
  stopRunningInterpretation,
} from './browser-management/controller';
import { processRunExecution, abortRun, ExecuteRunData } from './workers/execution';
import { getAgenda } from './queue/scraperQueue';

dotenv.config();

interface RecordingJobData {
  userId: string;
  browserId?: string;
  runId?: string;
}

let recordingWorkersRegistered = false;

export async function startWorkers() {
  // `server.ts` calls this directly AND imports this module for its side effect
  // (top-level `startWorkers()`), which would otherwise re-run every `agenda.define`.
  // Guard so processors are registered exactly once per process.
  if (recordingWorkersRegistered) {
    return;
  }
  recordingWorkersRegistered = true;
  const agenda = await getAgenda();

  // Worker for initializing browser recording
  (agenda as any).define('initialize-browser-recording', async (job: AgendaJob<RecordingJobData>) => {
    const { userId } = job.attrs.data;
    logger.log('info', `Starting browser initialization job for user: ${userId}`);
    const browserId = initializeRemoteBrowserForRecording(userId);
    logger.log('info', `Browser recording job completed with browserId: ${browserId}`);
  });

  // Worker for destroying a browser
  (agenda as any).define('destroy-browser', async (job: AgendaJob<RecordingJobData>) => {
    const { browserId, userId } = job.attrs.data;
    logger.log('info', `Starting browser destruction job for browser: ${browserId}`);
    const success = await destroyRemoteBrowser(browserId!, userId);
    logger.log('info', `Browser destruction job completed with result: ${success}`);
  });

  // Worker for interpreting workflow
  (agenda as any).define('interpret-workflow', async (job: AgendaJob<RecordingJobData>) => {
    const { userId } = job.attrs.data;
    logger.log('info', 'Starting workflow interpretation job');
    await interpretWholeWorkflow(userId);
    logger.log('info', 'Workflow interpretation job completed');
  });

  // Worker for stopping workflow interpretation
  (agenda as any).define('stop-interpretation', async (job: AgendaJob<RecordingJobData>) => {
    const { userId } = job.attrs.data;
    logger.log('info', 'Starting stop interpretation job');
    await stopRunningInterpretation(userId);
    logger.log('info', 'Stop interpretation job completed');
  });

  // Worker for execute-run
  (agenda as any).define('execute-run', async (job: AgendaJob<ExecuteRunData>) => {
    logger.log('info', `Processing execute-run job ${job.attrs._id?.toString() || 'unknown'}`);
    await processRunExecution({ data: job.attrs.data });
    logger.log('info', `Execute-run job ${job.attrs._id?.toString() || 'unknown'} completed`);
  });

  // Worker for execute-run-user
  (agenda as any).define('execute-run-user', async (job: AgendaJob<ExecuteRunData>) => {
    logger.log('info', `Processing execute-run-user job ${job.attrs._id?.toString() || 'unknown'}`);
    await processRunExecution({ data: job.attrs.data });
    logger.log('info', `Execute-run-user job ${job.attrs._id?.toString() || 'unknown'} completed`);
  });

  // Worker for abort-run
  (agenda as any).define('abort-run', async (job: AgendaJob<{ userId: string; runId: string }>) => {
    const { userId, runId } = job.attrs.data;
    logger.log('info', `Processing abort request for run ${runId} by user ${userId}`);
    await abortRun(runId, userId);
    logger.log('info', `Abort job ${job.attrs._id?.toString() || 'unknown'} completed`);
  });

  logger.log('info', 'All recording workers registered with Agenda');
}

startWorkers().catch((error: unknown) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  logger.log('error', `Failed to start recording workers: ${errorMessage}`);
  process.exit(1);
});

process.on('SIGTERM', () => {
  logger.log('info', 'SIGTERM received, shutting down recording worker...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.log('info', 'SIGINT received, shutting down recording worker...');
  process.exit(0);
});

/**
 * Unified MongoDB-based job queue using Agenda (collection `agendaJobs` on `MONGODB_URI`).
 * Replaces BullMQ + Redis (MongoDB-based queue).
 *
 * Operational notes:
 * - Scraper jobs (`scraper-jobs`) are only processed if a Node process registers the
 *   processor (`startScraperWorker`) and Agenda is running. With `RUN_EMBEDDED_WORKERS=false`,
 *   run `npm run worker` (see `server/src/worker.ts`) so jobs are not left stuck in `pending`.
 * - `SCRAPER_WORKER_CONCURRENCY` controls how many `scraper-jobs` may run in parallel per
 *   process (wired in `scraperWorker.ts` via `agenda.define` options).
 * - DNS: use system resolver by default; optional `DNS_SERVERS` is applied in `storage/db.ts`.
 */
import Agenda, { AgendaConfig, Job } from 'agenda';
import logger from '../logger';

export interface ScraperJobData {
  automationId: string;
  runId: string;
  userId: string;
  config: Record<string, any>;
  /** Optional retry counter — set by the worker when re-enqueuing after a recoverable failure. */
  _attemptsMade?: number;
}

export interface ScheduleTriggerData {
  automationId: string;
  userId: string;
}

export interface RecordingJobData {
  userId: string;
  browserId?: string;
  runId?: string;
}

export interface ExecuteRunData {
  userId: string;
  runId: string;
  browserId?: string;
}

export interface AbortJobData {
  userId: string;
  runId: string;
}

/** Max concurrent `scraper-jobs` per API/worker process (Agenda `define` concurrency). */
export const SCRAPER_JOB_CONCURRENCY = parseInt(process.env.SCRAPER_WORKER_CONCURRENCY || '3', 10);

/** Drain window before force-unlock (default 90s). Keep below PM2 kill_timeout. */
export function getScrapeDrainMs(): number {
  const fromEnv = parseInt(process.env.SCRAPE_DRAIN_MS || '', 10);
  if (!Number.isNaN(fromEnv) && fromEnv > 0) return fromEnv;
  return 90_000;
}

/** Per-job Agenda lock: job timeout + 60s grace (hard crashes recover sooner than 10m default). */
export function computeScraperLockLifetimeMs(
  jobTimeoutMs = parseInt(process.env.SCRAPER_JOB_TIMEOUT_MS || '120000', 10)
): number {
  const timeout = Number.isNaN(jobTimeoutMs) || jobTimeoutMs <= 0 ? 120_000 : jobTimeoutMs;
  return timeout + 60_000;
}

let agendaInstance: Agenda | null = null;

function getAgendaConfig(): AgendaConfig {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/maxun';
  const processEvery = process.env.AGENDA_PROCESS_EVERY || '10 seconds';
  // Local vs hosted workers sharing one Atlas URI will race on the same collection.
  // Set AGENDA_COLLECTION=agendaJobs_local (API + worker) so dashboard Runs stay on your machine.
  const collection = String(process.env.AGENDA_COLLECTION || 'agendaJobs').trim() || 'agendaJobs';
  return {
    db: {
      address: mongoUri,
      collection,
    },
    processEvery,
    defaultLockLifetime: 10 * 60 * 1000,
    disableAutoIndex: false,
  };
}

export async function getAgenda(): Promise<Agenda> {
  if (agendaInstance) {
    return agendaInstance;
  }

  const config = getAgendaConfig();
  agendaInstance = new Agenda(config);
  const collection = (config.db as { collection?: string })?.collection || 'agendaJobs';
  logger.log('info', `Agenda using collection "${collection}" on shared Mongo (set AGENDA_COLLECTION to isolate local vs hosted workers)`);

  // Note: processors are registered by workers after getAgenda() returns.
  // Define call signature: agenda.define(name, options, processor).
  // Passing options AND processor in the same call ensures both are set atomically.

  await (agendaInstance as any).start();
  logger.log('info', 'Agenda queue started');

  agendaInstance.on('fail', (err: unknown, job: Job) => {
    const name = job?.attrs?.name ?? 'unknown';
    if (name !== 'schedule-triggers' && name !== 'scraper-jobs') {
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    const data = job?.attrs?.data as Record<string, unknown> | undefined;
    let extra = '';
    if (name === 'schedule-triggers' && data && typeof data.automationId === 'string') {
      extra = ` automationId=${data.automationId}`;
    } else if (name === 'scraper-jobs' && data && typeof data.runId === 'string') {
      extra = ` runId=${data.runId}`;
    }
    logger.log('error', `Agenda job "${name}" failed:${extra} ${msg}`);
  });

  return agendaInstance;
}

export async function enqueueScraperRun(
  jobData: ScraperJobData,
  opts?: { delayMs?: number }
): Promise<Job> {
  const agenda = await getAgenda();
  const job = await agenda.create<ScraperJobData>('scraper-jobs', jobData);
  // One Agenda document per run. `saveJob` merges `name` into the unique query; match `data.runId`
  // so repeat enqueue / recovery is idempotent (insertOnly).
  job.unique({ 'data.runId': jobData.runId }, { insertOnly: true });
  const delayMs = opts?.delayMs && opts.delayMs > 0 ? Math.floor(opts.delayMs) : 0;
  if (delayMs > 0) {
    job.schedule(new Date(Date.now() + delayMs));
  }
  await job.save();
  logger.log(
    'info',
    delayMs > 0
      ? `Enqueued scraper job for run ${jobData.runId} (delay ${delayMs}ms)`
      : `Enqueued scraper job for run ${jobData.runId}`
  );
  return job;
}

/**
 * Re-enqueue a scraper-job that has already been attempted (e.g. after a recoverable navigation
 * failure that triggered a retry). `enqueueScraperRun` uses `insertOnly: true` so it would be a
 * no-op when an existing doc is present in a terminal state (failedAt / lastFinishedAt set,
 * lockedAt null). We must DELETE the stale doc first; otherwise the run stays pending forever
 * because nothing ever picks it up again.
 *
 * Safety: if the existing doc is currently locked (a worker is actively processing it), we skip
 * the delete and enqueue — avoiding a race where we yank the doc out from under a live worker.
 * The caller can pass `force: true` when they know the lock is about to be released (e.g. the
 * worker's own catch handler calling requeue right before it throws out of the job function).
 *
 * `delayMs`: schedule the retry in the future (backoff). 0 / omitted = immediate.
 */
export async function requeueScraperRun(
  jobData: ScraperJobData,
  opts?: { force?: boolean; delayMs?: number }
): Promise<Job | null> {
  const agenda = await getAgenda();
  const collection: any = (agenda as any)._collection;
  const existing = collection
    ? await collection.findOne({ name: 'scraper-jobs', 'data.runId': jobData.runId })
    : null;

  if (existing) {
    const lockedRecently =
      existing.lockedAt && Date.now() - new Date(existing.lockedAt).getTime() < 5 * 60 * 1000;
    if (lockedRecently && !opts?.force) {
      logger.log(
        'warn',
        `requeueScraperRun: run ${jobData.runId} has an active/locked Agenda doc — skipping re-enqueue`
      );
      return null;
    }
    await agenda.cancel({ name: 'scraper-jobs', 'data.runId': jobData.runId });
  }

  return enqueueScraperRun(jobData, { delayMs: opts?.delayMs });
}

export async function enqueueScheduleTrigger(automationId: string, userId: string, jobId: string): Promise<Job> {
  const agenda = await getAgenda();
  const job = await agenda.create<ScheduleTriggerData>('schedule-triggers', {
    automationId,
    userId,
  });
  job.unique(`schedule:${jobId}`, { insertOnly: true });
  await job.save();
  return job;
}

export async function enqueueInitializeBrowser(userId: string): Promise<Job> {
  const agenda = await getAgenda();
  const job = await agenda.create<RecordingJobData>('initialize-browser-recording', { userId });
  await job.save();
  return job;
}

export async function enqueueDestroyBrowser(browserId: string, userId: string): Promise<Job> {
  const agenda = await getAgenda();
  const job = await agenda.create<RecordingJobData>('destroy-browser', { userId, browserId });
  await job.save();
  return job;
}

export async function enqueueInterpretWorkflow(userId: string): Promise<Job> {
  const agenda = await getAgenda();
  const job = await agenda.create<RecordingJobData>('interpret-workflow', { userId });
  await job.save();
  return job;
}

export async function enqueueStopInterpretation(userId: string): Promise<Job> {
  const agenda = await getAgenda();
  const job = await agenda.create<RecordingJobData>('stop-interpretation', { userId });
  await job.save();
  return job;
}

export async function enqueueExecuteRun(data: ExecuteRunData): Promise<Job> {
  const agenda = await getAgenda();
  const job = await agenda.create<ExecuteRunData>('execute-run', data);
  await job.save();
  return job;
}

export async function enqueueExecuteRunUser(data: ExecuteRunData): Promise<Job> {
  const agenda = await getAgenda();
  const job = await agenda.create<ExecuteRunData>('execute-run-user', data);
  await job.save();
  return job;
}

export async function enqueueAbortRun(userId: string, runId: string): Promise<Job> {
  const agenda = await getAgenda();
  const job = await agenda.create<AbortJobData>('abort-run', { userId, runId });
  await job.save();
  return job;
}

export async function scheduleRecurringTrigger(
  automationId: string,
  userId: string,
  cronExpression: string,
  timezone: string,
  scheduleJobId: string,
  options?: {
    /** When set, schedule as a true interval from now (staggered), not wall-clock cron. */
    everyMs?: number;
    /** Agenda human-interval string, e.g. "15 minutes". Required with everyMs. */
    humanInterval?: string;
    /**
     * On server rehydrate: keep an existing future nextRunAt so restart does not
     * realign every interval job to "now + interval".
     */
    preserveNextRunAt?: boolean;
    /**
     * Explicit first fire time (already packed / user-preferred). When set on
     * interval schedules, overrides skipImmediate default and hash stagger.
     */
    forcedNextRunAt?: Date | null;
  }
): Promise<Date | null> {
  const agenda = await getAgenda();

  // NOTE: We deliberately do NOT call `agenda.every()` here. In agenda@5 `every()` marks the job
  // as `type: "single"` which triggers a `findOneAndUpdate({ name, type: 'single' })` upsert in
  // save-job.js (see lines 119-125 of node_modules/agenda/dist/agenda/save-job.js). That query
  // IGNORES `data`, so EVERY `schedule-triggers` job collapses into a single Mongo document —
  // meaning the last automation scheduled wins and the others vanish. Instead we build the job
  // manually with `type: "normal"` + `unique({ 'data.automationId': ... })` so each automation
  // gets its own Mongo document keyed on `data.automationId`.
  //
  // We also intentionally do NOT pass `startDate` to `repeatEvery`. agenda's compute-next-run-at
  // reformats `startDate` via `moment(startDate).format('YYYY-MM-DD HH:mm')` (server local time)
  // then reinterprets that wall-clock in the target timezone — when server TZ differs from the
  // job TZ, this pushes `nextRunAt` forward by the TZ offset (e.g. a server in IST scheduling a
  // UTC cron ends up ~5.5h in the future). Omitting `startDate` lets cron-parser compute the
  // correct next occurrence from `now`.
  //
  // Short presets (15m/30m/1h/…) use human-interval + skipImmediate so the first fire is
  // "interval after save", then "interval after each run" — not shared */15 clock ticks.

  let previousNextRunAt: Date | null = null;
  if (options?.preserveNextRunAt) {
    try {
      const existing = await agenda.jobs({
        name: 'schedule-triggers',
        'data.automationId': automationId,
      });
      const prevJob = existing?.[0];
      const prev = prevJob?.attrs?.nextRunAt;
      const prevInterval = prevJob?.attrs?.repeatInterval;
      // Only keep nextRunAt when the job was already an interval schedule.
      // Cron-aligned nextRunAt values (e.g. shared */15 ticks) must be rebuilt
      // so existing automations stagger after deploy.
      const wasAlreadyInterval =
        typeof prevInterval === 'string' &&
        /(minute|hour|day|week)s?/i.test(prevInterval) &&
        !prevInterval.includes('*');
      if (wasAlreadyInterval && prev && new Date(prev).getTime() > Date.now()) {
        previousNextRunAt = new Date(prev);
      }
    } catch {
      /* ignore — fall through to fresh schedule */
    }
  }

  const job = (agenda as any).create('schedule-triggers', { automationId, userId });
  job.attrs.type = 'normal';

  const human = options?.humanInterval;
  const everyMs = options?.everyMs;
  const forced =
    options?.forcedNextRunAt && !Number.isNaN(new Date(options.forcedNextRunAt).getTime())
      ? new Date(options.forcedNextRunAt)
      : null;

  if (human && everyMs && everyMs > 0) {
    job.repeatEvery(human, { skipImmediate: true });
    if (previousNextRunAt) {
      job.attrs.nextRunAt = previousNextRunAt;
    } else if (forced && forced.getTime() > Date.now()) {
      job.attrs.nextRunAt = forced;
    } else if (options?.preserveNextRunAt) {
      // Migrating old wall-clock cron jobs on rehydrate: spread first fires across
      // the interval so a server restart does not pile every automation at now+15m.
      let hash = 0;
      for (let i = 0; i < automationId.length; i++) {
        hash = (hash + automationId.charCodeAt(i) * (i + 1)) % everyMs;
      }
      job.attrs.nextRunAt = new Date(Date.now() + 60_000 + hash);
    }
  } else {
    job.repeatEvery(cronExpression, { timezone });
    if (forced && forced.getTime() > Date.now() && !previousNextRunAt) {
      job.attrs.nextRunAt = forced;
    }
  }

  job.unique({ 'data.automationId': automationId });
  await job.save();

  const nextRunAt: Date | null = job.attrs.nextRunAt ? new Date(job.attrs.nextRunAt) : null;
  const desc =
    human && everyMs
      ? `interval ${human} (everyMs=${everyMs}, skipImmediate${previousNextRunAt ? ', preserved nextRunAt' : ''})`
      : `cron ${cronExpression} in ${timezone}`;
  logger.log('info', `Scheduled recurring trigger for automation ${automationId} with ${desc}`);
  return nextRunAt;
}

export async function cancelScheduledTrigger(automationId: string): Promise<void> {
  const agenda = await getAgenda();
  const count = await agenda.cancel({ name: 'schedule-triggers', 'data.automationId': automationId });
  // Only log when we actually cancelled something — calling cancel as a no-op during the normal
  // enable/update path was previously flooding the logs with "Cancelled 0 scheduled trigger(s)".
  if (count && count > 0) {
    logger.log('info', `Cancelled ${count} scheduled trigger(s) for automation ${automationId}`);
  }
}

/**
 * Stop polling, wait for in-flight Agenda jobs up to drainMs, then unlock + close.
 * Agenda 5.0.0 `drain()` has no built-in timeout — wrap with Promise.race.
 */
export async function drainAndCloseAgenda(options?: { drainMs?: number }): Promise<{ drained: boolean }> {
  if (!agendaInstance) {
    return { drained: true };
  }

  const agenda = agendaInstance;
  const drainMs = options?.drainMs ?? getScrapeDrainMs();
  let drained = true;

  try {
    await Promise.race([
      (agenda as any).drain(),
      new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error(`Agenda drain timed out after ${drainMs}ms`)), drainMs);
      }),
    ]);
    logger.log('info', `Agenda drained within ${drainMs}ms`);
  } catch (error: any) {
    drained = false;
    logger.log('warn', `Agenda drain incomplete: ${error?.message || error}`);
  }

  try {
    await agenda.stop();
  } catch (error: any) {
    logger.log('warn', `Agenda stop failed: ${error?.message || error}`);
  }

  try {
    await agenda.close();
  } catch (error: any) {
    logger.log('warn', `Agenda close failed: ${error?.message || error}`);
  }

  agendaInstance = null;
  logger.log('info', 'Agenda queue closed');
  return { drained };
}

/** Immediate stop + close (no drain wait). Prefer drainAndCloseAgenda on SIGTERM. */
export async function closeAgenda(): Promise<void> {
  await drainAndCloseAgenda({ drainMs: getScrapeDrainMs() });
}

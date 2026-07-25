import { Job as AgendaJob } from 'agenda';
import logger from '../logger';
import Run from '../models/Run';
import Robot from '../models/Robot';
import { createRemoteBrowserForRun, destroyRemoteBrowser } from '../browser-management/controller';
import { getAgenda, SCRAPER_JOB_CONCURRENCY, ScraperJobData, requeueScraperRun } from '../queue/scraperQueue';
import { processRunExecution } from './execution';
import { applyAutomationRuntimeConfig, dispatchAutomationWebhook, persistExtractedDataForRun } from '../services/automation';
import { runListExtraction } from '../services/listExtractor';
import { detectCaptcha, detectCloudflareChallenge, waitForCloudflareToClear, applyHumanDelay, simulateHumanMouse, detectAmazonChallengeAndWait, detectMicrosoftChallengeAndWait } from '../services/unblocker';
import { CaptchaEncounteredError, describe as describeCaptcha } from '../services/scraping/captchaGate';
import { resolveProxyPool, selectRotatedProxy } from '../services/proxyManager';
import { selectRotatedUserAgent } from '../services/userAgentManager';
import { getSessionStatePath, sessionStateExists } from '../storage/sessionState';
import { acquirePooledPage, releasePooledPage, evictBrowserFromPool } from '../services/browserReusePool';

const EXECUTION_TIMEOUT_MS = parseInt(process.env.SCRAPER_JOB_TIMEOUT_MS || '120000', 10);
const MAX_ATTEMPTS = 3;
const isNavigationNetworkFailure = (message: string): boolean =>
  /net::ERR_FAILED|ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY_CONNECTION_FAILED|ERR_CONNECTION_RESET|ERR_NAME_NOT_RESOLVED/i.test(message);
const ANTI_BOT_HOST_PATTERNS = [
  'apply.careers.microsoft.com',
  'jobs.careers.microsoft.com',
  'amazon.jobs',
  'linkedin.com',
  'workday',
  'greenhouse.io',
  'lever.co',
];

const isAntiBotTarget = (url?: string): boolean => {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return ANTI_BOT_HOST_PATTERNS.some((pattern) => host.includes(pattern));
  } catch {
    return false;
  }
};

const appendRunLog = async (run: any, message: string) => {
  const timestamped = `[${new Date().toISOString()}] ${message}`;
  const currentLog = typeof run.log === 'string' && run.log.length > 0 ? `${run.log}\n${timestamped}` : timestamped;
  run.log = currentLog;
  await run.save();
};

const computeDuration = (startedAt: string) => {
  const started = new Date(startedAt).getTime();
  if (Number.isNaN(started)) return null;
  return Math.max(0, Date.now() - started);
};

async function markFailed(run: any, errorMessage: string, finalState: 'pending' | 'failed') {
  await appendRunLog(run, errorMessage);
  run.status = finalState;
  run.errorMessage = errorMessage;
  run.finishedAt = finalState === 'failed' ? new Date().toLocaleString() : '';
  run.duration = finalState === 'failed' ? computeDuration(run.startedAt) : null;
  await run.save();
}

async function processConfiguredListExtraction(
  run: any,
  automation: any,
  userId: string,
  config: Record<string, any>,
  identityProfile: Record<string, any>,
  options?: { isolatedBrowserKey?: string; blockResources?: boolean }
): Promise<{ poolKey: string }> {
  const lease = await acquirePooledPage({
    profile: {
      ...identityProfile,
      poolIsolationKey: options?.isolatedBrowserKey,
    },
    maxPagesPerBrowser: config?.performance?.maxPagesPerBrowser || 3,
    blockResources: options?.blockResources ?? (config?.performance?.blockResources !== false),
  });
  const poolKey = lease.key;
  const page = lease.page;

  try {
    await appendRunLog(run, `Starting configured list extraction on ${automation.recording_meta.url}`);
    await applyAutomationRuntimeConfig(page, automation);

    if (await detectCloudflareChallenge(page)) {
      await appendRunLog(run, 'Cloudflare challenge detected before extraction. Waiting for verification to complete...');
      const challengeCleared = await waitForCloudflareToClear(page, {
        timeoutMs: config?.cloudflareWaitTimeoutMs || 45_000,
        pollMs: config?.cloudflarePollIntervalMs || 2_000,
      });
      if (!challengeCleared) {
        throw new Error('Cloudflare challenge did not clear before extraction');
      }
      await appendRunLog(run, 'Cloudflare challenge cleared. Continuing extraction.');
    }

    const amazonChallenge = await detectAmazonChallengeAndWait(page, {
      timeoutMs: config?.amazonChallengeWaitTimeoutMs || 90_000,
      pollMs: config?.amazonChallengePollIntervalMs || 5_000,
    });
    if (amazonChallenge.detected) {
      if (amazonChallenge.cleared) {
        await appendRunLog(run, 'Amazon challenge cleared. Continuing extraction.');
      } else {
        throw new Error('Amazon anti-bot challenge did not clear — evicting browser and retrying');
      }
    }

    const microsoftChallenge = await detectMicrosoftChallengeAndWait(page, {
      timeoutMs: config?.microsoftChallengeWaitTimeoutMs || 60_000,
      pollMs: config?.microsoftChallengePollIntervalMs || 5_000,
    });
    if (microsoftChallenge.detected) {
      if (microsoftChallenge.cleared) {
        await appendRunLog(run, 'Microsoft challenge cleared. Continuing extraction.');
      } else {
        throw new Error('Microsoft anti-bot challenge did not clear — evicting browser and retrying');
      }
    }

    await simulateHumanMouse(page);
    await applyHumanDelay(page, 300, 900);

    // Merge automation-level knobs into the list-extraction config so the
    // extractor gets the same scroll/popup/captcha behaviour the extension
    // applied locally (populated via `AutomationRuntimeConfig` from the
    // extension's Send to Maxun flow).
    const extractionConfig: any = {
      ...(config?.listExtraction || { itemSelector: '', fields: {} }),
    };
    if (config?.popups && !extractionConfig.popups) {
      extractionConfig.popups = { ...config.popups };
    }
    if (config?.captcha && !extractionConfig.captcha) {
      extractionConfig.captcha = { ...config.captcha };
    }
    extractionConfig.pagination = {
      ...(extractionConfig.pagination || {}),
    };
    if (typeof config?.pagination?.maxScrollSteps === 'number' && !extractionConfig.pagination.maxScrollSteps) {
      extractionConfig.pagination.maxScrollSteps = config.pagination.maxScrollSteps;
    }
    if (typeof config?.pagination?.scrollSpinnerBudgetMs === 'number' && !extractionConfig.pagination.scrollSpinnerBudgetMs) {
      extractionConfig.pagination.scrollSpinnerBudgetMs = config.pagination.scrollSpinnerBudgetMs;
    }
    if (typeof config?.pagination?.loadMoreWaitMs === 'number' && !extractionConfig.pagination.loadMoreWaitMs) {
      extractionConfig.pagination.loadMoreWaitMs = config.pagination.loadMoreWaitMs;
    }

    const rows = await runListExtraction(page, automation.recording_meta.url, extractionConfig);
    if (config?.captcha?.pauseOnDetect !== false && (await detectCaptcha(page))) {
      throw new CaptchaEncounteredError(
        { present: true, kind: 'text-marker', evidence: 'post-extraction body text' },
        page.url() || ''
      );
    }

    const serializableOutput = {
      ...(run.serializableOutput || {}),
      scrapeList: {
        ...(run.serializableOutput?.scrapeList || {}),
        'Configured List Extraction': rows,
      },
    };

    run.serializableOutput = serializableOutput;
    run.status = 'completed';
    run.finishedAt = new Date().toLocaleString();
    run.duration = computeDuration(run.startedAt);
    run.errorMessage = null;
    await run.save();

    await appendRunLog(run, `List extraction completed with ${rows.length} rows`);
    if (rows.length === 0) {
      await appendRunLog(
        run,
        'Zero rows usually means the item/field CSS selectors no longer match this page (Amazon Jobs often changes markup), or the list had not rendered yet. Re-record the list on this exact URL in the extension, enable scroll/wait if needed, and check the run screenshot for a consent or anti-bot page.'
      );
    }

    const refreshedRun = await Run.findOne({ runId: run.runId });
    if (!refreshedRun) {
      throw new Error(`Run ${run.runId} disappeared after list extraction`);
    }

    const persistedRows = await persistExtractedDataForRun(refreshedRun, automation);
    await dispatchAutomationWebhook(refreshedRun, automation, persistedRows);

    const { io } = await import('../server');
    io.of('/queued-run').to(`user-${userId}`).emit('run-completed', {
      runId: run.runId,
      robotMetaId: run.robotMetaId,
      robotName: automation.recording_meta.name,
      status: 'success',
      finishedAt: refreshedRun.finishedAt,
    });

    return { poolKey };
  } finally {
    if (!lease.page.isClosed()) {
      await releasePooledPage(lease).catch(() => {});
    }
  }
}

async function persistSessionStateForRun(userId: string, automationId: string, browserId: string) {
  const browserModule = await import('../server');
  const browser = browserModule.browserPool.getRemoteBrowser(browserId);
  const page = browser?.getCurrentPage();
  if (!page) return;

  const storageStatePath = await getSessionStatePath(userId, automationId);
  await page.context().storageState({ path: storageStatePath });
}

async function buildIdentityProfile(userId: string, automationId: string, config: Record<string, any>, attemptsMade: number) {
  const proxyPool = await resolveProxyPool(String(userId), config);
  const selectedProxy = selectRotatedProxy(proxyPool, attemptsMade);
  const userAgent = config?.userAgent || selectRotatedUserAgent(attemptsMade, config?.userAgentPool);
  const shouldReuseSession = config?.reuseSession !== false;
  const targetUrl = config?.targetUrl;
  const antiBotTarget = isAntiBotTarget(targetUrl);
  const storageStatePath = shouldReuseSession && await sessionStateExists(String(userId), automationId)
    ? await getSessionStatePath(String(userId), automationId)
    : undefined;

  let browserType = config?.browserType;
  let headless = config?.headless !== false;
  let useStealth = config?.useStealth !== false;
  let identityStrategy = 'baseline';

  // Adaptive strategy: retries should not repeat the same browser profile.
  // For known anti-bot job boards, progressively switch engine/mode.
  if (antiBotTarget) {
    if (attemptsMade === 1) {
      browserType = 'camoufox';
      headless = false;
      useStealth = true;
      identityStrategy = 'retry-camoufox-visible';
    } else if (attemptsMade >= 2) {
      browserType = 'playwright';
      headless = false;
      useStealth = true;
      identityStrategy = 'retry-playwright-visible';
    } else {
      identityStrategy = 'baseline-antibot';
    }
  }

  return {
    userAgent,
    headless,
    useStealth,
    locale: config?.locale || 'en-US',
    storageStatePath,
    contextProxy: selectedProxy,
    proxy: selectedProxy,
    browserType,
    identityStrategy,
  };
}

async function processScraperJob(job: AgendaJob<ScraperJobData>) {
  const { automationId, runId, userId, config } = job.attrs.data;
  logger.log('info', `Processing scraper job: runId=${runId}, automationId=${automationId}`);
  const attemptsMade = (job.attrs.data as any)._attemptsMade || 0;

  const run = await Run.findOne({ runId });

  if (!run) {
    throw new Error(`Run ${runId} not found`);
  }

  const automation: any = await Robot.findOne({
    'recording_meta.id': automationId,
  }).lean();

  if (!automation) {
    await markFailed(run, `Automation ${automationId} not found`, 'failed');
    throw new Error(`Automation ${automationId} not found`);
  }

  let browserId: string | null = null;
  let extractionPoolKey: string | null = null;

  try {
    const identityProfile = await buildIdentityProfile(
      String(userId),
      automationId,
      { ...config, targetUrl: automation?.recording_meta?.url },
      attemptsMade
    );

    run.status = 'running';
    run.queueJobId = job.attrs._id?.toString() || 'unknown';
    run.retryCount = attemptsMade;
    run.errorMessage = null;
    run.interpreterSettings = {
      ...(run.interpreterSettings || {}),
      runtimeConfig: config,
    };
    await run.save();

    try {
      const { io: serverIo } = await import('../server');
      serverIo.of('/queued-run').to(`user-${userId}`).emit('run-started', {
        runId: run.runId,
        robotMetaId: run.robotMetaId,
        robotName: automation.recording_meta.name,
        status: 'running',
        startedAt: new Date().toLocaleString(),
      });
    } catch (socketError: any) {
      logger.log('warn', `Failed to send run-started notification for run ${run.runId}: ${socketError.message}`);
    }

    await appendRunLog(run, `Dequeued Agenda job ${job.attrs._id?.toString() || 'unknown'} (attempt ${attemptsMade + 1}/${MAX_ATTEMPTS})`);
    await appendRunLog(
      run,
      `Identity selected: strategy=${identityProfile.identityStrategy || 'baseline'}, browser=${identityProfile.browserType || 'playwright-default'}, proxy ${identityProfile.contextProxy?.server || 'none'}, headless=${identityProfile.headless}`
    );

    const hasConfiguredListExtraction =
      !!config?.listExtraction?.itemSelector &&
      config?.listExtraction?.fields &&
      Object.keys(config.listExtraction.fields).length > 0;

    // Smart extraction: if this automation has no workflow pairs (just a URL)
    // and no configured selectors, use the smart auto-discovery path
    const isUrlOnlyAutomation =
      !hasConfiguredListExtraction &&
      automation.recording_meta?.url &&
      (!automation.recording?.workflow || automation.recording.workflow.length <= 1);

    const useListExtraction = hasConfiguredListExtraction || isUrlOnlyAutomation;

    if (!useListExtraction) {
      browserId = createRemoteBrowserForRun(String(userId), identityProfile);
      run.browserId = browserId;
      await run.save();
      await appendRunLog(run, `Allocated browser ${browserId}`);
    } else {
      const mode = hasConfiguredListExtraction ? 'configured selectors' : 'smart auto-discovery';
      await appendRunLog(run, `Using pooled browser/page for list extraction (${mode})`);
    }

    let executionResult: { poolKey: string } | undefined;

    const executionFn = useListExtraction
      ? async () => {
          try {
            const result = await processConfiguredListExtraction(run, automation, String(userId), config, identityProfile);
            executionResult = result;
            extractionPoolKey = result.poolKey;
          } catch (firstError: any) {
            const firstMessage = firstError instanceof Error ? firstError.message : String(firstError);
            if (!isNavigationNetworkFailure(firstMessage)) {
              throw firstError;
            }

            await appendRunLog(
              run,
              'Detected network-level navigation failure. Retrying once with an isolated fresh browser context (no pooled reuse, resources unblocked).'
            );

            const isolatedKey = `net-fallback-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const fallbackResult = await processConfiguredListExtraction(
              run,
              automation,
              String(userId),
              config,
              identityProfile,
              { isolatedBrowserKey: isolatedKey, blockResources: false }
            );
            executionResult = fallbackResult;
            extractionPoolKey = fallbackResult.poolKey;
          }
        }
      : async () => {
          await processRunExecution({
            data: {
              userId: String(userId),
              runId,
              browserId,
            },
          } as any);
        };

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Scraper job timed out after ${EXECUTION_TIMEOUT_MS}ms`)), EXECUTION_TIMEOUT_MS);
    });

    await Promise.race([executionFn(), timeoutPromise]);

    const refreshedRun = await Run.findOne({ runId });
    if (!refreshedRun) {
      throw new Error(`Run ${runId} disappeared during execution`);
    }

    const browserModule = await import('../server');
    const page = browserId ? browserModule.browserPool.getRemoteBrowser(browserId)?.getCurrentPage() : null;
    if (page) {
      await simulateHumanMouse(page);
      await applyHumanDelay(page, 200, 700);
      if (config?.captcha?.pauseOnDetect !== false && (await detectCaptcha(page))) {
        throw new CaptchaEncounteredError(
          { present: true, kind: 'text-marker', evidence: 'post-run body text' },
          page.url() || ''
        );
      }
      if (config?.reuseSession !== false && browserId) {
        await persistSessionStateForRun(String(userId), automationId, browserId);
      }
    }

    await appendRunLog(refreshedRun, `Agenda job ${job.attrs._id?.toString() || 'unknown'} completed successfully`);
    refreshedRun.status = refreshedRun.status === 'success' ? 'completed' : (refreshedRun.status || 'completed');
    refreshedRun.duration = computeDuration(refreshedRun.startedAt);
    refreshedRun.errorMessage = null;
    refreshedRun.finishedAt = refreshedRun.finishedAt || new Date().toLocaleString();
    await refreshedRun.save();

    if (browserId) {
      await destroyRemoteBrowser(browserId, String(userId));
    }

    return { success: true, runId };
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    const latestRun = await Run.findOne({ runId });

    if (browserId) {
      try {
        await destroyRemoteBrowser(browserId, String(userId));
      } catch (cleanupError: any) {
        logger.log('warn', `Failed to cleanup browser ${browserId} for run ${runId}: ${cleanupError.message}`);
      }
    }

    // CAPTCHA surfaced from either engine: emit a dedicated `captcha:required`
    // socket event and fail the run with a clear reason. No retry — a retry
    // from the same identity will just hit the same challenge.
    const isCaptcha =
      error instanceof CaptchaEncounteredError ||
      (error && error.name === 'CaptchaEncounteredError');

    if (isCaptcha && latestRun) {
      const hasRemainingAttempts = attemptsMade + 1 < MAX_ATTEMPTS;

      try {
        const { io } = await import('../server');
        const payload = describeCaptcha(
          {
            present: true,
            kind: (error as any)?.kind || 'unknown',
            evidence: (error as any)?.evidence,
          },
          runId,
          automationId,
          (error as any)?.url || automation?.recording_meta?.url || ''
        );
        io.of('/queued-run').to(`user-${userId}`).emit('captcha:required', payload);
      } catch (emitError: any) {
        logger.log('warn', `Failed to emit captcha:required for run ${runId}: ${emitError.message}`);
      }

      if (hasRemainingAttempts) {
        await appendRunLog(latestRun, `CAPTCHA encountered — retrying with alternate browser strategy (${attemptsMade + 2}/${MAX_ATTEMPTS})`);
        latestRun.status = 'pending';
        latestRun.errorMessage = `CAPTCHA encountered on attempt ${attemptsMade + 1}: ${message}`;
        latestRun.retryCount = attemptsMade + 1;
        latestRun.finishedAt = '';
        latestRun.duration = null;
        await latestRun.save();

        try {
          await requeueScraperRun(
            {
              automationId,
              runId,
              userId: String(userId),
              config,
              _attemptsMade: attemptsMade + 1,
            },
            { force: true }
          );
          await appendRunLog(
            latestRun,
            `Re-enqueued for retry ${attemptsMade + 2}/${MAX_ATTEMPTS}`
          );
        } catch (requeueError: any) {
          logger.log(
            'error',
            `Failed to re-enqueue CAPTCHA retry for run ${runId}: ${requeueError.message}`
          );
          await markFailed(
            latestRun,
            `CAPTCHA encountered and retry re-enqueue failed: ${requeueError.message}`,
            'failed'
          );
        }
      } else {
        await markFailed(latestRun, `CAPTCHA encountered — run paused. ${message}`, 'failed');
        latestRun.retryCount = attemptsMade;
        await latestRun.save();

        try {
          const { io } = await import('../server');
          io.of('/queued-run').to(`user-${userId}`).emit('run-completed', {
            runId,
            robotMetaId: latestRun.robotMetaId,
            robotName: automation?.recording_meta?.name || 'Unknown Robot',
            status: 'failed',
            finishedAt: new Date().toLocaleString(),
            reason: 'captcha',
          });
        } catch (emitError: any) {
          logger.log('warn', `Failed to emit run-completed after CAPTCHA for run ${runId}: ${emitError.message}`);
        }
      }

      throw error;
    }

    if (latestRun) {
      const hasRemainingAttempts = attemptsMade + 1 < MAX_ATTEMPTS;

      // If retries remain, evict the browser from the pool so the next attempt
      // gets a fresh browser that hasn't been flagged by the target website
      if (hasRemainingAttempts && extractionPoolKey) {
        try {
          await evictBrowserFromPool(extractionPoolKey);
          await appendRunLog(latestRun, `Evicting flagged browser from pool — next attempt will use fresh browser`);
        } catch (evictError: any) {
          logger.log('warn', `Failed to evict browser from pool for run ${runId}: ${evictError.message}`);
        }
      }
      await markFailed(
        latestRun,
        `${message}${hasRemainingAttempts ? ' - retrying with a new identity profile' : ''}`,
        hasRemainingAttempts ? 'pending' : 'failed'
      );
      latestRun.retryCount = attemptsMade + 1;
      await latestRun.save();

      // Intent: "status=pending" asks the system to retry. But the current Agenda `scraper-jobs`
      // doc is about to be marked `failedAt` by Agenda's fail handler, and `enqueueScraperRun`
      // uses `insertOnly: true` — so the 90s stale poller would find the existing terminal doc
      // and silently no-op, leaving the run stuck in `pending` forever. Explicitly delete the
      // stale Agenda doc and re-enqueue a fresh one with the incremented attempt counter.
      if (hasRemainingAttempts) {
        try {
          // `force: true` — the current Agenda doc is still locked (this worker is about to
          // throw out of the job function, which releases the lock). We know it's safe to
          // cancel and re-insert here; without `force`, the safety lock-check would no-op
          // and leave the run stranded in pending.
          await requeueScraperRun(
            {
              automationId,
              runId,
              userId: String(userId),
              config,
              _attemptsMade: attemptsMade + 1,
            },
            { force: true }
          );
          await appendRunLog(
            latestRun,
            `Re-enqueued for retry ${attemptsMade + 2}/${MAX_ATTEMPTS}`
          );
        } catch (requeueError: any) {
          logger.log(
            'error',
            `Failed to re-enqueue run ${runId} for retry: ${requeueError.message}`
          );
          // If re-enqueue fails, surface the failure instead of leaving the run stranded.
          await markFailed(
            latestRun,
            `${message} - retry re-enqueue failed: ${requeueError.message}`,
            'failed'
          );
        }
      }

      if (!hasRemainingAttempts) {
        try {
          const robot: any = await Robot.findOne({
            'recording_meta.id': latestRun.robotMetaId,
          }).lean();
          const { io } = await import('../server');
          io.of('/queued-run').to(`user-${userId}`).emit('run-completed', {
            runId,
            robotMetaId: latestRun.robotMetaId,
            robotName: robot?.recording_meta?.name || 'Unknown Robot',
            status: 'failed',
            finishedAt: new Date().toLocaleString(),
          });
        } catch (emitError: any) {
          logger.log('warn', `Failed to emit final failure for run ${runId}: ${emitError.message}`);
        }
      }
    }

    throw error;
  }
}

let scraperWorkerRegistered = false;

export async function startScraperWorker() {
  if (scraperWorkerRegistered) return;
  const agenda = await getAgenda();
  (agenda as any).define(
    'scraper-jobs',
    { concurrency: SCRAPER_JOB_CONCURRENCY },
    async (job: AgendaJob<ScraperJobData>) => {
      try {
        await processScraperJob(job);
        logger.log('info', `Scraper job ${job.attrs._id?.toString() || 'unknown'} completed`);
      } catch (error: any) {
        const message = error instanceof Error ? error.message : String(error);
        logger.log('error', `Scraper job ${job.attrs._id?.toString() || 'unknown'} failed: ${message}`);
        // Re-throw to let Agenda handle retries if configured
        throw error;
      } finally {
        if (typeof global.gc === 'function') {
          try {
            global.gc();
          } catch {}
        }
      }
    }
  );
  scraperWorkerRegistered = true;
  logger.log('info', 'Scraper job processor registered with Agenda');
}

export async function stopScraperWorker() {
  // Agenda handles stopping internally via closeAgenda()
}

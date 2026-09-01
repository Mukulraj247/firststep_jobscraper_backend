import { Job as AgendaJob } from 'agenda';
import logger from '../logger';
import Run from '../models/Run';
import Robot from '../models/Robot';
import { createRemoteBrowserForRun, destroyRemoteBrowser } from '../browser-management/controller';
import { getAgenda, SCRAPER_JOB_CONCURRENCY, ScraperJobData, requeueScraperRun, requeueAggregatorRun, computeScraperLockLifetimeMs } from '../queue/scraperQueue';
import { processRunExecution } from './execution';
import {
  applyAutomationRuntimeConfig,
  computeElapsedRunDurationMs,
  dispatchAutomationWebhook,
  getAutomationConfig,
  persistExtractedDataForRun,
} from '../services/automation';
import { runListExtraction, applySelectorPromotions, primaryItemSelector } from '../services/listExtractor';
import {
  LINKEDIN_NO_SESSION_HINT,
  linkedInPoolCanAuthenticate,
  shouldFailFastLinkedInWithoutSession,
} from '../services/linkedinSessionGate';
import {
  isAggregatorRobot,
  isLinkedInAggregatorRobot,
  shouldEnrichHiringCafeDetails,
  shouldEnrichAccelDetails,
  shouldEnrichConsiderDetails,
  shouldEnrichCapitalGDetails,
  shouldEnrichChoppingBlockDetails,
  shouldEnrichAidevboardDetails,
} from '../services/aggregatorIdentity';
import {
  beginLinkedInAggregatorRun,
  ensureLinkedInAggregatorSessionOnPage,
  finishLinkedInAggregatorRun,
  getLinkedInAggregatorStorageStatePath,
  isLinkedInBlockError,
  tryRotateLinkedInAggregatorAccount,
  type LinkedInAggregatorRunHandle,
} from '../services/linkedinAggregatorRun';
import { persistLinkedInAccountSession } from '../services/linkedinLogin';
import { enrichHiringCafeListRows } from '../services/hiringCafeDetailScrape';
import { enrichAccelListRows } from '../services/accelDetailScrape';
import { enrichConsiderListRows } from '../services/sequoiaDetailScrape';
import { enrichChoppingBlockListRows } from '../services/choppingblockDetailScrape';
import { enrichAidevboardListRows } from '../services/aidevboardDetailScrape';
import { resolveExecutionTimeoutMs } from '../services/hiringCafeRuntime';
import {
  evaluateRunDrift,
  fetchRecentFinishedRuns,
  getBaselineForRobot,
  loadDriftConfig,
  RunDriftError,
  RunDriftOutcome,
} from '../services/runDrift';
import { detectCaptcha, detectCloudflareChallenge, waitForCloudflareToClear, applyHumanDelay, simulateHumanMouse, detectAmazonChallengeAndWait, detectMicrosoftChallengeAndWait } from '../services/unblocker';
import { CaptchaEncounteredError, describe as describeCaptcha } from '../services/scraping/captchaGate';
import {
  isScraperProxyEnabled,
  probeProxyHttpConnect,
  resolveProxyPool,
  selectRotatedProxy,
  type ProxyProfile,
} from '../services/proxyManager';
import {
  classifyProxyEscalation,
  hasConfiguredLastResortProxy,
  isProxyAllowedForAttempt,
  retryReasonFromEscalation,
  type ScraperRetryReason,
} from '../services/proxyEscalation';
import {
  blockRetryIdentity,
  captchaRetryIdentity,
  isProxyTunnelFailure,
  normalizeFailedProxyServers,
  rememberFailedProxy,
} from '../services/scraperIdentity';
import { normalizeProxyServer } from '../services/proxyConfig';
import { selectRotatedUserAgent } from '../services/userAgentManager';
import { getSessionStatePath, sessionStateExists } from '../storage/sessionState';
import {
  acquirePooledPage,
  releasePooledPage,
  evictBrowserFromPool,
  closeBrowserReusePool,
} from '../services/browserReusePool';
import { killUntrackedPlaywrightChromium } from '../services/browserProcess';
import { getDefaultMaxPagesPerBrowser, isLowMemoryMode } from '../utils/memoryMode';
import {
  computeScrapeRetryDelayMs,
  getHostBreaker,
  hostnameFromUrl,
  recordHostFailure,
  recordHostSuccess,
} from '../services/scrapeBackpressure';
import {
  isHttp2ProtocolNavigationError,
  probeHttp11,
  shouldDisableChromiumHttp2,
} from '../services/navigationDiagnostics';
import { emitQueuedRunEvent } from './scrapeSocket';
import {
  applyLayoutChangeSuggestion,
  normalizeFailureReason,
  resolveFailureReason,
} from '../utils/failureReason';
import {
  isChildProcessIsolationEnabled,
  runScraperJobInChild,
  ScraperJobTimeoutError,
  ScraperJobCancelledError,
  killAllActiveScrapeChildren,
} from './scrapeJobSupervisor';
import {
  detectAtsBoard,
  fetchAtsBoardJobs,
  looksLikeFindlyBoard,
  looksLikePhenomBoard,
  looksLikeHappyDanceBoard,
  looksLikeWorkdayBoard,
  looksLikeGreenhouseBoard,
  looksLikeWayfairCareersBoard,
  looksLikeTalentBrewBoard,
  looksLikeZwayamBoard,
  startUrlHasCollectionFilters,
  shouldSkipAtsBoardForUiPagination,
  shouldPreferAtsBoardOverUiPagination,
} from '../services/atsAdapters';
import { isJibeCareerHost } from '../services/jibeBoardHostsDirectory';
import { resolveAtsBoardStartUrl } from '../services/careerSiteAtsConfig';
import { getScrapeHeartbeatMs } from '../utils/scrapeHeartbeat';
import { isTerminalRunStatus } from '../services/runLifecycle';
import { assertSafeOutboundUrl, safeOutboundUrlLogLabel } from '../utils/outboundUrlPolicy';
import {
  resolveAutomationExecutionConfig,
  toOperationalRunConfig,
} from '../services/automationConfigView';

export const EXECUTION_TIMEOUT_MS = parseInt(process.env.SCRAPER_JOB_TIMEOUT_MS || '120000', 10);
/** Total attempts per run (1 = no retries). Lower on constrained/free instances to avoid retry storms. */
const MAX_ATTEMPTS = Math.max(1, parseInt(process.env.SCRAPER_MAX_ATTEMPTS || '3', 10));
/** Deploy-tunable anti-bot wait budgets. Defaults keep prior behaviour; shrink these on free tier so a single challenge wait can't exceed SCRAPER_JOB_TIMEOUT_MS. */
const CLOUDFLARE_WAIT_MS = parseInt(
  process.env.CLOUDFLARE_WAIT_TIMEOUT_MS || (isLowMemoryMode() ? '20000' : '45000'),
  10
);
const AMAZON_WAIT_MS = parseInt(
  process.env.AMAZON_CHALLENGE_WAIT_MS || (isLowMemoryMode() ? '30000' : '90000'),
  10
);
const MICROSOFT_WAIT_MS = parseInt(
  process.env.MICROSOFT_CHALLENGE_WAIT_MS || (isLowMemoryMode() ? '25000' : '60000'),
  10
);
/** Cap run.log size so repeated saves don't balloon mongoose docs / Atlas payloads. */
const RUN_LOG_MAX_CHARS = parseInt(process.env.RUN_LOG_MAX_CHARS || (isLowMemoryMode() ? '8000' : '50000'), 10);
const RUN_LOG_FLUSH_EVERY = parseInt(process.env.RUN_LOG_FLUSH_EVERY || (isLowMemoryMode() ? '4' : '1'), 10);
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

/** Prefer Camoufox residential proxy, then DEFAULT_PROXY_URL — used when escalating after CAPTCHA/blocks. */
const getEnvFallbackProxy = (): ProxyProfile | null => {
  if (!isScraperProxyEnabled()) {
    return null;
  }
  const camoufoxServer = normalizeProxyServer(process.env.CAMOUFOX_PROXY_SERVER);
  if (camoufoxServer) {
    return {
      server: camoufoxServer,
      username: String(process.env.CAMOUFOX_PROXY_USERNAME || '').trim() || undefined,
      password: String(process.env.CAMOUFOX_PROXY_PASSWORD || '').trim() || undefined,
    };
  }
  const defaultServer = normalizeProxyServer(process.env.DEFAULT_PROXY_URL);
  if (defaultServer) {
    return { server: defaultServer };
  }
  return null;
};

const appendRunLog = async (run: any, message: string, opts?: { flush?: boolean }) => {
  const timestamped = `[${new Date().toISOString()}] ${message}`;
  const currentLog = typeof run.log === 'string' && run.log.length > 0 ? `${run.log}\n${timestamped}` : timestamped;
  run.log =
    currentLog.length > RUN_LOG_MAX_CHARS
      ? `…[truncated]\n${currentLog.slice(-(RUN_LOG_MAX_CHARS - 16))}`
      : currentLog;

  const pending = ((run as any)._pendingLogWrites || 0) + 1;
  (run as any)._pendingLogWrites = pending;
  if (opts?.flush || pending >= RUN_LOG_FLUSH_EVERY) {
    (run as any)._pendingLogWrites = 0;
    // Persist only the log field when possible to avoid rewriting large output blobs.
    if (typeof run.updateOne === 'function') {
      await run.updateOne({ $set: { log: run.log } });
    } else {
      await run.save();
    }
  }
};

const computeDuration = (startedAt: string) => computeElapsedRunDurationMs(startedAt);

async function markFailed(run: any, errorMessage: string, finalState: 'pending' | 'failed' | 'dead') {
  await appendRunLog(run, errorMessage, { flush: true });
  run.status = finalState;
  run.errorMessage = errorMessage;
  const terminal = finalState === 'failed' || finalState === 'dead';
  run.finishedAt = terminal ? new Date().toISOString() : '';
  run.duration = terminal ? computeDuration(run.startedAt) : null;

  if (terminal) {
    const resolved = resolveFailureReason({
      failureReason: run.failureReason,
      failureReasonSource: run.failureReasonSource,
      errorMessage,
    });
    run.failureReason = resolved.failureReason;
    run.failureReasonSource = resolved.failureReasonSource;
    run.normalizedFailureReason = normalizeFailureReason({
      failureReason: run.failureReason,
      failureReasonSource: run.failureReasonSource,
      errorMessage,
    });
  }

  (run as any)._pendingLogWrites = 0;
  await run.save();
}

function isRunCancelledError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof ScraperJobCancelledError) return true;
  const name = (error as any)?.name;
  if (name === 'ScraperJobCancelledError') return true;
  const message = error instanceof Error ? error.message : String(error);
  return (
    /disappeared during execution/i.test(message) ||
    /disappeared after list extraction/i.test(message) ||
    /Automation .+ not found/i.test(message) ||
    /Run .+ not found/i.test(message) ||
    /Run aborted/i.test(message) ||
    /Automation deleted/i.test(message)
  );
}

/** Throws ScraperJobCancelledError when the run was deleted or aborted mid-flight. */
async function assertRunStillActive(runId: string): Promise<void> {
  const current = await Run.findOne({ runId }).select('status').lean();
  if (!current) {
    throw new ScraperJobCancelledError(runId, 'Run deleted');
  }
  const status = String((current as any).status || '');
  if (status === 'aborted' || status === 'aborting') {
    throw new ScraperJobCancelledError(runId, 'Run aborted');
  }
}

async function forceCleanupJobBrowsers(
  browserId: string | null,
  extractionPoolKey: string | null,
  userId: string,
  reason: string
): Promise<void> {
  logger.log('warn', `Force browser cleanup (${reason}): browserId=${browserId || 'none'} poolKey=${extractionPoolKey || 'none'}`);
  if (extractionPoolKey) {
    await evictBrowserFromPool(extractionPoolKey).catch((error: any) => {
      logger.log('warn', `evictBrowserFromPool failed: ${error?.message || error}`);
    });
  } else {
    // List extraction timed out before pool key was recorded — close every pooled Chromium.
    await closeBrowserReusePool().catch((error: any) => {
      logger.log('warn', `closeBrowserReusePool failed: ${error?.message || error}`);
    });
  }
  if (browserId) {
    await destroyRemoteBrowser(browserId, String(userId)).catch((error: any) => {
      logger.log('warn', `destroyRemoteBrowser failed: ${error?.message || error}`);
    });
  }
  await killUntrackedPlaywrightChromium().catch(() => {});
}

/**
 * Persist list rows, evaluate drift, webhook + socket — shared by browser list
 * extraction and ATS board collection (no Chromium).
 */
async function finalizeExtractedListRows(opts: {
  run: any;
  automation: any;
  userId: string;
  rows: Record<string, any>[];
  extractionMethod: 'ats_board' | 'browser';
  atsProvider?: string;
  zeroRowsHint?: string;
  skipLayoutChangeSuggestion?: boolean;
}): Promise<void> {
  const { run, automation, userId, rows, extractionMethod, atsProvider, zeroRowsHint } = opts;

  run.serializableOutput = {
    ...(run.serializableOutput || {}),
    scrapeList: {
      ...(run.serializableOutput?.scrapeList || {}),
      'Configured List Extraction': rows,
    },
  };
  run.interpreterSettings = {
    ...(run.interpreterSettings || {}),
    extractionMethod,
    ...(atsProvider ? { atsProvider } : {}),
  };

  const driftConfig = loadDriftConfig();
  const saasConfig = getAutomationConfig(automation) as Record<string, any>;
  const previewRows = Array.isArray(saasConfig?.previewRows) ? saasConfig.previewRows : null;
  const { baseline, baselineSource } = await getBaselineForRobot(
    String(run.robotMetaId),
    previewRows,
    String(run.runId)
  );
  const recentFinishedRuns = await fetchRecentFinishedRuns(
    String(run.robotMetaId),
    Math.max(0, driftConfig.escalationStreak - 1),
    String(run.runId)
  );
  const drift = evaluateRunDrift({
    current: rows.length,
    baseline,
    baselineSource,
    recentFinishedRuns,
    config: driftConfig,
  });

  run.rowsExtracted = rows.length;
  run.anomaly = drift.anomaly;
  run.anomalyMeta = drift.anomalyMeta;
  run.status = drift.runStatus;
  run.finishedAt = new Date().toISOString();
  run.duration = computeDuration(run.startedAt);
  run.errorMessage = opts.skipLayoutChangeSuggestion && zeroRowsHint
    ? zeroRowsHint
    : drift.errorMessage;
  if (opts.skipLayoutChangeSuggestion) {
    // Confirmed-empty ATS boards are not selector drift. Do not persist
    // layout_change from the generic "Zero rows extracted…" drift text.
    if (!run.failureReason || run.failureReasonSource === 'suggested') {
      run.failureReason = null;
      run.failureReasonSource = null;
    }
    run.normalizedFailureReason = normalizeFailureReason({
      failureReason: run.failureReason,
      failureReasonSource: run.failureReasonSource,
      errorMessage: null,
    });
  } else {
    const suggested = applyLayoutChangeSuggestion({
      anomaly: drift.anomaly,
      runStatus: drift.runStatus,
      rows: rows.length,
      failureReason: run.failureReason,
      failureReasonSource: run.failureReasonSource,
    });
    run.failureReason = suggested.failureReason;
    run.failureReasonSource = suggested.failureReasonSource;
    run.normalizedFailureReason = normalizeFailureReason({
      failureReason: run.failureReason,
      failureReasonSource: run.failureReasonSource,
      errorMessage: run.errorMessage,
    });
  }
  await run.save();

  await appendRunLog(
    run,
    `List extraction finished with ${rows.length} rows via ${extractionMethod}` +
      `${atsProvider ? ` (${atsProvider})` : ''} (drift=${drift.outcome}, baseline=${baseline ?? 'none'})`,
    { flush: true }
  );
  if (drift.outcome === RunDriftOutcome.ZeroRows) {
    await appendRunLog(
      run,
      zeroRowsHint ||
        'Zero rows usually means the item/field CSS selectors no longer match this page (Amazon Jobs often changes markup), or the list had not rendered yet. Re-record the list on this exact URL in the extension, enable scroll/wait if needed, and check the run screenshot for a consent or anti-bot page.',
      { flush: true }
    );
  }

  const refreshedRun = await Run.findOne({ runId: run.runId });
  if (!refreshedRun) {
    throw new ScraperJobCancelledError(String(run.runId), 'Run disappeared after list extraction');
  }
  if (refreshedRun.status === 'aborted' || refreshedRun.status === 'aborting') {
    throw new ScraperJobCancelledError(String(run.runId), 'Run aborted');
  }

  const persistedRows = await persistExtractedDataForRun(refreshedRun, automation);
  if (drift.shouldWebhook || drift.runStatus === 'completed') {
    await dispatchAutomationWebhook(refreshedRun, automation, persistedRows);
  }

  const emitStatus =
    drift.runStatus === 'failed' ? 'failed' : drift.anomaly ? 'anomaly' : 'success';
  await emitQueuedRunEvent(userId, 'run-completed', {
    runId: run.runId,
    robotMetaId: run.robotMetaId,
    robotName: automation.recording_meta.name,
    status: emitStatus,
    finishedAt: refreshedRun.finishedAt,
    anomaly: drift.anomaly,
    escalated: Boolean(drift.anomalyMeta?.escalated),
    rowsExtracted: rows.length,
    extractionMethod,
    atsProvider: atsProvider || null,
  });

  if (drift.skipRetry) {
    throw new RunDriftError({
      runId: String(run.runId),
      outcome: drift.outcome,
      anomaly: drift.anomaly,
      anomalyMeta: drift.anomalyMeta,
      message: drift.errorMessage || `Run drift: ${drift.outcome}`,
    });
  }
}

/**
 * Prefer public ATS board JSON when the start URL is Greenhouse / Lever / Ashby /
 * SmartRecruiters / Findly (m-cloud) / SuccessFactors RMK / Oracle Cloud CE /
 * Bank of America careers search. Returns true when collection finished without
 * Chromium.
 */
async function tryAtsBoardCollection(
  run: any,
  automation: any,
  userId: string,
  config: Record<string, any>,
  listStartUrl?: string
): Promise<boolean> {
  const saasConfig = getAutomationConfig(automation) as Record<string, any>;
  // Only an explicit `false` disables ATS. Treat missing/undefined as enabled.
  const preferAts =
    saasConfig?.preferAtsCollection !== false && config?.preferAtsCollection !== false;
  if (!preferAts) {
    await appendRunLog(
      run,
      'ATS board collection skipped (preferAtsCollection=false); using browser extraction',
      { flush: true }
    );
    return false;
  }

  const startUrl = String(listStartUrl || automation?.recording_meta?.url || '').trim();
  if (!startUrl) {
    await appendRunLog(run, 'ATS board collection skipped (automation has no URL)', { flush: true });
    return false;
  }

  if (
    !startUrlHasCollectionFilters(startUrl) &&
    !looksLikeWorkdayBoard(startUrl) &&
    !looksLikePhenomBoard(startUrl) &&
    !looksLikeFindlyBoard(startUrl) &&
    !isJibeCareerHost(startUrl) &&
    !looksLikeWayfairCareersBoard(startUrl) &&
    !looksLikeTalentBrewBoard(startUrl) &&
    !looksLikeZwayamBoard(startUrl)
  ) {
    await appendRunLog(
      run,
      'ATS board skipped (start URL has no collection filters); using browser extraction',
      { flush: true }
    );
    return false;
  }

  // Phenom / HappyDance / Workday / Greenhouse APIs honor start-URL filters and
  // maxPages. Recorded next-button would only send Chromium into Cloudflare or
  // SPA markup drift (Salesforce marketing careers closes the browser). Keep ATS.
  const skipUiPagination =
    shouldSkipAtsBoardForUiPagination(config) || shouldSkipAtsBoardForUiPagination(saasConfig);
  const paginationMode = String(
    config?.listExtraction?.pagination?.mode ||
      saasConfig?.listExtraction?.pagination?.mode ||
      'next-button'
  ).toLowerCase();
  const skipForUiPagination =
    skipUiPagination &&
    (paginationMode === 'infinite-scroll' || !shouldPreferAtsBoardOverUiPagination(startUrl));
  if (skipForUiPagination) {
    const mode = String(
      config?.listExtraction?.pagination?.mode ||
        saasConfig?.listExtraction?.pagination?.mode ||
        'next-button'
    );
    await appendRunLog(
      run,
      `ATS board collection skipped (${mode} pagination is configured; using browser Load More / Show More clicks)`,
      { flush: true }
    );
    return false;
  }

  const detected = detectAtsBoard(startUrl);
  if (!detected) {
    await appendRunLog(
      run,
      `No ATS board provider matched for ${startUrl}; using browser extraction`,
      { flush: true }
    );
    return false;
  }

  const maxPagesRaw =
    config?.listExtraction?.pagination?.maxPages ??
    saasConfig?.listExtraction?.pagination?.maxPages;
  const maxPages =
    typeof maxPagesRaw === 'number' && maxPagesRaw > 0 ? Math.floor(maxPagesRaw) : undefined;
  const maxItemsRaw =
    config?.listExtraction?.maxItems ?? saasConfig?.listExtraction?.maxItems;
  const maxItems =
    typeof maxItemsRaw === 'number' && maxItemsRaw > 0 ? Math.floor(maxItemsRaw) : undefined;
  const fetchOpts: { maxPages?: number; maxItems?: number } = {
    ...(maxPages ? { maxPages } : {}),
    ...(maxItems ? { maxItems } : {}),
  };

  await appendRunLog(
    run,
    `ATS board detected (${detected.provider}/${detected.companyHint}); fetching public job list without Chromium` +
      `${maxPages ? ` (maxPages=${maxPages} from robot config)` : ''}` +
      `${maxItems ? ` (maxItems=${maxItems})` : ''}…`,
    { flush: true }
  );

  let board: Awaited<ReturnType<typeof fetchAtsBoardJobs>> = null;
  try {
    board = await fetchAtsBoardJobs(
      startUrl,
      Object.keys(fetchOpts).length ? fetchOpts : undefined
    );
  } catch (fetchErr: any) {
    const skipBrowserForWorkday =
      detected.provider === 'workday' && looksLikeWorkdayBoard(startUrl);
    await appendRunLog(
      run,
      skipBrowserForWorkday
        ? `ATS board fetch threw for workday: ${fetchErr?.message || fetchErr}; skipping browser fallback (Workday SPA closes Chromium)`
        : detected.provider === 'phenom'
          ? `ATS board fetch threw for phenom: ${fetchErr?.message || fetchErr}; falling back to browser (keeping filtered start URL)`
          : `ATS board fetch threw for ${detected.provider}: ${fetchErr?.message || fetchErr}; falling back to browser`,
      { flush: true }
    );
    if (skipBrowserForWorkday) {
      await finalizeExtractedListRows({
        run,
        automation,
        userId,
        rows: [],
        extractionMethod: 'ats_board',
        atsProvider: detected.provider,
        skipLayoutChangeSuggestion: true,
        zeroRowsHint: `ATS board API for workday failed: ${fetchErr?.message || fetchErr}`,
      });
      return true;
    }
    return false;
  }

  if (!board || !board.rows.length) {
    const skipBrowserForWorkday =
      detected.provider === 'workday' && looksLikeWorkdayBoard(startUrl);
    if (board?.confirmedEmpty || skipBrowserForWorkday) {
      await appendRunLog(
        run,
        `ATS board fetch confirmed 0 jobs for ${detected.provider}/${detected.companyHint}; skipping browser fallback`,
        { flush: true }
      );
      await finalizeExtractedListRows({
        run,
        automation,
        userId,
        rows: [],
        extractionMethod: 'ats_board',
        atsProvider: board?.provider || detected.provider,
        skipLayoutChangeSuggestion: true,
        zeroRowsHint: `ATS board API for ${detected.provider} returned zero jobs (empty board or site maintenance). Browser extraction would not recover rows.`,
      });
      return true;
    }
    await appendRunLog(
      run,
      detected.provider === 'phenom'
        ? `ATS board fetch returned no rows for phenom; falling back to browser extraction (keeping filtered start URL)`
        : `ATS board fetch returned no rows for ${detected.provider}; falling back to browser extraction`,
      { flush: true }
    );
    return false;
  }

  const persistRows =
    typeof maxItems === 'number' && maxItems > 0 ? board.rows.slice(0, maxItems) : board.rows;
  if (!persistRows.length) {
    await appendRunLog(
      run,
      `ATS board fetch returned no rows for ${detected.provider}; falling back to browser extraction`,
      { flush: true }
    );
    return false;
  }

  await finalizeExtractedListRows({
    run,
    automation,
    userId,
    rows: persistRows,
    extractionMethod: 'ats_board',
    atsProvider: board.provider,
    zeroRowsHint: `ATS board API for ${board.provider} returned zero jobs.`,
  });

  return true;
}

async function processConfiguredListExtraction(
  run: any,
  automation: any,
  userId: string,
  config: Record<string, any>,
  identityProfile: Record<string, any>,
  options?: {
    isolatedBrowserKey?: string;
    blockResources?: boolean;
    onPoolKey?: (poolKey: string) => void;
    listStartUrl?: string;
    linkedInHandle?: LinkedInAggregatorRunHandle | null;
  }
): Promise<{ poolKey: string }> {
  const lease = await acquirePooledPage({
    profile: {
      ...identityProfile,
      poolIsolationKey: options?.isolatedBrowserKey,
    },
    maxPagesPerBrowser: config?.performance?.maxPagesPerBrowser || getDefaultMaxPagesPerBrowser(),
    blockResources: options?.blockResources ?? (config?.performance?.blockResources !== false),
  });
  const poolKey = lease.key;
  options?.onPoolKey?.(poolKey);
  const page = lease.page;

  const listStartUrl = String(
    options?.listStartUrl || automation?.recording_meta?.url || ''
  ).trim();

  try {
    await appendRunLog(
      run,
      `Starting configured list extraction on ${safeOutboundUrlLogLabel(listStartUrl)}`,
      { flush: true }
    );
    await applyAutomationRuntimeConfig(page, automation);

    if (options?.linkedInHandle) {
      await appendRunLog(
        run,
        `LinkedIn account pool: using account ${options.linkedInHandle.lease.accountId}`,
        { flush: true }
      );
      await ensureLinkedInAggregatorSessionOnPage(
        page,
        options.linkedInHandle,
        listStartUrl
      );
      await persistLinkedInAccountSession(page, options.linkedInHandle.lease.accountId);
    }

    if (await detectCloudflareChallenge(page)) {
      await appendRunLog(run, 'Cloudflare challenge detected before extraction. Waiting for verification to complete...');
      const challengeCleared = await waitForCloudflareToClear(page, {
        timeoutMs: config?.cloudflareWaitTimeoutMs || CLOUDFLARE_WAIT_MS,
        pollMs: config?.cloudflarePollIntervalMs || 2_000,
      });
      if (!challengeCleared) {
        throw new Error('Cloudflare challenge did not clear before extraction');
      }
      await appendRunLog(run, 'Cloudflare challenge cleared. Continuing extraction.');
    }

    const amazonChallenge = await detectAmazonChallengeAndWait(page, {
      timeoutMs: config?.amazonChallengeWaitTimeoutMs || AMAZON_WAIT_MS,
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
      timeoutMs: config?.microsoftChallengeWaitTimeoutMs || MICROSOFT_WAIT_MS,
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

    const extractionResult = await runListExtraction(page, listStartUrl, extractionConfig);
    let rows = Array.isArray(extractionResult?.rows) ? extractionResult.rows : [];
    const promotions = Array.isArray(extractionResult?.selectorPromotions)
      ? extractionResult.selectorPromotions
      : [];
    if (config?.captcha?.pauseOnDetect !== false && (await detectCaptcha(page))) {
      throw new CaptchaEncounteredError(
        { present: true, kind: 'text-marker', evidence: 'post-extraction body text' },
        page.url() || ''
      );
    }

    if (shouldEnrichHiringCafeDetails(automation) && rows.length > 0) {
      const cap =
        typeof extractionConfig.maxItems === 'number' && extractionConfig.maxItems > 0
          ? extractionConfig.maxItems
          : 40;
      rows = (await enrichHiringCafeListRows(page, rows, {
        maxJobs: cap,
        onLog: (message) => appendRunLog(run, message, { flush: true }),
      })) as Record<string, any>[];
    }

    if (shouldEnrichAccelDetails(automation) && rows.length > 0) {
      const cap =
        typeof extractionConfig.maxItems === 'number' && extractionConfig.maxItems > 0
          ? extractionConfig.maxItems
          : 40;
      rows = (await enrichAccelListRows(page, rows, {
        maxJobs: cap,
        onLog: (message) => appendRunLog(run, message, { flush: true }),
      })) as Record<string, any>[];
    }

    if (shouldEnrichConsiderDetails(automation) && rows.length > 0) {
      const cap =
        typeof extractionConfig.maxItems === 'number' && extractionConfig.maxItems > 0
          ? extractionConfig.maxItems
          : 40;
      const label = shouldEnrichCapitalGDetails(automation) ? 'CapitalG' : 'Sequoia';
      rows = (await enrichConsiderListRows(page, rows, {
        maxJobs: cap,
        label,
        onLog: (message) => appendRunLog(run, message, { flush: true }),
      })) as Record<string, any>[];
    }

    if (shouldEnrichChoppingBlockDetails(automation) && rows.length > 0) {
      const cap =
        typeof extractionConfig.maxItems === 'number' && extractionConfig.maxItems > 0
          ? extractionConfig.maxItems
          : 40;
      rows = (await enrichChoppingBlockListRows(page, rows, {
        maxJobs: cap,
        onLog: (message) => appendRunLog(run, message, { flush: true }),
      })) as Record<string, any>[];
    }

    if (shouldEnrichAidevboardDetails(automation) && rows.length > 0) {
      const cap =
        typeof extractionConfig.maxItems === 'number' && extractionConfig.maxItems > 0
          ? extractionConfig.maxItems
          : 40;
      rows = (await enrichAidevboardListRows(page, rows, {
        maxJobs: cap,
        onLog: (message) => appendRunLog(run, message, { flush: true }),
      })) as Record<string, any>[];
    }

    if (promotions.length > 0) {
      try {
        const robot = await Robot.findOne({ 'recording_meta.id': run.robotMetaId });
        if (robot) {
          const prevSaas = getAutomationConfig(robot) as Record<string, any>;
          const prevList = (prevSaas?.listExtraction || {}) as Record<string, any>;
          const nextFields = applySelectorPromotions(prevList.fields || extractionConfig.fields || {}, promotions);
          const nextItemSelector =
            extractionResult.winningItemSelector ||
            primaryItemSelector(prevList.itemSelector || extractionConfig.itemSelector);
          const nextList = {
            ...prevList,
            fields: nextFields,
            itemSelector: nextItemSelector,
          };
          (robot.recording_meta as any).saasConfig = {
            ...prevSaas,
            listExtraction: nextList,
          };
          robot.markModified('recording_meta');
          await robot.save();
          await appendRunLog(
            run,
            `Promoted ranked selectors: ${promotions.map((p) => `${p.field}→${p.to}`).join(', ')}`,
            { flush: true }
          );
        }
      } catch (promoErr: any) {
        logger.log('warn', `Selector promotion persist failed: ${promoErr?.message || promoErr}`);
      }
    }

    await finalizeExtractedListRows({
      run,
      automation,
      userId,
      rows,
      extractionMethod: 'browser',
    });

    return { poolKey };
  } catch (error) {
    // Sick navigation / anti-bot / extraction failure — retire whole Chromium.
    // Drift is selector/content signal, not a broken browser process.
    if (!(error instanceof RunDriftError)) {
      await evictBrowserFromPool(poolKey).catch(() => {});
    }
    throw error;
  } finally {
    // Always release so activePages decrements even if the page was already closed.
    await releasePooledPage(lease).catch(() => {});
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

const PROXY_TUNNEL_RETRY_DELAY_MS = 5_000;

async function markRobotNeedsProxy(automationId: string): Promise<void> {
  try {
    const now = new Date().toISOString();
    await Robot.updateOne(
      { 'recording_meta.id': automationId },
      {
        $set: {
          'recording_meta.saasConfig.browserLocation.needsProxy': true,
          'recording_meta.saasConfig.browserLocation.needsProxyAt': now,
        },
      }
    );
  } catch (error: any) {
    logger.log(
      'warn',
      `Failed to persist needsProxy for automation ${automationId}: ${error?.message || error}`
    );
  }
}

/** True when UI/robot pool or enabled env proxy can be used for last-resort attach. */
async function canUseLastResortProxy(
  userId: string,
  config: Record<string, any>
): Promise<boolean> {
  const proxyPool = await resolveProxyPool(String(userId), config);
  return hasConfiguredLastResortProxy({
    robotProxyAvailable: proxyPool.length > 0,
    envProxyAvailable: !!getEnvFallbackProxy(),
  });
}

async function buildIdentityProfile(
  userId: string,
  automationId: string,
  config: Record<string, any>,
  attemptsMade: number,
  opts?: {
    failedProxyServers?: string[];
    lastFailureWasProxyTunnel?: boolean;
    retryReason?: ScraperRetryReason;
    storageStatePathOverride?: string;
  }
) {
  let failedProxyServers = normalizeFailedProxyServers(opts?.failedProxyServers);
  const needsProxy = !!config?.browserLocation?.needsProxy;
  const retryReason = opts?.retryReason;
  const proxyAllowed = isProxyAllowedForAttempt({
    attemptsMade,
    needsProxy,
    retryReason,
  });

  const proxyPool = await resolveProxyPool(String(userId), config);
  const envFallbackCandidate = getEnvFallbackProxy();
  const proxyConfigured = hasConfiguredLastResortProxy({
    robotProxyAvailable: proxyPool.length > 0,
    envProxyAvailable: !!envFallbackCandidate,
  });
  // Escalate intent without credentials → normal direct path (no spend, no tunnel burns).
  const attachProxy = proxyAllowed && proxyConfigured;

  // Resolve candidates only when last-resort proxy spend is allowed and configured.
  let selectedProxy = attachProxy
    ? selectRotatedProxy(proxyPool, attemptsMade, failedProxyServers)
    : null;
  const userAgent = config?.userAgent || selectRotatedUserAgent(attemptsMade, config?.userAgentPool);
  const shouldReuseSession = config?.reuseSession !== false;
  const targetUrl = config?.targetUrl;
  const antiBotTarget = isAntiBotTarget(targetUrl);
  const storageStatePath =
    opts?.storageStatePathOverride ||
    (shouldReuseSession && (await sessionStateExists(String(userId), automationId))
      ? await getSessionStatePath(String(userId), automationId)
      : undefined);

  let browserType = config?.browserType;
  let headless = config?.headless !== false;
  let useStealth = config?.useStealth !== false;
  let identityStrategy = antiBotTarget ? 'baseline-antibot' : 'baseline';
  if (attachProxy && attemptsMade === 0) {
    identityStrategy = antiBotTarget ? 'baseline-antibot-proxy' : 'baseline-proxy';
  }
  let poolIsolationKey: string | undefined;
  const disableHttp2 = shouldDisableChromiumHttp2(targetUrl);
  const envFallbackProxyRaw = attachProxy ? envFallbackCandidate : null;
  const sidecarProxyServer = normalizeProxyServer(process.env.CAMOUFOX_PROXY_SERVER);
  let sidecarProxyReachable: boolean | undefined;

  // Probe any last-resort HTTP proxy before attach — including attempt 0 when
  // needsProxy is remembered. A dead CAMOUFOX_PROXY used to fail goto in ~4s.
  const proxyToProbe =
    (selectedProxy?.server && !failedProxyServers.includes(normalizeProxyServer(selectedProxy.server) || ''))
      ? selectedProxy.server
      : sidecarProxyServer || envFallbackProxyRaw?.server;
  if (attachProxy && proxyToProbe && !failedProxyServers.includes(normalizeProxyServer(proxyToProbe) || '')) {
    sidecarProxyReachable = await probeProxyHttpConnect(proxyToProbe, 2500, {
      connectHost: hostnameFromUrl(targetUrl) || undefined,
    });
    if (!sidecarProxyReachable) {
      failedProxyServers = rememberFailedProxy(failedProxyServers, proxyToProbe);
      logger.log(
        'warn',
        `Last-resort proxy ${proxyToProbe} failed CONNECT probe; continuing without it`
      );
      selectedProxy = attachProxy
        ? selectRotatedProxy(proxyPool, attemptsMade, failedProxyServers)
        : null;
    }
  }

  const envFallbackProxy =
    envFallbackProxyRaw &&
    !failedProxyServers.includes(normalizeProxyServer(envFallbackProxyRaw.server) || '')
      ? envFallbackProxyRaw
      : null;

  let retryPlan = null;
  if (retryReason === 'captcha') {
    retryPlan = captchaRetryIdentity({
      attemptsMade,
      selectedProxy,
      envFallbackProxy,
      configBrowserType: config?.browserType,
      failedProxyServers,
    });
  } else if (retryReason === 'block') {
    retryPlan = blockRetryIdentity({
      attemptsMade,
      selectedProxy,
      envFallbackProxy,
      configBrowserType: config?.browserType,
      failedProxyServers,
      sidecarProxyServer: attachProxy ? sidecarProxyServer : null,
      sidecarProxyReachable: attachProxy ? sidecarProxyReachable : undefined,
      lastFailureWasProxyTunnel: !!opts?.lastFailureWasProxyTunnel,
    });
  } else if (retryReason === 'proxy-tunnel' || opts?.lastFailureWasProxyTunnel) {
    // Drop the dead tunnel; do not attach a fresh env proxy unless needsProxy
    // still allows a different pool entry.
    retryPlan = blockRetryIdentity({
      attemptsMade,
      selectedProxy,
      envFallbackProxy,
      configBrowserType: config?.browserType,
      failedProxyServers,
      sidecarProxyServer: attachProxy ? sidecarProxyServer : null,
      sidecarProxyReachable: attachProxy ? sidecarProxyReachable : undefined,
      lastFailureWasProxyTunnel: true,
    });
  }
  // retryReason === 'network': keep baseline identity, no proxy escalate.

  if (retryPlan) {
    browserType = retryPlan.browserType;
    headless = retryPlan.headless;
    useStealth = retryPlan.useStealth;
    identityStrategy = retryPlan.identityStrategy;
    poolIsolationKey = retryPlan.poolIsolationKey;
    selectedProxy = retryPlan.proxy;
  } else if (attachProxy && !selectedProxy && envFallbackProxy) {
    selectedProxy = envFallbackProxy;
  }

  if (!retryPlan && attachProxy && !selectedProxy) {
    identityStrategy = antiBotTarget ? 'baseline-antibot' : 'baseline';
  }

  // No UI/env proxy configured — keep / restore normal direct approach.
  if (proxyAllowed && !proxyConfigured) {
    selectedProxy = null;
    if (!retryPlan) {
      identityStrategy = antiBotTarget ? 'baseline-antibot' : 'baseline';
      browserType = config?.browserType;
    }
  }

  // Known Chromium HTTP/2 breakage (e.g. Persistent): force HTTP/1.1 from attempt 0
  // and isolate the pool entry so other robots keep default HTTP/2.
  if (disableHttp2) {
    poolIsolationKey = poolIsolationKey
      ? `${poolIsolationKey}|no-http2`
      : 'chromium-no-http2';
    if (
      identityStrategy === 'baseline' ||
      identityStrategy === 'baseline-antibot' ||
      identityStrategy === 'baseline-proxy' ||
      identityStrategy === 'baseline-antibot-proxy'
    ) {
      identityStrategy = `${identityStrategy}-no-http2`;
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
    poolIsolationKey,
    disableHttp2,
    failedProxyServers,
    proxyConfigured,
    proxyAllowed,
  };
}

async function processScraperJob(job: AgendaJob<ScraperJobData>) {
  await runScraperJobPayload(
    {
      ...job.attrs.data,
      queueJobId: job.attrs._id?.toString() || 'unknown',
    } as ScraperJobData & { queueJobId?: string },
    { agendaJob: job }
  );
}

/**
 * Core scrape execution (in-process or inside scrapeJobChild).
 * Does not fork — the Agenda supervisor decides isolation.
 */
export async function runScraperJobPayload(
  data: ScraperJobData & { queueJobId?: string },
  options?: { agendaJob?: AgendaJob<ScraperJobData> }
): Promise<void> {
  const { automationId, runId, userId, config: queuedConfig } = data;
  logger.log('info', `Processing scraper job: runId=${runId}, automationId=${automationId}`);
  const attemptsMade = data._attemptsMade || 0;
  let failedProxyServers = normalizeFailedProxyServers(data._failedProxyServers);
  let identityProfile: Omit<
    Awaited<ReturnType<typeof buildIdentityProfile>>,
    'failedProxyServers' | 'proxyConfigured' | 'proxyAllowed'
  > | null = null;
  const queueJobId = data.queueJobId || 'unknown';
  const agendaJob = options?.agendaJob;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  let cancelReason: string | null = null;

  const stopHeartbeat = () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  const throwIfCancelled = () => {
    if (cancelReason) {
      throw new ScraperJobCancelledError(runId, cancelReason);
    }
  };

  const beatOnce = async () => {
    try {
      await assertRunStillActive(runId);
      const iso = new Date().toISOString();
      await Run.updateOne({ runId }, { $set: { heartbeatAt: iso } });
      if (agendaJob?.attrs) {
        agendaJob.attrs.lockedAt = new Date();
        // Persist lock touch when Agenda exposes save on the job handle.
        if (typeof (agendaJob as any).save === 'function') {
          await (agendaJob as any).save().catch(() => {});
        }
      }
    } catch (err: any) {
      if (isRunCancelledError(err)) {
        cancelReason = err instanceof Error ? err.message : String(err);
        logger.log('info', `Scrape heartbeat detected cancel for ${runId}: ${cancelReason}`);
        return;
      }
      logger.log('warn', `Scrape heartbeat failed for ${runId}: ${err?.message || err}`);
    }
  };

  const startHeartbeat = () => {
    stopHeartbeat();
    const ms = getScrapeHeartbeatMs();
    void beatOnce();
    heartbeatTimer = setInterval(() => {
      void beatOnce();
    }, ms);
    if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();
  };

  const run = await Run.findOne({ runId });

  if (!run) {
    throw new ScraperJobCancelledError(runId, 'Run not found');
  }

  if (isTerminalRunStatus(run.status)) {
    await appendRunLog(
      run,
      `Skipping duplicate Agenda job ${queueJobId}; run is already terminal (${run.status})`,
      { flush: true }
    );
    logger.log(
      'info',
      `Skipping duplicate scraper job: runId=${runId} status=${run.status} queueJobId=${queueJobId}`
    );
    return;
  }

  const automation: any = await Robot.findOne({
    'recording_meta.id': automationId,
  }).lean();

  if (!automation) {
    // Robot gone (deleted mid-queue) — do not markFailed if run is about to be deleted too.
    try {
      await markFailed(run, `Automation ${automationId} not found`, 'failed');
    } catch {
      /* run may already be deleted */
    }
    throw new ScraperJobCancelledError(runId, `Automation ${automationId} not found`);
  }
  const config = resolveAutomationExecutionConfig(automation, queuedConfig);
  const retryConfig = toOperationalRunConfig(config);
  const aggregatorRun = isAggregatorRobot(automation);
  const listMaxItems =
    typeof config?.listExtraction?.maxItems === 'number' && config.listExtraction.maxItems > 0
      ? config.listExtraction.maxItems
      : 40;
  const executionTimeoutMs = resolveExecutionTimeoutMs(aggregatorRun, listMaxItems);

  const requeueRun = async (
    payload: Parameters<typeof requeueScraperRun>[0],
    opts?: Parameters<typeof requeueScraperRun>[1]
  ) => {
    if (aggregatorRun) {
      await requeueAggregatorRun(payload, opts);
    } else {
      await requeueScraperRun(payload, opts);
    }
  };

  if (run.status === 'aborted' || run.status === 'aborting') {
    throw new ScraperJobCancelledError(runId, 'Run aborted');
  }

  const targetHost = hostnameFromUrl(automation?.recording_meta?.url);
  let browserId: string | null = null;
  let extractionPoolKey: string | null = null;
  let linkedInHandle: LinkedInAggregatorRunHandle | null = null;
  let linkedInHandleReleased = false;

  const releaseLinkedInHandle = async (
    outcome: 'ok' | 'blocked' | 'released',
    errorMessage?: string
  ) => {
    if (!linkedInHandle || linkedInHandleReleased) return;
    linkedInHandleReleased = true;
    try {
      await finishLinkedInAggregatorRun(linkedInHandle, outcome, errorMessage);
    } catch (releaseErr: any) {
      logger.log(
        'warn',
        `LinkedIn account pool release failed for run ${runId}: ${releaseErr?.message || releaseErr}`
      );
    }
  };

  // Park without burning attempts when this host's circuit is open.
  if (targetHost) {
    const breaker = getHostBreaker(targetHost);
    if (breaker.isOpen()) {
      const parkMs = breaker.remainingMs() + Math.floor(Math.random() * 5_000);
      const parkSec = Math.round(parkMs / 1000);
      run.status = 'pending';
      run.errorMessage = `Host circuit open for ${targetHost}; parked ${parkSec}s`;
      run.finishedAt = '';
      run.duration = null;
      await run.save();
      await appendRunLog(
        run,
        `Host circuit OPEN for ${targetHost}; parked ${parkSec}s (attempt unchanged ${attemptsMade + 1}/${MAX_ATTEMPTS})`,
        { flush: true }
      );
      await requeueRun(
        {
          automationId,
          runId,
          userId: String(userId),
          config: retryConfig,
          _attemptsMade: attemptsMade,
          _failedProxyServers: failedProxyServers,
          _lastFailureWasProxyTunnel: data._lastFailureWasProxyTunnel,
          _retryReason: data._retryReason,
        },
        { force: true, delayMs: parkMs }
      );
      return;
    }
  }

  try {
    await assertSafeOutboundUrl(String(automation?.recording_meta?.url || ''));
    run.status = 'running';
    run.queueJobId = queueJobId;
    run.retryCount = attemptsMade;
    run.errorMessage = null;
    run.interpreterSettings = {
      ...(run.interpreterSettings || {}),
      runtimeConfig: retryConfig,
    };
    await run.save();
    startHeartbeat();
    throwIfCancelled();

    await emitQueuedRunEvent(String(userId), 'run-started', {
      runId: run.runId,
      robotMetaId: run.robotMetaId,
      robotName: automation.recording_meta.name,
      status: 'running',
      startedAt: new Date().toISOString(),
    });

    await appendRunLog(run, `Dequeued Agenda job ${queueJobId} (attempt ${attemptsMade + 1}/${MAX_ATTEMPTS})`);

    const hasConfiguredListExtraction =
      !!primaryItemSelector(config?.listExtraction?.itemSelector) &&
      config?.listExtraction?.fields &&
      Object.keys(config.listExtraction.fields).length > 0;

    // Smart extraction: if this automation has no workflow pairs (just a URL)
    // and no configured selectors, use the smart auto-discovery path
    const isUrlOnlyAutomation =
      !hasConfiguredListExtraction &&
      automation.recording_meta?.url &&
      (!automation.recording?.workflow || automation.recording.workflow.length <= 1);

    const useListExtraction = hasConfiguredListExtraction || isUrlOnlyAutomation;

    const listStartResolved = resolveAtsBoardStartUrl(
      String(automation?.recording_meta?.url || '').trim()
    );
    const listStartUrl = listStartResolved.url;
    if (listStartResolved.adjusted) {
      await appendRunLog(
        run,
        `${listStartResolved.reason} → ${safeOutboundUrlLogLabel(listStartUrl)} (recorded URL unchanged in robot)`,
        { flush: true }
      );
    }

    // Phase 2: ATS board JSON before identity/proxy/Chromium.
    if (useListExtraction) {
      try {
        const atsDone = await tryAtsBoardCollection(
          run,
          automation,
          String(userId),
          config || {},
          listStartUrl
        );
        if (atsDone) {
          if (targetHost) recordHostSuccess(targetHost);
          return;
        }
      } catch (atsError: any) {
        if (atsError instanceof RunDriftError) {
          throw atsError;
        }
        await appendRunLog(
          run,
          `ATS board collection failed (${atsError?.message || atsError}); falling back to browser`,
          { flush: true }
        );
      }
    }

    // LinkedIn without cookies/session → login wall + long ZeroRows. Fail fast.
    const linkedInAggregator = isLinkedInAggregatorRobot(automation);
    const linkedInPoolReady = linkedInPoolCanAuthenticate();

    if (linkedInAggregator && useListExtraction && !linkedInPoolReady) {
      const poolHint =
        'LinkedIn aggregator requires LINKEDIN_ACCOUNT_N_EMAIL and LINKEDIN_ACCOUNT_N_PASSWORD in ENV.';
      await appendRunLog(run, poolHint, { flush: true });
      await finalizeExtractedListRows({
        run,
        automation,
        userId: String(userId),
        rows: [],
        extractionMethod: 'browser',
        skipLayoutChangeSuggestion: true,
        zeroRowsHint: poolHint,
      });
      return;
    }

    if (linkedInAggregator && linkedInPoolReady && useListExtraction) {
      try {
        linkedInHandle = await beginLinkedInAggregatorRun(String(runId));
      } catch (poolErr: any) {
        const poolHint =
          poolErr?.message ||
          'No eligible LinkedIn accounts available (spacing, cooldown, or daily cap).';
        await appendRunLog(run, poolHint, { flush: true });
        await finalizeExtractedListRows({
          run,
          automation,
          userId: String(userId),
          rows: [],
          extractionMethod: 'browser',
          skipLayoutChangeSuggestion: true,
          zeroRowsHint: poolHint,
        });
        return;
      }
    }

    if (useListExtraction) {
      const reuseSession = config?.reuseSession !== false;
      const hasReusableStorageState =
        reuseSession && (await sessionStateExists(String(userId), automationId));
      if (
        shouldFailFastLinkedInWithoutSession({
          url: listStartUrl || automation?.recording_meta?.url,
          cookies: config?.cookies,
          hasReusableStorageState,
          hasLinkedInAccountPool: linkedInAggregator && linkedInPoolReady,
        })
      ) {
        await appendRunLog(run, LINKEDIN_NO_SESSION_HINT, { flush: true });
        await releaseLinkedInHandle('blocked', LINKEDIN_NO_SESSION_HINT);
        await finalizeExtractedListRows({
          run,
          automation,
          userId: String(userId),
          rows: [],
          extractionMethod: 'browser',
          skipLayoutChangeSuggestion: true,
          zeroRowsHint: LINKEDIN_NO_SESSION_HINT,
        });
        return;
      }
    }

    let linkedInStorageStateOverride: string | undefined;
    if (linkedInHandle) {
      linkedInStorageStateOverride = await getLinkedInAggregatorStorageStatePath(linkedInHandle);
    }

    const builtIdentity = await buildIdentityProfile(
      String(userId),
      automationId,
      { ...config, targetUrl: automation?.recording_meta?.url },
      attemptsMade,
      {
        failedProxyServers,
        lastFailureWasProxyTunnel: data._lastFailureWasProxyTunnel,
        retryReason: data._retryReason,
        storageStatePathOverride: linkedInStorageStateOverride,
      }
    );
    const {
      failedProxyServers: probedFailed,
      proxyConfigured,
      proxyAllowed,
      ...selectedIdentity
    } = builtIdentity;
    identityProfile = selectedIdentity;
    failedProxyServers = probedFailed;
    await appendRunLog(
      run,
      `Identity selected: strategy=${selectedIdentity.identityStrategy || 'baseline'}, browser=${selectedIdentity.browserType || 'playwright-default'}, proxy ${selectedIdentity.contextProxy?.server || 'none'}, headless=${selectedIdentity.headless}${selectedIdentity.disableHttp2 ? ', http2=disabled' : ''}`,
      { flush: true }
    );
    if (proxyAllowed && !proxyConfigured) {
      await appendRunLog(
        run,
        'No UI/env proxy configured — continuing with normal direct approach',
        { flush: true }
      );
    }

    if (!useListExtraction) {
      browserId = createRemoteBrowserForRun(String(userId), selectedIdentity);
      run.browserId = browserId;
      await run.save();
      await appendRunLog(run, `Allocated browser ${browserId}`);
    } else {
      const mode = hasConfiguredListExtraction ? 'configured selectors' : 'smart auto-discovery';
      await appendRunLog(run, `Using pooled browser/page for list extraction (${mode})`);
    }

    let executionResult: { poolKey: string } | undefined;

    const rememberPoolKey = (key: string) => {
      extractionPoolKey = key;
    };

    const runConfiguredListExtraction = async (
      identity: typeof selectedIdentity,
      handle: LinkedInAggregatorRunHandle | null,
      extra?: {
        isolatedBrowserKey?: string;
        blockResources?: boolean;
      }
    ) =>
      processConfiguredListExtraction(run, automation, String(userId), config, identity, {
        onPoolKey: rememberPoolKey,
        listStartUrl,
        linkedInHandle: handle,
        ...extra,
      });

    const executionFn = useListExtraction
      ? async () => {
          let activeHandle = linkedInHandle;
          let activeIdentity = selectedIdentity;
          try {
            const result = await runConfiguredListExtraction(activeIdentity, activeHandle);
            executionResult = result;
            extractionPoolKey = result.poolKey;
          } catch (firstError: any) {
            const firstMessage =
              firstError instanceof Error ? firstError.message : String(firstError);

            if (activeHandle && isLinkedInBlockError(firstError)) {
              const rotated = await tryRotateLinkedInAggregatorAccount(
                String(runId),
                activeHandle,
                firstMessage
              );
              if (rotated) {
                linkedInHandle = rotated;
                activeHandle = rotated;
                linkedInHandleReleased = false;
                const rotatedStorage = await getLinkedInAggregatorStorageStatePath(rotated);
                activeIdentity = {
                  ...activeIdentity,
                  storageStatePath: rotatedStorage,
                };
                if (extractionPoolKey) {
                  await evictBrowserFromPool(extractionPoolKey).catch(() => {});
                  extractionPoolKey = null;
                }
                await appendRunLog(
                  run,
                  `LinkedIn account rotated to account ${rotated.lease.accountId} after block`,
                  { flush: true }
                );
                const retryResult = await runConfiguredListExtraction(activeIdentity, activeHandle);
                executionResult = retryResult;
                extractionPoolKey = retryResult.poolKey;
                return;
              }
            }

            if (!isNavigationNetworkFailure(firstMessage)) {
              throw firstError;
            }

            // Same identity through a dead CONNECT tunnel cannot recover. Let the
            // attempt/retry path drop that proxy instead of launching another browser.
            if (isProxyTunnelFailure(firstMessage)) {
              await appendRunLog(
                run,
                'Detected proxy tunnel failure. Skipping isolated-browser fallback; next attempt will drop this proxy.',
                { flush: true }
              );
              throw firstError;
            }

            // A second Chromium on a 512MB host almost always OOM-kills the service.
            // Surface the failure and let the normal attempt/retry path handle it.
            if (isLowMemoryMode()) {
              await appendRunLog(
                run,
                'Detected network-level navigation failure. Skipping isolated-browser fallback (LOW_MEMORY_MODE) to avoid OOM.',
                { flush: true }
              );
              throw firstError;
            }

            await appendRunLog(
              run,
              'Detected network-level navigation failure. Retrying once with an isolated fresh browser context (no pooled reuse, resources unblocked).',
              { flush: true }
            );

            if (extractionPoolKey) {
              await evictBrowserFromPool(extractionPoolKey).catch(() => {});
              extractionPoolKey = null;
            }

            const isolatedKey = `net-fallback-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const fallbackResult = await runConfiguredListExtraction(activeIdentity, activeHandle, {
              isolatedBrowserKey: isolatedKey,
              blockResources: false,
            });
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

    // Child mode: supervisor owns the hard timeout (SIGKILL). In-process keeps Promise.race.
    const childOwnedTimeout = process.env.SCRAPE_JOB_CHILD === '1';
    if (childOwnedTimeout) {
      await executionFn();
    } else {
      let timeoutHandle: NodeJS.Timeout | null = null;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(
          () => reject(new Error(`Scraper job timed out after ${executionTimeoutMs}ms`)),
          executionTimeoutMs
        );
      });

      try {
        await Promise.race([executionFn(), timeoutPromise]);
      } catch (raceError: any) {
        const msg = raceError instanceof Error ? raceError.message : String(raceError);
        if (/timed out after/i.test(msg)) {
          // Promise.race does not cancel executionFn — Chromium keeps scrolling/navigating.
          // Kill pooled / remote browsers immediately so CPU drops.
          await forceCleanupJobBrowsers(browserId, extractionPoolKey, String(userId), msg);
        }
        throw raceError;
      } finally {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      }
    }

    const refreshedRun = await Run.findOne({ runId });
    if (!refreshedRun) {
      throw new ScraperJobCancelledError(runId, 'Run disappeared during execution');
    }
    if (refreshedRun.status === 'aborted' || refreshedRun.status === 'aborting') {
      throw new ScraperJobCancelledError(runId, 'Run aborted');
    }
    throwIfCancelled();

    // Safety net: list extraction must never report success with 0 rows, even if
    // finalize was skipped or an older path marked the run completed early.
    const extractedRows =
      typeof refreshedRun.rowsExtracted === 'number' ? refreshedRun.rowsExtracted : 0;
    const alreadyFailed =
      refreshedRun.status === 'failed' || refreshedRun.status === 'dead';
    if (useListExtraction && extractedRows <= 0 && !alreadyFailed) {
      refreshedRun.rowsExtracted = 0;
      refreshedRun.status = 'failed';
      refreshedRun.anomaly = refreshedRun.anomaly || 'zero_rows';
      refreshedRun.failureReason = refreshedRun.failureReason || 'layout_change';
      refreshedRun.failureReasonSource = refreshedRun.failureReasonSource || 'suggested';
      refreshedRun.errorMessage =
        refreshedRun.errorMessage ||
        'Zero rows extracted and run did not finalize normally. Selectors likely broke, the list did not render, or the target URL filters are wrong.';
      refreshedRun.normalizedFailureReason = normalizeFailureReason({
        failureReason: refreshedRun.failureReason,
        failureReasonSource: refreshedRun.failureReasonSource,
        errorMessage: refreshedRun.errorMessage,
      });
      refreshedRun.finishedAt = refreshedRun.finishedAt || new Date().toISOString();
      refreshedRun.duration = computeDuration(refreshedRun.startedAt);
      await appendRunLog(refreshedRun, refreshedRun.errorMessage, { flush: true });
      await refreshedRun.save();
      throw new RunDriftError({
        runId: String(runId),
        outcome: RunDriftOutcome.ZeroRows,
        anomaly: 'zero_rows',
        anomalyMeta: {
          current: 0,
          baseline: null,
          ratio: null,
          baselineSource: 'none',
          escalated: false,
          threshold: null,
        },
        message: refreshedRun.errorMessage,
      });
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

    await appendRunLog(
      refreshedRun,
      refreshedRun.anomaly
        ? `Agenda job ${queueJobId} finished with anomaly=${refreshedRun.anomaly}`
        : `Agenda job ${queueJobId} completed successfully`,
      { flush: true }
    );

    if (identityProfile?.contextProxy?.server) {
      await markRobotNeedsProxy(automationId);
      await appendRunLog(
        refreshedRun,
        'Remembered needsProxy on this automation (succeeded with last-resort proxy)',
        { flush: true }
      );
    }

    // Preserve drift fields written by list extraction (soft drop keeps errorMessage/anomaly).
    // Map in-flight statuses to completed; never leave a finished job stuck on "running".
    if (
      refreshedRun.status === 'success' ||
      refreshedRun.status === 'running' ||
      refreshedRun.status === 'queued' ||
      refreshedRun.status === 'pending' ||
      !refreshedRun.status
    ) {
      refreshedRun.status = 'completed';
    }
    refreshedRun.duration = computeDuration(refreshedRun.startedAt);
    if (!refreshedRun.anomaly) {
      refreshedRun.errorMessage = null;
    }
    refreshedRun.finishedAt = refreshedRun.finishedAt || new Date().toISOString();
    if (typeof refreshedRun.rowsExtracted !== 'number') {
      refreshedRun.rowsExtracted = 0;
    }
    await refreshedRun.save();

    if (browserId) {
      await destroyRemoteBrowser(browserId, String(userId));
    }

    recordHostSuccess(targetHost);
    await releaseLinkedInHandle('ok');
    return;
  } catch (error: any) {
    const message = error instanceof Error ? error.message : String(error);
    const latestRun = await Run.findOne({ runId });

    if (linkedInHandle) {
      await releaseLinkedInHandle(
        isLinkedInBlockError(error) ? 'blocked' : 'released',
        isLinkedInBlockError(error) ? message : undefined
      );
    }

    if (browserId) {
      try {
        await destroyRemoteBrowser(browserId, String(userId));
      } catch (cleanupError: any) {
        logger.log('warn', `Failed to cleanup browser ${browserId} for run ${runId}: ${cleanupError.message}`);
      }
    }

    // Deleted/aborted automation: free the slot quietly — do not retry or overwrite status.
    if (
      isRunCancelledError(error) ||
      !latestRun ||
      latestRun.status === 'aborted' ||
      latestRun.status === 'aborting'
    ) {
      logger.log('info', `Scraper job cancelled for run ${runId}: ${message}`);
      return;
    }

    // Drift hard-fail already persisted status/anomaly/webhook — do not retry or overwrite.
    const isDrift =
      error instanceof RunDriftError ||
      (error && error.name === 'RunDriftError');
    if (isDrift) {
      logger.log(
        'warn',
        `Run ${runId} terminal drift failure (${(error as RunDriftError).outcome}): ${message}`
      );
      throw error;
    }

    if (latestRun && isHttp2ProtocolNavigationError(error)) {
      const targetUrl = String(automation?.recording_meta?.url || '');
      if (targetUrl) {
        try {
          const probe = await probeHttp11(targetUrl);
          await appendRunLog(latestRun, `HTTP/2 navigation diagnostic: ${probe}`, { flush: true });
        } catch (diagnosticError: any) {
          logger.log(
            'warn',
            `HTTP/2 navigation diagnostic failed for run ${runId}: ${diagnosticError?.message || diagnosticError}`
          );
        }
      }
    }

    // Host pressure: navigation/CAPTCHA/timeout style failures (not config/drift).
    recordHostFailure(targetHost);

    // CAPTCHA: emit captcha:required; retry with backoff when attempts remain.
    const isCaptcha =
      error instanceof CaptchaEncounteredError ||
      (error && error.name === 'CaptchaEncounteredError');

    if (isCaptcha && latestRun) {
      const hasRemainingAttempts = attemptsMade + 1 < MAX_ATTEMPTS;

      try {
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
        await emitQueuedRunEvent(String(userId), 'captcha:required', payload as any);
      } catch (emitError: any) {
        logger.log('warn', `Failed to emit captcha:required for run ${runId}: ${emitError.message}`);
      }

      if (hasRemainingAttempts) {
        const delayMs = computeScrapeRetryDelayMs(attemptsMade);
        const delaySec = Math.round(delayMs / 1000);
        const proxyReady = await canUseLastResortProxy(String(userId), config);
        if (proxyReady) {
          await markRobotNeedsProxy(automationId);
        }
        await appendRunLog(
          latestRun,
          proxyReady
            ? `CAPTCHA encountered — retrying Playwright with residential proxy if configured (${attemptsMade + 2}/${MAX_ATTEMPTS}); Retry scheduled in ${delaySec}s`
            : `CAPTCHA encountered — no UI/env proxy configured; retrying with normal direct approach (${attemptsMade + 2}/${MAX_ATTEMPTS}); Retry scheduled in ${delaySec}s`
        );
        latestRun.status = 'pending';
        latestRun.errorMessage = `CAPTCHA on attempt ${attemptsMade + 1}; retry in ${delaySec}s`;
        latestRun.normalizedFailureReason = normalizeFailureReason({
          failureReason: latestRun.failureReason,
          failureReasonSource: latestRun.failureReasonSource,
          errorMessage: latestRun.errorMessage,
        });
        latestRun.retryCount = attemptsMade + 1;
        latestRun.finishedAt = '';
        latestRun.duration = null;
        await latestRun.save();

        try {
          await requeueRun(
            {
              automationId,
              runId,
              userId: String(userId),
              config: retryConfig,
              _attemptsMade: attemptsMade + 1,
              _failedProxyServers: failedProxyServers,
              _retryReason: 'captcha',
            },
            { force: true, delayMs }
          );
          await appendRunLog(
            latestRun,
            `Re-enqueued for retry ${attemptsMade + 2}/${MAX_ATTEMPTS} in ${delaySec}s`
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
        await markFailed(latestRun, `CAPTCHA encountered — attempts exhausted. ${message}`, 'dead');
        latestRun.retryCount = attemptsMade;
        await latestRun.save();

        try {
          await emitQueuedRunEvent(String(userId), 'run-completed', {
            runId,
            robotMetaId: latestRun.robotMetaId,
            robotName: automation?.recording_meta?.name || 'Unknown Robot',
            status: 'dead',
            finishedAt: new Date().toISOString(),
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

      const escalationKind = classifyProxyEscalation(message);
      const nextRetryReason = retryReasonFromEscalation(escalationKind);
      const tunnelFailure = escalationKind === 'proxyTunnel';
      if (tunnelFailure) {
        failedProxyServers = rememberFailedProxy(
          failedProxyServers,
          identityProfile?.contextProxy?.server
        );
        failedProxyServers = rememberFailedProxy(
          failedProxyServers,
          process.env.CAMOUFOX_PROXY_SERVER
        );
      }
      if (escalationKind === 'blockLike') {
        const proxyReady = await canUseLastResortProxy(String(userId), config);
        if (proxyReady) {
          await markRobotNeedsProxy(automationId);
        } else if (hasRemainingAttempts) {
          await appendRunLog(
            latestRun,
            'Block-like failure but no UI/env proxy configured — next attempt uses normal direct approach'
          );
        }
      }
      const delayMs = hasRemainingAttempts
        ? tunnelFailure
          ? Math.min(computeScrapeRetryDelayMs(attemptsMade), PROXY_TUNNEL_RETRY_DELAY_MS)
          : computeScrapeRetryDelayMs(attemptsMade)
        : 0;
      const delaySec = Math.round(delayMs / 1000);
      const retryHint =
        nextRetryReason === 'block'
          ? `retrying with last-resort proxy if configured in ${delaySec}s`
          : tunnelFailure
            ? `retrying without the failed proxy in ${delaySec}s`
            : `retrying without proxy escalate (${nextRetryReason}) in ${delaySec}s`;
      await markFailed(
        latestRun,
        hasRemainingAttempts
          ? `${message} - ${retryHint}`
          : `Dead letter: attempts exhausted (${MAX_ATTEMPTS}/${MAX_ATTEMPTS}). ${message}`,
        hasRemainingAttempts ? 'pending' : 'dead'
      );
      latestRun.retryCount = attemptsMade + 1;
      await latestRun.save();

      if (hasRemainingAttempts) {
        try {
          await requeueRun(
            {
              automationId,
              runId,
              userId: String(userId),
              config: retryConfig,
              _attemptsMade: attemptsMade + 1,
              _failedProxyServers: failedProxyServers,
              _lastFailureWasProxyTunnel: tunnelFailure,
              _retryReason: nextRetryReason,
            },
            { force: true, delayMs }
          );
          await appendRunLog(
            latestRun,
            `Retry scheduled in ${delaySec}s (attempt ${attemptsMade + 2}/${MAX_ATTEMPTS}, reason=${nextRetryReason})`
          );
        } catch (requeueError: any) {
          logger.log(
            'error',
            `Failed to re-enqueue run ${runId} for retry: ${requeueError.message}`
          );
          await markFailed(
            latestRun,
            `${message} - retry re-enqueue failed: ${requeueError.message}`,
            'dead'
          );
        }
      }

      if (!hasRemainingAttempts) {
        try {
          const robot: any = await Robot.findOne({
            'recording_meta.id': latestRun.robotMetaId,
          }).lean();
          await emitQueuedRunEvent(String(userId), 'run-completed', {
            runId,
            robotMetaId: latestRun.robotMetaId,
            robotName: robot?.recording_meta?.name || 'Unknown Robot',
            status: 'dead',
            finishedAt: new Date().toISOString(),
          });
        } catch (emitError: any) {
          logger.log('warn', `Failed to emit final failure for run ${runId}: ${emitError.message}`);
        }
      }
    }

    throw error;
  } finally {
    stopHeartbeat();
  }
}

let scraperWorkerRegistered = false;
let scraperShuttingDown = false;

export function isScraperShuttingDown(): boolean {
  return scraperShuttingDown;
}

export function setScraperShuttingDown(value: boolean): void {
  scraperShuttingDown = value;
}

export async function startScraperWorker() {
  if (scraperWorkerRegistered) return;
  const agenda = await getAgenda();
  const childIsolation = isChildProcessIsolationEnabled();
  const lockLifetime = computeScraperLockLifetimeMs(EXECUTION_TIMEOUT_MS);
  logger.log(
    'info',
    childIsolation
      ? 'Scraper jobs will run in disposable child processes (hard cancel on timeout)'
      : 'Scraper jobs will run in-process (SCRAPE_JOB_CHILD_PROCESS=false)'
  );
  (agenda as any).define(
    'scraper-jobs',
    { concurrency: SCRAPER_JOB_CONCURRENCY, lockLifetime },
    async (job: AgendaJob<ScraperJobData>) => {
      if (scraperShuttingDown) {
        const id = job.attrs._id?.toString() || 'unknown';
        logger.log('info', `Aborting scraper job ${id} — worker draining (will unlock for reclaim)`);
        throw new Error('Worker draining — job aborted for reclaim');
      }
      try {
        if (isChildProcessIsolationEnabled()) {
          await runScraperJobInChild(
            {
              ...job.attrs.data,
              // queueJobId is optional on payload; child does not need Agenda job id for locks
            },
            { timeoutMs: EXECUTION_TIMEOUT_MS }
          );
        } else {
          await processScraperJob(job);
        }
        logger.log('info', `Scraper job ${job.attrs._id?.toString() || 'unknown'} completed`);
      } catch (error: any) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          error instanceof ScraperJobCancelledError ||
          error?.name === 'ScraperJobCancelledError' ||
          isRunCancelledError(error)
        ) {
          logger.log(
            'info',
            `Scraper job ${job.attrs._id?.toString() || 'unknown'} cancelled: ${message}`
          );
          return;
        }
        if (error instanceof ScraperJobTimeoutError || error?.name === 'ScraperJobTimeoutError') {
          logger.log(
            'error',
            `Scraper job ${job.attrs._id?.toString() || 'unknown'} hard-timed out: ${message}`
          );
        } else {
          logger.log('error', `Scraper job ${job.attrs._id?.toString() || 'unknown'} failed: ${message}`);
        }
        // Re-throw to let Agenda mark the job failed (app retries use requeueScraperRun)
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
  logger.log('info', `Scraper job processor registered with Agenda (lockLifetime=${lockLifetime}ms)`);
}

let aggregatorWorkerRegistered = false;

/** Dedicated processor for Hiring Cafe / aggregator runs — does not share scraper-jobs concurrency. */
export async function startAggregatorWorker() {
  if (aggregatorWorkerRegistered) return;
  const agenda = await getAgenda();
  const {
    AGGREGATOR_JOB_CONCURRENCY,
    AGGREGATOR_JOB_NAME,
  } = await import('../queue/scraperQueue');
  const { defaultAggregatorTimeoutMs } = await import('../services/hiringCafeRuntime');
  const lockLifetime = computeScraperLockLifetimeMs(defaultAggregatorTimeoutMs());
  (agenda as any).define(
    AGGREGATOR_JOB_NAME,
    { concurrency: AGGREGATOR_JOB_CONCURRENCY, lockLifetime },
    async (job: AgendaJob<ScraperJobData>) => {
      if (scraperShuttingDown) {
        throw new Error('Worker draining — job aborted for reclaim');
      }
      try {
        // Aggregators always run in-process list extraction (same processScraperJob path).
        await processScraperJob(job);
        logger.log('info', `Aggregator job ${job.attrs._id?.toString() || 'unknown'} completed`);
      } catch (error: any) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          error instanceof ScraperJobCancelledError ||
          error?.name === 'ScraperJobCancelledError' ||
          isRunCancelledError(error)
        ) {
          logger.log('info', `Aggregator job cancelled: ${message}`);
          return;
        }
        logger.log('error', `Aggregator job failed: ${message}`);
        throw error;
      }
    }
  );
  aggregatorWorkerRegistered = true;
  logger.log(
    'info',
    `Aggregator job processor registered (concurrency=${AGGREGATOR_JOB_CONCURRENCY}, lockLifetime=${lockLifetime}ms)`
  );
}

export async function stopScraperWorker() {
  scraperShuttingDown = true;
  await killAllActiveScrapeChildren();
}

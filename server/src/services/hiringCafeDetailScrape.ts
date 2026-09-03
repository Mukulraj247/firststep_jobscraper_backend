import type { Page } from 'playwright-core';
import {
  extractHiringCafeApplyUrl,
  mergeHiringCafeDetailIntoRow,
  parseHiringCafeJobPageHtml,
  pickHiringCafeJobUrl,
  preferExternalApplyUrl,
  titleFromHiringCafeSlug,
} from './hiringCafeDetail';
import { isHiringCafeUrl } from './aggregatorIdentity';
import {
  enrichHiringCafeRowFromHtml,
  enrichHiringCafeRowFromHtmlWithMethod,
  fetchHiringCafePostingHtml,
  isHiringCafeHtmlJobPage,
  type FetchHiringCafePostingOpts,
} from './hiringCafeHtmlLight';
import type { HiringCafeScrapeDoOptions } from './hiringCafeEnrichmentConfig';
import {
  HIRING_CAFE_DETAIL_BETWEEN_MS,
  HIRING_CAFE_DETAIL_GOTO_MS,
  HIRING_CAFE_DETAIL_RENDER_MS,
} from './hiringCafeRuntime';
import { detectCloudflareChallenge, waitForCloudflareIfPresent } from './unblocker';
import logger from '../logger';

const DEFAULT_MAX_JOBS = 40;

/** Build browser proxy profile from env vars (Decodo / Camoufox). Returns null if not configured. */
function getHiringCafeBrowserProxy(): { server: string; username?: string; password?: string } | null {
  const enabled = /^(true|1|yes|on)$/i.test(String(process.env.SCRAPER_PROXY_ENABLED || '').trim());
  if (!enabled) return null;

  const server = String(process.env.CAMOUFOX_PROXY_SERVER || '').trim();
  const username = String(process.env.CAMOUFOX_PROXY_USERNAME || '').trim();
  const password = String(process.env.CAMOUFOX_PROXY_PASSWORD || '').trim();

  if (server) {
    const hasProtocol = /^https?:\/\//i.test(server);
    const normalizedServer = hasProtocol ? server : `http://${server}`;
    logger.log('info', `Hiring Cafe browser using proxy: ${normalizedServer}`);
    return {
      server: normalizedServer,
      username: username || undefined,
      password: password || undefined,
    };
  }

  const defaultProxy = String(process.env.DEFAULT_PROXY_URL || '').trim();
  if (defaultProxy) {
    const hasProtocol = /^https?:\/\//i.test(defaultProxy);
    const normalizedServer = hasProtocol ? defaultProxy : `http://${defaultProxy}`;
    return { server: normalizedServer };
  }

  return null;
}

/** Titles we get from Cloudflare / empty shells — never treat as real job titles. */
function isGarbageHcDetailTitle(title: string): boolean {
  const t = String(title || '').trim();
  if (!t) return true;
  return /^(?:hiring\s*cafe|hiringcafe(?:\.com)?|just a moment(?:\.\.\.)?|attention required|access denied)$/i.test(
    t
  );
}

async function waitForHiringCafeJobContent(page: Page): Promise<void> {
  const renderMs = Math.max(2000, HIRING_CAFE_DETAIL_RENDER_MS);
  // Do NOT resolve on bare <h1> — Cloudflare challenge pages also have an h1
  // ("Just a moment...") which previously caused ~1–2s false "success".
  await page
    .waitForFunction(
      () => {
        const next = document.getElementById('__NEXT_DATA__');
        const raw = next?.textContent || '';
        if (/"apply_url"\s*:\s*"https?:/i.test(raw)) return true;
        if (/"job_title"\s*:\s*"[^"]{4,}"/i.test(raw) || /"title"\s*:\s*"[^"]{4,}"/i.test(raw)) {
          // Require an actual job payload, not the challenge shell.
          if (/just a moment|cf-browser-verification|challenge-platform/i.test(document.title || '')) {
            return false;
          }
          return /"props"\s*:\s*\{/.test(raw) && /job/i.test(raw);
        }
        return Boolean(document.querySelector('[data-testid="job-page-apply"]'));
      },
      { timeout: renderMs }
    )
    .catch(() => {});
}

/** Read apply_url from live page __NEXT_DATA__ (authoritative for Hiring Cafe). */
async function readApplyUrlFromPage(page: Page): Promise<string> {
  try {
    const raw = await page.evaluate(() => {
      try {
        const data = JSON.parse(document.getElementById('__NEXT_DATA__')?.textContent || '{}');
        const job = data?.props?.pageProps?.job || {};
        return String(job.apply_url || job.applyUrl || '').trim();
      } catch {
        return '';
      }
    });
    return preferExternalApplyUrl(raw);
  } catch {
    return '';
  }
}

/**
 * Fallback: click "Apply directly on employer's site" and capture the popup URL.
 * The control is a <button> with no href — navigation is JS-driven.
 * Only used when light HTML did not include apply_url.
 */
async function resolveApplyUrlByClick(page: Page): Promise<string> {
  const apply = page.locator('[data-testid="job-page-apply"]').first();
  if ((await apply.count().catch(() => 0)) === 0) return '';

  try {
    const popupPromise = page.waitForEvent('popup', { timeout: 8_000 }).catch(() => null);
    await apply.click({ timeout: 5_000 });
    const popup = await popupPromise;
    if (popup) {
      await popup.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => {});
      const url = preferExternalApplyUrl(popup.url());
      await popup.close().catch(() => {});
      return url;
    }
  } catch (err: any) {
    logger.log('warn', `Hiring Cafe apply-button click failed: ${err?.message || err}`);
  }
  return '';
}

/**
 * Browser fallback when light HTTP HTML is missing `__NEXT_DATA__`.
 * Still only opens the Hiring Cafe posting URL — never the employer site for JD content.
 */
async function enrichViaBrowser(
  page: Page,
  row: Record<string, unknown>,
  postingUrl: string
): Promise<{ row: Record<string, unknown>; applyResolved: boolean }> {
  await page.goto(postingUrl, {
    waitUntil: 'domcontentloaded',
    timeout: HIRING_CAFE_DETAIL_GOTO_MS,
  });

  const cfCleared = await waitForCloudflareIfPresent(page, {
    timeoutMs: Math.max(
      60_000,
      parseInt(String(process.env.CLOUDFLARE_WAIT_TIMEOUT_MS || '60000'), 10) || 60_000
    ),
    solveInteractive: true,
  });
  if (!cfCleared || (await detectCloudflareChallenge(page))) {
    throw new Error(`Cloudflare challenge on Hiring Cafe detail ${postingUrl}`);
  }

  await waitForHiringCafeJobContent(page);

  if (await detectCloudflareChallenge(page)) {
    throw new Error(`Cloudflare challenge still active on Hiring Cafe detail ${postingUrl}`);
  }

  const html = await page.content();
  if (!isHiringCafeHtmlJobPage(html) && !/"apply_url"\s*:\s*"https?:/i.test(html)) {
    throw new Error(`Hiring Cafe detail missing job payload for ${postingUrl}`);
  }

  const parsed = parseHiringCafeJobPageHtml(html, postingUrl);

  let applyUrl =
    preferExternalApplyUrl(parsed.applyUrl) ||
    extractHiringCafeApplyUrl(html, postingUrl) ||
    (await readApplyUrlFromPage(page));

  if (!applyUrl) {
    applyUrl = await resolveApplyUrlByClick(page);
  }

  // Reject Cloudflare / shell parses that stamp hostname as the title.
  if (isGarbageHcDetailTitle(String(parsed.jobTitle || ''))) {
    parsed.jobTitle = titleFromHiringCafeSlug(postingUrl);
  }

  const descLen = String(parsed.jobDescription || '').trim().length;
  if (!applyUrl && descLen < 80) {
    throw new Error(
      `Hiring Cafe detail enrich incomplete for ${postingUrl} (no apply URL, descLen=${descLen})`
    );
  }

  const merged = mergeHiringCafeDetailIntoRow(row, { ...parsed, applyUrl }, postingUrl);
  merged.aggregatorPostingUrl = postingUrl;
  merged._enrichMethod = 'browser';
  return {
    row: merged,
    applyResolved: Boolean(applyUrl && !isHiringCafeUrl(applyUrl)),
  };
}

/**
 * Enrich list rows from Hiring Cafe Full View pages.
 * Aggregator runs use browser-only detail (HTTP light is Cloudflare-blocked).
 * Never scrapes employer/apply pages for job content.
 */
export async function enrichHiringCafeListRows(
  page: Page,
  rows: Record<string, unknown>[],
  opts?: {
    maxJobs?: number;
    onLog?: (message: string) => Promise<void> | void;
    /**
     * When true, skip HTTP and use Playwright only.
     * Default false: try cheap HTTP (direct→proxy) first, then browser on this page.
     * Aggregator already holds a Chromium slot — that is the right place for Turnstile.
     */
    browserOnly?: boolean;
    scrapeDo?: HiringCafeScrapeDoOptions | null;
  }
): Promise<Record<string, unknown>[]> {
  const maxJobs = Math.max(1, Math.min(opts?.maxJobs || DEFAULT_MAX_JOBS, 80));
  const browserOnly = opts?.browserOnly === true;
  const seen = new Set<string>();
  let enriched = 0;
  let failed = 0;
  let applyResolved = 0;
  let lightHits = 0;
  let scrapeDoHits = 0;
  let browserHits = 0;
  const fetchOpts: FetchHiringCafePostingOpts = { scrapeDo: opts?.scrapeDo ?? null };
  const out: Record<string, unknown>[] = [];

  for (const row of rows) {
    const postingUrl = pickHiringCafeJobUrl(row);
    if (!postingUrl || seen.has(postingUrl) || seen.size >= maxJobs) {
      out.push(row);
      continue;
    }
    seen.add(postingUrl);
    try {
      let usedBrowser = false;
      if (!browserOnly) {
        const light = await fetchHiringCafePostingHtml(postingUrl, fetchOpts);
        if (light.ok && light.html && isHiringCafeHtmlJobPage(light.html)) {
          const enrichMethod = light.method === 'scrape.do' ? 'scrape_do' : 'http_html';
          const merged = enrichHiringCafeRowFromHtmlWithMethod(
            row,
            light.html,
            postingUrl,
            enrichMethod
          );
          if (light.method === 'scrape.do') {
            merged._scrapeDoCredits = light.creditsSpent ?? 0;
            merged._scrapeDoTier = light.tier ?? 2;
          }
          if (merged.applyUrl && !isHiringCafeUrl(String(merged.applyUrl))) applyResolved += 1;
          out.push(merged);
          enriched += 1;
          if (light.method === 'scrape.do') scrapeDoHits += 1;
          else lightHits += 1;
          if (HIRING_CAFE_DETAIL_BETWEEN_MS > 0) {
            await page.waitForTimeout(HIRING_CAFE_DETAIL_BETWEEN_MS).catch(() => {});
          }
          continue;
        }
      }
      const viaBrowser = await enrichViaBrowser(page, row, postingUrl);
      usedBrowser = true;
      if (viaBrowser.applyResolved) applyResolved += 1;
      out.push(viaBrowser.row);
      enriched += 1;
      if (usedBrowser) browserHits += 1;
    } catch (err: any) {
      failed += 1;
      logger.log(
        'warn',
        `Hiring Cafe detail scrape failed for ${postingUrl}: ${err?.message || err}`
      );
      out.push(
        mergeHiringCafeDetailIntoRow(
          row,
          {
            jobTitle: '',
            applyUrl: '',
          },
          postingUrl
        )
      );
    }
    if (HIRING_CAFE_DETAIL_BETWEEN_MS > 0) {
      await page.waitForTimeout(HIRING_CAFE_DETAIL_BETWEEN_MS).catch(() => {});
    }
  }

  const message =
    `Hiring Cafe detail scrape: ${enriched} enriched (${lightHits} http-html, ${scrapeDoHits} scrape.do, ${browserHits} browser), ` +
    `${applyResolved} employer apply URLs, ${failed} failed`;
  if (opts?.onLog) await opts.onLog(message);
  else logger.log('info', message);
  return out;
}

const HC_ENRICH_BROWSER_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.HIRING_CAFE_ENRICH_BROWSER_CONCURRENCY || '1', 10) || 1
);
/**
 * Enrichment worker must NOT launch Chromium on the 2–3GB droplet — it fights
 * scoutx-scraper / scoutx-aggregators for CHROMIUM_MAX_SLOTS=2 and times out.
 * Browser HC detail belongs in the aggregator process only.
 * Opt-in: HIRING_CAFE_ENRICH_BROWSER_ENABLED=true
 */
function isHcEnrichBrowserEnabled(): boolean {
  const raw = String(process.env.HIRING_CAFE_ENRICH_BROWSER_ENABLED || '').trim().toLowerCase();
  if (raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on') return true;
  if (raw === 'false' || raw === '0' || raw === 'no' || raw === 'off') return false;
  // Default off when scrape.do is disabled or low-memory (production droplet topology).
  if (process.env.LOW_MEMORY_MODE === 'true') return false;
  if (!String(process.env.SCRAPE_DO_TOKEN || '').trim()) return false;
  return false;
}
const HC_ENRICH_BROWSER_SLOT_TIMEOUT_MS = Math.max(
  5_000,
  parseInt(process.env.HIRING_CAFE_ENRICH_BROWSER_SLOT_TIMEOUT_MS || '15000', 10) || 15_000
);
let hcEnrichBrowserActive = 0;
const hcEnrichBrowserWaiters: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];

async function acquireHcEnrichBrowserSlot(): Promise<void> {
  if (hcEnrichBrowserActive < HC_ENRICH_BROWSER_CONCURRENCY) {
    hcEnrichBrowserActive += 1;
    return;
  }
  // Wait for a slot with timeout to prevent indefinite blocking.
  await new Promise<void>((resolve, reject) => {
    const waiter = { resolve, reject };
    const timeoutId = setTimeout(() => {
      const idx = hcEnrichBrowserWaiters.indexOf(waiter);
      if (idx !== -1) hcEnrichBrowserWaiters.splice(idx, 1);
      reject(new Error('HC enrich browser slot acquisition timed out'));
    }, HC_ENRICH_BROWSER_SLOT_TIMEOUT_MS);

    hcEnrichBrowserWaiters.push({
      resolve: () => {
        clearTimeout(timeoutId);
        resolve();
      },
      reject,
    });
  });
}

function releaseHcEnrichBrowserSlot(): void {
  const next = hcEnrichBrowserWaiters.shift();
  if (next) {
    next.resolve();
    return;
  }
  hcEnrichBrowserActive = Math.max(0, hcEnrichBrowserActive - 1);
}

/** Setup SSRF route blocking for HC browser page. */
async function setupHcSsrfRoute(page: Page): Promise<void> {
  await page.route('**/*', async (route) => {
    const reqUrl = route.request().url();
    try {
      const host = new URL(reqUrl).hostname.replace(/^www\./i, '').toLowerCase();
      if (
        host === 'hiringcafe.com' ||
        host === 'hiring.cafe' ||
        host.endsWith('.hiringcafe.com') ||
        host.endsWith('.hiring.cafe') ||
        host === 'cloudflare.com' ||
        host.endsWith('.cloudflare.com') ||
        host === 'cloudflareinsights.com' ||
        host.endsWith('.cloudflareinsights.com')
      ) {
        await route.fallback();
        return;
      }
    } catch {
      /* abort bad URLs */
    }
    await route.abort('blockedbyclient');
  });
}

/** Single browser attempt (direct or proxied). Returns null on failure. */
async function tryBrowserEnrich(
  postingUrl: string,
  listRow: Record<string, unknown>,
  useProxy: boolean
): Promise<Record<string, unknown> | null> {
  const { acquirePooledPage, releasePooledPage } = await import('./browserReusePool');
  const proxyProfile = useProxy ? getHiringCafeBrowserProxy() : null;
  let lease: Awaited<ReturnType<typeof acquirePooledPage>> | null = null;

  try {
    lease = await acquirePooledPage({
      profile: {
        browserType: 'playwright',
        headless: true,
        useStealth: true,
        poolIsolationKey: `hiring-cafe-enrich-browser${useProxy ? '-proxied' : '-direct'}`,
        proxy: proxyProfile,
      },
      maxPagesPerBrowser: HC_ENRICH_BROWSER_CONCURRENCY,
      blockResources: false,
    });
    await setupHcSsrfRoute(lease.page);
    const via = await enrichViaBrowser(lease.page, listRow, postingUrl);
    return via.row;
  } catch (err: any) {
    const isCfBlock =
      /cloudflare/i.test(err?.message || '') || /challenge/i.test(err?.message || '');
    logger.log(
      'warn',
      `HC browser enrich ${useProxy ? 'proxied' : 'direct'} failed: ${postingUrl} - ${err?.message || err}${isCfBlock ? ' (CF block)' : ''}`
    );
    return null;
  } finally {
    await releasePooledPage(lease);
  }
}

/**
 * Enrichment-worker path for one HC posting: Scrape.do when configured (no Chromium).
 * Optional browser only if HIRING_CAFE_ENRICH_BROWSER_ENABLED=true.
 */
export async function enrichHiringCafePostingStandalone(
  postingUrl: string,
  listRow: Record<string, unknown> = {},
  opts?: FetchHiringCafePostingOpts
): Promise<Record<string, unknown> | null> {
  const { isHiringCafeJobPostingUrl } = await import('./hiringCafeDetail');
  if (!isHiringCafeJobPostingUrl(postingUrl)) return null;

  try {
    const light = await fetchHiringCafePostingHtml(postingUrl, opts);
    if (light.ok && light.html && isHiringCafeHtmlJobPage(light.html)) {
      const enrichMethod = light.method === 'scrape.do' ? 'scrape_do' : 'http_html';
      const merged = enrichHiringCafeRowFromHtmlWithMethod(
        listRow,
        light.html,
        postingUrl,
        enrichMethod
      );
      if (light.method === 'scrape.do') {
        merged._scrapeDoCredits = light.creditsSpent ?? 0;
        merged._scrapeDoTier = light.tier ?? 2;
      }
      return merged;
    }
  } catch (err: any) {
    logger.log('warn', `HC standalone HTTP enrich failed: ${err?.message || err}`);
  }

  if (!isHcEnrichBrowserEnabled()) {
    logger.log(
      'info',
      `HC standalone skip browser (HTTP-only enrichment mode) for ${postingUrl}`
    );
    return null;
  }

  await acquireHcEnrichBrowserSlot();
  try {
    // Tier 1: Try direct (no proxy)
    const directResult = await tryBrowserEnrich(postingUrl, listRow, false);
    if (directResult) {
      logger.log('info', `HC browser enrich direct success: ${postingUrl}`);
      return directResult;
    }

    // Tier 2: Try with proxy if available
    const proxyAvailable = !!getHiringCafeBrowserProxy();
    if (proxyAvailable) {
      logger.log('info', `HC browser enrich direct failed, retrying with proxy: ${postingUrl}`);
      const proxyResult = await tryBrowserEnrich(postingUrl, listRow, true);
      if (proxyResult) {
        logger.log('info', `HC browser enrich proxy success: ${postingUrl}`);
        return proxyResult;
      }
      logger.log('warn', `HC browser enrich proxy also failed: ${postingUrl}`);
    }

    return null;
  } finally {
    releaseHcEnrichBrowserSlot();
  }
}

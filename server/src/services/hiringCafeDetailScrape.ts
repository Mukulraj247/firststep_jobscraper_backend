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
  fetchHiringCafePostingHtml,
  isHiringCafeHtmlJobPage,
} from './hiringCafeHtmlLight';
import {
  HIRING_CAFE_DETAIL_BETWEEN_MS,
  HIRING_CAFE_DETAIL_GOTO_MS,
  HIRING_CAFE_DETAIL_RENDER_MS,
} from './hiringCafeRuntime';
import { detectCloudflareChallenge, waitForCloudflareIfPresent } from './unblocker';
import logger from '../logger';

const DEFAULT_MAX_JOBS = 40;

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
    /** When true (default), skip HTTP __NEXT_DATA__ fetch and use Playwright only. */
    browserOnly?: boolean;
  }
): Promise<Record<string, unknown>[]> {
  const maxJobs = Math.max(1, Math.min(opts?.maxJobs || DEFAULT_MAX_JOBS, 80));
  const browserOnly = opts?.browserOnly !== false;
  const seen = new Set<string>();
  let enriched = 0;
  let failed = 0;
  let applyResolved = 0;
  let lightHits = 0;
  let browserHits = 0;
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
        const light = await fetchHiringCafePostingHtml(postingUrl);
        if (light.ok && light.html && isHiringCafeHtmlJobPage(light.html)) {
          const merged = enrichHiringCafeRowFromHtml(row, light.html, postingUrl);
          if (merged.applyUrl && !isHiringCafeUrl(String(merged.applyUrl))) applyResolved += 1;
          out.push(merged);
          enriched += 1;
          lightHits += 1;
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
    `Hiring Cafe detail scrape: ${enriched} enriched (${lightHits} http-html, ${browserHits} browser), ` +
    `${applyResolved} employer apply URLs, ${failed} failed`;
  if (opts?.onLog) await opts.onLog(message);
  else logger.log('info', message);
  return out;
}

const HC_ENRICH_BROWSER_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.HIRING_CAFE_ENRICH_BROWSER_CONCURRENCY || '1', 10) || 1
);
const HC_ENRICH_BROWSER_SLOT_TIMEOUT_MS = 120_000; // 2 minutes max wait for a slot
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

/**
 * Enrichment-worker fallback: launch a short-lived stealth Chromium page for one
 * HC posting when light HTTP is Cloudflare-blocked. Never navigates to employer sites.
 * Uses the shared Turnstile solver via waitForCloudflareIfPresent.
 */
export async function enrichHiringCafePostingStandalone(
  postingUrl: string,
  listRow: Record<string, unknown> = {}
): Promise<Record<string, unknown> | null> {
  const { isHiringCafeJobPostingUrl } = await import('./hiringCafeDetail');
  if (!isHiringCafeJobPostingUrl(postingUrl)) return null;

  await acquireHcEnrichBrowserSlot();
  const { acquirePooledPage, releasePooledPage } = await import('./browserReusePool');
  let lease: Awaited<ReturnType<typeof acquirePooledPage>> | null = null;
  try {
    lease = await acquirePooledPage({
      profile: {
        browserType: 'playwright',
        headless: true,
        useStealth: true,
        poolIsolationKey: 'hiring-cafe-enrich-browser',
      },
      maxPagesPerBrowser: HC_ENRICH_BROWSER_CONCURRENCY,
      blockResources: false,
    });
    // SSRF rail: only allow hiringcafe.com / hiring.cafe navigations from this page.
    await lease.page.route('**/*', async (route) => {
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

    const via = await enrichViaBrowser(lease.page, listRow, postingUrl);
    return via.row;
  } catch (err: any) {
    logger.log(
      'warn',
      `enrichHiringCafePostingStandalone failed for ${postingUrl}: ${err?.message || err}`
    );
    return null;
  } finally {
    await releasePooledPage(lease);
    releaseHcEnrichBrowserSlot();
  }
}

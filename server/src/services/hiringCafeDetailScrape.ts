import type { Page } from 'playwright-core';
import {
  extractHiringCafeApplyUrl,
  mergeHiringCafeDetailIntoRow,
  parseHiringCafeJobPageHtml,
  pickHiringCafeJobUrl,
  preferExternalApplyUrl,
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
import logger from '../logger';

const DEFAULT_MAX_JOBS = 40;

async function waitForHiringCafeJobContent(page: Page): Promise<void> {
  const renderMs = Math.max(2000, HIRING_CAFE_DETAIL_RENDER_MS);
  await Promise.race([
    page.waitForSelector('[data-testid="job-page-apply"]', { timeout: renderMs }).catch(() => {}),
    page.waitForSelector('h1', { timeout: renderMs }).catch(() => {}),
    page
      .waitForFunction(
        () => {
          const next = document.getElementById('__NEXT_DATA__');
          if (next?.textContent && /"apply_url"\s*:\s*"https?:/i.test(next.textContent)) {
            return true;
          }
          const h1 = document.querySelector('h1');
          return Boolean(h1 && (h1.textContent || '').trim().length > 3);
        },
        { timeout: renderMs }
      )
      .catch(() => {}),
    page.waitForLoadState('networkidle', { timeout: Math.min(renderMs, 6000) }).catch(() => {}),
  ]);
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
  await waitForHiringCafeJobContent(page);

  const html = await page.content();
  const parsed = parseHiringCafeJobPageHtml(html, postingUrl);

  let applyUrl =
    preferExternalApplyUrl(parsed.applyUrl) ||
    extractHiringCafeApplyUrl(html, postingUrl) ||
    (await readApplyUrlFromPage(page));

  if (!applyUrl) {
    applyUrl = await resolveApplyUrlByClick(page);
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

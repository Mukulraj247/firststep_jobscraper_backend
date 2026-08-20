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

export async function enrichHiringCafeListRows(
  page: Page,
  rows: Record<string, unknown>[],
  opts?: {
    maxJobs?: number;
    onLog?: (message: string) => Promise<void> | void;
  }
): Promise<Record<string, unknown>[]> {
  const maxJobs = Math.max(1, Math.min(opts?.maxJobs || DEFAULT_MAX_JOBS, 80));
  const seen = new Set<string>();
  let enriched = 0;
  let failed = 0;
  let applyResolved = 0;
  const out: Record<string, unknown>[] = [];

  for (const row of rows) {
    const postingUrl = pickHiringCafeJobUrl(row);
    if (!postingUrl || seen.has(postingUrl) || seen.size >= maxJobs) {
      out.push(row);
      continue;
    }
    seen.add(postingUrl);
    try {
      // 1) Open Hiring Cafe posting URL in Playwright
      await page.goto(postingUrl, {
        waitUntil: 'domcontentloaded',
        timeout: HIRING_CAFE_DETAIL_GOTO_MS,
      });
      await waitForHiringCafeJobContent(page);

      // 2) Parse full job details from rendered HTML / __NEXT_DATA__
      const html = await page.content();
      const parsed = parseHiringCafeJobPageHtml(html, postingUrl);

      // 3) Resolve external employer apply URL (never Hiring Cafe)
      let applyUrl =
        preferExternalApplyUrl(parsed.applyUrl) ||
        extractHiringCafeApplyUrl(html, postingUrl) ||
        (await readApplyUrlFromPage(page));

      if (!applyUrl) {
        applyUrl = await resolveApplyUrlByClick(page);
      }

      if (applyUrl && !isHiringCafeUrl(applyUrl)) applyResolved += 1;

      out.push(
        mergeHiringCafeDetailIntoRow(row, { ...parsed, applyUrl }, postingUrl)
      );
      enriched += 1;
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
    `Hiring Cafe detail scrape: ${enriched} postings enriched, ${applyResolved} employer apply URLs, ${failed} failed`;
  if (opts?.onLog) await opts.onLog(message);
  else logger.log('info', message);
  return out;
}

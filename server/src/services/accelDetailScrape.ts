import type { Page } from 'playwright-core';
import {
  mergeAccelDetailIntoRow,
  parseAccelJobPageHtml,
  pickAccelJobUrl,
  preferExternalApplyUrl,
} from './accelDetail';
import { isAccelUrl } from './aggregatorIdentity';
import {
  enrichAccelRowFromHtml,
  fetchAccelPostingHtml,
  isAccelHtmlJobPage,
} from './accelHtmlLight';
import logger from '../logger';

const DEFAULT_MAX_JOBS = 40;
const GOTO_MS = 45_000;
const RENDER_MS = 8_000;
const BETWEEN_MS = 200;

async function waitForAccelJobContent(page: Page): Promise<void> {
  await Promise.race([
    page.waitForSelector('h1', { timeout: RENDER_MS }).catch(() => {}),
    page.waitForSelector('a:has-text("Apply")', { timeout: RENDER_MS }).catch(() => {}),
    page.waitForLoadState('networkidle', { timeout: Math.min(RENDER_MS, 6000) }).catch(() => {}),
  ]);
}

async function enrichViaBrowser(
  page: Page,
  row: Record<string, unknown>,
  postingUrl: string
): Promise<{ row: Record<string, unknown>; applyResolved: boolean }> {
  await page.goto(postingUrl, { waitUntil: 'domcontentloaded', timeout: GOTO_MS });
  await waitForAccelJobContent(page);
  const html = await page.content();
  const parsed = parseAccelJobPageHtml(html, postingUrl);
  const applyUrl = preferExternalApplyUrl(parsed.applyUrl);
  const merged = mergeAccelDetailIntoRow(row, { ...parsed, applyUrl }, postingUrl);
  merged.aggregatorPostingUrl = postingUrl;
  merged._enrichMethod = 'browser';
  return {
    row: merged,
    applyResolved: Boolean(applyUrl && !isAccelUrl(applyUrl)),
  };
}

/**
 * Enrich Accel list rows from Full View job pages.
 * Prefer light HTTP HTML; Playwright only as fallback. Never scrapes employer sites for JD.
 */
export async function enrichAccelListRows(
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
  let lightHits = 0;
  let browserHits = 0;
  const out: Record<string, unknown>[] = [];

  for (const row of rows) {
    const postingUrl = pickAccelJobUrl(row);
    if (!postingUrl || seen.has(postingUrl) || seen.size >= maxJobs) {
      out.push(row);
      continue;
    }
    seen.add(postingUrl);
    try {
      const light = await fetchAccelPostingHtml(postingUrl);
      if (light.ok && light.html && isAccelHtmlJobPage(light.html)) {
        const merged = enrichAccelRowFromHtml(row, light.html, postingUrl);
        if (merged.applyUrl && !isAccelUrl(String(merged.applyUrl))) applyResolved += 1;
        out.push(merged);
        enriched += 1;
        lightHits += 1;
      } else {
        const viaBrowser = await enrichViaBrowser(page, row, postingUrl);
        if (viaBrowser.applyResolved) applyResolved += 1;
        out.push(viaBrowser.row);
        enriched += 1;
        browserHits += 1;
      }
    } catch (err: any) {
      failed += 1;
      logger.log('warn', `Accel detail scrape failed for ${postingUrl}: ${err?.message || err}`);
      out.push(
        mergeAccelDetailIntoRow(row, { jobTitle: '', applyUrl: '' }, postingUrl)
      );
    }
    if (BETWEEN_MS > 0) {
      await page.waitForTimeout(BETWEEN_MS).catch(() => {});
    }
  }

  const message =
    `Accel detail scrape: ${enriched} enriched (${lightHits} http-html, ${browserHits} browser), ` +
    `${applyResolved} employer apply URLs, ${failed} failed`;
  if (opts?.onLog) await opts.onLog(message);
  else logger.log('info', message);
  return out;
}

import type { Page } from 'playwright-core';
import {
  mergeChoppingBlockDetailIntoRow,
  parseChoppingBlockJobPageHtml,
  pickChoppingBlockJobUrl,
  preferExternalApplyUrl,
} from './choppingblockDetail';
import { isChoppingBlockUrl } from './aggregatorIdentity';
import {
  enrichChoppingBlockRowFromHtml,
  fetchChoppingBlockPostingHtml,
  isChoppingBlockHtmlJobPage,
} from './choppingblockHtmlLight';
import logger from '../logger';

const DEFAULT_MAX_JOBS = 40;
const GOTO_MS = 45_000;
const RENDER_MS = 8_000;
const BETWEEN_MS = 200;

async function enrichViaBrowser(
  page: Page,
  row: Record<string, unknown>,
  postingUrl: string
): Promise<Record<string, unknown>> {
  await page.goto(postingUrl, { waitUntil: 'domcontentloaded', timeout: GOTO_MS });
  await Promise.race([
    page.waitForSelector('h1', { timeout: RENDER_MS }).catch(() => {}),
    page.waitForSelector('.w-richtext', { timeout: RENDER_MS }).catch(() => {}),
    page.waitForLoadState('networkidle', { timeout: Math.min(RENDER_MS, 6000) }).catch(() => {}),
  ]);
  const html = await page.content();
  const parsed = parseChoppingBlockJobPageHtml(html, postingUrl);
  const applyUrl = preferExternalApplyUrl(parsed.applyUrl);
  const merged = mergeChoppingBlockDetailIntoRow(row, { ...parsed, applyUrl }, postingUrl);
  merged.aggregatorPostingUrl = postingUrl;
  merged._enrichMethod = 'browser';
  return merged;
}

export async function enrichChoppingBlockListRows(
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
  let lightHits = 0;
  let browserHits = 0;
  const out: Record<string, unknown>[] = [];

  for (const row of rows) {
    const postingUrl = pickChoppingBlockJobUrl(row);
    if (!postingUrl || seen.has(postingUrl) || seen.size >= maxJobs) {
      out.push(row);
      continue;
    }
    seen.add(postingUrl);
    try {
      const light = await fetchChoppingBlockPostingHtml(postingUrl);
      if (light.ok && light.html && isChoppingBlockHtmlJobPage(light.html)) {
        out.push(enrichChoppingBlockRowFromHtml(row, light.html, postingUrl));
        enriched += 1;
        lightHits += 1;
      } else {
        out.push(await enrichViaBrowser(page, row, postingUrl));
        enriched += 1;
        browserHits += 1;
      }
    } catch (err: any) {
      failed += 1;
      logger.log('warn', `Chopping Block detail scrape failed for ${postingUrl}: ${err?.message || err}`);
      out.push(mergeChoppingBlockDetailIntoRow(row, { jobTitle: '', applyUrl: '' }, postingUrl));
    }
    if (BETWEEN_MS > 0) await page.waitForTimeout(BETWEEN_MS).catch(() => {});
  }

  const message =
    `Chopping Block detail scrape: ${enriched} enriched (${lightHits} http-html, ${browserHits} browser), ` +
    `${failed} failed`;
  if (opts?.onLog) await opts.onLog(message);
  else logger.log('info', message);
  return out;
}

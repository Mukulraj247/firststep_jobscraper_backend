import type { Page } from 'playwright-core';
import {
  mergeSequoiaDetailIntoRow,
  parseSequoiaJobPageHtml,
  pickConsiderJobUrl,
  preferExternalApplyUrl,
} from './sequoiaDetail';
import { isConsiderBoardUrl } from './aggregatorIdentity';
import {
  enrichSequoiaRowFromHtml,
  fetchConsiderPostingHtml,
  isConsiderHtmlJobPage,
} from './sequoiaHtmlLight';
import logger from '../logger';

const DEFAULT_MAX_JOBS = 40;
const GOTO_MS = 45_000;
const RENDER_MS = 10_000;
const BETWEEN_MS = 200;

async function waitForConsiderJobContent(page: Page): Promise<void> {
  await Promise.race([
    page.waitForSelector('a:has-text("Apply")', { timeout: RENDER_MS }).catch(() => {}),
    page.waitForSelector('button:has-text("Apply")', { timeout: RENDER_MS }).catch(() => {}),
    page.waitForSelector('h1', { timeout: RENDER_MS }).catch(() => {}),
    page.waitForLoadState('networkidle', { timeout: Math.min(RENDER_MS, 6000) }).catch(() => {}),
  ]);
}

async function resolveApplyViaBrowser(page: Page, postingUrl: string): Promise<string> {
  const href = await page
    .evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
      for (const a of anchors) {
        const label = (a.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
        const url = (a.href || '').trim();
        if (!url || /jobs\.sequoiacap\.com|careers\.capitalg\.com/i.test(url)) continue;
        if (/apply/i.test(label) || /apply/i.test(url)) return url;
      }
      return '';
    })
    .catch(() => '');
  if (href && !isConsiderBoardUrl(href)) return preferExternalApplyUrl(href);

  const applyLocator = page
    .locator('a:has-text("Apply"), button:has-text("Apply"), [data-testid*="apply" i]')
    .first();
  if ((await applyLocator.count().catch(() => 0)) === 0) return '';

  try {
    const [popup] = await Promise.all([
      page.waitForEvent('popup', { timeout: 8_000 }).catch(() => null),
      page.waitForNavigation({ timeout: 8_000, waitUntil: 'domcontentloaded' }).catch(() => null),
      applyLocator.click({ timeout: 5_000 }).catch(() => null),
    ]);
    const popupUrl = popup ? popup.url() : '';
    if (popup) await popup.close().catch(() => {});
    const navUrl = page.url();
    const resolved = preferExternalApplyUrl(popupUrl, navUrl);
    if (resolved && !isConsiderBoardUrl(resolved)) return resolved;
    if (!isConsiderBoardUrl(navUrl)) {
      await page.goto(postingUrl, { waitUntil: 'domcontentloaded', timeout: GOTO_MS }).catch(() => {});
    }
  } catch {
    /* ignore */
  }
  return '';
}

async function enrichViaBrowser(
  page: Page,
  row: Record<string, unknown>,
  postingUrl: string
): Promise<{ row: Record<string, unknown>; applyResolved: boolean }> {
  await page.goto(postingUrl, { waitUntil: 'domcontentloaded', timeout: GOTO_MS });
  await waitForConsiderJobContent(page);
  const html = await page.content();
  const parsed = parseSequoiaJobPageHtml(html, postingUrl);
  let applyUrl = preferExternalApplyUrl(row.applyUrl, row.apply_url, parsed.applyUrl);
  if (!applyUrl) {
    applyUrl = await resolveApplyViaBrowser(page, postingUrl);
  }
  const merged = mergeSequoiaDetailIntoRow(row, { ...parsed, applyUrl }, postingUrl);
  merged.aggregatorPostingUrl = postingUrl;
  merged._enrichMethod = 'browser';
  return {
    row: merged,
    applyResolved: Boolean(applyUrl && !isConsiderBoardUrl(applyUrl)),
  };
}

/**
 * Enrich Consider list rows (Sequoia / CapitalG) by resolving external apply URLs.
 * Prefer light HTTP; Playwright only as fallback. Never scrapes employer sites for JD.
 */
export async function enrichConsiderListRows(
  page: Page,
  rows: Record<string, unknown>[],
  opts?: {
    maxJobs?: number;
    onLog?: (message: string) => Promise<void> | void;
    label?: string;
  }
): Promise<Record<string, unknown>[]> {
  const label = opts?.label || 'Consider';
  const maxJobs = Math.max(1, Math.min(opts?.maxJobs || DEFAULT_MAX_JOBS, 80));
  const seen = new Set<string>();
  let enriched = 0;
  let failed = 0;
  let applyResolved = 0;
  let lightHits = 0;
  let browserHits = 0;
  const out: Record<string, unknown>[] = [];

  for (const row of rows) {
    const existingApply = preferExternalApplyUrl(row.applyUrl, row.apply_url);
    const postingUrl = pickConsiderJobUrl(row);
    if (existingApply && !isConsiderBoardUrl(existingApply)) {
      const merged = {
        ...row,
        applyUrl: existingApply,
        ...(postingUrl ? { aggregatorPostingUrl: postingUrl, jobUrl: postingUrl, url: postingUrl } : {}),
      };
      out.push(merged);
      applyResolved += 1;
      continue;
    }

    if (!postingUrl || seen.has(postingUrl) || seen.size >= maxJobs) {
      out.push(row);
      continue;
    }
    seen.add(postingUrl);
    try {
      const light = await fetchConsiderPostingHtml(postingUrl);
      if (light.ok && light.html && isConsiderHtmlJobPage(light.html)) {
        const merged = enrichSequoiaRowFromHtml(row, light.html, postingUrl);
        const hasApply = Boolean(merged.applyUrl && !isConsiderBoardUrl(String(merged.applyUrl)));
        if (hasApply) {
          applyResolved += 1;
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
      } else {
        const viaBrowser = await enrichViaBrowser(page, row, postingUrl);
        if (viaBrowser.applyResolved) applyResolved += 1;
        out.push(viaBrowser.row);
        enriched += 1;
        browserHits += 1;
      }
    } catch (err: any) {
      failed += 1;
      logger.log('warn', `${label} apply resolve failed for ${postingUrl}: ${err?.message || err}`);
      out.push(mergeSequoiaDetailIntoRow(row, { jobTitle: '', applyUrl: '' }, postingUrl));
    }
    if (BETWEEN_MS > 0) {
      await page.waitForTimeout(BETWEEN_MS).catch(() => {});
    }
  }

  const message =
    `${label} apply resolve: ${enriched} enriched (${lightHits} http-html, ${browserHits} browser), ` +
    `${applyResolved} employer apply URLs, ${failed} failed`;
  if (opts?.onLog) await opts.onLog(message);
  else logger.log('info', message);
  return out;
}

export async function enrichSequoiaListRows(
  page: Page,
  rows: Record<string, unknown>[],
  opts?: {
    maxJobs?: number;
    onLog?: (message: string) => Promise<void> | void;
  }
): Promise<Record<string, unknown>[]> {
  return enrichConsiderListRows(page, rows, { ...opts, label: 'Sequoia' });
}

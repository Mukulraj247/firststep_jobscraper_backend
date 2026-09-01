/**
 * startups.gallery: normalize list rows to ATS URLs; fallback DOM harvest when selectors miss.
 */

import type { Page } from 'playwright';
import { listNavigationAttempts } from './listExtractor';
import { assertSafeOutboundUrl, safeOutboundUrlLogLabel } from '../utils/outboundUrlPolicy';
import logger from '../logger';
import {
  normalizeStartupsGalleryListRow,
  isStartupsGalleryListRowUsable,
} from './startupsGalleryDetail';

const ATS_HOST_RE =
  /(?:jobs\.ashbyhq\.com|(?:job-boards|boards(?:\.eu)?)\.greenhouse\.io|jobs\.lever\.co|apply\.workable\.com|jobs\.smartrecruiters\.com)/i;

export async function harvestStartupsGalleryJobsFromPage(
  page: Page
): Promise<Record<string, unknown>[]> {
  const raw = await page.evaluate((hostPattern) => {
    const re = new RegExp(hostPattern, 'i');
    const seen = new Set<string>();
    const out: { href: string; text: string }[] = [];
    for (const el of Array.from(document.querySelectorAll('a[href]'))) {
      const a = el as HTMLAnchorElement;
      const href = String(a.href || '').split('#')[0] || '';
      if (!href || !re.test(href) || seen.has(href)) continue;
      seen.add(href);
      const text = (a.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length < 8) continue;
      out.push({ href, text });
    }
    return out;
  }, ATS_HOST_RE.source);

  return raw.map((item) =>
    normalizeStartupsGalleryListRow({
      jobUrl: item.href,
      url: item.href,
      applyUrl: item.href,
      jobTitle: item.text,
      title: item.text,
    })
  );
}

/** Navigate the gallery list page without waiting on brittle Framer item selectors. */
export async function navigateStartupsGalleryListPage(page: Page, startUrl: string): Promise<void> {
  const url = String(startUrl || '').trim();
  await assertSafeOutboundUrl(url);
  const attempts = listNavigationAttempts(url);
  let lastError: unknown;
  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index];
    try {
      await page.goto(url, attempt);
      lastError = undefined;
      break;
    } catch (error: unknown) {
      lastError = error;
      if (index < attempts.length - 1) {
        logger.log(
          'warn',
          `startups.gallery goto failed (${attempt.waitUntil}, ${attempt.timeout}ms): ${(error as Error)?.message}; retrying`
        );
      }
    }
  }
  if (lastError) throw lastError;
  try {
    await page.waitForLoadState('networkidle', { timeout: 10_000 });
  } catch {
    /* SPA analytics keep network open */
  }
  // Framer feed cards often paint after first paint.
  await page.waitForTimeout(1_500);
  logger.log('info', `startups.gallery navigation to ${safeOutboundUrlLogLabel(url)} completed`);
}

/**
 * Fast path: load startups.gallery and harvest outbound ATS links directly.
 * Avoids 45s+ waits on extension-recorded Framer class selectors.
 */
export async function runStartupsGalleryFastHarvest(
  page: Page,
  startUrl: string,
  opts?: { maxJobs?: number; onLog?: (msg: string) => void }
): Promise<Record<string, unknown>[]> {
  const log = opts?.onLog || (() => {});
  log(`startups.gallery: navigating ${safeOutboundUrlLogLabel(startUrl)} for ATS link harvest`);
  await navigateStartupsGalleryListPage(page, startUrl);
  log('startups.gallery: harvesting Ashby/Greenhouse/Lever links from DOM');
  return enrichStartupsGalleryListRows(page, [], opts);
}

export async function enrichStartupsGalleryListRows(
  page: Page,
  rows: Record<string, unknown>[],
  opts?: { maxJobs?: number; onLog?: (msg: string) => void }
): Promise<Record<string, unknown>[]> {
  const maxJobs = opts?.maxJobs && opts.maxJobs > 0 ? opts.maxJobs : 80;
  const log = opts?.onLog || (() => {});

  let normalized = rows
    .map((row) => normalizeStartupsGalleryListRow(row))
    .filter((row) => isStartupsGalleryListRowUsable(row));

  const usableBefore = normalized.length;
  if (usableBefore < Math.min(rows.length, 3)) {
    log('startups.gallery: list selectors yielded few ATS rows — harvesting Ashby/Greenhouse links from page');
    try {
      const harvested = await harvestStartupsGalleryJobsFromPage(page);
      if (harvested.length > normalized.length) {
        normalized = harvested;
        log(`startups.gallery: harvested ${harvested.length} ATS job links from DOM`);
      }
    } catch (err: unknown) {
      log(`startups.gallery DOM harvest failed: ${String((err as Error)?.message || err)}`);
    }
  } else if (usableBefore > 0) {
    log(`startups.gallery: normalized ${usableBefore} list rows to ATS URLs`);
  }

  const seen = new Set<string>();
  const deduped: Record<string, unknown>[] = [];
  for (const row of normalized) {
    const key = String(row.jobUrl || row.url || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
    if (deduped.length >= maxJobs) break;
  }

  return deduped;
}

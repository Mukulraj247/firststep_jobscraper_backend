/**
 * startups.gallery: normalize list rows to employer apply URLs; fallback DOM harvest when selectors miss.
 */

import type { Page } from 'playwright';
import { listNavigationAttempts } from './listExtractor';
import { assertSafeOutboundUrl, safeOutboundUrlLogLabel } from '../utils/outboundUrlPolicy';
import logger from '../logger';
import {
  normalizeStartupsGalleryListRow,
  isStartupsGalleryListRowUsable,
  isStartupsGalleryEmployerJobHref,
} from './startupsGalleryDetail';

export async function harvestStartupsGalleryJobsFromPage(
  page: Page
): Promise<Record<string, unknown>[]> {
  const raw = await page.evaluate(() => {
    const seen = new Set<string>();
    const out: { href: string; text: string }[] = [];
    for (const el of Array.from(document.querySelectorAll('a[href]'))) {
      const a = el as HTMLAnchorElement;
      const href = String(a.href || '').split('#')[0] || '';
      if (!href || !/^https?:\/\//i.test(href) || seen.has(href)) continue;
      try {
        const host = new URL(href).hostname.toLowerCase();
        if (host === 'startups.gallery' || host.endsWith('.startups.gallery')) continue;
      } catch {
        continue;
      }
      seen.add(href);
      const text = (a.textContent || '').replace(/\s+/g, ' ').trim();
      if (text.length < 8) continue;
      out.push({ href, text });
    }
    return out;
  });

  return raw
    .filter((item) => isStartupsGalleryEmployerJobHref(item.href))
    .map((item) =>
      normalizeStartupsGalleryListRow({
        jobUrl: item.href,
        url: item.href,
        applyUrl: item.href,
        jobTitle: item.text,
        title: item.text,
      })
    );
}

/** Scroll the Framer feed and merge employer job links (cards lazy-load below the fold). */
export async function scrollAndHarvestStartupsGalleryJobs(
  page: Page,
  maxJobs: number
): Promise<Record<string, unknown>[]> {
  const cap = Math.max(1, maxJobs);
  const byUrl = new Map<string, Record<string, unknown>>();
  const merge = (rows: Record<string, unknown>[]) => {
    for (const row of rows) {
      if (!isStartupsGalleryListRowUsable(row)) continue;
      const key = String(row.jobUrl || row.url || '')
        .trim()
        .toLowerCase();
      if (!key || byUrl.has(key)) continue;
      byUrl.set(key, row);
    }
  };

  merge(await harvestStartupsGalleryJobsFromPage(page));

  for (let step = 0; step < 14 && byUrl.size < cap; step += 1) {
    const before = byUrl.size;
    await page.evaluate(() => {
      window.scrollBy(0, Math.max(window.innerHeight * 0.85, 480));
    });
    await page.waitForTimeout(650);
    merge(await harvestStartupsGalleryJobsFromPage(page));
    if (byUrl.size === before) break;
  }

  return Array.from(byUrl.values()).slice(0, cap);
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
  await page.waitForTimeout(2_500);
  try {
    await page.waitForFunction(
      () => {
        for (const el of Array.from(document.querySelectorAll('a[href]'))) {
          const href = String((el as HTMLAnchorElement).href || '');
          try {
            const host = new URL(href).hostname.toLowerCase();
            if (host === 'startups.gallery' || host.endsWith('.startups.gallery')) continue;
            if (/^https?:\/\//i.test(href) && (el.textContent || '').replace(/\s+/g, ' ').trim().length >= 8) {
              return true;
            }
          } catch {
            /* ignore malformed href */
          }
        }
        return false;
      },
      { timeout: 20_000 }
    );
  } catch {
    /* proceed with scroll harvest even if cards stay slow */
  }
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
  log(`startups.gallery: navigating ${safeOutboundUrlLogLabel(startUrl)} for employer link harvest`);
  await navigateStartupsGalleryListPage(page, startUrl);
  log(
    'startups.gallery: scrolling feed and collecting employer job URLs (ATS, Phenom careers, and other apply links)'
  );
  log(
    'startups.gallery: each employer URL is queued for enrichment (ATS JSON → Phenom → scrape.do fallback)'
  );
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
  // Harvest when fewer than 3 usable rows (includes fast-harvest path with rows=[]).
  if (usableBefore < 3) {
    log('startups.gallery: list selectors yielded few rows — harvesting employer links from page');
    try {
      const harvested = await scrollAndHarvestStartupsGalleryJobs(page, maxJobs);
      if (harvested.length > normalized.length) {
        normalized = harvested;
        log(`startups.gallery: collected ${harvested.length} employer job URLs from gallery page`);
      }
    } catch (err: unknown) {
      log(`startups.gallery DOM harvest failed: ${String((err as Error)?.message || err)}`);
    }
  } else if (usableBefore > 0) {
    log(`startups.gallery: normalized ${usableBefore} list rows to employer apply URLs`);
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

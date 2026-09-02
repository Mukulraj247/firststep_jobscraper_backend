/**
 * startups.gallery: normalize list rows to employer apply URLs; fallback DOM harvest when selectors miss.
 *
 * Prefer HTTP HTML harvest — the Framer SPA (~3MB) frequently crashes Chromium
 * ("Target crashed" / "Page crashed") during scroll harvest.
 */

import type { Page } from 'playwright';
import { assertSafeOutboundUrl, safeOutboundUrlLogLabel } from '../utils/outboundUrlPolicy';
import logger from '../logger';
import {
  normalizeStartupsGalleryListRow,
  isStartupsGalleryListRowUsable,
  isStartupsGalleryEmployerJobHref,
  parseStartupsGalleryCardLabel,
} from './startupsGalleryDetail';

/** Strip trailing `+` / encode quirks from recorded `?position=software+` URLs. */
export function normalizeStartupsGalleryListUrl(startUrl: string): string {
  const raw = String(startUrl || '').trim();
  if (!raw) return raw;
  try {
    const parsed = new URL(raw);
    const position = parsed.searchParams.get('position');
    if (position != null) {
      const cleaned = position
        .replace(/\+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (cleaned) parsed.searchParams.set('position', cleaned);
      else parsed.searchParams.delete('position');
    }
    return parsed.toString();
  } catch {
    return raw;
  }
}

function positionFilterTokens(startUrl: string): string[] {
  try {
    const position = new URL(startUrl).searchParams.get('position') || '';
    return position
      .toLowerCase()
      .replace(/\+/g, ' ')
      .split(/[^a-z0-9]+/i)
      .map((t) => t.trim())
      .filter((t) => t.length >= 3);
  } catch {
    return [];
  }
}

function stripHtmlTags(html: string): string {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse Framer SSR job cards: `<a href="https://jobs.ashbyhq.com/...">…title…</a>`.
 * Avoids launching Chromium against the crash-prone SPA.
 */
export function harvestStartupsGalleryJobsFromHtml(
  html: string,
  maxJobs: number,
  opts?: { positionTokens?: string[] }
): Record<string, unknown>[] {
  const cap = Math.max(1, maxJobs);
  const tokens = (opts?.positionTokens || []).map((t) => t.toLowerCase());
  const byUrl = new Map<string, Record<string, unknown>>();
  const anchorRe =
    /<a\b[^>]*\bhref\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(html)) !== null) {
    const href = String(match[1] || '')
      .replace(/&amp;/gi, '&')
      .split('#')[0]
      .trim();
    if (!isStartupsGalleryEmployerJobHref(href)) continue;
    const text = stripHtmlTags(match[2] || '');
    if (text.length < 8) continue;
    const parsed = parseStartupsGalleryCardLabel(text);
    const row = normalizeStartupsGalleryListRow({
      jobUrl: href,
      url: href,
      applyUrl: href,
      jobTitle: parsed.jobTitle || text,
      title: parsed.jobTitle || text,
      location: parsed.location,
      date: parsed.date,
    });
    if (!isStartupsGalleryListRowUsable(row)) continue;
    const key = String(row.jobUrl || href).trim().toLowerCase();
    if (!key || byUrl.has(key)) continue;
    byUrl.set(key, row);
    if (byUrl.size >= Math.max(cap * 4, 80)) break;
  }

  let rows = Array.from(byUrl.values());
  if (tokens.length > 0) {
    const filtered = rows.filter((row) => {
      const hay = `${row.jobTitle || ''} ${row.title || ''}`.toLowerCase();
      return tokens.some((t) => hay.includes(t));
    });
    // SSR feed is often unfiltered; keep unfiltered when position filter is too sparse.
    if (filtered.length >= 3) rows = filtered;
  }
  return rows.slice(0, cap);
}

/** HTTP-first list harvest — no Playwright / Framer runtime. */
export async function fetchStartupsGalleryJobsHttp(
  startUrl: string,
  opts?: { maxJobs?: number; onLog?: (msg: string) => void }
): Promise<Record<string, unknown>[]> {
  const log = opts?.onLog || (() => {});
  const maxJobs = opts?.maxJobs && opts.maxJobs > 0 ? opts.maxJobs : 80;
  const url = normalizeStartupsGalleryListUrl(startUrl);
  await assertSafeOutboundUrl(url);
  log(`startups.gallery: HTTP harvest ${safeOutboundUrlLogLabel(url)}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      },
    });
    if (!res.ok) {
      throw new Error(`startups.gallery HTTP ${res.status}`);
    }
    const html = await res.text();
    const rows = harvestStartupsGalleryJobsFromHtml(html, maxJobs, {
      positionTokens: positionFilterTokens(url),
    });
    log(`startups.gallery: HTTP harvest collected ${rows.length} employer job URLs`);
    return rows;
  } finally {
    clearTimeout(timer);
  }
}

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
  const url = normalizeStartupsGalleryListUrl(String(startUrl || '').trim());
  await assertSafeOutboundUrl(url);
  // Framer ships multi‑MB assets; blocking media reduces Chromium OOM/crash rate.
  try {
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (type === 'image' || type === 'media' || type === 'font') {
        return route.abort();
      }
      return route.continue();
    });
  } catch {
    /* route may already be set */
  }
  const attempts = [
    { waitUntil: 'domcontentloaded' as const, timeout: 35_000 },
    { waitUntil: 'commit' as const, timeout: 15_000 },
  ];
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
  // Skip networkidle — Framer analytics keep the network busy and burn budget.
  await page.waitForTimeout(1_500);
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
      { timeout: 12_000 }
    );
  } catch {
    /* proceed with scroll harvest even if cards stay slow */
  }
  logger.log('info', `startups.gallery navigation to ${safeOutboundUrlLogLabel(url)} completed`);
}

/**
 * Fast path: HTTP HTML harvest first (no Framer Chromium), then browser scroll fallback.
 */
export async function runStartupsGalleryFastHarvest(
  page: Page,
  startUrl: string,
  opts?: { maxJobs?: number; onLog?: (msg: string) => void }
): Promise<Record<string, unknown>[]> {
  const log = opts?.onLog || (() => {});
  const maxJobs = opts?.maxJobs && opts.maxJobs > 0 ? opts.maxJobs : 80;
  const url = normalizeStartupsGalleryListUrl(startUrl);

  try {
    const httpRows = await fetchStartupsGalleryJobsHttp(url, { maxJobs, onLog: log });
    if (httpRows.length > 0) {
      log(
        `startups.gallery: HTTP path succeeded with ${httpRows.length} rows — skipping Framer browser harvest`
      );
      return httpRows;
    }
    log('startups.gallery: HTTP harvest returned 0 rows — falling back to browser scroll harvest');
  } catch (err: unknown) {
    log(
      `startups.gallery: HTTP harvest failed (${String((err as Error)?.message || err)}) — browser fallback`
    );
  }

  log(`startups.gallery: navigating ${safeOutboundUrlLogLabel(url)} for employer link harvest`);
  await navigateStartupsGalleryListPage(page, url);
  log(
    'startups.gallery: scrolling feed and collecting employer job URLs (ATS, Phenom careers, and other apply links)'
  );
  log(
    'startups.gallery: each employer URL is queued for enrichment (ATS JSON → Phenom → scrape.do fallback)'
  );
  return enrichStartupsGalleryListRows(page, [], { ...opts, maxJobs });
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

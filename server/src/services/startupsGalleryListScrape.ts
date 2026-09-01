/**
 * startups.gallery: normalize list rows to ATS URLs; fallback DOM harvest when selectors miss.
 */

import type { Page } from 'playwright';
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

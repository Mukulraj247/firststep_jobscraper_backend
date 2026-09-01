import type { Page } from 'playwright-core';
import {
  aidevboardJobIdFromUrl,
  mergeAidevboardDetailIntoRow,
  pickAidevboardJobUrl,
} from './aidevboardDetail';
import {
  enrichAidevboardRowFromFields,
  fetchAidevboardJobById,
  fetchAidevboardJobHtml,
} from './aidevboardApiLight';
import logger from '../logger';

const DEFAULT_MAX_JOBS = 40;
const BETWEEN_MS = 150;

/**
 * Enrich AI Dev Board list rows via public API (preferred) or job HTML.
 * Never scrapes employer ATS for JD when ADB payload has description.
 */
export async function enrichAidevboardListRows(
  _page: Page,
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
  let apiHits = 0;
  let htmlHits = 0;
  const out: Record<string, unknown>[] = [];

  for (const row of rows) {
    const postingUrl = pickAidevboardJobUrl(row);
    if (!postingUrl || seen.has(postingUrl) || seen.size >= maxJobs) {
      out.push(row);
      continue;
    }
    seen.add(postingUrl);
    const jobId = aidevboardJobIdFromUrl(postingUrl);
    try {
      let result = jobId
        ? await fetchAidevboardJobById(jobId)
        : await fetchAidevboardJobHtml(postingUrl);
      if (!result.ok && jobId) {
        result = await fetchAidevboardJobHtml(postingUrl);
      }
      if (result.ok && result.fields) {
        out.push(enrichAidevboardRowFromFields(row, result.fields, postingUrl));
        enriched += 1;
        if (result.method === 'api') apiHits += 1;
        else htmlHits += 1;
      } else {
        failed += 1;
        out.push(mergeAidevboardDetailIntoRow(row, { jobTitle: '', applyUrl: '' }, postingUrl));
      }
    } catch (err: any) {
      failed += 1;
      logger.log('warn', `AI Dev Board enrich failed for ${postingUrl}: ${err?.message || err}`);
      out.push(row);
    }
    if (BETWEEN_MS > 0) {
      await new Promise((r) => setTimeout(r, BETWEEN_MS));
    }
  }

  const message =
    `AI Dev Board enrich: ${enriched} enriched (${apiHits} api, ${htmlHits} html), ${failed} failed`;
  if (opts?.onLog) await opts.onLog(message);
  else logger.log('info', message);
  return out;
}

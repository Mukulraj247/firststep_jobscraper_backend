/**
 * Light HTTP GET of Chopping Block Webflow job posting pages.
 */

import axios from 'axios';
import { isChoppingBlockJobPostingUrl, isChoppingBlockUrl } from './aggregatorIdentity';
import {
  mergeChoppingBlockDetailIntoRow,
  parseChoppingBlockJobPageHtml,
  preferExternalApplyUrl,
} from './choppingblockDetail';
import logger from '../logger';

export type FetchChoppingBlockHtmlResult = {
  ok: boolean;
  html: string;
  method: 'http' | 'none';
  light: boolean;
  status?: number;
  error?: string;
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export function isChoppingBlockHtmlJobPage(html: string): boolean {
  const raw = String(html || '');
  if (raw.length < 400) return false;
  return (
    (/<h1[\s>]/i.test(raw) || /breadcrumb-link/i.test(raw)) &&
    (/Job Description/i.test(raw) || /w-richtext/i.test(raw) || raw.length > 8000)
  );
}

export async function fetchChoppingBlockPostingHtml(
  postingUrl: string
): Promise<FetchChoppingBlockHtmlResult> {
  const url = String(postingUrl || '').trim().split('#')[0] || '';
  if (!url || !isChoppingBlockUrl(url) || !isChoppingBlockJobPostingUrl(url)) {
    return {
      ok: false,
      html: '',
      method: 'none',
      light: false,
      error: 'Not a Chopping Block job posting URL',
    };
  }

  try {
    const res = await axios.get(url, {
      timeout: 25_000,
      responseType: 'text',
      transitional: { forcedJSONParsing: false },
      maxContentLength: 4 * 1024 * 1024,
      maxBodyLength: 4 * 1024 * 1024,
      validateStatus: () => true,
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': UA,
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    const html = typeof res.data === 'string' ? res.data : '';
    const looksHtml = /<html[\s>]/i.test(html);
    if (res.status >= 400 || !html || !looksHtml) {
      return {
        ok: false,
        html: '',
        method: 'http',
        light: false,
        status: res.status,
        error: `HTTP ${res.status} or non-HTML response`,
      };
    }
    const light = isChoppingBlockHtmlJobPage(html);
    return {
      ok: light,
      html,
      method: 'http',
      light,
      status: res.status,
      error: light ? undefined : 'HTML missing Chopping Block job body',
    };
  } catch (err: any) {
    logger.log('warn', `Chopping Block light HTML fetch failed: ${err?.message || err}`);
    return {
      ok: false,
      html: '',
      method: 'http',
      light: false,
      error: String(err?.message || err || 'fetch_failed'),
    };
  }
}

export function enrichChoppingBlockRowFromHtml(
  listRow: Record<string, unknown>,
  html: string,
  postingUrl: string
): Record<string, unknown> {
  const parsed = parseChoppingBlockJobPageHtml(html, postingUrl);
  const applyUrl = preferExternalApplyUrl(listRow.applyUrl, parsed.applyUrl);
  const merged = mergeChoppingBlockDetailIntoRow(listRow, { ...parsed, applyUrl }, postingUrl);
  merged.aggregatorPostingUrl = postingUrl;
  merged._enrichMethod = 'http_html';
  return merged;
}

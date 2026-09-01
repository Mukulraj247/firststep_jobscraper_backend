/**
 * Light-load Sequoia (Consider) fetch: plain HTTP GET of jobs.sequoiacap.com posting URLs.
 * Goal: resolve external apply URL from HTML/embedded JSON. Never fetches employer ATS pages.
 */

import axios from 'axios';
import { isConsiderBoardUrl, isConsiderJobPostingUrl } from './aggregatorIdentity';
import {
  mergeSequoiaDetailIntoRow,
  parseSequoiaJobPageHtml,
  preferExternalApplyUrl,
} from './sequoiaDetail';
import logger from '../logger';

export type SequoiaLightDetectResult =
  | { kind: 'sequoia_consider_html'; light: true }
  | { kind: 'unknown'; light: false };

export type FetchSequoiaHtmlResult = {
  ok: boolean;
  html: string;
  method: 'http' | 'none';
  light: boolean;
  status?: number;
  error?: string;
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export function isSequoiaHtmlJobPage(html: string): boolean {
  return detectSequoiaLightHtmlJobPage(html).light;
}

export const isConsiderHtmlJobPage = isSequoiaHtmlJobPage;

export function detectSequoiaLightHtmlJobPage(html: string): SequoiaLightDetectResult {
  const raw = String(html || '');
  if (raw.length < 200) return { kind: 'unknown', light: false };
  const hasApplySignal =
    /"apply_url"\s*:/i.test(raw) ||
    /"applyUrl"\s*:/i.test(raw) ||
    /utm_source=(?:jobs\.sequoiacap\.com|careers\.capitalg\.com)/i.test(raw) ||
    /href=["'][^"']*(?:greenhouse|lever\.co|ashbyhq|jobs\.gem\.com|phenom|myworkdayjobs)/i.test(
      raw
    ) ||
    (/apply/i.test(raw) && /https?:\/\//i.test(raw) && /sequoiacap|capitalg|consider/i.test(raw));
  if (hasApplySignal) return { kind: 'sequoia_consider_html', light: true };
  if (/weekdayJdUid|consider|serverInitialData/i.test(raw) && raw.length > 1500) {
    return { kind: 'sequoia_consider_html', light: true };
  }
  return { kind: 'unknown', light: false };
}

export async function fetchSequoiaPostingHtml(postingUrl: string): Promise<FetchSequoiaHtmlResult> {
  return fetchConsiderPostingHtml(postingUrl);
}

export async function fetchConsiderPostingHtml(postingUrl: string): Promise<FetchSequoiaHtmlResult> {
  const url = String(postingUrl || '').trim().split('#')[0] || '';
  if (!url || !isConsiderBoardUrl(url) || !isConsiderJobPostingUrl(url)) {
    return {
      ok: false,
      html: '',
      method: 'none',
      light: false,
      error: 'Not a Consider job posting URL',
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
    const contentType = String(res.headers?.['content-type'] || '').toLowerCase();
    const looksHtml =
      contentType.includes('text/html') ||
      contentType.includes('application/xhtml') ||
      /<html[\s>]/i.test(html);

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

    const detect = detectSequoiaLightHtmlJobPage(html);
    return {
      ok: detect.light,
      html,
      method: 'http',
      light: detect.light,
      status: res.status,
      error: detect.light ? undefined : 'HTML missing Consider apply signals',
    };
  } catch (err: any) {
    logger.log('warn', `Consider light HTML fetch failed: ${err?.message || err}`);
    return {
      ok: false,
      html: '',
      method: 'http',
      light: false,
      error: String(err?.message || err || 'fetch_failed'),
    };
  }
}

export function enrichSequoiaRowFromHtml(
  listRow: Record<string, unknown>,
  html: string,
  postingUrl: string
): Record<string, unknown> {
  const parsed = parseSequoiaJobPageHtml(html, postingUrl);
  const applyUrl = preferExternalApplyUrl(listRow.applyUrl, listRow.apply_url, parsed.applyUrl);
  const merged = mergeSequoiaDetailIntoRow(listRow, { ...parsed, applyUrl }, postingUrl);
  merged.aggregatorPostingUrl = postingUrl;
  merged._enrichMethod = 'http_html';
  return merged;
}

export const enrichConsiderRowFromHtml = enrichSequoiaRowFromHtml;

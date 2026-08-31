/**
 * Light-load Accel (Getro) detail scrape: plain HTTP GET of jobs.accel.com posting URLs.
 * Never fetches employer apply URLs.
 */

import axios from 'axios';
import { isAccelJobPostingUrl, isAccelUrl } from './aggregatorIdentity';
import {
  mergeAccelDetailIntoRow,
  parseAccelJobPageHtml,
  preferExternalApplyUrl,
} from './accelDetail';
import logger from '../logger';

export type AccelLightDetectResult =
  | { kind: 'accel_getro_html'; light: true }
  | { kind: 'unknown'; light: false };

export type FetchAccelHtmlResult = {
  ok: boolean;
  html: string;
  method: 'http' | 'none';
  light: boolean;
  status?: number;
  error?: string;
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export function isAccelHtmlJobPage(html: string): boolean {
  return detectAccelLightHtmlJobPage(html).light;
}

export function detectAccelLightHtmlJobPage(html: string): AccelLightDetectResult {
  const raw = String(html || '');
  if (raw.length < 400) return { kind: 'unknown', light: false };
  const hasTitle = /<h1[\s>]/i.test(raw) || /<h2[\s>]/i.test(raw);
  const hasRoleSignal =
    /about\s+the\s+role/i.test(raw) ||
    /what we(?:'|’)re working on/i.test(raw) ||
    /you may be a fit/i.test(raw) ||
    /job\s+description/i.test(raw) ||
    /apply\s+now/i.test(raw);
  if (hasTitle && hasRoleSignal) return { kind: 'accel_getro_html', light: true };
  // Getro often embeds enough prose even without those exact headers.
  if (hasTitle && raw.length > 8000 && /powered by getro/i.test(raw)) {
    return { kind: 'accel_getro_html', light: true };
  }
  return { kind: 'unknown', light: false };
}

export async function fetchAccelPostingHtml(postingUrl: string): Promise<FetchAccelHtmlResult> {
  const url = String(postingUrl || '').trim().split('#')[0] || '';
  if (!url || !isAccelUrl(url) || !isAccelJobPostingUrl(url)) {
    return {
      ok: false,
      html: '',
      method: 'none',
      light: false,
      error: 'Not an Accel job posting URL',
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

    const detect = detectAccelLightHtmlJobPage(html);
    return {
      ok: detect.light,
      html,
      method: 'http',
      light: detect.light,
      status: res.status,
      error: detect.light ? undefined : 'HTML missing Accel/Getro job body',
    };
  } catch (err: any) {
    logger.log('warn', `Accel light HTML fetch failed: ${err?.message || err}`);
    return {
      ok: false,
      html: '',
      method: 'http',
      light: false,
      error: String(err?.message || err || 'fetch_failed'),
    };
  }
}

export function enrichAccelRowFromHtml(
  listRow: Record<string, unknown>,
  html: string,
  postingUrl: string
): Record<string, unknown> {
  const parsed = parseAccelJobPageHtml(html, postingUrl);
  const applyUrl = preferExternalApplyUrl(parsed.applyUrl);
  const merged = mergeAccelDetailIntoRow(listRow, { ...parsed, applyUrl }, postingUrl);
  merged.aggregatorPostingUrl = postingUrl;
  merged._enrichMethod = 'http_html';
  return merged;
}

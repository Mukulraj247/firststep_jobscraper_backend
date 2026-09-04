/**
 * Light-load Hiring Cafe detail scrape: plain HTTP GET of the HC posting URL,
 * detect embedded HTML/`__NEXT_DATA__`, parse without Playwright.
 * Never fetches employer/apply URLs — HC pages only.
 *
 * Order: direct HTTP → Scrape.do tier 1 → tier 2 (never tier 3). No proxy path.
 */

import axios from 'axios';
import { isHiringCafeUrl } from './aggregatorIdentity';
import {
  isHiringCafeJobPostingUrl,
  mergeHiringCafeDetailIntoRow,
  parseHiringCafeJobPageHtml,
} from './hiringCafeDetail';
import { preferExternalApplyUrl } from './hiringCafeNormalize';
import { fetchHiringCafePostingViaScrapeDo } from './hiringCafeScrapeDo';
import type { HiringCafeScrapeDoOptions } from './hiringCafeEnrichmentConfig';
import logger from '../logger';

export type LightHtmlDetectResult =
  | { kind: 'hiring_cafe_next_data'; light: true }
  | { kind: 'unknown'; light: false };

export type FetchHiringCafeHtmlResult = {
  ok: boolean;
  html: string;
  method: 'http' | 'scrape.do' | 'none';
  light: boolean;
  status?: number;
  error?: string;
  creditsSpent?: number;
  tier?: number;
};

export type FetchHiringCafePostingOpts = {
  scrapeDo?: HiringCafeScrapeDoOptions | null;
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/** True when HTML embeds a usable Hiring Cafe `__NEXT_DATA__` job payload. */
export function isHiringCafeHtmlJobPage(html: string): boolean {
  return detectLightHtmlJobPage(html).light;
}

/**
 * Detect whether this response is static/SSR HTML we can parse cheaply
 * (no browser render / no scrape.do JS tier).
 */
export function detectLightHtmlJobPage(html: string): LightHtmlDetectResult {
  const raw = String(html || '');
  if (raw.length < 200) return { kind: 'unknown', light: false };
  if (!/<script[^>]*id=["']__NEXT_DATA__["']/i.test(raw)) {
    return { kind: 'unknown', light: false };
  }
  // Must look like a job page payload, not a search shell.
  if (
    !/"job_information"\s*:/.test(raw) &&
    !/"v5_processed_job_data"\s*:/.test(raw) &&
    !/"apply_url"\s*:/.test(raw)
  ) {
    return { kind: 'unknown', light: false };
  }
  return { kind: 'hiring_cafe_next_data', light: true };
}

/** Cloudflare block indicators in HTML response. */
function looksLikeCloudflareBlock(html: string, status?: number): boolean {
  if (status === 403 || status === 503) return true;
  const lower = (html || '').toLowerCase();
  return (
    lower.includes('just a moment') ||
    lower.includes('checking your browser') ||
    lower.includes('cf-browser-verification') ||
    lower.includes('challenge-platform') ||
    lower.includes('attention required')
  );
}

/** Single direct HTTP GET (no proxy). */
async function fetchHtmlOnce(
  url: string
): Promise<FetchHiringCafeHtmlResult & { cfBlocked?: boolean }> {
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
      /<html[\s>]/i.test(html) ||
      /__NEXT_DATA__/i.test(html);

    if (looksLikeCloudflareBlock(html, res.status)) {
      return {
        ok: false,
        html: '',
        method: 'http',
        light: false,
        status: res.status,
        error: 'Cloudflare challenge detected',
        cfBlocked: true,
      };
    }

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

    const detect = detectLightHtmlJobPage(html);
    return {
      ok: detect.light,
      html,
      method: 'http',
      light: detect.light,
      status: res.status,
      error: detect.light ? undefined : 'HTML missing __NEXT_DATA__ job payload',
    };
  } catch (err: any) {
    return {
      ok: false,
      html: '',
      method: 'http',
      light: false,
      error: String(err?.message || err || 'fetch_failed'),
    };
  }
}

/**
 * Plain HTTP GET of a Hiring Cafe /job/{slug} URL only.
 * Order: direct HTTP → Scrape.do tier 1 → tier 2 (never tier 3). No proxy.
 * Rejects employer / apply hosts so we never leave HC for detail content.
 */
export async function fetchHiringCafePostingHtml(
  postingUrl: string,
  opts?: FetchHiringCafePostingOpts
): Promise<FetchHiringCafeHtmlResult> {
  const url = String(postingUrl || '').trim();
  if (!url || !isHiringCafeUrl(url) || !isHiringCafeJobPostingUrl(url)) {
    return {
      ok: false,
      html: '',
      method: 'none',
      light: false,
      error: 'Not a Hiring Cafe job posting URL',
    };
  }

  // 1) Cheap plain HTTP (no Scrape.do credits)
  const directResult = await fetchHtmlOnce(url);
  if (directResult.ok) {
    logger.log('info', `Hiring Cafe HTTP direct success: ${url}`);
    return directResult;
  }

  // 2) Scrape.do after free HTTP failed — tier 1 then tier 2 (never 3)
  const scrapeDo = opts?.scrapeDo;
  const scrapeDoReady = Boolean(scrapeDo?.enabled && scrapeDo.token);
  if (scrapeDoReady) {
    logger.log(
      'info',
      `Hiring Cafe HTTP failed (${directResult.error || 'blocked'}), escalating to Scrape.do (tier 1→2): ${url}`
    );
    const sd = await fetchHiringCafePostingViaScrapeDo(url, scrapeDo!);
    if (sd.ok) {
      return {
        ok: true,
        html: sd.html,
        method: 'scrape.do',
        light: sd.light,
        creditsSpent: sd.creditsSpent,
        tier: sd.tier,
      };
    }
    return {
      ok: false,
      html: '',
      method: 'scrape.do',
      light: false,
      error: sd.error || 'scrape_do_failed',
      creditsSpent: sd.creditsSpent,
      tier: sd.tier,
    };
  }

  if (directResult.cfBlocked) {
    logger.log('warn', `Hiring Cafe HTTP Cloudflare blocked (no Scrape.do configured): ${url}`);
  }
  return directResult;
}

/** Parse HC HTML into a list-row merge (HC posting URL only). */
export function enrichHiringCafeRowFromHtml(
  listRow: Record<string, unknown>,
  html: string,
  postingUrl: string
): Record<string, unknown> {
  const parsed = parseHiringCafeJobPageHtml(html, postingUrl);
  const applyUrl = preferExternalApplyUrl(parsed.applyUrl);
  const merged = mergeHiringCafeDetailIntoRow(
    listRow,
    { ...parsed, applyUrl },
    postingUrl
  );
  merged.aggregatorPostingUrl = postingUrl;
  merged._enrichMethod = 'http_html';
  return merged;
}

/** Parse HC HTML into a list-row merge; sets `_enrichMethod` from fetch method when provided. */
export function enrichHiringCafeRowFromHtmlWithMethod(
  listRow: Record<string, unknown>,
  html: string,
  postingUrl: string,
  enrichMethod: 'http_html' | 'scrape_do'
): Record<string, unknown> {
  const merged = enrichHiringCafeRowFromHtml(listRow, html, postingUrl);
  merged._enrichMethod = enrichMethod;
  return merged;
}

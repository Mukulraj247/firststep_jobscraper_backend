/**
 * Light-load Hiring Cafe detail scrape: plain HTTP GET of the HC posting URL,
 * detect embedded HTML/`__NEXT_DATA__`, parse without Playwright or scrape.do.
 * Never fetches employer/apply URLs — HC pages only.
 *
 * Uses Decodo / Camoufox proxy when configured to bypass Cloudflare.
 */

import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { isHiringCafeUrl } from './aggregatorIdentity';
import {
  isHiringCafeJobPostingUrl,
  mergeHiringCafeDetailIntoRow,
  parseHiringCafeJobPageHtml,
} from './hiringCafeDetail';
import { preferExternalApplyUrl } from './hiringCafeNormalize';
import logger from '../logger';

/** Build proxy URL from env vars (Decodo / Camoufox). Returns null if not configured. */
function getHiringCafeProxyUrl(): string | null {
  const enabled = /^(true|1|yes|on)$/i.test(String(process.env.SCRAPER_PROXY_ENABLED || '').trim());
  if (!enabled) return null;

  // Prefer Camoufox (gate.decodo.com style)
  const server = String(process.env.CAMOUFOX_PROXY_SERVER || '').trim();
  const username = String(process.env.CAMOUFOX_PROXY_USERNAME || '').trim();
  const password = String(process.env.CAMOUFOX_PROXY_PASSWORD || '').trim();

  if (server && username && password) {
    // Normalize: gate.decodo.com:10001 → http://user:pass@gate.decodo.com:10001
    const hasProtocol = /^https?:\/\//i.test(server);
    const base = hasProtocol ? server : `http://${server}`;
    try {
      const u = new URL(base);
      u.username = encodeURIComponent(username);
      u.password = encodeURIComponent(password);
      return u.toString();
    } catch {
      return null;
    }
  }

  // Fallback: DEFAULT_PROXY_URL (assumed to include credentials if needed)
  const defaultProxy = String(process.env.DEFAULT_PROXY_URL || '').trim();
  if (defaultProxy) {
    const hasProtocol = /^https?:\/\//i.test(defaultProxy);
    return hasProtocol ? defaultProxy : `http://${defaultProxy}`;
  }

  return null;
}

let cachedProxyAgent: HttpsProxyAgent<string> | null = null;
let cachedProxyUrl: string | null = null;

function getProxyAgent(): HttpsProxyAgent<string> | undefined {
  const proxyUrl = getHiringCafeProxyUrl();
  if (!proxyUrl) return undefined;

  // Reuse agent if proxy URL unchanged
  if (cachedProxyAgent && cachedProxyUrl === proxyUrl) {
    return cachedProxyAgent;
  }

  cachedProxyUrl = proxyUrl;
  cachedProxyAgent = new HttpsProxyAgent(proxyUrl);
  logger.log('info', `Hiring Cafe HTTP using proxy: ${proxyUrl.replace(/:[^:@]+@/, ':***@')}`);
  return cachedProxyAgent;
}

export type LightHtmlDetectResult =
  | { kind: 'hiring_cafe_next_data'; light: true }
  | { kind: 'unknown'; light: false };

export type FetchHiringCafeHtmlResult = {
  ok: boolean;
  html: string;
  method: 'http' | 'none';
  light: boolean;
  status?: number;
  error?: string;
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

/** Single HTTP GET attempt (direct or proxied). */
async function fetchHtmlOnce(
  url: string,
  useProxy: boolean
): Promise<FetchHiringCafeHtmlResult & { cfBlocked?: boolean }> {
  const proxyAgent = useProxy ? getProxyAgent() : undefined;
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
      ...(proxyAgent ? { httpsAgent: proxyAgent, httpAgent: proxyAgent } : {}),
    });

    const html = typeof res.data === 'string' ? res.data : '';
    const contentType = String(res.headers?.['content-type'] || '').toLowerCase();
    const looksHtml =
      contentType.includes('text/html') ||
      contentType.includes('application/xhtml') ||
      /<html[\s>]/i.test(html) ||
      /__NEXT_DATA__/i.test(html);

    // Detect Cloudflare block
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
 * Tiered approach: direct first, then proxy on Cloudflare block.
 * Rejects employer / apply hosts so we never leave HC for detail content.
 */
export async function fetchHiringCafePostingHtml(
  postingUrl: string
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

  // Tier 1: Try direct (no proxy)
  const directResult = await fetchHtmlOnce(url, false);
  if (directResult.ok) {
    logger.log('info', `Hiring Cafe HTTP direct success: ${url}`);
    return directResult;
  }

  // Tier 2: If Cloudflare blocked or failed, try with proxy
  const proxyAvailable = !!getHiringCafeProxyUrl();
  if (proxyAvailable && (directResult.cfBlocked || directResult.status === 403 || directResult.status === 503)) {
    logger.log('info', `Hiring Cafe HTTP direct blocked, retrying with proxy: ${url}`);
    const proxyResult = await fetchHtmlOnce(url, true);
    if (proxyResult.ok) {
      logger.log('info', `Hiring Cafe HTTP proxy success: ${url}`);
      return proxyResult;
    }
    // Proxy also failed
    logger.log('warn', `Hiring Cafe HTTP proxy also failed: ${url} - ${proxyResult.error}`);
    return proxyResult;
  }

  // No proxy available or direct failed for non-CF reason
  if (directResult.cfBlocked) {
    logger.log('warn', `Hiring Cafe HTTP Cloudflare blocked (no proxy configured): ${url}`);
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

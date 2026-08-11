import axios, { AxiosInstance } from 'axios';
import http from 'http';
import https from 'https';
import ScrapeProfile from '../models/ScrapeProfile';
import { jobUrlHost } from './jobUrlNormalize';
import {
  isThinParse,
  looksLikeBotWall,
  parseJobPageHtml,
  ParsedJobFields,
  MAX_PARSE_BYTES,
} from './jobPageParser';
import logger from '../logger';

export type ScrapeTier = 1 | 2 | 3;

export interface ScrapeDoResult {
  ok: boolean;
  status: number;
  html: string;
  fields: ParsedJobFields;
  tier: ScrapeTier;
  creditsSpent: number;
  expired: boolean;
  rateLimited: boolean;
  error?: string;
}

const keepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 16 });
const keepAliveHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 16 });

const client: AxiosInstance = axios.create({
  timeout: 60_000,
  maxContentLength: MAX_PARSE_BYTES,
  maxBodyLength: MAX_PARSE_BYTES,
  httpsAgent: keepAliveAgent,
  httpAgent: keepAliveHttpAgent,
  // Accept all so we can inspect scrape.do / target status codes
  validateStatus: () => true,
  responseType: 'text',
  transitional: { forcedJSONParsing: false },
});

const GEO = process.env.SCRAPE_DO_GEO || 'northamerica';
const REPROBE_DAYS = parseInt(process.env.SCRAPE_PROFILE_REPROBE_DAYS || '30', 10);
const MIN_HTML_BYTES = 1500;

function token(): string {
  return (process.env.SCRAPE_DO_TOKEN || '').trim();
}

function tierParams(tier: ScrapeTier): Record<string, string> {
  if (tier === 1) return {};
  if (tier === 2) return { render: 'true' };
  return { render: 'true', super: 'true', regionalGeoCode: GEO };
}

function expectedCredits(tier: ScrapeTier): number {
  if (tier === 1) return 1;
  if (tier === 2) return 5;
  return 25;
}

function parseCostHeader(headers: Record<string, any>): number | null {
  const raw =
    headers['scrape.do-request-cost'] ||
    headers['Scrape.do-Request-Cost'] ||
    headers['x-request-cost'] ||
    headers['request-cost'];
  if (raw == null) return null;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export async function getLearnedTier(host: string): Promise<ScrapeTier> {
  if (!host) return 1;
  const profile = await ScrapeProfile.findById(host).lean();
  if (!profile) return 1;
  const last = profile.lastSuccessAt ? new Date(profile.lastSuccessAt).getTime() : 0;
  const ageDays = last ? (Date.now() - last) / (1000 * 60 * 60 * 24) : Infinity;
  // Periodically re-probe cheaper tiers so costs drift down when sites relax.
  if (ageDays > REPROBE_DAYS && profile.tier > 1) {
    return Math.max(1, (profile.tier as number) - 1) as ScrapeTier;
  }
  return Math.min(3, Math.max(1, profile.tier || 1)) as ScrapeTier;
}

export async function recordScrapeSuccess(host: string, tier: ScrapeTier, cost: number): Promise<void> {
  if (!host) return;
  const existing = await ScrapeProfile.findById(host).lean();
  const successes = (existing?.successes || 0) + 1;
  const prevAvg = existing?.avgCost || cost;
  const avgCost = prevAvg + (cost - prevAvg) / successes;
  await ScrapeProfile.findByIdAndUpdate(
    host,
    {
      $set: {
        _id: host,
        tier,
        successes,
        failures: existing?.failures || 0,
        lastSuccessAt: new Date(),
        avgCost,
      },
    },
    { upsert: true }
  );
}

export async function recordScrapeFailure(host: string, triedTier: ScrapeTier[]): Promise<void> {
  if (!host) return;
  const highest = Math.max(...triedTier) as ScrapeTier;
  const existing = await ScrapeProfile.findById(host).lean();
  const failures = (existing?.failures || 0) + 1;
  // Promote host after repeated failures so next URLs skip cheap tiers.
  const promote = (
    failures >= 3 ? Math.min(3, highest + (highest < 3 ? 1 : 0)) : highest
  ) as ScrapeTier;
  await ScrapeProfile.findByIdAndUpdate(
    host,
    {
      $set: {
        _id: host,
        tier: promote,
        successes: existing?.successes || 0,
        failures,
        lastSuccessAt: existing?.lastSuccessAt || null,
        avgCost: existing?.avgCost || expectedCredits(promote),
      },
    },
    { upsert: true }
  );
}

async function fetchTier(url: string, tier: ScrapeTier): Promise<{
  status: number;
  html: string;
  credits: number;
  headers: Record<string, any>;
}> {
  const t = token();
  if (!t) {
    throw new Error('SCRAPE_DO_TOKEN is not configured');
  }
  const params: Record<string, string> = {
    token: t,
    url,
    ...tierParams(tier),
  };
  const res = await client.get('https://api.scrape.do/', { params });
  const html = typeof res.data === 'string' ? res.data : res.data == null ? '' : String(res.data);
  const headerCost = parseCostHeader(res.headers as any);
  // Credits consumed on 2xx/400/404/410 per scrape.do docs
  const charged =
    res.status >= 200 && (res.status < 300 || [400, 404, 410].includes(res.status))
      ? headerCost ?? expectedCredits(tier)
      : 0;
  return { status: res.status, html, credits: charged, headers: res.headers as any };
}

function shouldEscalate(status: number, html: string, fields: ParsedJobFields): boolean {
  if (status === 403 || status === 503 || status === 429) return true;
  if (looksLikeBotWall(html)) return true;
  if (isThinParse(fields, Buffer.byteLength(html || '', 'utf8'))) return true;
  if (Buffer.byteLength(html || '', 'utf8') < MIN_HTML_BYTES) return true;
  return false;
}

/**
 * Fetch a job detail page via scrape.do, escalating tiers only when needed.
 * Starts at the learned host tier (or 1).
 */
export async function scrapeJobPage(url: string): Promise<ScrapeDoResult> {
  const host = jobUrlHost(url) || '';
  const startTier: ScrapeTier[] = [];
  let start: ScrapeTier = 1;
  try {
    start = await getLearnedTier(host);
  } catch {
    start = 1;
  }
  for (let t = start; t <= 3; t++) startTier.push(t as ScrapeTier);

  let totalCredits = 0;
  let lastError = '';
  const tried: ScrapeTier[] = [];

  for (const tier of startTier) {
    tried.push(tier);
    try {
      const { status, html, credits } = await fetchTier(url, tier);
      totalCredits += credits;

      if (status === 429) {
        return {
          ok: false,
          status,
          html: '',
          fields: parseJobPageHtml(''),
          tier,
          creditsSpent: totalCredits,
          expired: false,
          rateLimited: true,
          error: 'rate_limited',
        };
      }

      if (status === 404 || status === 410) {
        return {
          ok: false,
          status,
          html: '',
          fields: parseJobPageHtml(''),
          tier,
          creditsSpent: totalCredits,
          expired: true,
          rateLimited: false,
          error: `target_${status}`,
        };
      }

      if (status === 401) {
        return {
          ok: false,
          status,
          html: '',
          fields: parseJobPageHtml(''),
          tier,
          creditsSpent: totalCredits,
          expired: false,
          rateLimited: false,
          error: 'scrape_do_unauthorized_or_no_credits',
        };
      }

      const fields = parseJobPageHtml(html, url);
      const escalate = shouldEscalate(status, html, fields) && tier < 3;

      if (!escalate && status >= 200 && status < 400 && (fields.jobTitle || fields.jobDescription)) {
        await recordScrapeSuccess(host, tier, credits || expectedCredits(tier));
        return {
          ok: true,
          status,
          html,
          fields,
          tier,
          creditsSpent: totalCredits,
          expired: false,
          rateLimited: false,
        };
      }

      if (!escalate) {
        lastError = `tier_${tier}_status_${status}`;
        break;
      }
      lastError = `escalate_from_tier_${tier}_status_${status}`;
    } catch (err: any) {
      lastError = err?.message || String(err);
      logger.log('warn', `scrape.do tier ${tier} failed for host=${host}: ${lastError}`);
      if (tier === 3) break;
    }
  }

  await recordScrapeFailure(host, tried);
  return {
    ok: false,
    status: 0,
    html: '',
    fields: parseJobPageHtml(''),
    tier: tried[tried.length - 1] || 1,
    creditsSpent: totalCredits,
    expired: false,
    rateLimited: false,
    error: lastError || 'scrape_failed',
  };
}

export { keepAliveAgent as scrapeDoKeepAliveAgent };

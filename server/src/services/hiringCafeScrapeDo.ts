import { isHiringCafeJobPostingUrl } from './hiringCafeDetail';
import { isHiringCafeUrl } from './aggregatorIdentity';
import { detectLightHtmlJobPage } from './hiringCafeHtmlLight';
import { scrapeUrlHtml, type ScrapeTier } from './scrapeDoClient';
import type { HiringCafeScrapeDoOptions } from './hiringCafeEnrichmentConfig';
import logger from '../logger';

/** Cloudflare / bot-wall shells that should escalate to a higher Scrape.do tier. */
function looksLikeHcBotWall(html: string): boolean {
  const lower = String(html || '').toLowerCase();
  return (
    lower.includes('just a moment') ||
    lower.includes('checking your browser') ||
    lower.includes('cf-browser-verification') ||
    lower.includes('challenge-platform') ||
    lower.includes('attention required')
  );
}

export type HiringCafeScrapeDoFetchResult = {
  ok: boolean;
  html: string;
  method: 'scrape.do';
  light: boolean;
  tier: ScrapeTier;
  creditsSpent: number;
  status?: number;
  error?: string;
};

/**
 * Fetch a Hiring Cafe posting via Scrape.do (tier 2+ render).
 * Never called for employer / apply URLs — HC posting URLs only.
 */
export async function fetchHiringCafePostingViaScrapeDo(
  postingUrl: string,
  opts: HiringCafeScrapeDoOptions
): Promise<HiringCafeScrapeDoFetchResult> {
  const url = String(postingUrl || '').trim();
  if (!url || !isHiringCafeUrl(url) || !isHiringCafeJobPostingUrl(url)) {
    return {
      ok: false,
      html: '',
      method: 'scrape.do',
      light: false,
      tier: 2,
      creditsSpent: 0,
      error: 'Not a Hiring Cafe job posting URL',
    };
  }

  const maxTier = opts.maxTier ?? 2;
  const startTier = maxTier === 1 ? 1 : 2;
  const result = await scrapeUrlHtml(url, {
    token: opts.token,
    startTier,
    maxTier,
    useLearnedTier: false,
    shouldEscalate: (status, html) => {
      if (status === 403 || status === 503 || status === 429) return true;
      if (looksLikeHcBotWall(html)) return true;
      const detect = detectLightHtmlJobPage(html);
      return !detect.light;
    },
  });

  if (!result.ok) {
    logger.log(
      'warn',
      `Hiring Cafe Scrape.do failed: ${url} tier=${result.tier} err=${result.error || 'unknown'}`
    );
    return {
      ok: false,
      html: '',
      method: 'scrape.do',
      light: false,
      tier: result.tier,
      creditsSpent: result.creditsSpent,
      status: result.status,
      error: result.error,
    };
  }

  const detect = detectLightHtmlJobPage(result.html);
  logger.log(
    'info',
    `Hiring Cafe Scrape.do success: ${url} tier=${result.tier} credits=${result.creditsSpent}`
  );
  return {
    ok: detect.light,
    html: result.html,
    method: 'scrape.do',
    light: detect.light,
    tier: result.tier,
    creditsSpent: result.creditsSpent,
    status: result.status,
    error: detect.light ? undefined : 'Scrape.do HTML missing __NEXT_DATA__ job payload',
  };
}

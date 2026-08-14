import { isIP } from 'net';
import { acquirePooledPage, releasePooledPage } from './browserReusePool';
import { isThinParse, looksLikeBotWall, parseJobPageHtml, ParsedJobFields } from './jobPageParser';

type FailedScrape = {
  ok: boolean;
  status: number;
  tier: number;
  rateLimited: boolean;
  expired: boolean;
  error?: string;
};

const BROWSER_FALLBACK_CONCURRENCY = Math.max(
  1,
  parseInt(process.env.JOB_BROWSER_FALLBACK_CONCURRENCY || '2', 10) || 2
);
let activeFetches = 0;
const waitingFetches: Array<() => void> = [];

const BROWSER_FALLBACK_ALLOWED_HOSTS = (process.env.JOB_BROWSER_FALLBACK_ALLOWED_HOSTS || '')
  .split(',')
  .map((host) => host.trim().toLowerCase().replace(/^\./, ''))
  .filter(Boolean);

function isSafeAllowedHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\./, '');
  // Require a specific multi-label FQDN, never an IP, localhost, or a TLD.
  return (
    normalized.split('.').length >= 3 &&
    !normalized.endsWith('.localhost') &&
    normalized !== 'localhost' &&
    isIP(normalized) === 0
  );
}

/**
 * Browser fallback is opt-in per hostname. This keeps user-extracted URLs from
 * becoming an SSRF-capable browser navigation primitive.
 */
export function isBrowserFallbackHostAllowed(
  rawUrl: string,
  allowedHosts = BROWSER_FALLBACK_ALLOWED_HOSTS
): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.username || url.password || !url.hostname) return false;
  const hostname = url.hostname.toLowerCase();
  return allowedHosts.some((allowed) => {
    const normalized = allowed.trim().toLowerCase().replace(/^\./, '');
    return isSafeAllowedHost(normalized) && (hostname === normalized || hostname.endsWith(`.${normalized}`));
  });
}

/**
 * Browser fallback is a last resort, never the default scraping strategy.
 * It targets a completed scrape.do escalation blocked by a target-site WAF.
 */
export function shouldTryBrowserJobFallback(result: FailedScrape): boolean {
  if (result.ok || result.rateLimited || result.expired || result.tier < 3) return false;
  const error = String(result.error || '');
  return /(?:^|_)tier_3_status_\d{3}\b|escalate_from_tier_3_status_\d{3}\b/i.test(error);
}

async function acquireSlot(): Promise<void> {
  if (activeFetches < BROWSER_FALLBACK_CONCURRENCY) {
    activeFetches += 1;
    return;
  }
  await new Promise<void>((resolve) => waitingFetches.push(resolve));
}

function releaseSlot(): void {
  const handoff = waitingFetches.shift();
  if (handoff) {
    handoff();
    return;
  }
  activeFetches = Math.max(0, activeFetches - 1);
}

/**
 * Render a protected job page only after scrape.do's full escalation failed.
 * Returns null for a WAF challenge, thin page, navigation failure, or parse failure.
 */
export async function fetchBrowserJobFallback(pageUrl: string): Promise<{
  fields: ParsedJobFields;
  html: string;
} | null> {
  if (!isBrowserFallbackHostAllowed(pageUrl)) return null;
  await acquireSlot();
  let lease: Awaited<ReturnType<typeof acquirePooledPage>> | null = null;
  try {
    lease = await acquirePooledPage({
      profile: {
        browserType: 'playwright',
        headless: true,
        useStealth: true,
        poolIsolationKey: 'job-detail-browser-fallback',
      },
      maxPagesPerBrowser: BROWSER_FALLBACK_CONCURRENCY,
      blockResources: true,
    });
    await lease.page.route('**/*', async (route) => {
      if (!isBrowserFallbackHostAllowed(route.request().url())) {
        await route.abort('blockedbyclient');
        return;
      }
      await route.fallback();
    });
    await lease.page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await lease.page.waitForTimeout(1_500);
    const html = await lease.page.content();
    const fields = parseJobPageHtml(html, pageUrl);
    if (
      looksLikeBotWall(html) ||
      isThinParse(fields, Buffer.byteLength(html || '', 'utf8')) ||
      (!fields.jobTitle && !fields.jobDescription)
    ) {
      return null;
    }
    return { fields, html };
  } catch {
    return null;
  } finally {
    await releasePooledPage(lease);
    releaseSlot();
  }
}

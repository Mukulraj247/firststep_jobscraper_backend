import { createHash } from 'crypto';
import { fixGoogleCareersJobsUrl } from '../utils/googleCareersUrl';

/** Tracking / analytics query keys that never identify a job listing. */
const TRACKING_PARAM_RE =
  /^(utm_|fbclid$|gclid$|gbraid$|wbraid$|mc_eid$|mc_cid$|_ga$|_gl$|ref$|src$|trk$|si$|igshid$|mkt_tok$)/i;

/**
 * Search / pagination / locale params that appear on list scrapes but do not
 * identify a unique requisition. Keeping these caused Google Careers duplicates
 * (`...?page=3` vs `...?page=4` for the same /jobs/results/<id>-slug).
 */
const LISTING_NOISE_PARAMS = new Set([
  'page',
  'pagesize',
  'page_size',
  'p',
  'start',
  'offset',
  'from',
  'size',
  'limit',
  'hl',
  'lang',
  'language',
  'locale',
  'q',
  'query',
  'search',
  'keywords',
  'keyword',
  'location',
  'locations',
  'loc',
  'city',
  'country',
  'state',
  'remote',
  'sort',
  'sortby',
  'order',
  'orderby',
  'filter',
  'filters',
  'facet',
  'category',
  'department',
  'team',
]);

function isGoogleCareersJobPath(pathname: string): boolean {
  return /\/about\/careers\/applications\/jobs\/results\/\d+/i.test(pathname);
}

/**
 * Hosts whose apex domain redirects job-detail paths to a marketing homepage.
 * Keep these canonicalized on `www.` so enrichment hits the real posting.
 */
const FORCE_WWW_JOB_HOSTS = new Set(['careers.ford.com']);

/**
 * Normalize a job listing URL for deduplication.
 * Returns null when the input is not a usable http(s) URL.
 */
export function normalizeJobUrl(raw: unknown): string | null {
  if (raw == null) return null;
  const input = String(raw).trim();
  if (!input) return null;

  const healed = fixGoogleCareersJobsUrl(input);

  let parsed: URL;
  try {
    parsed = new URL(healed);
  } catch {
    try {
      parsed = new URL(`https://${healed}`);
    } catch {
      return null;
    }
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }

  parsed.hash = '';
  const apexHost = parsed.hostname.toLowerCase().replace(/^www\./, '');
  parsed.hostname = FORCE_WWW_JOB_HOSTS.has(apexHost) ? `www.${apexHost}` : apexHost;
  parsed.protocol = 'https:';
  parsed.username = '';
  parsed.password = '';

  let pathname = parsed.pathname || '/';
  if (pathname.length > 1 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }
  parsed.pathname = pathname;

  // Google Careers: the numeric id in the path uniquely identifies the job.
  // Drop all query noise from list pagination / locale / search filters.
  if (
    (parsed.hostname === 'google.com' || parsed.hostname.endsWith('.google.com')) &&
    isGoogleCareersJobPath(pathname)
  ) {
    parsed.search = '';
    return fixGoogleCareersJobsUrl(parsed.toString());
  }

  const kept = new URLSearchParams();
  const entries: Array<[string, string]> = [];
  parsed.searchParams.forEach((value, key) => {
    const k = key.toLowerCase();
    if (TRACKING_PARAM_RE.test(key) || TRACKING_PARAM_RE.test(k)) return;
    if (LISTING_NOISE_PARAMS.has(k)) return;
    entries.push([key, value]);
  });
  entries.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  for (const [key, value] of entries) {
    kept.append(key, value);
  }
  parsed.search = kept.toString() ? `?${kept.toString()}` : '';

  return fixGoogleCareersJobsUrl(parsed.toString());
}

/** SHA-256 hex digest of a normalized job URL (or null when normalization fails). */
export function jobUrlKey(raw: unknown): string | null {
  const normalized = normalizeJobUrl(raw);
  if (!normalized) return null;
  return createHash('sha256').update(normalized).digest('hex');
}

/** Hostname without www for scrape profile lookups. */
export function jobUrlHost(raw: unknown): string | null {
  const normalized = normalizeJobUrl(raw);
  if (!normalized) return null;
  try {
    return new URL(normalized).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

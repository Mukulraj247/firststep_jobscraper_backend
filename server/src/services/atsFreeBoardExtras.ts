/**
 * Extra free ATS board providers (no scrape.do / no Chromium when JSON works).
 * Exact robot start URLs are preserved — filters stay on pageUrl / query.
 */
import type { AxiosInstance } from 'axios';
import * as cheerio from 'cheerio';
import { fixGoogleCareersJobsUrl } from '../utils/googleCareersUrl';

export type ExtraBoardProvider =
  | 'workday'
  | 'workable'
  | 'recruitee'
  | 'bamboohr'
  | 'personio'
  | 'breezy'
  | 'googlecareers'
  | 'ibmcareers';

export type ExtraBoardDetection = {
  provider: ExtraBoardProvider;
  companyHint: string;
  listApiUrl: string;
};

export type ExtraBoardJobRow = {
  jobUrl: string;
  url: string;
  jobTitle: string;
  title: string;
  companyName: string;
  company: string;
  location: string;
  employmentType?: string;
  date?: string;
  department?: string;
  jobDescription?: string;
  description?: string;
};

type FetchOpts = { maxPages?: number; maxItems?: number };

const WORKDAY_PAGINATION_KEYS = new Set([
  'page',
  'pagesize',
  'pg',
  'p',
  'start',
  'startrow',
  'offset',
  'from',
  'limit',
  'rows',
  'sort',
  'sort_by',
  'sortby',
  'descending',
]);

const WORKDAY_SEARCH_TEXT_KEYS = new Set(['q', 'query', 'search', 'searchtext', 'searchstring']);

const WORKDAY_KNOWN_FACETS = new Set([
  'locationcountry',
  'jobfamilygroup',
  'workersubtype',
  'timetype',
  'locationhierarchy',
  'jobfamily',
  'workertype',
]);

/** Salesforce marketing query keys are human labels, not Workday facet IDs. */
const WORKDAY_SKIP_FACET_KEYS = new Set(['team', 'country', 'location', 'locations', 'department', 'category']);

export function workdayAppliedFacetsFromUrl(pageUrl: string): Record<string, string[]> {
  const facets: Record<string, string[]> = {};
  try {
    const parsed = new URL(pageUrl);
    for (const [key, raw] of parsed.searchParams.entries()) {
      const value = String(raw || '').trim();
      if (!value) continue;
      const kl = key.toLowerCase();
      if (WORKDAY_PAGINATION_KEYS.has(kl) || WORKDAY_SEARCH_TEXT_KEYS.has(kl)) continue;
      if (WORKDAY_SKIP_FACET_KEYS.has(kl)) continue;
      const looksHashed = /^[a-f0-9]{16,}$/i.test(value);
      if (!WORKDAY_KNOWN_FACETS.has(kl) && !looksHashed) continue;
      if (!facets[key]) facets[key] = [];
      if (!facets[key].includes(value)) facets[key].push(value);
    }
  } catch {
    return {};
  }
  return facets;
}

function titleCaseToken(token: string): string {
  const key = token.toLowerCase();
  if (key.length <= 3) return key.toUpperCase();
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function workdayCompanyHint(tenant: string): string {
  const known: Record<string, string> = {
    td: 'TD',
    mtb: 'M&T Bank',
    intel: 'Intel',
    nationwide: 'Nationwide',
    bbt: 'BB&T',
  };
  return known[tenant.toLowerCase()] || titleCaseToken(tenant);
}

function rowFrom(
  jobUrl: string,
  title: string,
  company: string,
  location = '',
  extra?: Partial<ExtraBoardJobRow>
): ExtraBoardJobRow {
  const t = String(title || '').trim();
  const c = String(company || '').trim();
  const u = String(jobUrl || '').trim();
  return {
    jobUrl: u,
    url: u,
    jobTitle: t,
    title: t,
    companyName: c,
    company: c,
    location: String(location || '').trim(),
    ...extra,
  };
}

function sleepMs(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function boardMaxJobs(): number {
  return Math.max(50, parseInt(process.env.ATS_BOARD_MAX_JOBS || '2000', 10) || 2000);
}

function limitedPages(opts?: FetchOpts): number {
  const raw = opts?.maxPages;
  if (typeof raw === 'number' && raw > 0) return Math.min(raw, 200);
  return Math.max(1, parseInt(process.env.ATS_BOARD_MAX_PAGES || '50', 10) || 50);
}

/** Placeholder site slug when the robot URL is only the Workday host. */
export const WORKDAY_SITE_RESOLVE = '__resolve__';

const WORKDAY_TENANT_SITES: Record<string, string> = {
  broadcom: 'External_Career',
};

const WORKDAY_SITE_GUESSES = [
  'External_Career',
  'External',
  'External_Career_Site',
  'External_Careers',
];

function workdayListApiUrl(host: string, tenant: string, site: string): string {
  return `https://${host}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}/jobs`;
}

function workdaySiteCandidates(tenant: string, detectedSite: string): string[] {
  const decoded = decodeURIComponent(detectedSite || '');
  if (decoded && decoded !== WORKDAY_SITE_RESOLVE) return [decoded];
  const ordered: string[] = [];
  const add = (value?: string) => {
    const site = String(value || '').trim();
    if (!site || site === WORKDAY_SITE_RESOLVE || ordered.includes(site)) return;
    ordered.push(site);
  };
  add(WORKDAY_TENANT_SITES[tenant.toLowerCase()]);
  for (const guess of WORKDAY_SITE_GUESSES) add(guess);
  add(tenant);
  return ordered;
}

/** Detect Workday CXS board from myworkdayjobs URL (site path preserved). */
export function detectWorkdayBoard(url: string): ExtraBoardDetection | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const m = host.match(/^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/i);
  if (!m) return null;
  const tenant = m[1];
  const parts = parsed.pathname.split('/').filter(Boolean);
  const localeLike = /^(?:en|fr|de|es|pt|zh|ja|ko|it|nl|sv|da|fi|pl|tr)(?:-[a-z]{2})?$/i;
  const filtered = parts.filter((p) => !localeLike.test(p) && !/^(wday|cxs)$/i.test(p));
  const site = filtered[0];
  if (site && /^(job|jobs|details)$/i.test(site)) return null;
  const siteKey = site || WORKDAY_SITE_RESOLVE;
  return {
    provider: 'workday',
    companyHint: workdayCompanyHint(tenant),
    listApiUrl: workdayListApiUrl(host, tenant, siteKey),
  };
}

export function detectWorkableBoard(url: string): ExtraBoardDetection | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== 'apply.workable.com' && !host.endsWith('.workable.com')) return null;
  const parts = parsed.pathname.split('/').filter(Boolean);
  const account = host === 'apply.workable.com' ? parts[0] : host.split('.')[0];
  if (!account || /^(api|j)$/i.test(account)) return null;
  return {
    provider: 'workable',
    companyHint: titleCaseToken(account),
    listApiUrl: `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(account)}`,
  };
}

export function detectRecruiteeBoard(url: string): ExtraBoardDetection | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const m = host.match(/^([a-z0-9-]+)\.recruitee\.com$/i);
  if (!m) return null;
  const company = m[1];
  return {
    provider: 'recruitee',
    companyHint: titleCaseToken(company),
    listApiUrl: `https://${company}.recruitee.com/api/offers/`,
  };
}

export function detectBambooHrBoard(url: string): ExtraBoardDetection | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const m = host.match(/^([a-z0-9-]+)\.bamboohr\.com$/i);
  if (!m) return null;
  const company = m[1];
  return {
    provider: 'bamboohr',
    companyHint: titleCaseToken(company),
    listApiUrl: `https://${company}.bamboohr.com/careers/list`,
  };
}

export function detectPersonioBoard(url: string): ExtraBoardDetection | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const m = host.match(/^([a-z0-9-]+)\.jobs\.personio\.(com|de|es|fr|nl)$/i);
  if (!m) return null;
  const company = m[1];
  const tld = m[2];
  return {
    provider: 'personio',
    companyHint: titleCaseToken(company),
    listApiUrl: `https://${company}.jobs.personio.${tld}/xml`,
  };
}

export function detectBreezyBoard(url: string): ExtraBoardDetection | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const m = host.match(/^([a-z0-9-]+)\.breezy\.hr$/i);
  if (!m) return null;
  const company = m[1];
  return {
    provider: 'breezy',
    companyHint: titleCaseToken(company),
    listApiUrl: `https://${company}.breezy.hr/json`,
  };
}

/** Google Careers search/results pages — free HTML list (exact URL + filters). */
export function detectGoogleCareersBoard(url: string): ExtraBoardDetection | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'google.com' && !host.endsWith('.google.com')) return null;
  const path = parsed.pathname.replace(/\/+$/, '') || '/';
  // Detail pages: /jobs/results/<numericId>-slug (applications or careers.google.com)
  if (/\/jobs\/results\/\d+/i.test(path)) return null;
  const isApplicationsList = /\/about\/careers\/applications\/jobs\/results$/i.test(path);
  const isCareersGoogleList =
    host === 'careers.google.com' && /\/jobs\/results$/i.test(path);
  if (!isApplicationsList && !isCareersGoogleList) return null;
  const clean = new URL(parsed.href);
  clean.hash = '';
  if (clean.hostname === 'google.com') clean.hostname = 'www.google.com';
  return {
    provider: 'googlecareers',
    companyHint: 'Google',
    listApiUrl: clean.toString(),
  };
}

/** Drupal facet keys like field_keyword_05[0]=United States. */
function ibmDrupalFacetValues(searchParams: URLSearchParams, field: string): string[] {
  const values: string[] = [];
  const prefix = `${field}[`;
  for (const [key, raw] of searchParams.entries()) {
    if (key !== field && key !== `${field}[]` && !key.startsWith(prefix)) continue;
    const value = String(raw || '').trim();
    if (value) values.push(value);
  }
  return values;
}

/**
 * ibm.com/careers/search is a heavy Drupal/Akamai SPA. Chromium times out or
 * crashes there. Avature SearchJobs HTML is the same postings, over HTTP.
 */
function rewriteIbmMarketingSearchToAvature(parsed: URL): string {
  const out = new URL('https://careers.ibm.com/SearchJobs');
  const locations = ibmDrupalFacetValues(parsed.searchParams, 'field_keyword_05');
  if (locations[0]) out.searchParams.set('location', locations[0]);
  const q = String(parsed.searchParams.get('q') || '').trim();
  if (q) out.searchParams.set('q', q);
  return out.toString();
}

function isIbmMarketingCareersSearch(parsed: URL): boolean {
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'ibm.com') return false;
  return /(?:^|\/)[a-z]{2}-[a-z]{2}\/careers\/search\/?$|^\/careers\/search\/?$/i.test(
    parsed.pathname
  );
}

/** IBM Careers SearchJobs — free HTML list (exact URL + filters). */
export function detectIbmCareersBoard(url: string): ExtraBoardDetection | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (isIbmMarketingCareersSearch(parsed)) {
    return {
      provider: 'ibmcareers',
      companyHint: 'IBM',
      listApiUrl: rewriteIbmMarketingSearchToAvature(parsed),
    };
  }
  if (host !== 'careers.ibm.com' && host !== 'ibmglobal.avature.net') return null;
  if (/JobDetail/i.test(parsed.pathname)) return null;
  if (!/SearchJobs/i.test(parsed.pathname)) return null;
  const clean = new URL(parsed.href);
  clean.hash = '';
  return {
    provider: 'ibmcareers',
    companyHint: 'IBM',
    listApiUrl: clean.toString(),
  };
}

export function detectExtraAtsBoard(url: string): ExtraBoardDetection | null {
  return (
    detectWorkdayBoard(url) ||
    detectWorkableBoard(url) ||
    detectRecruiteeBoard(url) ||
    detectBambooHrBoard(url) ||
    detectPersonioBoard(url) ||
    detectBreezyBoard(url) ||
    detectGoogleCareersBoard(url) ||
    detectIbmCareersBoard(url)
  );
}

export async function fetchExtraAtsBoardJobs(
  pageUrl: string,
  detected: ExtraBoardDetection,
  httpClient: AxiosInstance,
  options?: FetchOpts
): Promise<{ provider: ExtraBoardProvider; companyHint: string; rows: ExtraBoardJobRow[] } | null> {
  switch (detected.provider) {
    case 'workday':
      return fetchWorkdayBoard(pageUrl, detected, httpClient, options);
    case 'workable':
      return fetchWorkableBoard(detected, httpClient);
    case 'recruitee':
      return fetchRecruiteeBoard(detected, httpClient);
    case 'bamboohr':
      return fetchBambooBoard(detected, httpClient);
    case 'personio':
      return fetchPersonioBoard(detected, httpClient);
    case 'breezy':
      return fetchBreezyBoard(detected, httpClient);
    case 'googlecareers':
      return fetchGoogleCareersBoard(pageUrl, detected, httpClient, options);
    case 'ibmcareers':
      return fetchIbmCareersBoard(pageUrl, detected, httpClient, options);
    default:
      return null;
  }
}

function parseWorkdayCxsJobsUrl(
  listApiUrl: string
): { host: string; tenant: string; site: string } | null {
  try {
    const parsed = new URL(listApiUrl);
    const match = parsed.pathname.match(/^\/wday\/cxs\/([^/]+)\/([^/]+)\/jobs\/?$/i);
    if (!match) return null;
    return {
      host: parsed.hostname,
      tenant: decodeURIComponent(match[1]),
      site: decodeURIComponent(match[2]),
    };
  } catch {
    return null;
  }
}

function isCountryOnlyWorkdaySearchText(value: string): boolean {
  const k = String(value || '')
    .toLowerCase()
    .replace(/\buntied\b/g, 'united')
    .replace(/[.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (
    k === 'united states' ||
    k === 'united states of america' ||
    k === 'usa' ||
    k === 'us' ||
    k === 'u s' ||
    k === 'america'
  );
}

function workdaySearchTextFromPageUrl(pageUrl: string): string {
  try {
    const source = new URL(pageUrl);
    const raw =
      source.searchParams.get('searchText') ||
      source.searchParams.get('q') ||
      source.searchParams.get('query') ||
      '';
    const text = String(raw || '').replace(/\buntied\b/gi, 'united').trim();
    if (!text || isCountryOnlyWorkdaySearchText(text)) return '';
    return text;
  } catch {
    return '';
  }
}

function workdayLocationFromPosting(job: any): string {
  const listed = String(job?.locationsText || job?.location || '').trim();
  const path = String(job?.externalPath || job?.externalUrl || '');
  const slug = (path.match(/\/job\/([^/]+)/i)?.[1] || '').replace(/-/g, ' ').trim();
  if (!listed || /^\d+\s+locations?$/i.test(listed)) return slug || listed;
  if (slug && /^usa\b/i.test(slug) && !/\b(usa|united states)\b/i.test(listed)) {
    return `${listed} ${slug}`;
  }
  return listed;
}

async function fetchWorkdayBoard(
  pageUrl: string,
  detected: ExtraBoardDetection,
  httpClient: AxiosInstance,
  options?: FetchOpts
) {
  const source = new URL(pageUrl);
  const searchText = workdaySearchTextFromPageUrl(pageUrl);
  const cxs = parseWorkdayCxsJobsUrl(detected.listApiUrl);
  const host = cxs?.host || source.hostname;
  const tenant = cxs?.tenant || host.match(/^([a-z0-9-]+)\.wd\d+\./i)?.[1] || '';
  const detectedSite =
    cxs?.site || detected.listApiUrl.split('/').filter(Boolean).slice(-2, -1)[0] || '';
  const maxPages = limitedPages(options);
  const maxJobs = boardMaxJobs();
  const limit = 20;
  const hasExplicitWorkdayGeo =
    source.searchParams.has('country') ||
    source.searchParams.has('locationCountry') ||
    source.searchParams.getAll('location').some((v) => String(v).trim());
  const wantsFacets =
    source.searchParams.has('country') ||
    source.searchParams.has('team') ||
    source.searchParams.has('jobFamilyGroup') ||
    !hasExplicitWorkdayGeo;

  for (const site of workdaySiteCandidates(tenant, detectedSite)) {
    const listApiUrl = workdayListApiUrl(host, tenant, site);
    let appliedFacets: Record<string, string[]> = {};

    const postPage = async (offset: number, facets: Record<string, string[]>) =>
      httpClient.post(
        listApiUrl,
        { appliedFacets: facets, limit, offset, searchText },
        {
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
        }
      );

    appliedFacets = { ...workdayAppliedFacetsFromUrl(pageUrl) };
    if (wantsFacets) {
      const probe = await postPage(0, {});
      if (probe.status < 400 && probe.data) {
        appliedFacets = {
          ...appliedFacets,
          ...workdayAppliedFacetsFromPageUrl(pageUrl, probe.data?.facets),
        };
      }
    }

    const all: ExtraBoardJobRow[] = [];
    let offset = 0;
    for (let page = 0; page < maxPages && all.length < maxJobs; page++) {
      const res = await postPage(offset, appliedFacets);
      if (res.status >= 400 || !res.data) break;
      const postings = Array.isArray(res.data?.jobPostings) ? res.data.jobPostings : [];
      if (!postings.length) break;
      for (const job of postings) {
        const externalPath = String(job.externalPath || job.externalUrl || '').trim();
        let jobUrl = '';
        if (/^https?:\/\//i.test(externalPath)) jobUrl = externalPath;
        else if (externalPath.startsWith('/')) jobUrl = `https://${host}${externalPath}`;
        else if (externalPath && site)
          jobUrl = `https://${host}/${site}${externalPath.startsWith('/') ? '' : '/'}${externalPath}`;
        if (!jobUrl) continue;
        all.push(
          rowFrom(
            jobUrl,
            job.title || job.jobTitle || '',
            detected.companyHint,
            workdayLocationFromPosting(job),
            { date: job.postedOn || job.startDate || '' }
          )
        );
      }
      offset += limit;
      const total = typeof res.data?.total === 'number' ? res.data.total : Infinity;
      if (offset >= total || postings.length < limit) break;
      await sleepMs(150);
    }
    if (all.length) {
      return { provider: 'workday' as const, companyHint: detected.companyHint, rows: all.slice(0, maxJobs) };
    }
  }
  return null;
}

function workdayNormToken(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function workdayFacetIdsForLabels(
  facet: { values?: Array<{ descriptor?: string; id?: string }> } | undefined,
  labels: string[]
): string[] {
  if (!facet || !labels.length) return [];
  const values = Array.isArray(facet.values) ? facet.values : [];
  const ids: string[] = [];
  for (const label of labels) {
    const want = workdayNormToken(label);
    if (!want) continue;
    const hit = values.find((entry) => {
      const have = workdayNormToken(String(entry?.descriptor || ''));
      return have === want || have.includes(want) || want.includes(have);
    });
    if (hit?.id && !ids.includes(hit.id)) ids.push(hit.id);
  }
  return ids;
}

function workdayAppliedFacetsFromPageUrl(pageUrl: string, facets: unknown): Record<string, string[]> {
  let parsed: URL;
  try {
    parsed = new URL(pageUrl);
  } catch {
    return {};
  }
  const countries = parsed.searchParams.getAll('country').map((v) => v.trim()).filter(Boolean);
  const hasExplicitGeo =
    countries.length > 0 ||
    parsed.searchParams.getAll('location').some((v) => v.trim()) ||
    !!(parsed.searchParams.get('locationCountry') || '').trim();
  if (!countries.length && !hasExplicitGeo) countries.push('United States');
  const teams = parsed.searchParams
    .getAll('team')
    .concat(parsed.searchParams.getAll('jobFamilyGroup'))
    .map((v) => v.trim())
    .filter(Boolean);
  if (!countries.length && !teams.length) return {};
  const list = Array.isArray(facets) ? facets : [];
  const applied: Record<string, string[]> = {};
  for (const facet of list) {
    const param = String(facet?.facetParameter || '').trim();
    if (!param) continue;
    const descriptor = workdayNormToken(String(facet?.descriptor || ''));
    if (countries.length && (/country/i.test(param) || descriptor === 'country')) {
      const ids = workdayFacetIdsForLabels(facet, countries);
      if (ids.length) applied[param] = ids;
    }
    if (teams.length && (param === 'jobFamilyGroup' || descriptor === 'job category')) {
      const ids = workdayFacetIdsForLabels(facet, teams);
      if (ids.length) applied[param] = ids;
    }
  }
  return applied;
}

async function fetchWorkableBoard(detected: ExtraBoardDetection, httpClient: AxiosInstance) {
  const res = await httpClient.get(`${detected.listApiUrl}/jobs`, {
    headers: { Accept: 'application/json' },
  });
  if (res.status >= 400 || !res.data) return null;
  const jobs = Array.isArray(res.data?.jobs) ? res.data.jobs : Array.isArray(res.data) ? res.data : [];
  const account = detected.listApiUrl.split('/').pop() || '';
  const rows = jobs
    .map((job: any) => {
      const shortcode = job.shortcode || job.id || '';
      const jobUrl =
        job.url ||
        job.application_url ||
        (shortcode ? `https://apply.workable.com/${account}/j/${shortcode}` : '');
      return rowFrom(jobUrl, job.title || '', detected.companyHint, job.location?.city || job.city || '');
    })
    .filter((r: ExtraBoardJobRow) => r.jobUrl && r.jobTitle);
  if (!rows.length) return null;
  return { provider: 'workable' as const, companyHint: detected.companyHint, rows };
}

async function fetchRecruiteeBoard(detected: ExtraBoardDetection, httpClient: AxiosInstance) {
  const res = await httpClient.get(detected.listApiUrl, { headers: { Accept: 'application/json' } });
  if (res.status >= 400 || !res.data) return null;
  const offers = Array.isArray(res.data?.offers) ? res.data.offers : [];
  const host = new URL(detected.listApiUrl).hostname;
  const rows = offers
    .map((job: any) => {
      const slug = job.slug || job.id || '';
      const jobUrl = job.careers_url || (slug ? `https://${host}/o/${slug}` : '');
      return rowFrom(
        jobUrl,
        job.title || '',
        detected.companyHint,
        Array.isArray(job.locations)
          ? job.locations.map((l: any) => l.city || l.name || '').filter(Boolean).join(', ')
          : ''
      );
    })
    .filter((r: ExtraBoardJobRow) => r.jobUrl && r.jobTitle);
  if (!rows.length) return null;
  return { provider: 'recruitee' as const, companyHint: detected.companyHint, rows };
}

async function fetchBambooBoard(detected: ExtraBoardDetection, httpClient: AxiosInstance) {
  const res = await httpClient.get(detected.listApiUrl, { headers: { Accept: 'application/json' } });
  if (res.status >= 400 || !res.data) return null;
  const result = Array.isArray(res.data?.result) ? res.data.result : Array.isArray(res.data) ? res.data : [];
  const company = new URL(detected.listApiUrl).hostname.split('.')[0];
  const rows = result
    .map((job: any) => {
      const id = job.id || job.jobOpeningId || '';
      const jobUrl =
        job.jobOpeningShareUrl ||
        job.shareUrl ||
        (id ? `https://${company}.bamboohr.com/careers/${id}` : '');
      return rowFrom(jobUrl, job.jobOpeningName || job.jobName || job.title || '', detected.companyHint, job.locationLabel || job.location || '');
    })
    .filter((r: ExtraBoardJobRow) => r.jobUrl && r.jobTitle);
  if (!rows.length) return null;
  return { provider: 'bamboohr' as const, companyHint: detected.companyHint, rows };
}

async function fetchPersonioBoard(detected: ExtraBoardDetection, httpClient: AxiosInstance) {
  const res = await httpClient.get(detected.listApiUrl, {
    headers: { Accept: 'application/xml,text/xml,*/*' },
    responseType: 'text',
    transitional: { forcedJSONParsing: false },
  });
  if (res.status >= 400 || !res.data) return null;
  const xml = String(res.data);
  const $ = cheerio.load(xml, { xmlMode: true });
  const rows: ExtraBoardJobRow[] = [];
  $('position, job').each((_, el) => {
    const title = $(el).find('name, title').first().text().trim();
    const id = $(el).find('id').first().text().trim() || $(el).attr('id') || '';
    const office = $(el).find('office, city, location').first().text().trim();
    const host = new URL(detected.listApiUrl).hostname;
    const jobUrl = id ? `https://${host}/job/${id}` : '';
    if (title && jobUrl) rows.push(rowFrom(jobUrl, title, detected.companyHint, office));
  });
  if (!rows.length) return null;
  return { provider: 'personio' as const, companyHint: detected.companyHint, rows };
}

async function fetchBreezyBoard(detected: ExtraBoardDetection, httpClient: AxiosInstance) {
  const res = await httpClient.get(detected.listApiUrl, { headers: { Accept: 'application/json' } });
  if (res.status >= 400 || !res.data) return null;
  const jobs = Array.isArray(res.data) ? res.data : [];
  const host = new URL(detected.listApiUrl).hostname;
  const rows = jobs
    .map((job: any) => {
      const slug = job.friendly_id || job.id || '';
      const jobUrl = job.url || (slug ? `https://${host}/p/${slug}` : '');
      const loc = job.location?.name || job.location || '';
      return rowFrom(jobUrl, job.name || job.title || '', detected.companyHint, String(loc));
    })
    .filter((r: ExtraBoardJobRow) => r.jobUrl && r.jobTitle);
  if (!rows.length) return null;
  return { provider: 'breezy' as const, companyHint: detected.companyHint, rows };
}

async function fetchGoogleCareersBoard(
  pageUrl: string,
  detected: ExtraBoardDetection,
  httpClient: AxiosInstance,
  options?: FetchOpts
) {
  const maxPages = Math.min(limitedPages(options), 20);
  const maxJobs = boardMaxJobs();
  const seen = new Set<string>();
  const rows: ExtraBoardJobRow[] = [];
  const base = new URL(detected.listApiUrl || pageUrl);

  for (let page = 1; page <= maxPages && rows.length < maxJobs; page++) {
    const u = new URL(base.toString());
    if (page > 1) u.searchParams.set('page', String(page));
    const res = await httpClient.get(u.toString(), {
      headers: {
        Accept: 'text/html',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
      responseType: 'text',
      transitional: { forcedJSONParsing: false },
    });
    if (res.status >= 400 || !res.data) break;
    const $ = cheerio.load(String(res.data));
    let found = 0;
    $('a[href*="/jobs/results/"]').each((_, el) => {
      let href = String($(el).attr('href') || '').trim();
      if (!href) return;
      try {
        href = fixGoogleCareersJobsUrl(new URL(href, u).toString());
      } catch {
        return;
      }
      if (!/\/jobs\/results\/\d+/i.test(href)) return;
      if (seen.has(href)) return;
      seen.add(href);
      const title = $(el).text().replace(/\s+/g, ' ').trim();
      if (!title || title.length < 3) return;
      rows.push(rowFrom(href, title, 'Google'));
      found += 1;
    });
    if (!found) break;
    await sleepMs(200);
  }
  if (!rows.length) return null;
  return { provider: 'googlecareers' as const, companyHint: 'Google', rows: rows.slice(0, maxJobs) };
}

async function fetchIbmCareersBoard(
  pageUrl: string,
  detected: ExtraBoardDetection,
  httpClient: AxiosInstance,
  options?: FetchOpts
) {
  const maxPages = Math.min(limitedPages(options), 15);
  const maxJobs = boardMaxJobs();
  const seen = new Set<string>();
  const rows: ExtraBoardJobRow[] = [];
  const base = new URL(detected.listApiUrl || pageUrl);

  for (let page = 1; page <= maxPages && rows.length < maxJobs; page++) {
    const u = new URL(base.toString());
    if (page > 1) {
      u.searchParams.set('page', String(page));
      u.searchParams.set('currentPage', String(page));
    }
    const res = await httpClient.get(u.toString(), {
      headers: {
        Accept: 'text/html',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      },
      responseType: 'text',
      transitional: { forcedJSONParsing: false },
    });
    if (res.status >= 400 || !res.data) break;
    const $ = cheerio.load(String(res.data));
    let found = 0;
    $('a[href*="JobDetail"], a[href*="jobId="]').each((_, el) => {
      let href = String($(el).attr('href') || '').trim();
      if (!href) return;
      try {
        href = new URL(href, u).toString();
      } catch {
        return;
      }
      if (!/jobId=/i.test(href) && !/JobDetail/i.test(href)) return;
      if (seen.has(href)) return;
      seen.add(href);
      const title = $(el).text().replace(/\s+/g, ' ').trim();
      if (!title || title.length < 3) return;
      rows.push(rowFrom(href, title, 'IBM'));
      found += 1;
    });
    if (!found) break;
    await sleepMs(250);
  }
  if (!rows.length) return null;
  return { provider: 'ibmcareers' as const, companyHint: 'IBM', rows: rows.slice(0, maxJobs) };
}

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

type FetchOpts = { maxPages?: number };

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
  if (!site || /^(job|jobs|details)$/i.test(site)) return null;
  return {
    provider: 'workday',
    companyHint: workdayCompanyHint(tenant),
    listApiUrl: `https://${host}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}/jobs`,
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

async function fetchWorkdayBoard(
  pageUrl: string,
  detected: ExtraBoardDetection,
  httpClient: AxiosInstance,
  options?: FetchOpts
) {
  const source = new URL(pageUrl);
  const searchText =
    source.searchParams.get('searchText') ||
    source.searchParams.get('q') ||
    source.searchParams.get('query') ||
    '';
  const host = source.hostname;
  const site = detected.listApiUrl.split('/').filter(Boolean).slice(-2, -1)[0] || '';
  const maxPages = limitedPages(options);
  const maxJobs = boardMaxJobs();
  const all: ExtraBoardJobRow[] = [];
  let offset = 0;
  const limit = 20;
  for (let page = 0; page < maxPages && all.length < maxJobs; page++) {
    const res = await httpClient.post(
      detected.listApiUrl,
      { appliedFacets: {}, limit, offset, searchText },
      {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      }
    );
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
          job.locationsText || job.location || '',
          { date: job.postedOn || job.startDate || '' }
        )
      );
    }
    offset += limit;
    const total = typeof res.data?.total === 'number' ? res.data.total : Infinity;
    if (offset >= total || postings.length < limit) break;
    await sleepMs(150);
  }
  if (!all.length) return null;
  return { provider: 'workday' as const, companyHint: detected.companyHint, rows: all.slice(0, maxJobs) };
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

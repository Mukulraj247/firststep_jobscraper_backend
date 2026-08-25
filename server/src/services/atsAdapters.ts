import axios, { AxiosInstance } from 'axios';
import http from 'http';
import https from 'https';
import { isIP } from 'net';
import * as cheerio from 'cheerio';
import { ParsedJobFields } from './jobPageParser';
import {
  stripHtmlTags,
  isPortalCompanyName,
  parseJobPageHtml,
  normalizeLocation,
  normalizeSalaryRange,
  isJunkDescription,
  isThinParse,
} from './jobPageParser';
import { resolveSafeOutboundUrl, UnsafeOutboundUrlError } from '../utils/outboundUrlPolicy';
import { assertPinnedPeerInAllowlist, createPinnedLookup } from './safeOutboundHttp';
import { DIRECTORY_CAREER_HTML_HOST_COMPANIES } from './careerHtmlHostsDirectory';
import { DIRECTORY_PHENOM_BOARD_HOSTS } from './phenomBoardHostsDirectory';
import { detectExtraAtsBoard, fetchExtraAtsBoardJobs } from './atsFreeBoardExtras';
import {
  applePositionIdFromUrl,
  isAppleJobsHost,
  isMicrosoftCareersHost,
  mapAppleSearchResult,
  mapPhenomJobRecord,
  microsoftJobIdFromUrl,
  parseAppleJobsHydration,
  parsePhenomJobDdo,
} from './spaEmbeddedJobJson';

export type AtsProvider =
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'workable'
  | 'smartrecruiters'
  | 'recruitee'
  | 'oraclecloud'
  | 'googlecareers'
  | 'ibmcareers'
  | 'applejobs'
  | 'microsoftcareers'
  | 'workday'
  | 'eightfold'
  | 'icims'
  | 'taleo'
  | 'njoyn'
  | 'careerhtml';

export interface AtsFetchResult {
  provider: AtsProvider;
  fields: ParsedJobFields;
  /** ATS requisition / posting id when available (e.g. Oracle Id). */
  externalJobId?: string;
}

const keepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 16 });
const keepAliveHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 16 });

/**
 * Career-site hosts that front a Greenhouse board under a vanity URL.
 * Key = hostname without www.; value = Greenhouse board token.
 * Extend when we discover more `?gh_jid=` / `/careers/listing/{slug}/{id}` sites.
 */
const GREENHOUSE_VANITY_BOARDS: Record<string, string> = {
  'stripe.com': 'stripe',
  'asana.com': 'asana',
  'okta.com': 'okta',
  'github.com': 'github',
  'github.careers': 'github',
  'docusign.com': 'docusign',
  'careers.docusign.com': 'docusign',
  'jobs.twilio.com': 'twilio',
  'twilio.com': 'twilio',
};

const SALESFORCE_WORKDAY_BASE =
  'https://salesforce.wd12.myworkdayjobs.com/wday/cxs/salesforce/External_Career_Site';

const ORACLE_HCM_VANITY_HOST_COMPANIES: Record<string, string> = {
  'enterpriseplatform.dell.com': 'Dell',
};

/**
 * Hash-router vanity career hosts → Oracle Fusion CE API host.
 * Prefer this over scraping the vanity landing HTML (fragile behind WAF/CDN).
 * Extend when we discover more `#…/sites/…/jobs` Oracle shells.
 */
const ORACLE_HASH_VANITY_FUSION_HOSTS: Record<string, string> = {
  'jobs.hexaware.com': 'fa-etqo-saasfaprod1.fa.ocs.oraclecloud.com',
};

const ORACLE_HCM_VANITY_HOSTS = new Set(
  (process.env.ORACLE_HCM_VANITY_HOSTS || '')
    .split(',')
    .map((host) => host.trim().toLowerCase().replace(/^www\./, ''))
    .filter(Boolean)
);

/** Sentinel listApiUrl: Fusion CE host is discovered from vanity landing HTML at fetch. */
const ORACLE_VANITY_RESOLVE_MARKER = 'oracle-vanity://resolve';

function isOracleCloudFaHost(host: string): boolean {
  return /\.fa(?:\.ocs)?\.oraclecloud\.com$/i.test(host);
}

function oracleCareersHcmHost(): string {
  return (
    (process.env.ORACLE_CAREERS_HCM_HOST || 'eeho.fa.us2.oraclecloud.com').trim() ||
    'eeho.fa.us2.oraclecloud.com'
  );
}

function oracleRecruitingListApi(apiHost: string): string {
  return `https://${apiHost}/hcmRestApi/resources/latest/recruitingCEJobRequisitions`;
}

/** Resolve known hash-vanity host → Fusion CE host (SSRF-safe allowlist only). */
export function resolveOracleHashVanityFusionHost(hostname: string): string | null {
  const host = String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/^www\./, '');
  if (!host) return null;
  const mapped = ORACLE_HASH_VANITY_FUSION_HOSTS[host];
  if (mapped && isOracleCloudFaHost(mapped)) return mapped;
  // Optional env: jobs.acme.com=fa-xxxx.fa.ocs.oraclecloud.com,other=...
  const fromEnv = (process.env.ORACLE_HASH_VANITY_FUSION_HOSTS || '')
    .split(',')
    .map((pair) => pair.trim())
    .filter(Boolean);
  for (const pair of fromEnv) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const key = pair.slice(0, eq).trim().toLowerCase().replace(/^www\./, '');
    const value = pair.slice(eq + 1).trim().toLowerCase().replace(/^https?:\/\//, '');
    if (key === host && isOracleCloudFaHost(value)) return value;
  }
  return null;
}

function isSafeOracleHcmVanityHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^www\./, '');
  return (
    normalized.split('.').length >= 3 &&
    normalized !== 'localhost' &&
    !normalized.endsWith('.localhost') &&
    isIP(normalized) === 0
  );
}

function greenhouseBoardForHost(hostname: string): string | null {
  const host = hostname.replace(/^www\./i, '').toLowerCase();
  return GREENHOUSE_VANITY_BOARDS[host] || null;
}

/** Resolve Greenhouse job id + board from vanity career URLs. */
export function detectGreenhouseVanity(
  parsed: URL
): { provider: 'greenhouse'; apiUrl: string; companyHint: string } | null {
  const board = greenhouseBoardForHost(parsed.hostname);
  if (!board) return null;

  const ghJid = (parsed.searchParams.get('gh_jid') || '').trim();
  const path = parsed.pathname;
  // stripe.com/careers/listing/{slug}/{numericId}
  const listingMatch = path.match(/\/careers\/listing\/[^/]+\/(\d+)\/?$/i);
  // stripe.com/jobs/... ?gh_jid= or /jobs/listing/...
  const jobsListingMatch = path.match(/\/jobs\/(?:listing\/)?[^/]+\/(\d+)\/?$/i);
  const id = (ghJid && /^\d+$/.test(ghJid) ? ghJid : '') || listingMatch?.[1] || jobsListingMatch?.[1] || '';
  if (!id || !/^\d+$/.test(id)) return null;

  return {
    provider: 'greenhouse',
    apiUrl: `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${id}`,
    companyHint: board,
  };
}

/**
 * Salesforce's legacy `salesforce.com/company/careers/jobs/...` URLs render a
 * generic landing page. The actual posting is available from its public Workday
 * CXS JSON API, keyed by its JR requisition id.
 */
function detectSalesforceWorkday(
  parsed: URL
): { provider: 'workday'; apiUrl: string; companyHint: string } | null {
  const host = parsed.hostname.toLowerCase().replace(/^www\./i, '');
  if (host !== 'salesforce.com' && host !== 'careers.salesforce.com') return null;
  const jobId = parsed.pathname.match(/\b(jr\d+)\b/i)?.[1];
  if (!jobId) return null;
  return {
    provider: 'workday',
    apiUrl: SALESFORCE_WORKDAY_BASE,
    companyHint: 'Salesforce',
  };
}

const httpClient: AxiosInstance = axios.create({
  timeout: 20_000,
  maxContentLength: parseInt(process.env.MAX_PARSE_BYTES || String(1.5 * 1024 * 1024), 10),
  maxBodyLength: parseInt(process.env.MAX_PARSE_BYTES || String(1.5 * 1024 * 1024), 10),
  httpsAgent: keepAliveAgent,
  httpAgent: keepAliveHttpAgent,
  validateStatus: (s) => s >= 200 && s < 500,
});

// ATS URLs are derived from user targets or remote HTML. Never let Axios
// auto-follow a redirect, because every destination must be policy-checked.
httpClient.interceptors.request.use(async (config) => {
  const rawUrl = config.baseURL ? new URL(config.url || '', config.baseURL).toString() : config.url || '';
  const target = await resolveSafeOutboundUrl(rawUrl);
  const selected = target.addresses[0];
  if (!selected) throw new Error('ATS outbound hostname could not be resolved');
  const hostname = new URL(rawUrl).hostname;
  const pinnedAgentOptions = {
    keepAlive: true,
    maxSockets: 16,
    lookup: createPinnedLookup(selected.address, selected.family),
  };
  // Shared keepAliveAgent ignores config.lookup, so CDNs with many A records fail
  // the peer pin. Attach a per-request agent that actually uses the pinned lookup.
  if (new URL(rawUrl).protocol === 'https:') {
    config.httpsAgent = new https.Agent({
      ...pinnedAgentOptions,
      servername: hostname,
    } as https.AgentOptions);
  } else {
    config.httpAgent = new http.Agent(pinnedAgentOptions as http.AgentOptions);
  }
  (config as any).__safeOutboundAddresses = target.addresses.map((item) => item.address);
  config.maxRedirects = 0;
  return config;
});
httpClient.interceptors.response.use((response) => {
  const expected = (response.config as any).__safeOutboundAddresses as string[] | undefined;
  const socket = response.request?.socket;
  const peer =
    socket?.remoteAddress ||
    socket?.socket?.remoteAddress ||
    response.request?.connection?.remoteAddress;
  // Pinned Agent lookup already constrains DNS. Axios sometimes omits peer on TLS
  // sockets; only enforce the allowlist when Node reports a remote address.
  if (expected?.length && peer) {
    assertPinnedPeerInAllowlist(expected, peer);
  }
  return response;
});

const empty = (): ParsedJobFields => ({
  jobTitle: '',
  companyName: '',
  jobDescription: '',
  location: '',
  salaryRange: '',
  employmentType: '',
  remoteType: '',
  date: '',
  applyUrl: '',
  companyLogoUrl: '',
  jobCategory: '',
  source: 'jsonld',
});

/** Known Oracle Cloud HCM tenant → employer display name. */
const ORACLE_TENANT_COMPANY: Record<string, string> = {
  jpmc: 'JPMorgan Chase',
  chase: 'Chase',
  oracle: 'Oracle',
  ibpwjb: 'Independent Bank',
};

function companyOrEmpty(name: string): string {
  const n = String(name || '').trim();
  return isPortalCompanyName(n) ? '' : n;
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
  };
  return known[tenant.toLowerCase()] || titleCaseToken(tenant);
}

export function detectWorkday(
  parsed: URL
): { provider: 'workday'; apiUrl: string; companyHint: string } | null {
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const m = host.match(/^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/i);
  if (!m) return null;
  const tenant = m[1];
  const parts = parsed.pathname.split('/').filter(Boolean);
  const localeLike = /^(?:en|fr|de|es|pt|zh|ja|ko|it|nl|sv|da|fi|pl|tr)(?:-[a-z]{2})?$/i;
  const filtered = parts.filter(
    (p) => !localeLike.test(p) && !/^(wday|cxs)$/i.test(p)
  );
  const jobIdx = filtered.findIndex((p) => /^(job|jobs|details)$/i.test(p));
  if (jobIdx < 1) return null;
  const site = filtered[0];
  if (!site || /^(job|jobs|details)$/i.test(site)) return null;
  return {
    provider: 'workday',
    apiUrl: `https://${host}/wday/cxs/${encodeURIComponent(tenant)}/${encodeURIComponent(site)}`,
    companyHint: workdayCompanyHint(tenant),
  };
}

function oracleJobIdFromParts(parts: string[]): string {
  const lower = parts.map((p) => p.toLowerCase());
  const jobIdx = lower.lastIndexOf('job');
  if (jobIdx >= 0 && parts[jobIdx + 1]) return parts[jobIdx + 1].split('?')[0];
  const previewIdx = lower.lastIndexOf('preview');
  if (previewIdx >= 0 && parts[previewIdx + 1]) return parts[previewIdx + 1].split('?')[0];
  return '';
}

function detectEightfold(
  parsed: URL
): { provider: 'eightfold'; apiUrl: string; companyHint: string } | null {
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (!host.endsWith('.eightfold.ai') && host !== 'eightfold.ai') return null;
  const pid =
    parsed.searchParams.get('pid') ||
    parsed.searchParams.get('position_id') ||
    (parsed.pathname.match(/\/(?:careers\/)?(?:job|position|positions)\/(\d+)/i) || [])[1] ||
    '';
  if (!pid || !/^\d+$/.test(pid)) return null;
  const company = host.replace(/\.eightfold\.ai$/i, '') || 'Eightfold';
  return {
    provider: 'eightfold',
    apiUrl: `https://${host}/api/apply/v2/jobs/${encodeURIComponent(pid)}`,
    companyHint: titleCaseToken(company),
  };
}

function detectIcims(
  parsed: URL
): { provider: 'icims'; apiUrl: string; companyHint: string } | null {
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (!host.endsWith('.icims.com') && host !== 'icims.com') return null;
  const parts = parsed.pathname.split('/').filter(Boolean);
  const jobsIdx = parts.findIndex((p) => p.toLowerCase() === 'jobs');
  const id = jobsIdx >= 0 ? parts[jobsIdx + 1] : '';
  if (!id || !/^\d+$/.test(id)) return null;
  const sub = host.replace(/\.icims\.com$/i, '').replace(/^(staff|careers)-/i, '');
  return {
    provider: 'icims',
    apiUrl: `https://${host}/jobs/${encodeURIComponent(id)}/job`,
    companyHint: titleCaseToken(sub.split('.')[0] || sub),
  };
}

function detectTaleo(
  parsed: URL
): { provider: 'taleo'; apiUrl: string; companyHint: string } | null {
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (!host.endsWith('.taleo.net') && host !== 'taleo.net') return null;
  const jobId =
    parsed.searchParams.get('job') ||
    parsed.searchParams.get('rid') ||
    parsed.searchParams.get('requisitionId') ||
    '';
  if (!jobId) return null;
  const clean = new URL(parsed.href);
  clean.hash = '';
  const tenant = host.replace(/\.taleo\.net$/i, '').split('.')[0];
  return {
    provider: 'taleo',
    apiUrl: clean.toString(),
    companyHint: titleCaseToken(tenant),
  };
}

function detectNjoyn(
  parsed: URL
): { provider: 'njoyn'; apiUrl: string; companyHint: string } | null {
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (!host.endsWith('.njoyn.com') && host !== 'njoyn.com') return null;
  const jobId = parsed.searchParams.get('JobID') || parsed.searchParams.get('jobid') || '';
  if (!jobId) return null;
  const clean = new URL(parsed.href);
  clean.hash = '';
  const tenant = host.replace(/\.njoyn\.com$/i, '').split('.')[0];
  return {
    provider: 'njoyn',
    apiUrl: clean.toString(),
    companyHint: tenant.toUpperCase() === 'CGI' ? 'CGI' : titleCaseToken(tenant),
  };
}

function isHiringCafeHost(host: string): boolean {
  return host === 'hiring.cafe' || host === 'hiringcafe.com' || host.endsWith('.hiring.cafe');
}

function looksLikeJobDetailPath(parsed: URL): boolean {
  const path = parsed.pathname;
  if (
    /\/(?:job|jobs|details|posting|postings|opening|openings|position|positions|requisition|apply|listing)\b/i.test(
      path
    )
  ) {
    return true;
  }
  const keys = ['jobid', 'job', 'rid', 'req', 'pid', 'gh_jid', 'requisitionid', 'reqid'];
  for (const [key, value] of parsed.searchParams) {
    if (keys.includes(key.toLowerCase()) && String(value || '').trim()) return true;
  }
  return false;
}

/** Career hosts from scrape.do spend that we fetch directly instead of scrape.do. Never HiringCafe. */
const CAREER_HTML_HOST_COMPANIES: Record<string, string> = {
  'jobs.apple.com': 'Apple',
  'jobs.careers.microsoft.com': 'Microsoft',
  'apply.careers.microsoft.com': 'Microsoft',
  'amazon.jobs': 'Amazon',
  'passport.amazon.jobs': 'Amazon',
  'careers.truist.com': 'Truist',
  'jobs-us.pwc.com': 'PwC',
  'careers.wipro.com': 'Wipro',
  'higher.gs.com': 'Goldman Sachs',
  'careers.ford.com': 'Ford',
  'careers.zionsbank.com': 'Zions Bank',
  'zionsbank.com': 'Zions Bank',
  'metacareers.com': 'Meta',
  'careers.techmahindra.com': 'Tech Mahindra',
  'careers.bankofamerica.com': 'Bank of America',
  'careers.ey.com': 'EY',
  'careers.airbnb.com': 'Airbnb',
  'wellsfargojobs.com': 'Wells Fargo',
  'careers.cognizant.com': 'Cognizant',
  'careers-inc.nttdata.com': 'NTT Data',
  'jobs.carrier.com': 'Carrier',
  'careers.toyota.com': 'Toyota',
  'jobs.uber.com': 'Uber',
  'jobs.uci.edu': 'UC Irvine',
  'jobs.twilio.com': 'Twilio',
  'jobs.statefarm.com': 'State Farm',
  'jobs.compassgroupcareers.com': 'Compass Group',
  'jobs.citizensbank.com': 'Citizens Bank',
  'jobs.citi.com': 'Citi',
  'jobs.bmo.com': 'BMO',
  'github.careers': 'GitHub',
  'sia-partners.com': 'Sia Partners',
  'wave.com': 'Wave',
  'virtusa.com': 'Virtusa',
  'okta.com': 'Okta',
  'numble.be': 'Numble',
  'lifeattiktok.com': 'TikTok',
  'jobs.gem.com': 'Gem',
  'epam.com': 'EPAM',
  'careers.epam.com': 'EPAM',
  'comeet.com': 'Comeet',
  'cityjobs.nyc.gov': 'NYC',
  'carrierjobs.cn': 'Carrier',
  'careers.zoom.us': 'Zoom',
  'careers.unitedhealthgroup.com': 'UnitedHealth',
  'careers.umich.edu': 'University of Michigan',
  'careers.travelers.com': 'Travelers',
  'careers.summitllc.com': 'Summit',
  'careers.statestreet.com': 'State Street',
  'careers.servicenow.com': 'ServiceNow',
  'careers.regions.com': 'Regions',
  'careers.ozk.com': 'OZK',
  'careers.dxc.com': 'DXC',
  'careers.docusign.com': 'DocuSign',
  'careers.cisco.com': 'Cisco',
  'careers.boozallen.com': 'Booz Allen',
  'careers.hpe.com': 'HPE',
  'capgemini.com': 'Capgemini',
  'atos.net': 'Atos',
  'asana.com': 'Asana',
  'akkodis.com': 'Akkodis',
  'recruiting.paylocity.com': 'Paylocity',
  'salesforce.com': 'Salesforce',
  'careers.salesforce.com': 'Salesforce',
  ...DIRECTORY_CAREER_HTML_HOST_COMPANIES,
};

const CAREER_HTML_SUFFIXES = [
  'paylocity.com',
  'jobvite.com',
  'applytojob.com',
  'pinpointhq.com',
  'ripplehire.com',
  'hrmdirect.com',
  'tal.net',
  'adp.com',
  'entertimeonline.com',
  'amazon.jobs',
];

function careerHtmlCompanyHint(host: string): string {
  if (CAREER_HTML_HOST_COMPANIES[host]) return CAREER_HTML_HOST_COMPANIES[host];
  const suffix = CAREER_HTML_SUFFIXES.find((s) => host === s || host.endsWith(`.${s}`));
  if (suffix === 'amazon.jobs') return 'Amazon';
  const tenant = host.split('.')[0];
  if (host.endsWith('.applytojob.com') || host.endsWith('.pinpointhq.com') || host.endsWith('.ripplehire.com')) {
    return titleCaseToken(tenant);
  }
  if (host.startsWith('careers.') || host.startsWith('jobs.')) {
    const brand = host.split('.')[1] || tenant;
    return titleCaseToken(brand);
  }
  return titleCaseToken(tenant);
}

function isCareerHtmlHost(host: string): boolean {
  if (isHiringCafeHost(host)) return false;
  if (CAREER_HTML_HOST_COMPANIES[host]) return true;
  return CAREER_HTML_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function detectCareerHtml(
  parsed: URL
): { provider: 'careerhtml'; apiUrl: string; companyHint: string } | null {
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (!isCareerHtmlHost(host) || !looksLikeJobDetailPath(parsed)) return null;
  const clean = new URL(parsed.href);
  clean.hash = '';
  return {
    provider: 'careerhtml',
    apiUrl: clean.toString(),
    companyHint: careerHtmlCompanyHint(host),
  };
}

const SKIP_SCRAPE_DO_HOSTS = new Set([
  'careers.ibm.com',
  'ibmglobal.avature.net',
  'careers.oracle.com',
  'enterpriseplatform.dell.com',
  'media.licdn.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'facebook.com',
  'developers.cloudflare.com',
  'linkedin.com',
  'indeed.com',
  ...Object.keys(CAREER_HTML_HOST_COMPANIES),
]);

const SKIP_SCRAPE_DO_SUFFIXES = [
  'myworkdayjobs.com',
  'greenhouse.io',
  'lever.co',
  'ashbyhq.com',
  'taleo.net',
  'icims.com',
  'eightfold.ai',
  'oraclecloud.com',
  'njoyn.com',
  'workable.com',
  'recruitee.com',
  'bamboohr.com',
  'breezy.hr',
  'personio.com',
  'personio.de',
  ...CAREER_HTML_SUFFIXES,
];

const NEVER_SCRAPE_DO_HOSTS = new Set([
  'media.licdn.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'facebook.com',
  'developers.cloudflare.com',
  'linkedin.com',
  'indeed.com',
]);

/** Non-job / CDN hosts that must never hit scrape.do. ATS misses still fall back to cheap scrape.do. */
export function shouldNeverScrapeDoUrl(url: string): boolean {
  if (!url) return false;
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return false;
  }
  return NEVER_SCRAPE_DO_HOSTS.has(host);
}

export function shouldSkipScrapeDoUrl(url: string): boolean {
  if (!url) return false;
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return false;
  }
  if (isHiringCafeHost(host)) return false;
  if (detectAts(url)) return true;
  if (detectAtsBoard(url)) return true;
  if (!host) return false;
  if (SKIP_SCRAPE_DO_HOSTS.has(host)) return true;
  return SKIP_SCRAPE_DO_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

function oracleTenantCompany(tenant: string): string {
  const key = tenant.toLowerCase();
  if (ORACLE_TENANT_COMPANY[key]) return ORACLE_TENANT_COMPANY[key];
  // jpmc → JPMC style fallback (never "oraclecloud")
  if (key.length <= 6) return key.toUpperCase();
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/** Detect ATS board from a job URL; returns null if not a known ATS host. */
export function detectAts(url: string): { provider: AtsProvider; apiUrl: string; companyHint: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;

  // boards.greenhouse.io/{board}/jobs/{id}
  let m = host.match(/^boards(?:\.eu)?\.greenhouse\.io$/i);
  if (m || host.includes('greenhouse.io')) {
    const parts = path.split('/').filter(Boolean);
    // /{board}/jobs/{id}
    const jobsIdx = parts.indexOf('jobs');
    if (jobsIdx > 0 && parts[jobsIdx + 1]) {
      const board = parts[jobsIdx - 1];
      const id = parts[jobsIdx + 1].split('?')[0];
      if (board && id && /^\d+$/.test(id)) {
        return {
          provider: 'greenhouse',
          apiUrl: `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${id}`,
          companyHint: board,
        };
      }
    }
  }

  // Greenhouse-backed vanity career sites (e.g. stripe.com/careers/listing/{slug}/{id}
  // or ?gh_jid=). Prefer free boards-api over scrape.do for these hosts.
  const greenhouseVanity = detectGreenhouseVanity(parsed);
  if (greenhouseVanity) return greenhouseVanity;

  // jobs.lever.co/{company}/{id}
  if (host === 'jobs.lever.co' || host.endsWith('.lever.co')) {
    const parts = path.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const company = parts[0];
      const id = parts[1];
      return {
        provider: 'lever',
        apiUrl: `https://api.lever.co/v0/postings/${encodeURIComponent(company)}/${encodeURIComponent(id)}`,
        companyHint: company,
      };
    }
  }

  // jobs.ashbyhq.com/{org}/...
  if (host === 'jobs.ashbyhq.com') {
    const parts = path.split('/').filter(Boolean);
    const org = parts[0];
    // Ashby public job board API: https://api.ashbyhq.com/posting-api/job-board/{org}?includeCompensation=true
    // Individual job pages often embed the job id in query or path — fall through if we can't resolve.
    if (org) {
      const jobId =
        parsed.searchParams.get('ashby_jid') ||
        parsed.searchParams.get('jobId') ||
        (parts[1] && parts[1] !== 'application' ? parts[1] : '');
      if (jobId) {
        return {
          provider: 'ashby',
          apiUrl: `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(org)}?includeCompensation=true`,
          companyHint: org,
        };
      }
    }
  }

  // apply.workable.com/{account}/j/{shortcode}
  if (host.includes('workable.com')) {
    const parts = path.split('/').filter(Boolean);
    const jIdx = parts.indexOf('j');
    if (jIdx >= 0 && parts[jIdx + 1]) {
      const account = parts[0];
      const shortcode = parts[jIdx + 1];
      return {
        provider: 'workable',
        apiUrl: `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(account)}/jobs/${encodeURIComponent(shortcode)}`,
        companyHint: account,
      };
    }
  }

  // jobs.smartrecruiters.com/{company}/{id}
  if (host.includes('smartrecruiters.com')) {
    const parts = path.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const company = parts[0];
      const id = parts[parts.length - 1];
      if (id) {
        return {
          provider: 'smartrecruiters',
          apiUrl: `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings/${encodeURIComponent(id)}`,
          companyHint: company,
        };
      }
    }
  }

  // {company}.recruitee.com/o/{slug}
  if (host.endsWith('.recruitee.com')) {
    const company = host.replace(/\.recruitee\.com$/i, '');
    const parts = path.split('/').filter(Boolean);
    const oIdx = parts.indexOf('o');
    const slug = oIdx >= 0 ? parts[oIdx + 1] : parts[0];
    if (company && slug) {
      return {
        provider: 'recruitee',
        apiUrl: `https://${company}.recruitee.com/api/offers/${encodeURIComponent(slug)}`,
        companyHint: company,
      };
    }
  }

  // Oracle's branded vanity host proxies Oracle HCM Candidate Experience.
  // Its public detail API is more complete than a rendered page snapshot.
  if (host === 'careers.oracle.com') {
    const parts = path.split('/').filter(Boolean);
    const sitesIdx = parts.indexOf('sites');
    const jobIdx = parts.indexOf('job');
    const siteNumber = sitesIdx >= 0 ? parts[sitesIdx + 1] : '';
    const jobId = jobIdx >= 0 ? (parts[jobIdx + 1] || '').split('?')[0] : '';
    if (siteNumber && jobId && /^\d+$/.test(jobId)) {
      const finder = encodeURIComponent(`ById;Id="${jobId}",siteNumber=${siteNumber}`);
      const apiHost = oracleCareersHcmHost();
      return {
        provider: 'oraclecloud',
        apiUrl:
          `https://${apiHost}/hcmRestApi/resources/latest/` +
          `recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=${finder}`,
        companyHint: 'Oracle',
      };
    }
  }

  // Oracle HCM Candidate Experience is sometimes served from an explicitly
  // trusted employer vanity domain (e.g. enterpriseplatform.dell.com).
  // Keep this allowlisted so extracted URLs cannot turn into arbitrary SSRF.
  const isOracleCloudHost = /\.fa(?:\.ocs)?\.oraclecloud\.com$/i.test(host);
  const isAllowedOracleVanityHost =
    isSafeOracleHcmVanityHost(host) &&
    (Boolean(ORACLE_HCM_VANITY_HOST_COMPANIES[host]) || ORACLE_HCM_VANITY_HOSTS.has(host));
  if (
    (isOracleCloudHost || isAllowedOracleVanityHost) &&
    /\/hcmUI\/CandidateExperience\//i.test(path)
  ) {
    const tenant = host.split('.')[0];
    const parts = path.split('/').filter(Boolean);
    const sitesIdx = parts.indexOf('sites');
    const siteNumber = sitesIdx >= 0 ? parts[sitesIdx + 1] : '';
    const jobId = oracleJobIdFromParts(parts);
    if (tenant && siteNumber && jobId) {
      const finder = encodeURIComponent(`ById;Id="${jobId}",siteNumber=${siteNumber}`);
      return {
        provider: 'oraclecloud',
        apiUrl: `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=${finder}`,
        companyHint:
          ORACLE_HCM_VANITY_HOST_COMPANIES[host] || oracleTenantCompany(tenant),
      };
    }
  }

  // Google Careers SPA — job HTML is server-rendered with full JD (no public JSON API).
  // Direct fetch avoids scrape.do 502s on this host.
  if (
    (host === 'google.com' || host.endsWith('.google.com')) &&
    /\/about\/careers\/applications\/jobs\/results\//i.test(path)
  ) {
    const clean = new URL(parsed.href);
    clean.hash = '';
    // Prefer www — careers CDN behaves more consistently
    if (clean.hostname === 'google.com') clean.hostname = 'www.google.com';
    return {
      provider: 'googlecareers',
      apiUrl: clean.toString(),
      companyHint: 'Google',
    };
  }

  // IBM Careers (Avature) — AWS WAF blocks scrape.do/http; Playwright renders the JD.
  // Require JobDetail in the path so SearchJobs?jobId=… does not launch Chromium.
  if (
    (host === 'careers.ibm.com' || host === 'ibmglobal.avature.net') &&
    /JobDetail/i.test(path) &&
    parsed.searchParams.has('jobId')
  ) {
    const clean = new URL(parsed.href);
    clean.hash = '';
    return {
      provider: 'ibmcareers',
      apiUrl: clean.toString(),
      companyHint: 'IBM',
    };
  }

  const salesforceWorkday = detectSalesforceWorkday(parsed);
  if (salesforceWorkday) return salesforceWorkday;

  const workday = detectWorkday(parsed);
  if (workday) return workday;

  const eightfold = detectEightfold(parsed);
  if (eightfold) return eightfold;

  const appleJobs = detectAppleJobs(parsed);
  if (appleJobs) return appleJobs;

  const microsoftCareers = detectMicrosoftCareers(parsed);
  if (microsoftCareers) return microsoftCareers;

  const icims = detectIcims(parsed);
  if (icims) return icims;

  const taleo = detectTaleo(parsed);
  if (taleo) return taleo;

  const njoyn = detectNjoyn(parsed);
  if (njoyn) return njoyn;

  const careerHtml = detectCareerHtml(parsed);
  if (careerHtml) return careerHtml;

  return null;
}

function mapGreenhouse(data: any, companyHint: string, pageUrl: string): ParsedJobFields {
  const f = empty();
  f.jobTitle = String(data.title || '').trim();
  f.companyName = companyOrEmpty(companyHint);
  f.jobDescription = stripHtmlTags(data.content || data.description || '');
  const loc = data.location?.name || data.offices?.map((o: any) => o.name).filter(Boolean).join(', ');
  f.location = String(loc || '').trim();
  f.date = data.updated_at || data.created_at || '';
  f.applyUrl = data.absolute_url || pageUrl;
  f.employmentType = '';
  return f;
}

function mapWorkday(data: any, companyHint: string, pageUrl: string): ParsedJobFields {
  const info = data?.jobPostingInfo || data || {};
  const f = empty();
  f.jobTitle = String(info.title || '').trim();
  f.companyName = companyOrEmpty(companyHint);
  f.jobDescription = stripHtmlTags(info.jobDescription || info.description || '');
  const locations = [
    info.location,
    info.locationsText,
    ...(Array.isArray(info.additionalLocations) ? info.additionalLocations : []),
  ].filter(Boolean);
  f.location = locations.map((value: any) => (typeof value === 'string' ? value : value?.name || '')).filter(Boolean).join(', ');
  f.date = info.startDate || info.postedOn || '';
  f.employmentType = String(info.timeType || '').trim();
  f.applyUrl = pageUrl;
  return f;
}

function mapEightfold(data: any, companyHint: string, pageUrl: string): ParsedJobFields {
  const job = data?.data || data?.job || data || {};
  const f = empty();
  f.jobTitle = String(job.name || job.title || job.position_name || '').trim();
  f.companyName = companyOrEmpty(job.company || companyHint);
  f.jobDescription = stripHtmlTags(
    job.job_description || job.description || job.jobDescription || ''
  );
  const loc = job.location || job.locations;
  f.location = Array.isArray(loc)
    ? loc.map((item: any) => (typeof item === 'string' ? item : item?.name || '')).filter(Boolean).join(', ')
    : String(loc || job.city || '').trim();
  f.employmentType = String(job.employment_type || job.type || '').trim();
  f.applyUrl = job.url || job.apply_url || pageUrl;
  return f;
}

function workdayRequisitionId(pageUrl: string): string {
  const jr = pageUrl.match(/(?:^|_|\/|-)(JR-?\d+)\b/i)?.[1];
  if (jr) return jr.replace(/-/g, '');
  const r = pageUrl.match(/(?:^|_|\/|-)(R-?\d+)\b/i)?.[1];
  if (r) return r.replace(/-/g, '');
  try {
    const last = new URL(pageUrl).pathname.split('/').filter(Boolean).pop() || '';
    const fromSlug = last.match(/_((?:JR|R)-?\d+)$/i)?.[1];
    if (fromSlug) return fromSlug.replace(/-/g, '');
    return decodeURIComponent(last);
  } catch {
    return '';
  }
}

async function fetchWorkdayJob(
  baseUrl: string,
  jobId: string,
  companyHint: string,
  pageUrl: string
): Promise<AtsFetchResult | null> {
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  const list = await httpClient.post(
    `${baseUrl}/jobs`,
    { appliedFacets: {}, limit: 20, offset: 0, searchText: jobId },
    { headers }
  );
  if (list.status >= 400 || !Array.isArray(list.data?.jobPostings)) return null;
  const normalizedJobId = jobId.toLowerCase();
  const posting = list.data.jobPostings.find((item: any) => {
    const externalPath = String(item?.externalPath || '').toLowerCase();
    return new RegExp(`(?:^|_)${normalizedJobId}(?:$|[/?])`).test(externalPath);
  });
  const externalPath = String(posting?.externalPath || '');
  if (!externalPath.startsWith('/')) return null;

  const detail = await httpClient.get(`${baseUrl}${externalPath}`, { headers });
  if (detail.status >= 400 || !detail.data) return null;
  const fields = mapWorkday(detail.data, companyHint, pageUrl);
  if (!fields.jobTitle && !fields.jobDescription) return null;
  return { provider: 'workday', fields, externalJobId: jobId };
}

function mapLever(data: any, companyHint: string, pageUrl: string): ParsedJobFields {
  const f = empty();
  f.jobTitle = String(data.text || data.title || '').trim();
  f.companyName = companyOrEmpty(companyHint);
  const desc = [data.descriptionPlain || data.description, data.additionalPlain || data.additional]
    .filter(Boolean)
    .join('\n\n');
  f.jobDescription = stripHtmlTags(desc);
  f.location = String(data.categories?.location || data.workplaceType || '').trim();
  f.employmentType = String(data.categories?.commitment || '').trim();
  f.date = data.createdAt ? new Date(data.createdAt).toISOString() : '';
  f.applyUrl = data.hostedUrl || data.applyUrl || pageUrl;
  return f;
}

function mapAshby(data: any, companyHint: string, pageUrl: string, jobId: string): ParsedJobFields {
  const jobs = data?.jobs || data?.jobPostings || [];
  const job =
    jobs.find((j: any) => String(j.id) === jobId || String(j.jobId) === jobId || j.jobUrl?.includes(jobId)) ||
    jobs[0];
  const f = empty();
  if (!job) return f;
  f.jobTitle = String(job.title || '').trim();
  f.companyName = companyOrEmpty(data?.organizationName || companyHint);
  f.jobDescription = stripHtmlTags(job.descriptionHtml || job.descriptionPlain || job.description || '');
  f.location = String(job.location || job.secondaryLocations?.map((l: any) => l.location).join(', ') || '').trim();
  f.employmentType = String(job.employmentType || '').trim();
  f.applyUrl = job.jobUrl || pageUrl;
  return f;
}

function mapWorkable(data: any, companyHint: string, pageUrl: string): ParsedJobFields {
  const f = empty();
  f.jobTitle = String(data.title || '').trim();
  f.companyName = companyOrEmpty(data.department || companyHint);
  f.jobDescription = stripHtmlTags(data.description || data.full_description || '');
  f.location = String(data.location?.city || data.location?.country || data.location || '').trim();
  f.employmentType = String(data.employment_type || '').trim();
  f.applyUrl = data.url || pageUrl;
  return f;
}

function mapSmartRecruiters(data: any, companyHint: string, pageUrl: string): ParsedJobFields {
  const f = empty();
  f.jobTitle = String(data.name || data.title || '').trim();
  f.companyName = companyOrEmpty(data.company?.name || companyHint);
  f.jobDescription = stripHtmlTags(data.jobAd?.sections?.jobDescription?.text || data.description || '');
  const loc = data.location;
  f.location = [loc?.city, loc?.region, loc?.country].filter(Boolean).join(', ');
  f.employmentType = String(data.typeOfEmployment?.label || '').trim();
  f.applyUrl = data.applyUrl || data.refNumber || pageUrl;
  f.date = data.releasedDate || data.createdOn || '';
  return f;
}

function mapRecruitee(data: any, companyHint: string, pageUrl: string): ParsedJobFields {
  const offer = data.offer || data;
  const f = empty();
  f.jobTitle = String(offer.title || '').trim();
  f.companyName = companyOrEmpty(companyHint);
  f.jobDescription = stripHtmlTags(offer.description || offer.requirements || '');
  f.location = String(offer.location || offer.city || '').trim();
  f.employmentType = String(offer.employment_type_code || offer.employment_type || '').trim();
  f.applyUrl = offer.careers_url || pageUrl;
  f.date = offer.published_at || offer.created_at || '';
  return f;
}

function mapOracleCloud(data: any, companyHint: string, pageUrl: string): ParsedJobFields {
  const item = Array.isArray(data?.items) ? data.items[0] : data;
  const f = empty();
  if (!item) return f;

  f.jobTitle = String(item.Title || item.OtherRequisitionTitle || '').trim();
  f.companyName = companyOrEmpty(companyHint);
  f.jobCategory = String(item.Category || item.JobFunction || '').trim();
  f.location = String(item.PrimaryLocation || '').trim();
  f.employmentType = String(item.JobSchedule || item.WorkerType || item.JobType || '').trim();
  f.date = String(item.ExternalPostedStartDate || '').trim();
  f.applyUrl = pageUrl.split('?')[0];
  if (companyHint.trim().toLowerCase() === 'oracle') {
    f.companyLogoUrl = 'https://www.google.com/s2/favicons?domain=oracle.com&sz=128';
  }
  if (String(item.WorkplaceType || item.WorkplaceTypeCode || '').toLowerCase().includes('remote')) {
    f.remoteType = 'Remote';
  }

  const flex = Array.isArray(item.requisitionFlexFields) ? item.requisitionFlexFields : [];
  let jobExperience = 0;
  for (const field of flex) {
    const prompt = String(field?.Prompt || '').toLowerCase();
    const value = String(field?.Value || '').trim();
    if (!value) continue;
    if (/pay|salary|compensation|base\s*pay/i.test(prompt)) {
      f.salaryRange = normalizeSalaryRange(value, { location: f.location });
    }
    if (/\byears?\b|\bexperience\b/i.test(prompt)) {
      // Prefer the minimum of a range ("3 to 5+ years" → 3), capped like deriveFieldsFromDescription.
      const years = value.match(/\d+(?:\.\d+)?/)?.[0];
      if (years) {
        const n = Math.floor(Number(years));
        if (n > 0 && n <= 30) jobExperience = Math.max(jobExperience, n);
      }
    }
  }

  const workLoc = Array.isArray(item.workLocation) ? item.workLocation[0] : null;
  if (!f.location && workLoc) {
    f.location = [workLoc.TownOrCity, workLoc.Region2, workLoc.Country].filter(Boolean).join(', ');
  }

  const descParts = [
    item.ExternalDescriptionStr,
    item.ExternalResponsibilitiesStr,
    item.ExternalQualificationsStr,
    item.CorporateDescriptionStr,
    item.OrganizationDescriptionStr,
  ].filter(Boolean);
  f.jobDescription = stripHtmlTags(descParts.join('\n\n'));
  // Never use ShortDescriptionStr alone when we have the full HTML description.
  if (!f.jobDescription) {
    f.jobDescription = stripHtmlTags(item.ShortDescriptionStr || '');
  }
  if (!f.salaryRange) {
    f.salaryRange = normalizeSalaryRange(
      item.ExternalQualificationsStr || item.InternalQualificationsStr || '',
      { location: f.location }
    );
  }
  if (jobExperience > 0) {
    f._jobExperience = jobExperience;
  }
  return f;
}

/** Parse Google Careers job HTML (server-rendered JD sections). */
export function mapGoogleCareersHtml(html: string, pageUrl: string): ParsedJobFields {
  const f = empty();
  f.companyName = 'Google';
  f.applyUrl = pageUrl.split('?')[0];
  // Stable public mark — Google Careers pages rarely expose a usable logo asset.
  f.companyLogoUrl = 'https://www.google.com/s2/favicons?domain=google.com&sz=128';
  f.employmentType = 'Full-time';

  const $ = cheerio.load(String(html || ''));
  // Keep DOM for location chips; strip chrome scripts later for text sections.
  const $full = cheerio.load(String(html || ''));

  $('script, style, noscript, svg, iframe').remove();

  const titleTag = ($('title').first().text() || '').trim();
  const h1 = ($('h1').first().text() || '').trim();
  const cleanTitle = (t: string) => t.replace(/\s*[—–-]\s*Google Careers\s*$/i, '').trim();
  const fromTitle = cleanTitle(titleTag);
  const fromH1 = cleanTitle(h1);
  // SPA chrome often exposes a generic h1 ("job details") — prefer <title>.
  const genericH1 = !fromH1 || /^(job details?|careers?|google careers?|jobs search)$/i.test(fromH1);
  f.jobTitle = (!genericH1 && fromH1) || fromTitle || fromH1;
  if (!f.jobTitle || /^(job details?|careers?|jobs search)$/i.test(f.jobTitle)) {
    const slug = pageUrl.match(/\/jobs\/results\/\d+-([^/?#]+)/i)?.[1];
    if (slug) {
      f.jobTitle = slug
        .split('-')
        .filter(Boolean)
        .map((w) => (w.length <= 2 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
        .join(' ');
    }
  }

  // Prefer structured sections Google renders as h3 + following content
  const sectionHeads = [
    'Minimum qualifications',
    'Preferred qualifications',
    'About the job',
    'Responsibilities',
  ];
  const parts: string[] = [];
  $('h3').each((_, el) => {
    const head = $(el).text().replace(/:\s*$/, '').trim();
    if (!sectionHeads.some((s) => head.toLowerCase().startsWith(s.toLowerCase()))) return;
    const chunks: string[] = [head.replace(/:\s*$/, '')];
    let sib = $(el).next();
    let guard = 0;
    while (sib.length && guard < 40) {
      const tag = (sib[0] as any)?.tagName?.toLowerCase?.() || '';
      if (tag === 'h3' || tag === 'h2' || tag === 'h1') break;
      const htmlChunk = sib.html() || sib.text();
      const text = stripHtmlTags(String(htmlChunk || ''));
      if (text) chunks.push(text);
      sib = sib.next();
      guard += 1;
    }
    if (chunks.length > 1) parts.push(chunks.join('\n'));
  });

  if (parts.length) {
    f.jobDescription = parts.join('\n\n');
  } else {
    const parsed = parseJobPageHtml(html, pageUrl);
    f.jobDescription = parsed.jobDescription;
    if (!f.jobTitle || /^(jobs search|job details?)$/i.test(f.jobTitle)) {
      f.jobTitle = parsed.jobTitle.replace(/\s*[—–-]\s*Google Careers\s*$/i, '').trim() || f.jobTitle;
    }
    if (parsed.location) f.location = parsed.location;
  }

  // Location chips (.r0wTof) live near the selected job's Minimum qualifications block.
  // Take the smallest ancestor that has chips so we don't pick unrelated list cards.
  const sectionH3 = $full('h3')
    .filter((_, el) => /Minimum qualifications|About the job|Responsibilities/i.test($full(el).text()))
    .first();
  if (sectionH3.length) {
    let node = sectionH3.parent();
    for (let depth = 0; depth < 10 && node.length; depth += 1) {
      const locs = node
        .find('.r0wTof')
        .map((_, el) => $full(el).text().replace(/^;\s*/, '').trim())
        .get()
        .filter((t) => t.length >= 3 && t.length < 80);
      const unique = [...new Set(locs)];
      if (unique.length > 0 && unique.length <= 8) {
        f.location = unique.join(' · ');
        break;
      }
      node = node.parent();
    }
  }

  // Fallback: list card for this job id
  if (!f.location) {
    const id = pageUrl.match(/\/jobs\/results\/(\d+)/i)?.[1];
    if (id) {
      const card = $full(`a[href*="/jobs/results/${id}"]`).first();
      const locs = card
        .find('.r0wTof')
        .map((_, el) => $full(el).text().replace(/^;\s*/, '').trim())
        .get()
        .filter(Boolean);
      if (locs.length) f.location = [...new Set(locs)].join(' · ');
    }
  }

  if (/remote/i.test(f.location) || /\bremote\b/i.test(f.jobDescription.slice(0, 500))) {
    f.remoteType = 'Remote';
  } else if (/\bhybrid\b/i.test(f.location) || /\bhybrid\b/i.test(f.jobDescription.slice(0, 500))) {
    f.remoteType = 'Hybrid';
  }

  if (/\bintern(ship)?\b/i.test(f.jobTitle)) f.employmentType = 'Internship';
  else if (/\bpart[-\s]?time\b/i.test(f.jobDescription.slice(0, 400))) f.employmentType = 'Part-time';

  // Category hint from title
  if (/software engineer|swe\b/i.test(f.jobTitle)) f.jobCategory = 'Software Engineering';
  else if (/data scientist|machine learning|ml\b/i.test(f.jobTitle)) f.jobCategory = 'Data & ML';
  else if (/program manager|tpm\b/i.test(f.jobTitle)) f.jobCategory = 'Program Management';

  return f;
}

/** Parse IBM Careers / Avature JobDetail HTML (Playwright-rendered). */
export function mapIbmCareersHtml(html: string, pageUrl: string): ParsedJobFields {
  const f = empty();
  f.companyName = 'IBM';
  f.applyUrl = pageUrl.split('#')[0];
  f.companyLogoUrl = 'https://www.google.com/s2/favicons?domain=ibm.com&sz=128';
  f.source = 'html';

  const $ = cheerio.load(String(html || ''));
  const bannerTitle = ($('h2.banner__text__title').first().text() || '').trim();
  const pageTitle = ($('title').first().text() || '')
    .replace(/\s*[-–—]\s*\d+\s*[-–—]\s*IBM\s*$/i, '')
    .replace(/\s*[-–—]\s*IBM\s*$/i, '')
    .trim();
  f.jobTitle = bannerTitle || pageTitle;

  const details = $('article.article--details').filter((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    return t.length > 200 && !/^Job Title\b/i.test(t);
  });
  const detailsHtml = details.first().html() || '';
  f.jobDescription = stripHtmlTags(detailsHtml);

  const sideText = ($('article.article--sidebar').first().text() || '').replace(/\s+/g, ' ').trim();
  const field = (label: string): string => {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Labels with "/" (City / Township, State / Province) must not require \b after "/".
    const re = new RegExp(
      `${escaped}\\s+(.+?)(?=\\s+(?:Job Title|Date posted|Job ID|City\\s*/|State\\s*/|Country|Work arrangement|Area of work|Employment type|Contract type|Projected|Location)\\b|\\s+State\\s*/|\\s+City\\s*/|$)`,
      'i'
    );
    return (sideText.match(re)?.[1] || '').trim();
  };

  const city = field('City / Township / Village') || field('City');
  const state = field('State / Province');
  const country = field('Country');
  // Prefer structured parts; never leave raw "State / Province" label residue.
  const locationParts = [city, state, country]
    .map((p) => p.replace(/\s*State\s*\/\s*Province.*$/i, '').trim())
    .filter(Boolean);
  f.location = normalizeLocation(locationParts.join(', '));
  if (!f.location && city) f.location = normalizeLocation(city);

  const posted = field('Date posted');
  if (posted) {
    const d = new Date(posted);
    f.date = Number.isNaN(d.getTime()) ? posted : d.toISOString();
  }

  const category = field('Area of work');
  if (category) f.jobCategory = category;

  const employment = field('Employment type') || field('Contract type');
  if (employment) f.employmentType = employment;

  const arrangement = field('Work arrangement');
  if (/remote/i.test(arrangement) || /\bRemote\b/i.test(sideText)) f.remoteType = 'Remote';
  else if (/hybrid/i.test(arrangement) || /\bHybrid\b/i.test(sideText)) f.remoteType = 'Hybrid';
  else if (/on[-\s]?site|office/i.test(arrangement)) f.remoteType = 'Onsite';

  const minSal = sideText.match(/Projected Minimum Salary per year\s+([\d,.]+)/i)?.[1];
  const maxSal = sideText.match(/Projected Maximum Salary per year\s+([\d,.]+)/i)?.[1];
  if (minSal && maxSal) {
    f.salaryRange = `$${minSal.replace(/\.00$/, '')} - $${maxSal.replace(/\.00$/, '')}`;
  } else if (minSal) {
    f.salaryRange = `$${minSal.replace(/\.00$/, '')}`;
  }

  if (!f.jobTitle || !f.jobDescription) {
    const parsed = parseJobPageHtml(html, pageUrl);
    if (!f.jobTitle) f.jobTitle = parsed.jobTitle;
    if (!f.jobDescription) f.jobDescription = parsed.jobDescription;
    if (!f.location) f.location = parsed.location;
  }

  return f;
}

/** Serialize IBM Playwright fetches — WAF + Chromium is heavy; avoid stampedes. */
let ibmCareersFetchChain: Promise<unknown> = Promise.resolve();
let ibmCareersFetchQueued = 0;
const IBM_CAREERS_FETCH_QUEUE_MAX = Math.max(
  1,
  parseInt(process.env.IBM_CAREERS_FETCH_QUEUE_MAX || '20', 10) || 20
);

function withIbmCareersFetchLock<T>(fn: () => Promise<T>): Promise<T> {
  if (ibmCareersFetchQueued >= IBM_CAREERS_FETCH_QUEUE_MAX) {
    return Promise.reject(new Error('ibm_careers_fetch_queue_saturated'));
  }
  ibmCareersFetchQueued += 1;
  const run = ibmCareersFetchChain.then(fn, fn).finally(() => {
    ibmCareersFetchQueued = Math.max(0, ibmCareersFetchQueued - 1);
  });
  ibmCareersFetchChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function detectAppleJobs(
  parsed: URL
): { provider: 'applejobs'; apiUrl: string; companyHint: string } | null {
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (!isAppleJobsHost(host) || !/\/details\//i.test(parsed.pathname)) return null;
  const clean = new URL(parsed.href);
  clean.hash = '';
  return { provider: 'applejobs', apiUrl: clean.toString(), companyHint: 'Apple' };
}

function detectMicrosoftCareers(
  parsed: URL
): { provider: 'microsoftcareers'; apiUrl: string; companyHint: string } | null {
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (!isMicrosoftCareersHost(host) || !looksLikeJobDetailPath(parsed)) return null;
  const clean = new URL(parsed.href);
  clean.hash = '';
  return { provider: 'microsoftcareers', apiUrl: clean.toString(), companyHint: 'Microsoft' };
}

function htmlFieldsUsable(fields: ParsedJobFields, html: string): boolean {
  if (!fields.jobTitle && !fields.jobDescription) return false;
  if (fields.jobDescription && isJunkDescription(fields.jobDescription)) return false;
  return !isThinParse(fields, Buffer.byteLength(html || '', 'utf8'));
}

async function fetchHtmlDocument(url: string): Promise<{ html: string; cookie?: string } | null> {
  const res = await httpClient.get(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    responseType: 'text',
    transitional: { forcedJSONParsing: false },
    maxContentLength: 4 * 1024 * 1024,
    maxBodyLength: 4 * 1024 * 1024,
  });
  if (res.status >= 400 || !res.data) return null;
  return { html: String(res.data), cookie: cookieHeaderFromSetCookie(res.headers) };
}

async function fetchAppleJobsPosting(pageUrl: string): Promise<AtsFetchResult | null> {
  const page = await fetchHtmlDocument(pageUrl);
  if (page?.html) {
    const hydrated = parseAppleJobsHydration(page.html, pageUrl);
    const parsed = hydrated || parseJobPageHtml(page.html, pageUrl);
    parsed.companyName = 'Apple';
    if (htmlFieldsUsable(parsed, page.html)) {
      return {
        provider: 'applejobs',
        fields: parsed,
        externalJobId: applePositionIdFromUrl(pageUrl) || undefined,
      };
    }
  }

  const positionId = applePositionIdFromUrl(pageUrl);
  const locale = pageUrl.match(/jobs\.apple\.com\/([a-z]{2}-[a-z]{2})\//i)?.[1] || 'en-us';
  const slug = decodeURIComponent(pageUrl.split('/').filter(Boolean).pop() || '').replace(/-/g, ' ');
  try {
    const res = await httpClient.post(
      'https://jobs.apple.com/api/role/search',
      {
        query: positionId.replace(/-\d+$/, '') || slug,
        locale,
        filters: { postingpostLocation: ['postLocation-USA'] },
        page: 1,
      },
      {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Origin: 'https://jobs.apple.com',
          Referer: pageUrl,
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        },
      }
    );
    if (res.status >= 400 || typeof res.data === 'string') return null;
    const rows = Array.isArray(res.data?.searchResults) ? res.data.searchResults : [];
    const match = rows.find((row: any) => {
      const id = String(row?.positionId || row?.id || '');
      return id && (id === positionId || positionId.startsWith(`${id}-`) || positionId.startsWith(id));
    });
    if (!match) return null;
    const fields = mapAppleSearchResult(match, pageUrl);
    fields.companyName = 'Apple';
    if (!fields.jobTitle && !fields.jobDescription) return null;
    return { provider: 'applejobs', fields, externalJobId: positionId || undefined };
  } catch (error) {
    if (error instanceof UnsafeOutboundUrlError) throw error;
    return null;
  }
}

async function fetchMicrosoftCareersPosting(pageUrl: string): Promise<AtsFetchResult | null> {
  const jobId = microsoftJobIdFromUrl(pageUrl);
  const page = await fetchHtmlDocument(pageUrl);
  if (page?.html) {
    const fromDdo = parsePhenomJobDdo(page.html, pageUrl);
    if (fromDdo) {
      fromDdo.companyName = fromDdo.companyName || 'Microsoft';
      if (htmlFieldsUsable(fromDdo, page.html)) {
        return { provider: 'microsoftcareers', fields: fromDdo, externalJobId: jobId || undefined };
      }
    }
  }
  if (!jobId) return null;

  const applyOrigin = 'https://apply.careers.microsoft.com';
  const home = await fetchHtmlDocument(`${applyOrigin}/?domain=microsoft.com`);
  const jsonHeaders = phenomJsonRequestHeaders(
    applyOrigin,
    `${applyOrigin}/?domain=microsoft.com`,
    home?.cookie
  );
  try {
    const search = await httpClient.get(`${applyOrigin}/api/pcsx/search`, {
      params: { domain: 'microsoft.com', query: jobId, start: 0 },
      headers: jsonHeaders,
    });
    const positions = Array.isArray(search.data?.data?.positions) ? search.data.data.positions : [];
    const match = positions.find((row: any) => {
      const ids = [row?.id, row?.atsJobId, row?.displayJobId, row?.ats_job_id, row?.display_job_id].map((value) =>
        String(value || '')
      );
      return ids.includes(jobId);
    });
    if (!match?.id) return null;
    const detail = await httpClient.get(
      `${applyOrigin}/api/apply/v2/jobs/${encodeURIComponent(String(match.id))}`,
      { headers: jsonHeaders }
    );
    if (detail.status >= 400 || !detail.data || typeof detail.data === 'string') return null;
    const fields = mapEightfold(detail.data, 'Microsoft', pageUrl);
    fields.companyName = 'Microsoft';
    fields.applyUrl = pageUrl;
    if (/^ats$/i.test(fields.employmentType)) fields.employmentType = '';
    if (!fields.jobTitle || !fields.jobDescription || isJunkDescription(fields.jobDescription)) {
      return null;
    }
    return { provider: 'microsoftcareers', fields, externalJobId: jobId };
  } catch (error) {
    if (error instanceof UnsafeOutboundUrlError) throw error;
    return null;
  }
}

async function fetchIbmCareersHtml(pageUrl: string): Promise<string> {
  return withIbmCareersFetchLock(async () => {
    const { acquirePooledPage, releasePooledPage } = await import('./browserReusePool');
    const lease = await acquirePooledPage({
      profile: {
        browserType: 'playwright',
        headless: true,
        useStealth: true,
        poolIsolationKey: 'ibm-careers-enrich',
      },
      maxPagesPerBrowser: 1,
      blockResources: true,
    });
    try {
      const page = lease.page;
      await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page
        .getByRole('button', { name: /accept all/i })
        .click({ timeout: 4_000 })
        .catch(() => {});
      await page
        .waitForSelector('h2.banner__text__title, article.article--details', { timeout: 25_000 })
        .catch(() => {});
      // Allow Avature sidebar widgets to hydrate.
      await page.waitForTimeout(2_000);
      return await page.content();
    } finally {
      await releasePooledPage(lease);
    }
  });
}

async function fetchHtmlAtsJob(
  pageUrl: string,
  apiUrl: string,
  provider: AtsProvider,
  companyHint: string
): Promise<AtsFetchResult | null> {
  const res = await httpClient.get(apiUrl, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    responseType: 'text',
    transitional: { forcedJSONParsing: false },
    maxContentLength: 3 * 1024 * 1024,
    maxBodyLength: 3 * 1024 * 1024,
  });
  if (res.status >= 400 || !res.data) return null;
  const fields = parseJobPageHtml(String(res.data), pageUrl);
  if (!fields.companyName) fields.companyName = companyOrEmpty(companyHint);
  if (!htmlFieldsUsable(fields, String(res.data))) return null;
  return { provider, fields };
}

/**
 * Fetch structured job fields from a public ATS API. Returns null when the URL
 * is not an ATS page or the API call fails / returns unusable data.
 */
export async function fetchAtsJob(pageUrl: string): Promise<AtsFetchResult | null> {
  const detected = detectAts(pageUrl);
  if (!detected) return null;

  try {
    if (detected.provider === 'googlecareers') {
      const res = await httpClient.get(detected.apiUrl, {
        headers: {
          Accept: 'text/html,application/xhtml+xml',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        responseType: 'text',
        transitional: { forcedJSONParsing: false },
        maxContentLength: 3 * 1024 * 1024,
        maxBodyLength: 3 * 1024 * 1024,
      });
      if (res.status >= 400 || !res.data) return null;
      const fields = mapGoogleCareersHtml(String(res.data), pageUrl);
      fields.companyName = 'Google';
      const idMatch = pageUrl.match(/\/jobs\/results\/(\d+)/i);
      if (!fields.jobTitle && !fields.jobDescription) return null;
      return {
        provider: 'googlecareers',
        fields,
        externalJobId: idMatch?.[1],
      };
    }

    if (detected.provider === 'ibmcareers') {
      const html = await fetchIbmCareersHtml(detected.apiUrl);
      const fields = mapIbmCareersHtml(html, pageUrl);
      fields.companyName = 'IBM';
      const jobId =
        new URL(pageUrl).searchParams.get('jobId') ||
        (html.match(/\bJob ID\s+(\d+)\b/i)?.[1] || '');
      if (!fields.jobTitle && !fields.jobDescription) return null;
      return {
        provider: 'ibmcareers',
        fields,
        externalJobId: jobId || undefined,
      };
    }

    if (detected.provider === 'applejobs') {
      return await fetchAppleJobsPosting(pageUrl);
    }

    if (detected.provider === 'microsoftcareers') {
      return await fetchMicrosoftCareersPosting(pageUrl);
    }

    if (detected.provider === 'workday') {
      const jobId = workdayRequisitionId(pageUrl);
      if (!jobId) return null;
      return await fetchWorkdayJob(detected.apiUrl, jobId, detected.companyHint, pageUrl);
    }

    if (
      detected.provider === 'icims' ||
      detected.provider === 'taleo' ||
      detected.provider === 'njoyn' ||
      detected.provider === 'careerhtml'
    ) {
      return await fetchHtmlAtsJob(pageUrl, detected.apiUrl, detected.provider, detected.companyHint);
    }

    const res = await httpClient.get(detected.apiUrl, {
      headers: {
        Accept: 'application/json',
        'Ora-Irc-Language': 'en',
      },
    });
    if (res.status >= 400 || !res.data) return null;

    let fields: ParsedJobFields;
    let externalJobId = '';
    switch (detected.provider) {
      case 'greenhouse':
        fields = mapGreenhouse(res.data, detected.companyHint, pageUrl);
        break;
      case 'lever':
        fields = mapLever(res.data, detected.companyHint, pageUrl);
        break;
      case 'ashby': {
        const jobId =
          new URL(pageUrl).searchParams.get('ashby_jid') ||
          new URL(pageUrl).searchParams.get('jobId') ||
          pageUrl.split('/').filter(Boolean).pop() ||
          '';
        fields = mapAshby(res.data, detected.companyHint, pageUrl, jobId);
        break;
      }
      case 'workable':
        fields = mapWorkable(res.data, detected.companyHint, pageUrl);
        break;
      case 'smartrecruiters':
        fields = mapSmartRecruiters(res.data, detected.companyHint, pageUrl);
        break;
      case 'recruitee':
        fields = mapRecruitee(res.data, detected.companyHint, pageUrl);
        break;
      case 'eightfold':
        fields = mapEightfold(res.data, detected.companyHint, pageUrl);
        break;
      case 'oraclecloud': {
        fields = mapOracleCloud(res.data, detected.companyHint, pageUrl);
        const item = Array.isArray(res.data?.items) ? res.data.items[0] : null;
        externalJobId = String(item?.Id || '').trim();
        break;
      }
      default:
        return null;
    }

    if (!fields.jobTitle && !fields.jobDescription) return null;
    return { provider: detected.provider, fields, externalJobId: externalJobId || undefined };
  } catch {
    return null;
  }
}

export { keepAliveAgent, httpClient as atsHttpClient, mapOracleCloud };

/** Board-level detection for collection (list all jobs without Chromium). */
export type AtsBoardProvider =
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'smartrecruiters'
  | 'findly'
  | 'successfactors'
  | 'oraclecloud'
  | 'bankofamerica'
  | 'phenom'
  | 'workday'
  | 'workable'
  | 'recruitee'
  | 'bamboohr'
  | 'personio'
  | 'breezy'
  | 'googlecareers'
  | 'ibmcareers';

export interface AtsBoardDetection {
  provider: AtsBoardProvider;
  companyHint: string;
  /** Public JSON list endpoint (Findly: m-cloud base; org resolved at fetch). */
  listApiUrl: string;
}

const FINDLY_DEFAULT_API_BASE = 'https://jobsapi-internal.m-cloud.io/api/';
const FINDLY_API_HOSTS = new Set(['jobsapi-internal.m-cloud.io', 'jobsapi.m-cloud.io']);

/** HTML controls this value, so permit only the known Findly API hosts. */
export function assertSafeFindlyApiBase(rawApiBase: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawApiBase);
  } catch {
    throw new Error('Findly API base is invalid');
  }
  if (parsed.protocol !== 'https:' || !FINDLY_API_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error('Findly API base is not an allowed Findly host');
  }
  return parsed.toString();
}

/** URL query keys that map onto Findly/m-cloud `facet[]` filters. */
const FINDLY_FACET_ALIASES: Record<string, string> = {
  compliment: 'compliment',
  category: 'primary_category',
  categories: 'primary_category',
  primary_category: 'primary_category',
  parent_category: 'parent_category',
  department: 'department',
  brand: 'brand',
  country: 'compliment',
  location: 'compliment',
};

/**
 * True when the career URL looks like a Findly / CWS (m-cloud) job search board.
 * Org id is not in the URL — resolved from page HTML (`cws_opts`) at fetch time.
 */
export function looksLikeFindlyBoard(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  if (host.includes('findly.com') || host.endsWith('.findly.com')) return true;
  if (path.includes('/job-search-results')) return true;
  return false;
}

/** Pull Organization id + API base from Findly/CWS career page HTML. */
export function parseFindlyConfigFromHtml(html: string): {
  orgId: string;
  apiBase: string;
  jobDetailPath: string;
} | null {
  if (!html) return null;
  let orgId = '';
  let apiBase = FINDLY_DEFAULT_API_BASE;
  let jobDetailPath = '/job';

  const cwsMatch = html.match(/var\s+cws_opts\s*=\s*(\{[\s\S]*?\});/);
  if (cwsMatch?.[1]) {
    try {
      const opts = JSON.parse(cwsMatch[1]);
      orgId = String(opts.org || opts.smartPost_org || '').trim();
      if (opts.api) apiBase = String(opts.api).trim();
      if (opts.job_detail_path) jobDetailPath = String(opts.job_detail_path).trim() || jobDetailPath;
    } catch {
      /* fall through to regex */
    }
  }

  if (!orgId) {
    const orgIdMatch =
      html.match(/org_id\s*:\s*["'](\d{3,})["']/i) ||
      html.match(/["']org["']\s*:\s*["'](\d{3,})["']/i) ||
      html.match(/\borg\s*:\s*["'](\d{3,})["']/i);
    if (orgIdMatch?.[1]) orgId = orgIdMatch[1];
  }

  if (!orgId) return null;
  if (!apiBase.endsWith('/')) apiBase += '/';
  if (!jobDetailPath.startsWith('/')) jobDetailPath = `/${jobDetailPath}`;
  return { orgId, apiBase, jobDetailPath };
}

/**
 * Map career-page query filters onto m-cloud `facet[]` values (`key:value`).
 * Skips pagination params. Passes through existing `facet` / `facet[]` entries.
 */
export function findlyFacetsFromUrl(pageUrl: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(pageUrl);
  } catch {
    return [];
  }
  const skip = new Set(['pg', 'page', 'p', 'startrow', 'offset', 'from', 'limit', 'q', 'keywords', 'search']);
  const facets: string[] = [];
  const seen = new Set<string>();

  const add = (raw: string) => {
    const f = String(raw || '').trim();
    if (!f || !f.includes(':') || seen.has(f)) return;
    seen.add(f);
    facets.push(f);
  };

  for (const [rawKey, value] of parsed.searchParams.entries()) {
    if (!value?.trim()) continue;
    const key = rawKey.replace(/\[\]$/, '').toLowerCase();
    if (key === 'facet') {
      add(value);
      continue;
    }
    if (skip.has(key)) continue;
    const facetKey = FINDLY_FACET_ALIASES[key];
    if (!facetKey) continue;
    add(`${facetKey}:${value.trim()}`);
  }
  return facets;
}

function findlyJobLocation(job: any): string {
  const parts = [job?.primary_city, job?.primary_state, job?.primary_country]
    .map((p: any) => String(p || '').trim())
    .filter(Boolean);
  if (parts.length) return parts.join(', ');
  const compliment = Array.isArray(job?.compliment)
    ? job.compliment.filter(Boolean).join(', ')
    : String(job?.compliment || '').trim();
  return compliment;
}

function mapFindlyBoardJobs(
  jobs: any[],
  companyHint: string,
  origin: string,
  jobDetailPath: string
): AtsBoardJobRow[] {
  return jobs
    .map((job: any) => {
      const id = job?.id != null ? String(job.id) : '';
      const jobUrl =
        String(job?.url || '').trim() ||
        (id ? `${origin.replace(/\/$/, '')}${jobDetailPath}/${id}/` : '');
      const title = String(job?.title || '').trim();
      const company = companyOrEmpty(String(job?.company_name || companyHint || '').trim());
      const row = rowFromParts({
        jobUrl,
        title,
        company: company || companyHint,
        location: findlyJobLocation(job),
        employmentType: String(job?.employment_type || job?.job_type || '').trim() || undefined,
        date: String(job?.open_date || job?.update_date || '').trim() || undefined,
        department: String(job?.department || job?.primary_category || '').trim() || undefined,
      });
      const category = String(job?.primary_category || '').trim();
      if (category) row.jobCategory = category;
      return row;
    })
    .filter((r: AtsBoardJobRow) => r.jobUrl && r.jobTitle);
}

/** Optional limits from the robot/extension (e.g. pagination.maxPages). */
export interface AtsBoardFetchOptions {
  /** When > 0, stop after this many list pages (matches extension Max Pages). */
  maxPages?: number;
}

async function fetchFindlyBoardJobs(
  pageUrl: string,
  companyHint: string,
  options?: AtsBoardFetchOptions
): Promise<AtsBoardFetchResult | null> {
  const htmlRes = await httpClient.get(pageUrl, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    // Career HTML can exceed the default parse budget (DXC ~1.1MB).
    maxContentLength: 4 * 1024 * 1024,
    maxBodyLength: 4 * 1024 * 1024,
    responseType: 'text',
    transformResponse: [(data) => data],
  });
  if (htmlRes.status >= 400 || typeof htmlRes.data !== 'string') return null;

  const cfg = parseFindlyConfigFromHtml(htmlRes.data);
  if (!cfg) return null;
  cfg.apiBase = assertSafeFindlyApiBase(cfg.apiBase);

  let origin: string;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    origin = pageUrl;
  }

  const facets = findlyFacetsFromUrl(pageUrl);
  const limit = 100;
  let offset = 0;
  const all: any[] = [];
  let totalHits = Infinity;
  const maxPages =
    typeof options?.maxPages === 'number' && options.maxPages > 0
      ? Math.floor(options.maxPages)
      : Math.ceil(5000 / limit);
  let pagesFetched = 0;

  while (offset < totalHits && offset < 5000 && pagesFetched < maxPages) {
    const api = new URL('job', cfg.apiBase);
    api.searchParams.set('Organization', cfg.orgId);
    api.searchParams.set('limit', String(limit));
    api.searchParams.set('offset', String(offset));
    for (const facet of facets) {
      api.searchParams.append('facet[]', facet);
    }

    const res = await httpClient.get(api.toString(), {
      headers: { Accept: 'application/json' },
    });
    if (res.status >= 400 || !res.data) break;

    const batch = Array.isArray(res.data?.queryResult) ? res.data.queryResult : [];
    totalHits = typeof res.data?.totalHits === 'number' ? res.data.totalHits : batch.length;
    all.push(...batch);
    pagesFetched += 1;
    if (batch.length < limit) break;
    offset += limit;
  }

  const rows = mapFindlyBoardJobs(all, companyHint, origin, cfg.jobDetailPath);
  if (!rows.length) return null;
  return { provider: 'findly', companyHint, rows };
}

const PHENOM_BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const PHENOM_DEFAULT_DDO_KEY = 'refineSearch';
const PHENOM_DEFAULT_PAGE_NAME = 'search-results';
const PHENOM_WIDGETS_PAGE_SIZE = 20;
const PHENOM_WIDGETS_MARKER = 'phenom-widgets://resolve';

export type PhenomSiteKind = 'widgets' | 'pcsx';

export interface PhenomSiteConfig {
  kind: PhenomSiteKind;
  companyHint: string;
  domain?: string;
  refNum?: string;
  ddoKey: string;
  pageName: string;
}

function phenomQueryLooksLikePcsx(parsed: URL): boolean {
  const pid = (parsed.searchParams.get('pid') || '').trim();
  if (/^\d{6,}$/.test(pid)) return true;
  if (parsed.searchParams.has('filter_include_remote')) return true;
  if (parsed.searchParams.has('filter_include_relocation')) return true;
  if ([...parsed.searchParams.keys()].some((key) => key.startsWith('filter_'))) return true;
  const sortBy = (parsed.searchParams.get('sort_by') || '').trim();
  if (sortBy && /^(distance|relevance|date|hot)$/i.test(sortBy)) return true;
  return false;
}

/** True when the career URL looks like Phenom / Phenom Career Site (Eightfold PCS). */
export function looksLikePhenomBoard(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const path = parsed.pathname.replace(/\/+$/, '') || '/';
  // Google Careers uses sort_by=relevance and careers.google.com — not Phenom PCS.
  if (host === 'google.com' || host.endsWith('.google.com') || host === 'goo.gle') {
    return false;
  }
  if (host.includes('phenompeople.com')) return true;
  if (host === 'eightfold.ai' || host.endsWith('.eightfold.ai')) return true;
  if (host.startsWith('hiring.')) return true;
  if (phenomQueryLooksLikePcsx(parsed)) return true;
  if (/\/job\/[^/]+\/[^/]+\/\d+\/\d+\/?$/i.test(path)) return true;
  if (/\/careers\/job\/\d+/i.test(path)) return true;
  // Qualcomm / NVIDIA-style PCS shells: careers.<brand>.com/careers
  if (host.startsWith('careers.') && /^\/careers$/i.test(path)) return true;
  // Phenom list shells commonly use …/search-results (filters stay on this URL)
  if (/\/(?:[a-z]{2}(?:-[a-z]{2})?\/)*search-results\/?$/i.test(path)) return true;
  // Directory allowlist — exact robot URL preserved; widgets/PCSX use that URL as referer
  if (DIRECTORY_PHENOM_BOARD_HOSTS.has(host)) return true;
  return false;
}

function phenomCompanyHintFromHost(host: string): string {
  const stripped = host
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/^(hiring|careers|jobs)\./, '')
    .replace(/\.eightfold\.ai$/i, '')
    .replace(/\.phenompeople\.com$/i, '');
  const token = stripped.split('.')[0] || host;
  return titleCaseToken(token);
}

function phenomOrigin(pageUrl: string): string | null {
  try {
    return new URL(pageUrl).origin;
  } catch {
    return null;
  }
}

function decodeHtmlJsonBlob(raw: string): any | null {
  const text = String(raw || '')
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, '&')
    .trim();
  if (!text.startsWith('{') && !text.startsWith('[')) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function cookieHeaderFromSetCookie(headers: unknown): string | undefined {
  const rec = headers as { [key: string]: unknown; get?: (name: string) => unknown } | null;
  if (!rec) return undefined;
  const raw =
    rec['set-cookie'] ??
    rec['Set-Cookie'] ??
    (typeof rec.get === 'function' ? rec.get('set-cookie') : undefined);
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const parts = list
    .map((entry) => String(entry || '').split(';')[0].trim())
    .filter(Boolean);
  return parts.length ? parts.join('; ') : undefined;
}

function mergeCookieHeader(existing: string | undefined, incoming: string | undefined): string | undefined {
  if (!incoming) return existing;
  if (!existing) return incoming;
  const map = new Map<string, string>();
  for (const part of `${existing}; ${incoming}`.split(';')) {
    const trimmed = part.trim();
    if (!trimmed || !trimmed.includes('=')) continue;
    const eq = trimmed.indexOf('=');
    map.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
  }
  const joined = [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  return joined || undefined;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function walkFindString(obj: any, keys: string[], depth = 0): string {
  if (!obj || depth > 6) return '';
  if (Array.isArray(obj)) {
    for (const item of obj.slice(0, 40)) {
      const found = walkFindString(item, keys, depth + 1);
      if (found) return found;
    }
    return '';
  }
  if (typeof obj !== 'object') return '';
  const wanted = new Set(keys.map((k) => k.toLowerCase()));
  for (const [key, value] of Object.entries(obj)) {
    if (wanted.has(key.toLowerCase()) && typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') {
      const found = walkFindString(value, keys, depth + 1);
      if (found) return found;
    }
  }
  return '';
}

/**
 * Discover Phenom tenant config from public HTML.
 * Never copies `pid=` from the URL into `refNum`.
 */
export function parsePhenomConfigFromHtml(html: string, pageUrl = ''): PhenomSiteConfig | null {
  if (!html) return null;
  const $ = cheerio.load(String(html));
  const pcsxBlob = decodeHtmlJsonBlob($('#pcsx-data').text());
  const brandingBlob = decodeHtmlJsonBlob($('#branding-data').text());
  const navbarBlob = decodeHtmlJsonBlob($('#navbar-data').text());

  const groupIdMatch = String(html).match(/window\._EF_GROUP_ID\s*=\s*["']([^"']+)["']/i);
  const productMatch = String(html).match(/window\._EF_PRODUCT\s*=\s*["']([^"']+)["']/i);
  const domain =
    firstString(
      groupIdMatch?.[1],
      pcsxBlob?.domain,
      brandingBlob?.domain,
      navbarBlob?.domain
    ) || undefined;
  const product = firstString(productMatch?.[1], navbarBlob?.product);
  const companyHint = firstString(
    walkFindString(navbarBlob, ['company_name', 'companyName']),
    walkFindString(brandingBlob, ['company_name', 'companyName']),
    walkFindString(pcsxBlob, ['company_name', 'companyName']),
    phenomCompanyHintFromHost(phenomOrigin(pageUrl) ? new URL(pageUrl).hostname : '')
  );

  const pcsConfirmed =
    !!pcsxBlob ||
    product.toUpperCase() === 'PCS' ||
    /static\.vscdn\.net/i.test(html) ||
    /pcsx-data|_EF_GROUP_ID|_EF_PRODUCT/i.test(html);

  let phApp: any = null;
  const phAppAssign =
    html.match(/phApp(?:\.ddo)?\s*=\s*(\{[\s\S]*?\});/) ||
    html.match(/window\.phApp\s*=\s*(\{[\s\S]*?\});/);
  if (phAppAssign?.[1]) phApp = decodeHtmlJsonBlob(phAppAssign[1]);

  const refNum = firstString(
    walkFindString(phApp, ['refNum', 'siteId', 'siteID']),
    (html.match(/["']refNum["']\s*:\s*["']([^"']+)["']/) || [])[1]
  );
  const ddoKey =
    firstString(walkFindString(phApp, ['ddoKey']), PHENOM_DEFAULT_DDO_KEY) || PHENOM_DEFAULT_DDO_KEY;
  const pageName =
    firstString(walkFindString(phApp, ['pageName']), PHENOM_DEFAULT_PAGE_NAME) || PHENOM_DEFAULT_PAGE_NAME;

  const widgetsConfirmed =
    !!refNum ||
    /phenompeople\.com/i.test(html) ||
    /refineSearch/i.test(html) ||
    /["']ddoKey["']/i.test(html);

  if (pcsConfirmed && domain) {
    return {
      kind: 'pcsx',
      companyHint: companyHint || phenomCompanyHintFromHost('site'),
      domain,
      ddoKey,
      pageName,
    };
  }
  if (widgetsConfirmed && refNum) {
    return {
      kind: 'widgets',
      companyHint: companyHint || phenomCompanyHintFromHost('site'),
      refNum,
      ddoKey,
      pageName,
    };
  }
  return null;
}

export function buildPhenomWidgetsRequest(
  config: PhenomSiteConfig,
  from: number,
  size = PHENOM_WIDGETS_PAGE_SIZE
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    ddoKey: config.ddoKey || PHENOM_DEFAULT_DDO_KEY,
    pageName: config.pageName || PHENOM_DEFAULT_PAGE_NAME,
    jobs: true,
    counts: true,
    size,
    from,
    keywords: '',
    global: true,
    selected_fields: {},
    sort: { order: 'desc', field: 'postedDate' },
  };
  if (config.refNum) body.refNum = config.refNum;
  return body;
}

function phenomAbsoluteUrl(origin: string, raw: unknown): string {
  const value = String(raw || '').trim();
  if (!value) return '';
  try {
    return new URL(value, origin).toString();
  } catch {
    return '';
  }
}

function phenomWidgetsJobs(data: any): { jobs: any[]; totalHits: number } {
  const root = data?.refineSearch?.data || data?.data || data;
  const jobs = Array.isArray(root?.jobs) ? root.jobs : Array.isArray(data?.jobs) ? data.jobs : [];
  const totalRaw = root?.totalHits ?? root?.hits ?? root?.totalCount ?? data?.totalHits ?? data?.count;
  const totalHits = typeof totalRaw === 'number' && Number.isFinite(totalRaw) ? totalRaw : jobs.length;
  return { jobs, totalHits };
}

function mapPhenomWidgetsJobs(jobs: any[], companyHint: string, origin: string): AtsBoardJobRow[] {
  return jobs
    .map((job) => {
      const jobUrl = phenomAbsoluteUrl(
        origin,
        firstString(
          job?.applyUrl,
          job?.apply_url,
          job?.jobUrl,
          job?.jobURL,
          job?.hostedUrl,
          job?.externalPath,
          job?.url
        )
      );
      const loc = firstString(
        job?.location,
        [job?.city, job?.state, job?.country].filter(Boolean).join(', ')
      );
      return rowFromParts({
        jobUrl,
        title: firstString(job?.title, job?.jobTitle, job?.positionTitle),
        company: firstString(job?.companyName, job?.company, companyHint),
        location: loc,
        employmentType: firstString(job?.type, job?.employmentType, job?.jobType) || undefined,
        date: firstString(job?.postedDate, job?.datePosted, job?.postedDateStr) || undefined,
        department: firstString(job?.category, job?.department, job?.jobCategory) || undefined,
      });
    })
    .filter((row) => row.jobUrl && row.jobTitle);
}

function mapPhenomPcsxPositions(positions: any[], companyHint: string, origin: string): AtsBoardJobRow[] {
  return positions
    .map((job) => {
      const jobUrl = phenomAbsoluteUrl(
        origin,
        firstString(job?.positionUrl, job?.url, job?.applyUrl, job?.canonicalUrl)
      );
      const loc = Array.isArray(job?.locations)
        ? job.locations.filter(Boolean).join(', ')
        : firstString(job?.location, job?.standardizedLocations?.[0]);
      const ts = Number(job?.postedTs || job?.creationTs || 0);
      const date =
        Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : firstString(job?.postedDate);
      return rowFromParts({
        jobUrl,
        title: firstString(job?.name, job?.title, job?.displayJobId),
        company: companyHint,
        location: loc,
        employmentType: firstString(job?.workLocationOption) || undefined,
        date: date || undefined,
        department: firstString(job?.department) || undefined,
      });
    })
    .filter((row) => row.jobUrl && row.jobTitle);
}

function dedupePhenomRows(rows: AtsBoardJobRow[]): AtsBoardJobRow[] {
  const seen = new Set<string>();
  const out: AtsBoardJobRow[] = [];
  for (const row of rows) {
    const key = row.jobUrl;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

const PHENOM_PCSX_PAGE_SIZE = 10;

function phenomHtmlRequestHeaders(cookie?: string): Record<string, string> {
  return {
    Accept: 'text/html,application/xhtml+xml',
    'User-Agent': PHENOM_BROWSER_UA,
    ...(cookie ? { Cookie: cookie } : {}),
  };
}

function phenomJsonRequestHeaders(origin: string, referer: string, cookie?: string): Record<string, string> {
  return {
    Accept: 'application/json',
    'User-Agent': PHENOM_BROWSER_UA,
    Origin: origin,
    Referer: referer,
    ...(cookie ? { Cookie: cookie } : {}),
  };
}

export async function discoverPhenomSiteConfig(
  pageUrl: string
): Promise<{ config: PhenomSiteConfig; origin: string; referer: string; cookie?: string } | null> {
  let origin: string;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return null;
  }
  const host = new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, '');
  const candidates = isMicrosoftCareersHost(host)
    ? [`${origin}/global/en/search-results`, `${origin}/us/en/search-results`, pageUrl, `${origin}/`]
    : [`${origin}/careers`, `${origin}/`, pageUrl];
  let cookie: string | undefined;
  for (const url of candidates) {
    try {
      const res = await httpClient.get(url, {
        headers: phenomHtmlRequestHeaders(cookie),
        maxContentLength: 4 * 1024 * 1024,
        maxBodyLength: 4 * 1024 * 1024,
        responseType: 'text',
        transformResponse: [(data) => data],
      });
      cookie = mergeCookieHeader(cookie, cookieHeaderFromSetCookie(res.headers));
      if (res.status >= 400 || typeof res.data !== 'string') continue;
      const config = parsePhenomConfigFromHtml(res.data, url);
      if (config) return { config, origin, referer: url, cookie };
    } catch (error) {
      if (error instanceof UnsafeOutboundUrlError) throw error;
      continue;
    }
  }
  return null;
}

async function fetchPhenomWidgetsBoard(
  origin: string,
  config: PhenomSiteConfig,
  companyHint: string,
  referer: string,
  cookie: string | undefined,
  maxPages: number,
  maxJobs: number
): Promise<AtsBoardFetchResult | null> {
  if (!config.refNum) return null;
  const allRows: AtsBoardJobRow[] = [];
  let from = 0;
  let totalHits = Infinity;
  let pages = 0;
  const size = PHENOM_WIDGETS_PAGE_SIZE;

  while (from < totalHits && pages < maxPages && allRows.length < maxJobs) {
    const body = buildPhenomWidgetsRequest(config, from, size);
    const res = await httpClient.post(`${origin}/widgets`, body, {
      headers: {
        ...phenomJsonRequestHeaders(origin, referer, cookie),
        'Content-Type': 'application/json',
      },
    });
    if (res.status >= 400 || !res.data) break;
    const { jobs, totalHits: reportedTotal } = phenomWidgetsJobs(res.data);
    totalHits = reportedTotal;
    const batch = mapPhenomWidgetsJobs(jobs, companyHint, origin);
    allRows.push(...batch);
    pages += 1;
    if (jobs.length === 0) {
      if (from >= totalHits) break;
      break;
    }
    if (jobs.length < size && from + jobs.length >= totalHits) break;
    from += size;
    if (pages < maxPages && from < totalHits && allRows.length < maxJobs) {
      await sleepMs(boardPageDelayMs());
    }
  }

  const rows = dedupePhenomRows(allRows).slice(0, maxJobs);
  if (!rows.length) return null;
  return { provider: 'phenom', companyHint, rows };
}

function applyPhenomPcsxSearchParams(api: URL, pageUrl: string, domain: string, start: number): void {
  api.searchParams.set('domain', domain);
  api.searchParams.set('query', '');
  api.searchParams.set('location', '');
  api.searchParams.set('start', String(start));
  try {
    const src = new URL(pageUrl);
    const query = (src.searchParams.get('query') || src.searchParams.get('q') || '').trim();
    if (query) api.searchParams.set('query', query);
    const location = (src.searchParams.get('location') || '').trim();
    if (location) api.searchParams.set('location', location);
    const sortBy = (src.searchParams.get('sort_by') || '').trim();
    if (sortBy && !/^distance$/i.test(sortBy)) api.searchParams.set('sort_by', sortBy);
    for (const [key, value] of src.searchParams.entries()) {
      if (!key.startsWith('filter_') || !value.trim()) continue;
      for (const part of value.split(',').map((item) => item.trim()).filter(Boolean)) {
        api.searchParams.append(key, part);
      }
    }
  } catch {
    /* keep domain/start defaults */
  }
}

function phenomStartUrlHasPcsxFilters(pageUrl: string): boolean {
  try {
    const src = new URL(pageUrl);
    if ((src.searchParams.get('location') || '').trim()) return true;
    return [...src.searchParams.keys()].some((key) => key.startsWith('filter_'));
  } catch {
    return false;
  }
}

async function collectPhenomPcsxPages(
  origin: string,
  domain: string,
  companyHint: string,
  referer: string,
  cookie: string | undefined,
  maxPages: number,
  maxJobs: number,
  pageUrl: string
): Promise<AtsBoardJobRow[]> {
  const allRows: AtsBoardJobRow[] = [];
  let start = 0;
  let total = Infinity;
  let pages = 0;
  const pageSize = PHENOM_PCSX_PAGE_SIZE;

  while (start < total && pages < maxPages && allRows.length < maxJobs) {
    const api = new URL(`${origin}/api/pcsx/search`);
    applyPhenomPcsxSearchParams(api, pageUrl, domain, start);
    const res = await httpClient.get(api.toString(), {
      headers: phenomJsonRequestHeaders(origin, referer, cookie),
    });
    if (res.status >= 400 || !res.data?.data) break;
    const positions = Array.isArray(res.data.data.positions) ? res.data.data.positions : [];
    const reportedTotal = res.data.data.count;
    if (typeof reportedTotal === 'number' && Number.isFinite(reportedTotal)) {
      total = reportedTotal;
    }
    allRows.push(...mapPhenomPcsxPositions(positions, companyHint, origin));
    pages += 1;
    if (positions.length === 0) break;
    start += positions.length || pageSize;
    if (pages < maxPages && start < total && allRows.length < maxJobs) {
      await sleepMs(boardPageDelayMs());
    }
  }
  return dedupePhenomRows(allRows).slice(0, maxJobs);
}

async function fetchPhenomPcsxBoard(
  origin: string,
  config: PhenomSiteConfig,
  companyHint: string,
  referer: string,
  cookie: string | undefined,
  maxPages: number,
  maxJobs: number,
  pageUrl = ''
): Promise<AtsBoardFetchResult | null> {
  const domain = String(config.domain || '').trim();
  if (!domain) return null;
  const searchUrl = pageUrl || referer;
  let rows = await collectPhenomPcsxPages(
    origin,
    domain,
    companyHint,
    referer,
    cookie,
    maxPages,
    maxJobs,
    searchUrl
  );
  if (!rows.length && phenomStartUrlHasPcsxFilters(searchUrl)) {
    const unfiltered = new URL(searchUrl);
    unfiltered.search = '';
    rows = await collectPhenomPcsxPages(
      origin,
      domain,
      companyHint,
      referer,
      cookie,
      maxPages,
      maxJobs,
      unfiltered.toString()
    );
  }
  if (!rows.length) return null;
  return { provider: 'phenom', companyHint, rows };
}

async function fetchPhenomBoardJobs(
  pageUrl: string,
  companyHint: string,
  options?: AtsBoardFetchOptions
): Promise<AtsBoardFetchResult | null> {
  const discovered = await discoverPhenomSiteConfig(pageUrl);
  if (!discovered) return null;

  const { config, origin, referer, cookie } = discovered;
  const hint = firstString(config.companyHint, companyHint);
  const maxPages = limitedPages(options);
  const maxJobs = boardMaxJobs();

  if (config.kind === 'widgets' && config.refNum) {
    const widgets = await fetchPhenomWidgetsBoard(
      origin,
      config,
      hint,
      referer,
      cookie,
      maxPages,
      maxJobs
    );
    if (widgets?.rows.length) return widgets;
  }

  if (config.kind === 'pcsx' && config.domain) {
    const pcsx = await fetchPhenomPcsxBoard(origin, config, hint, referer, cookie, maxPages, maxJobs, pageUrl);
    if (pcsx?.rows.length) return pcsx;
  }

  if (config.kind === 'pcsx' && config.refNum) {
    return fetchPhenomWidgetsBoard(origin, config, hint, referer, cookie, maxPages, maxJobs);
  }

  return null;
}

const SF_DEFAULT_PAGE_SIZE = 25;
const SF_MAX_PAGES_DEFAULT = 200;
const SF_MAX_JOBS_DEFAULT = 5000;

function sfBoardMaxPages(): number {
  return Math.max(1, parseInt(process.env.SF_BOARD_MAX_PAGES || String(SF_MAX_PAGES_DEFAULT), 10) || SF_MAX_PAGES_DEFAULT);
}

function sfBoardMaxJobs(): number {
  return Math.max(1, parseInt(process.env.SF_BOARD_MAX_JOBS || String(SF_MAX_JOBS_DEFAULT), 10) || SF_MAX_JOBS_DEFAULT);
}

function sfBoardPageDelayMs(): number {
  return Math.max(0, parseInt(process.env.SF_BOARD_PAGE_DELAY_MS || '200', 10) || 0);
}

/**
 * True when the career URL looks like a SuccessFactors RMK job search board.
 */
export function looksLikeSuccessFactorsBoard(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.toLowerCase();
  if (host.includes('successfactors.com') || host.includes('successfactors.eu')) {
    return true;
  }
  const isSearchPath = /\/search(?:-\d+)?\/?$/.test(path) || /\/search(?:-\d+)?\//.test(path);
  if (!isSearchPath) return false;
  if (parsed.searchParams.has('startrow')) return true;
  for (const key of parsed.searchParams.keys()) {
    if (key.toLowerCase().startsWith('optionsfacetsdd_')) return true;
  }
  return false;
}

export function successFactorsCompanyHint(host: string): string {
  const h = String(host || '')
    .toLowerCase()
    .replace(/^www\./, '');
  const parts = h.split('.').filter(Boolean);
  let brand = parts[0] || 'successfactors';
  if (parts.length >= 3 && (parts[0] === 'careers' || parts[0] === 'jobs')) {
    brand = parts[1] || parts[0];
  }
  // Short brand codes (ey, ibm, …) look better uppercased on the board.
  if (brand.length <= 3) return brand.toUpperCase();
  return brand.charAt(0).toUpperCase() + brand.slice(1);
}

/** Force startrow=0 while preserving facets / sort / q / locale. */
export function normalizeSuccessFactorsStartUrl(pageUrl: string): string {
  try {
    const u = new URL(pageUrl);
    u.searchParams.set('startrow', '0');
    return u.toString();
  } catch {
    return pageUrl;
  }
}

export function confirmSuccessFactorsHtml(html: string): { ok: boolean; signals: string[] } {
  const signals: string[] = [];
  if (!html) return { ok: false, signals };
  const lower = html.toLowerCase();
  if (lower.includes('successfactors') || lower.includes('rmkcdn.successfactors')) {
    signals.push('successfactors_cdn');
  }
  if (
    /id=["']searchresults["']/i.test(html) ||
    /id=["']search-results["']/i.test(html) ||
    /id=["']search-results-list["']/i.test(html) ||
    /id=["']search-results-filter["']/i.test(html)
  ) {
    signals.push('results_region');
  }
  if (/\/job\/[^"'\\\s]+\/\d+\/?/i.test(html)) {
    signals.push('job_links');
  }
  if (/Page\s+\d+\s+of\s+\d+/i.test(html) || /Results\s+\d+\s*[–-]\s*\d+\s+of\s+\d+/i.test(html)) {
    signals.push('pagination_text');
  }
  return { ok: signals.length >= 2, signals };
}

function stripSfMoreLocations(raw: string): string {
  return String(raw || '')
    .replace(/\+\s*\d+\s*more\s*[.…]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseSuccessFactorsJobsHtml(
  html: string,
  origin: string
): {
  jobs: Array<{ id: string; title: string; jobUrl: string; location: string }>;
  pageOf?: { current: number; total: number };
  resultsOf?: number;
} {
  const $ = cheerio.load(html || '');
  const jobs: Array<{ id: string; title: string; jobUrl: string; location: string }> = [];
  const seen = new Set<string>();

  const anchors = $('a[href*="/job/"]');
  anchors.each((_, el) => {
    const href = String($(el).attr('href') || '').trim();
    if (!href) return;
    const idMatch = href.split('?')[0].match(/\/(\d+)\/?$/);
    if (!idMatch) return;
    const id = idMatch[1];
    if (seen.has(id)) return;
    const title = $(el).text().replace(/\s+/g, ' ').trim();
    if (title.length < 2) return;
    seen.add(id);
    let location = '';
    const tr = $(el).closest('tr');
    if (tr.length) {
      const tds = tr.find('td');
      if (tds.length >= 2) {
        location = stripSfMoreLocations(tds.eq(1).text());
      }
    }
    if (!location) {
      location = stripSfMoreLocations(
        $(el).closest('li, article, div').find('.jobLocation, .job-location, span.location').first().text()
      );
    }
    let jobUrl = href;
    try {
      jobUrl = new URL(href, origin).toString();
    } catch {
      /* keep href */
    }
    jobs.push({
      id,
      title,
      jobUrl,
      location: normalizeLocation(location),
    });
  });

  let pageOf: { current: number; total: number } | undefined;
  const pageMatch = html.match(/Page\s+(\d+)\s+of\s+(\d+)/i);
  if (pageMatch) {
    pageOf = { current: Number(pageMatch[1]), total: Number(pageMatch[2]) };
  }
  let resultsOf: number | undefined;
  const resultsMatch = html.match(/Results\s+\d+\s*[–-]\s*\d+\s+of\s+(\d+)/i);
  if (resultsMatch) resultsOf = Number(resultsMatch[1]);

  return { jobs, pageOf, resultsOf };
}

function sleepMs(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSuccessFactorsHtml(url: string): Promise<string | null> {
  const res = await httpClient.get(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    },
    maxContentLength: 4 * 1024 * 1024,
    maxBodyLength: 4 * 1024 * 1024,
    responseType: 'text',
    transformResponse: [(data) => data],
  });
  if (res.status >= 400 || typeof res.data !== 'string') return null;
  return res.data;
}

async function fetchSuccessFactorsBoardJobs(
  pageUrl: string,
  companyHint: string,
  options?: AtsBoardFetchOptions
): Promise<AtsBoardFetchResult | null> {
  const startUrl = normalizeSuccessFactorsStartUrl(pageUrl);
  let origin: string;
  try {
    origin = new URL(startUrl).origin;
  } catch {
    return null;
  }

  const firstHtml = await fetchSuccessFactorsHtml(startUrl);
  if (!firstHtml) return null;

  const confirmation = confirmSuccessFactorsHtml(firstHtml);
  if (!confirmation.ok) return null;

  const first = parseSuccessFactorsJobsHtml(firstHtml, origin);
  if (!first.jobs.length) return null;

  const pageSize = first.jobs.length || SF_DEFAULT_PAGE_SIZE;
  const seen = new Set<string>();
  const allJobs = [...first.jobs];
  for (const j of first.jobs) seen.add(j.id);

  let maxStartrow = Infinity;
  if (first.pageOf?.total && first.pageOf.total > 0) {
    maxStartrow = (first.pageOf.total - 1) * pageSize;
  } else if (first.resultsOf && first.resultsOf > 0) {
    maxStartrow = Math.max(0, first.resultsOf - 1);
  }

  let startrow = pageSize;
  let pages = 1;
  let hardFail = false;
  // Robot/extension maxPages wins when set (>0). Env/default is the hard ceiling.
  const configuredMax =
    typeof options?.maxPages === 'number' && options.maxPages > 0
      ? Math.floor(options.maxPages)
      : sfBoardMaxPages();
  const maxPages = Math.min(configuredMax, sfBoardMaxPages());
  const maxJobs = sfBoardMaxJobs();

  while (pages < maxPages && allJobs.length < maxJobs && startrow <= maxStartrow) {
    await sleepMs(sfBoardPageDelayMs());
    let pageUrlNext: string;
    try {
      const u = new URL(startUrl);
      u.searchParams.set('startrow', String(startrow));
      pageUrlNext = u.toString();
    } catch {
      break;
    }

    const html = await fetchSuccessFactorsHtml(pageUrlNext);
    if (!html) {
      hardFail = pages <= 1;
      break;
    }
    const parsed = parseSuccessFactorsJobsHtml(html, origin);
    let added = 0;
    for (const j of parsed.jobs) {
      if (seen.has(j.id)) continue;
      seen.add(j.id);
      allJobs.push(j);
      added += 1;
      if (allJobs.length >= maxJobs) break;
    }
    pages += 1;
    if (added === 0) break;
    if (parsed.pageOf?.total) {
      maxStartrow = Math.min(maxStartrow, (parsed.pageOf.total - 1) * pageSize);
    }
    startrow += pageSize;
  }

  if (!allJobs.length) return null;
  if (hardFail && allJobs.length < pageSize) return null;

  const rows = allJobs
    .map((j) =>
      rowFromParts({
        jobUrl: j.jobUrl,
        title: j.title,
        company: companyHint,
        location: j.location,
      })
    )
    .filter((r) => r.jobUrl && r.jobTitle);

  if (!rows.length) return null;
  return { provider: 'successfactors', companyHint, rows };
}

/** One list row shaped for scrapeList → canonical aliases (jobUrl / title / company…). */
export interface AtsBoardJobRow {
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
  [key: string]: string | undefined;
}

export interface AtsBoardFetchResult {
  provider: AtsBoardProvider;
  companyHint: string;
  rows: AtsBoardJobRow[];
}

/**
 * Detect a known ATS **board** (or board token embedded in a job URL) so collection
 * can pull every posting via public JSON instead of Chromium.
 */
export function detectAtsBoard(url: string): AtsBoardDetection | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;
  const parts = path.split('/').filter(Boolean);

  // boards.greenhouse.io/{board}[/jobs[/id]]
  if (/^boards(?:\.eu)?\.greenhouse\.io$/i.test(host) || host.includes('greenhouse.io')) {
    const jobsIdx = parts.indexOf('jobs');
    const board =
      jobsIdx > 0 ? parts[jobsIdx - 1] : parts[0] && parts[0] !== 'embed' ? parts[0] : '';
    if (board && !/^(embed|v1|api)$/i.test(board)) {
      return {
        provider: 'greenhouse',
        companyHint: board,
        listApiUrl: `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`,
      };
    }
  }

  // jobs.lever.co/{company}[/{postingId}]
  if (host === 'jobs.lever.co' || (host.endsWith('.lever.co') && host !== 'api.lever.co')) {
    const company = parts[0];
    if (company) {
      return {
        provider: 'lever',
        companyHint: company,
        listApiUrl: `https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`,
      };
    }
  }

  // jobs.ashbyhq.com/{org}
  if (host === 'jobs.ashbyhq.com') {
    const org = parts[0];
    if (org) {
      return {
        provider: 'ashby',
        companyHint: org,
        listApiUrl: `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(org)}?includeCompensation=true`,
      };
    }
  }

  // jobs.smartrecruiters.com/{company}[/{id}]
  if (host.includes('smartrecruiters.com') && !host.startsWith('api.')) {
    const company = parts[0];
    if (company && company !== 'v1') {
      return {
        provider: 'smartrecruiters',
        companyHint: company,
        listApiUrl: `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings`,
      };
    }
  }

  // Findly / CWS (m-cloud) — org id resolved from page HTML at fetch time
  if (looksLikeFindlyBoard(url)) {
    const hint =
      host.replace(/^www\./, '').split('.')[0] ||
      host.replace(/^www\./, '') ||
      'findly';
    return {
      provider: 'findly',
      companyHint: hint,
      listApiUrl: FINDLY_DEFAULT_API_BASE + 'job',
    };
  }

  // SAP SuccessFactors RMK search boards — HTML paginated by startrow
  if (looksLikeSuccessFactorsBoard(url)) {
    return {
      provider: 'successfactors',
      companyHint: successFactorsCompanyHint(host),
      listApiUrl: url,
    };
  }

  // Oracle Cloud HCM Candidate Experience boards — direct FA hosts, branded
  // vanity hosts (Dell / careers.oracle.com), hash-router shells (Hexaware),
  // and other safe hosts that already expose /hcmUI/CandidateExperience/.../jobs.
  {
    const oracleRoute = parseOracleCandidateExperienceRoute(url);
    if (oracleRoute?.isJobsList && oracleRoute.siteNumber) {
      if (isOracleCloudFaHost(host)) {
        return {
          provider: 'oraclecloud',
          companyHint: oracleTenantCompany(host.split('.')[0]),
          listApiUrl: oracleRecruitingListApi(host),
        };
      }
      if (host === 'careers.oracle.com') {
        return {
          provider: 'oraclecloud',
          companyHint: 'Oracle',
          listApiUrl: oracleRecruitingListApi(oracleCareersHcmHost()),
        };
      }
      if (/\/hcmUI\/CandidateExperience\//i.test(path) && isSafeOracleHcmVanityHost(host)) {
        return {
          provider: 'oraclecloud',
          companyHint:
            ORACLE_HCM_VANITY_HOST_COMPANIES[host] || oracleVanityCompanyHint(host),
          listApiUrl: oracleRecruitingListApi(host),
        };
      }
      if (looksLikeOracleVanityHashBoard(url)) {
        return {
          provider: 'oraclecloud',
          companyHint: oracleVanityCompanyHint(host),
          listApiUrl: ORACLE_VANITY_RESOLVE_MARKER,
        };
      }
    }
  }

  // Bank of America renders its job list client-side, but exposes the same public
  // search endpoint used by its own career page. Accept homepage or job-search paths.
  if (host === 'careers.bankofamerica.com') {
    return {
      provider: 'bankofamerica',
      companyHint: 'Bank of America',
      listApiUrl: `https://${host}/services/jobssearchservlet`,
    };
  }

  // Workday CXS, Workable, Recruitee, BambooHR, Personio, Breezy, Google/IBM boards
  const extra = detectExtraAtsBoard(url);
  if (extra) {
    return {
      provider: extra.provider,
      companyHint: extra.companyHint,
      listApiUrl: extra.listApiUrl,
    };
  }

  if (looksLikePhenomBoard(url)) {
    return {
      provider: 'phenom',
      companyHint: phenomCompanyHintFromHost(host),
      listApiUrl: PHENOM_WIDGETS_MARKER,
    };
  }

  return null;
}

function rowFromParts(opts: {
  jobUrl: string;
  title: string;
  company: string;
  location?: string;
  employmentType?: string;
  date?: string;
  department?: string;
  jobDescription?: string;
}): AtsBoardJobRow {
  const jobUrl = String(opts.jobUrl || '').trim();
  const title = String(opts.title || '').trim();
  const company = companyOrEmpty(opts.company);
  const jobDescription = String(opts.jobDescription || '').trim();
  return {
    jobUrl,
    url: jobUrl,
    jobTitle: title,
    title,
    companyName: company,
    company,
    location: String(opts.location || '').trim(),
    employmentType: opts.employmentType ? String(opts.employmentType).trim() : undefined,
    date: opts.date ? String(opts.date).trim() : undefined,
    department: opts.department ? String(opts.department).trim() : undefined,
    ...(jobDescription ? { jobDescription, description: jobDescription } : {}),
  };
}

function mapGreenhouseBoardJobs(data: any, companyHint: string): AtsBoardJobRow[] {
  const jobs = Array.isArray(data?.jobs) ? data.jobs : Array.isArray(data) ? data : [];
  return jobs
    .map((job: any) => {
      const loc =
        job.location?.name ||
        (Array.isArray(job.offices) ? job.offices.map((o: any) => o?.name).filter(Boolean).join(', ') : '');
      return rowFromParts({
        jobUrl: job.absolute_url || '',
        title: job.title || '',
        company: companyHint,
        location: loc,
        date: job.updated_at || job.created_at || '',
        department: Array.isArray(job.departments)
          ? job.departments.map((d: any) => d?.name).filter(Boolean).join(', ')
          : '',
        jobDescription: stripHtmlTags(job.content || job.description || ''),
      });
    })
    .filter((r: AtsBoardJobRow) => r.jobUrl && r.jobTitle);
}

function mapLeverBoardJobs(data: any, companyHint: string): AtsBoardJobRow[] {
  const jobs = Array.isArray(data) ? data : [];
  return jobs
    .map((job: any) =>
      rowFromParts({
        jobUrl: job.hostedUrl || job.applyUrl || '',
        title: job.text || job.title || '',
        company: companyHint,
        location: job.categories?.location || job.workplaceType || '',
        employmentType: job.categories?.commitment || '',
        date: job.createdAt ? new Date(job.createdAt).toISOString() : '',
        department: job.categories?.team || job.categories?.department || '',
        jobDescription: stripHtmlTags(job.descriptionPlain || job.description || ''),
      })
    )
    .filter((r: AtsBoardJobRow) => r.jobUrl && r.jobTitle);
}

function mapAshbyBoardJobs(data: any, companyHint: string): AtsBoardJobRow[] {
  const jobs = Array.isArray(data?.jobs) ? data.jobs : Array.isArray(data?.jobPostings) ? data.jobPostings : [];
  const orgName = data?.organizationName || companyHint;
  return jobs
    .map((job: any) =>
      rowFromParts({
        jobUrl: job.jobUrl || job.applyUrl || '',
        title: job.title || '',
        company: orgName,
        location:
          job.location ||
          (Array.isArray(job.secondaryLocations)
            ? job.secondaryLocations.map((l: any) => l?.location).filter(Boolean).join(', ')
            : ''),
        employmentType: job.employmentType || '',
        department: job.departmentName || job.teamName || '',
        jobDescription: stripHtmlTags(job.descriptionHtml || job.descriptionPlain || job.description || ''),
      })
    )
    .filter((r: AtsBoardJobRow) => r.jobUrl && r.jobTitle);
}

function mapSmartRecruitersBoardJobs(data: any, companyHint: string): AtsBoardJobRow[] {
  const content = Array.isArray(data?.content) ? data.content : Array.isArray(data) ? data : [];
  return content
    .map((job: any) => {
      const loc = job.location;
      const location = [loc?.city, loc?.region, loc?.country].filter(Boolean).join(', ');
      const jobUrl =
        job.applyUrl ||
        job.postingUrl ||
        (job.id && companyHint
          ? `https://jobs.smartrecruiters.com/${encodeURIComponent(companyHint)}/${encodeURIComponent(job.id)}`
          : '');
      return rowFromParts({
        jobUrl,
        title: job.name || job.title || '',
        company: job.company?.name || companyHint,
        location,
        employmentType: job.typeOfEmployment?.label || '',
        date: job.releasedDate || job.createdOn || '',
        department: job.department?.label || '',
      });
    })
    .filter((r: AtsBoardJobRow) => r.jobUrl && r.jobTitle);
}

function buildOracleBoardJobUrl(
  host: string,
  locale: string,
  siteNumber: string,
  jobId: string
): string {
  const lang = String(locale || 'en').trim() || 'en';
  const id = String(jobId || '').trim();
  if (!id) return '';
  // Oracle's public careers site does not use /hcmUI/CandidateExperience paths.
  if (host.toLowerCase() === 'careers.oracle.com') {
    return `https://careers.oracle.com/${encodeURIComponent(lang)}/sites/${encodeURIComponent(siteNumber)}/job/${encodeURIComponent(id)}`;
  }
  return `https://${host}/hcmUI/CandidateExperience/${encodeURIComponent(lang)}/sites/${encodeURIComponent(siteNumber)}/job/${encodeURIComponent(id)}`;
}

function mapOracleCloudBoardJobs(
  data: any,
  companyHint: string,
  host: string,
  siteNumber: string,
  locale = 'en'
): AtsBoardJobRow[] {
  const search = Array.isArray(data?.items) ? data.items[0] : null;
  const jobs = Array.isArray(search?.requisitionList) ? search.requisitionList : [];
  const lang = String(locale || 'en').trim() || 'en';
  return jobs
    .map((job: any) =>
      rowFromParts({
        jobUrl: job?.Id ? buildOracleBoardJobUrl(host, lang, siteNumber, String(job.Id)) : '',
        title: String(job?.Title || '').trim(),
        company: companyHint,
        location: String(job?.PrimaryLocation || '').trim(),
        employmentType: String(job?.JobType || job?.WorkerType || job?.ContractType || '').trim(),
        date: String(job?.PostedDate || '').trim(),
        department: String(job?.JobFamily || job?.JobFunction || '').trim(),
      })
    )
    .filter((r: AtsBoardJobRow) => r.jobUrl && r.jobTitle);
}

function mapBankOfAmericaBoardJobs(data: any, companyHint: string, origin: string): AtsBoardJobRow[] {
  const jobs = Array.isArray(data?.jobsList) ? data.jobsList : [];
  return jobs
    .map((job: any) =>
      rowFromParts({
        jobUrl: job?.jcrURL ? new URL(String(job.jcrURL), origin).toString() : '',
        title: String(job?.postingTitle || '').trim(),
        company: String(job?.brand || companyHint).trim(),
        location: String(job?.location || job?.primaryLocation || '').trim(),
        employmentType: String(job?.job_type_text || job?.timeType || job?.workShift || '').trim(),
        date: String(job?.postedDate || job?.indexedDate || '').trim(),
        department: String(job?.lob || job?.area || job?.division || '').trim(),
      })
    )
    .filter((r: AtsBoardJobRow) => r.jobUrl && r.jobTitle);
}

const BOARD_MAX_JOBS_DEFAULT = 5000;

function limitedPages(options?: AtsBoardFetchOptions): number {
  return typeof options?.maxPages === 'number' && options.maxPages > 0
    ? Math.floor(options.maxPages)
    : 200;
}

function boardMaxJobs(): number {
  return Math.max(
    1,
    parseInt(process.env.ATS_BOARD_MAX_JOBS || String(BOARD_MAX_JOBS_DEFAULT), 10) || BOARD_MAX_JOBS_DEFAULT
  );
}

function boardPageDelayMs(): number {
  return Math.max(0, parseInt(process.env.ATS_BOARD_PAGE_DELAY_MS || '150', 10) || 0);
}

/** Oracle findReqs is comma-delimited; never inject raw values that contain commas. */
function oracleFinderValue(raw: string): string | null {
  const value = String(raw || '').trim();
  if (!value || value.includes(',')) return null;
  return value;
}

export type OracleCandidateExperienceRoute = {
  locale: string;
  siteNumber: string;
  isJobsList: boolean;
  searchParams: URLSearchParams;
};

/**
 * Parse Oracle CE board/detail routing from either:
 * - path: /hcmUI/CandidateExperience/{locale}/sites/{site}/jobs?...
 * - vanity hash: #{locale}/sites/{site}/jobs?...
 */
export function parseOracleCandidateExperienceRoute(
  url: string
): OracleCandidateExperienceRoute | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const fromSegments = (
    segments: string[],
    searchParams: URLSearchParams
  ): OracleCandidateExperienceRoute | null => {
    const parts = segments.map((p) => decodeURIComponent(p)).filter(Boolean);
    const sitesIdx = parts.findIndex((p) => p.toLowerCase() === 'sites');
    if (sitesIdx < 0 || !parts[sitesIdx + 1]) return null;
    const siteNumber = parts[sitesIdx + 1];
    const afterSite = (parts[sitesIdx + 2] || '').toLowerCase();
    const isJobsList = afterSite === 'jobs' || afterSite.startsWith('jobs?');
    let locale = 'en';
    const ceIdx = parts.findIndex((p) => p.toLowerCase() === 'candidateexperience');
    if (ceIdx >= 0 && parts[ceIdx + 1] && parts[ceIdx + 1].toLowerCase() !== 'sites') {
      locale = parts[ceIdx + 1];
    } else if (sitesIdx > 0) {
      locale = parts[sitesIdx - 1];
    }
    return { locale, siteNumber, isJobsList, searchParams };
  };

  const pathParts = parsed.pathname.split('/').filter(Boolean);
  if (pathParts.some((p) => p.toLowerCase() === 'sites')) {
    const route = fromSegments(pathParts, parsed.searchParams);
    if (route) return route;
  }

  const hash = (parsed.hash || '').replace(/^#/, '').trim();
  if (!hash) return null;
  const qIdx = hash.indexOf('?');
  const hashPath = qIdx >= 0 ? hash.slice(0, qIdx) : hash;
  const hashQuery = qIdx >= 0 ? hash.slice(qIdx + 1) : '';
  return fromSegments(hashPath.split('/'), new URLSearchParams(hashQuery));
}

/** Extract Fusion CE host from Oracle vanity landing HTML; SSRF-safe host allowlist. */
export function parseOracleVanityFusionHost(html: string): string | null {
  if (!html) return null;
  const patterns = [
    /const\s+host\s*=\s*['"]https?:\/\/([a-z0-9.-]+\.fa(?:\.ocs)?\.oraclecloud\.com)['"]/i,
    /host\s*=\s*['"]https?:\/\/([a-z0-9.-]+\.fa(?:\.ocs)?\.oraclecloud\.com)['"]/i,
    /['"]https?:\/\/([a-z0-9.-]+\.fa(?:\.ocs)?\.oraclecloud\.com)['"]\s*;?\s*(?:\/\/.*)?\n[\s\S]{0,120}CandidateExperience/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    const host = (m?.[1] || '').toLowerCase();
    if (host && /\.fa(?:\.ocs)?\.oraclecloud\.com$/i.test(host)) return host;
  }
  return null;
}

export function looksLikeOracleVanityHashBoard(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (isOracleCloudFaHost(host)) return false;
  const route = parseOracleCandidateExperienceRoute(url);
  return Boolean(route?.isJobsList && route.siteNumber && (parsed.hash || '').includes('/sites/'));
}

function oracleVanityCompanyHint(host: string): string {
  return successFactorsCompanyHint(host);
}

async function resolveOracleVanityBoardUrl(
  pageUrl: string,
  companyHint: string
): Promise<{ ceUrl: string; listApiUrl: string; companyHint: string } | null> {
  const route = parseOracleCandidateExperienceRoute(pageUrl);
  if (!route?.isJobsList || !route.siteNumber) {
    throw new Error(`Oracle vanity URL missing site/jobs route: ${pageUrl}`);
  }
  let parsed: URL;
  try {
    parsed = new URL(pageUrl);
  } catch {
    throw new Error(`Oracle vanity URL is invalid: ${pageUrl}`);
  }
  const vanityHost = parsed.hostname.toLowerCase().replace(/^www\./, '');

  let fusionHost = resolveOracleHashVanityFusionHost(vanityHost);
  if (!fusionHost) {
    const htmlRes = await httpClient.get(parsed.origin + '/', {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent':
          'Mozilla/5.0 (compatible; ScoutXBot/1.0; +https://scoutx.ai; ATS board resolve)',
      },
      responseType: 'text',
      transformResponse: [(d) => d],
    });
    if (htmlRes.status >= 400) {
      throw new Error(
        `Oracle vanity landing fetch failed for ${parsed.origin}/ (HTTP ${htmlRes.status})`
      );
    }
    const html = typeof htmlRes.data === 'string' ? htmlRes.data : String(htmlRes.data ?? '');
    fusionHost = parseOracleVanityFusionHost(html);
    if (!fusionHost) {
      throw new Error(
        `Oracle vanity Fusion host not found in landing HTML for ${vanityHost}`
      );
    }
  }

  const qs = route.searchParams.toString();
  const ceUrl =
    `https://${fusionHost}/hcmUI/CandidateExperience/` +
    `${encodeURIComponent(route.locale)}/sites/${encodeURIComponent(route.siteNumber)}/jobs` +
    (qs ? `?${qs}` : '');
  return {
    ceUrl,
    listApiUrl: oracleRecruitingListApi(fusionHost),
    companyHint: companyHint || oracleVanityCompanyHint(vanityHost),
  };
}

function oracleCandidateLocale(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean);
  const idx = parts.findIndex((p) => p.toLowerCase() === 'candidateexperience');
  const locale = idx >= 0 ? parts[idx + 1] : '';
  return locale && locale.toLowerCase() !== 'sites' ? locale : 'en';
}

async function fetchOracleCloudBoardJobs(
  pageUrl: string,
  companyHint: string,
  listApiUrl: string,
  options?: AtsBoardFetchOptions
): Promise<AtsBoardFetchResult | null> {
  const route = parseOracleCandidateExperienceRoute(pageUrl);
  const source = new URL(pageUrl);
  const siteNumber =
    route?.siteNumber ||
    (() => {
      const parts = source.pathname.split('/').filter(Boolean);
      const sitesIdx = parts.indexOf('sites');
      return sitesIdx >= 0 ? parts[sitesIdx + 1] : '';
    })();
  if (!siteNumber) return null;
  const locale = route?.locale || oracleCandidateLocale(source.pathname);
  const filterParams = route?.searchParams || source.searchParams;

  const copiedFinderParams = [
    'keyword',
    'locationId',
    'selectedPostingDatesFacet',
    'selectedTitlesFacet',
    'selectedCategoriesFacet',
    'selectedLocationsFacet',
    'selectedWorkLocationsFacet',
    'selectedWorkplaceTypesFacet',
    'workplaceType',
  ];
  // Free-text location often contains commas ("New York, NY, United States") which
  // corrupt Oracle's comma-delimited finder. Prefer locationId; only copy safe text.
  const pageSize = 100;
  const maxPages = limitedPages(options);
  const maxJobs = boardMaxJobs();
  const all: any[] = [];
  let total = Infinity;
  let offset = 0;
  let pages = 0;
  while (offset < total && pages < maxPages && all.length < maxJobs) {
    const finderParts = [`siteNumber=${siteNumber}`];
    for (const key of copiedFinderParams) {
      const value = oracleFinderValue(filterParams.get(key) || '');
      if (value) finderParts.push(`${key}=${value}`);
    }
    if (!filterParams.get('locationId')) {
      const location = oracleFinderValue(filterParams.get('location') || '');
      if (location) finderParts.push(`location=${location}`);
    }
    finderParts.push(`limit=${pageSize}`, `offset=${offset}`);
    const api = new URL(listApiUrl);
    api.searchParams.set('onlyData', 'true');
    api.searchParams.set('expand', 'requisitionList');
    api.searchParams.set('finder', `findReqs;${finderParts.join(',')}`);
    const res = await httpClient.get(api.toString(), {
      headers: { Accept: 'application/json', 'Ora-Irc-Language': locale },
    });
    if (res.status >= 400 || !res.data) break;
    const search = Array.isArray(res.data?.items) ? res.data.items[0] : null;
    const batch = Array.isArray(search?.requisitionList) ? search.requisitionList : [];
    if (typeof search?.TotalJobsCount === 'number') total = search.TotalJobsCount;
    all.push(...batch);
    pages += 1;
    if (!batch.length) break;
    offset += batch.length;
    if (offset >= total) break;
    // Without a published total, a short page means the end of the list.
    if (batch.length < pageSize && total === Infinity) break;
    if (pages < maxPages && all.length < maxJobs && offset < total) {
      await sleepMs(boardPageDelayMs());
    }
  }
  const rows = mapOracleCloudBoardJobs(
    { items: [{ requisitionList: all.slice(0, maxJobs) }] },
    companyHint,
    source.host,
    siteNumber,
    locale
  );
  return rows.length ? { provider: 'oraclecloud', companyHint, rows } : null;
}

async function fetchBankOfAmericaBoardJobs(
  pageUrl: string,
  companyHint: string,
  listApiUrl: string,
  options?: AtsBoardFetchOptions
): Promise<AtsBoardFetchResult | null> {
  const source = new URL(pageUrl);
  // BoA's servlet uses inclusive start + exclusive end (`rows`), not offset/limit.
  // Example: start=0&rows=10, then start=10&rows=20. start=10&rows=10 returns [].
  const urlStart = Math.max(0, Number(source.searchParams.get('start')) || 0);
  const urlRows = Number(source.searchParams.get('rows'));
  const pageSize = Math.min(
    100,
    Math.max(1, Number.isFinite(urlRows) && urlRows > urlStart ? urlRows - urlStart : urlRows || 100)
  );
  const maxPages = limitedPages(options);
  const maxJobs = boardMaxJobs();
  const all: any[] = [];
  let total = Infinity;
  let start = 0;
  let pages = 0;
  while (start < total && pages < maxPages && all.length < maxJobs) {
    const end = start + pageSize;
    const api = new URL(listApiUrl);
    api.searchParams.set('start', String(start));
    api.searchParams.set('rows', String(end));
    api.searchParams.set('search', source.searchParams.get('search') || 'getAllJobs');
    const keywords = source.searchParams.get('keywords');
    if (keywords) api.searchParams.set('term', keywords);
    for (const key of ['searchstring', 'city', 'state', 'country', 'filters', 'sort']) {
      const value = source.searchParams.get(key);
      if (value) api.searchParams.set(key, value);
    }
    const res = await httpClient.get(api.toString(), { headers: { Accept: 'application/json' } });
    if (res.status >= 400 || !res.data) break;
    const batch = Array.isArray(res.data?.jobsList) ? res.data.jobsList : [];
    if (typeof res.data?.totalMatches === 'number') total = res.data.totalMatches;
    all.push(...batch);
    pages += 1;
    if (!batch.length) break;
    start = end;
    if (start >= total) break;
    if (batch.length < pageSize && total === Infinity) break;
    if (pages < maxPages && all.length < maxJobs && start < total) {
      await sleepMs(boardPageDelayMs());
    }
  }
  const rows = mapBankOfAmericaBoardJobs(
    { jobsList: all.slice(0, maxJobs) },
    companyHint,
    source.origin
  );
  return rows.length ? { provider: 'bankofamerica', companyHint, rows } : null;
}

async function fetchSmartRecruitersAllPages(listApiUrl: string): Promise<any> {
  const limit = 100;
  let offset = 0;
  const all: any[] = [];
  let totalFound = Infinity;
  while (offset < totalFound && offset < 5000) {
    const sep = listApiUrl.includes('?') ? '&' : '?';
    const url = `${listApiUrl}${sep}limit=${limit}&offset=${offset}`;
    const res = await httpClient.get(url, { headers: { Accept: 'application/json' } });
    if (res.status >= 400 || !res.data) break;
    const batch = Array.isArray(res.data?.content) ? res.data.content : [];
    totalFound = typeof res.data?.totalFound === 'number' ? res.data.totalFound : batch.length;
    all.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  return { content: all, totalFound: all.length };
}

/**
 * Fetch public board postings for a detected ATS board URL.
 * Honors `options.maxPages` from the robot/extension when set (> 0).
 * Returns null when the URL is not a supported board or the API fails / returns empty.
 */
export async function fetchAtsBoardJobs(
  pageUrl: string,
  options?: AtsBoardFetchOptions
): Promise<AtsBoardFetchResult | null> {
  const detected = detectAtsBoard(pageUrl);
  if (!detected) return null;

  try {
    if (
      detected.provider === 'workday' ||
      detected.provider === 'workable' ||
      detected.provider === 'recruitee' ||
      detected.provider === 'bamboohr' ||
      detected.provider === 'personio' ||
      detected.provider === 'breezy' ||
      detected.provider === 'googlecareers' ||
      detected.provider === 'ibmcareers'
    ) {
      const extra = await fetchExtraAtsBoardJobs(
        pageUrl,
        {
          provider: detected.provider,
          companyHint: detected.companyHint,
          listApiUrl: detected.listApiUrl,
        },
        httpClient,
        options
      );
      if (!extra?.rows?.length) return null;
      return {
        provider: extra.provider,
        companyHint: extra.companyHint,
        rows: extra.rows as AtsBoardJobRow[],
      };
    }
    if (detected.provider === 'findly') {
      return await fetchFindlyBoardJobs(pageUrl, detected.companyHint, options);
    }
    if (detected.provider === 'successfactors') {
      return await fetchSuccessFactorsBoardJobs(pageUrl, detected.companyHint, options);
    }
    if (detected.provider === 'oraclecloud') {
      let page = pageUrl;
      let listApiUrl = detected.listApiUrl;
      let companyHint = detected.companyHint;
      if (listApiUrl === ORACLE_VANITY_RESOLVE_MARKER || looksLikeOracleVanityHashBoard(pageUrl)) {
        const resolved = await resolveOracleVanityBoardUrl(pageUrl, companyHint);
        if (!resolved) return null;
        page = resolved.ceUrl;
        listApiUrl = resolved.listApiUrl;
        companyHint = resolved.companyHint;
      }
      return await fetchOracleCloudBoardJobs(page, companyHint, listApiUrl, options);
    }
    if (detected.provider === 'bankofamerica') {
      return await fetchBankOfAmericaBoardJobs(
        pageUrl,
        detected.companyHint,
        detected.listApiUrl,
        options
      );
    }
    if (detected.provider === 'phenom') {
      return await fetchPhenomBoardJobs(pageUrl, detected.companyHint, options);
    }

    let data: any;
    if (detected.provider === 'smartrecruiters') {
      data = await fetchSmartRecruitersAllPages(detected.listApiUrl);
    } else {
      const res = await httpClient.get(detected.listApiUrl, {
        headers: { Accept: 'application/json' },
      });
      if (res.status >= 400 || !res.data) return null;
      data = res.data;
    }

    let rows: AtsBoardJobRow[] = [];
    switch (detected.provider) {
      case 'greenhouse':
        rows = mapGreenhouseBoardJobs(data, detected.companyHint);
        break;
      case 'lever':
        rows = mapLeverBoardJobs(data, detected.companyHint);
        break;
      case 'ashby':
        rows = mapAshbyBoardJobs(data, detected.companyHint);
        break;
      case 'smartrecruiters':
        rows = mapSmartRecruitersBoardJobs(data, detected.companyHint);
        break;
      default:
        return null;
    }

    if (!rows.length) return null;
    return {
      provider: detected.provider,
      companyHint: detected.companyHint,
      rows,
    };
  } catch (err) {
    // Oracle vanity resolve used to return null on any failure, which made
    // production look like "0 rows" with no usable diagnostic. Re-throw so the
    // scraper worker logs the real cause before browser fallback.
    if (detected.provider === 'oraclecloud') throw err;
    return null;
  }
}


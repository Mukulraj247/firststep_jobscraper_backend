import axios, { AxiosInstance } from 'axios';
import http from 'http';
import https from 'https';
import { isIP } from 'net';
import type { Page } from 'playwright-core';
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
import { assertPinnedPeerInAllowlist, createAllowlistLookup } from './safeOutboundHttp';
import { DIRECTORY_CAREER_HTML_HOST_COMPANIES } from './careerHtmlHostsDirectory';
import { DIRECTORY_PHENOM_BOARD_HOSTS } from './phenomBoardHostsDirectory';
import { FINDLY_BOARD_HOSTS } from './findlyBoardHostsDirectory';
import { detectExtraAtsBoard, fetchExtraAtsBoardJobs } from './atsFreeBoardExtras';
import { isTalentBrewWorkdayHost } from './talentBrewWorkdayHostsDirectory';
import { isJibeCareerHost, jibeCareerBoardConfig } from './jibeBoardHostsDirectory';
import {
  isZwayamCareerHost,
  looksLikeZwayamBoard,
  zwayamCareerBoardConfig,
} from './zwayamBoardHostsDirectory';
import {
  apptrssCareerBoardConfig,
  looksLikeApptrssBoard,
} from './apptrssBoardHostsDirectory';

export { looksLikeZwayamBoard, isZwayamCareerHost } from './zwayamBoardHostsDirectory';
export { looksLikeApptrssBoard } from './apptrssBoardHostsDirectory';
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
  | 'phenom'
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
  'jobs.twilio.com': 'twilio',
  'twilio.com': 'twilio',
};

/**
 * SmartRecruiters Connected career sites (vanity host → posting-API company id).
 * Path is typically /careers-home/jobs — not jobs.smartrecruiters.com/{company}.
 * Note: DocuSign migrated to Jibe (`careers.docusign.com/api/jobs`) — do not map here.
 */
const SMARTRECRUITERS_VANITY_HOSTS: Record<string, string> = {};

export function isSmartRecruitersVanityHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return Boolean(SMARTRECRUITERS_VANITY_HOSTS[host]);
  } catch {
    return false;
  }
}

/** Connected career sites whose public SR postings API may be empty while the SPA still lists jobs. */
export function isSmartRecruitersConnectedCompany(companyHint: string): boolean {
  const hint = String(companyHint || '').trim();
  if (!hint) return false;
  const lower = hint.toLowerCase();
  return Object.values(SMARTRECRUITERS_VANITY_HOSTS).some((v) => v.toLowerCase() === lower);
}

export function smartRecruitersVanityJobsPath(url: string): string | null {
  if (!isSmartRecruitersVanityHost(url)) return null;
  return '/careers-home/jobs';
}

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

export function looksLikeGreenhouseBoard(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (host.includes('greenhouse.io')) return true;
    const board = GREENHOUSE_VANITY_BOARDS[host];
    if (!board) return false;
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    if (host.startsWith('careers.') || host.startsWith('jobs.')) return true;
    return /\/(careers|jobs)(\/|$)/i.test(path);
  } catch {
    return false;
  }
}

function greenhouseVanityListDetection(parsed: URL): AtsBoardDetection | null {
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const board = GREENHOUSE_VANITY_BOARDS[host];
  if (!board) return null;
  if (!looksLikeGreenhouseBoard(parsed.href)) return null;
  return {
    provider: 'greenhouse',
    companyHint: board,
    listApiUrl: `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`,
  };
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
function detectSalesforceWorkdayBoard(parsed: URL): AtsBoardDetection | null {
  const host = parsed.hostname.toLowerCase().replace(/^www\./i, '');
  if (host !== 'salesforce.com' && host !== 'careers.salesforce.com') return null;
  if (!/\/company\/careers\/jobs/i.test(parsed.pathname)) return null;
  // JR posting URLs are handled by detectSalesforceWorkday (detail fetch).
  if (/\bjr\d+\b/i.test(parsed.pathname)) return null;
  return {
    provider: 'workday',
    companyHint: 'Salesforce',
    listApiUrl: `${SALESFORCE_WORKDAY_BASE}/jobs`,
  };
}

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
    lookup: createAllowlistLookup(target.addresses),
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

function phenomPcsxJobIdFromUrl(parsed: URL): string {
  const pid = (parsed.searchParams.get('pid') || parsed.searchParams.get('position_id') || '').trim();
  if (/^\d+$/.test(pid)) return pid;
  const path = parsed.pathname.replace(/\/+$/, '') || '/';
  // PCSX detail pages are `/careers/job/{id}` (optional locale). Do not match Oracle
  // `/hcmUI/.../sites/careers/job/{id}` or other nested career paths.
  return path.match(/^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?careers\/job\/(\d+)(?:\/[^/]+)?$/i)?.[1] || '';
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

/** Phenom PCSX vanity hosts (NVIDIA, Qualcomm, …) expose the same apply JSON as Eightfold. */
function detectPhenomPcsxJob(
  parsed: URL
): { provider: 'phenom'; apiUrl: string; companyHint: string } | null {
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (isIP(host) || isMicrosoftCareersHost(host)) return null;
  if (host === 'eightfold.ai' || host.endsWith('.eightfold.ai')) return null;
  if (!looksLikePhenomBoard(parsed.href)) return null;
  const jobId = phenomPcsxJobIdFromUrl(parsed);
  if (!jobId) return null;
  return {
    provider: 'phenom',
    apiUrl: `https://${parsed.hostname}/api/apply/v2/jobs/${encodeURIComponent(jobId)}`,
    companyHint: phenomCompanyHintFromHost(host),
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

  const phenomPcsx = detectPhenomPcsxJob(parsed);
  if (phenomPcsx) return phenomPcsx;

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

async function fetchPhenomPcsxPosting(
  pageUrl: string,
  apiUrl: string,
  companyHint: string
): Promise<AtsFetchResult | null> {
  let parsed: URL;
  try {
    parsed = new URL(pageUrl);
  } catch {
    return null;
  }
  const origin = parsed.origin;
  const jobId = phenomPcsxJobIdFromUrl(parsed);
  try {
    const res = await httpClient.get(apiUrl, {
      headers: phenomJsonRequestHeaders(origin, pageUrl),
    });
    if (res.status >= 400 || !res.data || typeof res.data === 'string') return null;
    const fields = mapEightfold(res.data, companyHint, pageUrl);
    fields.companyName = fields.companyName || companyHint;
    fields.applyUrl = pageUrl;
    if (/^ats$/i.test(fields.employmentType)) fields.employmentType = '';
    if (!fields.jobTitle || !fields.jobDescription || isJunkDescription(fields.jobDescription)) {
      return null;
    }
    return { provider: 'phenom', fields, externalJobId: jobId || undefined };
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

    if (detected.provider === 'phenom') {
      return await fetchPhenomPcsxPosting(pageUrl, detected.apiUrl, detected.companyHint);
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
  | 'happydance'
  | 'workday'
  | 'workable'
  | 'recruitee'
  | 'bamboohr'
  | 'personio'
  | 'breezy'
  | 'googlecareers'
  | 'ibmcareers'
  | 'nasactivate'
  | 'jibe'
  | 'wayfair'
  | 'talentbrew'
  | 'zwayam'
  | 'apptrss'
  | 'avaturehtml';

export interface AtsBoardDetection {
  provider: AtsBoardProvider;
  companyHint: string;
  /** Public JSON list endpoint (Findly: m-cloud base; org resolved at fetch). */
  listApiUrl: string;
}

const FINDLY_DEFAULT_API_BASE = 'https://jobsapi-internal.m-cloud.io/api/';
const FINDLY_API_HOSTS = new Set([
  'jobsapi-internal.m-cloud.io',
  'jobsapi.m-cloud.io',
  'jobsapi-google.m-cloud.io',
]);

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
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const path = parsed.pathname.toLowerCase();
  // Phenom directory hosts sometimes reuse /job-search-results in recorded URLs;
  // they must not be routed through Findly m-cloud (no cws_opts on page).
  if (DIRECTORY_PHENOM_BOARD_HOSTS.has(host)) return false;
  if (FINDLY_BOARD_HOSTS.has(host)) return true;
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
  const skip = new Set(['pg', 'page', 'p', 'startrow', 'offset', 'from', 'limit']);
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

function findlyCompanyHintFromHost(host: string): string {
  const normalized = String(host || '')
    .toLowerCase()
    .replace(/^www\./, '');
  if (CAREER_HTML_HOST_COMPANIES[normalized]) return CAREER_HTML_HOST_COMPANIES[normalized];
  if (DIRECTORY_CAREER_HTML_HOST_COMPANIES[normalized]) {
    return DIRECTORY_CAREER_HTML_HOST_COMPANIES[normalized];
  }
  const parts = normalized.split('.').filter(Boolean);
  if (parts.length >= 3 && (parts[0] === 'careers' || parts[0] === 'jobs')) {
    return titleCaseToken(parts[1] || parts[0]);
  }
  return titleCaseToken(parts[0] || normalized);
}

/** Trailing slash avoids empty-body 301 when fetching Findly HTML config. */
export function normalizeFindlyBoardPageUrl(pageUrl: string): string {
  try {
    const parsed = new URL(pageUrl);
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    if (path === '/' || path === '') {
      parsed.pathname = '/job-search-results/';
      return parsed.toString();
    }
    if (/\/job-search-results$/i.test(path)) {
      parsed.pathname = '/job-search-results/';
      return parsed.toString();
    }
    return pageUrl;
  } catch {
    return pageUrl;
  }
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
  /** When > 0, persist at most this many rows (listExtraction.maxItems). */
  maxItems?: number;
}

const ATS_PAGINATION_QUERY_KEYS = new Set([
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

const ATS_COLLECTION_FILTER_KEYS = new Set([
  'location',
  'locations',
  'country',
  'team',
  'department',
  'category',
  'categories',
  'keywords',
  'q',
  'query',
  'searchstring',
  'searchtext',
  'keyword',
  'locationid',
  'locationcountry',
  'jobfamilygroup',
  'workersubtype',
  'timetype',
  'regionalcountry',
  'geolocationstring',
  'countries',
  'categoryid',
  'industryid',
  'familyid',
  'remotejobs',
  'teamids',
  'countryids',
  'locationids',
  'stateids',
  'teamcategoryids',
  'selectedjobtypeids',
  'jobtypeids',
]);

/** Phenom hosts that expose job lists at `/search-jobs` (Intuit). Not Talent Brew. */
const PHENOM_SEARCH_JOBS_HOSTS = new Set<string>([]);


/**
 * True when the start URL carries list filters the ATS path must honor.
 * Pagination-only keys (`page`, `pagesize`, `#results`) are not filters.
 */
export function startUrlHasCollectionFilters(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const path = parsed.pathname.replace(/\/+$/, '') || '/';
  if (/\/c\/[^/]+/i.test(path)) return true;
  // Talent Brew SEO paths encode keywords/location after /search-jobs/…
  // (e.g. careers.moodys.com/en/search-jobs/technology/United%20States/49841/…).
  if (/\/search-jobs\//i.test(path)) {
    if (isTalentBrewWorkdayHost(url)) return false;
    return true;
  }
  // Phenom / Intuit list shells are collection pages (Talent Brew /search-jobs is not Phenom).
  if (/\/search-jobs$/i.test(path)) {
    try {
      const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
      if (PHENOM_SEARCH_JOBS_HOSTS.has(host)) return true;
      if (isTalentBrewWorkdayHost(url)) return false;
      // Bare Talent Brew /search-jobs shell — allow ATS collection without query filters.
      if (looksLikeTalentBrewBoard(url)) return true;
    } catch {
      return false;
    }
  }
  if (/\/(?:[a-z]{2}(?:-[a-z]{2})?\/)*search-results$/i.test(path)) return true;
  for (const [rawKey, rawValue] of parsed.searchParams.entries()) {
    const key = rawKey.replace(/\[\]$/, '');
    const kl = key.toLowerCase();
    const value = String(rawValue || '').trim();
    if (ATS_PAGINATION_QUERY_KEYS.has(kl)) continue;
    if (kl === 'jtstartindex' || kl === 'jtpagesize' || kl === 'jtsorting') continue;
    if (kl === 'gh_src' || kl === 'ashby_jid' || kl === 'pid') continue;
    if (kl === 'search' || kl === 'q' || kl === 'query' || kl === 'keywords') {
      if (value) return true;
      continue;
    }
    if (!value) continue;
    if (ATS_COLLECTION_FILTER_KEYS.has(kl)) return true;
    if (kl.startsWith('filter_')) return true;
    if (kl.startsWith('facet')) return true;
    if (kl.startsWith('optionsfacetsdd_')) return true;
    if (kl.startsWith('field_keyword_')) return true;
    if (kl.startsWith('selected') && kl.includes('facet')) return true;
  }
  return false;
}

export function findlySearchKeywordFromUrl(pageUrl: string): string {
  try {
    const parsed = new URL(pageUrl);
    return (
      parsed.searchParams.get('keywords') ||
      parsed.searchParams.get('q') ||
      parsed.searchParams.get('search') ||
      ''
    ).trim();
  } catch {
    return '';
  }
}

/**
 * Load More / Show More / infinite-scroll limits from the extension are click
 * (or scroll) counts on the live page. ATS JSON adapters paginate with large
 * API page sizes (Oracle CE uses 100), so `maxPages=3` would dump the whole
 * board instead of ~3 extra result chunks. Skip ATS so the browser extractor
 * can honor the recorded control.
 */
/** Workday CXS JSON is more reliable than recorded CSS next-buttons on SPA boards. */
export function looksLikeWorkdayBoard(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (/^[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com$/i.test(host)) return true;
    if (isTalentBrewWorkdayHost(url)) return true;
    return detectSalesforceWorkdayBoard(parsed) !== null;
  } catch {
    return false;
  }
}

/** Salesforce.com /careers/jobs list — CXS JSON only; Chromium on the marketing SPA dies. */
export function isSalesforceMarketingJobsUrl(url: string): boolean {
  try {
    return detectSalesforceWorkdayBoard(new URL(url)) !== null;
  } catch {
    return false;
  }
}

export function shouldSkipAtsBoardForUiPagination(config?: Record<string, any> | null): boolean {
  const pagination = config?.listExtraction?.pagination;
  const mode = String(pagination?.mode || '').toLowerCase();
  if (mode === 'infinite-scroll') return true;
  if (mode !== 'next-button') return false;
  return Boolean(String(pagination?.nextButtonSelector || '').trim());
}

const ATS_PROVIDERS_THAT_HONOR_START_URL_FILTERS = new Set([
  'phenom',
  'happydance',
  'workday',
  'greenhouse',
  'lever',
  'ashby',
  'findly',
  'smartrecruiters',
  'workable',
  'recruitee',
  'bamboohr',
  'personio',
  'breezy',
  'googlecareers',
  'ibmcareers',
  'bankofamerica',
  'successfactors',
  'oraclecloud',
  'nasactivate',
  'jibe',
  'wayfair',
  'talentbrew',
  'zwayam',
  'apptrss',
  'avaturehtml',
]);

/** True when public ATS JSON can honor this start URL — skip Chromium Load More. */
export function shouldPreferAtsBoardOverUiPagination(url: string): boolean {
  const detected = detectAtsBoard(url);
  return !!(detected && ATS_PROVIDERS_THAT_HONOR_START_URL_FILTERS.has(detected.provider));
}

async function fetchFindlyBoardJobs(
  pageUrl: string,
  companyHint: string,
  options?: AtsBoardFetchOptions
): Promise<AtsBoardFetchResult | null> {
  let fetchUrl = normalizeFindlyBoardPageUrl(pageUrl);
  let htmlRes = await httpClient.get(fetchUrl, {
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
  if ([301, 302, 307, 308].includes(htmlRes.status)) {
    const location = String(htmlRes.headers?.location || '').trim();
    if (location) {
      fetchUrl = new URL(location, fetchUrl).toString();
      htmlRes = await httpClient.get(fetchUrl, {
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
    }
  }
  if (htmlRes.status >= 400 || typeof htmlRes.data !== 'string') return null;

  const cfg = parseFindlyConfigFromHtml(htmlRes.data);
  if (!cfg) return null;
  cfg.apiBase = assertSafeFindlyApiBase(cfg.apiBase);

  let origin: string;
  try {
    origin = new URL(fetchUrl).origin;
  } catch {
    origin = fetchUrl;
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
    const useGoogleSearch =
      /companies\//i.test(cfg.orgId) || /jobsapi-google\.m-cloud\.io/i.test(cfg.apiBase);
    const api = new URL(useGoogleSearch ? 'job/search' : 'job', cfg.apiBase);
    if (useGoogleSearch) {
      api.searchParams.set('companyName', cfg.orgId);
      api.searchParams.set('pageSize', String(limit));
      if (offset > 0) api.searchParams.set('offset', String(offset));
    } else {
      api.searchParams.set('Organization', cfg.orgId);
      api.searchParams.set('limit', String(limit));
      api.searchParams.set('offset', String(offset));
    }
    const keyword = findlySearchKeywordFromUrl(pageUrl);
    if (keyword) {
      api.searchParams.set(useGoogleSearch ? 'keyword' : 'keyword', keyword);
    }
    for (const facet of facets) {
      api.searchParams.append(useGoogleSearch ? 'facet' : 'facet[]', facet);
    }

    const res = await httpClient.get(api.toString(), {
      headers: { Accept: 'application/json' },
    });
    if (res.status >= 400 || !res.data) break;

    const batch = useGoogleSearch
      ? (Array.isArray(res.data?.searchResults)
          ? res.data.searchResults.map((hit: any) => hit?.job || hit).filter(Boolean)
          : [])
      : Array.isArray(res.data?.queryResult)
        ? res.data.queryResult
        : [];
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

/** Known Phenom widgets tenants when HTML discovery is blocked (CAPTCHA/WAF). */
const PHENOM_STATIC_SITE_CONFIG: Record<string, PhenomSiteConfig> = {
  'careers.circle.com': {
    kind: 'widgets',
    companyHint: 'Circle',
    refNum: 'CIICIRUS',
    ddoKey: PHENOM_DEFAULT_DDO_KEY,
    pageName: PHENOM_DEFAULT_PAGE_NAME,
  },
  // Cloudflare blocks careers.cognizant.com HTML; widgets live on phenompro CDN.
  'careers.cognizant.com': {
    kind: 'widgets',
    companyHint: 'Cognizant',
    refNum: 'COGNGLOBAL',
    apiOrigin: 'https://cognizant.phenompro.com',
    careerOrigin: 'https://careers.cognizant.com',
    ddoKey: PHENOM_DEFAULT_DDO_KEY,
    pageName: PHENOM_DEFAULT_PAGE_NAME,
  },
  // Akamai blocks www.virtusa.com/widgets; widgets sit under /careers/job-search/.
  'virtusa.com': {
    kind: 'widgets',
    companyHint: 'Virtusa',
    refNum: 'VIRTGLOBAL',
    widgetsPath: '/careers/job-search/widgets',
    ddoKey: PHENOM_DEFAULT_DDO_KEY,
    pageName: PHENOM_DEFAULT_PAGE_NAME,
  },
};
const PHENOM_WIDGETS_PAGE_SIZE = 20;
const PHENOM_WIDGETS_MARKER = 'phenom-widgets://resolve';

export type PhenomSiteKind = 'widgets' | 'pcsx';

export interface PhenomSiteConfig {
  kind: PhenomSiteKind;
  companyHint: string;
  domain?: string;
  refNum?: string;
  /** When set, POST widgets to this origin instead of the career page origin. */
  apiOrigin?: string;
  /** Career site origin for absolute job URLs (defaults to page URL origin). */
  careerOrigin?: string;
  /** Widgets path on apiOrigin/page origin (default `/widgets`). */
  widgetsPath?: string;
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

/**
 * Phenom widgets lists: `/jobs` with pagesize / #results.
 * Locale-prefixed `/en/jobs` and localless PHB hosts (Pinterest, ServiceNow) are HappyDance.
 */
function phenomQueryLooksLikeWidgets(parsed: URL): boolean {
  if (!parsed.searchParams.has('pagesize')) return false;
  const hash = parsed.hash.replace(/^#/, '').toLowerCase();
  const path = parsed.pathname.replace(/\/+$/, '') || '/';
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (HAPPYDANCE_BOARD_HOSTS.has(host) || happyDanceJobsPath(path)) return false;
  const jobsPath = /\/jobs$/i.test(path);
  if (hash === 'results' && jobsPath) return true;
  if (
    jobsPath &&
    parsed.searchParams.has('search') &&
    (parsed.searchParams.has('team') ||
      parsed.searchParams.has('location') ||
      parsed.searchParams.has('country'))
  ) {
    return true;
  }
  return false;
}

const HAPPYDANCE_BOARD_HOSTS = new Set([
  'careers.box.com',
  'careers.nutanix.com',
  'careers.servicenow.com',
  'pinterestcareers.com',
  'mycareer.verizon.com',
  // Migrated off Phenom — public RSS at /en/jobs/xml/?rss=true
  'wellsfargojobs.com',
]);

/** Hosts whose PHB RSS lives at /jobs/xml (not /en/jobs/xml). Axios does not follow ATS redirects. */
const HAPPYDANCE_LOCALELESS_RSS_HOSTS = new Set([
  'careers.servicenow.com',
  'pinterestcareers.com',
  'mycareer.verizon.com',
]);

function happyDanceJobsPath(path: string): boolean {
  return /^\/[a-z]{2}(?:-[a-z]{2})?\/jobs(?:\/xml)?$/i.test(path);
}

function happyDanceCompanyHint(host: string): string {
  const stripped = host
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/^(careers|jobs|mycareer|hiring)\./, '');
  const token = stripped.split('.')[0] || host;
  if (token === 'box') return 'Box';
  if (token === 'servicenow') return 'ServiceNow';
  if (token === 'pinterest' || token === 'pinterestcareers') return 'Pinterest';
  if (token === 'verizon') return 'Verizon';
  if (token === 'wellsfargo' || token === 'wellsfargojobs') return 'Wells Fargo';
  return titleCaseToken(token);
}

export function happyDanceRssUrl(pageUrl: string): string {
  try {
    const parsed = new URL(pageUrl);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    if (HAPPYDANCE_LOCALELESS_RSS_HOSTS.has(host) || /^\/jobs(?:\/xml)?$/i.test(path)) {
      return `${parsed.origin}/jobs/xml/?rss=true`;
    }
    // Only take locale from /{locale}/jobs… — not from stale Phenom /us/en/search-results.
    const locale = path.match(/^\/([a-z]{2}(?:-[a-z]{2})?)\/jobs(?:\/|$)/i)?.[1] || 'en';
    return `${parsed.origin}/${locale}/jobs/xml/?rss=true`;
  } catch {
    return '';
  }
}

/** True when host is a known HappyDance PHB career site (homepage or list). */
export function isHappyDanceBoardHost(urlOrHost: string): boolean {
  const raw = String(urlOrHost || '').trim();
  if (!raw) return false;
  try {
    const host = (raw.includes('://') ? new URL(raw).hostname : raw)
      .toLowerCase()
      .replace(/^www\./, '');
    return HAPPYDANCE_BOARD_HOSTS.has(host) || HAPPYDANCE_LOCALELESS_RSS_HOSTS.has(host);
  } catch {
    return false;
  }
}

/** True when the career URL is a HappyDance PHB job list (RSS at /{locale}/jobs/xml/?rss=true). */
export function looksLikeHappyDanceBoard(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (HAPPYDANCE_BOARD_HOSTS.has(host)) return true;
  const path = parsed.pathname.replace(/\/+$/, '') || '/';
  if (HAPPYDANCE_LOCALELESS_RSS_HOSTS.has(host) && /^\/jobs(?:\/xml)?$/i.test(path)) return true;
  if (!happyDanceJobsPath(path)) return false;
  if (/\/xml$/i.test(path) || parsed.searchParams.has('rss')) return true;
  if (parsed.searchParams.has('pagesize')) return true;
  const hash = parsed.hash.replace(/^#/, '').toLowerCase();
  if (hash === 'results') return true;
  return (
    parsed.searchParams.has('team') ||
    parsed.searchParams.has('location') ||
    parsed.searchParams.has('search') ||
    parsed.searchParams.has('country')
  );
}

function uniqueQueryValues(parsed: URL, key: string): string[] {
  return parsed.searchParams
    .getAll(key)
    .map((value) => value.trim())
    .filter(Boolean);
}

const ATS_DEFAULT_LOCATION_COUNTRY = 'United States';

const ATS_US_STATE_ABBREVS = new Set([
  'al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'de', 'fl', 'ga', 'hi', 'id', 'il', 'in', 'ia', 'ks',
  'ky', 'la', 'me', 'md', 'ma', 'mi', 'mn', 'ms', 'mo', 'mt', 'ne', 'nv', 'nh', 'nj', 'nm', 'ny',
  'nc', 'nd', 'oh', 'ok', 'or', 'pa', 'ri', 'sc', 'sd', 'tn', 'tx', 'ut', 'vt', 'va', 'wa', 'wv',
  'wi', 'wy', 'dc',
]);

const ATS_NON_US_LOCATION_MARKERS = [
  'united kingdom', 'great britain', 'england', 'scotland', 'wales', 'northern ireland',
  'canada', 'mexico', 'india', 'japan', 'china', 'germany', 'france', 'australia', 'singapore',
  'netherlands', 'ireland', 'brazil', 'poland', 'spain', 'italy', 'sweden', 'israel',
  'switzerland', 'hong kong', 'korea', 'philippines', 'vietnam', 'indonesia', 'malaysia',
  'thailand', 'united arab emirates', 'dubai', 'saudi', 'nigeria', 'kenya', 'south africa',
  'new zealand', 'austria', 'belgium', 'denmark', 'norway', 'finland', 'portugal',
  'czech', 'romania', 'hungary', 'ukraine', 'russia', 'turkey', 'pakistan', 'bangladesh',
  'taiwan', 'argentina', 'chile', 'colombia', 'peru',
];

function startUrlHasExplicitGeoFilter(parsed: URL): boolean {
  if ((parsed.searchParams.get('locationId') || '').trim()) return true;
  if ((parsed.searchParams.get('locationCountry') || '').trim()) return true;
  for (const [rawKey, rawValue] of parsed.searchParams.entries()) {
    if (!String(rawValue || '').trim()) continue;
    const kl = rawKey.replace(/\[\]$/, '').toLowerCase();
    if (kl === 'location' || kl === 'locations' || kl === 'country' || kl === 'countries' || kl === 'regionalcountry' || kl === 'geolocationstring') return true;
  }
  return false;
}

function phenomLocationLooksLikeCountry(value: string): boolean {
  const n = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\./g, '');
  if (!n) return false;
  return (
    n === 'united states' ||
    n === 'united states of america' ||
    n === 'usa' ||
    n === 'us' ||
    n === 'u s' ||
    n === 'u s a' ||
    n === 'canada' ||
    n === 'united kingdom' ||
    n === 'uk' ||
    n === 'india' ||
    n === 'australia' ||
    n === 'germany' ||
    n === 'france' ||
    n === 'singapore' ||
    n === 'ireland' ||
    n === 'netherlands' ||
    n === 'japan' ||
    n === 'china' ||
    n === 'brazil' ||
    n === 'mexico'
  );
}

function phenomExpandCountryFacetValues(values: string[]): string[] {
  const out: string[] = [];
  for (const raw of values) {
    const v = String(raw || '').trim();
    if (!v) continue;
    const n = v.toLowerCase().replace(/\./g, '');
    if (
      n === 'united states' ||
      n === 'united states of america' ||
      n === 'usa' ||
      n === 'us' ||
      n === 'u s' ||
      n === 'u s a'
    ) {
      out.push('United States of America', 'United States');
    } else {
      out.push(v);
    }
  }
  return [...new Set(out)];
}

function atsRowMatchesUnitedStates(row: { location?: string }): boolean {
  const loc = String(row.location || '').trim();
  if (!loc) return true;
  if (happyDanceCountryMatches(loc, [ATS_DEFAULT_LOCATION_COUNTRY])) return true;
  const n = happyDanceNorm(loc);
  if (ATS_NON_US_LOCATION_MARKERS.some((marker) => n.includes(marker))) return false;
  if (/(^| )uk( |$)/.test(` ${n} `) || /(^| )gb( |$)/.test(` ${n} `)) return false;
  const tokens = n.split(' ').filter(Boolean);
  if (tokens.some((tok) => ATS_US_STATE_ABBREVS.has(tok))) return true;
  if (/\bremote\b/.test(n)) return true;
  return true;
}

function happyDanceNorm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function happyDanceTeamMatches(category: string, teams: string[], title = ''): boolean {
  if (!teams.length) return true;
  const cat = happyDanceNorm(category);
  const itAliases = new Set(['it', 'information technology']);
  if (cat) {
    return teams.some((team) => {
      const want = happyDanceNorm(team);
      if (!want) return false;
      if (cat === want) return true;
      if (itAliases.has(want) && itAliases.has(cat)) return true;
      return false;
    });
  }
  // Feeds without <category> (e.g. Wells Fargo RSS <item>): match team tokens against title.
  const hay = happyDanceNorm(title);
  if (!hay) return true;
  const padded = ` ${hay} `;
  return teams.some((team) => {
    const want = happyDanceNorm(team);
    if (!want) return false;
    if (want === 'it' || want === 'information technology') {
      return /(?:^| )(?:it|information technology)(?: |$)/.test(hay);
    }
    if (padded.includes(` ${want} `)) return true;
    const parts = want.split(' ').filter((p) => p.length > 3);
    return parts.length > 0 && parts.some((p) => padded.includes(` ${p} `));
  });
}

function happyDanceCountryMatches(jobCountry: string, countries: string[]): boolean {
  if (!countries.length) return true;
  const have = happyDanceNorm(jobCountry);
  // Standard RSS feeds (Wells Fargo) omit country — do not drop every row.
  if (!have) return true;
  return countries.some((country) => {
    const want = happyDanceNorm(country);
    if (!want) return false;
    const us = (value: string) =>
      value === 'united states' ||
      value === 'united states of america' ||
      value === 'us' ||
      value === 'usa' ||
      value === 'u s';
    if (us(want) && (us(have) || /\bunited states\b|\busa\b|\bu s\b/.test(have))) return true;
    return have === want || have.includes(want) || want.includes(have);
  });
}

function happyDanceLocationMatches(
  job: { city: string; state: string; country: string },
  locations: string[]
): boolean {
  if (!locations.length) return true;
  const city = happyDanceNorm(job.city);
  const state = happyDanceNorm(job.state);
  const country = happyDanceNorm(job.country);
  return locations.some((loc) => {
    const locNorm = happyDanceNorm(loc);
    if (!locNorm) return false;
    if (/remote/.test(locNorm)) {
      if (!city) {
        return !country || country.includes('united states') || country === 'us' || country === 'usa';
      }
      return locNorm.includes(city);
    }
    const parts = loc.split(',').map((part) => happyDanceNorm(part)).filter(Boolean);
    if (city && (parts[0] === city || locNorm.startsWith(`${city} `))) return true;
    if (state && parts.length <= 2 && parts[0] === state) return true;
    return false;
  });
}

function parseHappyDanceRssJobs(xml: string, companyHint: string): Array<{
  row: AtsBoardJobRow;
  city: string;
  state: string;
  country: string;
}> {
  const $ = cheerio.load(String(xml || ''), { xmlMode: true });
  const parsed: Array<{ row: AtsBoardJobRow; city: string; state: string; country: string }> = [];
  const pushNode = (node: any, preferLink: boolean) => {
    const text = (tag: string) => $(node).children(tag).first().text().trim();
    const rawUrl = preferLink
      ? text('link') || text('url') || text('guid')
      : text('url') || text('link') || text('guid');
    let jobUrl = rawUrl;
    try {
      jobUrl = new URL(rawUrl).toString();
    } catch {
      jobUrl = rawUrl;
    }
    const city = text('city');
    const state = text('state');
    const country = text('country');
    const row = rowFromParts({
      jobUrl,
      title: text('title'),
      company: text('company') || companyHint,
      location: [city, state, country].filter(Boolean).join(', '),
      date: text('date') || text('pubDate') || undefined,
      department: text('category') || undefined,
      jobDescription: stripHtmlTags(text('description')) || undefined,
      employmentType: text('jobtype') || text('remotetype') || undefined,
    });
    if (row.jobUrl && row.jobTitle) parsed.push({ row, city, state, country });
  };

  // Phenom HappyDance PHB custom RSS uses <job>; Wells Fargo-style feeds use <item>.
  $('job').each((_, node) => pushNode(node, false));
  if (!parsed.length) {
    $('item').each((_, node) => pushNode(node, true));
  }
  return parsed;
}

const HAPPYDANCE_RSS_MAX_BYTES = 40 * 1024 * 1024;

async function fetchHappyDanceBoardJobs(
  pageUrl: string,
  companyHint: string,
  listApiUrl: string,
  options?: AtsBoardFetchOptions
): Promise<AtsBoardFetchResult | null> {
  const rssUrl = listApiUrl || happyDanceRssUrl(pageUrl);
  if (!rssUrl) return null;
  const res = await httpClient.get(rssUrl, {
    headers: {
      Accept: 'application/xml, text/xml, */*',
      'User-Agent': PHENOM_BROWSER_UA,
    },
    timeout: 120_000,
    maxContentLength: HAPPYDANCE_RSS_MAX_BYTES,
    maxBodyLength: HAPPYDANCE_RSS_MAX_BYTES,
    responseType: 'text',
    transformResponse: [(data) => data],
  });
  if (res.status >= 400 || typeof res.data !== 'string' || !(res.data.includes('<job') || res.data.includes('<item'))) return null;
  const parsed = new URL(pageUrl);
  const teams = uniqueQueryValues(parsed, 'team');
  const locations = uniqueQueryValues(parsed, 'location');
  const countries = startUrlHasExplicitGeoFilter(parsed)
    ? [
        ...uniqueQueryValues(parsed, 'country'),
        ...uniqueQueryValues(parsed, 'countries'),
      ]
    : [ATS_DEFAULT_LOCATION_COUNTRY];
  const hint = companyHint || happyDanceCompanyHint(parsed.hostname);
  const allRows = parseHappyDanceRssJobs(res.data, hint);
  let matched = allRows.filter(
    ({ row, city, state, country }) =>
      happyDanceTeamMatches(row.department || '', teams, row.jobTitle || '') &&
      happyDanceLocationMatches({ city, state, country }, locations) &&
      happyDanceCountryMatches(country, countries)
  );
  if (!matched.length) return null;
  const maxJobs = boardMaxJobs();
  const maxPages = limitedPages(options);
  const cap = Math.min(maxJobs, Math.max(1, maxPages) * 50);
  const rows = matched.slice(0, cap).map(({ row }) => row);
  if (!rows.length) return null;
  return { provider: 'happydance', companyHint: hint, rows };
}

/** NAS Recruitment ACTIVATE career sites (`/search/searchjobs`, jTable SearchResults JSON). */
export function looksLikeNasActivateBoard(url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '') || '/';
    return /\/search\/searchjobs$/i.test(path) || /\/search\/jobdetails\//i.test(path);
  } catch {
    return false;
  }
}

function nasActivateCompanyHint(host: string): string {
  const stripped = host.toLowerCase().replace(/^www\./, '').replace(/^jobs\./, '');
  const token = stripped.split('.')[0] || host;
  if (token === 'cardinalhealth') return 'Cardinal Health';
  return titleCaseToken(token);
}

function nasActivateSlug(title: string): string {
  return (
    String(title || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'job'
  );
}

function nasActivateStripHtml(value: unknown): string {
  return String(value || '')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function mapNasActivateRecords(records: any[], origin: string, companyHint: string): AtsBoardJobRow[] {
  return (Array.isArray(records) ? records : [])
    .map((job) => {
      const track = job?.TrackingObject || {};
      const title = String(track.TitleJson || nasActivateStripHtml(job?.Title) || '').trim();
      const id = String(job?.ID || '').trim();
      const jobUrl = id
        ? `${origin.replace(/\/$/, '')}/search/jobdetails/${nasActivateSlug(title)}/${id}`
        : '';
      const countries = Array.isArray(track.CountryNamesJson)
        ? track.CountryNamesJson.map((v: unknown) => String(v || '').trim()).filter(Boolean)
        : [];
      const cities = Array.isArray(track.CityStatesDataJson)
        ? track.CityStatesDataJson.map((v: unknown) => String(v || '').trim()).filter(Boolean)
        : [];
      const locNames = Array.isArray(track.LocationNamesJson)
        ? track.LocationNamesJson.map((v: unknown) => String(v || '').trim()).filter(Boolean)
        : [];
      const location = [...new Set([...cities, ...locNames, ...countries])].join(', ');
      const cats = [
        ...(Array.isArray(track.ActivateCategoryNamesJson) ? track.ActivateCategoryNamesJson : []),
        ...(Array.isArray(track.AtsCategoryNamesJson) ? track.AtsCategoryNamesJson : []),
      ]
        .map((v: unknown) => String(v || '').trim())
        .filter(Boolean);
      return rowFromParts({
        jobUrl,
        title,
        company: companyHint,
        location,
        date: String(track.PostedDateJson || job?.PostedDateRaw || '').trim() || undefined,
        department: cats[0],
        employmentType: String(track.TypeNameJson || '').trim() || undefined,
      });
    })
    .filter((row) => row.jobUrl && row.jobTitle);
}

async function fetchNasActivateBoardJobs(
  pageUrl: string,
  companyHint: string,
  options?: AtsBoardFetchOptions
): Promise<AtsBoardFetchResult | null> {
  let source: URL;
  try {
    source = new URL(pageUrl);
  } catch {
    return null;
  }
  const origin = source.origin;
  const hint = companyHint || nasActivateCompanyHint(source.hostname);
  const pageSize = 50;
  const maxPages = limitedPages(options);
  const maxJobs = boardMaxJobs();
  const all: any[] = [];
  let total = Infinity;
  for (let page = 0; page < maxPages && all.length < maxJobs; page++) {
    const api = new URL(`${origin}/Search/SearchResults`);
    for (const [key, value] of source.searchParams.entries()) {
      if (key.toLowerCase().startsWith('jt')) continue;
      api.searchParams.append(key, value);
    }
    if (!startUrlHasExplicitGeoFilter(source) && !api.searchParams.get('regionalcountry')) {
      api.searchParams.set('regionalcountry', ATS_DEFAULT_LOCATION_COUNTRY);
    }
    api.searchParams.set('jtStartIndex', String(page * pageSize));
    api.searchParams.set('jtPageSize', String(pageSize));
    const res = await httpClient.get(api.toString(), {
      headers: {
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: pageUrl,
        'User-Agent': PHENOM_BROWSER_UA,
      },
    });
    if (res.status >= 400 || !res.data) break;
    let data = res.data;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        break;
      }
    }
    if (String(data?.Result || '').toUpperCase() !== 'OK') break;
    const batch = Array.isArray(data?.Records) ? data.Records : [];
    if (typeof data?.TotalRecordCount === 'number' && Number.isFinite(data.TotalRecordCount)) {
      total = data.TotalRecordCount;
    }
    all.push(...batch);
    if (!batch.length) break;
    if (all.length >= total) break;
    if (batch.length < pageSize) break;
    if (page + 1 < maxPages && all.length < maxJobs) await sleepMs(boardPageDelayMs());
  }
  const rows = mapNasActivateRecords(all, origin, hint).slice(0, maxJobs);
  if (!rows.length) return null;
  return { provider: 'nasactivate', companyHint: hint, rows };
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
  if (isTalentBrewWorkdayHost(url)) return false;
  if (looksLikeTalentBrewBoard(url)) return false;
  if (isJibeCareerHost(url)) return false;
  // Workday CXS hosts are never Phenom — even if a directory row was mis-tagged.
  if (/^[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com$/i.test(host)) return false;
  if (HAPPYDANCE_BOARD_HOSTS.has(host) || HAPPYDANCE_LOCALELESS_RSS_HOSTS.has(host)) return false;
  if (looksLikeNasActivateBoard(url)) return false;
  // Google Careers uses sort_by=relevance and careers.google.com — not Phenom PCS.
  if (host === 'google.com' || host.endsWith('.google.com') || host === 'goo.gle') {
    return false;
  }
  if (host.includes('phenompeople.com')) return true;
  if (host === 'eightfold.ai' || host.endsWith('.eightfold.ai')) return true;
  if (host.startsWith('hiring.')) return true;
  if (phenomQueryLooksLikePcsx(parsed)) return true;
  if (phenomQueryLooksLikeWidgets(parsed)) return true;
  if (/\/job\/[^/]+\/[^/]+\/\d+\/\d+\/?$/i.test(path)) return true;
  if (/\/careers\/job\/\d+/i.test(path)) return true;
  // Qualcomm / NVIDIA-style PCS shells: careers.<brand>.com/careers
  if (host.startsWith('careers.') && /^\/careers$/i.test(path)) return true;
  // Phenom list shells: …/search-results or Intuit-style …/search-jobs
  if (/\/(?:[a-z]{2}(?:-[a-z]{2})?\/)*search-results\/?$/i.test(path)) return true;
  if (PHENOM_SEARCH_JOBS_HOSTS.has(host) && /\/search-jobs\/?$/i.test(path)) return true;
  // Phenom category landings: /us/en/c/engineering-and-product-jobs (Adobe, etc.)
  if (/\/(?:[a-z]{2}(?:-[a-z]{2})?\/)+c\/[a-z0-9-]+$/i.test(path)) return true;
  // Directory allowlist — exact robot URL preserved; widgets/PCSX use that URL as referer
  if (DIRECTORY_PHENOM_BOARD_HOSTS.has(host)) return true;
  return false;
}

/**
 * Radancy / Talent Brew career shells use `/search-jobs` (often with SEO path
 * segments for keywords/location/orgId). Not Phenom Intuit `/search-jobs`, and
 * not Talent Brew marketing hosts that we remap to Workday CXS (Empower).
 */
export function looksLikeTalentBrewBoard(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const path = parsed.pathname.replace(/\/+$/, '') || '/';
  if (isTalentBrewWorkdayHost(url)) return false;
  if (PHENOM_SEARCH_JOBS_HOSTS.has(host)) return false;
  if (isJibeCareerHost(url)) return false;
  return /(?:^|\/)(?:[a-z]{2}(?:-[a-z]{2})?\/)?search-jobs(?:\/|$)/i.test(path);
}

const TALENT_BREW_LOCALE_RE = /^(?:en|fr|de|es|pt|zh|ja|ko|it|nl|sv|da|fi|pl|tr)(?:-[a-z]{2})?$/i;

export interface TalentBrewBoardFilters {
  locale: string;
  keywords: string;
  location: string;
  organizationIds: string;
  categoryFacetId: string;
  locationType: string;
  locationPath: string;
  latitude: string;
  longitude: string;
  distance: string;
  searchType: string;
}

function talentBrewDecodeCoord(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/x/gi, '.');
}

function talentBrewDecodePathSegment(raw: string): string {
  const text = String(raw || '').trim();
  if (!text || text === '-' || /^all(?:[-_]?jobs)?$/i.test(text)) return '';
  try {
    return decodeURIComponent(text.replace(/\+/g, ' ')).trim();
  } catch {
    return text.replace(/\+/g, ' ').trim();
  }
}

const TALENT_BREW_DEFAULT_ORG_IDS: Record<string, string> = {
  // Intuit Talent Brew (Radancy) — bare /search-jobs needs org facet to return rows.
  'jobs.intuit.com': '27595',
};

/** Parse Talent Brew SEO path + query filters (Moody's-style `/search-jobs/...`). */
export function parseTalentBrewBoardFilters(pageUrl: string): TalentBrewBoardFilters {
  const empty: TalentBrewBoardFilters = {
    locale: 'en',
    keywords: '',
    location: '',
    organizationIds: '',
    categoryFacetId: '',
    locationType: '',
    locationPath: '',
    latitude: '',
    longitude: '',
    distance: '50',
    searchType: '1',
  };
  let parsed: URL;
  try {
    parsed = new URL(pageUrl);
  } catch {
    return empty;
  }
  const parts = parsed.pathname.split('/').filter(Boolean);
  let idx = parts.findIndex((p) => /^search-jobs$/i.test(p));
  if (idx < 0) return empty;
  const locale =
    idx > 0 && TALENT_BREW_LOCALE_RE.test(parts[idx - 1]) ? parts[idx - 1] : 'en';
  const after = parts.slice(idx + 1);
  // Location-first SEO (no keywords): /search-jobs/{Location}/{OrgId}/{LocType}/{LocPath}/lat/lon/dist/type
  // Keyword SEO: /search-jobs/{Keywords}/{Location}/{OrgId}/{Cat}/{LocType}/{LocPath}/lat/lon/dist/type
  const locationFirst =
    after.length >= 7 &&
    after.length <= 8 &&
    /^\d+$/.test(talentBrewDecodePathSegment(after[1] || '')) &&
    /^\d+$/.test(talentBrewDecodePathSegment(after[2] || '')) &&
    !/^\d+$/.test(talentBrewDecodePathSegment(after[0] || '')) &&
    /united states|united kingdom|canada|remote|\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/i.test(
      talentBrewDecodePathSegment(after[0] || '')
    );
  const fromPath: TalentBrewBoardFilters = locationFirst
    ? {
        ...empty,
        locale,
        keywords: '',
        location: talentBrewDecodePathSegment(after[0] || ''),
        organizationIds: talentBrewDecodePathSegment(after[1] || ''),
        categoryFacetId: '',
        locationType: talentBrewDecodePathSegment(after[2] || ''),
        locationPath: talentBrewDecodePathSegment(after[3] || ''),
        latitude: talentBrewDecodeCoord(after[4] || ''),
        longitude: talentBrewDecodeCoord(after[5] || ''),
        distance: talentBrewDecodePathSegment(after[6] || '') || '50',
        searchType: talentBrewDecodePathSegment(after[7] || '') || '1',
      }
    : {
        ...empty,
        locale,
        keywords: talentBrewDecodePathSegment(after[0] || ''),
        location: talentBrewDecodePathSegment(after[1] || ''),
        organizationIds: talentBrewDecodePathSegment(after[2] || ''),
        categoryFacetId: talentBrewDecodePathSegment(after[3] || ''),
        locationType: talentBrewDecodePathSegment(after[4] || ''),
        locationPath: talentBrewDecodePathSegment(after[5] || ''),
        latitude: talentBrewDecodeCoord(after[6] || ''),
        longitude: talentBrewDecodeCoord(after[7] || ''),
        distance: talentBrewDecodePathSegment(after[8] || '') || '50',
        searchType: talentBrewDecodePathSegment(after[9] || '') || '1',
      };
  // Query params win when present (some TB sites use ?Keywords= only).
  const qKeywords = normalizeCareerSearchKeywords(
    parsed.searchParams.get('Keywords') ||
      parsed.searchParams.get('keywords') ||
      parsed.searchParams.get('q') ||
      ''
  );
  const qLocation = (
    parsed.searchParams.get('Location') ||
    parsed.searchParams.get('location') ||
    ''
  ).trim();
  const qOrg =
    parsed.searchParams.get('OrganizationIds') ||
    parsed.searchParams.get('orgIds') ||
    '';
  let host = '';
  try {
    host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    host = '';
  }
  return {
    ...fromPath,
    keywords: qKeywords || fromPath.keywords,
    location: qLocation || fromPath.location,
    organizationIds:
      String(qOrg || fromPath.organizationIds).trim() ||
      TALENT_BREW_DEFAULT_ORG_IDS[host] ||
      '',
    distance: parsed.searchParams.get('Distance') || fromPath.distance,
    searchType: parsed.searchParams.get('SearchType') || fromPath.searchType,
    latitude: parsed.searchParams.get('Latitude') || fromPath.latitude,
    longitude: parsed.searchParams.get('Longitude') || fromPath.longitude,
    locationPath:
      parsed.searchParams.get('LocationPath') ||
      parsed.searchParams.get('locationPath') ||
      fromPath.locationPath,
    locationType:
      parsed.searchParams.get('LocationType') ||
      parsed.searchParams.get('locationType') ||
      fromPath.locationType,
  };
}

function talentBrewResultsApiUrl(pageUrl: string): string {
  const filters = parseTalentBrewBoardFilters(pageUrl);
  try {
    const origin = new URL(pageUrl).origin;
    return `${origin}/${filters.locale}/search-jobs/results`;
  } catch {
    return '';
  }
}

function talentBrewCompanyHint(host: string): string {
  const stripped = host
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/^(careers|jobs|hiring)\./, '');
  const token = stripped.split('.')[0] || host;
  if (/^moodys$/i.test(token)) return "Moody's";
  return titleCaseToken(token);
}

export function parseTalentBrewResultsHtml(
  html: string,
  origin: string
): Array<{ title: string; jobUrl: string; location: string }> {
  const $ = cheerio.load(String(html || ''));
  const jobs: Array<{ title: string; jobUrl: string; location: string }> = [];
  const seen = new Set<string>();

  const pushJob = (hrefRaw: string, titleRaw: string, locationRaw: string) => {
    const href = String(hrefRaw || '').trim();
    if (!href || !/\/job\//i.test(href)) return;
    let jobUrl = '';
    try {
      jobUrl = new URL(href, origin).toString().split('?')[0];
    } catch {
      return;
    }
    if (!jobUrl || seen.has(jobUrl)) return;
    const title = String(titleRaw || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!title) return;
    seen.add(jobUrl);
    jobs.push({
      title,
      jobUrl,
      location: String(locationRaw || '')
        .replace(/\s+/g, ' ')
        .trim(),
    });
  };

  // Prefer list items under #search-results when present.
  const items = $('#search-results li, #search-results .job-listing, section#search-results li');
  if (items.length) {
    items.each((_, el) => {
      const $el = $(el);
      const $a = $el.find('a[href*="/job/"]').first();
      if (!$a.length) return;
      const title =
        $a.find('h2, h3').first().text() ||
        $a.attr('title') ||
        $a.text();
      const location =
        $el.find('.job-location, .location, span[class*="location"]').first().text() || '';
      pushJob(String($a.attr('href') || ''), title, location);
    });
  }

  if (!jobs.length) {
    $('a[href*="/job/"]').each((_, el) => {
      const $a = $(el);
      const title = $a.find('h2, h3').first().text() || $a.attr('title') || $a.text();
      const location = $a
        .closest('li, article, div')
        .find('.job-location, .location, span[class*="location"]')
        .first()
        .text();
      pushJob(String($a.attr('href') || ''), title, location);
    });
  }

  return jobs;
}

async function fetchTalentBrewBoardJobs(
  pageUrl: string,
  detected: AtsBoardDetection,
  options?: AtsBoardFetchOptions
): Promise<AtsBoardFetchResult | null> {
  const filters = parseTalentBrewBoardFilters(pageUrl);
  const listApiUrl = detected.listApiUrl || talentBrewResultsApiUrl(pageUrl);
  if (!listApiUrl) return null;
  let origin = '';
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return null;
  }

  const maxJobs =
    typeof options?.maxItems === 'number' && options.maxItems > 0
      ? Math.floor(options.maxItems)
      : boardMaxJobs();
  const pageSize = 50;
  const maxPages =
    typeof options?.maxPages === 'number' && options.maxPages > 0
      ? Math.floor(options.maxPages)
      : Math.ceil(maxJobs / pageSize);

  const all: AtsBoardJobRow[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= maxPages && all.length < maxJobs; page += 1) {
    const u = new URL(listApiUrl);
    u.searchParams.set('CurrentPage', String(page));
    u.searchParams.set('RecordsPerPage', String(pageSize));
    u.searchParams.set('Distance', filters.distance || '50');
    u.searchParams.set('RadiusUnitType', '0');
    u.searchParams.set('Keywords', filters.keywords || '');
    u.searchParams.set('Location', filters.location || '');
    u.searchParams.set('ShowRadius', 'False');
    u.searchParams.set('SortCriteria', '0');
    u.searchParams.set('SortDirection', '0');
    u.searchParams.set('SearchType', filters.searchType || '1');
    u.searchParams.set('ResultsType', '0');
    u.searchParams.set('SearchResultsModuleName', 'Search Results');
    u.searchParams.set('SearchFiltersModuleName', 'Search Filters');
    if (filters.organizationIds) {
      u.searchParams.set('OrganizationIds', filters.organizationIds);
    }
    if (filters.latitude) u.searchParams.set('Latitude', filters.latitude);
    if (filters.longitude) u.searchParams.set('Longitude', filters.longitude);
    if (filters.locationPath) {
      // FacetFilters[0] for applied location (United States GeoNames path, etc.).
      u.searchParams.set('FacetFilters[0].ID', filters.locationPath);
      u.searchParams.set(
        'FacetFilters[0].FacetType',
        filters.locationType || '2'
      );
      u.searchParams.set('FacetFilters[0].Count', '0');
      if (filters.location) {
        u.searchParams.set('FacetFilters[0].Display', filters.location);
      }
      u.searchParams.set('FacetFilters[0].IsApplied', 'true');
      u.searchParams.set('FacetFilters[0].FieldName', '');
    }

    const res = await httpClient.get(u.toString(), {
      headers: {
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        Referer: pageUrl,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    if (res.status >= 400 || !res.data) {
      if (page === 1) return null;
      break;
    }
    const data = res.data;
    const resultsHtml = typeof data?.results === 'string' ? data.results : '';
    const parsedJobs = parseTalentBrewResultsHtml(resultsHtml, origin);
    for (const job of parsedJobs) {
      if (seen.has(job.jobUrl)) continue;
      seen.add(job.jobUrl);
      all.push(
        rowFromParts({
          jobUrl: job.jobUrl,
          title: job.title,
          company: detected.companyHint,
          location: job.location,
        })
      );
      if (all.length >= maxJobs) break;
    }
    if (data?.hasJobs === false || parsedJobs.length === 0) break;
    if (parsedJobs.length < pageSize) break;
  }

  if (!all.length) return null;
  return {
    provider: 'talentbrew',
    companyHint: detected.companyHint,
    rows: all.slice(0, maxJobs),
  };
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
  size = PHENOM_WIDGETS_PAGE_SIZE,
  pageUrl = ''
): Record<string, unknown> {
  const selectedFields: Record<string, string[]> = {};
  let keywords = '';
  try {
    const src = new URL(pageUrl || 'https://example.invalid/');
    keywords = (
      src.searchParams.get('search') ||
      src.searchParams.get('keywords') ||
      src.searchParams.get('keyword') ||
      src.searchParams.get('q') ||
      src.searchParams.get('query') ||
      ''
    ).trim();
    const locations = [
      ...uniqueQueryValues(src, 'location'),
      ...uniqueQueryValues(src, 'locations'),
    ];
    const categories = [
      ...uniqueQueryValues(src, 'team'),
      ...uniqueQueryValues(src, 'department'),
      ...uniqueQueryValues(src, 'category'),
    ];
    const countries = uniqueQueryValues(src, 'country');
    // Cognizant (and others) put "United States" in `location=` — widgets expect the country facet.
    const countryLike = locations.filter((value) => phenomLocationLooksLikeCountry(value));
    const placeLocations = locations.filter((value) => !phenomLocationLooksLikeCountry(value));
    if (placeLocations.length) selectedFields.location = placeLocations;
    if (categories.length) selectedFields.category = categories;
    if (countries.length || countryLike.length) {
      selectedFields.country = phenomExpandCountryFacetValues([...countries, ...countryLike]);
    } else if (!startUrlHasExplicitGeoFilter(src)) {
      // Phenom facets often use the long form; "United States" alone zeros some tenants (Circle).
      selectedFields.country = ['United States of America', ATS_DEFAULT_LOCATION_COUNTRY];
    }
  } catch {
    /* keep empty widgets filters */
  }
  const body: Record<string, unknown> = {
    ddoKey: config.ddoKey || PHENOM_DEFAULT_DDO_KEY,
    pageName: config.pageName || PHENOM_DEFAULT_PAGE_NAME,
    jobs: true,
    counts: true,
    size,
    from,
    keywords,
    global: true,
    selected_fields: selectedFields,
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
      const seq = firstString(job?.jobSeqNo, job?.jobId, job?.reqId);
      const synthesized =
        seq && origin
          ? `${origin.replace(/\/+$/, '')}/global-en/job/${encodeURIComponent(seq)}`
          : '';
      const jobUrl = phenomAbsoluteUrl(
        origin,
        firstString(
          job?.applyUrl,
          job?.apply_url,
          job?.jobUrl,
          job?.jobURL,
          job?.hostedUrl,
          job?.externalPath,
          job?.url,
          synthesized
        )
      ).replace(/\/apply\/?$/i, '');
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

function phenomHtmlDiscoveryUrls(origin: string, pageUrl: string, host: string): string[] {
  if (isMicrosoftCareersHost(host)) {
    return [`${origin}/global/en/search-results`, `${origin}/us/en/search-results`, pageUrl, `${origin}/`];
  }
  if (DIRECTORY_PHENOM_BOARD_HOSTS.has(host)) {
    return [
      pageUrl,
      `${origin}/us/en/search-results`,
      `${origin}/search-jobs`,
      `${origin}/careers`,
      `${origin}/`,
    ];
  }
  return [pageUrl, `${origin}/search-jobs`, `${origin}/careers`, `${origin}/`];
}

export async function discoverPhenomSiteConfig(
  pageUrl: string
): Promise<{ config: PhenomSiteConfig; origin: string; referer: string; cookie?: string } | null> {
  let pageOrigin: string;
  try {
    pageOrigin = new URL(pageUrl).origin;
  } catch {
    return null;
  }
  const host = new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, '');
  const staticConfig = PHENOM_STATIC_SITE_CONFIG[host];
  if (staticConfig?.refNum || staticConfig?.domain) {
    const origin = (staticConfig.apiOrigin || pageOrigin).replace(/\/+$/, '');
    return { config: staticConfig, origin, referer: pageUrl };
  }
  const candidates = phenomHtmlDiscoveryUrls(pageOrigin, pageUrl, host);
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
      if (config) return { config, origin: pageOrigin, referer: url, cookie };
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
  maxJobs: number,
  pageUrl = ''
): Promise<AtsBoardFetchResult | null> {
  if (!config.refNum) return null;
  const allRows: AtsBoardJobRow[] = [];
  let from = 0;
  let totalHits = Infinity;
  let pages = 0;
  const size = PHENOM_WIDGETS_PAGE_SIZE;
  const widgetsPath = (config.widgetsPath || '/widgets').startsWith('/')
    ? config.widgetsPath || '/widgets'
    : `/${config.widgetsPath}`;
  let careerOrigin = origin;
  try {
    careerOrigin = (config.careerOrigin || new URL(pageUrl || referer).origin || origin).replace(
      /\/+$/,
      ''
    );
  } catch {
    careerOrigin = (config.careerOrigin || origin).replace(/\/+$/, '');
  }
  const apiOrigin = (config.apiOrigin || origin).replace(/\/+$/, '');

  while (from < totalHits && pages < maxPages && allRows.length < maxJobs) {
    const body = buildPhenomWidgetsRequest(config, from, size, pageUrl || referer);
    const res = await httpClient.post(`${apiOrigin}${widgetsPath}`, body, {
      headers: {
        ...phenomJsonRequestHeaders(apiOrigin, referer, cookie),
        'Content-Type': 'application/json',
      },
    });
    if (res.status >= 400 || !res.data) break;
    const { jobs, totalHits: reportedTotal } = phenomWidgetsJobs(res.data);
    totalHits = reportedTotal;
    const batch = mapPhenomWidgetsJobs(jobs, companyHint, careerOrigin);
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
  const rows = await collectPhenomPcsxPages(
    origin,
    domain,
    companyHint,
    referer,
    cookie,
    maxPages,
    maxJobs,
    searchUrl
  );
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
      maxJobs,
      pageUrl
    );
    if (widgets?.rows.length) return widgets;
  }

  if (config.kind === 'pcsx' && config.domain) {
    const pcsx = await fetchPhenomPcsxBoard(origin, config, hint, referer, cookie, maxPages, maxJobs, pageUrl);
    if (pcsx?.rows.length) return pcsx;
  }

  if (config.kind === 'pcsx' && config.refNum) {
    return fetchPhenomWidgetsBoard(origin, config, hint, referer, cookie, maxPages, maxJobs, pageUrl);
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
  /** Public ATS JSON responded OK but listed no jobs (empty board / maintenance). */
  confirmedEmpty?: boolean;
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

  const ghVanity = greenhouseVanityListDetection(parsed);
  if (ghVanity) return ghVanity;

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

  const srVanityCompany = SMARTRECRUITERS_VANITY_HOSTS[host.replace(/^www\./, '')];
  if (srVanityCompany) {
    return {
      provider: 'smartrecruiters',
      companyHint: srVanityCompany,
      listApiUrl: `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(srVanityCompany)}/postings`,
    };
  }

  const jibeBoard = jibeCareerBoardConfig(url);
  if (jibeBoard) {
    return {
      provider: 'jibe',
      companyHint: jibeBoard.companyHint,
      listApiUrl: `${jibeBoard.apiOrigin}/api/jobs`,
    };
  }

  const zwayamBoard = zwayamCareerBoardConfig(url);
  if (zwayamBoard) {
    return {
      provider: 'zwayam',
      companyHint: zwayamBoard.companyHint,
      listApiUrl: `${zwayamBoard.apiOrigin.replace(/\/+$/, '')}/jobs/search`,
    };
  }

  const apptrssBoard = apptrssCareerBoardConfig(url);
  if (apptrssBoard && looksLikeApptrssBoard(url)) {
    return {
      provider: 'apptrss',
      companyHint: apptrssBoard.companyHint,
      listApiUrl: url.split('#')[0],
    };
  }

  // Lululemon Avature SearchCareer HTML lists (server-rendered job cards).
  if (
    host.replace(/^www\./, '') === 'careers.lululemon.com' &&
    /\/careers\/SearchCareer/i.test(path)
  ) {
    return {
      provider: 'avaturehtml',
      companyHint: 'lululemon',
      listApiUrl: url.split('#')[0],
    };
  }

  if (looksLikeWayfairCareersBoard(url)) {
    return {
      provider: 'wayfair',
      companyHint: 'Wayfair',
      listApiUrl: 'https://www.wayfair.com/a/careers/careers/job_search_data',
    };
  }

  // Findly / CWS (m-cloud) — org id resolved from page HTML at fetch time
  if (looksLikeFindlyBoard(url)) {
    return {
      provider: 'findly',
      companyHint: findlyCompanyHintFromHost(host),
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

  const salesforceBoard = detectSalesforceWorkdayBoard(parsed);
  if (salesforceBoard) return salesforceBoard;

  if (looksLikeHappyDanceBoard(url)) {
    return {
      provider: 'happydance',
      companyHint: happyDanceCompanyHint(host),
      listApiUrl: happyDanceRssUrl(url),
    };
  }

  if (looksLikeNasActivateBoard(url)) {
    return {
      provider: 'nasactivate',
      companyHint: nasActivateCompanyHint(host),
      listApiUrl: `${parsed.origin}/Search/SearchResults`,
    };
  }

  if (looksLikeTalentBrewBoard(url)) {
    const filters = parseTalentBrewBoardFilters(url);
    return {
      provider: 'talentbrew',
      companyHint: talentBrewCompanyHint(host),
      listApiUrl: `${parsed.origin}/${filters.locale}/search-jobs/results`,
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

/** Common career-site typo: "untied states" → "united states". */
export function normalizeCareerSearchKeywords(raw: string): string {
  let s = String(raw || '').replace(/\+/g, ' ').trim();
  try {
    s = decodeURIComponent(s);
  } catch {
    // already decoded
  }
  return s.replace(/\buntied\b/gi, 'united').replace(/\s+/g, ' ').trim();
}

export interface SmartRecruitersBoardFilters {
  keywords: string;
  countryCode?: string;
  categories: string[];
  q?: string;
}

function unitedStatesCountryCode(keywords: string): string | undefined {
  const k = keywords
    .toLowerCase()
    .replace(/[.]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (
    k === 'united states' ||
    k === 'united states of america' ||
    k === 'usa' ||
    k === 'us' ||
    k === 'u s' ||
    k === 'u sa' ||
    k === 'america'
  ) {
    return 'us';
  }
  return undefined;
}

export function parseSmartRecruitersBoardFilters(pageUrl: string): SmartRecruitersBoardFilters {
  let parsed: URL;
  try {
    parsed = new URL(pageUrl);
  } catch {
    return { keywords: '', categories: [] };
  }
  const keywords = normalizeCareerSearchKeywords(
    parsed.searchParams.get('keywords') || parsed.searchParams.get('q') || ''
  );
  const countryCode = unitedStatesCountryCode(keywords);
  const rawCats = parsed.searchParams.get('categories') || parsed.searchParams.get('category') || '';
  const categories = rawCats
    .split('|')
    .map((part) => {
      try {
        return decodeURIComponent(part.replace(/\+/g, ' ')).trim();
      } catch {
        return part.replace(/\+/g, ' ').trim();
      }
    })
    .filter(Boolean);
  return {
    keywords,
    countryCode,
    categories,
    q: keywords && !countryCode ? keywords : undefined,
  };
}

function postingLocationBlob(job: any): string {
  const loc = job?.location || {};
  return [loc.city, loc.region, loc.country, loc.countryCode, loc.countryName]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function postingMatchesCountry(job: any, countryCode?: string): boolean {
  if (!countryCode) return true;
  const code = String(job?.location?.countryCode || '').toLowerCase();
  if (countryCode === 'us') {
    if (code === 'us' || code === 'usa') return true;
    return /\bunited states\b|\busa\b|\bu\.s\.a?\b/.test(postingLocationBlob(job));
  }
  return code === countryCode.toLowerCase();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function categoryTokenMatches(dept: string, cat: string): boolean {
  const c = cat.trim();
  if (!c) return false;
  const d = dept.toLowerCase();
  const cl = c.toLowerCase();
  if (cl === 'it') return /\b(it|information technology)\b/i.test(dept);
  if (d === cl) return true;
  if (cl.length > 3 && d.includes(cl)) return true;
  const words = cl.split(/[\s&/,]+/).filter((w) => w.length > 1);
  if (words.length >= 2) return words.every((w) => d.includes(w));
  return new RegExp(`\\b${escapeRegExp(cl)}\\b`, 'i').test(dept);
}

function postingMatchesCategories(job: any, categories: string[]): boolean {
  if (!categories.length) return true;
  const dept = String(
    job?.department?.label || job?.department || job?.function?.label || ''
  ).trim();
  if (!dept) return false;
  return categories.some((cat) => categoryTokenMatches(dept, cat));
}

export function filterSmartRecruitersPostings(postings: any[], pageUrl: string): any[] {
  const filters = parseSmartRecruitersBoardFilters(pageUrl);
  return (Array.isArray(postings) ? postings : []).filter(
    (job) =>
      postingMatchesCountry(job, filters.countryCode) &&
      postingMatchesCategories(job, filters.categories)
  );
}

/** Search box on the career URL (query/q/keywords/search). Country-like keywords are not title filters. */
export function parseAtsBoardSearchQuery(pageUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(pageUrl);
  } catch {
    return '';
  }
  const rawCandidates = [
    parsed.searchParams.get('query'),
    parsed.searchParams.get('q'),
    parsed.searchParams.get('search'),
    parsed.searchParams.get('keywords'),
    parsed.searchParams.get('keyword'),
  ];
  for (const raw of rawCandidates) {
    const normalized = normalizeCareerSearchKeywords(raw || '');
    if (!normalized) continue;
    if (/^jobsbylocation$/i.test(normalized)) continue;
    return normalized;
  }
  return '';
}

/**
 * Keep jobs matching the start-URL search, then cap to ~UI pages
 * (maxPages × pagesize, default 20 per page).
 */
export function applyAtsBoardSearchAndPageLimits(
  rows: AtsBoardJobRow[],
  pageUrl: string,
  options?: AtsBoardFetchOptions
): AtsBoardJobRow[] {
  const list = Array.isArray(rows) ? rows : [];
  const q = parseAtsBoardSearchQuery(pageUrl);
  const countryLike = q ? unitedStatesCountryCode(q) : undefined;
  let out = list;
  let applyKeywordToTitles = false;
  try {
    const parsed = new URL(pageUrl);
    const teams = [
      ...uniqueQueryValues(parsed, 'team'),
      ...uniqueQueryValues(parsed, 'department'),
      ...uniqueQueryValues(parsed, 'category'),
      ...uniqueQueryValues(parsed, 'category[]'),
    ];
    const locations = [
      ...uniqueQueryValues(parsed, 'location'),
      ...uniqueQueryValues(parsed, 'locations'),
    ];
    const countries = uniqueQueryValues(parsed, 'country');
    const defaultUnitedStates = !startUrlHasExplicitGeoFilter(parsed);
    // Workday / Wayfair / Talent Brew APIs already applied country/team facets from the start URL.
    const skipClientGeoFacet =
      looksLikeWorkdayBoard(pageUrl) ||
      looksLikeWayfairCareersBoard(pageUrl) ||
      looksLikeTalentBrewBoard(pageUrl);
    if (!skipClientGeoFacet && teams.length) {
      out = out.filter((row) => atsRowMatchesTeams(row, teams));
    }
    const cityLocations = parsed.searchParams.get('locationId')
      ? []
      : locations.filter((value) => {
          const n = happyDanceNorm(value);
          return n !== 'usa' && n !== 'us' && n !== 'united states' && n !== 'united states of america';
        });
    if (!skipClientGeoFacet && cityLocations.length) {
      out = out.filter((row) => atsRowMatchesLocations(row, cityLocations));
    }
    if (!skipClientGeoFacet && countries.length) {
      out = out.filter(
        (row) =>
          happyDanceCountryMatches(row.location || '', countries) ||
          countries.some((c) => (row.location || '').toLowerCase().includes(c.toLowerCase()))
      );
    } else if (!skipClientGeoFacet && defaultUnitedStates) {
      out = out.filter((row) => atsRowMatchesUnitedStates(row));
    }
    const queryOrQ = (parsed.searchParams.get('query') || parsed.searchParams.get('q') || '').trim();
    const searchRaw = (parsed.searchParams.get('search') || '').trim();
    const searchIsBoardMode = /^(jobsbylocation|getalljobs|jobs|search)$/i.test(
      searchRaw.replace(/\s+/g, '')
    );
    const titleQuery = queryOrQ || (searchIsBoardMode ? '' : searchRaw);
    applyKeywordToTitles = !!(
      normalizeCareerSearchKeywords(titleQuery) &&
      !cityLocations.length &&
      !countries.length
    );
  } catch {
    /* keep adapter rows */
  }
  if (q && !countryLike && applyKeywordToTitles) {
    const words = q
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 1 && !/^(the|and|for|jobs?|at)$/i.test(w));
    if (words.length) {
      out = out.filter((row) => {
        const hay = `${row.jobTitle || ''} ${row.department || ''} ${row.jobDescription || ''}`.toLowerCase();
        return words.every((w) => hay.includes(w));
      });
    }
  }
  const maxPages = options?.maxPages;
  if (typeof maxPages === 'number' && maxPages > 0) {
    let pageSize: number | undefined;
    try {
      const parsed = new URL(pageUrl);
      const raw = Number(parsed.searchParams.get('pagesize') || parsed.searchParams.get('pageSize') || '');
      if (Number.isFinite(raw) && raw > 0 && raw <= 100) pageSize = Math.floor(raw);
    } catch {
      /* keep adapter paging */
    }
    if (pageSize) out = out.slice(0, maxPages * pageSize);
  }
  const maxItems =
    typeof options?.maxItems === 'number' && options.maxItems > 0
      ? Math.floor(options.maxItems)
      : boardMaxJobs();
  return out.slice(0, maxItems);
}

function atsRowMatchesTeams(row: AtsBoardJobRow, teams: string[]): boolean {
  if (happyDanceTeamMatches(row.department || '', teams)) return true;
  if (happyDanceTeamMatches(row.jobTitle || '', teams)) return true;
  const hay = happyDanceNorm(`${row.department || ''} ${row.jobTitle || ''} ${row.jobDescription || ''}`);
  return teams.some((team) => {
    const want = happyDanceNorm(team);
    if (!want) return false;
    if (hay.includes(want)) return true;
    const words = want
      .split(' ')
      .filter((w) => w.length > 2)
      .map((w) => w.replace(/ing$/, '').replace(/ers$/, 'er'));
    if (!words.length) return false;
    return words.every((w) => hay.includes(w) || hay.includes(`${w}ing`) || hay.includes(`${w}er`));
  });
}

function atsRowMatchesLocations(row: AtsBoardJobRow, locations: string[]): boolean {
  const loc = row.location || '';
  const parts = loc.split(',').map((s) => s.trim()).filter(Boolean);
  const cityStateCountry =
    parts.length >= 3
      ? { city: parts[0], state: parts[1], country: parts.slice(2).join(', ') }
      : parts.length === 2
        ? { city: parts[0], state: '', country: parts[1] }
        : { city: '', state: '', country: parts[0] || '' };
  if (happyDanceLocationMatches(cityStateCountry, locations)) {
    return true;
  }
  const hay = `${loc} ${row.jobTitle || ''} ${row.jobDescription || ''}`.toLowerCase();
  return locations.some((raw) => {
    const want = raw.toLowerCase().trim();
    if (!want) return false;
    const city = want.split(',')[0].trim();
    if (!city) return false;
    if (city.length <= 2) {
      const escaped = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, 'i').test(loc);
    }
    return hay.includes(city);
  });
}

function finalizeAtsBoardRows(
  result: AtsBoardFetchResult | null,
  pageUrl: string,
  options?: AtsBoardFetchOptions
): AtsBoardFetchResult | null {
  if (!result) return null;
  if (!result.rows?.length) {
    return result.confirmedEmpty ? { ...result, rows: [] } : null;
  }
  const rows = applyAtsBoardSearchAndPageLimits(result.rows, pageUrl, options);
  if (!rows.length) {
    return result.confirmedEmpty ? { ...result, rows: [] } : null;
  }
  return { ...result, rows };
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

function smartRecruitersCompanyIds(companyHint: string): string[] {
  const hint = String(companyHint || '').trim();
  const ids: string[] = [];
  const push = (id: string) => {
    if (id && !ids.includes(id)) ids.push(id);
  };
  push(hint);
  if (/^github$/i.test(hint)) {
    push('GitHub');
    push('Github');
    push('github');
  }
  return ids;
}

export function looksLikeWayfairCareersBoard(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'wayfair.com') return false;
    return /\/careers(\/|$)/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function wayfairIntIdsFromQuery(parsed: URL, key: string): number[] {
  const values = parsed.searchParams.getAll(key);
  const ids: number[] = [];
  for (const raw of values) {
    const text = String(raw ?? '').trim();
    if (!text) continue;
    for (const part of text.split(',')) {
      const token = String(part || '').trim();
      if (!token) continue;
      const n = Number(token);
      if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) continue;
      if (!ids.includes(n)) ids.push(n);
    }
  }
  return ids;
}

export interface WayfairBoardFilters {
  keywords: string;
  teamIds: number[];
  countryIds: number[];
  locationIds: number[];
  stateIds: number[];
  teamCategoryIds: number[];
  categoryIds: number[];
  selectedJobTypeIds: number[];
}

export function parseWayfairBoardFilters(pageUrl: string): WayfairBoardFilters {
  let parsed: URL;
  try {
    parsed = new URL(pageUrl);
  } catch {
    return {
      keywords: '',
      teamIds: [],
      countryIds: [],
      locationIds: [],
      stateIds: [],
      teamCategoryIds: [],
      categoryIds: [],
      selectedJobTypeIds: [],
    };
  }
  return {
    keywords: normalizeCareerSearchKeywords(
      parsed.searchParams.get('keywords') || parsed.searchParams.get('q') || ''
    ),
    teamIds: wayfairIntIdsFromQuery(parsed, 'teamIds'),
    countryIds: wayfairIntIdsFromQuery(parsed, 'countryIds'),
    locationIds: wayfairIntIdsFromQuery(parsed, 'locationIds'),
    stateIds: wayfairIntIdsFromQuery(parsed, 'stateIds'),
    teamCategoryIds: wayfairIntIdsFromQuery(parsed, 'teamCategoryIds'),
    categoryIds: wayfairIntIdsFromQuery(parsed, 'categoryIds'),
    selectedJobTypeIds: [
      ...wayfairIntIdsFromQuery(parsed, 'selectedJobTypeIds'),
      ...wayfairIntIdsFromQuery(parsed, 'jobTypeIds'),
    ],
  };
}

function wayfairJobSlug(title: string): string {
  return String(title || '')
    .toLowerCase()
    .trim()
    .replace(/\s*-\s*/g, '---')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-{4,}/g, '---')
    .replace(/^-+|-+$/g, '');
}

function wayfairJobUrl(job: any): string {
  const eid = String(job?.eid || job?.requisitionId || '').trim();
  const slug = wayfairJobSlug(job?.title || '');
  if (eid && slug) {
    // Public list cards: /careers/job/{slug}/{system}-{eid} (system=2 on Avature-backed jobs).
    const prefix = String(job?.system ?? job?.jobTypeId ?? '2').trim() || '2';
    return `https://www.wayfair.com/careers/job/${slug}/${prefix}-${encodeURIComponent(eid)}`;
  }
  const apply = String(job?.applyLink || job?.structuredDataApplyLink || '').trim();
  if (/^https?:\/\//i.test(apply)) return apply;
  if (apply.startsWith('/')) return `https://www.wayfair.com${apply}`;
  return '';
}

function mapWayfairBoardJobs(jobs: any[], companyHint: string): AtsBoardJobRow[] {
  return (Array.isArray(jobs) ? jobs : [])
    .map((job: any) => {
      const loc = job?.location || {};
      const location =
        String(loc?.name || '').trim() ||
        [loc?.city, loc?.state, loc?.country].filter(Boolean).join(', ');
      return rowFromParts({
        jobUrl: wayfairJobUrl(job),
        title: job?.title || '',
        company: companyHint,
        location,
        employmentType: job?.jobTypeDisplayName || job?.jobType || '',
        date: job?.createdDate || job?.lastUpdatedDate || '',
        department: job?.category?.name || job?.teamName || '',
      });
    })
    .filter((row: AtsBoardJobRow) => row.jobUrl && row.jobTitle);
}

const WAYFAIR_JOB_SEARCH_API = 'https://www.wayfair.com/a/careers/careers/job_search_data';

/** POST body for Wayfair careers `job_search_data` (matches the SPA XHR). */
export function buildWayfairSearchRequestBody(pageUrl: string): Record<string, unknown> {
  const filters = parseWayfairBoardFilters(pageUrl);
  return {
    categoryIds: filters.categoryIds,
    teamIds: filters.teamIds,
    locationIds: filters.locationIds,
    countryIds: filters.countryIds,
    teamCategoryIds: filters.teamCategoryIds,
    stateIds: filters.stateIds,
    selectedJobTypeIds: filters.selectedJobTypeIds,
    keywords: filters.keywords,
  };
}

export function atsBoardRowsToListExtractionRecords(
  rows: AtsBoardJobRow[]
): Record<string, string>[] {
  return rows.map((row) => {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      if (value != null && String(value).trim()) out[key] = String(value);
    }
    return out;
  });
}

/**
 * Fetch Wayfair jobs via the SPA's own XHR from inside Chromium (cookies + origin).
 * Server-side POST often gets an HTML bot wall instead of JSON.
 */
export async function fetchWayfairBoardJobsInBrowser(
  page: Page,
  pageUrl: string,
  options?: { maxItems?: number }
): Promise<AtsBoardJobRow[]> {
  const body = buildWayfairSearchRequestBody(pageUrl);
  const maxJobs =
    typeof options?.maxItems === 'number' && options.maxItems > 0
      ? Math.floor(options.maxItems)
      : boardMaxJobs();
  let payload: unknown = null;
  try {
    payload = await page.evaluate(
      async ({ apiUrl, reqBody }) => {
        const res = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
          },
          credentials: 'include',
          body: JSON.stringify(reqBody),
        });
        if (!res.ok) return null;
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('json')) return null;
        return res.json();
      },
      { apiUrl: WAYFAIR_JOB_SEARCH_API, reqBody: body }
    );
  } catch {
    return [];
  }
  if (!payload || typeof payload !== 'object') return [];
  const jobs = Array.isArray((payload as { jobListData?: unknown[] }).jobListData)
    ? (payload as { jobListData: unknown[] }).jobListData
    : [];
  return mapWayfairBoardJobs(jobs, 'Wayfair').slice(0, maxJobs);
}

async function fetchWayfairBoardJobs(
  pageUrl: string,
  detected: AtsBoardDetection,
  options?: AtsBoardFetchOptions
): Promise<AtsBoardFetchResult | null> {
  const maxJobs =
    typeof options?.maxItems === 'number' && options.maxItems > 0
      ? Math.floor(options.maxItems)
      : boardMaxJobs();
  const body = buildWayfairSearchRequestBody(pageUrl);
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Origin: 'https://www.wayfair.com',
    Referer: pageUrl,
    'X-Requested-With': 'XMLHttpRequest',
  };
  let res: { status: number; data: any } | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    res = await httpClient.post(detected.listApiUrl, body, { headers });
    // PerimeterX / bot wall often returns 429 — brief backoff then retry.
    if (!res || (res.status !== 429 && res.status !== 403)) break;
    await sleepMs(400 * (attempt + 1));
  }
  if (!res || res.status >= 400 || !res.data) return null;
  if (typeof res.data === 'string' && res.data.trimStart().startsWith('<')) return null;
  const jobs = Array.isArray(res.data?.jobListData) ? res.data.jobListData : [];
  const rows = mapWayfairBoardJobs(jobs, detected.companyHint).slice(0, maxJobs);
  if (!rows.length) return null;
  return { provider: 'wayfair', companyHint: detected.companyHint, rows };
}

export interface JibeBoardFilters {
  keywords: string;
  categories: string[];
  location: string;
}

export function parseJibeBoardFilters(pageUrl: string): JibeBoardFilters {
  let parsed: URL;
  try {
    parsed = new URL(pageUrl);
  } catch {
    return { keywords: '', categories: [], location: '' };
  }
  const keywords = normalizeCareerSearchKeywords(
    parsed.searchParams.get('keywords') || parsed.searchParams.get('q') || ''
  );
  const location = (
    parsed.searchParams.get('location') ||
    parsed.searchParams.get('locations') ||
    ''
  ).trim();
  const rawCats = parsed.searchParams.get('categories') || parsed.searchParams.get('category') || '';
  const categories = rawCats
    .split('|')
    .map((part) => {
      try {
        return decodeURIComponent(part.replace(/\+/g, ' ')).trim();
      } catch {
        return part.replace(/\+/g, ' ').trim();
      }
    })
    .filter(Boolean);
  return { keywords, categories, location };
}

function jibeCategoryLabels(job: any): string[] {
  const raw = job?.category ?? job?.categories ?? [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((entry) => String(entry || '').trim()).filter(Boolean);
}

function jibeJobMatchesCategories(job: any, categories: string[]): boolean {
  if (!categories.length) return true;
  const labels = jibeCategoryLabels(job);
  if (!labels.length) return false;
  return categories.some((cat) =>
    labels.some((label) => categoryTokenMatches(label, cat))
  );
}

function mapJibeBoardJobs(
  jobs: any[],
  companyHint: string,
  careerOrigin: string,
  jobsPath: string
): AtsBoardJobRow[] {
  const prefix = `${careerOrigin.replace(/\/+$/, '')}${jobsPath.startsWith('/') ? jobsPath : `/${jobsPath}`}`;
  return (Array.isArray(jobs) ? jobs : [])
    .map((entry: any) => {
      const job = entry?.data && typeof entry.data === 'object' ? entry.data : entry;
      const slug = String(job?.slug || job?.req_id || '').trim();
      const jobUrl = slug ? `${prefix}/${encodeURIComponent(slug)}` : String(job?.apply_url || '').trim();
      const location =
        String(job?.full_location || job?.short_location || job?.location_name || '').trim() ||
        [job?.city, job?.country].filter(Boolean).join(', ');
      const department = jibeCategoryLabels(job).join(', ');
      return rowFromParts({
        jobUrl,
        title: job?.title || '',
        company: job?.hiring_organization || companyHint,
        location,
        employmentType: job?.employment_type || '',
        date: job?.posted_date || job?.create_date || '',
        department,
      });
    })
    .filter((row: AtsBoardJobRow) => row.jobUrl && row.jobTitle);
}

async function fetchJibeBoardJobs(
  pageUrl: string,
  detected: AtsBoardDetection,
  options?: AtsBoardFetchOptions
): Promise<AtsBoardFetchResult | null> {
  const board = jibeCareerBoardConfig(pageUrl);
  if (!board) return null;
  const filters = parseJibeBoardFilters(pageUrl);
  const maxPages =
    typeof options?.maxPages === 'number' && options.maxPages > 0
      ? Math.min(Math.floor(options.maxPages), 200)
      : Math.max(1, parseInt(process.env.ATS_BOARD_MAX_PAGES || '50', 10) || 50);
  const maxJobs =
    typeof options?.maxItems === 'number' && options.maxItems > 0
      ? Math.floor(options.maxItems)
      : boardMaxJobs();
  const limit = 20;
  let page = 1;
  const all: any[] = [];
  let httpOk = false;

  while (page <= maxPages && all.length < maxJobs) {
    const u = new URL(detected.listApiUrl);
    u.searchParams.set('limit', String(limit));
    u.searchParams.set('page', String(page));
    if (filters.keywords) u.searchParams.set('keywords', filters.keywords);
    if (filters.location) u.searchParams.set('location', filters.location);
    if (filters.categories.length) u.searchParams.set('categories', filters.categories.join('|'));
    // Preserve distance / sort knobs from the recorded careers URL when present.
    try {
      const src = new URL(pageUrl);
      for (const key of ['stretch', 'stretchUnit', 'sortBy']) {
        const value = src.searchParams.get(key);
        if (value) u.searchParams.set(key, value);
      }
    } catch {
      /* ignore malformed pageUrl */
    }
    const res = await httpClient.get(u.toString(), { headers: { Accept: 'application/json' } });
    if (res.status >= 400 || !res.data) {
      if (page === 1) return null;
      break;
    }
    httpOk = true;
    const batch = Array.isArray(res.data?.jobs) ? res.data.jobs : [];
    if (!batch.length) break;
    all.push(...batch);
    const total = typeof res.data?.totalCount === 'number' ? res.data.totalCount : all.length;
    if (all.length >= total || batch.length < limit) break;
    page += 1;
  }

  if (!httpOk) return null;
  let careerOrigin: string;
  try {
    careerOrigin = new URL(pageUrl).origin;
  } catch {
    careerOrigin = 'https://www.github.careers';
  }
  const filtered = all.filter((entry) => {
    const job = entry?.data && typeof entry.data === 'object' ? entry.data : entry;
    return jibeJobMatchesCategories(job, filters.categories);
  });
  const rows = mapJibeBoardJobs(filtered, detected.companyHint, careerOrigin, board.jobsPath).slice(
    0,
    maxJobs
  );
  if (!rows.length) return null;
  return { provider: 'jibe', companyHint: detected.companyHint, rows };
}

function buildMultipartFormBody(fields: Record<string, string>): {
  body: Buffer;
  contentType: string;
} {
  const boundary = `----maxun${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const chunks: string[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(`--${boundary}`);
    chunks.push(`Content-Disposition: form-data; name="${name}"`);
    chunks.push('');
    chunks.push(value);
  }
  chunks.push(`--${boundary}--`);
  chunks.push('');
  const body = Buffer.from(chunks.join('\r\n'), 'utf8');
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

export function parseZwayamBoardFilters(pageUrl: string): { keywords: string } {
  let parsed: URL;
  try {
    parsed = new URL(pageUrl);
  } catch {
    return { keywords: '' };
  }
  return {
    keywords: normalizeCareerSearchKeywords(
      parsed.searchParams.get('keywords') ||
        parsed.searchParams.get('q') ||
        parsed.searchParams.get('search') ||
        parsed.searchParams.get('anyOfTheseWords') ||
        ''
    ),
  };
}

function zwayamEpochToDate(raw: unknown): string {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return '';
  try {
    return new Date(n).toISOString();
  } catch {
    return '';
  }
}

function mapZwayamBoardJobs(
  hits: any[],
  companyHint: string,
  careerOrigin: string
): AtsBoardJobRow[] {
  const origin = careerOrigin.replace(/\/+$/, '');
  return (Array.isArray(hits) ? hits : [])
    .map((hit: any) => {
      const src = hit?._source && typeof hit._source === 'object' ? hit._source : hit;
      const id = String(src?.id || src?.jobId || '').trim();
      const slug = String(src?.jobUrl || '').trim().replace(/^\//, '');
      const jobUrl = slug
        ? `${origin}/jobview/${encodeURIComponent(slug)}${id ? `?id=${encodeURIComponent(id)}` : ''}`
        : id
          ? `${origin}/jobview/?id=${encodeURIComponent(id)}`
          : '';
      return rowFromParts({
        jobUrl,
        title: src?.jobTitle || src?.title || src?.designation || '',
        company: companyHint,
        location: String(src?.location || src?.SrLocation || src?.city || '').trim(),
        employmentType: String(src?.jobType || src?.jobTypeField || '').trim(),
        date:
          zwayamEpochToDate(src?.modifiedDate) ||
          zwayamEpochToDate(src?.createdDate) ||
          zwayamEpochToDate(src?.createDate),
        department: String(
          src?.deptNameToSet || src?.jobFunction || src?.department || ''
        ).trim(),
      });
    })
    .filter((row: AtsBoardJobRow) => row.jobUrl && row.jobTitle);
}

async function fetchZwayamBoardJobs(
  pageUrl: string,
  detected: AtsBoardDetection,
  options?: AtsBoardFetchOptions
): Promise<AtsBoardFetchResult | null> {
  const board = zwayamCareerBoardConfig(pageUrl);
  if (!board) return null;
  const filters = parseZwayamBoardFilters(pageUrl);
  const maxJobs =
    typeof options?.maxItems === 'number' && options.maxItems > 0
      ? Math.floor(options.maxItems)
      : boardMaxJobs();
  const maxPages =
    typeof options?.maxPages === 'number' && options.maxPages > 0
      ? Math.min(Math.floor(options.maxPages), 200)
      : Math.max(1, parseInt(process.env.ATS_BOARD_MAX_PAGES || '50', 10) || 50);

  let careerOrigin = `https://${board.domain}`;
  try {
    careerOrigin = new URL(pageUrl).origin;
  } catch {
    /* keep default */
  }

  const allHits: any[] = [];
  let offset = 0;
  let total = Infinity;
  let pageSize = 9;

  for (let page = 1; page <= maxPages && allHits.length < maxJobs && offset < total; page += 1) {
    const filterCri = {
      paginationStartNo: offset,
      selectedCall: 'sort',
      sortCriteria: { name: 'modifiedDate', isAscending: false },
      anyOfTheseWords: filters.keywords || '',
    };
    const { body, contentType } = buildMultipartFormBody({
      filterCri: JSON.stringify(filterCri),
      domain: board.domain,
      companyId: board.companyIdB64,
    });
    const res = await httpClient.post(detected.listApiUrl, body, {
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Content-Type': contentType,
        Origin: careerOrigin,
        Referer: pageUrl,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      maxContentLength: 8 * 1024 * 1024,
      maxBodyLength: 8 * 1024 * 1024,
    });
    if (res.status >= 400 || !res.data) {
      if (page === 1) return null;
      break;
    }
    const payload = res.data?.data && typeof res.data.data === 'object' ? res.data.data : res.data;
    const batch = Array.isArray(payload?.data) ? payload.data : [];
    if (typeof payload?.totalCount === 'number') total = payload.totalCount;
    const howMuch = Number(payload?.facetedSearchConfig?.paginationHowMuch);
    if (Number.isFinite(howMuch) && howMuch > 0) pageSize = howMuch;
    if (!batch.length) break;
    allHits.push(...batch);
    offset += pageSize;
    if (batch.length < pageSize) break;
  }

  const rows = mapZwayamBoardJobs(allHits, detected.companyHint, careerOrigin).slice(0, maxJobs);
  if (!rows.length) return null;
  return { provider: 'zwayam', companyHint: detected.companyHint, rows };
}

async function fetchApptrssBoardJobs(
  pageUrl: string,
  detected: AtsBoardDetection,
  options?: AtsBoardFetchOptions
): Promise<AtsBoardFetchResult | null> {
  const board = apptrssCareerBoardConfig(pageUrl);
  if (!board) return null;
  const maxJobs =
    typeof options?.maxItems === 'number' && options.maxItems > 0
      ? Math.floor(options.maxItems)
      : boardMaxJobs();
  let listUrl = pageUrl;
  try {
    const parsed = new URL(pageUrl);
    // Prefer the recorded /jobs/search/{id} list; detail pages aren't lists.
    if (!/\/jobs\/search\/\d+/i.test(parsed.pathname)) {
      return null;
    }
    listUrl = parsed.toString();
  } catch {
    return null;
  }
  const res = await httpClient.get(listUrl, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': PHENOM_BROWSER_UA,
    },
    maxContentLength: 4 * 1024 * 1024,
    maxBodyLength: 4 * 1024 * 1024,
    responseType: 'text',
    transformResponse: [(data) => data],
  });
  if (res.status >= 400 || typeof res.data !== 'string') return null;
  const $ = cheerio.load(res.data);
  const rows: AtsBoardJobRow[] = [];
  const seen = new Set<string>();
  $('a.job_link').each((_, el) => {
    if (rows.length >= maxJobs) return;
    const href = String($(el).attr('href') || '').trim();
    const title = $(el).text().replace(/\s+/g, ' ').trim();
    if (!href || !title) return;
    let jobUrl = href;
    try {
      jobUrl = new URL(href, listUrl).toString();
    } catch {
      return;
    }
    if (seen.has(jobUrl)) return;
    seen.add(jobUrl);
    rows.push(
      rowFromParts({
        jobUrl,
        title,
        company: detected.companyHint,
        location: '',
      })
    );
  });
  if (!rows.length) return null;
  return { provider: 'apptrss', companyHint: detected.companyHint, rows };
}

async function fetchAvatureHtmlBoardJobs(
  pageUrl: string,
  detected: AtsBoardDetection,
  options?: AtsBoardFetchOptions
): Promise<AtsBoardFetchResult | null> {
  const maxJobs =
    typeof options?.maxItems === 'number' && options.maxItems > 0
      ? Math.floor(options.maxItems)
      : boardMaxJobs();
  const res = await httpClient.get(pageUrl, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'User-Agent': PHENOM_BROWSER_UA,
    },
    maxContentLength: 4 * 1024 * 1024,
    maxBodyLength: 4 * 1024 * 1024,
    responseType: 'text',
    transformResponse: [(data) => data],
  });
  if (res.status >= 400 || typeof res.data !== 'string') return null;
  const $ = cheerio.load(res.data);
  const rows: AtsBoardJobRow[] = [];
  const seen = new Set<string>();
  $('a.apply[href*="ApplicationMethods"], a[href*="JobDetail"], a[href*="jobId="]').each((_, el) => {
    if (rows.length >= maxJobs) return;
    const href = String($(el).attr('href') || '').trim();
    if (!href) return;
    let jobUrl = href;
    try {
      jobUrl = new URL(href, pageUrl).toString();
    } catch {
      return;
    }
    // Prefer detail URL shape when apply link only has jobId.
    const jobIdMatch = jobUrl.match(/[?&]jobId=(\d+)/i);
    if (jobIdMatch && /ApplicationMethods/i.test(jobUrl)) {
      try {
        const u = new URL(pageUrl);
        jobUrl = `${u.origin}/en_US/careers/JobDetail?jobId=${jobIdMatch[1]}`;
      } catch {
        /* keep apply url */
      }
    }
    if (seen.has(jobUrl)) return;
    // Title: nearest article/heading text, else link text / aria-label.
    let title = $(el).attr('aria-label') || $(el).text().replace(/\s+/g, ' ').trim();
    if (!title || /^(apply|view|learn more)$/i.test(title)) {
      const card = $(el).closest('article, li, .job, .list-item, tr, .article');
      title =
        card.find('h1, h2, h3, h4, .jobTitle, .job-title, a.title').first().text().replace(/\s+/g, ' ').trim() ||
        title;
    }
    if (!title || /^(apply|view|learn more)$/i.test(title)) return;
    seen.add(jobUrl);
    rows.push(
      rowFromParts({
        jobUrl,
        title,
        company: detected.companyHint,
        location: '',
      })
    );
  });
  if (!rows.length) {
    // Fallback: JobPosting JSON-LD
    $('script[type="application/ld+json"]').each((_, el) => {
      if (rows.length >= maxJobs) return;
      try {
        const raw = $(el).html() || '';
        const data = JSON.parse(raw);
        const list = Array.isArray(data) ? data : data?.['@graph'] || [data];
        for (const item of list) {
          if (rows.length >= maxJobs) break;
          if (!item || item['@type'] !== 'JobPosting') continue;
          const jobUrl = String(item.url || item.mainEntityOfPage || '').trim();
          const title = String(item.title || '').trim();
          if (!jobUrl || !title || seen.has(jobUrl)) continue;
          seen.add(jobUrl);
          rows.push(
            rowFromParts({
              jobUrl,
              title,
              company: detected.companyHint,
              location: String(item.jobLocation?.address?.addressLocality || item.jobLocation || '').trim(),
            })
          );
        }
      } catch {
        /* ignore bad JSON-LD */
      }
    });
  }
  if (!rows.length) return null;
  return { provider: 'avaturehtml', companyHint: detected.companyHint, rows };
}

async function fetchSmartRecruitersAllPages(
  listApiUrl: string,
  extra?: { country?: string; q?: string }
): Promise<{ content: any[]; totalFound: number; httpOk: boolean }> {
  const limit = 100;
  let offset = 0;
  const all: any[] = [];
  let totalFound = Infinity;
  let httpOk = false;
  while (offset < totalFound && offset < 5000) {
    const u = new URL(listApiUrl);
    if (extra?.country) u.searchParams.set('country', extra.country);
    if (extra?.q) u.searchParams.set('q', extra.q);
    u.searchParams.set('limit', String(limit));
    u.searchParams.set('offset', String(offset));
    const res = await httpClient.get(u.toString(), { headers: { Accept: 'application/json' } });
    if (res.status >= 400 || !res.data) {
      if (offset === 0) return { content: [], totalFound: 0, httpOk: false };
      break;
    }
    httpOk = true;
    const batch = Array.isArray(res.data?.content) ? res.data.content : [];
    totalFound = typeof res.data?.totalFound === 'number' ? res.data.totalFound : batch.length;
    all.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  return { content: all, totalFound: all.length, httpOk };
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
      return finalizeAtsBoardRows(
        {
          provider: extra.provider,
          companyHint: extra.companyHint,
          rows: extra.rows as AtsBoardJobRow[],
        },
        pageUrl,
        options
      );
    }
    if (detected.provider === 'findly') {
      return finalizeAtsBoardRows(
        await fetchFindlyBoardJobs(pageUrl, detected.companyHint, options),
        pageUrl,
        options
      );
    }
    if (detected.provider === 'successfactors') {
      return finalizeAtsBoardRows(
        await fetchSuccessFactorsBoardJobs(pageUrl, detected.companyHint, options),
        pageUrl,
        options
      );
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
      return finalizeAtsBoardRows(
        await fetchOracleCloudBoardJobs(page, companyHint, listApiUrl, options),
        pageUrl,
        options
      );
    }
    if (detected.provider === 'bankofamerica') {
      return finalizeAtsBoardRows(
        await fetchBankOfAmericaBoardJobs(
          pageUrl,
          detected.companyHint,
          detected.listApiUrl,
          options
        ),
        pageUrl,
        options
      );
    }
    if (detected.provider === 'happydance') {
      return finalizeAtsBoardRows(
        await fetchHappyDanceBoardJobs(
          pageUrl,
          detected.companyHint,
          detected.listApiUrl,
          options
        ),
        pageUrl,
        options
      );
    }
    if (detected.provider === 'nasactivate') {
      return finalizeAtsBoardRows(
        await fetchNasActivateBoardJobs(pageUrl, detected.companyHint, options),
        pageUrl,
        options
      );
    }
    if (detected.provider === 'phenom') {
      return finalizeAtsBoardRows(
        await fetchPhenomBoardJobs(pageUrl, detected.companyHint, options),
        pageUrl,
        options
      );
    }
    if (detected.provider === 'jibe') {
      return finalizeAtsBoardRows(
        await fetchJibeBoardJobs(pageUrl, detected, options),
        pageUrl,
        options
      );
    }
    if (detected.provider === 'wayfair') {
      return finalizeAtsBoardRows(
        await fetchWayfairBoardJobs(pageUrl, detected, options),
        pageUrl,
        options
      );
    }
    if (detected.provider === 'talentbrew') {
      return finalizeAtsBoardRows(
        await fetchTalentBrewBoardJobs(pageUrl, detected, options),
        pageUrl,
        options
      );
    }
    if (detected.provider === 'zwayam') {
      return finalizeAtsBoardRows(
        await fetchZwayamBoardJobs(pageUrl, detected, options),
        pageUrl,
        options
      );
    }
    if (detected.provider === 'apptrss') {
      return finalizeAtsBoardRows(
        await fetchApptrssBoardJobs(pageUrl, detected, options),
        pageUrl,
        options
      );
    }
    if (detected.provider === 'avaturehtml') {
      return finalizeAtsBoardRows(
        await fetchAvatureHtmlBoardJobs(pageUrl, detected, options),
        pageUrl,
        options
      );
    }

    let data: any;
    let smartRecruitersHttpOk = false;
    if (detected.provider === 'smartrecruiters') {
      const filters = parseSmartRecruitersBoardFilters(pageUrl);
      let fetched: { content: any[]; totalFound: number; httpOk: boolean } = {
        content: [],
        totalFound: 0,
        httpOk: false,
      };
      for (const companyId of smartRecruitersCompanyIds(detected.companyHint)) {
        const listApiUrl = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(
          companyId
        )}/postings`;
        fetched = await fetchSmartRecruitersAllPages(listApiUrl, {
          country: filters.countryCode,
          q: filters.q,
        });
        if (fetched.httpOk) smartRecruitersHttpOk = true;
        if (fetched.content.length) break;
      }
      data = {
        ...fetched,
        content: filterSmartRecruitersPostings(
          Array.isArray(fetched.content) ? fetched.content : [],
          pageUrl
        ),
      };
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

    if (!rows.length) {
      if (detected.provider === 'smartrecruiters' && smartRecruitersHttpOk) {
        const connectedSite =
          isSmartRecruitersVanityHost(pageUrl) ||
          isSmartRecruitersConnectedCompany(detected.companyHint);
        if (!connectedSite) {
          return finalizeAtsBoardRows(
            {
              provider: detected.provider,
              companyHint: detected.companyHint,
              rows: [],
              confirmedEmpty: true,
            },
            pageUrl,
            options
          );
        }
      }
      return null;
    }
    return finalizeAtsBoardRows(
      {
        provider: detected.provider,
        companyHint: detected.companyHint,
        rows,
      },
      pageUrl,
      options
    );
  } catch (err) {
    // Oracle vanity resolve used to return null on any failure, which made
    // production look like "0 rows" with no usable diagnostic. Re-throw so the
    // scraper worker logs the real cause before browser fallback.
    if (detected.provider === 'oraclecloud' || detected.provider === 'workday') throw err;
    return null;
  }
}


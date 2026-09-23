/**
 * Resolve a stable company identity key from an employer job or apply URL.
 *
 * Tier 0 — excluded aggregator / generic job-board hosts → null
 * Tier 1 — shared ATS vendor host → `{provider}:{tenant}` (e.g. workday:hpe)
 * Tier 2 — employer-owned registrable domain → `apple.com`, `dell.com`
 */
import { getDomain } from 'tldts';
import { isAggregatorHostUrl } from './aggregatorIdentity';
import { detectAts, detectWorkday, type AtsProvider } from './atsAdapters';

export type CompanyIdentityTier = 'vendor_ats' | 'employer_domain';

export type CompanyKeyConfidence = 'high' | 'medium' | 'low';

export type CompanyKeyResolution = {
  companyKey: string;
  tier: CompanyIdentityTier;
  /** ATS vendor slug for Tier 1; empty for Tier 2 */
  atsProvider: string;
  /** Suggested display label — not authoritative until written to the registry */
  nameHint: string;
  confidence: CompanyKeyConfidence;
};

/** Registrable domains that are ATS vendors (Tier 1), not employers. */
export const VENDOR_ATS_REGISTRABLE_DOMAINS = new Set([
  'myworkdayjobs.com',
  'myworkdaysite.com',
  'icims.com',
  'greenhouse.io',
  'lever.co',
  'ashbyhq.com',
  'workable.com',
  'smartrecruiters.com',
  'taleo.net',
  'njoyn.com',
  'oraclecloud.com',
  'eightfold.ai',
  'applicantpro.com',
  'dayforcehcm.com',
  'jobvite.com',
  'breezy.hr',
  'bamboohr.com',
  'applytojob.com',
  'pinpointhq.com',
]);

/** Generic job boards — never mint a company from these hosts. */
export const EXCLUDED_JOB_BOARD_SUFFIXES = [
  'linkedin.com',
  'indeed.com',
  'glassdoor.com',
  'ziprecruiter.com',
  'monster.com',
  'simplyhired.com',
  'careerbuilder.com',
  'dice.com',
];

const SUBDOMAIN_NOISE = new Set([
  'www',
  'jobs',
  'job',
  'careers',
  'career',
  'hiring',
  'apply',
  'staff',
  'wd',
  'wday',
  'cxs',
  'boards',
  'recruiting',
]);

function normalizeHost(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^www\./, '');
}

function safeParseUrl(raw: unknown): URL | null {
  if (raw == null) return null;
  const input = String(raw).trim();
  if (!input) return null;
  try {
    return new URL(input);
  } catch {
    try {
      return new URL(`https://${input}`);
    } catch {
      return null;
    }
  }
}

function titleCaseToken(token: string): string {
  const cleaned = String(token || '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
  if (!cleaned) return '';
  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function normalizeTenantSlug(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function registrableDomain(host: string): string | null {
  const domain = getDomain(host, { allowPrivateDomains: true });
  return domain ? domain.toLowerCase() : null;
}

function hostEndsWithSuffix(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`);
}

export function isExcludedJobBoardHost(host: string): boolean {
  const h = normalizeHost(host);
  if (!h) return false;
  if (isAggregatorHostUrl(`https://${h}/`)) return true;
  return EXCLUDED_JOB_BOARD_SUFFIXES.some((suffix) => hostEndsWithSuffix(h, suffix));
}

export function isVendorAtsRegistrableDomain(domain: string): boolean {
  return VENDOR_ATS_REGISTRABLE_DOMAINS.has(domain.toLowerCase());
}

function nameHintFromDomain(domain: string): string {
  const label = domain.split('.')[0] || domain;
  return titleCaseToken(label);
}

function subdomainTenant(host: string, vendorDomain: string): string | null {
  if (!hostEndsWithSuffix(host, vendorDomain)) return null;
  const prefix = host.slice(0, host.length - vendorDomain.length).replace(/\.$/, '');
  if (!prefix) return null;
  const labels = prefix.split('.').filter(Boolean);
  while (labels.length && SUBDOMAIN_NOISE.has(labels[0])) {
    labels.shift();
  }
  const tenant = labels.join('-');
  return tenant ? normalizeTenantSlug(tenant) : null;
}

function extractGreenhouseTenant(parsed: URL, host: string): string | null {
  if (!host.includes('greenhouse.io')) return null;
  const parts = parsed.pathname.split('/').filter(Boolean);
  const jobsIdx = parts.indexOf('jobs');
  if (jobsIdx > 0) {
    const board = parts[jobsIdx - 1];
    if (board && !SUBDOMAIN_NOISE.has(board.toLowerCase())) {
      return normalizeTenantSlug(board);
    }
  }
  if (host.startsWith('boards.') || host.startsWith('job-boards.')) {
    const sub = host.split('.')[0];
    if (sub && !SUBDOMAIN_NOISE.has(sub)) return normalizeTenantSlug(sub);
  }
  return null;
}

function extractLeverTenant(parsed: URL, host: string): string | null {
  if (!host.endsWith('.lever.co') && host !== 'lever.co') return null;
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length >= 1 && !SUBDOMAIN_NOISE.has(parts[0].toLowerCase())) {
    return normalizeTenantSlug(parts[0]);
  }
  const sub = subdomainTenant(host, 'lever.co');
  return sub;
}

function extractAshbyTenant(parsed: URL): string | null {
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length >= 1 && !SUBDOMAIN_NOISE.has(parts[0].toLowerCase())) {
    return normalizeTenantSlug(parts[0]);
  }
  return null;
}

function extractSmartrecruitersTenant(parsed: URL): string | null {
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.length >= 1 && !SUBDOMAIN_NOISE.has(parts[0].toLowerCase())) {
    return normalizeTenantSlug(parts[0]);
  }
  return null;
}

function extractWorkableTenant(parsed: URL, host: string): string | null {
  if (host === 'apply.workable.com' || host.endsWith('.workable.com')) {
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length >= 1) return normalizeTenantSlug(parts[0]);
  }
  return subdomainTenant(host, 'workable.com');
}

function extractJobviteTenant(parsed: URL, host: string): string | null {
  if (host === 'jobs.jobvite.com') {
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length >= 1) return normalizeTenantSlug(parts[0]);
    return null;
  }
  return subdomainTenant(host, 'jobvite.com');
}

function extractOracleTenant(parsed: URL, host: string): string | null {
  const parts = parsed.pathname.split('/').filter(Boolean);
  const sitesIdx = parts.indexOf('sites');
  if (sitesIdx >= 0 && parts[sitesIdx + 1]) {
    return normalizeTenantSlug(parts[sitesIdx + 1]);
  }
  return subdomainTenant(host, 'oraclecloud.com');
}

function extractIcimsTenant(host: string): string | null {
  const tenant = subdomainTenant(host, 'icims.com');
  if (!tenant) return null;
  return normalizeTenantSlug(tenant.replace(/^careers-|^staff-/i, ''));
}

function extractWorkdayTenant(host: string): string | null {
  const m = host.match(/^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/i);
  if (m) return normalizeTenantSlug(m[1]);
  return subdomainTenant(host, 'myworkdaysite.com') || subdomainTenant(host, 'myworkdayjobs.com');
}

function extractTaleoTenant(host: string): string | null {
  return subdomainTenant(host, 'taleo.net');
}

function extractNjoynTenant(host: string): string | null {
  return subdomainTenant(host, 'njoyn.com');
}

function providerForVendorDomain(domain: string): string {
  const map: Record<string, string> = {
    'myworkdayjobs.com': 'workday',
    'myworkdaysite.com': 'workday',
    'icims.com': 'icims',
    'greenhouse.io': 'greenhouse',
    'lever.co': 'lever',
    'ashbyhq.com': 'ashby',
    'workable.com': 'workable',
    'smartrecruiters.com': 'smartrecruiters',
    'taleo.net': 'taleo',
    'njoyn.com': 'njoyn',
    'oraclecloud.com': 'oracle',
    'eightfold.ai': 'eightfold',
    'applicantpro.com': 'applicantpro',
    'dayforcehcm.com': 'dayforce',
    'jobvite.com': 'jobvite',
    'breezy.hr': 'breezy',
    'bamboohr.com': 'bamboohr',
    'applytojob.com': 'applytojob',
    'pinpointhq.com': 'pinpointhq',
  };
  return map[domain] || domain.split('.')[0];
}

type VendorTenantResult = {
  provider: string;
  tenant: string;
  nameHint: string;
  confidence: CompanyKeyConfidence;
};

function extractVendorTenant(parsed: URL, vendorDomain: string): VendorTenantResult | null {
  const host = normalizeHost(parsed.hostname);
  const provider = providerForVendorDomain(vendorDomain);
  let tenant = '';
  let confidence: CompanyKeyConfidence = 'high';
  let nameHint = '';

  switch (provider) {
    case 'workday': {
      tenant = extractWorkdayTenant(host) || '';
      if (!tenant) {
        const wd = detectWorkday(parsed);
        if (wd) {
          tenant = normalizeTenantSlug(wd.companyHint);
          confidence = 'medium';
        }
      }
      break;
    }
    case 'icims':
      tenant = extractIcimsTenant(host) || '';
      break;
    case 'greenhouse':
      tenant = extractGreenhouseTenant(parsed, host) || '';
      break;
    case 'lever':
      tenant = extractLeverTenant(parsed, host) || '';
      break;
    case 'ashby':
      tenant = extractAshbyTenant(parsed) || '';
      break;
    case 'workable':
      tenant = extractWorkableTenant(parsed, host) || '';
      break;
    case 'smartrecruiters':
      tenant = extractSmartrecruitersTenant(parsed) || '';
      break;
    case 'taleo':
      tenant = extractTaleoTenant(host) || '';
      break;
    case 'njoyn':
      tenant = extractNjoynTenant(host) || '';
      break;
    case 'oracle':
      tenant = extractOracleTenant(parsed, host) || '';
      break;
    case 'jobvite':
      tenant = extractJobviteTenant(parsed, host) || '';
      break;
    case 'bamboohr':
    case 'breezy':
    case 'applytojob':
    case 'pinpointhq':
    case 'applicantpro':
    case 'dayforce':
    case 'eightfold':
      tenant = subdomainTenant(host, vendorDomain) || '';
      break;
    default:
      tenant = subdomainTenant(host, vendorDomain) || '';
  }

  const detected = detectAts(parsed.href);
  if (detected && isMultiTenantAtsProvider(detected.provider)) {
    if (!tenant && detected.companyHint) {
      tenant = normalizeTenantSlug(detected.companyHint);
      confidence = 'medium';
    }
    if (!nameHint && detected.companyHint) {
      nameHint = detected.companyHint;
    }
  }

  if (!tenant) return null;

  if (!nameHint) {
    nameHint = titleCaseToken(tenant);
  }

  return { provider, tenant, nameHint, confidence };
}

function isMultiTenantAtsProvider(provider: AtsProvider): boolean {
  return provider !== 'careerhtml' && provider !== 'phenom' && provider !== 'microsoftcareers';
}

function buildVendorKey(provider: string, tenant: string): string {
  return `${normalizeTenantSlug(provider)}:${normalizeTenantSlug(tenant)}`;
}

/**
 * Resolve company identity from a job or apply URL.
 * Returns null for aggregators, generic boards, and unparseable URLs.
 */
export function resolveCompanyKey(rawUrl: unknown): CompanyKeyResolution | null {
  const parsed = safeParseUrl(rawUrl);
  if (!parsed) return null;

  const host = normalizeHost(parsed.hostname);
  if (!host) return null;

  if (isExcludedJobBoardHost(host)) return null;

  const domain = registrableDomain(host);
  if (!domain) return null;

  if (isVendorAtsRegistrableDomain(domain)) {
    const vendor = extractVendorTenant(parsed, domain);
    if (!vendor) return null;
    return {
      companyKey: buildVendorKey(vendor.provider, vendor.tenant),
      tier: 'vendor_ats',
      atsProvider: vendor.provider,
      nameHint: vendor.nameHint,
      confidence: vendor.confidence,
    };
  }

  return {
    companyKey: domain,
    tier: 'employer_domain',
    atsProvider: '',
    nameHint: nameHintFromDomain(domain),
    confidence: 'high',
  };
}

/** Pick employer URL from board fields (job URL preferred, apply URL fallback). */
export function pickEmployerUrlForCompanyResolution(opts: {
  jobUrl?: unknown;
  applyUrl?: unknown;
}): string | null {
  for (const candidate of [opts.jobUrl, opts.applyUrl]) {
    const raw = String(candidate || '').trim();
    if (!raw) continue;
    const parsed = safeParseUrl(raw);
    if (!parsed) continue;
    if (isExcludedJobBoardHost(normalizeHost(parsed.hostname))) continue;
    return parsed.href;
  }
  return null;
}

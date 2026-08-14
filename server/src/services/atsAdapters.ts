import axios, { AxiosInstance } from 'axios';
import http from 'http';
import https from 'https';
import * as cheerio from 'cheerio';
import { ParsedJobFields } from './jobPageParser';
import { stripHtmlTags, isPortalCompanyName, parseJobPageHtml, normalizeLocation } from './jobPageParser';

export type AtsProvider =
  | 'greenhouse'
  | 'lever'
  | 'ashby'
  | 'workable'
  | 'smartrecruiters'
  | 'recruitee'
  | 'oraclecloud'
  | 'googlecareers'
  | 'ibmcareers';

export interface AtsFetchResult {
  provider: AtsProvider;
  fields: ParsedJobFields;
  /** ATS requisition / posting id when available (e.g. Oracle Id). */
  externalJobId?: string;
}

const keepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 16 });
const keepAliveHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 16 });

const httpClient: AxiosInstance = axios.create({
  timeout: 20_000,
  maxContentLength: parseInt(process.env.MAX_PARSE_BYTES || String(1.5 * 1024 * 1024), 10),
  maxBodyLength: parseInt(process.env.MAX_PARSE_BYTES || String(1.5 * 1024 * 1024), 10),
  httpsAgent: keepAliveAgent,
  httpAgent: keepAliveHttpAgent,
  validateStatus: (s) => s >= 200 && s < 500,
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
};

function companyOrEmpty(name: string): string {
  const n = String(name || '').trim();
  return isPortalCompanyName(n) ? '' : n;
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

  // Oracle Cloud HCM Candidate Experience
  // https://{tenant}.fa.oraclecloud.com/hcmUI/CandidateExperience/{lang}/sites/{site}/job/{id}
  if (/\.fa(?:\.ocs)?\.oraclecloud\.com$/i.test(host)) {
    const tenant = host.split('.')[0];
    const parts = path.split('/').filter(Boolean);
    const sitesIdx = parts.indexOf('sites');
    const jobIdx = parts.indexOf('job');
    const siteNumber = sitesIdx >= 0 ? parts[sitesIdx + 1] : '';
    const jobId = jobIdx >= 0 ? (parts[jobIdx + 1] || '').split('?')[0] : '';
    if (tenant && siteNumber && jobId) {
      const finder = encodeURIComponent(`ById;Id="${jobId}",siteNumber=${siteNumber}`);
      return {
        provider: 'oraclecloud',
        apiUrl: `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=${finder}`,
        companyHint: oracleTenantCompany(tenant),
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
  if (String(item.WorkplaceType || item.WorkplaceTypeCode || '').toLowerCase().includes('remote')) {
    f.remoteType = 'Remote';
  }

  const flex = Array.isArray(item.requisitionFlexFields) ? item.requisitionFlexFields : [];
  for (const field of flex) {
    const prompt = String(field?.Prompt || '').toLowerCase();
    const value = String(field?.Value || '').trim();
    if (!value) continue;
    if (/pay|salary|compensation|base\s*pay/i.test(prompt)) {
      f.salaryRange = value.replace(/^[^$€£₹]*/, (prefix) => {
        // Keep location prefix if present: "New York,NY $122,550..."
        return prefix;
      });
      // Prefer just the money part when possible
      const money = value.match(/[$€£₹]\s*[\d,]+(?:\.\d+)?\s*[-–—]\s*[$€£₹]?\s*[\d,]+(?:\.\d+)?/);
      if (money) f.salaryRange = money[0].replace(/\s+/g, '');
      else f.salaryRange = value;
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
  | 'bankofamerica';

export interface AtsBoardDetection {
  provider: AtsBoardProvider;
  companyHint: string;
  /** Public JSON list endpoint (Findly: m-cloud base; org resolved at fetch). */
  listApiUrl: string;
}

const FINDLY_DEFAULT_API_BASE = 'https://jobsapi-internal.m-cloud.io/api/';

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

  // Oracle Cloud HCM Candidate Experience board.
  if (/\.fa(?:\.ocs)?\.oraclecloud\.com$/i.test(host)) {
    const sitesIdx = parts.indexOf('sites');
    const siteNumber = sitesIdx >= 0 ? parts[sitesIdx + 1] : '';
    const tenant = host.split('.')[0];
    if (tenant && siteNumber && /\/CandidateExperience\/.*\/sites\/[^/]+\/jobs?\/?$/i.test(path)) {
      return {
        provider: 'oraclecloud',
        companyHint: oracleTenantCompany(tenant),
        listApiUrl: `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions`,
      };
    }
  }

  // Bank of America renders its job list client-side, but exposes the same public
  // search endpoint used by its own career page.
  if (
    host === 'careers.bankofamerica.com' &&
    /^\/(?:[a-z]{2}-[a-z]{2}\/)?job-search(?:\.html)?\/?$/i.test(path)
  ) {
    return {
      provider: 'bankofamerica',
      companyHint: 'Bank of America',
      listApiUrl: `https://${host}/services/jobssearchservlet`,
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
}): AtsBoardJobRow {
  const jobUrl = String(opts.jobUrl || '').trim();
  const title = String(opts.title || '').trim();
  const company = companyOrEmpty(opts.company);
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
        jobUrl: job?.Id
          ? `https://${host}/hcmUI/CandidateExperience/${encodeURIComponent(lang)}/sites/${encodeURIComponent(siteNumber)}/job/${encodeURIComponent(String(job.Id))}`
          : '',
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
  const source = new URL(pageUrl);
  const parts = source.pathname.split('/').filter(Boolean);
  const sitesIdx = parts.indexOf('sites');
  const siteNumber = sitesIdx >= 0 ? parts[sitesIdx + 1] : '';
  if (!siteNumber) return null;
  const locale = oracleCandidateLocale(source.pathname);

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
      const value = oracleFinderValue(source.searchParams.get(key) || '');
      if (value) finderParts.push(`${key}=${value}`);
    }
    if (!source.searchParams.get('locationId')) {
      const location = oracleFinderValue(source.searchParams.get('location') || '');
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
    if (detected.provider === 'findly') {
      return await fetchFindlyBoardJobs(pageUrl, detected.companyHint, options);
    }
    if (detected.provider === 'successfactors') {
      return await fetchSuccessFactorsBoardJobs(pageUrl, detected.companyHint, options);
    }
    if (detected.provider === 'oraclecloud') {
      return await fetchOracleCloudBoardJobs(
        pageUrl,
        detected.companyHint,
        detected.listApiUrl,
        options
      );
    }
    if (detected.provider === 'bankofamerica') {
      return await fetchBankOfAmericaBoardJobs(
        pageUrl,
        detected.companyHint,
        detected.listApiUrl,
        options
      );
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
  } catch {
    return null;
  }
}


import * as cheerio from 'cheerio';
import { isHiringCafeUrl } from './aggregatorIdentity';
import {
  mergeParsedFields,
  parseJobPageHtml,
  parseJsonLdJobPosting,
  sanitizeCompanyName,
  isGenericJobTitle,
  type ParsedJobFields,
} from './jobPageParser';
import {
  normalizeHiringCafeJobRecord,
  preferExternalApplyUrl,
  type HiringCafeStructuredFields,
} from './hiringCafeNormalize';

export { preferExternalApplyUrl } from './hiringCafeNormalize';

const POSTING_PATH = /\/job\/[^/?#]+/i;

export function isHiringCafeJobPostingUrl(url: string): boolean {
  if (!isHiringCafeUrl(url)) return false;
  try {
    return POSTING_PATH.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

const JOB_WORDS = new Set([
  'senior',
  'junior',
  'lead',
  'staff',
  'principal',
  'manager',
  'director',
  'engineer',
  'engineering',
  'developer',
  'specialist',
  'analyst',
  'associate',
  'coordinator',
  'consultant',
  'architect',
  'technician',
  'administrator',
  'representative',
  'supervisor',
]);

const US_STATE_TOKENS: Record<string, string> = {
  alabama: 'Alabama',
  alaska: 'Alaska',
  arizona: 'Arizona',
  arkansas: 'Arkansas',
  california: 'California',
  colorado: 'Colorado',
  connecticut: 'Connecticut',
  delaware: 'Delaware',
  florida: 'Florida',
  georgia: 'Georgia',
  hawaii: 'Hawaii',
  idaho: 'Idaho',
  illinois: 'Illinois',
  indiana: 'Indiana',
  iowa: 'Iowa',
  kansas: 'Kansas',
  kentucky: 'Kentucky',
  louisiana: 'Louisiana',
  maine: 'Maine',
  maryland: 'Maryland',
  massachusetts: 'Massachusetts',
  michigan: 'Michigan',
  minnesota: 'Minnesota',
  mississippi: 'Mississippi',
  missouri: 'Missouri',
  montana: 'Montana',
  nebraska: 'Nebraska',
  nevada: 'Nevada',
  'new-hampshire': 'New Hampshire',
  'new-jersey': 'New Jersey',
  'new-mexico': 'New Mexico',
  'new-york': 'New York',
  'north-carolina': 'North Carolina',
  'north-dakota': 'North Dakota',
  ohio: 'Ohio',
  oklahoma: 'Oklahoma',
  oregon: 'Oregon',
  pennsylvania: 'Pennsylvania',
  'rhode-island': 'Rhode Island',
  'south-carolina': 'South Carolina',
  'south-dakota': 'South Dakota',
  tennessee: 'Tennessee',
  texas: 'Texas',
  utah: 'Utah',
  vermont: 'Vermont',
  virginia: 'Virginia',
  washington: 'Washington',
  'west-virginia': 'West Virginia',
  wisconsin: 'Wisconsin',
  wyoming: 'Wyoming',
  north: 'North',
  south: 'South',
  carolina: 'Carolina',
  dakota: 'Dakota',
  york: 'York',
  jersey: 'Jersey',
  mexico: 'Mexico',
  hampshire: 'Hampshire',
  island: 'Island',
};

function extractNextDataJson(html: string): unknown | null {
  const match = html.match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function readPath(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pickJobRecordFromNextData(data: unknown): Record<string, unknown> | null {
  const paths = [
    ['props', 'pageProps', 'job'],
    ['props', 'pageProps', 'jobPosting'],
    ['props', 'pageProps', 'data', 'job'],
    ['props', 'pageProps', 'initialJob'],
    ['props', 'pageProps', 'jobData'],
  ];
  for (const path of paths) {
    const rec = asRecord(readPath(data, path));
    if (!rec) continue;
    // Real Hiring Cafe payloads often have apply_url + nested job_information,
    // without a top-level title/description.
    if (
      rec.apply_url ||
      rec.applyUrl ||
      rec.job_information ||
      rec.v5_processed_job_data ||
      rec.title ||
      rec.jobTitle ||
      rec.name ||
      rec.description ||
      rec.jobDescription
    ) {
      return rec;
    }
  }
  return null;
}

function parseHiringCafeHtmlHeuristics(html: string, _postingUrl: string): Partial<ParsedJobFields> {
  const $ = cheerio.load(html);
  const h1 = $('h1').first().text().trim();
  const ogTitle = $('meta[property="og:title"]').attr('content')?.trim() || '';
  const ogDesc = $('meta[property="og:description"]').attr('content')?.trim() || '';

  let company = '';
  $('[class*="company" i], [data-testid*="company" i]').each((_, el) => {
    const text = $(el).text().trim();
    if (text && !/^(hiring\s*cafe|hiringcafe)$/i.test(text)) {
      company = text;
      return false;
    }
    return undefined;
  });

  let location = '';
  $('[class*="location" i], [data-testid*="location" i]').each((_, el) => {
    const text = $(el).text().trim();
    if (text && text.length < 120) {
      location = text;
      return false;
    }
    return undefined;
  });

  const descBlocks: string[] = [];
  $(
    '[class*="description" i], [data-testid*="description" i], article, main section p'
  ).each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text.length >= 120) descBlocks.push(text);
  });
  descBlocks.sort((a, b) => b.length - a.length);

  return {
    jobTitle: h1 || ogTitle,
    companyName: sanitizeCompanyName(company),
    jobDescription: descBlocks[0] || ogDesc,
    location,
  };
}

/** Best-effort city / state from a Hiring Cafe slug (tokens before the id suffix). */
export function locationFromHiringCafeSlug(url: string): string {
  try {
    const slug = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
    const parts = slug.split('-').filter(Boolean);
    if (parts.length < 2) return '';
    if (/^[a-z0-9]{8,}$/i.test(parts[parts.length - 1] || '')) parts.pop();

    const fmt = (token: string) =>
      token ? token.charAt(0).toUpperCase() + token.slice(1) : '';

    if (parts.length >= 2) {
      const stateKey = parts[parts.length - 1]?.toLowerCase() || '';
      const cityKey = parts[parts.length - 2]?.toLowerCase() || '';
      const state = US_STATE_TOKENS[stateKey];
      if (state && cityKey && !JOB_WORDS.has(cityKey) && !/^\d+$/.test(cityKey)) {
        return `${fmt(parts[parts.length - 2] || '')}, ${state}`;
      }
    }

    if (parts.length >= 3) {
      const pair = `${parts[parts.length - 2]}-${parts[parts.length - 1]}`.toLowerCase();
      const state = US_STATE_TOKENS[pair];
      if (state) {
        const cityKey = parts[parts.length - 3]?.toLowerCase() || '';
        if (cityKey && !JOB_WORDS.has(cityKey) && !/^\d+$/.test(cityKey)) {
          return `${fmt(parts[parts.length - 3] || '')}, ${state}`;
        }
        return state;
      }
    }

    return '';
  } catch {
    return '';
  }
}

/** Hiring Cafe–aware parse: __NEXT_DATA__ → JSON-LD → generic parser → DOM heuristics. */
export function parseHiringCafeJobPageHtml(
  html: string,
  postingUrl: string
): HiringCafeStructuredFields {
  const generic = parseJobPageHtml(html, postingUrl);
  const jsonld = parseJsonLdJobPosting(html, postingUrl);

  let fromNext: HiringCafeStructuredFields | null = null;
  const nextRoot = extractNextDataJson(html);
  const nextJob = pickJobRecordFromNextData(nextRoot);
  if (nextJob) fromNext = normalizeHiringCafeJobRecord(nextJob);

  const heuristics = parseHiringCafeHtmlHeuristics(html, postingUrl);
  let merged = mergeParsedFields(
    jsonld,
    mergeParsedFields(fromNext as ParsedJobFields | null, heuristics as ParsedJobFields)
  );
  merged = mergeParsedFields(merged, generic);

  if (!merged.location) {
    const slugLoc = locationFromHiringCafeSlug(postingUrl);
    if (slugLoc) merged.location = slugLoc;
  }
  if (!merged.jobTitle || isGenericJobTitle(merged.jobTitle) || /^(?:hiring\s*cafe|hiringcafe(?:\.com)?)$/i.test(merged.jobTitle)) {
    merged.jobTitle = titleFromHiringCafeSlug(postingUrl);
  }
  if (!merged.applyUrl) {
    merged.applyUrl = extractHiringCafeApplyUrl(html, postingUrl);
  }

  const structured: HiringCafeStructuredFields = {
    ...merged,
    about: fromNext?.about || '',
    skills: fromNext?.skills || [],
    responsibilities: fromNext?.responsibilities || [],
    minimumQualifications: fromNext?.minimumQualifications || [],
    preferredQualifications: fromNext?.preferredQualifications || [],
    benefits: fromNext?.benefits || [],
    certifications: fromNext?.certifications || [],
    sectorIndustry: fromNext?.sectorIndustry || '',
    f500: fromNext?.f500 || '',
    companyWebsite: fromNext?.companyWebsite || '',
    jobExperience: fromNext?.jobExperience || fromNext?._jobExperience || 0,
    seniorityLevel: fromNext?.seniorityLevel || '',
    roleType: fromNext?.roleType || '',
    educationRequirement: fromNext?.educationRequirement || '',
    visaSponsorship: fromNext?.visaSponsorship || '',
    ...(fromNext?.companyEmployeeCount && fromNext.companyEmployeeCount > 0
      ? { companyEmployeeCount: fromNext.companyEmployeeCount }
      : {}),
    ...(fromNext?.companyFoundedYear && fromNext.companyFoundedYear > 0
      ? { companyFoundedYear: fromNext.companyFoundedYear }
      : {}),
  };
  // Prefer Hiring Cafe–normalized fields (mergeParsedFields can mangle salary/location).
  if (fromNext?.companyLogoUrl) structured.companyLogoUrl = fromNext.companyLogoUrl;
  if (fromNext?.jobCategory) structured.jobCategory = fromNext.jobCategory;
  if (fromNext?.salaryRange) structured.salaryRange = fromNext.salaryRange;
  if (fromNext?.employmentType) structured.employmentType = fromNext.employmentType;
  if (fromNext?.remoteType) structured.remoteType = fromNext.remoteType;
  if (fromNext?.location) structured.location = fromNext.location;
  if (fromNext?.applyUrl) structured.applyUrl = fromNext.applyUrl;
  if (fromNext?.jobTitle) structured.jobTitle = fromNext.jobTitle;
  if (fromNext?.companyName) structured.companyName = fromNext.companyName;
  if (fromNext?.jobDescription && fromNext.jobDescription.length >= (structured.jobDescription || '').length) {
    structured.jobDescription = fromNext.jobDescription;
  }
  const yoe = Number(structured.jobExperience || 0);
  if (yoe > 0) structured._jobExperience = yoe;

  return structured;
}

export function titleFromHiringCafeSlug(url: string): string {
  try {
    const slug = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
    const parts = slug.split('-').filter(Boolean);
    if (parts.length === 0) return '';
    const last = parts[parts.length - 1] || '';
    if (/^[a-z0-9]{8,}$/i.test(last)) parts.pop();
    return parts
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
      .trim();
  } catch {
    return '';
  }
}

function urlCandidatesFromRow(row: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const value of Object.values(row)) {
    if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim())) continue;
    out.push(value.trim());
  }
  return out;
}

/** Prefer a Hiring Cafe /job/{slug} URL from list-row fields (url, jobUrl, href, …). */
export function pickHiringCafeJobUrl(row: Record<string, unknown>): string | null {
  const candidates = urlCandidatesFromRow(row);
  const postings = candidates.filter(isHiringCafeJobPostingUrl);
  if (postings.length === 0) return null;
  postings.sort((a, b) => b.length - a.length);
  return postings[0] || null;
}

/**
 * Stamp HC /job/{slug} onto list rows so enrichment can Scrape.do later.
 * Does not fetch pages — aggregator Chromium stays on the search list only.
 */
export function stampHiringCafeListPostingUrls(
  rows: Record<string, unknown>[]
): { stamped: number } {
  let stamped = 0;
  for (const row of rows) {
    const postingUrl = pickHiringCafeJobUrl(row);
    if (!postingUrl) continue;
    row.aggregatorPostingUrl = postingUrl;
    if (!String(row.jobUrl || '').trim()) row.jobUrl = postingUrl;
    stamped += 1;
  }
  return { stamped };
}

/**
 * Employer apply link on a Hiring Cafe job page.
 * Primary source: __NEXT_DATA__.props.pageProps.job.apply_url
 * (the pink "Apply directly on employer's site" control is a <button>, not an <a href>).
 */
export function extractHiringCafeApplyUrl(html: string, postingUrl: string): string {
  if (!html) return '';

  const nextRoot = extractNextDataJson(html);
  const nextJob = pickJobRecordFromNextData(nextRoot);
  if (nextJob) {
    const fromNext = preferExternalApplyUrl(
      nextJob.apply_url,
      nextJob.applyUrl,
      nextJob.applicationUrl,
      nextJob.externalApplyUrl,
      asRecord(nextJob.job_information)?.apply_url
    );
    if (fromNext) return fromNext;
  }

  // Regex fallback when JSON parse fails but apply_url is present in the script blob.
  const applyUrlMatch = html.match(
    /"apply_url"\s*:\s*"(https?:[^"\\]+(?:\\.[^"\\]*)*)"/i
  );
  if (applyUrlMatch?.[1]) {
    const decoded = applyUrlMatch[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/\\"/g, '"');
    const preferred = preferExternalApplyUrl(decoded);
    if (preferred) return preferred;
  }

  // Legacy: some pages still expose an <a href> for apply.
  const $ = cheerio.load(html);
  const ranked: { href: string; score: number }[] = [];
  $('a[href]').each((_, el) => {
    const href = String($(el).attr('href') || '').trim();
    if (!href) return;
    let abs = '';
    try {
      abs = new URL(href, postingUrl).href;
    } catch {
      return;
    }
    if (isHiringCafeUrl(abs)) return;
    const text = ($(el).text() || '').toLowerCase();
    let score = 0;
    if (/apply\s+directly|employer/.test(text)) score += 80;
    if (/apply/.test(text)) score += 50;
    if (/apply/.test(abs.toLowerCase())) score += 15;
    if (score === 0) return;
    ranked.push({ href: abs, score });
  });
  ranked.sort((a, b) => b.score - a.score);
  return ranked[0]?.href || '';
}

export function mergeHiringCafeDetailIntoRow(
  listRow: Record<string, unknown>,
  detail: Partial<HiringCafeStructuredFields>,
  postingUrl: string
): Record<string, unknown> {
  const next = { ...listRow };
  const existingTitle = String(next.jobTitle || next.title || '').trim();
  const existingCompany = String(next.companyName || next.company || '').trim();
  const existingDesc = String(next.jobDescription || next.description || '').trim();
  const portalCompany = /^(hiring\s*cafe|hiringcafe)$/i.test(existingCompany);
  const tickerLikeCompany =
    /^(?:nasdaq|nyse|bse|lse|tsx|hkex|epa|fra)\s*:/i.test(existingCompany) ||
    /^[A-Z]{1,5}:\s*[A-Z0-9. ]+$/i.test(existingCompany);

  const rawDetailTitle = String(detail.jobTitle || '').trim();
  const garbageTitle =
    /^(?:hiring\s*cafe|hiringcafe(?:\.com)?|just a moment(?:\.\.\.)?|attention required|access denied)$/i.test(
      rawDetailTitle
    ) || /^(?:hiring\s*cafe|hiringcafe(?:\.com)?)$/i.test(existingTitle);
  const detailTitle = garbageTitle ? '' : rawDetailTitle;
  const detailCompany = sanitizeCompanyName(String(detail.companyName || '').trim());
  const detailDesc = String(detail.jobDescription || '').trim();
  const applyUrl = String(detail.applyUrl || '').trim();

  next.jobUrl = postingUrl;
  next.url = postingUrl;
  next.jobTitle =
    detailTitle ||
    (!garbageTitle ? existingTitle : '') ||
    titleFromHiringCafeSlug(postingUrl);
  next.title = next.jobTitle;

  if (detailCompany && (!existingCompany || portalCompany || tickerLikeCompany)) {
    next.companyName = detailCompany;
    next.company = detailCompany;
  } else if (portalCompany || tickerLikeCompany) {
    next.companyName = detailCompany || existingCompany;
    next.company = next.companyName;
  }

  if (detailDesc.length > existingDesc.length || existingDesc.split(',').length > 8) {
    if (existingDesc && existingDesc.split(',').length > 4 && !next.jobCategory) {
      next.jobCategory = existingDesc;
    }
    next.jobDescription = detailDesc || existingDesc;
    next.description = next.jobDescription;
  }

  const detailLocation = String(detail.location || '').trim();
  if (detailLocation) {
    next.location = detailLocation;
  } else if (!String(next.location || '').trim()) {
    const slugLoc = locationFromHiringCafeSlug(postingUrl);
    if (slugLoc) next.location = slugLoc;
  }
  if (detail.salaryRange) next.salaryRange = detail.salaryRange;
  if (detail.employmentType) next.employmentType = detail.employmentType;
  if (detail.remoteType) next.remoteType = detail.remoteType;
  if (detail.jobCategory) next.jobCategory = detail.jobCategory;
  if (detail.companyLogoUrl) next.companyLogoUrl = detail.companyLogoUrl;
  if (detail.companyWebsite) next.companyWebsite = detail.companyWebsite;
  if (detail.sectorIndustry) next.sectorIndustry = detail.sectorIndustry;
  if (detail.f500) next.f500 = detail.f500;
  if (detail.about) next.about = detail.about;
  if (detail.date) next.date = detail.date;

  const yoe = Number(detail.jobExperience || detail._jobExperience || 0);
  if (yoe > 0) next.jobExperience = yoe;

  if (Array.isArray(detail.skills) && detail.skills.length) next.skills = detail.skills;
  if (Array.isArray(detail.responsibilities) && detail.responsibilities.length) {
    next.responsibilities = detail.responsibilities;
  }
  if (Array.isArray(detail.minimumQualifications) && detail.minimumQualifications.length) {
    next.minimumQualifications = detail.minimumQualifications;
  }
  if (Array.isArray(detail.preferredQualifications) && detail.preferredQualifications.length) {
    next.preferredQualifications = detail.preferredQualifications;
  }
  if (Array.isArray(detail.benefits) && detail.benefits.length) {
    next.benefits = detail.benefits;
  }
  if (Array.isArray(detail.certifications) && detail.certifications.length) {
    next.certifications = detail.certifications;
  }
  if (detail.seniorityLevel) next.seniorityLevel = detail.seniorityLevel;
  if (detail.roleType) next.roleType = detail.roleType;
  if (detail.educationRequirement) next.educationRequirement = detail.educationRequirement;
  if (detail.visaSponsorship) next.visaSponsorship = detail.visaSponsorship;
  if (detail.companyEmployeeCount && detail.companyEmployeeCount > 0) {
    next.companyEmployeeCount = detail.companyEmployeeCount;
  }
  if (detail.companyFoundedYear && detail.companyFoundedYear > 0) {
    next.companyFoundedYear = detail.companyFoundedYear;
  }

  const externalApply = preferExternalApplyUrl(applyUrl, next.applyUrl);
  if (externalApply) {
    next.applyUrl = externalApply;
  } else {
    // Never leave Apply pointing at the Hiring Cafe posting itself.
    delete next.applyUrl;
  }

  return next;
}

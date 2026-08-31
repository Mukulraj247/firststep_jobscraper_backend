/**
 * Accel (Getro) job detail parse + merge into list rows.
 * Detail URLs: https://jobs.accel.com/companies/{slug}/jobs/{id-slug}
 */

import * as cheerio from 'cheerio';
import { isAccelJobPostingUrl, isAccelUrl } from './aggregatorIdentity';
import {
  mergeParsedFields,
  normalizeJobDescription,
  parseJobPageHtml,
  parseJsonLdJobPosting,
  sanitizeCompanyName,
  type ParsedJobFields,
} from './jobPageParser';

export type AccelStructuredFields = ParsedJobFields & {
  about?: string;
  skills?: string[];
  responsibilities?: string[];
  minimumQualifications?: string[];
  preferredQualifications?: string[];
  benefits?: string[];
  certifications?: string[];
  seniorityLevel?: string;
  aggregatorPostingUrl?: string;
};

function preferExternalApplyUrl(...candidates: unknown[]): string {
  for (const c of candidates) {
    const raw = String(c || '').trim();
    if (!raw || !/^https?:\/\//i.test(raw)) continue;
    if (isAccelUrl(raw)) continue;
    return raw;
  }
  return '';
}

function stripHtmlToText(html: string): string {
  return normalizeJobDescription(
    String(html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/div>/gi, '\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<\/h[1-6]>/gi, '\n')
      .replace(/<(h[1-6])[^>]*>/gi, '\n\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
  );
}

function textFrom($: cheerio.CheerioAPI, sel: string): string {
  return ($(sel).first().text() || '').replace(/\s+/g, ' ').trim();
}

/** Extract Accel/Getro job detail HTML into Scout-X fields. */
export function parseAccelJobPageHtml(html: string, postingUrl: string): AccelStructuredFields {
  const $ = cheerio.load(String(html || ''));
  const generic = parseJobPageHtml(html, postingUrl);
  const jsonld = parseJsonLdJobPosting(html, postingUrl);

  const h1 = textFrom($, 'h1') || textFrom($, 'h2');
  let company = '';
  // Company often sits next to the title / logo on Getro Accel pages.
  $('a[href*="/companies/"]').each((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (t && t.length < 80 && !/^(view|see|explore|jobs?|companies?)$/i.test(t)) {
      company = t;
      return false;
    }
    return undefined;
  });
  if (!company) {
    const nearTitle = $('h1').first().parent().text() || '';
    const m = nearTitle.match(/\n\s*([A-Z][^\n]{1,60})\s*\n/);
    if (m?.[1] && !/software engineering|posted on|apply now/i.test(m[1])) {
      company = m[1].trim();
    }
  }

  // Location / categories / posted — Getro header metadata.
  let location = '';
  let jobCategory = '';
  let date = '';
  let salaryRange = '';
  let seniorityLevel = '';
  const bodyText = $('body').text();
  const locMatch = bodyText.match(/Location:\s*([^\n]+)/i);
  if (locMatch) location = locMatch[1].replace(/\s+/g, ' ').trim();
  const postedMatch = bodyText.match(/Posted\s+on\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i);
  if (postedMatch) date = postedMatch[1].trim();
  const compMatch = bodyText.match(/Compensation:\s*([^\n]+)/i);
  if (compMatch) salaryRange = compMatch[1].replace(/\s+/g, ' ').trim();

  // Categories line often appears under company (e.g. "Software Engineering, Other Engineering").
  const afterCompany = company
    ? bodyText.split(company)[1]?.slice(0, 400) || ''
    : '';
  const catLine = afterCompany
    .split('\n')
    .map((l) => l.trim())
    .find(
      (l) =>
        l.length > 3 &&
        l.length < 120 &&
        /Engineering|Design|Product|Sales|Marketing|Operations|Legal|Finance|Data/i.test(l) &&
        !/San Francisco|United States|Posted|Apply|Location/i.test(l)
    );
  if (catLine) jobCategory = catLine;

  // Main description: prefer #content, then article/main, then largest prose block.
  let descHtml = '';
  const contentRoot =
    $('#content').html() ||
    $('[id*="content" i]').first().html() ||
    $('article').first().html() ||
    $('main').first().html() ||
    '';
  if (contentRoot && contentRoot.length > 200) {
    descHtml = contentRoot;
  } else {
    let best = '';
    $('section, article, main, div').each((_, el) => {
      const inner = $(el).html() || '';
      const text = $(el).text() || '';
      if (
        text.length > best.length &&
        text.length > 400 &&
        /about\s+the\s+role|what we(?:'|’)re working|you may be a fit|about\s+\w+/i.test(text)
      ) {
        best = inner;
      }
    });
    descHtml = best;
  }

  // Drop chrome from description if still present.
  const $desc = cheerio.load(`<div>${descHtml}</div>`);
  $desc('nav, header, footer, script, style, noscript').remove();
  const jobDescription = stripHtmlToText($desc('div').html() || descHtml);

  // About company: first "About X" section blurb.
  let about = '';
  const aboutMatch = jobDescription.match(
    /About\s+([A-Za-z0-9][^\n]{0,40})\n+([\s\S]{40,600}?)(?=\n\s*(?:About the role|What we|You may|Applying|##|$))/i
  );
  if (aboutMatch) {
    about = aboutMatch[2].replace(/\s+/g, ' ').trim().slice(0, 400);
    if (!company) company = aboutMatch[1].trim();
  }

  // Apply href — prefer external.
  let applyUrl = '';
  $('a').each((_, el) => {
    const label = ($(el).text() || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const href = String($(el).attr('href') || '').trim();
    if (!href || !/apply/i.test(label)) return;
    try {
      const abs = new URL(href, postingUrl).toString();
      const ext = preferExternalApplyUrl(abs);
      if (ext) {
        applyUrl = ext;
        return false;
      }
    } catch {
      /* ignore */
    }
    return undefined;
  });

  // Remote / seniority hints from tags on page.
  let remoteType = '';
  if (/\bremote\b/i.test(bodyText.slice(0, 2500))) remoteType = 'Remote';
  else if (/\bhybrid\b/i.test(bodyText.slice(0, 2500))) remoteType = 'Hybrid';
  else if (/\bonsite|on-site\b/i.test(bodyText.slice(0, 2500))) remoteType = 'Onsite';
  if (/\bentry\s*level\b/i.test(bodyText)) seniorityLevel = 'Entry Level';
  else if (/\bintern(ship)?\b/i.test(bodyText)) seniorityLevel = 'Internship';
  else if (/\bsenior\b/i.test(bodyText.slice(0, 3000))) seniorityLevel = 'Senior';
  else if (/\bstaff\b/i.test(bodyText.slice(0, 3000))) seniorityLevel = 'Staff';

  const fromDom: Partial<ParsedJobFields> = {
    jobTitle: h1,
    companyName: sanitizeCompanyName(company),
    jobDescription,
    location,
    salaryRange,
    employmentType: '',
    remoteType,
    date,
    applyUrl,
    companyLogoUrl: '',
    jobCategory,
    source: 'html',
  };

  let merged = mergeParsedFields(jsonld, fromDom as ParsedJobFields);
  merged = mergeParsedFields(merged, generic);
  // Prefer Accel DOM description when richer than generic/jsonld.
  if (jobDescription.length >= (merged.jobDescription || '').length) {
    merged.jobDescription = jobDescription;
  }
  if (fromDom.jobTitle) merged.jobTitle = String(fromDom.jobTitle);
  if (fromDom.companyName) merged.companyName = String(fromDom.companyName);
  if (fromDom.location) merged.location = String(fromDom.location);
  if (fromDom.applyUrl) merged.applyUrl = String(fromDom.applyUrl);
  if (fromDom.jobCategory) merged.jobCategory = String(fromDom.jobCategory);
  if (fromDom.salaryRange) merged.salaryRange = String(fromDom.salaryRange);
  if (fromDom.remoteType) merged.remoteType = String(fromDom.remoteType);
  if (fromDom.date) merged.date = String(fromDom.date);

  return {
    ...merged,
    about,
    seniorityLevel,
    skills: [],
    responsibilities: [],
    minimumQualifications: [],
    preferredQualifications: [],
    benefits: [],
    certifications: [],
    aggregatorPostingUrl: postingUrl,
  };
}

export function pickAccelJobUrl(row: Record<string, unknown>): string {
  const candidates: string[] = [];
  for (const value of Object.values(row)) {
    if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim())) continue;
    candidates.push(value.trim().split('#')[0] || value.trim());
  }
  for (const url of candidates) {
    if (isAccelJobPostingUrl(url)) return url;
  }
  return '';
}

export function mergeAccelDetailIntoRow(
  listRow: Record<string, unknown>,
  detail: Partial<AccelStructuredFields>,
  postingUrl: string
): Record<string, unknown> {
  const next = { ...listRow };
  const existingTitle = String(next.jobTitle || next.title || '').trim();
  const existingCompany = String(next.companyName || next.company || '').trim();
  const existingDesc = String(next.jobDescription || next.description || '').trim();
  const portalCompany = /^(accel|jobs\.accel|getro)$/i.test(existingCompany);

  const detailTitle = String(detail.jobTitle || '').trim();
  const detailCompany = sanitizeCompanyName(String(detail.companyName || '').trim());
  const detailDesc = String(detail.jobDescription || '').trim();

  next.jobUrl = postingUrl;
  next.url = postingUrl;
  next.aggregatorPostingUrl = postingUrl;
  next.jobTitle = detailTitle || existingTitle;
  next.title = next.jobTitle;

  if (detailCompany && (!existingCompany || portalCompany)) {
    next.companyName = detailCompany;
    next.company = detailCompany;
  } else if (portalCompany) {
    next.companyName = detailCompany || existingCompany;
    next.company = next.companyName;
  }

  if (detailDesc.length > existingDesc.length) {
    next.jobDescription = detailDesc;
    next.description = detailDesc;
  }

  if (detail.location) next.location = detail.location;
  if (detail.salaryRange) next.salaryRange = detail.salaryRange;
  if (detail.employmentType) next.employmentType = detail.employmentType;
  if (detail.remoteType) next.remoteType = detail.remoteType;
  if (detail.jobCategory) next.jobCategory = detail.jobCategory;
  if (detail.companyLogoUrl) next.companyLogoUrl = detail.companyLogoUrl;
  if (detail.about) next.about = detail.about;
  if (detail.date) next.date = detail.date;
  if (detail.seniorityLevel) next.seniorityLevel = detail.seniorityLevel;

  const externalApply = preferExternalApplyUrl(detail.applyUrl, next.applyUrl);
  if (externalApply) {
    next.applyUrl = externalApply;
  } else {
    delete next.applyUrl;
  }

  return next;
}

export { preferExternalApplyUrl };

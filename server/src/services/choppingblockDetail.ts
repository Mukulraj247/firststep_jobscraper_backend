/**
 * Chopping Block (Webflow) job detail parse + merge.
 * Detail: https://www.choppingblock.ai/jobs/{slug-at-company}
 */

import * as cheerio from 'cheerio';
import { isChoppingBlockJobPostingUrl, isChoppingBlockUrl } from './aggregatorIdentity';
import {
  mergeParsedFields,
  normalizeJobDescription,
  parseJobPageHtml,
  sanitizeCompanyName,
  type ParsedJobFields,
} from './jobPageParser';

export type ChoppingBlockStructuredFields = Partial<ParsedJobFields> & {
  aggregatorPostingUrl?: string;
  companyEmployeeCount?: number;
};

export function preferExternalApplyUrl(...candidates: unknown[]): string {
  for (const c of candidates) {
    const raw = String(c || '').trim();
    if (!raw || !/^https?:\/\//i.test(raw)) continue;
    if (isChoppingBlockUrl(raw)) continue;
    if (/facebook\.com|twitter\.com|linkedin\.com|whatsapp|telegram|webflow|cdn\.|form\.asana/i.test(raw)) {
      continue;
    }
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

function companyFromPostingSlug(postingUrl: string): string {
  try {
    const slug = new URL(postingUrl).pathname.split('/').filter(Boolean).pop() || '';
    const atMatch = slug.match(/-at-([a-z0-9-]+)$/i);
    if (!atMatch) return '';
    return atMatch[1]
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  } catch {
    return '';
  }
}

function companyFromPageMeta($: cheerio.CheerioAPI, html: string): string {
  const titleTag = ($('title').first().text() || '').trim();
  const fromTitle = titleTag.match(/\bat\s+(.+?)\s*(?:\||$)/i);
  if (fromTitle?.[1]) return fromTitle[1].trim();

  const ogTitle = String($('meta[property="og:title"]').attr('content') || '').trim();
  const fromOg = ogTitle.match(/\bat\s+(.+?)\s*(?:\||$)/i);
  if (fromOg?.[1]) return fromOg[1].trim();

  const desc = String($('meta[name="description"]').attr('content') || '').trim();
  const fromDesc = desc.match(/\bat\s+([A-Za-z0-9][A-Za-z0-9 .&'-]{1,60})\./i);
  if (fromDesc?.[1]) return fromDesc[1].trim();

  return '';
}

/** List-page labels mistaken for employer names on Chopping Block. */
export function isChoppingBlockNoiseCompany(name: string): boolean {
  const t = String(name || '').trim();
  if (!t) return true;
  if (/^(chopping\s*block|ai chopping block|the ai chopping block)$/i.test(t)) return true;
  if (/^top\s*ai$/i.test(t)) return true;
  if (/^ai\s*jobs?$/i.test(t)) return true;
  return false;
}

/** Derive employer name for board display when list scrape stored portal noise. */
export function deriveChoppingBlockCompany(
  postingUrl: string,
  description: string,
  storedCompany?: string
): string {
  const fromSlug = sanitizeCompanyName(companyFromPostingSlug(postingUrl));
  if (fromSlug) return fromSlug;

  const stored = sanitizeCompanyName(String(storedCompany || '').trim());
  if (stored && !isChoppingBlockNoiseCompany(stored)) return stored;

  const desc = String(description || '').trim();
  const lead = desc.match(/^([A-Z][A-Za-z0-9.&' -]{1,48})\s+is\s+(?:the|a|an)\b/);
  if (lead?.[1] && !isChoppingBlockNoiseCompany(lead[1])) {
    return sanitizeCompanyName(lead[1].trim());
  }

  return stored;
}

function parseChoppingBlockLocation($: cheerio.CheerioAPI): string {
  const country =
    $('.job_country_flag')
      .closest('.tag')
      .find('.text-weight-medium')
      .first()
      .text()
      .replace(/\s+/g, ' ')
      .trim() || '';
  if (country) return country;

  const bodyText = $('body').text().replace(/\s+/g, ' ');
  const locCandidates = bodyText.match(
    /\b(United States|United Kingdom|Remote|San Francisco|New York|London|Germany|Canada|India|Australia)\b/gi
  );
  return locCandidates?.[0] || '';
}

function parseChoppingBlockEmployeeCount($: cheerio.CheerioAPI): number {
  let count = 0;
  $('.job-header_metatag-link .text-size-regular').each((_, el) => {
    const t = ($(el).text() || '').replace(/\s+/g, ' ').trim();
    const range = t.match(/^(\d{1,6})\s*-\s*(\d{1,6})$/);
    if (range) {
      count = Math.round((Number(range[1]) + Number(range[2])) / 2);
      return false;
    }
    const single = t.match(/^(\d{1,6})\+?$/);
    if (single && Number(single[1]) >= 10) {
      count = Number(single[1]);
      return false;
    }
    return undefined;
  });
  return count;
}

function textFrom($: cheerio.CheerioAPI, sel: string): string {
  return ($(sel).first().text() || '').replace(/\s+/g, ' ').trim();
}

export function parseChoppingBlockJobPageHtml(
  html: string,
  postingUrl: string
): ChoppingBlockStructuredFields {
  const $ = cheerio.load(String(html || ''));
  const generic = parseJobPageHtml(html, postingUrl);

  const h1 = textFrom($, 'h1') || textFrom($, '.breadcrumb-link.is-active');
  let company =
    sanitizeCompanyName(companyFromPageMeta($, html)) ||
    sanitizeCompanyName(companyFromPostingSlug(postingUrl));

  let location = parseChoppingBlockLocation($);
  const employeeCount = parseChoppingBlockEmployeeCount($);

  let descHtml =
    $('.w-richtext').first().html() ||
    $('[class*="job"][class*="description"]').first().html() ||
    $('[class*="company_detail"]').first().html() ||
    '';
  if (!descHtml || descHtml.length < 200) {
    $('h2, h3').each((_, el) => {
      const label = ($(el).text() || '').trim();
      if (/job\s*description/i.test(label)) {
        const sib = $(el).parent().next().html() || $(el).next().html() || '';
        if (sib.length > descHtml.length) descHtml = sib;
      }
    });
  }
  const $desc = cheerio.load(`<div>${descHtml}</div>`);
  $desc('nav, header, footer, script, style, noscript, form').remove();
  let jobDescription = stripHtmlToText($desc('div').html() || descHtml);
  // Fallback: body text between title and similar jobs.
  if (jobDescription.length < 200) {
    const raw = $('body').text();
    const start = raw.search(/Job Description|About the role|We're looking/i);
    const end = raw.search(/Similar AI jobs|Apply for the/i);
    if (start >= 0) {
      jobDescription = normalizeJobDescription(
        raw.slice(start, end > start ? end : start + 8000)
      );
    }
  }

  let applyUrl = '';
  $('a[href]').each((_, el) => {
    const href = String($(el).attr('href') || '').trim();
    const label = ($(el).text() || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!href) return;
    try {
      const abs = new URL(href, postingUrl).toString();
      const ext = preferExternalApplyUrl(abs);
      if (ext && (/apply/i.test(label) || /careers|jobs\.|greenhouse|ashby|lever/i.test(ext))) {
        applyUrl = ext;
        return false;
      }
    } catch {
      /* ignore */
    }
    return undefined;
  });

  const fromDom: Partial<ParsedJobFields> = {
    jobTitle: h1,
    companyName: company,
    jobDescription,
    location,
    applyUrl,
    source: 'html',
  };

  let merged = mergeParsedFields(generic, fromDom as ParsedJobFields);
  if (jobDescription.length >= (merged.jobDescription || '').length) {
    merged.jobDescription = jobDescription;
  }
  if (fromDom.jobTitle) merged.jobTitle = String(fromDom.jobTitle);
  if (fromDom.companyName) merged.companyName = String(fromDom.companyName);
  if (fromDom.location) merged.location = String(fromDom.location);
  if (fromDom.applyUrl) merged.applyUrl = String(fromDom.applyUrl);

  return {
    ...merged,
    aggregatorPostingUrl: postingUrl,
    ...(employeeCount > 0 ? { companyEmployeeCount: employeeCount } : {}),
  };
}

export function pickChoppingBlockJobUrl(row: Record<string, unknown>): string {
  const candidates: string[] = [];
  for (const value of Object.values(row)) {
    if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim())) continue;
    candidates.push(value.trim().split('#')[0] || value.trim());
  }
  const explicit = String(row.aggregatorPostingUrl || '').trim();
  if (explicit && isChoppingBlockJobPostingUrl(explicit)) return explicit.split('#')[0] || explicit;
  for (const url of candidates) {
    if (isChoppingBlockJobPostingUrl(url)) return url;
  }
  return '';
}

export function mergeChoppingBlockDetailIntoRow(
  listRow: Record<string, unknown>,
  detail: ChoppingBlockStructuredFields,
  postingUrl: string
): Record<string, unknown> {
  const next = { ...listRow };
  const existingTitle = String(next.jobTitle || next.title || '').trim();
  const existingCompany = String(next.companyName || next.company || '').trim();
  const existingDesc = String(next.jobDescription || next.description || '').trim();
  const existingLoc = String(next.location || '').trim();

  const detailTitle = String(detail.jobTitle || '').trim();
  const detailCompany = sanitizeCompanyName(String(detail.companyName || '').trim());
  const detailDesc = String(detail.jobDescription || '').trim();
  const detailLoc = String(detail.location || '').trim();

  next.jobUrl = postingUrl;
  next.url = postingUrl;
  next.aggregatorPostingUrl = postingUrl;
  next.jobTitle = detailTitle || existingTitle;
  next.title = next.jobTitle;

  if (detailCompany) {
    next.companyName = detailCompany;
    next.company = detailCompany;
  } else if (isChoppingBlockNoiseCompany(existingCompany)) {
    const derived = deriveChoppingBlockCompany(postingUrl, detailDesc || existingDesc, existingCompany);
    if (derived) {
      next.companyName = derived;
      next.company = derived;
    }
  }

  if (detailDesc.length > existingDesc.length) {
    next.jobDescription = detailDesc;
    next.description = detailDesc;
  }

  if (detailLoc) {
    const listWeak = !existingLoc || /^remote$/i.test(existingLoc);
    if (listWeak || detailLoc.length > existingLoc.length) {
      next.location = detailLoc;
    }
  }
  if (detail.salaryRange) next.salaryRange = detail.salaryRange;
  if (detail.employmentType) next.employmentType = detail.employmentType;
  if (detail.remoteType) next.remoteType = detail.remoteType;
  if (typeof detail.companyEmployeeCount === 'number' && detail.companyEmployeeCount > 0) {
    next.companyEmployeeCount = detail.companyEmployeeCount;
  }

  const externalApply = preferExternalApplyUrl(detail.applyUrl, next.applyUrl);
  if (externalApply) next.applyUrl = externalApply;
  else delete next.applyUrl;

  return next;
}

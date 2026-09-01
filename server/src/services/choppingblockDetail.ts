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
  let company = '';
  // Slug often ends with -at-{company}
  try {
    const slug = new URL(postingUrl).pathname.split('/').filter(Boolean).pop() || '';
    const atMatch = slug.match(/-at-([a-z0-9-]+)$/i);
    if (atMatch) {
      company = atMatch[1]
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
    }
  } catch {
    /* ignore */
  }

  let location = '';
  const bodyText = $('body').text().replace(/\s+/g, ' ');
  const locCandidates = bodyText.match(
    /\b(United States|United Kingdom|Remote|San Francisco|New York|London|Germany|Canada)\b/gi
  );
  if (locCandidates?.[0]) location = locCandidates[0];

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
    companyName: sanitizeCompanyName(company),
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

  return { ...merged, aggregatorPostingUrl: postingUrl };
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
  const portalCompany = /^(chopping\s*block|ai chopping block)$/i.test(existingCompany);

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
  }

  if (detailDesc.length > existingDesc.length) {
    next.jobDescription = detailDesc;
    next.description = detailDesc;
  }

  if (detail.location) next.location = detail.location;
  if (detail.salaryRange) next.salaryRange = detail.salaryRange;
  if (detail.employmentType) next.employmentType = detail.employmentType;
  if (detail.remoteType) next.remoteType = detail.remoteType;

  const externalApply = preferExternalApplyUrl(detail.applyUrl, next.applyUrl);
  if (externalApply) next.applyUrl = externalApply;
  else delete next.applyUrl;

  return next;
}

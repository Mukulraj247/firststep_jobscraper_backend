/**
 * Sequoia (Consider) job detail parse + merge into list rows.
 * Purpose: resolve external employer/ATS apply URL — not full JD scrape.
 * Posting URLs: https://jobs.sequoiacap.com/jobs?...&weekdayJdUid=...
 */

import * as cheerio from 'cheerio';
import { isConsiderBoardUrl, isConsiderJobPostingUrl } from './aggregatorIdentity';
import {
  mergeParsedFields,
  sanitizeCompanyName,
  type ParsedJobFields,
} from './jobPageParser';

export type SequoiaStructuredFields = Partial<ParsedJobFields> & {
  aggregatorPostingUrl?: string;
};

function stripUtm(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.delete('utm_source');
    u.searchParams.delete('utm_medium');
    u.searchParams.delete('utm_campaign');
    return u.toString();
  } catch {
    return url;
  }
}

/** Prefer an external (non-Consider-board) apply URL. */
export function preferExternalApplyUrl(...candidates: unknown[]): string {
  for (const c of candidates) {
    const raw = String(c || '').trim();
    if (!raw || !/^https?:\/\//i.test(raw)) continue;
    if (isConsiderBoardUrl(raw)) continue;
    return stripUtm(raw);
  }
  return '';
}

function textFrom($: cheerio.CheerioAPI, sel: string): string {
  return ($(sel).first().text() || '').replace(/\s+/g, ' ').trim();
}

function extractApplyUrlsFromJsonBlob(raw: string): string[] {
  const out: string[] = [];
  const re =
    /"(?:apply_url|applyUrl|applicationUrl|application_url|externalApplyUrl)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    try {
      const decoded = JSON.parse(`"${m[1]}"`) as string;
      if (/^https?:\/\//i.test(decoded)) out.push(decoded);
    } catch {
      const plain = m[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
      if (/^https?:\/\//i.test(plain)) out.push(plain);
    }
  }
  // Absolute URLs often appear near apply contexts in embedded payloads.
  const absRe =
    /https?:\/\/(?!jobs\.sequoiacap\.com|careers\.capitalg\.com)[^\s"'<>\\]{12,}/gi;
  let a: RegExpExecArray | null;
  while ((a = absRe.exec(raw))) {
    const candidate = a[0].replace(/[),.;]+$/, '');
    if (
      /utm_source=(?:jobs\.sequoiacap\.com|careers\.capitalg\.com)/i.test(candidate) ||
      /\/apply|jobs\.|greenhouse|lever|ashby|phenom|workday|gem\.com/i.test(candidate)
    ) {
      out.push(candidate);
    }
  }
  return out;
}

function extractStringFieldFromJson(raw: string, keys: string[]): string {
  for (const key of keys) {
    const re = new RegExp(`"${key}"\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`, 'i');
    const m = raw.match(re);
    if (!m?.[1]) continue;
    try {
      return JSON.parse(`"${m[1]}"`) as string;
    } catch {
      return m[1].replace(/\\"/g, '"').trim();
    }
  }
  return '';
}

/** Extract Sequoia/Consider HTML into Scout-X fields (apply URL first). */
export function parseSequoiaJobPageHtml(html: string, postingUrl: string): SequoiaStructuredFields {
  const $ = cheerio.load(String(html || ''));
  const raw = String(html || '');

  let applyUrl = '';
  for (const candidate of extractApplyUrlsFromJsonBlob(raw)) {
    const ext = preferExternalApplyUrl(candidate);
    if (ext) {
      applyUrl = ext;
      break;
    }
  }

  if (!applyUrl) {
    $('a').each((_, el) => {
      const label = ($(el).text() || '').replace(/\s+/g, ' ').trim().toLowerCase();
      const href = String($(el).attr('href') || '').trim();
      if (!href) return;
      const looksApply = /apply/i.test(label) || /apply/i.test(href);
      if (!looksApply && !/^https?:\/\//i.test(href)) return;
      try {
        const abs = new URL(href, postingUrl).toString();
        const ext = preferExternalApplyUrl(abs);
        if (ext && (/apply/i.test(label) || /apply|jobs\.|greenhouse|lever|ashby|gem\.com/i.test(ext))) {
          applyUrl = ext;
          return false;
        }
      } catch {
        /* ignore */
      }
      return undefined;
    });
  }

  const h1 = textFrom($, 'h1') || textFrom($, 'h2');
  const titleFromJson = extractStringFieldFromJson(raw, ['title', 'jobTitle', 'job_title', 'name']);
  const companyFromJson = extractStringFieldFromJson(raw, [
    'company_name',
    'companyName',
    'company',
    'organization',
  ]);
  const locationFromJson = extractStringFieldFromJson(raw, ['location', 'normalized_location']);

  let company = companyFromJson;
  if (!company) {
    $('a[href*="/companies"], [data-testid*="company" i], [class*="company" i]').each((_, el) => {
      const t = $(el).text().replace(/\s+/g, ' ').trim();
      if (t && t.length < 80 && !/^(view|see|explore|jobs?|companies?|sequoia|capitalg)$/i.test(t)) {
        company = t;
        return false;
      }
      return undefined;
    });
  }

  let location = locationFromJson;
  if (!location) {
    const bodyText = $('body').text().replace(/\s+/g, ' ');
    const locMatch = bodyText.match(/(?:Location|Locations)\s*[:·]\s*([^|•\n]{3,80})/i);
    if (locMatch) location = locMatch[1].trim();
  }

  const fromDom: Partial<ParsedJobFields> = {
    jobTitle: (titleFromJson || h1 || '').trim(),
    companyName: sanitizeCompanyName(company),
    jobDescription: '',
    location: location || '',
    applyUrl,
    source: 'html',
  };

  const merged = mergeParsedFields({}, fromDom as ParsedJobFields);
  return {
    ...merged,
    applyUrl: preferExternalApplyUrl(merged.applyUrl, applyUrl),
    aggregatorPostingUrl: postingUrl,
  };
}

export function pickSequoiaJobUrl(row: Record<string, unknown>): string {
  return pickConsiderJobUrl(row);
}

/** Prefer a Consider board posting URL (Sequoia or CapitalG) from a list row. */
export function pickConsiderJobUrl(row: Record<string, unknown>): string {
  const candidates: string[] = [];
  for (const value of Object.values(row)) {
    if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim())) continue;
    candidates.push(value.trim().split('#')[0] || value.trim());
  }
  const explicit = String(row.aggregatorPostingUrl || '').trim();
  if (explicit && isConsiderJobPostingUrl(explicit)) return explicit.split('#')[0] || explicit;

  for (const url of candidates) {
    if (isConsiderJobPostingUrl(url)) return url;
  }
  return '';
}

export function mergeSequoiaDetailIntoRow(
  listRow: Record<string, unknown>,
  detail: SequoiaStructuredFields,
  postingUrl: string
): Record<string, unknown> {
  const next = { ...listRow };
  const existingTitle = String(next.jobTitle || next.title || '').trim();
  const existingCompany = String(next.companyName || next.company || '').trim();
  const portalCompany =
    /^(sequoia|sequoiacap|jobs\.sequoiacap|capitalg|careers\.capitalg|consider)$/i.test(
      existingCompany
    );

  const detailTitle = String(detail.jobTitle || '').trim();
  const detailCompany = sanitizeCompanyName(String(detail.companyName || '').trim());

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

  if (detail.location) next.location = detail.location;
  if (detail.salaryRange) next.salaryRange = detail.salaryRange;
  if (detail.employmentType) next.employmentType = detail.employmentType;
  if (detail.remoteType) next.remoteType = detail.remoteType;
  if (detail.jobCategory) next.jobCategory = detail.jobCategory;
  if (detail.companyLogoUrl) next.companyLogoUrl = detail.companyLogoUrl;
  if (detail.date) next.date = detail.date;

  // Prefer list-row external apply if already present; otherwise detail.
  const externalApply = preferExternalApplyUrl(next.applyUrl, next.apply_url, detail.applyUrl);
  if (externalApply) {
    next.applyUrl = externalApply;
  } else {
    delete next.applyUrl;
  }

  return next;
}

export const mergeConsiderDetailIntoRow = mergeSequoiaDetailIntoRow;
export const parseConsiderJobPageHtml = parseSequoiaJobPageHtml;

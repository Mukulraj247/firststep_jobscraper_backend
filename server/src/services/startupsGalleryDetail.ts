/**
 * startups.gallery list rows: outbound employer job links (ATS, Phenom, or custom careers) + card label parse.
 * https://startups.gallery/jobs?position=software
 */

import { detectAts, looksLikePhenomBoard, shouldNeverScrapeDoUrl } from './atsAdapters';
import { isAggregatorHostUrl, isStartupsGalleryUrl } from './aggregatorIdentity';
import { sanitizeCompanyName } from './jobPageParser';

const ATS_URL_IN_TEXT =
  /https?:\/\/(?:jobs\.ashbyhq\.com|(?:job-boards|boards(?:\.eu)?)\.greenhouse\.io|jobs\.lever\.co|apply\.workable\.com|jobs\.smartrecruiters\.com)[^\s"'<>]+/gi;

const HTTP_URL_IN_TEXT = /https?:\/\/[^\s"'<>]+/gi;

const URL_KEYS = ['jobUrl', 'job_url', 'url', 'link', 'href', 'applyUrl', 'apply_url'] as const;

function titleCaseSlug(slug: string): string {
  return String(slug || '')
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function companyFromHint(hint: string): string {
  const t = titleCaseSlug(hint.replace(/\./g, '-'));
  if (/^Together\s+Ai$/i.test(t)) return 'Together AI';
  if (/^Heidihealth$/i.test(t.replace(/\s+/g, ''))) return 'Heidi Health';
  return sanitizeCompanyName(t);
}

/** Parse card label: "Title Company · Location · Posted on Sep 1, 2026". */
export function parseStartupsGalleryCardLabel(raw: string): {
  jobTitle: string;
  companyName: string;
  location: string;
  date: string;
} {
  const text = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return { jobTitle: '', companyName: '', location: '', date: '' };
  }

  const parts = text.split(' · ').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) {
    return { jobTitle: text, companyName: '', location: '', date: '' };
  }

  const postedPart = parts[parts.length - 1];
  const hasLocation = parts.length >= 3;
  const locationPart = hasLocation ? parts[parts.length - 2] : '';
  const headPart = parts.slice(0, parts.length - (hasLocation ? 2 : 1)).join(' · ');

  let date = '';
  const dateMatch = postedPart.match(/^Posted on\s+(.+)$/i);
  if (dateMatch) date = dateMatch[1].trim();

  let location = locationPart;
  if (/^Hybrid\s+/i.test(location)) {
    location = location.replace(/^Hybrid\s+/i, '').trim();
  }

  return {
    jobTitle: headPart,
    companyName: '',
    location,
    date,
  };
}

export function pickAtsUrlFromRow(data: Record<string, unknown>): string {
  for (const key of URL_KEYS) {
    const raw = String(data[key] || '').trim();
    if (!raw) continue;
    if (detectAts(raw)) return raw.split('#')[0] || raw;
  }
  for (const value of Object.values(data)) {
    if (typeof value !== 'string') continue;
    const matches = value.match(ATS_URL_IN_TEXT);
    if (matches?.[0] && detectAts(matches[0])) {
      return matches[0].split('#')[0] || matches[0];
    }
  }
  return '';
}

const BLOCKED_EMPLOYER_HOSTS = new Set(['tally.so', 'www.tally.so']);

/** External employer apply URL from a gallery card (not startups.gallery or other aggregators). */
export function isStartupsGalleryEmployerJobHref(href: string): boolean {
  const url = String(href || '').trim().split('#')[0];
  if (!url || !/^https?:\/\//i.test(url)) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (!host || host === 'localhost') return false;
    if (BLOCKED_EMPLOYER_HOSTS.has(host) || BLOCKED_EMPLOYER_HOSTS.has(parsed.hostname.toLowerCase())) {
      return false;
    }
    if (isStartupsGalleryUrl(url) || isAggregatorHostUrl(url)) return false;
    if (shouldNeverScrapeDoUrl(url)) return false;
    if (/\.(?:png|jpe?g|gif|svg|webp|css|js|woff2?)(?:\?|$)/i.test(parsed.pathname)) return false;
    return true;
  } catch {
    return false;
  }
}

/** Prefer known ATS URLs; otherwise any external employer careers link for Phenom / scrape.do enrichment. */
export function pickEmployerUrlFromRow(data: Record<string, unknown>): string {
  const ats = pickAtsUrlFromRow(data);
  if (ats) return ats;

  for (const key of URL_KEYS) {
    const raw = String(data[key] || '').trim();
    if (raw && isStartupsGalleryEmployerJobHref(raw)) return raw.split('#')[0] || raw;
  }
  for (const value of Object.values(data)) {
    if (typeof value !== 'string') continue;
    const matches = value.match(HTTP_URL_IN_TEXT);
    if (!matches) continue;
    for (const match of matches) {
      const clean = match.split('#')[0];
      if (isStartupsGalleryEmployerJobHref(clean)) return clean;
    }
  }
  return '';
}

function splitTitleAndCompany(head: string, companyHint: string): { jobTitle: string; companyName: string } {
  const headClean = String(head || '').replace(/\s+/g, ' ').trim();
  if (!headClean) return { jobTitle: '', companyName: '' };

  const hintName = companyFromHint(companyHint);
  if (hintName) {
    const re = new RegExp(`\\s+${hintName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    if (re.test(headClean)) {
      return {
        jobTitle: headClean.replace(re, '').trim(),
        companyName: hintName,
      };
    }
    const slugWords = companyHint.replace(/[-_.]+/g, ' ').trim();
    if (slugWords) {
      const re2 = new RegExp(`\\s+${slugWords.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
      if (re2.test(headClean)) {
        return {
          jobTitle: headClean.replace(re2, '').trim(),
          companyName: hintName || titleCaseSlug(companyHint),
        };
      }
    }
  }

  const words = headClean.split(/\s+/);
  if (words.length >= 3) {
    const companyGuess = words.slice(-2).join(' ');
    const titleGuess = words.slice(0, -2).join(' ');
    if (titleGuess.length >= 3) {
      return {
        jobTitle: titleGuess,
        companyName: sanitizeCompanyName(companyGuess),
      };
    }
  }
  if (words.length >= 2) {
    return {
      jobTitle: words.slice(0, -1).join(' '),
      companyName: sanitizeCompanyName(words[words.length - 1]),
    };
  }

  return { jobTitle: headClean, companyName: '' };
}

/** Normalize a startups.gallery list row so jobUrl is an employer apply URL (ATS or careers page). */
export function normalizeStartupsGalleryListRow(
  data: Record<string, unknown>
): Record<string, unknown> {
  if (!data || typeof data !== 'object') return data;
  const out: Record<string, unknown> = { ...data };

  let employerUrl = pickEmployerUrlFromRow(out);
  const primaryUrl = String(out.jobUrl ?? out.url ?? out.link ?? '').trim();

  if (!employerUrl && primaryUrl && isStartupsGalleryEmployerJobHref(primaryUrl)) {
    employerUrl = primaryUrl;
  }

  if (!employerUrl) return out;

  out.jobUrl = employerUrl;
  out.url = employerUrl;
  out.applyUrl = employerUrl;

  const labelSource = String(
    out.jobTitle ?? out.title ?? out.name ?? out.jobDescription ?? ''
  ).trim();
  const parsed = parseStartupsGalleryCardLabel(labelSource);
  const detected = detectAts(employerUrl);
  const split = splitTitleAndCompany(parsed.jobTitle || labelSource, detected?.companyHint || '');

  if (split.jobTitle) {
    out.jobTitle = split.jobTitle;
    out.title = split.jobTitle;
  }
  if (split.companyName) {
    out.companyName = split.companyName;
    out.company = split.companyName;
  } else if (detected?.companyHint) {
    const cn = companyFromHint(detected.companyHint);
    if (cn) {
      out.companyName = cn;
      out.company = cn;
    }
  }

  if (parsed.location && !String(out.location || '').trim()) {
    out.location = parsed.location;
  }
  if (parsed.date && !String(out.date || '').trim()) {
    out.date = parsed.date;
  }

  return out;
}

export function isStartupsGalleryListRowUsable(data: Record<string, unknown>): boolean {
  const employerUrl = pickEmployerUrlFromRow(data);
  if (!employerUrl || !isStartupsGalleryEmployerJobHref(employerUrl)) return false;
  const title = String(data.jobTitle ?? data.title ?? '').trim();
  return Boolean(title || detectAts(employerUrl) || looksLikePhenomBoard(employerUrl));
}

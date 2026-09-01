/**
 * startups.gallery list rows: outbound ATS links (Ashby / Greenhouse / Lever) + card label parse.
 * https://startups.gallery/jobs?position=software
 */

import { detectAts } from './atsAdapters';
import { isStartupsGalleryUrl } from './aggregatorIdentity';
import { sanitizeCompanyName } from './jobPageParser';

const ATS_URL_IN_TEXT =
  /https?:\/\/(?:jobs\.ashbyhq\.com|(?:job-boards|boards(?:\.eu)?)\.greenhouse\.io|jobs\.lever\.co|apply\.workable\.com|jobs\.smartrecruiters\.com)[^\s"'<>]+/gi;

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

/** Normalize a startups.gallery list row so jobUrl is an employer ATS URL. */
export function normalizeStartupsGalleryListRow(
  data: Record<string, unknown>
): Record<string, unknown> {
  if (!data || typeof data !== 'object') return data;
  const out: Record<string, unknown> = { ...data };

  let atsUrl = pickAtsUrlFromRow(out);
  const primaryUrl = String(out.jobUrl ?? out.url ?? out.link ?? '').trim();

  if (!atsUrl && primaryUrl && !isStartupsGalleryUrl(primaryUrl) && detectAts(primaryUrl)) {
    atsUrl = primaryUrl;
  }

  if (!atsUrl) return out;

  out.jobUrl = atsUrl;
  out.url = atsUrl;
  out.applyUrl = atsUrl;

  const labelSource = String(
    out.jobTitle ?? out.title ?? out.name ?? out.jobDescription ?? ''
  ).trim();
  const parsed = parseStartupsGalleryCardLabel(labelSource);
  const detected = detectAts(atsUrl);
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
  const ats = pickAtsUrlFromRow(data);
  if (!ats || !detectAts(ats)) return false;
  const title = String(data.jobTitle ?? data.title ?? '').trim();
  return Boolean(title || ats);
}

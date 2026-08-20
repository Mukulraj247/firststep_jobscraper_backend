/**
 * Normalize Hiring Cafe `__NEXT_DATA__.props.pageProps.job` into Scout-X job fields.
 * Field mapping mirrors how Hiring Cafe itself presents a posting.
 */

import { isHiringCafeUrl } from './aggregatorIdentity';
import {
  decodeHtmlEntities,
  normalizeJobDescription,
  sanitizeCompanyName,
  type ParsedJobFields,
} from './jobPageParser';

export type HiringCafeStructuredFields = ParsedJobFields & {
  about?: string;
  skills?: string[];
  responsibilities?: string[];
  minimumQualifications?: string[];
  sectorIndustry?: string;
  f500?: string;
  companyWebsite?: string;
  jobExperience?: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (Array.isArray(value)) {
      const joined = value.map((v) => String(v ?? '').trim()).filter(Boolean).join(', ');
      if (joined) return joined;
      continue;
    }
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = decodeHtmlEntities(String(item ?? '').trim());
    if (!text || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    out.push(text);
  }
  return out;
}

function stripHtmlToText(html: string): string {
  if (!html) return '';
  return normalizeJobDescription(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<\/h[1-6]>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
  );
}

function money(n: unknown): number | null {
  if (typeof n === 'number' && Number.isFinite(n) && n > 0) return n;
  if (typeof n === 'string' && n.trim()) {
    const parsed = Number(n.replace(/,/g, ''));
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function currencySymbol(code: string): string {
  const c = code.toUpperCase();
  if (c === 'USD' || c === 'US$') return '$';
  if (c === 'EUR') return '€';
  if (c === 'GBP') return '£';
  if (c === 'INR') return '₹';
  return c ? `${c} ` : '$';
}

function formatMoneyAmount(n: number, freq: string): string {
  if (freq === 'Hourly' || freq === 'Daily') {
    return n % 1 === 0 ? String(n) : n.toFixed(2).replace(/\.00$/, '');
  }
  if (n >= 1000) {
    const k = n / 1000;
    return Number.isInteger(k) ? `${k}k` : `${k.toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(Math.round(n));
}

/**
 * Hiring Cafe compensation → board chip, e.g. `$33-$49/hr` or `$57k-$98k/yr`.
 */
export function formatHiringCafeSalary(v5: Record<string, unknown>): string {
  const currency = firstString(v5.listed_compensation_currency) || 'USD';
  const freqRaw = firstString(v5.listed_compensation_frequency).toLowerCase();
  const symbol = currencySymbol(currency);

  const bands: Array<{ minKey: string; maxKey: string; freq: string; suffix: string }> = [
    { minKey: 'hourly_min_compensation', maxKey: 'hourly_max_compensation', freq: 'Hourly', suffix: '/hr' },
    { minKey: 'yearly_min_compensation', maxKey: 'yearly_max_compensation', freq: 'Yearly', suffix: '/yr' },
    { minKey: 'monthly_min_compensation', maxKey: 'monthly_max_compensation', freq: 'Monthly', suffix: '/mo' },
    { minKey: 'weekly_min_compensation', maxKey: 'weekly_max_compensation', freq: 'Weekly', suffix: '/wk' },
    { minKey: 'daily_min_compensation', maxKey: 'daily_max_compensation', freq: 'Daily', suffix: '/day' },
    {
      minKey: 'bi-weekly_min_compensation',
      maxKey: 'bi-weekly_max_compensation',
      freq: 'Biweekly',
      suffix: '/biweekly',
    },
  ];

  const preferred =
    bands.find((b) => b.freq.toLowerCase() === freqRaw) ||
    bands.find((b) => money(v5[b.minKey]) != null || money(v5[b.maxKey]) != null);

  if (!preferred) return '';

  const min = money(v5[preferred.minKey]);
  const max = money(v5[preferred.maxKey]);
  if (min == null && max == null) return '';

  const fmt = (n: number) => formatMoneyAmount(n, preferred.freq);
  let amount = '';
  if (min != null && max != null) {
    amount = min === max ? `${symbol}${fmt(min)}` : `${symbol}${fmt(min)}-${symbol}${fmt(max)}`;
  } else if (min != null) amount = `${symbol}${fmt(min)}+`;
  else if (max != null) amount = `up to ${symbol}${fmt(max!)}`;

  // Keep Hiring Cafe chip style ($33-$49/hr) — do not run through generic salary prose normalizer.
  return `${amount}${preferred.suffix}`;
}

export function formatHiringCafeEmploymentType(commitment: unknown): string {
  const raw = Array.isArray(commitment)
    ? commitment.map((x) => String(x || '').trim()).filter(Boolean)[0] || ''
    : String(commitment || '').trim();
  if (!raw) return '';
  const key = raw.toLowerCase().replace(/[_-]+/g, ' ');
  if (key.includes('full')) return 'Full-time';
  if (key.includes('part')) return 'Part-time';
  if (key.includes('contract')) return 'Contract';
  if (key.includes('intern')) return 'Internship';
  if (key.includes('temp')) return 'Temporary';
  if (key.includes('freelance') || key.includes('gig')) return 'Freelance';
  return raw.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatHiringCafeRemoteType(workplaceType: unknown): string {
  const raw = String(workplaceType || '').trim();
  if (!raw) return '';
  const key = raw.toLowerCase();
  if (key.includes('remote')) return 'Remote';
  if (key.includes('hybrid')) return 'Hybrid';
  if (key.includes('onsite') || key.includes('on-site') || key.includes('on site')) return 'Onsite';
  if (key.includes('field')) return 'Field';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function formatHiringCafeLocation(v5: Record<string, unknown>): string {
  const formatted = firstString(v5.formatted_workplace_location);
  if (formatted) {
    // Prefer HC's own display string; only lightly clean whitespace.
    return decodeHtmlEntities(formatted).replace(/\s+/g, ' ').trim();
  }

  const cities = asStringList(v5.workplace_cities);
  if (cities[0]) {
    // Hiring Cafe often stores "Chennai, Tamil Nadu, IN" — expand country codes.
    return cities[0]
      .replace(/,\s*IN$/i, ', India')
      .replace(/,\s*US$/i, ', United States')
      .replace(/,\s*GB$/i, ', United Kingdom')
      .replace(/,\s*CA$/i, ', Canada')
      .replace(/,\s*AU$/i, ', Australia')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const states = asStringList(v5.workplace_states);
  const countries = asStringList(v5.workplace_countries);
  return [states[0], countries[0]].filter(Boolean).join(', ');
}

export function preferExternalApplyUrl(...candidates: unknown[]): string {
  for (const value of candidates) {
    const text = String(value ?? '').trim();
    if (!text || !/^https?:\/\//i.test(text)) continue;
    if (isHiringCafeUrl(text)) continue;
    return text;
  }
  return '';
}

function companyLogoFromWebsite(website: string): string {
  const raw = String(website || '').trim();
  if (!raw) return '';
  try {
    const host = raw.includes('://') ? new URL(raw).hostname : raw.replace(/^www\./, '');
    if (!host || /hiring\.?cafe/i.test(host)) return '';
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128`;
  } catch {
    return '';
  }
}

function yoeFromV5(v5: Record<string, unknown>): number {
  const n = money(v5.min_industry_and_role_yoe);
  return n != null ? Math.max(0, Math.floor(n)) : 0;
}

/**
 * Map a raw Hiring Cafe job object (pageProps.job) into Scout-X structured fields.
 */
export function normalizeHiringCafeJobRecord(rec: Record<string, unknown>): HiringCafeStructuredFields {
  const info = asRecord(rec.job_information) || {};
  const v5 = asRecord(rec.v5_processed_job_data) || {};
  const company = asRecord(rec.enriched_company_data) || {};

  const homepage = firstString(company.homepage_uri, v5.company_website, company.website);
  const stockExchange = firstString(company.stock_exchange);
  const stockSymbol = firstString(company.stock_symbol);
  const f500 =
    stockExchange && stockSymbol
      ? `${stockExchange}: ${stockSymbol}`
      : firstString(stockSymbol, stockExchange);

  const industries = asStringList(company.industries);
  const requirementsSummary = firstString(v5.requirements_summary);
  const roleActivities = asStringList(v5.role_activities);
  const technicalTools = asStringList(v5.technical_tools);

  const descriptionHtml = firstString(info.description, rec.description, rec.jobDescription);
  const description = stripHtmlToText(descriptionHtml);

  const location = formatHiringCafeLocation(v5);
  const salaryRange = formatHiringCafeSalary(v5);
  const employmentType = formatHiringCafeEmploymentType(v5.commitment ?? rec.employmentType);
  const remoteType = formatHiringCafeRemoteType(v5.workplace_type ?? rec.workplace_type);
  const applyUrl = preferExternalApplyUrl(
    rec.apply_url,
    rec.applyUrl,
    rec.applicationUrl,
    rec.externalApplyUrl,
    info.apply_url
  );

  const about = firstString(company.tagline, v5.company_tagline);
  const minimumQualifications = requirementsSummary
    ? requirementsSummary
        .split(/;|\n|•/)
        .map((s) => s.trim())
        .filter((s) => s.length > 8)
    : [];

  const fields: HiringCafeStructuredFields = {
    jobTitle: firstString(
      info.title,
      info.job_title_raw,
      v5.core_job_title,
      rec.title,
      rec.jobTitle
    ),
    companyName: sanitizeCompanyName(
      firstString(company.name, v5.company_name, rec.companyName, rec.company)
    ),
    jobDescription: description,
    location,
    salaryRange,
    employmentType,
    remoteType,
    date: firstString(v5.estimated_publish_date, rec.date, info.date),
    applyUrl,
    companyLogoUrl: companyLogoFromWebsite(homepage),
    jobCategory: firstString(v5.job_category, rec.jobCategory, rec.category),
    source: 'html',
    about,
    skills: technicalTools,
    responsibilities: roleActivities.map((a) => a.charAt(0).toUpperCase() + a.slice(1)),
    minimumQualifications,
    sectorIndustry: industries.join(', ') || firstString(v5.company_sector_and_industry),
    f500,
    companyWebsite: homepage
      ? homepage.startsWith('http')
        ? homepage
        : `https://${homepage.replace(/^\/+/, '')}`
      : '',
    jobExperience: yoeFromV5(v5),
  };

  const yoe = Number(fields.jobExperience || 0);
  if (yoe > 0) {
    fields._jobExperience = yoe;
  }

  return fields;
}

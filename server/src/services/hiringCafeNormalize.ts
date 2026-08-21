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
  preferredQualifications?: string[];
  benefits?: string[];
  certifications?: string[];
  sectorIndustry?: string;
  f500?: string;
  companyWebsite?: string;
  jobExperience?: number;
  seniorityLevel?: string;
  roleType?: string;
  educationRequirement?: string;
  /** `yes` | `no` | `` when unknown */
  visaSponsorship?: string;
  companyEmployeeCount?: number;
  companyFoundedYear?: number;
};

/** Benefit boolean keys on HC v5 → human labels (only when true). */
const HC_BENEFIT_FLAGS: Array<{ key: string; label: string }> = [
  { key: '401k_matching', label: '401(k) matching' },
  { key: 'retirement_plan', label: 'Retirement plan' },
  { key: 'generous_parental_leave', label: 'Parental leave' },
  { key: 'tuition_reimbursement', label: 'Tuition reimbursement' },
  { key: 'generous_paid_time_off', label: 'Generous PTO' },
  { key: 'four_day_work_week', label: 'Four-day work week' },
  { key: 'relocation_assistance', label: 'Relocation assistance' },
  { key: 'visa_sponsorship', label: 'Visa sponsorship' },
  { key: 'military_veterans', label: 'Military / veterans friendly' },
];

const DEGREE_LEVELS: Array<{
  reqKey: string;
  fieldsKey: string;
  label: string;
}> = [
  { reqKey: 'associates_degree_requirement', fieldsKey: 'associates_degree_fields_of_study', label: "Associate's degree" },
  { reqKey: 'bachelors_degree_requirement', fieldsKey: 'bachelors_degree_fields_of_study', label: "Bachelor's degree" },
  { reqKey: 'masters_degree_requirement', fieldsKey: 'masters_degree_fields_of_study', label: "Master's degree" },
  { reqKey: 'doctorate_degree_requirement', fieldsKey: 'doctorate_degree_fields_of_study', label: 'Doctorate' },
];

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

function isTruthyFlag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === 'string') {
    const key = value.trim().toLowerCase();
    return key === 'true' || key === 'yes' || key === '1';
  }
  return false;
}

function degreeRequirementKind(raw: unknown): 'required' | 'preferred' | 'none' {
  const key = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ');
  if (!key || key.includes('not mentioned') || key === 'none' || key === 'n/a') return 'none';
  if (key.includes('prefer')) return 'preferred';
  if (key.includes('require') || key === 'yes' || key === 'true') return 'required';
  return 'none';
}

function formatDegreeLine(label: string, fields: string[], kind: 'required' | 'preferred'): string {
  const fieldsPart = fields.length ? ` in ${fields.join(', ')}` : '';
  const suffix = kind === 'preferred' ? ' (preferred)' : ' (required)';
  return `${label}${fieldsPart}${suffix}`;
}

/** Map HC degree_* fields into required / preferred qualification lines + a short education chip. */
export function extractHiringCafeEducation(v5: Record<string, unknown>): {
  required: string[];
  preferred: string[];
  educationRequirement: string;
} {
  const required: string[] = [];
  const preferred: string[] = [];
  for (const level of DEGREE_LEVELS) {
    const kind = degreeRequirementKind(v5[level.reqKey]);
    if (kind === 'none') continue;
    const fields = asStringList(v5[level.fieldsKey]);
    const line = formatDegreeLine(level.label, fields, kind);
    if (kind === 'required') required.push(line);
    else preferred.push(line);
  }
  const educationRequirement = [...required, ...preferred].join('; ');
  return { required, preferred, educationRequirement };
}

/** True benefit flags → human-readable labels (visa also listed when true). */
export function extractHiringCafeBenefits(v5: Record<string, unknown>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const { key, label } of HC_BENEFIT_FLAGS) {
    if (!isTruthyFlag(v5[key])) continue;
    const lower = label.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(label);
  }
  return out;
}

export function formatHiringCafeVisaSponsorship(v5: Record<string, unknown>): string {
  if (v5.visa_sponsorship === true || isTruthyFlag(v5.visa_sponsorship)) return 'yes';
  if (v5.visa_sponsorship === false) return 'no';
  return '';
}

function positiveInt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string' && value.trim()) {
    const n = parseInt(value.replace(/,/g, ''), 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

/**
 * Map a raw Hiring Cafe job object (pageProps.job) into Scout-X structured fields.
 */
export function normalizeHiringCafeJobRecord(rec: Record<string, unknown>): HiringCafeStructuredFields {
  const info = asRecord(rec.job_information) || {};
  const v5 = asRecord(rec.v5_processed_job_data) || {};
  const company = asRecord(rec.enriched_company_data) || {};
  const v5Company = asRecord(rec.v5_processed_company_data) || {};

  const homepage = firstString(company.homepage_uri, v5.company_website, company.website);
  const stockExchange = firstString(company.stock_exchange, v5Company.stock_exchange);
  const stockSymbol = firstString(company.stock_symbol, v5Company.stock_symbol);
  const f500 =
    stockExchange && stockSymbol
      ? `${stockExchange}: ${stockSymbol}`
      : firstString(stockSymbol, stockExchange);

  const industries = asStringList(company.industries).length
    ? asStringList(company.industries)
    : asStringList(v5Company.industries);
  const requirementsSummary = firstString(v5.requirements_summary);
  const roleActivities = asStringList(v5.role_activities);
  const technicalTools = asStringList(v5.technical_tools);
  const certifications = asStringList(v5.licenses_or_certifications);
  const education = extractHiringCafeEducation(v5);
  const benefits = extractHiringCafeBenefits(v5);
  const visaSponsorship = formatHiringCafeVisaSponsorship(v5);

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

  const about = firstString(company.tagline, v5.company_tagline, v5Company.tagline);
  const fromSummary = requirementsSummary
    ? requirementsSummary
        .split(/;|\n|•/)
        .map((s) => s.trim())
        .filter((s) => s.length > 8)
    : [];
  // Prefer summary bullets; when thin, strengthen with structured required degrees.
  const minimumQualifications =
    fromSummary.length >= 2 ? fromSummary : [...fromSummary, ...education.required];
  const preferredQualifications = education.preferred;

  const companyEmployeeCount =
    positiveInt(company.nb_employees) ||
    positiveInt(v5Company.nb_employees) ||
    positiveInt(company.employee_count) ||
    positiveInt(v5Company.employee_count);
  const companyFoundedYear =
    positiveInt(company.year_founded) ||
    positiveInt(v5Company.year_founded) ||
    positiveInt(company.founded_year) ||
    positiveInt(v5Company.founded_year);

  const seniorityLevel = firstString(v5.seniority_level);
  const roleType = firstString(v5.role_type);

  const fields: HiringCafeStructuredFields = {
    jobTitle: firstString(
      info.title,
      info.job_title_raw,
      v5.core_job_title,
      rec.title,
      rec.jobTitle
    ),
    companyName: sanitizeCompanyName(
      firstString(company.name, v5.company_name, v5Company.name, rec.companyName, rec.company)
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
    preferredQualifications,
    benefits,
    certifications,
    sectorIndustry: industries.join(', ') || firstString(v5.company_sector_and_industry),
    f500,
    companyWebsite: homepage
      ? homepage.startsWith('http')
        ? homepage
        : `https://${homepage.replace(/^\/+/, '')}`
      : '',
    jobExperience: yoeFromV5(v5),
    seniorityLevel,
    roleType,
    educationRequirement: education.educationRequirement,
    visaSponsorship,
    ...(companyEmployeeCount > 0 ? { companyEmployeeCount } : {}),
    ...(companyFoundedYear >= 1800 && companyFoundedYear <= new Date().getFullYear() + 1
      ? { companyFoundedYear }
      : {}),
  };

  const yoe = Number(fields.jobExperience || 0);
  if (yoe > 0) {
    fields._jobExperience = yoe;
  }

  return fields;
}

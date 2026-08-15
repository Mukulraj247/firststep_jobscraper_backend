import * as cheerio from 'cheerio';

export const MAX_PARSE_BYTES = parseInt(process.env.MAX_PARSE_BYTES || String(1.5 * 1024 * 1024), 10);
export const DESCRIPTION_SNIPPET_LEN = 280;

const PORTAL_COMPANY_RE =
  /^(careers?|jobs?|hiring|job\s*board|greenhouse|lever|workday|icims|taleo|smartrecruiters|jobvite|bamboohr|successfactors|workable|ashby|linkedin|indeed|glassdoor|search\s+results?|search\s+for|amazon\.jobs)$/i;

/** Portal / ATS chrome mistaken for employer names (e.g. "JPMC Candidate Experience page"). */
const BAD_COMPANY_RE =
  /candidate\s*experience|careers?\s*page|career\s*site|job\s*(?:board|portal|search|listing|opportunit)|hiring\s*portal|talent\s*(?:community|network)|welcome\s*to\s*our|workday|greenhouse|lever\.co|myworkdayjobs|smartrecruiters|successfactors|icims|taleo|oraclecloud|^jobs?\s+at\b|^\s*careers?\s*$|^\s*search\s+results?\s*$|^\s*search\s+for\s*$|amazon\.jobs/i;

const BOT_WALL_RE = /cf-challenge|captcha|just a moment|attention required|access denied|bot.?detection/i;

const JOB_DESC_SIGNAL_RE =
  /responsibilit|requirement|qualification|about\s+(?:the\s+)?(?:role|job|position)|what\s+you.?ll|you\s+will|we\s+(?:are\s+)?looking|benefits|experience\s+(?:required|preferred)|job\s+description|key\s+duties|who\s+you\s+are/i;

/** Stronger JD language — used to keep short-but-real metas from being treated as SPA shells. */
const STRONG_JD_SIGNAL_RE =
  /responsibilit|requirements?|qualifications?|minimum qualifications?|preferred qualifications?|you will\b|what you.?ll\b|job description|key duties|we are looking|experience (?:required|preferred)/i;

/**
 * Role-section language that establishes the text is an actual posting rather than
 * shared navigation or a legal footer. Intentionally excludes weaker phrases such
 * as "benefits" and "you will", which can also appear in search-page chrome.
 */
const ROLE_BODY_SIGNAL_RE =
  /responsibilit|requirements?|qualifications?|minimum qualifications?|preferred qualifications?|about\s+(?:the\s+)?(?:role|job|position)|what you.?ll do|job description|key duties|we are looking/i;

/**
 * og:description / social teasers from JS career SPAs (Apple, etc.).
 * These look “valid” to length checks but contain no real JD — without rejecting them,
 * scrape.do stays on tier 1 (no render) and never loads the actual posting.
 */
const ROLE_TEASER_RE =
  /apply for (?:a|an|the)\s+[\s\S]{5,200}?\s+(?:job|role|position|opening)\s+at\b/i;
const ROLE_TEASER_CTA_RE =
  /(?:read about|learn more about)\s+(?:the|this)\s+role\b[\s\S]{0,60}(?:find out|see if|right for you)/i;

const NAV_CHROME_RE =
  /home\s*>|former\s+former|explore\s+explore|cookie\s+policy|privacy\s+policy|all\s+rights\s+reserved|terms\s+(?:of\s+)?(?:use|service)|skip\s+to\s+(?:main\s+)?content|accept\s+(?:all\s+)?cookies|sign\s+in\s+create\s+account|keyword\(s\)|radius\s+unit|\bradius\s+\d+|search\s+(?:carrier\s+)?jobs\b|search\s+jobs\s+search\s+jobs|select\s+(?:a\s+)?(?:category|location|communications|job\s+category)|browse\s+available\s+job\s+openings/i;

/** Shared employer marketing block mistaken for a role-specific JD (Toyota, etc.). */
const MARKETING_OVERVIEW_RE =
  /overview\s+who\s+we\s+are\s+collaborative\.?\s*respectful|a\s+place\s+to\s+dream\s+and\s+do/i;

const GENERIC_JOB_TITLE_RE =
  /^(?:working\s+at\b.*|careers?\s+at\b.*|search\s+our\s+job\s+opportunities\b.*|saved\s+jobs|candidate\s+hub|inclusion|carrier\s+events|the\s+carrier\s+way|jobs?\s+at\b.*|general\s+privacy\s+notice\b.*|privacy[- ]?notice\b.*|job\s+details?|untitled(?:\s+role)?|careers?|google\s+careers?|apply\s+now|service\s+technicians|viessmann\s+climate\s+solutions|building\s+a\s+world\s+of\s+opportunity|browse\s+available\s+job\s+openings.*)$/i;

export interface ParsedJobFields {
  jobTitle: string;
  companyName: string;
  jobDescription: string;
  location: string;
  salaryRange: string;
  employmentType: string;
  remoteType: string;
  date: string;
  applyUrl: string;
  companyLogoUrl: string;
  jobCategory: string;
  source: 'jsonld' | 'meta' | 'html' | 'none';
  /** Minimum years inferred from a structured ATS field. */
  _jobExperience?: number;
}

const emptyFields = (): ParsedJobFields => ({
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
  source: 'none',
});

export function truncateForParse(html: string, maxBytes = MAX_PARSE_BYTES): string {
  if (!html) return '';
  if (Buffer.byteLength(html, 'utf8') <= maxBytes) return html;
  return Buffer.from(html, 'utf8').subarray(0, maxBytes).toString('utf8');
}

/** Decode common HTML entities and numeric refs for titles/descriptions. */
export function decodeHtmlEntities(text: string, opts?: { collapseWhitespace?: boolean }): string {
  let out = String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      try {
        return String.fromCodePoint(parseInt(hex, 16));
      } catch {
        return '';
      }
    })
    .replace(/&#(\d+);/g, (_, num) => {
      try {
        return String.fromCodePoint(parseInt(num, 10));
      } catch {
        return '';
      }
    });
  if (opts?.collapseWhitespace === false) {
    return out.trim();
  }
  return out.replace(/\s+/g, ' ').trim();
}

export function makeDescriptionSnippet(text: string, max = DESCRIPTION_SNIPPET_LEN): string {
  const clean = normalizeJobDescription(text).replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).trim()}…`;
}

/** Infer YOE / employment / remote signals from free-text JD (works across companies). */
export function deriveFieldsFromDescription(text: string): {
  jobExperience: number;
  employmentType: string;
  remoteType: string;
} {
  const raw = normalizeJobDescription(text);
  const head = raw.slice(0, 3500);
  let jobExperience = 0;
  const years = [...head.matchAll(/(\d+)\+?\s*(?:\+|plus\s+)?years?\s+of\s+experience/gi)].map((m) =>
    parseInt(m[1], 10)
  );
  if (years.length) jobExperience = Math.max(...years.filter((n) => n > 0 && n <= 30));

  let employmentType = '';
  if (/\bintern(ship)?\b/i.test(head)) employmentType = 'Internship';
  else if (/\bpart[-\s]?time\b/i.test(head)) employmentType = 'Part-time';
  else if (/\bcontract(or)?\b/i.test(head)) employmentType = 'Contract';
  else if (/\bfull[-\s]?time\b/i.test(head)) employmentType = 'Full-time';

  let remoteType = '';
  if (/\bremote\b/i.test(head.slice(0, 800))) remoteType = 'Remote';
  else if (/\bhybrid\b/i.test(head.slice(0, 800))) remoteType = 'Hybrid';
  else if (/\bonsite|on-site|in-office\b/i.test(head.slice(0, 800))) remoteType = 'Onsite';

  return { jobExperience, employmentType, remoteType };
}

export function isPortalCompanyName(name: string): boolean {
  const t = String(name || '').trim();
  if (!t) return true;
  if (PORTAL_COMPANY_RE.test(t)) return true;
  if (BAD_COMPANY_RE.test(t)) return true;
  if (t.length > 80) return true;
  return false;
}

export function sanitizeCompanyName(name: string): string {
  const t = decodeHtmlEntities(String(name || ''));
  if (!t || isPortalCompanyName(t)) return '';
  return canonicalizeCompanyName(t);
}

/**
 * Collapse known aliases so the board shows one employer brand
 * (e.g. list scrape "JPMC" vs ATS "JPMorgan Chase").
 */
export function canonicalizeCompanyName(name: string): string {
  const t = decodeHtmlEntities(String(name || '')).trim();
  if (!t) return '';
  const key = t.toLowerCase().replace(/[.\s_-]+/g, ' ').trim();
  if (
    key === 'jpmc' ||
    key === 'jp morgan' ||
    key === 'j p morgan' ||
    key === 'jpmorgan' ||
    key === 'jpmorgan chase' ||
    key === 'jp morgan chase' ||
    key === 'j.p. morgan' ||
    key === 'j.p. morgan chase'
  ) {
    return 'JPMorgan Chase';
  }
  if (key === 'metacareers' || key === 'meta careers' || key === 'facebook') return 'Meta';
  if (key === 'stripe') return 'Stripe';
  if (key === 'ibm' || key === 'ibm corporation' || key === 'international business machines') {
    return 'IBM';
  }
  if (key === 'sia partners' || key === 'siapartners' || key === 'sia-partners') return 'Sia Partners';
  if (
    key === 'carrier' ||
    key === 'carrierjobs' ||
    key === 'carrier jobs' ||
    key === 'carrier home' ||
    key === 'carrier (home)' ||
    key === 'carrier corporate' ||
    key === 'c01 carrier corporation' ||
    key === 'carrier corporation' ||
    key === 'carrier global' ||
    key === 'carrier global corporation'
  ) {
    return 'Carrier';
  }
  if (key === 'ford' || key === 'ford motor' || key === 'ford motor company') return 'Ford';
  if (
    key === 'toyota' ||
    key === 'toyota motor' ||
    key === 'toyota motor corporation' ||
    key === 'toyota motor north america' ||
    key === 'tmna'
  ) {
    return 'Toyota';
  }
  return t;
}

/** Marketing / hub titles that must never be shown as job titles. */
export function isGenericJobTitle(title: string): boolean {
  const t = decodeHtmlEntities(String(title || '')).trim();
  if (!t) return true;
  if (t.length < 3) return true;
  return GENERIC_JOB_TITLE_RE.test(t);
}

const PHENOM_HOST_RE = /(?:^|\.)(?:careers\.ford\.com|jobs\.carrier\.com|careers\.toyota\.com)$/i;

/** True for Ford/Carrier Phenom detail URLs and Toyota `/job/{id}/{slug}` URLs. */
export function isCareersJobDetailUrl(url: string): boolean {
  try {
    const u = new URL(String(url || '').trim());
    const host = u.hostname.replace(/^www\./i, '');
    if (!PHENOM_HOST_RE.test(host)) return false;
    const path = u.pathname;
    // Ford / Carrier: /job/{loc}/{slug}/{orgId}/{jobSeqNo} (optional locale prefix)
    if (/\/(?:[a-z]{2}\/)?job\/[^/]+\/[^/]+\/\d+\/\d+\/?$/i.test(path)) return true;
    // Toyota: /…/job/{numericId}/{Title-Slug}
    if (/\/job\/\d+\/[^/]+\/?$/i.test(path)) return true;
    return false;
  } catch {
    return false;
  }
}

export function isKnownPhenomCareersHost(url: string): boolean {
  try {
    const host = new URL(String(url || '').trim()).hostname.replace(/^www\./i, '');
    return PHENOM_HOST_RE.test(host);
  } catch {
    return /(?:careers\.ford\.com|jobs\.carrier\.com|careers\.toyota\.com)/i.test(String(url || ''));
  }
}

function humanizeJobSlug(slug: string): string {
  return String(slug || '')
    .split('-')
    .filter(Boolean)
    .map((w) => {
      if (/^\d+$/.test(w)) return w;
      if (w.length <= 2) return w.toUpperCase();
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

/** Recover a display title from Ford/Carrier/Toyota/Stripe-style job URL slugs. */
export function titleFromJobUrl(url: string): string {
  try {
    const path = new URL(String(url || '').trim()).pathname;
    const phenom = path.match(/\/job\/[^/]+\/([^/]+)\/\d+\/\d+\/?$/i);
    if (phenom?.[1]) return humanizeJobSlug(phenom[1]);
    const toyota = path.match(/\/job\/\d+\/([^/]+)\/?$/i);
    if (toyota?.[1]) return humanizeJobSlug(toyota[1]);
    const google = path.match(/\/jobs\/results\/\d+-([^/?#]+)/i);
    if (google?.[1]) return humanizeJobSlug(google[1]);
    // stripe.com/careers/listing/{slug}/{id} (and similar Greenhouse vanity paths)
    const listing = path.match(/\/(?:careers|jobs)\/listing\/([^/]+)\/\d+\/?$/i);
    if (listing?.[1]) return humanizeJobSlug(listing[1]);
    return '';
  } catch {
    return '';
  }
}

/**
 * Prefer the URL slug title when the scraped/list title is marketing chrome
 * or does not share meaningful tokens with the job URL slug (common on Phenom SPAs).
 */
export function preferJobUrlTitle(title: string, jobUrl: string): string {
  const cleaned = decodeHtmlEntities(String(title || '')).trim();
  const fromUrl = titleFromJobUrl(jobUrl);
  if (!fromUrl) return cleaned;
  if (!cleaned || isGenericJobTitle(cleaned)) return fromUrl;

  const slugWords = fromUrl
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2 && !/^(and|the|for|with|from)$/i.test(w));
  if (!slugWords.length) return cleaned;
  const t = cleaned.toLowerCase();
  const hits = slugWords.filter((w) => t.includes(w)).length;
  if (hits < Math.min(2, slugWords.length)) return fromUrl;
  return cleaned;
}

export function looksLikeBotWall(html: string): boolean {
  if (!html) return true;
  const sample = html.slice(0, 8000);
  return BOT_WALL_RE.test(sample);
}

/**
 * Site chrome / shared marketing copy mistaken for a job description.
 * This is why many cards showed the same wall of nav text.
 */
export function isJunkDescription(text: string): boolean {
  const raw = normalizeJobDescription(text);
  if (!raw) return true;
  if (raw.length < 40) return true;

  const hasRoleBodySignal = ROLE_BODY_SIGNAL_RE.test(raw);

  // Nav/search chrome — real Greenhouse/ATS JDs often append "Privacy Policy" or
  // "Terms of Use" in a legal footer. Keep only documents with actual role sections.
  if (NAV_CHROME_RE.test(raw) && !hasRoleBodySignal) return true;

  // SPA/social teaser copy — not a job description (any employer, not Apple-specific).
  if (ROLE_TEASER_RE.test(raw) || ROLE_TEASER_CTA_RE.test(raw)) return true;

  // Short meta/shell blurbs with no real JD language → force harder scrape tier.
  if (raw.length < 280 && !STRONG_JD_SIGNAL_RE.test(raw)) return true;

  // Employer "Overview / Who we are" marketing with no role-specific JD signals.
  if (MARKETING_OVERVIEW_RE.test(raw) && !JOB_DESC_SIGNAL_RE.test(raw)) return true;
  if (MARKETING_OVERVIEW_RE.test(raw) && raw.length < 900 && !/\bresponsibilit|\bqualifications?\b|\brequirements?\b/i.test(raw)) {
    return true;
  }

  const words = raw.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length > 80) {
    const unique = new Set(words);
    if (unique.size / words.length < 0.28) return true;
  }

  const formerCount = (raw.match(/\bformer\b/gi) || []).length;
  if (formerCount >= 4) return true;

  const exploreCount = (raw.match(/\bexplore\b/gi) || []).length;
  if (exploreCount >= 5 && !JOB_DESC_SIGNAL_RE.test(raw)) return true;

  // Mostly nav-ish short tokens without job language
  if (raw.length > 1200 && !JOB_DESC_SIGNAL_RE.test(raw)) {
    const linkish = (raw.match(/\b(?:home|about|careers|contact|blog|news|login|apply now)\b/gi) || [])
      .length;
    if (linkish >= 8) return true;
  }

  return false;
}

/** Board/API visibility: reject obvious non-jobs and chrome-filled rows. */
export function isBoardQualityPass(opts: {
  title?: string;
  description?: string;
  jobUrl?: string;
}): boolean {
  const title = String(opts.title || '').trim();
  const description = String(opts.description || '').trim();
  const jobUrl = String(opts.jobUrl || '').trim();

  if (jobUrl && isKnownPhenomCareersHost(jobUrl) && !isCareersJobDetailUrl(jobUrl)) {
    return false;
  }

  const effectiveTitle =
    title && !isGenericJobTitle(title) ? title : titleFromJobUrl(jobUrl) || title;
  if (!effectiveTitle || isGenericJobTitle(effectiveTitle)) return false;

  if (!description || isJunkDescription(description)) return false;
  return true;
}

/** Higher is better. Prefer real JD language over long chrome. */
export function descriptionQualityScore(text: string): number {
  const raw = normalizeJobDescription(text);
  if (!raw || isJunkDescription(raw)) return 0;
  let score = Math.min(raw.length, 4000) / 40; // length helps but capped
  if (JOB_DESC_SIGNAL_RE.test(raw)) score += 40;
  if (/\n/.test(raw) || /•|\*|-\s+\w/.test(raw)) score += 10;
  if (raw.length > 8000) score -= 20; // suspiciously huge body dumps
  return score;
}

export function pickBestDescription(primary: string, fallback: string): string {
  const a = normalizeJobDescription(primary);
  const b = normalizeJobDescription(fallback);
  const sa = descriptionQualityScore(a);
  const sb = descriptionQualityScore(b);
  if (sa === 0 && sb === 0) {
    // Prefer shorter non-empty over massive chrome
    if (!a) return b;
    if (!b) return a;
    return a.length <= b.length ? a : b;
  }
  if (sa >= sb) return a;
  return b;
}

export function stripHtmlTags(html: string): string {
  return decodeHtmlEntities(
    String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      // Headings → standalone lines so UI sectionizer can detect them
      .replace(/<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi, (_m, _tag, inner) => `\n\n${String(inner).replace(/<[^>]+>/g, '').trim()}\n\n`)
      .replace(/<(h[1-6])[^>]*>/gi, '\n\n')
      .replace(/<\/(h[1-6])>/gi, '\n\n')
      // Lone bold/strong one-liners often used as section titles
      .replace(/<(strong|b)\b[^>]*>\s*([^<]{3,72})\s*<\/\1>/gi, (_m, _tag, inner) => {
        const t = String(inner).trim();
        if (/[.!?]$/.test(t) || t.includes('\n')) return t;
        return `\n\n${t}\n`;
      })
      .replace(/<\/(p|div|li|tr|section|article)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, ' '),
    { collapseWhitespace: false }
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** True when a string still contains markup that should not be shown raw in the UI. */
export function looksLikeHtml(text: string): boolean {
  return /<\/?[a-z][\s\S]*?>/i.test(String(text || ''));
}

/** Always return plain readable text for board storage / display. */
export function normalizeJobDescription(text: string): string {
  const raw = String(text || '');
  if (!raw.trim()) return '';
  return looksLikeHtml(raw) ? stripHtmlTags(raw) : decodeHtmlEntities(raw).trim();
}

/**
 * Strip chrome and convert HTML to plain text for LLM input.
 * Drops script/style/nav/footer noise, keeps block newlines, caps length.
 */
export function htmlToPlainText(html: string, maxChars?: number): string {
  const cap = maxChars ?? parseInt(process.env.GEMINI_MAX_INPUT_CHARS || '60000', 10);
  const raw = String(html || '');
  if (!raw.trim()) return '';

  let text = '';
  try {
    const $ = cheerio.load(raw);
    $('script, style, noscript, svg, header, footer, nav, iframe, link, meta').remove();
    $('br').replaceWith('\n');
    $('li').each((_, el) => {
      const $el = $(el);
      const inner = $el.text().trim();
      if (inner) $el.replaceWith(`\n• ${inner}`);
    });
    $('p, div, section, article, h1, h2, h3, h4, h5, h6, tr').each((_, el) => {
      const $el = $(el);
      // Only inject newlines around leaf-ish block nodes to avoid explosion
      if ($el.children().length === 0 || $el.is('h1,h2,h3,h4,h5,h6')) {
        const t = $el.text().trim();
        if (t) $el.replaceWith(`\n\n${t}\n\n`);
      }
    });
    text = $.root().text();
  } catch {
    text = stripHtmlTags(raw);
  }

  text = decodeHtmlEntities(text, { collapseWhitespace: false })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  if (cap > 0 && text.length > cap) {
    return `${text.slice(0, cap).trim()}…`;
  }
  return text;
}

function getCurrencySymbol(currency: string): string {
  const symbols: Record<string, string> = {
    USD: '$',
    EUR: '€',
    GBP: '£',
    INR: '₹',
    JPY: '¥',
    CAD: 'CA$',
    AUD: 'A$',
  };
  return symbols[currency.toUpperCase()] || `${currency.toUpperCase()} `;
}

function normalizeEmploymentType(type: unknown): string {
  const raw = Array.isArray(type) ? type.join(',') : String(type || '');
  const map: Record<string, string> = {
    FULL_TIME: 'Full-time',
    PART_TIME: 'Part-time',
    CONTRACTOR: 'Contract',
    TEMPORARY: 'Temporary',
    INTERN: 'Internship',
    INTERNSHIP: 'Internship',
    VOLUNTEER: 'Volunteer',
    OTHER: 'Other',
  };
  const key = raw.replace(/[-\s]+/g, '_').toUpperCase();
  return map[key] || raw.replace(/_/g, ' ').trim();
}

function formatSalary(baseSalary: any): string {
  if (!baseSalary || !baseSalary.value) return '';
  const { currency, value } = baseSalary;
  const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(0)}K` : String(n));
  let amount = '';
  if (value.minValue != null && value.maxValue != null) amount = `${fmt(value.minValue)}-${fmt(value.maxValue)}`;
  else if (value.minValue != null) amount = `${fmt(value.minValue)}+`;
  else if (value.maxValue != null) amount = `up to ${fmt(value.maxValue)}`;
  else if (value.value != null) amount = fmt(value.value);
  if (!amount) return '';
  const unit = String(value.unitText || 'YEAR').toLowerCase();
  return `${getCurrencySymbol(currency || 'USD')}${amount} / ${unit}`;
}

const MONEY_RE = String.raw`[$€£₹]\s*[\d,]+(?:\.\d{1,2})?`;
const RANGE_RE = new RegExp(
  `(${MONEY_RE})\\s*(?:-|–|—|to)\\s*(${MONEY_RE})`,
  'gi'
);
const SINGLE_MONEY_RE = new RegExp(`(${MONEY_RE})(?:\\s*(?:per\\s+)?(year|yr|annum|hour|hr|month|mo))?`, 'i');

function cleanMoneyToken(raw: string): string {
  return raw
    .replace(/\s+/g, '')
    .replace(/([$€£₹])\s*/, '$1')
    .replace(/\.0+$/, '')
    .replace(/(\.\d*?)0+$/, (_, frac: string) => (frac === '.' ? '' : frac.replace(/0+$/, '') || ''))
    .replace(/\.$/, '');
}

function formatCompactRange(minRaw: string, maxRaw: string): string {
  return `${cleanMoneyToken(minRaw)} – ${cleanMoneyToken(maxRaw)}`;
}

function locationPrefersPremiumBand(location: string): boolean {
  const loc = location.toLowerCase();
  return (
    /\bnew\s*york\b|\bnyc\b|\bmanhattan\b/.test(loc) ||
    /\bcalifornia\b|\bsan\s+francisco\b|\bsf\b|\blos\s+angeles\b|\bsacramento\b/.test(loc) ||
    /\bseattle\b|\bwashington\b/.test(loc) ||
    /(^|,\s*|\s)(ca|wa)(,|\s|$)/i.test(location)
  );
}

/**
 * Collapse free-text / multi-geo salary prose into a short chip value.
 * Prefer a $min – $max range; optionally pick a premium-geo band when location hints NYC/CA/WA.
 */
export function normalizeSalaryRange(
  raw: unknown,
  opts?: { location?: string }
): string {
  if (raw == null) return '';
  const input = String(raw).trim();
  if (!input) return '';

  const ranges: Array<{ min: string; max: string; index: number; context: string }> = [];
  RANGE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = RANGE_RE.exec(input)) !== null) {
    const start = Math.max(0, match.index - 80);
    ranges.push({
      min: match[1]!,
      max: match[2]!,
      index: match.index,
      context: input.slice(start, match.index + match[0].length).toLowerCase(),
    });
  }

  if (ranges.length > 0) {
    const preferPremium = locationPrefersPremiumBand(opts?.location || '');
    let chosen = ranges[0]!;
    if (preferPremium && ranges.length > 1) {
      const premium = ranges.find((r) =>
        /new\s*york|nyc|california|washington|metro|excluding\s+sacramento/.test(r.context)
      );
      if (premium) chosen = premium;
    }
    return formatCompactRange(chosen.min, chosen.max);
  }

  const single = input.match(SINGLE_MONEY_RE);
  if (single) {
    const amount = cleanMoneyToken(single[1]!);
    const unit = (single[2] || '').toLowerCase();
    if (unit.startsWith('year') || unit === 'yr' || unit === 'annum') return `${amount} / year`;
    if (unit.startsWith('hour') || unit === 'hr') return `${amount} / hour`;
    if (unit.startsWith('month') || unit === 'mo') return `${amount} / month`;
    // Already short enough — keep as-is after money cleanup
    if (input.length <= 32) return amount;
    return amount;
  }

  // No parseable money — drop long prose rather than showing a wall of text
  return input.length <= 40 ? input : '';
}

const US_STATE_ABBR = new Set(
  'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'
    .split(' ')
);

const US_STATE_NAMES: Record<string, string> = {
  alabama: 'AL',
  alaska: 'AK',
  arizona: 'AZ',
  arkansas: 'AR',
  california: 'CA',
  colorado: 'CO',
  connecticut: 'CT',
  delaware: 'DE',
  florida: 'FL',
  georgia: 'GA',
  hawaii: 'HI',
  idaho: 'ID',
  illinois: 'IL',
  indiana: 'IN',
  iowa: 'IA',
  kansas: 'KS',
  kentucky: 'KY',
  louisiana: 'LA',
  maine: 'ME',
  maryland: 'MD',
  massachusetts: 'MA',
  michigan: 'MI',
  minnesota: 'MN',
  mississippi: 'MS',
  missouri: 'MO',
  montana: 'MT',
  nebraska: 'NE',
  nevada: 'NV',
  'new hampshire': 'NH',
  'new jersey': 'NJ',
  'new mexico': 'NM',
  'new york': 'NY',
  'north carolina': 'NC',
  'north dakota': 'ND',
  ohio: 'OH',
  oklahoma: 'OK',
  oregon: 'OR',
  pennsylvania: 'PA',
  'rhode island': 'RI',
  'south carolina': 'SC',
  'south dakota': 'SD',
  tennessee: 'TN',
  texas: 'TX',
  utah: 'UT',
  vermont: 'VT',
  virginia: 'VA',
  washington: 'WA',
  'west virginia': 'WV',
  wisconsin: 'WI',
  wyoming: 'WY',
  'district of columbia': 'DC',
};

const STREET_TOKEN_RE =
  /\b(?:avenue|ave|street|st\.?|road|rd\.?|boulevard|blvd|drive|dr\.?|lane|ln\.?|way|parkway|pkwy|highway|hwy|suite|ste\.?|floor|fl\.?)\b/i;

function stripCountrySuffix(value: string): string {
  return value
    .replace(
      /(?:,\s*)?(?:united\s+states(?:\s+of\s+america)?|usa|u\.s\.a\.?|u\.s\.)\s*$/i,
      ''
    )
    .replace(/\s+,/g, ',')
    .replace(/,\s*$/g, '')
    .trim();
}

function extractCityStateFromFacility(raw: string): string | null {
  // "... Oklahoma City, OK, 73127 ..." or "... Oklahoma City, OK 73127 ..."
  const withZip = raw.match(
    /,\s*([A-Za-z][A-Za-z .'-]{1,40}),\s*([A-Z]{2})\s*,?\s*\d{5}(?:-\d{4})?\b/
  );
  if (withZip && US_STATE_ABBR.has(withZip[2]!)) {
    return `${withZip[1]!.trim()}, ${withZip[2]}`;
  }
  // "... City, ST" near end without relying on street context
  const citySt = raw.match(/([A-Za-z][A-Za-z .'-]{1,40}),\s*([A-Z]{2})\b(?![\w-])/);
  if (citySt && US_STATE_ABBR.has(citySt[2]!)) {
    const city = citySt[1]!.trim();
    // Avoid capturing facility prefixes like "CCS-Oklahoma City" when a cleaner later match exists
    if (!/^[A-Z]{2,5}\d*/.test(city) && !STREET_TOKEN_RE.test(city)) {
      return `${city}, ${citySt[2]}`;
    }
  }
  return null;
}

function normalizeOneLocation(raw: string): string {
  let value = decodeHtmlEntities(String(raw || '').trim());
  if (!value) return '';

  // Workday / Phenom site codes: "CAO01: ..."
  value = value.replace(/^[A-Z]{2,6}\d{1,4}\s*:\s*/i, '').trim();

  const looksFacility =
    STREET_TOKEN_RE.test(value) ||
    /\b\d{1,6}\s+[A-Za-z]/.test(value) ||
    /\b\d{5}(?:-\d{4})?\b/.test(value);

  if (looksFacility) {
    const extracted = extractCityStateFromFacility(value);
    if (extracted) return extracted;
  }

  value = stripCountrySuffix(value);

  // "City, State Name" — keep readable full state name (no forced abbreviation)
  const named = value.match(/^(.+?),\s*([A-Za-z][A-Za-z .]+)$/);
  if (named) {
    const city = named[1]!.trim();
    const region = named[2]!.trim();
    if (US_STATE_NAMES[region.toLowerCase()]) {
      return `${city}, ${region}`;
    }
    if (US_STATE_ABBR.has(region.toUpperCase()) && region.length === 2) {
      return `${city}, ${region.toUpperCase()}`;
    }
  }

  // Still too long / still looks like an address dump — last resort extract
  if (value.length > 60 || STREET_TOKEN_RE.test(value)) {
    const extracted = extractCityStateFromFacility(raw);
    if (extracted) return extracted;
  }

  return value;
}

/**
 * Collapse Workday/Phenom facility dumps and noisy multi-site strings into a short location chip.
 */
export function normalizeLocation(raw: unknown): string {
  if (raw == null) return '';
  const input = String(raw).trim();
  if (!input) return '';

  const parts = input
    .split(/\s*\|\s*/)
    .map((p) => normalizeOneLocation(p))
    .filter(Boolean);

  if (parts.length === 0) return '';
  // Dedupe while preserving order
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }
  return unique.join(' · ');
}

function formatLocation(jobLocation: any): string {
  if (!jobLocation) return '';
  const locs = Array.isArray(jobLocation) ? jobLocation : [jobLocation];
  const parts: string[] = [];
  for (const loc of locs) {
    const addr = loc?.address || loc;
    if (!addr || typeof addr !== 'object') continue;
    const chunk = [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean).join(', ');
    if (chunk) parts.push(chunk);
  }
  return normalizeLocation(parts.join(' | '));
}

function absolutizeUrl(maybeUrl: string, pageUrl?: string): string {
  const raw = String(maybeUrl || '').trim();
  if (!raw || raw.startsWith('data:')) return '';
  try {
    if (/^https?:\/\//i.test(raw)) return raw.split('?')[0];
    if (pageUrl) return new URL(raw, pageUrl).toString().split('?')[0];
  } catch {
    return '';
  }
  return '';
}

function logoFromOrg(org: any, pageUrl?: string): string {
  if (!org) return '';
  const logo = org.logo;
  if (typeof logo === 'string') return absolutizeUrl(logo, pageUrl);
  if (logo && typeof logo === 'object') {
    return absolutizeUrl(logo.url || logo.contentUrl || '', pageUrl);
  }
  return '';
}

function collectJobPostings(node: any, out: any[]): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) collectJobPostings(item, out);
    return;
  }
  if (typeof node !== 'object') return;
  const type = node['@type'];
  const types = Array.isArray(type) ? type : [type];
  if (types.includes('JobPosting')) out.push(node);
  if (Array.isArray(node['@graph'])) collectJobPostings(node['@graph'], out);
  if (Array.isArray(node.itemListElement)) {
    for (const el of node.itemListElement) {
      collectJobPostings(el?.item || el, out);
    }
  }
}

/** Extract JSON-LD script bodies without building a DOM. */
export function extractJsonLdBlocks(html: string): string[] {
  const blocks: string[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const body = (match[1] || '').trim();
    if (body) blocks.push(body);
    if (blocks.length >= 20) break;
  }
  return blocks;
}

export function parseJsonLdJobPosting(html: string, pageUrl?: string): ParsedJobFields | null {
  const blocks = extractJsonLdBlocks(html);
  const postings: any[] = [];
  for (const block of blocks) {
    try {
      collectJobPostings(JSON.parse(block), postings);
    } catch {
      // malformed JSON-LD — skip
    }
  }
  if (postings.length === 0) return null;
  const job = postings[0];
  const companyRaw = String(job.hiringOrganization?.name || '').trim();
  const fields = emptyFields();
  fields.source = 'jsonld';
  fields.jobTitle = decodeHtmlEntities(String(job.title || ''));
  fields.companyName = sanitizeCompanyName(companyRaw);
  fields.jobDescription = stripHtmlTags(job.description || '');
  if (isJunkDescription(fields.jobDescription)) fields.jobDescription = '';
  fields.location = formatLocation(job.jobLocation);
  fields.salaryRange = formatSalary(job.baseSalary);
  fields.employmentType = normalizeEmploymentType(job.employmentType);
  if (job.jobLocationType === 'TELECOMMUTE' || job.jobLocationType === 'REMOTE') {
    fields.remoteType = 'Remote';
  }
  fields.date = String(job.datePosted || '').trim();
  fields.applyUrl = String(job.url || job.applyUrl || job.applicationUrl || '').trim();
  fields.companyLogoUrl = logoFromOrg(job.hiringOrganization, pageUrl);
  return fields;
}

function metaContent(html: string, propertyOrName: string): string {
  const propRe = new RegExp(
    `<meta[^>]*(?:property|name)=["']${propertyOrName}["'][^>]*content=["']([^"']*)["'][^>]*>`,
    'i'
  );
  const contentFirst = new RegExp(
    `<meta[^>]*content=["']([^"']*)["'][^>]*(?:property|name)=["']${propertyOrName}["'][^>]*>`,
    'i'
  );
  const a = html.match(propRe);
  if (a?.[1]) return decodeHtmlEntities(a[1]);
  const b = html.match(contentFirst);
  return b?.[1] ? decodeHtmlEntities(b[1]) : '';
}

export function parseMetaTags(html: string, pageUrl?: string): ParsedJobFields | null {
  const headEnd = html.toLowerCase().indexOf('</head>');
  const head = headEnd > 0 ? html.slice(0, headEnd + 7) : html.slice(0, 120_000);
  const title = metaContent(head, 'og:title') || metaContent(head, 'twitter:title');
  const description =
    metaContent(head, 'og:description') ||
    metaContent(head, 'twitter:description') ||
    metaContent(head, 'description');
  const company = metaContent(head, 'og:site_name') || metaContent(head, 'author');
  if (!title && !description) return null;
  const fields = emptyFields();
  fields.source = 'meta';
  fields.jobTitle = title;
  fields.companyName = sanitizeCompanyName(company);
  fields.jobDescription = isJunkDescription(description) ? '' : description;
  fields.date = metaContent(head, 'article:published_time') || metaContent(head, 'date');
  fields.applyUrl = metaContent(head, 'og:url');
  // Prefer icon over og:image (og:image is often a social card, not a logo)
  const icon =
    head.match(/<link[^>]*rel=["'](?:apple-touch-icon|icon|shortcut icon)["'][^>]*href=["']([^"']+)["']/i)?.[1] ||
    head.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["'](?:apple-touch-icon|icon|shortcut icon)["']/i)?.[1] ||
    '';
  fields.companyLogoUrl = absolutizeUrl(icon, pageUrl);
  return fields;
}

const DESC_SELECTORS = [
  '[itemprop="description"]',
  '.job-description',
  '#job-description',
  '.jobDescription',
  '.job_description',
  '.description__text',
  '.posting-description',
  '.opening-description',
  '[data-testid="jobDescription"]',
  'article .content',
  'main article',
  'main',
  'article',
  '[role="main"]',
].join(', ');

export function parseHtmlHeuristics(html: string, pageUrl?: string): ParsedJobFields {
  const slice = truncateForParse(html, Math.min(MAX_PARSE_BYTES, 500_000));
  const $ = cheerio.load(slice);
  $('script, style, noscript, svg, iframe').remove();
  $('nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"]').remove();
  $('.cookie, .cookies, #cookie, .navbar, .nav-menu, .site-header, .site-footer, .breadcrumb').remove();

  const h1 = decodeHtmlEntities($('h1').first().text());
  const title = decodeHtmlEntities($('title').first().text());

  let bestDesc = '';
  let bestScore = 0;
  $(DESC_SELECTORS).each((_, el) => {
    const text = stripHtmlTags($(el).html() || $(el).text());
    const score = descriptionQualityScore(text);
    if (score > bestScore) {
      bestScore = score;
      bestDesc = text;
    }
  });

  // Do NOT fall back to full body — that produces identical chrome for every URL on a site.
  if (!bestDesc || bestScore === 0) {
    bestDesc = '';
  } else if (bestDesc.length > 12000) {
    bestDesc = bestDesc.slice(0, 12000).trim();
  }

  let company = '';
  try {
    if (pageUrl) {
      const host = new URL(pageUrl).hostname.replace(/^www\./, '');
      if (!/workday|greenhouse|lever|ashbyhq|icims|taleo|smartrecruiters|myworkdayjobs|oraclecloud/i.test(host)) {
        const parts = host.split('.');
        company = parts.length >= 2 ? parts[parts.length - 2] : host;
        company = company.charAt(0).toUpperCase() + company.slice(1);
        if (isPortalCompanyName(company)) company = '';
      }
    }
  } catch {
    // ignore
  }

  let logo = '';
  const logoImg =
    $('img[class*="logo" i], img[alt*="logo" i], .logo img, header img').first().attr('src') ||
    $('link[rel="apple-touch-icon"]').attr('href') ||
    $('link[rel="icon"]').attr('href') ||
    '';
  logo = absolutizeUrl(logoImg, pageUrl);

  const fields = emptyFields();
  fields.source = 'html';
  fields.jobTitle = h1 || title;
  fields.companyName = sanitizeCompanyName(company);
  fields.jobDescription = bestDesc;
  fields.companyLogoUrl = logo;
  return fields;
}

export function mergeParsedFields(
  primary: ParsedJobFields | null,
  fallback: ParsedJobFields | null
): ParsedJobFields {
  const a = primary || emptyFields();
  const b = fallback || emptyFields();
  const pick = (x: string, y: string) => {
    const xt = decodeHtmlEntities(x || '');
    const yt = decodeHtmlEntities(y || '');
    return xt || yt;
  };
  const pickTitle = (x: string, y: string) => {
    const xt = decodeHtmlEntities(x || '');
    const yt = decodeHtmlEntities(y || '');
    if (xt && !isGenericJobTitle(xt)) return xt;
    if (yt && !isGenericJobTitle(yt)) return yt;
    return xt || yt;
  };
  const merged: ParsedJobFields = {
    jobTitle: pickTitle(a.jobTitle, b.jobTitle),
    companyName: sanitizeCompanyName(pick(a.companyName, b.companyName)),
    jobDescription: pickBestDescription(a.jobDescription, b.jobDescription),
    location: normalizeLocation(pick(a.location, b.location)),
    salaryRange: normalizeSalaryRange(pick(a.salaryRange, b.salaryRange), {
      location: normalizeLocation(pick(a.location, b.location)),
    }),
    employmentType: pick(a.employmentType, b.employmentType),
    remoteType: pick(a.remoteType, b.remoteType),
    date: pick(a.date, b.date),
    applyUrl: pick(a.applyUrl, b.applyUrl),
    companyLogoUrl: pick(a.companyLogoUrl, b.companyLogoUrl),
    jobCategory: pick(a.jobCategory, b.jobCategory),
    source: a.source !== 'none' ? a.source : b.source,
  };
  const jobExperience = Math.max(
    Number(a._jobExperience) || 0,
    Number(b._jobExperience) || 0
  );
  if (jobExperience > 0) {
    merged._jobExperience = jobExperience;
  }
  return merged;
}

/**
 * CPU-cheap parse path: JSON-LD (no DOM) → meta (head slice) → cheerio heuristics.
 */
export function parseJobPageHtml(html: string, pageUrl?: string): ParsedJobFields {
  const truncated = truncateForParse(html);
  if (!truncated) return emptyFields();

  const jsonld = parseJsonLdJobPosting(truncated, pageUrl);
  if (
    jsonld?.jobTitle &&
    jsonld.jobDescription &&
    descriptionQualityScore(jsonld.jobDescription) > 0
  ) {
    return jsonld;
  }

  const meta = parseMetaTags(truncated, pageUrl);
  let merged = mergeParsedFields(jsonld, meta);
  if (
    merged.jobTitle &&
    merged.jobDescription &&
    merged.companyName &&
    descriptionQualityScore(merged.jobDescription) > 0
  ) {
    return merged;
  }

  const htmlFields = parseHtmlHeuristics(truncated, pageUrl);
  merged = mergeParsedFields(merged, htmlFields);
  return merged;
}

export function isThinParse(fields: ParsedJobFields, htmlBytes: number): boolean {
  if (htmlBytes < 1500) return true;
  if (!fields.jobTitle && !fields.jobDescription) return true;
  // Chrome walls / teasers score 0 — escalate to JS render (tier 2+) for any host.
  if (fields.jobDescription && descriptionQualityScore(fields.jobDescription) === 0) return true;
  if (fields.jobTitle && isGenericJobTitle(fields.jobTitle)) return true;
  if (!fields.jobDescription && fields.jobTitle) return true;
  if (fields.jobDescription && fields.jobDescription.length < 80 && !fields.jobTitle) return true;
  // Meta-only shells often look “complete” (title + short blurb) but need render.
  if (
    fields.source === 'meta' &&
    (!fields.jobDescription ||
      (fields.jobDescription.length < 400 && !STRONG_JD_SIGNAL_RE.test(fields.jobDescription)))
  ) {
    return true;
  }
  // Any short description without strong JD language is almost certainly a teaser shell.
  if (
    fields.jobDescription &&
    fields.jobDescription.length < 400 &&
    !STRONG_JD_SIGNAL_RE.test(fields.jobDescription)
  ) {
    return true;
  }
  return false;
}

/**
 * Field Auto-Detector - Semantic field classification for list items.
 * Analyzes child elements within list items to infer field types.
 */

import type { FieldConfig, SemanticType } from '../shared/types';
import { findJobPostings, type SchemaJobPosting } from './schemaExtractor';

interface DetectedField {
  selector: string;
  attribute: string;
  semanticType: SemanticType;
  label: string;
  previewValue: string;
  tag: string;
  /** If true, selector IS the value (from JSON-LD schema), not a DOM selector */
  fromSchema?: boolean;
}

// Strict noise patterns — text that NEVER belongs in any semantic field
const NOISE_PATTERNS = [
  /^(be the first to see|sign in|register|view all|see more|show more|read more|learn more|apply now|submit|save job|follow|share|click here|get started|create account|log in|sign up)/i,
  /^(new today|job posting|post a job|contact us|advertise|about|privacy|terms)/i,
  /^(indeed|linkedin|glassdoor|ziprecruiter)\s/i,
  /^(page|prev|next|back|forward)\s/i,
  /^\d+\s*(results?|jobs?)\s*(found|available)?/i,
];

const PRICE_RE = /[$£€¥₹]\s*[\d,.]+(?:k|K)?|\d+[\d,.]*\s*(?:per|a|an)\s*(?:hour|day|month|year|yr)/i;
// US state codes
const US_STATE_CODES = 'DE|NY|TX|CA|FL|IL|PA|OH|GA|NC|MI|NJ|VA|WA|AZ|MA|IN|MO|MD|WI|MN|CO|AL|SC|LA|KY|OR|OK|CT|IA|UT|NV|AR|KS|NM|NE|WV|ID|HI|NH|ME|MT|RI|SD|ND|AK|DC';
// German states
const DE_STATE_CODES = 'DE|BY|NW|SH|HB|NI|RP|BW';
// Indian states
const IN_STATE_CODES = 'KA|DL|MH|TN|TG|AP|WB|GJ|RJ|PB|HR|OR|BR|JH|CH|UT|MZ|ML|MN|TR|NL|SK|GA|AR|PY|AS|DN|DD|LA|LK';
// Other common country/state codes
const OTHER_STATE_CODES = 'ON|BC|AB|MB|QC|NS|NE|NV|HI|AL|RI|MT|DC|VT|SD|ND|WY|UT|OK|KY|WV|NM|AZ|CO|NC|DE|NH|ME|PA|MA|NJ|NY|CT|VA|MD|DC';
// City/State — requires 3+ letter city name
const LOCATION_ONLY_RE = new RegExp(
  `\\b[A-Z][a-z]{2,}(?:\\s+[A-Z][a-z]+)*,\\s*(?:${US_STATE_CODES}|${DE_STATE_CODES}|${IN_STATE_CODES}|${OTHER_STATE_CODES})\\b`,
  'i'
);
// City, State, Country (e.g. "Bengaluru, KA, IND")
const LOCATION_COUNTRY_RE = new RegExp(
  `\\b[A-Z][a-z]{2,}(?:\\s+[A-Z][a-z]+)*,\\s*[A-Z]{2},\\s*(?:IND|USA|GBR|CAN|AUS|DEU|FRA|NLD|BEL|CHE|ESP|ITA|SWE|NOR|POL|AUT|IRL|NZL|SGP|HKG|MYS|THA|VNM|PHL|IDN|ZAF|BRA|MEX|ARG|ARE|SAU|ISR|TUR|NGA|KEN|EGY|PAK|NPL|LKA|BGD|COL|CHL|PER|ECU|CRI|PAN|HND|SLV|GTM|DOM|CUB|JAM|T&T|Prior)[A-Z]{0,2}\\b`,
  'i'
);
const LOCATION_SPACED_RE = new RegExp(
  `\\b[A-Z][a-z]{2,}(?:\\s+[A-Z][a-z]+)*\\s+(?:${US_STATE_CODES}|${DE_STATE_CODES}|${IN_STATE_CODES}|${OTHER_STATE_CODES})\\b`,
  'i'
);
const LOCATION_RE = /Remote|Hybrid|On-?site/i;
// Patterns that look like locations but aren't
const NOT_LOCATION_RE = /\b(salary|pay|rate|range|estimate|reviews?|rating|★|inc\.?|llc|ltd\.?|corp\.?|corp\b|company|co\.?\s*$)\b|^remote\s/i;
// Common tech skills and company acronyms that get falsely matched as locations
const TECH_SKILL_RE = /\b(SAP|CRM|ERP|Salesforce|Workday|ServiceNow|Jira|AWS|Azure|GCP|Docker|Kubernetes|Jenkins|CI\/CD|PowerBI|Tableau|Excel|Word|PowerPoint|MS\s*Office|Office\s*365|O365)\b/i;
const COMPANY_RE = /\b(company|employer|organization|organisation|brand|firm|corp|llc|ltd)\b/i;
const RATING_RE = /\d(?:\.\d)?\s*(?:★|☆|\/|\s+out\s+of\s+\d|\s+stars?)/i;
const DATE_RE = /\b\d+\s+(?:day|week|month|hour|minute|year)s?\s+ago\b|\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b|just posted|posted today|yesterday/i;

function isNoise(text: string): boolean {
  const t = text.trim();
  if (!t || t.length < 2 || t.length > 500) return true;
  return NOISE_PATTERNS.some((re) => re.test(t));
}

function isStableClass(className: string): boolean {
  return !!className &&
    className.length < 40 &&
    !/\d{4,}/.test(className) &&
    !/active|selected|hover|focus|open|close|show|hide|is-/i.test(className) &&
    !/[A-Fa-f0-9]{8,}/.test(className);
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(value);
  // Add ':' to escape set — critical for Tailwind breakpoint classes like xl:z-10, md:grid-cols-2
  return value.replace(/([ #;?%&,.+*~':"!^$[\]()=>|/@^`{}:])/g, '\\$1');
}

function buildSegment(element: Element): string {
  const tag = element.tagName.toLowerCase();

  const stableClasses = Array.from(element.classList)
    .filter(isStableClass)
    .slice(0, 2);

  if (stableClasses.length > 0) {
    return `${tag}.${stableClasses.map(cssEscape).join('.')}`;
  }

  const parent = element.parentElement;
  if (parent) {
    const siblings = Array.from(parent.children).filter((c) => c.tagName === element.tagName);
    if (siblings.length > 1) {
      const index = siblings.indexOf(element) + 1;
      return `${tag}:nth-of-type(${index})`;
    }
  }

  return tag;
}

/**
 * Build a relative CSS selector from element to root (list item).
 * Uses stable classes + nth-of-type as fallback.
 */
function generateRelativeSelector(element: Element, root: Element): string | null {
  if (!root.contains(element) || element === root) return null;

  const segments: string[] = [];
  let current: Element | null = element;

  while (current && current !== root && current.nodeType === Node.ELEMENT_NODE) {
    segments.unshift(buildSegment(current));

    // Check if this selector is already unique within root
    const joined = segments.join(' > ');
    try {
      const matches = root.querySelectorAll(joined);
      if (matches.length === 1) return joined;
    } catch {
      // continue building
    }

    current = current.parentElement;
  }

  // Return the simplest working selector
  if (segments.length > 0) {
    for (let len = Math.min(segments.length, 3); len >= 1; len--) {
      const trySelector = segments.slice(-len).join(' > ');
      try {
        if (root.querySelectorAll(trySelector).length > 0) {
          return trySelector;
        }
      } catch {
        continue;
      }
    }
    return segments.join(' > ');
  }
  return null;
}

function isVisible(element: Element): boolean {
  const el = element as HTMLElement;
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
    return false;
  }
  if (el.getAttribute('aria-hidden') === 'true') return false;
  if (el.getAttribute('role') === 'presentation') return false;
  const className = String(el.className || '').toLowerCase();
  if (/^(hidden|collapsed|template|placeholder|skeleton|shimmer)/i.test(className)) return false;
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}

/**
 * Collect candidate elements from a container.
 * Returns leaf elements AND containers with significant text.
 */
function collectCandidates(container: Element): Element[] {
  const candidates: Element[] = [];
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node) {
        const el = node as Element;
        const tag = el.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'SVG') {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    }
  );

  let node: Node | null;
  while ((node = walker.nextNode())) {
    const el = node as Element;
    const elTag = el.tagName;
    const text = (el.textContent || '').trim();
    const isLeaf = el.children.length === 0;
    const isMeaningful =
      elTag === 'IMG' ||
      elTag === 'A' ||
      elTag === 'TIME' ||
      /^H[1-6]$/.test(elTag) ||
      (text.length > 50 && isLeaf) ||          // long text leaf = description
      (text.length > 10 && isLeaf);             // non-trivial text leaf
    if (isMeaningful && isVisible(el)) {
      candidates.push(el);
    }
  }
  return candidates;
}

/**
 * Escape each segment of a compound CSS selector so it's safe for querySelector.
 * Handles tag.class, tag#id, tag:nth-of-type(N) etc.
 */
function cssEscapeSelector(selector: string): string {
  // Split on class/id/pseudo boundaries, then escape each part
  return selector.split(/(?=[.#:[])/).map((part) => {
    if (part.startsWith('.') || part.startsWith('#')) {
      return part[0] + cssEscape(part.slice(1));
    }
    return part;
  }).join('');
}

/**
 * Generate selector variants that handle Tailwind breakpoint differences across items.
 * Example: "span.line-clamp-3" might be "span.line-clamp-2" in another item.
 */
function generateSelectorVariants(selector: string): string[] {
  const variants: string[] = [];

  // 1. Original — fully escaped
  variants.push(cssEscapeSelector(selector));

  // 2. Strip Tailwind responsive/variant prefixes from class names
  //    e.g. "xl:z-10" → removed, "line-clamp-3" → kept as-is
  const stripped = selector
    .replace(/[\w-]+:[\w:-]+/g, (m) => {
      // Only strip class segments that start with a recognized Tailwind variant prefix
      if (/^(sm|md|lg|xl|2xl|hover|focus|active|group|disabled|first|last|odd|even|before|after|placeholder|visited|required|checked|open|full|min|max)-/.test(m)) {
        return '';
      }
      return m;
    })
    .replace(/\s+/g, ' ')
    .trim();
  if (stripped && stripped !== selector) {
    variants.push(cssEscapeSelector(stripped));
  }

  // 3. Tag + nth-of-type fallback: if selector uses classes, also try tag-only with nth-of-type
  //    This handles cases where same structural position has different classes across items
  const nthMatch = selector.match(/:nth-of-type\(\d+\)/);
  if (nthMatch) {
    const tagMatch = selector.match(/^([a-zA-Z]+)/);
    if (tagMatch) {
      variants.push(tagMatch[1] + nthMatch[0]);
    }
  }

  return [...new Set(variants)];
}

/**
 * Validate that a selector matches consistently across multiple list items.
 * Tries multiple selector variants to handle Tailwind class differences across items.
 */
function validateAcrossItems(items: Element[], selector: string): number {
  if (!selector) return 0;
  let matchCount = 0;
  const variants = generateSelectorVariants(selector);
  for (const item of items) {
    let matched = false;
    for (const variant of variants) {
      try {
        if (item.querySelector(variant)) {
          matched = true;
          break;
        }
      } catch {
        continue;
      }
    }
    if (matched) matchCount++;
  }
  return matchCount / items.length;
}

interface Classification {
  type: SemanticType;
  attribute: string;
  confidence: number;
}

// Common job title keywords — used to DISTINGUISH titles from company names
const JOB_TITLE_KEYWORDS = /\b(engineer|developer|manager|analyst|consultant|specialist|architect|lead|intern|director|head|associate|coordinator|designer|writer|recruiter|administrator|executive|officer|operator|technician|support|staff|specialist|representative|associate|assistant|partner|strategist|auditor|associate|advisor|counsel|engineer|agent|assistant)\b/i;
// Common company name patterns — for excluding company names from titles
const COMPANY_SUFFIX_RE = /\b(inc\.?|llc|ltd\.?|corp\.?|corporation|company|co\.?|group|holdings|partners|solutions|services|technologies|tech|systems|software|consulting|international|global|inc)\b\.?$/i;
// Company-like capitalized patterns that are NOT job titles
const COMPANY_LIKE_RE = /^[A-Z][A-Za-z0-9 &.,'()\-]{4,60}$/;

function classifyElement(element: Element, usedTypes: Set<SemanticType>): Classification | null {
  const tag = element.tagName;
  const text = (element.textContent || '').trim();
  const className = String((element as HTMLElement).className || '').toLowerCase();
  const id = String(element.id || '').toLowerCase();
  const ariaLabel = (element.getAttribute('aria-label') || '').toLowerCase();

  // === Attribute-based classifications (URL, image) ===
  // These must run BEFORE the text-based noise filter because on card-style
  // layouts the whole row is often wrapped in a single <a>, so its textContent
  // is the concatenation of every field in the row (frequently > 500 chars)
  // and would otherwise be rejected as "noise" — losing the href entirely.

  // Image — classified by src, not by visible text
  if (tag === 'IMG' || (element as HTMLElement).style?.backgroundImage) {
    const alt = element.getAttribute('alt') || '';
    const src =
      (element as HTMLImageElement).src ||
      element.getAttribute('src') ||
      element.getAttribute('data-src') || '';
    if (!usedTypes.has('image') && src && !isNoise(alt)) {
      return { type: 'image', attribute: 'src', confidence: 0.9 };
    }
  }

  // Link URL — classified by href, not by visible text
  if (tag === 'A') {
    const href = element.getAttribute('href') || '';
    const hrefTrim = href.trim();
    const isValidHref =
      hrefTrim.length > 1 &&
      !hrefTrim.startsWith('javascript:') &&
      !hrefTrim.startsWith('#') &&
      !hrefTrim.startsWith('mailto:') &&
      !hrefTrim.startsWith('tel:');
    if (isValidHref && !usedTypes.has('url')) {
      return { type: 'url', attribute: 'href', confidence: 0.9 };
    }
  }

  // Reject noise for text-based classifications only
  if (isNoise(text)) return null;
  if (!text || text.length < 2) return null;

  // === TITLE (highest priority for job listings) ===
  // Title should be a heading or a link to the job detail page
  if (!usedTypes.has('title')) {
    const titleScore = getTitleScore(element, text, className, id, ariaLabel);
    if (titleScore > 0.7) {
      return { type: 'title', attribute: 'innerText', confidence: titleScore };
    }
  }

  // === DATE / TIME — must be checked EARLY, before location/company ===
  if (!usedTypes.has('date')) {
    if (tag === 'TIME' || element.hasAttribute('datetime')) {
      return { type: 'date', attribute: 'innerText', confidence: 0.9 };
    }
    // Match "X days ago", "Just posted", date formats
    if (DATE_RE.test(text) && !NOT_LOCATION_RE.test(text) && !isNoise(text)) {
      return { type: 'date', attribute: 'innerText', confidence: 0.85 };
    }
    // Match "today", "yesterday"
    if (/^(today|yesterday)$/i.test(text)) {
      return { type: 'date', attribute: 'innerText', confidence: 0.85 };
    }
  }

  // === SALARY / PRICE ===
  if (!usedTypes.has('price')) {
    const priceHint = /salary|pay|payrate|pay\s*rate|compensation|hourly|annual|gross|net\s*pay/i.test(className + ' ' + id);
    if (priceHint || PRICE_RE.test(text)) {
      return { type: 'price', attribute: 'innerText', confidence: 0.9 };
    }
  }

  // === STAR RATING — strict matching ===
  if (!usedTypes.has('rating')) {
    const starChars = (text.match(/[★☆]+/)?.[0]?.length ?? 0);
    const hasStars = starChars >= 1;
    const ratingClassHint = /rating|stars?|review|scores?/i.test(className);
    const explicitRating = RATING_RE.test(text);
    // Require stars OR both class hint AND explicit number pattern
    if (hasStars && starChars <= 5) {
      return { type: 'rating', attribute: 'innerText', confidence: 0.9 };
    }
    if (ratingClassHint && explicitRating) {
      return { type: 'rating', attribute: 'innerText', confidence: 0.85 };
    }
  }

  // === LOCATION — must be "City, State" or Remote/Hybrid ===
  if (!usedTypes.has('location')) {
    const locationScore = getLocationScore(text, className, id);
    if (locationScore > 0.5) {
      return { type: 'location', attribute: 'innerText', confidence: locationScore };
    }
  }

  // === COMPANY / EMPLOYER NAME ===
  if (!usedTypes.has('company')) {
    const companyScore = getCompanyScore(element, text, className, id, ariaLabel);
    if (companyScore > 0.65) {
      return { type: 'company', attribute: 'innerText', confidence: companyScore };
    }
  }

  // === DESCRIPTION — long text that isn't noise ===
  if (!usedTypes.has('description')) {
    const descScore = getDescriptionScore(element, text, className);
    if (descScore > 0.6) {
      return { type: 'description', attribute: 'innerText', confidence: descScore };
    }
  }

  // === CATEGORY / TAG / BADGE ===
  if (!usedTypes.has('category')) {
    const isCategory = text.length > 0 && text.length < 50 &&
      (/tag|badge|category|label|type/i.test(className) || /^[A-Z][a-z]+$/i.test(text));
    if (isCategory) {
      return { type: 'category', attribute: 'innerText', confidence: 0.6 };
    }
  }

  return null;
}

/**
 * Score how likely an element is a job title.
 * Higher score = more likely to be a title.
 */
function getTitleScore(element: Element, text: string, className: string, id: string, ariaLabel: string): number {
  let score = 0;
  const tag = element.tagName;
  const parent = element.parentElement;

  // Strong positive signals
  if (/^H[1-6]$/.test(tag)) score += 0.4;
  if (/title|job-title|role|position|job_title|jobtitle|heading/i.test(className + ' ' + id + ' ' + ariaLabel)) score += 0.4;
  if (JOB_TITLE_KEYWORDS.test(text)) score += 0.35;
  if (tag === 'A' && element.getAttribute('href')?.includes('job')) score += 0.3;
  if (tag === 'A' && element.closest('[class*="title" i], [class*="job" i]')) score += 0.25;

  // Negative signals — these suggest it's NOT a title
  if (COMPANY_SUFFIX_RE.test(text)) score -= 0.3;
  if (/^remote\s/i.test(text)) score -= 0.4;
  if (NOT_LOCATION_RE.test(text)) score -= 0.3;
  if ((LOCATION_ONLY_RE.test(text) || LOCATION_SPACED_RE.test(text)) && !JOB_TITLE_KEYWORDS.test(text)) score -= 0.5;
  if (DATE_RE.test(text)) score -= 0.4;
  if (PRICE_RE.test(text)) score -= 0.4;
  if (COMPANY_LIKE_RE.test(text) && !JOB_TITLE_KEYWORDS.test(text)) score -= 0.2;

  // Title elements usually have moderate text length
  if (text.length >= 5 && text.length <= 150) score += 0.15;

  // Company names are often ALL CAPS or Title Case without job keywords
  const isAllCaps = text === text.toUpperCase() && text.length > 3;
  if (isAllCaps && !JOB_TITLE_KEYWORDS.test(text)) score -= 0.25;

  // Full job titles tend to be longer and more descriptive — penalize short role names
  const wordCount = text.split(/\s+/).length;
  if (wordCount >= 3) score += 0.15;
  // Titles with parenthetical info (e.g., "Engineer (NY, US)") are strong title signals
  if (/\([^)]{3,}\)/.test(text)) score += 0.25;
  // Short bold text that's just a role/department name (e.g., "Sawyer", "Sales") — penalize
  if (text.length < 15 && !LOCATION_ONLY_RE.test(text) && wordCount < 3) {
    score -= 0.3;
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Score how likely an element is a company name.
 * Higher score = more likely to be a company.
 */
function getCompanyScore(element: Element, text: string, className: string, id: string, ariaLabel: string): number {
  let score = 0;
  const trimmed = text.trim();
  const metaBundle = `${className} ${id} ${ariaLabel}`.toLowerCase();

  // Drupal / mega-menu: class `company-culture`, link text "Culture", href …/culture — not an employer
  if (/\bcompany-culture\b|companyculture|culture-link|menu-item--culture|menu-link--culture/i.test(metaBundle)) {
    return 0.05;
  }
  if (/^(culture|insights)$/i.test(trimmed)) {
    return 0.05;
  }
  if (element.tagName === 'A') {
    const href = ((element as HTMLAnchorElement).getAttribute('href') || '').toLowerCase();
    if (href && /\/culture\b|\/insights\b|life-at|\/join-us\/|careers\/culture/i.test(href)) {
      return 0.05;
    }
  }

  const parent = element.parentElement;
  const grandparent = parent?.parentElement;

  // "CompanyName: Description" pattern — strong signal for job boards (HiringCafe, etc.)
  // Example: "Taos Ski Valley: Operates a mountain resort..."
  const colonMatch = text.match(/^([A-Z][A-Za-z0-9 &.,'()\-]{2,60})\s*:/);
  if (colonMatch) {
    const companyName = colonMatch[1].trim();
    const descAfter = text.slice(text.indexOf(':') + 1).trim();
    if (companyName.length >= 2 && companyName.length <= 60 && descAfter.length > 5) {
      score += 0.7;
    }
  }

  // Company name in bold/strong child element
  if (/bold|700|800|900|font-bold/i.test(className)) {
    const hasBoldChild = Array.from(element.children).some(
      (c) => /bold|700|800|900|font-bold/i.test(c.className || '')
    );
    if (hasBoldChild) {
      // Check if parent/sibling has logo nearby
      const nearLogo =
        parent?.querySelector('img') ||
        parent?.previousElementSibling?.querySelector?.('img') ||
        parent?.nextElementSibling?.querySelector?.('img') ||
        grandparent?.querySelector?.('img');
      if (nearLogo) score += 0.5;
      // Also check if text matches "CompanyName: Description" pattern
      if (colonMatch) score += 0.4;
    }
  }

  // Check for company name in logo alt text (on job boards)
  if (parent) {
    const logoImg = parent.querySelector('img') || parent.previousElementSibling?.querySelector?.('img');
    if (logoImg) {
      const logoAlt = logoImg.getAttribute('alt') || '';
      if (logoAlt && logoAlt.length >= 2 && logoAlt.length <= 60) {
        score += 0.6;
      }
    }
    // Also check grandparent for logo
    const gpLogo = grandparent?.querySelector?.('img');
    if (gpLogo) {
      const alt = gpLogo.getAttribute('alt') || '';
      if (alt && alt.length >= 2 && alt.length <= 60) score += 0.5;
    }
  }

  // Strong positive signals — skip when `company` is only from `company-culture` etc.
  if (
    !/\bcompany-culture\b|companyculture/i.test(metaBundle) &&
    /company|employer|company[- ]?name|employer[- ]?name|brand|author|publisher/i.test(className + ' ' + id + ' ' + ariaLabel)
  ) {
    score += 0.55;
  }

  // Check ancestors for company-related classes (exclude company-culture nav wrappers)
  let ancestor: Element | null = parent;
  for (let depth = 0; depth < 5 && ancestor; depth++) {
    const ancClass = String(ancestor.className || '').toLowerCase();
    if (/\bcompany-culture\b|companyculture|culture-link/i.test(ancClass)) {
      score -= 0.75;
      break;
    }
    if (
      /\b(employer|brand|sponsored|agency|business|client|hiring-organization)\b/i.test(ancClass) ||
      /\bcompany[-_]?(name|card|logo|info)\b/i.test(ancClass) ||
      /\bby[- ]?company\b/i.test(ancClass)
    ) {
      score += 0.4;
      break;
    }
    ancestor = ancestor.parentElement;
  }

  // Check aria-label
  if (/company|employer|brand|by\s/i.test(ariaLabel)) score += 0.45;

  // Adjacent to logo
  const nearLogo =
    parent?.querySelector('img') ||
    parent?.previousElementSibling?.querySelector?.('img') ||
    parent?.nextElementSibling?.querySelector?.('img') ||
    grandparent?.querySelector?.('img');
  if (nearLogo) score += 0.25;

  // Pure capitalized name (not a job title)
  const looksLikeCompany = COMPANY_LIKE_RE.test(text);
  if (looksLikeCompany && !JOB_TITLE_KEYWORDS.test(text)) score += 0.25;

  // Company name length: typically 3-60 chars
  if (text.length >= 3 && text.length <= 60) score += 0.1;

  // Negative signals — these suggest it's NOT a company
  if (JOB_TITLE_KEYWORDS.test(text)) score -= 0.5;
  if (/^H[1-6]$/.test(element.tagName)) score -= 0.3;
  if ((LOCATION_ONLY_RE.test(text) || LOCATION_SPACED_RE.test(text)) && !looksLikeCompany) score -= 0.4;
  if (DATE_RE.test(text)) score -= 0.4;
  if (PRICE_RE.test(text)) score -= 0.4;
  if (text.length > 100) score -= 0.3;

  // Title element with job keywords = definitely NOT a company
  if (/^H[1-6]$/.test(element.tagName) && JOB_TITLE_KEYWORDS.test(text)) score -= 0.6;

  return Math.max(0, Math.min(1, score));
}

/**
 * Score how likely an element is a job description.
 */
function getDescriptionScore(element: Element, text: string, className: string): number {
  let score = 0;
  const tag = element.tagName;

  if (isNoise(text)) return 0;

  // Long text is a strong signal for description
  if (text.length > 100) score += 0.4;
  if (text.length > 200) score += 0.2;
  if (text.length > 400) score += 0.1;

  // Class hints — "qualification" is especially strong for job sites
  if (/desc|summary|snippet|about|detail|overview|requirement|responsibility|qualification|excerpt|content|body/i.test(className)) {
    score += 0.45;
  }

  // Multi-line or bullet-separated text — strong description signal
  const hasBullets = /\n|·|·|\s+•\s+|-\s+|\*\s+/.test(text);
  if (text.includes('\n')) score += 0.25;
  if (text.includes(' · ') || text.includes(' • ')) score += 0.3;
  if (hasBullets) score += 0.35;  // bullets like "· Bachelor's degree"

  // Paragraph-like text (medium length with spaces)
  const wordCount = text.split(/\s+/).length;
  if (wordCount >= 10 && wordCount <= 300) score += 0.15;

  // Description elements are usually not links or headings
  if (!['A', 'H1', 'H2', 'H3'].includes(tag)) score += 0.1;

  // Short text is unlikely to be a description
  if (text.length < 20) return 0;
  if (text.length < 50) score -= 0.15;
  if (text.length < 80) score -= 0.1;

  return Math.max(0, Math.min(1, score));
}

/**
 * Score how likely text is a location.
 * Returns a number between 0 and 1. Threshold: > 0.5 to classify as location.
 */
function getLocationScore(text: string, className: string, id: string): number {
  if (isNoise(text)) return 0;
  if (PRICE_RE.test(text) || DATE_RE.test(text) || RATING_RE.test(text)) return 0;
  if (JOB_TITLE_KEYWORDS.test(text)) return 0;

  let score = 0;
  const hasLocationClass = /location|city|country|region|state|area|address/i.test(className + ' ' + id);
  const hasCityState = LOCATION_ONLY_RE.test(text) || LOCATION_SPACED_RE.test(text);
  const hasCityCountry = LOCATION_COUNTRY_RE.test(text); // "Bengaluru, KA, IND"
  const hasRemote = LOCATION_RE.test(text);

  // Strong positive signals
  if (hasLocationClass && text.length <= 80) score += 0.55;
  if (hasCityState) score += 0.5;
  if (hasCityCountry) score += 0.5;  // "Bengaluru, KA, IND" — city, state, country
  if (hasRemote) score += 0.45;
  if (hasRemote && (hasCityState || hasCityCountry)) score += 0.25;  // "Remote in Bengaluru, KA, IND"

  // === NEGATIVE PENALTIES ===
  // Tech skills like "SAP, MS Office" would match LOCATION_ONLY_RE via "MS"
  // (MS is a state code). Penalize if text contains tech skills.
  if (TECH_SKILL_RE.test(text)) score -= 0.55;

  // Company suffixes
  if (COMPANY_SUFFIX_RE.test(text)) score -= 0.5;

  // Pure capitalized acronyms (2-5 chars ALL CAPS before comma) — "SAP, MS"
  const beforeComma = text.split(',')[0]?.trim() || '';
  if (/^[A-Z]{2,5}$/.test(beforeComma)) score -= 0.45;

  // Looks like company name but not a job title
  if (COMPANY_LIKE_RE.test(text) && !JOB_TITLE_KEYWORDS.test(text) && !hasLocationClass) score -= 0.35;

  // Length checks
  if (text.length > 100) score -= 0.3;
  if (text.length < 3) score -= 0.4;

  return Math.max(0, Math.min(1, score));
}

function getPreviewValue(element: Element, attribute: string): string {
  if (attribute === 'href') return element.getAttribute('href') || '';
  if (attribute === 'src') return element.getAttribute('src') || '';
  if (attribute === 'fixed') return element.textContent?.trim().slice(0, 80) || '';
  return (element.textContent || '').trim().slice(0, 80);
}

/**
 * Auto-detect fields within list items.
 * Analyzes the first few list items to find meaningful child elements.
 */
export function autoDetectFields(
  doc: Document,
  listSelector: string,
  maxItems: number = 3
): DetectedField[] {
  const items = doc.querySelectorAll(listSelector);
  if (items.length === 0) return [];

  const sampleItems = Array.from(items).slice(0, maxItems);
  const firstItem = sampleItems[0];

  // ── STEP 1: DOM heuristics (HIGHEST PRIORITY) ─────────────────────────────
  // DOM detection finds per-item field values (e.g. "National Grid" for each job card).
  // This must run FIRST to correctly detect individual company names, locations, etc.
  const domFields = detectFieldsFromDOM(firstItem, sampleItems);

  // ── STEP 2: Schema.org JSON-LD (fills in missing fields) ──────────────────
  // Schema provides authoritative values but only ONE value per field (page-level).
  // Use it to fill gaps — schema title, location, salary, etc. — when DOM missed them.
  const postings = findJobPostings(doc);
  const schemaFields = postings.length > 0 ? buildFieldsFromSchema(postings[0], doc) : [];
  mergeSchemaFields(domFields, schemaFields);

  // ── STEP 3: Page-level company fallback ─────────────────────────────────────
  // If no company found from DOM or schema, look for it in the page header/meta.
  const hasCompany = domFields.some((f) => f.semanticType === 'company');
  if (!hasCompany) {
    addPageCompanyFallback(doc, domFields);
  }

  // Ensure URL is always present for list rows; many boards wrap cards in links
  // but heuristics can miss it when the anchor text is noisy/long.
  const hasUrl = domFields.some((f) => f.semanticType === 'url');
  if (!hasUrl) {
    addUrlFallback(firstItem, domFields);
  }

  return domFields;
}

function detectFieldsFromDOM(firstItem: Element, sampleItems: Element[]): DetectedField[] {
  const candidates = collectCandidates(firstItem);
  const fields: DetectedField[] = [];
  const usedTypes = new Set<SemanticType>();
  const usedSelectors = new Set<string>();

  for (const candidate of candidates) {
    const classification = classifyElement(candidate, usedTypes);
    if (!classification) continue;

    const candidateSelector = generateRelativeSelector(candidate, firstItem);
    if (!candidateSelector) continue;

    const selectorKey = candidateSelector.replace(/:nth-of-type\(\d+\)/g, '').trim();
    if (usedSelectors.has(selectorKey)) continue;

    const matchRate = validateAcrossItems(sampleItems, candidateSelector);

    // Debug: log rejected fields
    if (matchRate < 0.5) {
      const text = (candidate.textContent || '').trim().slice(0, 40);
      const variants = generateSelectorVariants(candidateSelector);
      console.log(`[Maxun] REJECTED field="${classification.type}" text="${text}" rate=${matchRate.toFixed(2)} selector="${candidateSelector.slice(0, 80)}" variants=${variants.length}`);
    }

    if (matchRate < 0.5) continue;

    console.log(`[Maxun] ACCEPTED field="${classification.type}" text="${(candidate.textContent || '').trim().slice(0, 40)}" rate=${matchRate.toFixed(2)} selector="${candidateSelector.slice(0, 80)}"`);

    usedTypes.add(classification.type);
    usedSelectors.add(selectorKey);

    fields.push({
      selector: candidateSelector,
      attribute: classification.attribute,
      semanticType: classification.type,
      label: classification.type === 'unknown' ? `field_${fields.length + 1}` : classification.type,
      previewValue: getPreviewValue(candidate, classification.attribute),
      tag: candidate.tagName.toLowerCase(),
    });
  }

  return fields;
}

function mergeSchemaFields(domFields: DetectedField[], schemaFields: DetectedField[]): void {
  for (const sf of schemaFields) {
    // NEVER add company from schema — schema company is page-level (e.g. "HiringCafe AI Job Search"),
    // not the per-job employer name (e.g. "National Grid", "AMETEK")
    if (sf.label === 'company' || sf.label === 'companyUrl') continue;

    const existing = domFields.find((f) => f.label === sf.label);
    if (!existing) {
      domFields.push(sf);
    }
    // If DOM already has this field, DO NOT override with schema
  }
}

/**
 * Build field configs from a Schema.org JobPosting object.
 * Uses schema data for semantic types and preview values.
 * DOM selectors for these fields will be empty — the extractor handles
 * schema fields separately via extractSchemaFields().
 */
function buildFieldsFromSchema(job: SchemaJobPosting, doc: Document): DetectedField[] {
  const fields: DetectedField[] = [];
  const addField = (
    schemaField: string,
    semanticType: SemanticType,
    label: string,
    value: string,
    attribute: string = 'innerText'
  ) => {
    if (!value || value.trim().length === 0) return;
    if (fields.some((f) => f.semanticType === semanticType && f.label === label)) return;

    fields.push({
      semanticType,
      label,
      selector: value,
      attribute,
      previewValue: value.slice(0, 80),
      tag: 'schema',
    });
  };

  addField('title', 'title', 'title', job.title);
  addField('hiringOrganization', 'company', 'company', job.hiringOrganization?.name || '');
  addField('companyUrl', 'companyUrl', 'companyUrl', job.hiringOrganization?.sameAs || '', 'href');

  // Location: build from address
  if (job.jobLocation?.address) {
    const addr = job.jobLocation.address;
    const parts: string[] = [];
    if (addr.addressLocality) parts.push(addr.addressLocality);
    if (addr.addressRegion) parts.push(addr.addressRegion);
    if (addr.addressCountry) parts.push(addr.addressCountry);
    addField('jobLocation', 'location', 'location', parts.join(', '));
  }

  // Salary: build from MonetaryAmount
  if (job.baseSalary?.value) {
    const val = job.baseSalary.value;
    const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(0)}K` : n.toString());
    let salary = '';
    const curr = job.baseSalary.currency || '';
    const sym = { USD: '$', EUR: '€', GBP: '£', INR: '₹' }[curr] || `${curr} `;
    if (val.minValue !== undefined && val.maxValue !== undefined) {
      salary = `${sym}${fmt(val.minValue)}-${fmt(val.maxValue)} / ${(val.unitText || 'YEAR').toLowerCase()}`;
    } else if (val.value !== undefined) {
      salary = `${sym}${fmt(val.value)} / ${(val.unitText || 'YEAR').toLowerCase()}`;
    }
    addField('baseSalary', 'price', 'salary', salary);
  }

  addField('employmentType', 'employmentType', 'employmentType', job.employmentType || '');
  addField('description', 'description', 'description', stripSchemaHtml(job.description || ''));
  addField('qualifications', 'qualifications', 'qualifications', stripSchemaHtml(job.qualifications || ''));
  addField('responsibilities', 'responsibilities', 'responsibilities', stripSchemaHtml(job.responsibilities || ''));
  addField('skills', 'skills', 'skills', stripSchemaHtml(job.skills || ''));
  addField('jobBenefits', 'benefits', 'benefits', stripSchemaHtml(job.jobBenefits || ''));
  addField('experienceRequirements', 'experience', 'experience', stripSchemaHtml(job.experienceRequirements || ''));
  addField('educationRequirements', 'education', 'education', stripSchemaHtml(job.educationRequirements || ''));
  addField('industry', 'industry', 'industry', job.industry || '');
  addField('jobLocationType', 'remote', 'remote', job.jobLocationType === 'TELECOMMUTE' || job.jobLocationType === 'REMOTE' ? 'Remote' : '');

  return fields;
}

function stripSchemaHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fallback company detection from page-level metadata.
 * Used when company name isn't present inside individual job cards (e.g., career sites like amazon.jobs).
 * Returns a DOM selector + attribute that the extraction pipeline can handle.
 */
function detectPageCompany(doc: Document): { selector: string; attribute: string } | null {
  // 1. Meta tags — read content directly via JS so we store the actual value
  const metaSiteName = doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim();
  if (metaSiteName && !isNoise(metaSiteName) && metaSiteName.length >= 2 && metaSiteName.length <= 80) {
    // Extract just the company name from "Amazon.jobs" or "Google Careers"
    const clean = cleanCompanyName(metaSiteName);
    if (clean) return { selector: clean, attribute: 'fixed' };
  }

  const metaAppName = doc.querySelector('meta[name="application-name"]')?.getAttribute('content')?.trim();
  if (metaAppName && !isNoise(metaAppName) && metaAppName.length >= 2 && metaAppName.length <= 80) {
    const clean = cleanCompanyName(metaAppName);
    if (clean) return { selector: clean, attribute: 'fixed' };
  }

  // Also check <meta name="author">
  const metaAuthor = doc.querySelector('meta[name="author"]')?.getAttribute('content')?.trim();
  if (metaAuthor && !isNoise(metaAuthor) && metaAuthor.length >= 2 && metaAuthor.length <= 80) {
    const clean = cleanCompanyName(metaAuthor);
    if (clean) return { selector: clean, attribute: 'fixed' };
  }

  // 2. Header logo with text — find the anchor containing the logo
  const logoLink = doc.querySelector(
    'header a[class*="logo" i], [class*="header"] a[class*="logo" i], nav a[class*="logo" i], ' +
    'header a[class*="brand" i], [role="banner"] a, .site-header a[class*="logo" i]'
  );
  if (logoLink) {
    const linkText = (logoLink.textContent || '').trim();
    const clean = cleanCompanyName(linkText);
    if (clean) return { selector: clean, attribute: 'fixed' };
  }

  // 3. Document title — "CompanyName Jobs", "CompanyName Careers", "CompanyName | ..."
  const title = doc.title.trim();
  const titleMatch = title.match(/^([A-Za-z0-9][A-Za-z0-9 &.,'()\-]{1,35})\s+(?:jobs?|careers?|\||—|-)/i);
  if (titleMatch) {
    const clean = cleanCompanyName(titleMatch[1]);
    if (clean) return { selector: clean, attribute: 'fixed' };
  }

  // 4. Header "Jobs at CompanyName" or "CompanyName Careers" text
  const headerEls = doc.querySelectorAll('header, [class*="header" i], nav[class*="nav" i], [role="banner"]');
  for (const header of Array.from(headerEls)) {
    const text = (header.textContent || '').trim();
    const jobsAtMatch = text.match(/jobs?\s+(?:at|from|in)\s+([A-Za-z0-9][A-Za-z0-9 &.,'()\-]{1,35})/i);
    if (jobsAtMatch) {
      const clean = cleanCompanyName(jobsAtMatch[1]);
      if (clean) return { selector: clean, attribute: 'fixed' };
    }
    const careersMatch = text.match(/([A-Za-z0-9][A-Za-z0-9 &.,'()\-]{2,35})\s+careers?/i);
    if (careersMatch) {
      const clean = cleanCompanyName(careersMatch[1]);
      if (clean) return { selector: clean, attribute: 'fixed' };
    }
  }

  // 5. Footer copyright — "© 2024 CompanyName Inc."
  const footer = doc.querySelector('footer, [class*="footer" i], [role="contentinfo"]');
  if (footer) {
    const text = footer.textContent || '';
    const cpMatch = text.match(/©?\s*\d{4}?\s*([A-Za-z0-9][A-Za-z0-9 &.,'()\-]{2,35})\s*(?:Inc\.?|LLC|Ltd\.?|Corporation|Group|,|$)/i);
    if (cpMatch) {
      const clean = cleanCompanyName(cpMatch[1]);
      if (clean) return { selector: clean, attribute: 'fixed' };
    }
  }

  // 6. favicon — sometimes alt/title contains company name
  const favicon = doc.querySelector('link[rel="icon"], link[rel="shortcut icon"]');
  if (favicon) {
    const href = favicon.getAttribute('href') || '';
    const favMatch = href.match(/\/([A-Za-z0-9][A-Za-z0-9\-_]{2,30})\//i);
    if (favicon && favMatch) {
      const clean = cleanCompanyName(favMatch[1]);
      if (clean) return { selector: clean, attribute: 'fixed' };
    }
  }

  return null;
}

/**
 * Clean up a company name by removing common "careers-site" cruft.
 *
 * Runs iteratively because real-world values stack multiple suffixes
 * (e.g. "JPMC Candidate Experience page" → strip "page" → strip
 *  "candidate experience" → "JPMC").
 */
function cleanCompanyName(name: string): string {
  if (!name) return '';
  let s = name.trim();

  // Passes applied repeatedly so layered suffixes ("Candidate Experience page",
  // "Careers site", "Talent Acquisition portal") collapse cleanly.
  const passes: RegExp[] = [
    // Domain suffixes
    /\.(jobs|com|org|net|io|co|careers?)$/i,
    // "CompanyName - Careers" / "CompanyName | Jobs" / "CompanyName — Hiring"
    /\s*[-|—–·:]\s*(careers?|jobs?|hiring|work\s+with\s+us|work\s+at|talent\s+portal|talent\s+acquisition|candidate\s+experience|recruiting|job\s+site|job\s+portal|career\s+(?:portal|site|center|hub|platform)|employment|opportunities?).*$/i,
    // Trailing container words: "... page / site / portal / platform / hub / center"
    /\s+(page|site|portal|platform|center|centre|hub)\s*$/i,
    // Trailing domain-ish phrases
    /\s+(candidate\s+experience|career(?:s)?|job(?:s)?|hiring|talent\s+(?:acquisition|portal|network)|recruiting|employment|opportunities?|work\s+with\s+us|work\s+at)\s*$/i,
    // Leading "Jobs at X" / "Careers at X"
    /^(jobs?|careers?)\s+(?:at|from|in|with)\s+/i,
    // Leading / trailing quotes
    /^["'“”‘’]+|["'“”‘’]+$/g,
    // Double spaces
    /\s{2,}/g,
  ];

  let prev = '';
  // Guard against pathological loops; 6 iterations is plenty for any real input.
  for (let i = 0; i < 6 && prev !== s; i++) {
    prev = s;
    for (const p of passes) {
      s = s.replace(p, ' ').trim();
    }
  }

  // If cleaning reduced the name to something too short, treat it as unusable
  // so the caller falls back to the next detection strategy.
  if (s.length < 2) return '';
  return s;
}

function getSelector(el: Element): string {
  if (!el || !el.tagName) return 'body';
  let selector = el.tagName.toLowerCase();
  if (el.id) return `#${el.id}`;
  const classes = Array.from(el.classList).filter(isStableClass).slice(0, 1);
  if (classes.length > 0) selector += `.${classes[0]}`;
  return selector;
}

/**
 * Detect company from the page when it's not found inside list items.
 */
function addPageCompanyFallback(doc: Document, fields: DetectedField[]): DetectedField[] {
  const hasCompany = fields.some((f) => f.semanticType === 'company');
  if (hasCompany) return fields;

  const pageCompany = detectPageCompany(doc);
  if (!pageCompany) return fields;

  fields.unshift({
    semanticType: 'company',
    label: 'company',
    selector: pageCompany.selector,
    attribute: pageCompany.attribute,
    previewValue: pageCompany.attribute === 'fixed' ? pageCompany.selector : pageCompany.selector,
    tag: 'div',
  });

  return fields;
}

/**
 * Add a best-effort job URL field when semantic URL was not detected.
 */
function addUrlFallback(firstItem: Element, fields: DetectedField[]): DetectedField[] {
  const candidateSelectors = [
    'h1 a[href]',
    'h2 a[href]',
    'h3 a[href]',
    'a[href*="/job"]',
    'a[href*="/jobs"]',
    'a[href]',
  ];

  for (const selector of candidateSelectors) {
    const hit = firstItem.querySelector(selector);
    if (!hit) continue;
    const href = hit.getAttribute('href') || '';
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue;

    const relativeSelector = generateRelativeSelector(hit, firstItem) || selector;
    fields.push({
      semanticType: 'url',
      label: 'url',
      selector: relativeSelector,
      attribute: 'href',
      previewValue: href,
      tag: hit.tagName.toLowerCase(),
    });
    return fields;
  }

  // Last fallback: allow row-level URL inference in extractor.
  fields.push({
    semanticType: 'url',
    label: 'url',
    selector: 'a[href]',
    attribute: 'href',
    previewValue: '',
    tag: 'a',
  });
  return fields;
}

/**
 * Convert detected fields to FieldConfig map.
 */
export function fieldsToConfig(fields: DetectedField[]): Record<string, FieldConfig> {
  const config: Record<string, FieldConfig> = {};
  for (const field of fields) {
    config[field.label] = {
      selector: field.selector,
      attribute: field.attribute,
      label: field.label,
      semanticType: field.semanticType,
      tag: field.tag,
      fromSchema: field.tag === 'schema',
    };
  }
  return config;
}

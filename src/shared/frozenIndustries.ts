/**
 * Frozen industry taxonomy for job board + future cluster membership.
 * Shared by career (rowContext normalize) and aggregator auto-classify paths.
 * Keep aligned with tagCatalog `industry` values where practical.
 */
import { resolveIndustryFromCompany } from './companyIndustry';
import { resolveIndustryFromTitle } from './roleIndustry';

export const FROZEN_INDUSTRIES = [
  'Banking',
  'Investment Banking',
  'Financial Services',
  'FinTech',
  'Insurance',
  'InsurTech',
  'Healthcare',
  'HealthTech / Digital Health',
  'Pharmaceuticals',
  'Biotech',
  'Big Tech',
  'Software / SaaS',
  'Semiconductor',
  'Hardware / Electronics',
  'Telecommunications',
  'Aerospace',
  'Defense',
  'Automotive',
  'Airlines / Aviation',
  'Travel & Hospitality',
  'Retail',
  'E-commerce',
  'Consumer Goods (CPG)',
  'Manufacturing',
  'Energy / Oil & Gas',
  'Utilities',
  'Renewable / CleanTech',
  'Media & Entertainment',
  'Gaming',
  'Consulting',
  'Education / EdTech',
  'Government / Public Sector',
  'Non-profit',
  'Real Estate / PropTech',
  'Logistics / Supply Chain',
  'Transportation',
  'Agriculture / AgTech',
  'Cybersecurity',
  // Added in industry-v2. Appended so existing filter ordering is unchanged.
  // These cover the largest gaps found when auditing real listing data: HC sector
  // labels that could not canonicalize, and high-volume companies with no home.
  'Construction & Engineering',
  'Scientific Research',
  'Cloud Infrastructure',
  'Marketing & Advertising',
  'Legal',
  'Staffing & Recruiting',
  'Food & Beverage',
  'Mining & Metals',
  'Security Services',
  'Waste & Environmental',
] as const;

export type FrozenIndustry = (typeof FROZEN_INDUSTRIES)[number];

export const MAX_FROZEN_INDUSTRY_FILTERS = 10;
export const MAX_FROZEN_INDUSTRIES_PER_JOB = 2;

/** Rules / alias map version — bump when aliases change (backfill key). */
export const INDUSTRY_RULES_VERSION = 'industry-v3';

function taxonomyKey(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9+/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const CANONICAL_BY_KEY = new Map<string, FrozenIndustry>(
  FROZEN_INDUSTRIES.map((name) => [taxonomyKey(name), name]),
);

/** Free-text / HC scrapes → canonical industry. */
const INDUSTRY_ALIASES: Record<string, FrozenIndustry> = {
  banking: 'Banking',
  bank: 'Banking',
  'commercial banking': 'Banking',
  'retail banking': 'Banking',
  'investment banking': 'Investment Banking',
  ib: 'Investment Banking',
  'financial services': 'Financial Services',
  finance: 'Financial Services',
  'financial service': 'Financial Services',
  fintech: 'FinTech',
  'fin tech': 'FinTech',
  insurance: 'Insurance',
  insurtech: 'InsurTech',
  healthcare: 'Healthcare',
  'health care': 'Healthcare',
  hospital: 'Healthcare',
  healthtech: 'HealthTech / Digital Health',
  'digital health': 'HealthTech / Digital Health',
  pharma: 'Pharmaceuticals',
  pharmaceutical: 'Pharmaceuticals',
  pharmaceuticals: 'Pharmaceuticals',
  biotech: 'Biotech',
  biotechnology: 'Biotech',
  'big tech': 'Big Tech',
  faang: 'Big Tech',
  software: 'Software / SaaS',
  saas: 'Software / SaaS',
  'software saas': 'Software / SaaS',
  tech: 'Software / SaaS',
  technology: 'Software / SaaS',
  'information technology': 'Software / SaaS',
  it: 'Software / SaaS',
  semiconductor: 'Semiconductor',
  semiconductors: 'Semiconductor',
  hardware: 'Hardware / Electronics',
  electronics: 'Hardware / Electronics',
  telecom: 'Telecommunications',
  telecommunications: 'Telecommunications',
  aerospace: 'Aerospace',
  defense: 'Defense',
  defence: 'Defense',
  automotive: 'Automotive',
  auto: 'Automotive',
  airline: 'Airlines / Aviation',
  aviation: 'Airlines / Aviation',
  hospitality: 'Travel & Hospitality',
  travel: 'Travel & Hospitality',
  retail: 'Retail',
  ecommerce: 'E-commerce',
  'e commerce': 'E-commerce',
  cpg: 'Consumer Goods (CPG)',
  'consumer goods': 'Consumer Goods (CPG)',
  manufacturing: 'Manufacturing',
  energy: 'Energy / Oil & Gas',
  oil: 'Energy / Oil & Gas',
  gas: 'Energy / Oil & Gas',
  utilities: 'Utilities',
  cleantech: 'Renewable / CleanTech',
  renewable: 'Renewable / CleanTech',
  media: 'Media & Entertainment',
  entertainment: 'Media & Entertainment',
  gaming: 'Gaming',
  games: 'Gaming',
  consulting: 'Consulting',
  'management consulting': 'Consulting',
  education: 'Education / EdTech',
  edtech: 'Education / EdTech',
  government: 'Government / Public Sector',
  'public sector': 'Government / Public Sector',
  nonprofit: 'Non-profit',
  'non profit': 'Non-profit',
  'real estate': 'Real Estate / PropTech',
  proptech: 'Real Estate / PropTech',
  logistics: 'Logistics / Supply Chain',
  'supply chain': 'Logistics / Supply Chain',
  transportation: 'Transportation',
  agriculture: 'Agriculture / AgTech',
  agtech: 'Agriculture / AgTech',
  cybersecurity: 'Cybersecurity',
  'cyber security': 'Cybersecurity',
  'professional services': 'Consulting',
  'internet software': 'Software / SaaS',
  'computer software': 'Software / SaaS',

  // --- Hiring Cafe sector labels observed on real listings (industry-v2) ---
  'scientific research and development': 'Scientific Research',
  'research and development': 'Scientific Research',
  'life sciences tools and diagnostics': 'Scientific Research',
  'market research and analytics': 'Marketing & Advertising',
  'data centers and cloud infrastructure': 'Cloud Infrastructure',
  'internet platforms and digital services': 'Software / SaaS',
  'asset and wealth management': 'Financial Services',
  'accounting and tax services': 'Financial Services',
  'wholesale and distribution': 'Logistics / Supply Chain',
  'warehousing and fulfillment': 'Logistics / Supply Chain',
  'trucking and freight': 'Logistics / Supply Chain',
  'security services': 'Security Services',
  'holding companies and conglomerates': 'Financial Services',
  'business process outsourcing and call centers': 'Consulting',
  construction: 'Construction & Engineering',
  'civil and infrastructure construction': 'Construction & Engineering',
  'architecture and engineering services': 'Construction & Engineering',
  'specialty trade contractors': 'Construction & Engineering',
  'equipment rental and leasing': 'Construction & Engineering',
  'social services and human services': 'Non-profit',
  'workforce development and vocational rehabilitation': 'Non-profit',
  'marketing and advertising': 'Marketing & Advertising',
  'public health agencies': 'Government / Public Sector',
  'law enforcement and corrections': 'Government / Public Sector',
  'physician practices and outpatient clinics': 'Healthcare',
  'behavioral and mental health': 'Healthcare',
  'staffing and recruiting': 'Staffing & Recruiting',
  'broadcasting and streaming': 'Media & Entertainment',
  film: 'Media & Entertainment',
  'tv and music production': 'Media & Entertainment',
  'mining and metals': 'Mining & Metals',
  'hotels and resorts': 'Travel & Hospitality',
  'facilities services and janitorial': 'Waste & Environmental',
  'waste management and recycling': 'Waste & Environmental',
  'fitness and recreation centers': 'Travel & Hospitality',
  'public transit': 'Transportation',
  'consumer packaged goods': 'Consumer Goods (CPG)',
  'grocery and supermarkets': 'Food & Beverage',
  'beverages and alcohol': 'Food & Beverage',
  'legal services': 'Legal',
  'law firms': 'Legal',
};

for (const [alias, canonical] of Object.entries(INDUSTRY_ALIASES)) {
  CANONICAL_BY_KEY.set(taxonomyKey(alias), canonical);
}

export function canonicalFrozenIndustry(value: string): FrozenIndustry | null {
  const key = taxonomyKey(value);
  if (!key) return null;
  const direct = CANONICAL_BY_KEY.get(key);
  if (direct) return direct;
  // Partial: "Banking & Capital Markets" → Banking
  for (const [aliasKey, canonical] of CANONICAL_BY_KEY) {
    if (aliasKey.length >= 4 && (key.includes(aliasKey) || aliasKey.includes(key))) {
      return canonical;
    }
  }
  return null;
}

export function normalizeFrozenIndustryFilter(raw: unknown): string[] {
  const parts: string[] = [];
  const push = (value: unknown) => {
    for (const piece of String(value ?? '').split(',')) {
      const trimmed = piece.trim();
      if (trimmed) parts.push(trimmed);
    }
  };
  if (Array.isArray(raw)) raw.forEach(push);
  else if (raw != null) push(raw);

  const selected = new Set<string>();
  for (const part of parts) {
    const canonical = canonicalFrozenIndustry(part);
    if (canonical) selected.add(canonical);
  }
  return FROZEN_INDUSTRIES.filter((name) => selected.has(name)).slice(0, MAX_FROZEN_INDUSTRY_FILTERS);
}

/** Light keyword hints for aggregator fallback only (never used for career blank industry). */
const AGGREGATOR_HINTS: Array<{ re: RegExp; industry: FrozenIndustry }> = [
  { re: /\b(jpmorgan|jp morgan|goldman|morgan stanley|citi|wells fargo|bank of america)\b/i, industry: 'Banking' },
  { re: /\b(google|meta|facebook|apple|amazon|microsoft|netflix)\b/i, industry: 'Big Tech' },
  { re: /\b(stripe|plaid|coinbase|robinhood)\b/i, industry: 'FinTech' },
  { re: /\b(mckinsey|bain|bcg|deloitte|accenture|pwc|ey\b|kpmg)\b/i, industry: 'Consulting' },
  { re: /\b(hospital|clinic|health system|kaiser)\b/i, industry: 'Healthcare' },
];

export type IndustryResolveMethod =
  | 'row_context'
  | 'scrape_alias'
  | 'role_title'
  | 'company_exact'
  | 'company_pattern'
  | 'aggregator_hint'
  | 'none';

export type IndustryResolveInput = {
  sectorIndustry?: string;
  title?: string;
  companyName?: string;
  /** Listing source e.g. hiring_cafe; empty = career. */
  source?: string | null;
  isAggregator?: boolean;
};

export type IndustryResolveResult = {
  frozenIndustries: string[];
  method: IndustryResolveMethod;
  rulesVersion: string;
};

function pushUnique(out: string[], industry: FrozenIndustry) {
  if (!out.includes(industry) && out.length < MAX_FROZEN_INDUSTRIES_PER_JOB) {
    out.push(industry);
  }
}

/**
 * Split a sector string into candidate labels.
 * Tries the whole string first so multi-word taxonomy labels survive, and drops
 * parenthetical asides before splitting so "Specialty Trade Contractors (HVAC,
 * Plumbing, Electrical)" does not shatter into unusable fragments.
 */
function sectorCandidates(sector: string): string[] {
  const whole = sector.trim();
  if (!whole) return [];
  const withoutParens = whole.replace(/\([^)]*\)/g, ' ').trim();
  const candidates = [whole];
  if (withoutParens && withoutParens !== whole) candidates.push(withoutParens);
  for (const piece of withoutParens.split(/[,|;]/)) {
    const trimmed = piece.trim();
    if (trimmed) candidates.push(trimmed);
  }
  return candidates;
}

/**
 * Employer verticals that must not stick when the *role* is clearly tech or
 * logistics. Stops McKesson Salesforce architects from filling the Healthcare
 * filter, while still allowing Google SWE → Big Tech + Software / SaaS.
 */
const EMPLOYER_VERTICAL_DROPPED_BY_TECH_ROLE = new Set<FrozenIndustry>([
  'Healthcare',
  'HealthTech / Digital Health',
  'Insurance',
  'InsurTech',
  'Retail',
  'E-commerce',
  'Food & Beverage',
  'Travel & Hospitality',
  'Staffing & Recruiting',
  'Non-profit',
]);

const TECH_OR_LOGISTICS_ROLE = new Set<FrozenIndustry>([
  'Software / SaaS',
  'Cloud Infrastructure',
  'Cybersecurity',
  'Logistics / Supply Chain',
  'Transportation',
]);

function mergeRoleAndCompany(
  roleIndustries: FrozenIndustry[],
  companyIndustries: FrozenIndustry[]
): FrozenIndustry[] {
  const out: string[] = [];
  for (const industry of roleIndustries) pushUnique(out, industry);
  const roleIsTechOrLogistics = roleIndustries.some((r) => TECH_OR_LOGISTICS_ROLE.has(r));
  for (const industry of companyIndustries) {
    if (roleIsTechOrLogistics && EMPLOYER_VERTICAL_DROPPED_BY_TECH_ROLE.has(industry)) {
      continue;
    }
    pushUnique(out, industry);
  }
  return out as FrozenIndustry[];
}

/**
 * Resolve controlled industries for a job.
 *
 * Precedence, highest first:
 *   1. sectorIndustry — the selector. Always wins when present.
 *   2. Role title + company map — role patterns (Salesforce, truck driver,
 *      pharmacy tech) combined with employer industry. Tech/logistics roles
 *      drop conflicting employer verticals (Healthcare at McKesson) but keep
 *      compatible ones (Big Tech at Google).
 *   3. Company name alone — when the title has no role signal.
 *   4. Aggregator keyword hints over company + title.
 */
export function resolveFrozenIndustries(input: IndustryResolveInput): IndustryResolveResult {
  const out: string[] = [];
  const sector = String(input.sectorIndustry || '').trim();
  const isAggregator = Boolean(input.isAggregator);

  if (sector) {
    for (const piece of sectorCandidates(sector)) {
      const canonical = canonicalFrozenIndustry(piece);
      if (canonical) pushUnique(out, canonical);
      if (out.length >= MAX_FROZEN_INDUSTRIES_PER_JOB) break;
    }
    if (out.length) {
      return {
        frozenIndustries: out,
        method: isAggregator ? 'scrape_alias' : 'row_context',
        rulesVersion: INDUSTRY_RULES_VERSION,
      };
    }
  }

  const fromRole = resolveIndustryFromTitle(String(input.title || ''));
  const fromCompany = resolveIndustryFromCompany(String(input.companyName || ''));

  if (fromRole.method && fromRole.industries.length) {
    const merged = fromCompany.industries.length
      ? mergeRoleAndCompany(fromRole.industries, fromCompany.industries)
      : fromRole.industries;
    for (const industry of merged) pushUnique(out, industry);
    if (out.length) {
      return {
        frozenIndustries: out,
        method: 'role_title',
        rulesVersion: INDUSTRY_RULES_VERSION,
      };
    }
  }

  if (fromCompany.method && fromCompany.industries.length) {
    for (const industry of fromCompany.industries) pushUnique(out, industry);
    if (out.length) {
      return {
        frozenIndustries: out,
        method: fromCompany.method,
        rulesVersion: INDUSTRY_RULES_VERSION,
      };
    }
  }

  if (isAggregator) {
    const hay = `${input.companyName || ''} ${input.title || ''}`;
    for (const hint of AGGREGATOR_HINTS) {
      if (hint.re.test(hay)) pushUnique(out, hint.industry);
    }
    if (out.length) {
      return {
        frozenIndustries: out,
        method: 'aggregator_hint',
        rulesVersion: INDUSTRY_RULES_VERSION,
      };
    }
  }

  return { frozenIndustries: [], method: 'none', rulesVersion: INDUSTRY_RULES_VERSION };
}

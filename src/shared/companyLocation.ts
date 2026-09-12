/**
 * Company → HQ state for ambiguous city disambiguation.
 * Uses the same company name normalization as industry resolution.
 * Never guess — unknown companies return null.
 */
import { normalizeCompanyName } from './companyIndustry';

/** USPS state/territory code. */
export type CompanyHqStateCode = string;

/**
 * Curated HQ / primary US office state for high-volume employers.
 * Keys must be output of normalizeCompanyName().
 */
const COMPANY_HQ_STATE: Record<string, CompanyHqStateCode> = {
  google: 'CA',
  alphabet: 'CA',
  meta: 'CA',
  facebook: 'CA',
  apple: 'CA',
  nvidia: 'CA',
  netflix: 'CA',
  adobe: 'CA',
  salesforce: 'CA',
  oracle: 'TX',
  intel: 'CA',
  cisco: 'CA',
  paypal: 'CA',
  uber: 'CA',
  lyft: 'CA',
  airbnb: 'CA',
  stripe: 'CA',
  doordash: 'CA',
  zoom: 'CA',
  'linkedin': 'CA',
  microsoft: 'WA',
  amazon: 'WA',
  'amazon web services': 'WA',
  aws: 'WA',
  starbucks: 'WA',
  costco: 'WA',
  boeing: 'VA',
  expedia: 'WA',
  't mobile': 'WA',
  nike: 'OR',
  inteliquent: 'OR',
  adidas: 'OR',
  'columbia sportswear': 'OR',
  intelcom: 'OR',
  // Portland-ME vs Portland-OR: Oregon HQ employers
  'portland general electric': 'OR',
  // Finance / NY
  'jpmorgan chase': 'NY',
  jpmorgan: 'NY',
  'jp morgan': 'NY',
  'goldman sachs': 'NY',
  'morgan stanley': 'NY',
  citigroup: 'NY',
  citi: 'NY',
  bloomberg: 'NY',
  'american express': 'NY',
  blackrock: 'NY',
  'bank of america': 'NC',
  wells: 'CA',
  'wells fargo': 'CA',
  'capital one': 'VA',
  // Tech east
  ibm: 'NY',
  'ibm corporation': 'NY',
  accenture: 'IL',
  // Retail / other
  walmart: 'AR',
  target: 'MN',
  'best buy': 'MN',
  'general mills': 'MN',
  'unitedhealth': 'MN',
  unitedhealthgroup: 'MN',
  'cvs health': 'RI',
  cvs: 'RI',
  'home depot': 'GA',
  'delta air lines': 'GA',
  'coca cola': 'GA',
  'coca-cola': 'GA',
  'the coca cola company': 'GA',
  comcast: 'PA',
  verizon: 'NY',
  atandt: 'TX',
  'at and t': 'TX',
  'att': 'TX',
  'texas instruments': 'TX',
  dell: 'TX',
  'dell technologies': 'TX',
  'american airlines': 'TX',
  exxonmobil: 'TX',
  'exxon mobil': 'TX',
  'lockheed martin': 'MD',
  'northrop grumman': 'VA',
  'general dynamics': 'VA',
  'capital one financial': 'VA',
  freport: 'VA',
  'freddie mac': 'VA',
  'fannie mae': 'DC',
  'the world bank': 'DC',
  'international monetary fund': 'DC',
  // Springfield disambiguation helpers
  'state farm': 'IL',
  'illinois department': 'IL',
  'bass pro': 'MO',
  "o'sullivan": 'MO',
};

export function resolveCompanyHqState(companyName: string): CompanyHqStateCode | null {
  const key = normalizeCompanyName(companyName);
  if (!key) return null;
  if (COMPANY_HQ_STATE[key]) return COMPANY_HQ_STATE[key];

  // Prefix / contains soft match for long legal names
  for (const [name, state] of Object.entries(COMPANY_HQ_STATE)) {
    if (key === name) return state;
    if (key.startsWith(name + ' ') || key.endsWith(' ' + name)) return state;
  }
  return null;
}

/**
 * Pick the modal state from prior classified jobs for a company.
 * Caller supplies already-aggregated state codes (frequency order recommended).
 */
export function pickHistoricalState(
  historicalStates: string[] | undefined,
  allowedStates?: string[]
): CompanyHqStateCode | null {
  const allowed = allowedStates?.length
    ? new Set(allowedStates.map((s) => s.toUpperCase()))
    : null;
  for (const raw of historicalStates || []) {
    const code = String(raw || '').trim().toUpperCase();
    if (code.length !== 2) continue;
    if (allowed && !allowed.has(code)) continue;
    return code;
  }
  return null;
}

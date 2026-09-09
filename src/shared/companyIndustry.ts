/**
 * Company → frozen industry resolution.
 *
 * This is the fallback tier used when a listing has no `sectorIndustry` selector.
 * The selector always wins when present (see resolveFrozenIndustries); this module
 * exists because ~98% of listings carry no industry field at all, while nearly all
 * of them carry a company name.
 *
 * Two tiers, in order:
 *   1. COMPANY_INDUSTRY — exact match on the normalized company name (high precision).
 *   2. COMPANY_PATTERNS — regex over the normalized name for regularities that
 *      generalize past the curated head (hospitals, banks, universities, gov bodies).
 *
 * Never guess. An unrecognized company resolves to nothing.
 */
import type { FrozenIndustry } from './frozenIndustries';

/** Scraper artifacts and page furniture that land in companyName. Never classify these. */
const COMPANY_JUNK = new Set([
  'professional',
  'public',
  'executive',
  'executives',
  'texas executives',
  'texas staff hq',
  'other staff',
  'early career',
  'student and grad programs',
  'company info',
  'top ai',
  'myhrabc',
  'unknown',
  'n a',
  'careers',
  'jobs',
]);

/** Ticker-style company names emitted by some aggregator cards. */
const TICKER_ALIASES: Record<string, string> = {
  ctsh: 'cognizant',
  lmt: 'lockheed martin',
  goog: 'google',
  googl: 'google',
  jpm: 'jpmorgan chase',
  axp: 'american express',
  '532540': 'tata consultancy services',
};

const LEGAL_SUFFIX_RE =
  /\b(inc|llc|l\.?l\.?c|ltd|limited|corp|corporation|co|company|plc|gmbh|ag|sa|nv|bv|pte|pvt|lp|llp|holdings|group|n\.?a|the)\b/g;

/**
 * Canonicalize a raw company string for lookup.
 * Handles aggregator prefixes ("See more open positions at X") and ticker forms
 * ("NASDAQ: CTSH") before stripping punctuation and legal suffixes.
 */
export function normalizeCompanyName(raw: string): string {
  let s = String(raw || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');

  s = s.replace(/^see\s+more\s+open\s+positions\s+at\s+/i, '');
  s = s.replace(/\s*[-–|]\s*(careers?|jobs?|hiring)\s*$/i, '');
  // Domain-style company names, e.g. "heidihealth.com.au".
  s = s.replace(/\.(com|io|ai|co|net|org|dev|app)(\.[a-z]{2})?$/i, '');

  const ticker = s.match(/^(?:nasdaq|nyse|bse|nse|lse|euronext[a-z ]*)\s*:\s*([a-z0-9., ]+)$/i);
  if (ticker) {
    const first = ticker[1].split(/[,\s]+/).filter(Boolean)[0] || '';
    s = TICKER_ALIASES[first] || '';
  }

  s = s
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9+ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return s;
}

/** Normalized name with legal suffixes removed, for a second lookup pass. */
function stripLegalSuffixes(normalized: string): string {
  return normalized.replace(LEGAL_SUFFIX_RE, ' ').replace(/\s+/g, ' ').trim();
}

type IndustryList = FrozenIndustry | [FrozenIndustry, FrozenIndustry];

/**
 * Curated company → industry map, keyed by normalizeCompanyName() output.
 * Ordered roughly by job volume on the board; the head is heavily concentrated
 * (top 50 companies ≈ 61% of listings, top 200 ≈ 75%).
 */
const COMPANY_INDUSTRY: Record<string, IndustryList> = {
  // ---- Big Tech / platforms ----
  google: 'Big Tech',
  alphabet: 'Big Tech',
  microsoft: 'Big Tech',
  apple: ['Big Tech', 'Hardware / Electronics'],
  amazon: ['Big Tech', 'E-commerce'],
  'amazon web services': ['Big Tech', 'Cloud Infrastructure'],
  aws: 'Cloud Infrastructure',
  meta: 'Big Tech',
  'meta platforms': 'Big Tech',
  facebook: 'Big Tech',
  netflix: ['Big Tech', 'Media & Entertainment'],
  bytedance: ['Big Tech', 'Media & Entertainment'],
  tiktok: 'Media & Entertainment',

  // ---- Semiconductor / hardware ----
  qualcomm: 'Semiconductor',
  nvidia: 'Semiconductor',
  intel: 'Semiconductor',
  amd: 'Semiconductor',
  'advanced micro devices': 'Semiconductor',
  'micron technology': 'Semiconductor',
  micron: 'Semiconductor',
  'lam research': 'Semiconductor',
  'applied materials': 'Semiconductor',
  'renesas electronics': 'Semiconductor',
  renesas: 'Semiconductor',
  'texas instruments': 'Semiconductor',
  broadcom: 'Semiconductor',
  arm: 'Semiconductor',
  infleqtion: 'Semiconductor',
  dell: 'Hardware / Electronics',
  'dell technologies': 'Hardware / Electronics',
  hpe: 'Hardware / Electronics',
  'hpe simplivity': 'Hardware / Electronics',
  'hewlett packard enterprise': 'Hardware / Electronics',
  hp: 'Hardware / Electronics',
  samtec: 'Hardware / Electronics',
  corning: 'Hardware / Electronics',
  garmin: 'Hardware / Electronics',
  vertiv: ['Hardware / Electronics', 'Cloud Infrastructure'],
  'panasonic corporation of north america': 'Hardware / Electronics',
  panasonic: 'Hardware / Electronics',
  'arista networks': ['Hardware / Electronics', 'Telecommunications'],
  cisco: ['Hardware / Electronics', 'Telecommunications'],

  // ---- Software / SaaS ----
  oracle: 'Software / SaaS',
  'oracle corporation': 'Software / SaaS',
  salesforce: 'Software / SaaS',
  adobe: 'Software / SaaS',
  intuit: ['Software / SaaS', 'FinTech'],
  twilio: 'Software / SaaS',
  servicenow: 'Software / SaaS',
  gitlab: 'Software / SaaS',
  github: 'Software / SaaS',
  atlassian: 'Software / SaaS',
  nutanix: 'Software / SaaS',
  box: 'Software / SaaS',
  zoom: 'Software / SaaS',
  docusign: 'Software / SaaS',
  hubspot: 'Software / SaaS',
  celonis: 'Software / SaaS',
  paylocity: 'Software / SaaS',
  ifs: 'Software / SaaS',
  esri: 'Software / SaaS',
  togetherwork: 'Software / SaaS',
  ncontracts: 'Software / SaaS',
  everseen: 'Software / SaaS',
  openai: 'Software / SaaS',
  anthropic: 'Software / SaaS',
  xai: 'Software / SaaS',
  cohere: 'Software / SaaS',
  mistral: 'Software / SaaS',
  'thinking machines lab': 'Software / SaaS',
  cursor: 'Software / SaaS',
  anysphere: 'Software / SaaS',
  baseten: ['Software / SaaS', 'Cloud Infrastructure'],
  firecrawl: 'Software / SaaS',
  decagon: 'Software / SaaS',
  suno: ['Software / SaaS', 'Media & Entertainment'],
  serval: 'Software / SaaS',
  turing: 'Software / SaaS',
  mindrift: 'Software / SaaS',
  lovable: 'Software / SaaS',
  exa: 'Software / SaaS',
  sierra: 'Software / SaaS',
  'stitch fix': 'E-commerce',
  handshake: 'Education / EdTech',
  pearson: 'Education / EdTech',
  eliseai: ['Software / SaaS', 'Real Estate / PropTech'],
  'frame io': 'Software / SaaS',
  airkit: 'Software / SaaS',
  instana: 'Software / SaaS',
  'applied intuition': 'Software / SaaS',
  'world wide technology': ['Software / SaaS', 'Consulting'],

  // ---- Cloud infrastructure / data centers ----
  nebius: 'Cloud Infrastructure',
  crusoe: 'Cloud Infrastructure',
  nscale: 'Cloud Infrastructure',
  cloudflare: 'Cloud Infrastructure',
  digitalocean: 'Cloud Infrastructure',
  equinix: 'Cloud Infrastructure',

  // ---- Cybersecurity ----
  zscaler: 'Cybersecurity',
  crowdstrike: 'Cybersecurity',
  paloaltonetworks: 'Cybersecurity',
  'palo alto networks': 'Cybersecurity',
  okta: 'Cybersecurity',
  'ping identity': 'Cybersecurity',
  chainguard: 'Cybersecurity',
  vanta: 'Cybersecurity',
  socure: ['Cybersecurity', 'FinTech'],
  verkada: ['Cybersecurity', 'Hardware / Electronics'],
  idme: 'Cybersecurity',
  'id me': 'Cybersecurity',

  // ---- Banking ----
  'citizens bank': 'Banking',
  'citizens financial': 'Banking',
  'citizens financial group': 'Banking',
  'jpmorgan chase': ['Banking', 'Financial Services'],
  jpmorgan: ['Banking', 'Financial Services'],
  'jp morgan': ['Banking', 'Financial Services'],
  'wells fargo': 'Banking',
  'bank of america': 'Banking',
  citi: 'Banking',
  citigroup: 'Banking',
  'truist bank': 'Banking',
  truist: 'Banking',
  regions: 'Banking',
  'regions bank': 'Banking',
  synovus: 'Banking',
  'independent bank': 'Banking',
  frostbank: 'Banking',
  'frost bank': 'Banking',
  'bank of montreal': 'Banking',
  bmo: 'Banking',
  'zions bank': 'Banking',
  bny: 'Banking',
  'bny mellon': 'Banking',
  'us bank': 'Banking',
  'pnc financial services': 'Banking',
  pnc: 'Banking',
  'capital one': 'Banking',
  'navy federal credit union': 'Banking',

  // ---- Investment banking / asset management ----
  morganstanley: ['Investment Banking', 'Financial Services'],
  'morgan stanley': ['Investment Banking', 'Financial Services'],
  'goldman sachs': ['Investment Banking', 'Financial Services'],
  goldman: ['Investment Banking', 'Financial Services'],
  'citizens securities': 'Financial Services',
  'citizens jmp securities': 'Financial Services',
  aresmgmt: 'Financial Services',
  'ares management': 'Financial Services',
  'point72 asset management': 'Financial Services',
  point72: 'Financial Services',
  blackrock: 'Financial Services',
  'blackstone': 'Financial Services',
  nasdaq: 'Financial Services',
  'moody s': 'Financial Services',
  moodys: 'Financial Services',
  'american express': 'Financial Services',
  tiaa: ['Financial Services', 'Insurance'],
  'world bank': 'Financial Services',
  'world bank group': 'Financial Services',

  // ---- FinTech ----
  paypal: 'FinTech',
  stripe: 'FinTech',
  affirm: 'FinTech',
  robinhood: 'FinTech',
  circle: 'FinTech',
  coinbase: 'FinTech',
  plaid: 'FinTech',
  lendingclub: 'FinTech',
  mercury: 'FinTech',
  zip: 'FinTech',
  bjak: 'InsurTech',

  // ---- Insurance ----
  'state farm': 'Insurance',
  progressive: 'Insurance',
  chubb: 'Insurance',
  nationwide: 'Insurance',
  'the cigna group': ['Insurance', 'Healthcare'],
  cigna: ['Insurance', 'Healthcare'],
  aflac: 'Insurance',
  metlife: 'Insurance',

  // ---- Healthcare / payers / providers ----
  mckesson: 'Healthcare',
  cvshealth: ['Healthcare', 'Retail'],
  'cvs health': ['Healthcare', 'Retail'],
  cvs: ['Healthcare', 'Retail'],
  'unitedhealth group': ['Healthcare', 'Insurance'],
  unitedhealth: ['Healthcare', 'Insurance'],
  optum: 'Healthcare',
  ascension: 'Healthcare',
  davita: 'Healthcare',
  tenethealth: 'Healthcare',
  tenet: 'Healthcare',
  'tenet call center ops': 'Healthcare',
  'conifer health solutions': 'Healthcare',
  'conifer revenue cycle solutions': 'Healthcare',
  'quest diagnostics': 'Healthcare',
  upmc: 'Healthcare',
  providence: 'Healthcare',
  'piedmont medical network': 'Healthcare',
  'md anderson cancer center': 'Healthcare',
  'mount sinai health system': 'Healthcare',
  'boston scientific': 'Healthcare',
  intuitive: 'Healthcare',
  'intuitive surgical': 'Healthcare',
  'neko health': 'Healthcare',
  heidihealth: 'HealthTech / Digital Health',
  walgreens: ['Retail', 'Healthcare'],
  'duane reade': 'Retail',

  // ---- Pharma / biotech / research ----
  bayer: 'Pharmaceuticals',
  abbvie: 'Pharmaceuticals',
  amgen: 'Biotech',
  'johnson and johnson': 'Pharmaceuticals',
  pfizer: 'Pharmaceuticals',
  merck: 'Pharmaceuticals',
  'eurofins scientific': 'Scientific Research',
  eurofins: 'Scientific Research',
  'bighat biosciences': 'Biotech',
  'lila sciences': 'Scientific Research',
  'convergent research': 'Scientific Research',
  'formation bio': 'Biotech',
  'thomas jefferson national accelerator facility': 'Scientific Research',
  cotiviti: 'Healthcare',
  'advita ortho': 'Healthcare',
  'sandia national laboratories': 'Scientific Research',
  'johns hopkins applied physics laboratory': 'Scientific Research',
  'naval nuclear laboratory': ['Scientific Research', 'Defense'],

  // ---- Aerospace / defense ----
  'lockheed martin': ['Defense', 'Aerospace'],
  spacex: 'Aerospace',
  'rocket lab': 'Aerospace',
  anduril: 'Defense',
  'anduril industries': 'Defense',
  'shield ai': 'Defense',
  'l3harris technologies': ['Defense', 'Aerospace'],
  l3harris: ['Defense', 'Aerospace'],
  peraton: ['Defense', 'Government / Public Sector'],
  boozallen: ['Consulting', 'Defense'],
  'booz allen hamilton': ['Consulting', 'Defense'],
  'general dynamics information technology': 'Defense',
  'general dynamics': ['Defense', 'Aerospace'],
  'northrop grumman': ['Defense', 'Aerospace'],
  raytheon: ['Defense', 'Aerospace'],
  'rtx': ['Defense', 'Aerospace'],
  boeing: 'Aerospace',
  'honeywell aerospace': 'Aerospace',
  honeywell: 'Manufacturing',
  'howmet aerospace': 'Aerospace',
  'mantech international': ['Defense', 'Government / Public Sector'],
  'modern technology solutions': 'Defense',
  'two six technologies': 'Defense',
  'base 2 solutions': 'Defense',
  barbaricum: 'Defense',
  'redhorse corporation': ['Defense', 'Government / Public Sector'],
  'dev technology': 'Government / Public Sector',
  govcio: 'Government / Public Sector',
  akima: ['Defense', 'Government / Public Sector'],
  'competitive range solutions': 'Defense',
  'extreme engineering solutions': 'Defense',
  echodyne: 'Defense',
  'mach industries': 'Defense',
  cesiumastro: 'Aerospace',
  vast: 'Aerospace',
  firestorm: 'Defense',
  'tesla laboratories': 'Defense',
  'the nuclear company': 'Energy / Oil & Gas',

  // ---- Automotive / mobility ----
  ford: 'Automotive',
  tesla: 'Automotive',
  rivian: 'Automotive',
  stellantis: 'Automotive',
  'cnh industrial': 'Manufacturing',
  'john deere': 'Manufacturing',
  deere: 'Manufacturing',
  waymo: 'Automotive',
  zoox: 'Automotive',
  wayve: 'Automotive',
  '42dot': 'Automotive',
  'bosch': 'Automotive',
  'bosch group': 'Automotive',
  uber: ['Transportation', 'Software / SaaS'],
  lyft: 'Transportation',
  doordash: ['E-commerce', 'Transportation'],
  instacart: 'E-commerce',
  'amerit fleet solutions': 'Transportation',
  'classic collision': 'Automotive',

  // ---- Industrials / manufacturing / energy ----
  siemens: 'Manufacturing',
  eaton: 'Manufacturing',
  'koch industries': 'Manufacturing',
  'saint gobain': 'Manufacturing',
  emerson: 'Manufacturing',
  'caterpillar': 'Manufacturing',
  'cummins': 'Manufacturing',
  danfoss: 'Manufacturing',
  'stryten energy': 'Manufacturing',
  'energy transfer': 'Energy / Oil & Gas',
  totalenergies: 'Energy / Oil & Gas',
  slb: 'Energy / Oil & Gas',
  schlumberger: 'Energy / Oil & Gas',
  chevron: 'Energy / Oil & Gas',
  exxonmobil: 'Energy / Oil & Gas',
  'southern company': 'Utilities',
  'southern california edison': 'Utilities',
  'pacific gas and electric': 'Utilities',
  'rio tinto': 'Mining & Metals',
  'freeport mcmoran': 'Mining & Metals',
  worley: 'Construction & Engineering',
  'schneider electric': 'Manufacturing',
  solidigm: 'Semiconductor',
  auria: 'Defense',
  'mxv rail': 'Transportation',
  'american equity': 'Insurance',
  'caesars entertainment': 'Travel & Hospitality',

  // ---- Construction & engineering services ----
  aecom: 'Construction & Engineering',
  hdr: 'Construction & Engineering',
  stantec: 'Construction & Engineering',
  'burns and mcdonnell': 'Construction & Engineering',
  halff: 'Construction & Engineering',
  corgan: 'Construction & Engineering',
  ardurra: 'Construction & Engineering',
  'sargent and lundy': 'Construction & Engineering',
  'everus construction': 'Construction & Engineering',
  pape: 'Construction & Engineering',
  'pike corporation': 'Construction & Engineering',
  convergint: 'Security Services',

  // ---- Consulting / IT services ----
  ibm: ['Software / SaaS', 'Consulting'],
  wipro: ['Consulting', 'Software / SaaS'],
  cognizant: ['Consulting', 'Software / SaaS'],
  nttdata: ['Consulting', 'Software / SaaS'],
  'ntt data': ['Consulting', 'Software / SaaS'],
  hcltech: ['Consulting', 'Software / SaaS'],
  hcl: ['Consulting', 'Software / SaaS'],
  'tata consultancy services': ['Consulting', 'Software / SaaS'],
  tcs: ['Consulting', 'Software / SaaS'],
  infosys: ['Consulting', 'Software / SaaS'],
  accenture: 'Consulting',
  deloitte: 'Consulting',
  ey: 'Consulting',
  'ernst and young': 'Consulting',
  pwc: 'Consulting',
  'pwc us': 'Consulting',
  kpmg: 'Consulting',
  mckinsey: 'Consulting',
  bain: 'Consulting',
  bcg: 'Consulting',
  'exl service': 'Consulting',
  'exlservice': 'Consulting',

  // ---- Media / social / gaming ----
  reddit: ['Media & Entertainment', 'Software / SaaS'],
  pinterest: ['Media & Entertainment', 'Software / SaaS'],
  snap: ['Media & Entertainment', 'Software / SaaS'],
  ouryahoo: 'Media & Entertainment',
  yahoo: 'Media & Entertainment',
  spotify: 'Media & Entertainment',
  peloton: 'Media & Entertainment',
  mrbeast: 'Media & Entertainment',
  'oak view': 'Media & Entertainment',
  dish: 'Media & Entertainment',
  'publicis groupe': 'Marketing & Advertising',
  publicis: 'Marketing & Advertising',
  circana: 'Marketing & Advertising',

  // ---- Legal ----
  harvey: 'Legal',
  legora: 'Legal',
  avalore: 'Legal',

  // ---- Telecom ----
  verizon: 'Telecommunications',
  ericsson: 'Telecommunications',
  nokia: 'Telecommunications',
  'at t': 'Telecommunications',
  't mobile': 'Telecommunications',

  // ---- Retail / consumer / food ----
  autozone: 'Retail',
  'michaels stores': 'Retail',
  michaels: 'Retail',
  nike: ['Retail', 'Consumer Goods (CPG)'],
  therealreal: ['E-commerce', 'Retail'],
  'sprouts farmers market': ['Retail', 'Food & Beverage'],
  'the kraft heinz': 'Food & Beverage',
  'kraft heinz': 'Food & Beverage',
  pepsico: 'Food & Beverage',
  'the estee lauder companies': 'Consumer Goods (CPG)',
  'estee lauder': 'Consumer Goods (CPG)',
  'cpg beyond': 'Consumer Goods (CPG)',

  // ---- Logistics ----
  fedex: 'Logistics / Supply Chain',
  ups: 'Logistics / Supply Chain',
  'r and l carriers': 'Logistics / Supply Chain',
  'united states cold storage': 'Logistics / Supply Chain',
  amports: 'Logistics / Supply Chain',

  // ---- Government ----
  'united states air force': ['Government / Public Sector', 'Defense'],
  'united states department of defense': ['Government / Public Sector', 'Defense'],
  'united states federal government': 'Government / Public Sector',
  'department of the army': ['Government / Public Sector', 'Defense'],
  'department of the navy': ['Government / Public Sector', 'Defense'],
  'department of homeland security': 'Government / Public Sector',
  'department of commerce': 'Government / Public Sector',
  'department of labor': 'Government / Public Sector',
  'metropolitan transportation authority': ['Government / Public Sector', 'Transportation'],
  'texas health and human services commission': 'Government / Public Sector',
  'texas democratic party': 'Non-profit',
  'the church of jesus christ of latter day saints': 'Non-profit',
};

/**
 * Regex tier. Applied to the normalized name only when the exact map misses.
 * Patterns must be specific enough that a false positive is unlikely — these run
 * against the entire long tail (2,402 distinct companies).
 */
const COMPANY_PATTERNS: Array<{ re: RegExp; industries: IndustryList }> = [
  // Healthcare providers — the single largest long-tail cluster.
  {
    re: /\b(hospital|hospitals|health system|healthcare|health care|medical center|medical centre|clinic|clinics|physicians|cancer center|dental|nursing|hospice|home health|behavioral health|orthopedic)\b/,
    industries: 'Healthcare',
  },
  { re: /\b(biosciences|biopharma|therapeutics|biolabs)\b/, industries: 'Biotech' },
  { re: /\b(pharmaceutical|pharmaceuticals|pharma)\b/, industries: 'Pharmaceuticals' },
  { re: /\b(national laboratory|national laboratories|research institute|research center)\b/, industries: 'Scientific Research' },

  // Financial.
  { re: /\b(bank|bancorp|bancshares|banking|credit union|savings and loan)\b/, industries: 'Banking' },
  { re: /\b(insurance|assurance|underwriters|mutual life)\b/, industries: 'Insurance' },
  { re: /\b(asset management|wealth management|capital management|investments|securities|advisors|capital partners)\b/, industries: 'Financial Services' },

  // Education is matched before government so school districts do not land in gov.
  {
    re: /\b(university|universities|college|institute of technology|academy|public schools|school district|school system)\b/,
    industries: 'Education / EdTech',
  },
  {
    re: /\b(state of|commonwealth of|city of|county of|department of|ministry of|municipality|regulatory commission|federal government|county|township)\b/,
    industries: 'Government / Public Sector',
  },
  { re: /\b(foundation|charity|charitable|nonprofit|non profit)\b/, industries: 'Non-profit' },

  // Services.
  { re: /\b(consulting|consultancy|advisory|professional services)\b/, industries: 'Consulting' },
  { re: /\b(staffing|recruiting|recruitment|talent solutions|workforce solutions)\b/, industries: 'Staffing & Recruiting' },
  { re: /\b(law firm|legal services|attorneys|counsel)\b/, industries: 'Legal' },
  { re: /\b(marketing|advertising|media group|brand agency)\b/, industries: 'Marketing & Advertising' },
  { re: /\b(security services|protective services|guard services)\b/, industries: 'Security Services' },
  { re: /\b(waste|recycling|environmental services|sanitation)\b/, industries: 'Waste & Environmental' },

  // Industrials.
  { re: /\b(construction|contractors|builders|engineering services|civil engineering|architects|architecture)\b/, industries: 'Construction & Engineering' },
  { re: /\b(mining|metals|steel|smelting|foundry)\b/, industries: 'Mining & Metals' },
  { re: /\b(manufacturing|industries|industrial|machining|fabrication)\b/, industries: 'Manufacturing' },
  { re: /\b(logistics|freight|trucking|carriers|warehousing|fulfillment|supply chain)\b/, industries: 'Logistics / Supply Chain' },
  { re: /\b(energy|oil and gas|petroleum|drilling)\b/, industries: 'Energy / Oil & Gas' },
  // Bare "electric" is not a utility signal — it also names HVAC contractors and
  // industrial manufacturers (Schneider Electric, Armstrong Air & Electric).
  { re: /\b(utilities|utility district|power company|electric cooperative|water district)\b/, industries: 'Utilities' },
  { re: /\b(solar|wind energy|renewables|cleantech)\b/, industries: 'Renewable / CleanTech' },
  { re: /\b(aerospace|avionics|space systems)\b/, industries: 'Aerospace' },
  { re: /\b(defense|defence)\b/, industries: 'Defense' },
  { re: /\b(semiconductor|semiconductors|microelectronics)\b/, industries: 'Semiconductor' },

  // Consumer.
  { re: /\b(hotels|resorts|hospitality|casino)\b/, industries: 'Travel & Hospitality' },
  { re: /\b(airlines|airways|aviation)\b/, industries: 'Airlines / Aviation' },
  { re: /\b(restaurants|brewing|brewery|distillery|beverages|foods|grocery|supermarket)\b/, industries: 'Food & Beverage' },
  { re: /\b(real estate|realty|properties|property management)\b/, industries: 'Real Estate / PropTech' },
  { re: /\b(telecom|telecommunications|wireless|broadband)\b/, industries: 'Telecommunications' },
  { re: /\b(cybersecurity|cyber security)\b/, industries: 'Cybersecurity' },
  { re: /\b(data center|data centers|cloud services|cloud infrastructure)\b/, industries: 'Cloud Infrastructure' },
  // Deliberately narrow: bare "technologies" / "systems" / "labs" / "ai" are not
  // industry signals and would mis-tag defense and industrial firms as software.
  { re: /\b(software|saas)\b/, industries: 'Software / SaaS' },
];

export type CompanyIndustryMethod = 'company_exact' | 'company_pattern';

export type CompanyIndustryResult = {
  industries: FrozenIndustry[];
  method: CompanyIndustryMethod | null;
};

const EMPTY: CompanyIndustryResult = { industries: [], method: null };

function toList(value: IndustryList): FrozenIndustry[] {
  return Array.isArray(value) ? [...value] : [value];
}

/**
 * Resolve industries from a company name. Returns an empty result for unknown or
 * junk names — callers must not fall back to guessing from the job title.
 */
export function resolveIndustryFromCompany(companyName: string): CompanyIndustryResult {
  const normalized = normalizeCompanyName(companyName);
  if (!normalized || normalized.length < 2) return EMPTY;
  if (COMPANY_JUNK.has(normalized)) return EMPTY;

  const exact = COMPANY_INDUSTRY[normalized];
  if (exact) return { industries: toList(exact), method: 'company_exact' };

  const stripped = stripLegalSuffixes(normalized);
  if (stripped && stripped !== normalized) {
    if (COMPANY_JUNK.has(stripped)) return EMPTY;
    const strippedHit = COMPANY_INDUSTRY[stripped];
    if (strippedHit) return { industries: toList(strippedHit), method: 'company_exact' };
  }

  const haystack = stripped || normalized;
  for (const rule of COMPANY_PATTERNS) {
    if (rule.re.test(haystack)) {
      return { industries: toList(rule.industries), method: 'company_pattern' };
    }
  }

  return EMPTY;
}

/** Exposed for coverage tooling / tests. */
export const COMPANY_INDUSTRY_ENTRY_COUNT = Object.keys(COMPANY_INDUSTRY).length;

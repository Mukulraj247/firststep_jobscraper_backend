/**
 * Frozen US location taxonomy for job board + future cluster membership.
 * DB/API store USPS codes; UI maps codes → name / shortName.
 *
 * Never invent a state when city is ambiguous without strong evidence.
 */
import {
  lookupCityCandidates,
  lookupZipState,
  normalizeCityKey,
  type CityCandidate,
} from './usCityGazetteer';
import { resolveCompanyHqState } from './companyLocation';

export const LOCATION_RULES_VERSION = 'location-2026-09-14';

/** Population of top candidate must be ≥ this × second to auto-pick (Cambridge MA ~9.6× MD). */
export const CITY_POPULATION_DOMINANCE_RATIO = 9;

export type FrozenUsStateCode =
  | 'AL' | 'AK' | 'AZ' | 'AR' | 'CA' | 'CO' | 'CT' | 'DE' | 'FL' | 'GA'
  | 'HI' | 'ID' | 'IL' | 'IN' | 'IA' | 'KS' | 'KY' | 'LA' | 'ME' | 'MD'
  | 'MA' | 'MI' | 'MN' | 'MS' | 'MO' | 'MT' | 'NE' | 'NV' | 'NH' | 'NJ'
  | 'NM' | 'NY' | 'NC' | 'ND' | 'OH' | 'OK' | 'OR' | 'PA' | 'RI' | 'SC'
  | 'SD' | 'TN' | 'TX' | 'UT' | 'VT' | 'VA' | 'WA' | 'WV' | 'WI' | 'WY'
  | 'DC' | 'PR' | 'GU' | 'VI' | 'AS' | 'MP';

export type FrozenUsStateMeta = {
  code: FrozenUsStateCode;
  name: string;
  /** Shortened English for long names; omit when full name is fine. */
  shortName?: string;
};

export const FROZEN_US_STATES: FrozenUsStateMeta[] = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts', shortName: 'Mass.' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire', shortName: 'N. Hampshire' },
  { code: 'NJ', name: 'New Jersey', shortName: 'N. Jersey' },
  { code: 'NM', name: 'New Mexico', shortName: 'N. Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina', shortName: 'N. Carolina' },
  { code: 'ND', name: 'North Dakota', shortName: 'N. Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island', shortName: 'R. Island' },
  { code: 'SC', name: 'South Carolina', shortName: 'S. Carolina' },
  { code: 'SD', name: 'South Dakota', shortName: 'S. Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia', shortName: 'W. Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
  { code: 'DC', name: 'District of Columbia', shortName: 'D.C.' },
  { code: 'PR', name: 'Puerto Rico' },
  { code: 'GU', name: 'Guam' },
  { code: 'VI', name: 'U.S. Virgin Islands', shortName: 'U.S.V.I.' },
  { code: 'AS', name: 'American Samoa', shortName: 'Am. Samoa' },
  { code: 'MP', name: 'Northern Mariana Islands', shortName: 'N. Marianas' },
];

export const FROZEN_US_STATE_CODES = FROZEN_US_STATES.map((s) => s.code);

const STATE_BY_CODE = new Map<string, FrozenUsStateMeta>(
  FROZEN_US_STATES.map((s) => [s.code, s])
);

const STATE_NAME_TO_CODE = new Map<string, FrozenUsStateCode>();
for (const s of FROZEN_US_STATES) {
  STATE_NAME_TO_CODE.set(taxonomyKey(s.name), s.code);
  if (s.shortName) STATE_NAME_TO_CODE.set(taxonomyKey(s.shortName), s.code);
}
// Extra aliases for parsing free text
STATE_NAME_TO_CODE.set('district of columbia', 'DC');
STATE_NAME_TO_CODE.set('washington dc', 'DC');
STATE_NAME_TO_CODE.set('washington d c', 'DC');
STATE_NAME_TO_CODE.set('virgin islands', 'VI');
STATE_NAME_TO_CODE.set('us virgin islands', 'VI');
STATE_NAME_TO_CODE.set('northern mariana islands', 'MP');
STATE_NAME_TO_CODE.set('mariana islands', 'MP');
STATE_NAME_TO_CODE.set('samoa', 'AS');

export type LocationResolveMethod =
  | 'explicit_state'
  | 'zip'
  | 'unique_city'
  | 'population'
  | 'company_hq'
  | 'company_history'
  | 'remote'
  | 'non_us'
  | 'ambiguous'
  | 'none';

export type FrozenCityRef = {
  name: string;
  state: FrozenUsStateCode;
};

export type LocationResolveInput = {
  location?: string;
  remoteType?: string;
  companyName?: string;
  /** Modal / preferred state from prior US jobs for this company (injected by caller). */
  companyHistoricalStates?: string[];
};

export type LocationResolveResult = {
  frozenStates: string[];
  frozenCities: FrozenCityRef[];
  locationIsRemote: boolean;
  locationIsUs: boolean;
  method: LocationResolveMethod;
  confidence: number;
  rulesVersion: string;
  candidates?: Array<{ city: string; state: string; population: number }>;
};

function taxonomyKey(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/\./g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isFrozenUsStateCode(value: string): value is FrozenUsStateCode {
  return STATE_BY_CODE.has(String(value || '').toUpperCase());
}

export function stateCodeToLabel(code: string, opts?: { short?: boolean }): string {
  const meta = STATE_BY_CODE.get(String(code || '').toUpperCase());
  if (!meta) return String(code || '').trim();
  if (opts?.short !== false && meta.shortName) return meta.shortName;
  return meta.name;
}

export function stateCodeToName(code: string): string {
  return stateCodeToLabel(code, { short: false });
}

/** Normalize filter query values to USPS codes. */
export function normalizeFrozenStateFilter(raw: unknown): string[] {
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(',')
      : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const code = canonicalizeStateToken(String(v || ''));
    if (!code || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}

export function canonicalizeStateToken(raw: string): FrozenUsStateCode | null {
  const t = String(raw || '').trim();
  if (!t) return null;
  if (t.length === 2 && isFrozenUsStateCode(t.toUpperCase())) {
    return t.toUpperCase() as FrozenUsStateCode;
  }
  return STATE_NAME_TO_CODE.get(taxonomyKey(t)) || null;
}

const NON_US_COUNTRY_RE =
  /\b(united\s+kingdom|u\.?k\.?|england|scotland|wales|canada|ontario|quebec|british\s+columbia|india|germany|france|australia|singapore|ireland|netherlands|mexico|brazil|china|japan|spain|italy|sweden|switzerland|poland|philippines|pakistan|bangladesh|nigeria|south\s+africa|new\s+zealand|hong\s+kong|uae|dubai|israel|korea|taiwan|vietnam|thailand|indonesia|malaysia|argentina|chile|colombia|peru|egypt|turkey|austria|belgium|denmark|norway|finland|portugal|greece|czech|romania|hungary|ukraine|russia|slovenia|croatia|serbia|slovakia|lithuania|latvia|estonia|iceland|portugal)\b/i;

/** Well-known non-US cities — mark non-US only (no city/state chips).
 * Prefer names uncommon as bare US postings; ambiguous US twins (London KY, Paris TX)
 * still usually mean the international city when no state is present on a global board.
 */
const NON_US_CITY_RE =
  /\b(london|paris|berlin|munich|amsterdam|dublin|toronto|vancouver|montreal|sydney|melbourne|auckland|tokyo|osaka|seoul|beijing|shanghai|hong\s+kong|singapore|mumbai|bangalore|bengaluru|hyderabad|pune|chennai|delhi|new\s+delhi|kolkata|sao\s+paulo|s[aã]o\s+paulo|rio\s+de\s+janeiro|mexico\s+city|buenos\s+aires|santiago|bogota|lima|zurich|geneva|stockholm|copenhagen|oslo|helsinki|warsaw|prague|budapest|lisbon|madrid|barcelona|milan|rome|tel\s+aviv|dubai|abu\s+dhabi|johannesburg|cape\s+town|nairobi|lagos|manila|makati|makati\s+city|jakarta|bangkok|taipei|belagavi|doha|qatar|sant\s+cugat|leiden|santa\s+catarina)\b/i;

const US_COUNTRY_RE =
  /\b(united\s+states(?:\s+of\s+america)?|u\.?\s*s\.?\s*a?\.?|u\.?\s*s\.?)\b/i;

const REMOTE_ONLY_RE =
  /^\s*(remote(?:\s*[-–—/]\s*(?:usa|u\.?s\.?a?\.?|united\s+states|us))?|remote\s*\(\s*(?:usa|u\.?s\.?a?\.?|united\s+states|us)\s*\)|remote\s*[-–—]\s*|work\s+from\s+home|wfh|fully\s+remote|100%\s*remote)\s*$/i;

const REMOTE_TOKEN_RE =
  /\b(remote|work\s+from\s+home|wfh)\b/i;

/** Hybrid / flexible with no site listed — treat like remote-US for cluster filters. */
const HYBRID_TOKEN_RE = /\b(hybrid|flexible\s+location|flex\s+location)\b/i;

const TERRITORY_STANDALONE: Record<string, FrozenUsStateCode> = {
  guam: 'GU',
  'puerto rico': 'PR',
  'american samoa': 'AS',
  samoa: 'AS',
  'virgin islands': 'VI',
  'us virgin islands': 'VI',
  'u s virgin islands': 'VI',
  'northern mariana islands': 'MP',
  'northern marianas': 'MP',
};

/** Common "X County" → state when no city/state otherwise. */
const COUNTY_TO_STATE: Record<string, FrozenUsStateCode> = {
  'citrus county': 'FL',
  'wake county': 'NC',
  'richland county': 'SC',
  'fairfax county': 'VA',
  'montgomery county': 'MD',
  'king county': 'WA',
  'cook county': 'IL',
  'los angeles county': 'CA',
  'orange county': 'CA',
  'santa clara county': 'CA',
  'travis county': 'TX',
  'harris county': 'TX',
  'maricopa county': 'AZ',
};

function splitLocationSites(raw: string): string[] {
  let parts = String(raw || '')
    .split(/\s*[|·•/;]\s*|\s+\/\s+|\s+and\s+|\s+or\s+/i)
    .map((p) => p.trim().replace(/\s+(?:or|and)\s*$/i, '').trim())
    .filter((p) => p.length > 1);

  // "NYC, Chicago, Seattle, San Francisco" (city list, no state tokens)
  if (parts.length === 1 && /,/.test(parts[0]!)) {
    const commas = parts[0]!
      .split(/\s*,\s*/)
      .map((p) => p.trim())
      .filter((p) => p.length > 1);
    const hasStateToken = commas.some(
      (c) => /^[A-Za-z]{2}$/.test(c) || !!canonicalizeStateToken(c)
    );
    if (commas.length >= 2 && !hasStateToken) {
      parts = commas;
    }
  }

  return parts;
}

function stripCountrySuffix(value: string): string {
  return value
    .replace(
      /(?:,\s*)?(?:united\s+states(?:\s+of\s+america)?|usa|u\.s\.a\.?|u\.s\.|\bus\b)\s*$/i,
      ''
    )
    .replace(/\s+,/g, ',')
    .replace(/,\s*$/g, '')
    .trim();
}

/** "United States, Washington, Redmond" → "Washington, Redmond" handled separately. */
function stripCountryPrefix(value: string): string {
  return value
    .replace(
      /^(?:united\s+states(?:\s+of\s+america)?|usa|u\.?\s*s\.?\s*a\.?|u\.?\s*s\.?)\s*,\s*/i,
      ''
    )
    .trim();
}

type SiteParse = {
  city?: string;
  state?: FrozenUsStateCode;
  zip?: string;
  remote?: boolean;
  nonUs?: boolean;
  displayCity?: string;
};

function parseOneSite(raw: string): SiteParse {
  let value = decodeBasic(String(raw || '').trim());
  if (!value) return {};

  if (REMOTE_ONLY_RE.test(value)) return { remote: true };

  // "US West Coast (Bay Area strongly preferred)" / "Bay Area"
  if (/\bbay\s+area\b/i.test(value) || /\b(?:us\s+)?west\s+coast\b/i.test(value)) {
    return { state: 'CA', remote: REMOTE_TOKEN_RE.test(value) };
  }

  // "Work At Home-New Jersey" / "Work At Home - Texas"
  const wfhState = value.match(/^work\s+at\s+home\s*[-–—:]\s*(.+)$/i);
  if (wfhState) {
    const st = canonicalizeStateToken(wfhState[1]!.trim());
    if (st) return { state: st, remote: true };
  }

  // "Hybrid (Austin, TX)" / "Hybrid - Austin, TX" / "New York Office"
  const hadHybrid = HYBRID_TOKEN_RE.test(value);
  value = value.replace(HYBRID_TOKEN_RE, ' ').replace(/\s+/g, ' ').trim();
  const wrapped = value.match(/^\((.+)\)$/);
  if (wrapped) value = wrapped[1]!.trim();
  value = value.replace(/\s+(office|hq|headquarters|campus)\s*$/i, '').trim();
  if (!value) return hadHybrid ? { remote: true } : {};

  // "Strella HQ (New York City)" / "Something HQ (Austin)"
  const hqParen = value.match(/\bhq\b.*\(([^)]+)\)\s*$/i) || value.match(/^(.+?)\s+hq\s*\(([^)]+)\)\s*$/i);
  if (hqParen) {
    value = String(hqParen[hqParen.length - 1] || '').trim();
  }

  // "Irving-Irving Corporate Office-3939 West John Carpenter Freeway" → Irving
  const dupCityOffice = value.match(/^([A-Za-z .]{2,40})-\1\b/i);
  if (dupCityOffice) {
    value = dupCityOffice[1]!.trim();
  } else {
    // "City-Street/Office…" when first token is a known unique US city
    const head = value.split(/[-–—]/)[0]?.trim() || '';
    if (
      head.length >= 3 &&
      head.length <= 40 &&
      /[-–—]/.test(value) &&
      !/^[A-Za-z]{2}$/.test(head)
    ) {
      const cands = lookupCityCandidates(head);
      if (cands.length === 1) {
        value = head;
      }
    }
  }

  // "U.S. - New York" / "USA - California" / "US – Texas"
  const usDashPlace = value.match(
    /^(?:u\.?\s*s\.?\s*a?\.?|united\s+states)\s*[-–—:]\s*(.+)$/i
  );
  if (usDashPlace) {
    value = usDashPlace[1]!.trim();
  }

  // "Whitestown, IN, USA > IN > Lebanon > Route 267" → prefer City, ST head
  if (/\s*>\s*/.test(value)) {
    const head = value.split(/\s*>\s*/)[0]!.trim();
    const headStripped = stripCountrySuffix(head);
    if (
      /,\s*[A-Za-z]{2}\b/.test(headStripped) ||
      /,\s*[A-Za-z][A-Za-z .']{2,}$/.test(headStripped)
    ) {
      value = headStripped;
    }
  }

  // "Dallas, TX - Uptown" / "Summerville, SC - Summerville Branch (…)"
  value = value
    .replace(
      /,\s*([A-Za-z]{2}|[A-Za-z][A-Za-z .']{2,})\s*[-–—]\s*.+$/i,
      ', $1'
    )
    .trim();

  // Non-US country or well-known non-US city → non-US only (no state/city chips).
  // Skip when a US state/code is present ("Brisbane, California").
  if (
    (NON_US_COUNTRY_RE.test(value) || NON_US_CITY_RE.test(value)) &&
    !US_COUNTRY_RE.test(value)
  ) {
    const trailingState = value.match(/,\s*([A-Za-z]{2}|[A-Za-z][A-Za-z .']+)\s*$/);
    const trailingIsUsState =
      !!trailingState && !!canonicalizeStateToken(String(trailingState[1] || ''));
    if (!trailingIsUsState) {
      return { nonUs: true };
    }
  }

  const territory = TERRITORY_STANDALONE[taxonomyKey(value)];
  if (territory) return { state: territory, displayCity: value };

  const countyKey = taxonomyKey(value);
  if (COUNTY_TO_STATE[countyKey]) {
    return { state: COUNTY_TO_STATE[countyKey] };
  }
  const countyMatch = value.match(/^(.+?\s+county)\b/i);
  if (countyMatch) {
    const ck = taxonomyKey(countyMatch[1]!);
    if (COUNTY_TO_STATE[ck]) return { state: COUNTY_TO_STATE[ck] };
  }

  // ZIP alone or trailing
  const zipOnly = value.match(/^\s*(\d{5})(?:-\d{4})?\s*$/);
  if (zipOnly) return { zip: zipOnly[1] };

  // Country-first: "United States, Washington, Redmond" or "USA, CA, San Francisco"
  const countryFirst = value.match(
    /^(?:united\s+states(?:\s+of\s+america)?|usa|u\.?\s*s\.?\s*a\.?|u\.?\s*s\.?)\s*,\s*([A-Za-z][A-Za-z .']+?)(?:\s*,\s*(.+))?$/i
  );
  if (countryFirst) {
    const state = canonicalizeStateToken(countryFirst[1]!);
    if (state) {
      const cityRaw = String(countryFirst[2] || '').trim();
      if (cityRaw) {
        return {
          city: normalizeCityKey(cityRaw),
          displayCity: titleCaseCity(cityRaw),
          state,
        };
      }
      return { state };
    }
  }

  // Workday-ish "CA-San Diego" / "WA-Redmond"
  const stCityHyphen = value.match(/^([A-Za-z]{2})\s*[-–—]\s*(.+)$/);
  if (stCityHyphen && isFrozenUsStateCode(stCityHyphen[1]!.toUpperCase())) {
    const state = stCityHyphen[1]!.toUpperCase() as FrozenUsStateCode;
    const cityRaw = stCityHyphen[2]!.trim();
    return {
      city: normalizeCityKey(cityRaw),
      displayCity: titleCaseCity(cityRaw),
      state,
    };
  }

  // "New York-161 Ave of the Americas" / "Chicago-123 Main St"
  const cityStreet = value.match(
    /^(New\s+York|Los\s+Angeles|San\s+Francisco|San\s+Jose|San\s+Diego|Chicago|Houston|Dallas|Austin|Seattle|Boston|Denver|Atlanta|Miami|Philadelphia|Phoenix|Washington)\s*[-–—]\s*\d/i
  );
  if (cityStreet) {
    const cityRaw = cityStreet[1]!.trim();
    const alone = canonicalizeStateToken(cityRaw);
    if (alone) return { state: alone, displayCity: titleCaseCity(cityRaw) };
    return {
      city: normalizeCityKey(cityRaw),
      displayCity: titleCaseCity(cityRaw),
    };
  }

  // Workday path: "USA > KY > Brooks > 345 International" or "US > CA > San Jose"
  const pathParts = value
    .split(/\s*>\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (pathParts.length >= 2) {
    const maybeCountry = pathParts[0]!;
    const startIdx =
      /^(?:usa|u\.?s\.?a?\.?|united\s+states)$/i.test(maybeCountry) ? 1 : 0;
    if (startIdx < pathParts.length) {
      const stateTok = pathParts[startIdx]!;
      const state = canonicalizeStateToken(stateTok);
      if (state) {
        const cityRaw = pathParts[startIdx + 1] || '';
        // Skip street-like segments (leading digits)
        const city =
          cityRaw && !/^\d/.test(cityRaw)
            ? cityRaw
            : '';
        if (city) {
          return {
            city: normalizeCityKey(city),
            displayCity: titleCaseCity(city),
            state,
          };
        }
        return { state };
      }
    }
  }

  value = stripCountryPrefix(stripCountrySuffix(value));

  // City, ST ZIP
  const cityStZip = value.match(
    /^(.+?),\s*([A-Za-z]{2}|[A-Za-z][A-Za-z .']+?)\s*,?\s*(\d{5})(?:-\d{4})?\s*$/
  );
  if (cityStZip) {
    const state = canonicalizeStateToken(cityStZip[2]!);
    if (state) {
      return {
        city: normalizeCityKey(cityStZip[1]!),
        displayCity: titleCaseCity(cityStZip[1]!),
        state,
        zip: cityStZip[3],
      };
    }
  }

  // City, ST or City, State Name
  const citySt = value.match(/^(.+?),\s*([A-Za-z][A-Za-z .']+)$/);
  if (citySt) {
    const state = canonicalizeStateToken(citySt[2]!);
    if (state) {
      return {
        city: normalizeCityKey(citySt[1]!),
        displayCity: titleCaseCity(citySt[1]!),
        state,
      };
    }
    // City, Country (non-US)
    if (NON_US_COUNTRY_RE.test(citySt[2]!)) {
      return { nonUs: true };
    }
  }

  // Trailing ZIP in free text
  const zipTrail = value.match(/\b(\d{5})(?:-\d{4})?\b/);
  if (zipTrail) {
    const before = value.replace(zipTrail[0], '').replace(/[,\s]+$/g, '').trim();
    const st = before.match(/,\s*([A-Za-z]{2})\s*$/);
    if (st && isFrozenUsStateCode(st[1]!.toUpperCase())) {
      const cityPart = before.replace(/,\s*[A-Za-z]{2}\s*$/, '').trim();
      return {
        city: normalizeCityKey(cityPart),
        displayCity: titleCaseCity(cityPart),
        state: st[1]!.toUpperCase() as FrozenUsStateCode,
        zip: zipTrail[1],
      };
    }
    return {
      zip: zipTrail[1],
      city: before ? normalizeCityKey(before) : undefined,
      displayCity: before ? titleCaseCity(before) : undefined,
    };
  }

  // State name / code alone
  const aloneState = canonicalizeStateToken(value);
  if (aloneState && taxonomyKey(value).length <= 20) {
    // Avoid treating short city names that collide — only if exact state name/code
    const key = taxonomyKey(value);
    if (
      key.length === 2 ||
      STATE_NAME_TO_CODE.has(key) ||
      TERRITORY_STANDALONE[key]
    ) {
      return { state: aloneState };
    }
  }

  // Bare city (possibly with remote token)
  const cleaned = value.replace(REMOTE_TOKEN_RE, '').replace(/[,\-/]+/g, ' ').trim();
  if (!cleaned) return { remote: true };
  return {
    city: normalizeCityKey(cleaned),
    displayCity: titleCaseCity(cleaned),
    remote: REMOTE_TOKEN_RE.test(value),
  };
}

function decodeBasic(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

function titleCaseCity(raw: string): string {
  return String(raw || '')
    .trim()
    .split(/\s+/)
    .map((w) => {
      if (/^(of|the|and|de|la|los|las|san|santa)$/i.test(w)) {
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      }
      if (/^[A-Z]{2,}$/.test(w) && w.length <= 4) return w; // NYC, SF
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

function emptyResult(
  method: LocationResolveMethod,
  extras?: Partial<LocationResolveResult>
): LocationResolveResult {
  return {
    frozenStates: [],
    frozenCities: [],
    locationIsRemote: false,
    locationIsUs: method !== 'non_us',
    method,
    confidence: 0,
    rulesVersion: LOCATION_RULES_VERSION,
    ...extras,
  };
}

function pickDominant(
  candidates: Array<{ state: string; population: number; name: string }>
): { state: FrozenUsStateCode; name: string; population: number } | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => b.population - a.population);
  const top = sorted[0]!;
  const second = sorted[1];
  if (!second) {
    return {
      state: top.state as FrozenUsStateCode,
      name: top.name,
      population: top.population,
    };
  }
  if (top.population >= second.population * CITY_POPULATION_DOMINANCE_RATIO) {
    return {
      state: top.state as FrozenUsStateCode,
      name: top.name,
      population: top.population,
    };
  }
  return null;
}

/**
 * Resolve free-text location (+ optional company context) into frozen US geography.
 */
export function resolveFrozenLocation(input: LocationResolveInput): LocationResolveResult {
  const location = String(input.location || '').trim();
  const remoteType = String(input.remoteType || '').trim();
  const companyName = String(input.companyName || '').trim();

  const tryCompanyHq = (): LocationResolveResult | null => {
    const hqRaw = resolveCompanyHqState(companyName);
    const hq = hqRaw && isFrozenUsStateCode(hqRaw) ? (hqRaw as FrozenUsStateCode) : null;
    if (!hq) return null;
    return {
      frozenStates: [hq],
      frozenCities: [],
      locationIsRemote: REMOTE_TOKEN_RE.test(remoteType) || HYBRID_TOKEN_RE.test(remoteType),
      locationIsUs: true,
      method: 'company_hq',
      confidence: 0.65,
      rulesVersion: LOCATION_RULES_VERSION,
    };
  };

  if (!location && !remoteType) {
    return tryCompanyHq() || emptyResult('none');
  }

  // Remote / hybrid type alone with empty location
  if (!location && (REMOTE_TOKEN_RE.test(remoteType) || HYBRID_TOKEN_RE.test(remoteType))) {
    const hq = tryCompanyHq();
    if (hq) return hq;
    return emptyResult('remote', {
      locationIsRemote: true,
      locationIsUs: true,
      confidence: 0.85,
    });
  }

  const sites = location ? splitLocationSites(location) : [];
  if (sites.length === 0 && location) {
    sites.push(location);
  }

  // Entire string is remote-only
  if (sites.length === 1 && REMOTE_ONLY_RE.test(sites[0]!)) {
    return emptyResult('remote', {
      locationIsRemote: true,
      locationIsUs: true,
      confidence: 0.95,
    });
  }

  const states: FrozenUsStateCode[] = [];
  const cities: FrozenCityRef[] = [];
  const methods: LocationResolveMethod[] = [];
  let anyRemote = false;
  let anyNonUs = false;
  let anyUsSignal = false;
  let ambiguousCandidates: LocationResolveResult['candidates'];
  let confidence = 0;

  const pushState = (code: FrozenUsStateCode, method: LocationResolveMethod, conf: number) => {
    anyUsSignal = true;
    if (!states.includes(code)) states.push(code);
    methods.push(method);
    confidence = Math.max(confidence, conf);
  };

  const pushCity = (name: string, state: FrozenUsStateCode) => {
    const key = `${normalizeCityKey(name)}|${state}`;
    if (cities.some((c) => `${normalizeCityKey(c.name)}|${c.state}` === key)) return;
    cities.push({ name, state });
  };

  for (const site of sites) {
    const parsed = parseOneSite(site);

    if (parsed.nonUs) {
      anyNonUs = true;
      methods.push('non_us');
      continue;
    }
    if (parsed.remote && !parsed.city && !parsed.state && !parsed.zip) {
      anyRemote = true;
      methods.push('remote');
      continue;
    }
    if (parsed.remote) anyRemote = true;

    if (parsed.state) {
      pushState(parsed.state, 'explicit_state', 0.99);
      if (parsed.displayCity || parsed.city) {
        pushCity(parsed.displayCity || titleCaseCity(parsed.city!), parsed.state);
      }
      continue;
    }

    if (parsed.zip) {
      const zipState = lookupZipState(parsed.zip);
      if (zipState && isFrozenUsStateCode(zipState)) {
        pushState(zipState, 'zip', 0.95);
        if (parsed.displayCity || parsed.city) {
          pushCity(parsed.displayCity || titleCaseCity(parsed.city!), zipState);
        }
        continue;
      }
    }

    if (parsed.city) {
      const candidates: CityCandidate[] = lookupCityCandidates(parsed.city);
      if (candidates.length === 1) {
        const only = candidates[0]!;
        pushState(only.state as FrozenUsStateCode, 'unique_city', 0.9);
        pushCity(only.name, only.state as FrozenUsStateCode);
        continue;
      }
      if (candidates.length > 1) {
        const dominant = pickDominant(candidates);
        if (dominant) {
          pushState(dominant.state, 'population', 0.75);
          pushCity(dominant.name, dominant.state);
          continue;
        }

        // Company HQ tie-break
        const hqRaw = resolveCompanyHqState(input.companyName || '');
        const hq =
          hqRaw && isFrozenUsStateCode(hqRaw) ? (hqRaw as FrozenUsStateCode) : null;
        if (hq && candidates.some((c: CityCandidate) => c.state === hq)) {
          pushState(hq, 'company_hq', 0.7);
          const match = candidates.find((c: CityCandidate) => c.state === hq)!;
          pushCity(match.name, hq);
          continue;
        }

        // Company history modal state
        const hist = (input.companyHistoricalStates || [])
          .map((s) => canonicalizeStateToken(s))
          .filter((s): s is FrozenUsStateCode => !!s);
        const histHit = hist.find((s) =>
          candidates.some((c: CityCandidate) => c.state === s)
        );
        if (histHit) {
          pushState(histHit, 'company_history', 0.65);
          const match = candidates.find((c: CityCandidate) => c.state === histHit)!;
          pushCity(match.name, histHit);
          continue;
        }

        ambiguousCandidates = candidates.map((c: CityCandidate) => ({
          city: c.name,
          state: c.state,
          population: c.population,
        }));
        methods.push('ambiguous');
        continue;
      }

      // Unknown city — no guess
      methods.push('none');
    }
  }

  // Remote type with US sites still US; remote-only if no states resolved
  if (REMOTE_TOKEN_RE.test(remoteType)) anyRemote = true;

  if (anyNonUs && !anyUsSignal) {
    return emptyResult('non_us', {
      locationIsUs: false,
      locationIsRemote: anyRemote,
      confidence: 0.9,
    });
  }

  if (states.length === 0) {
    if (anyRemote && !anyNonUs) {
      return emptyResult('remote', {
        locationIsRemote: true,
        locationIsUs: true,
        confidence: 0.85,
        candidates: ambiguousCandidates,
      });
    }
    if (ambiguousCandidates?.length) {
      return emptyResult('ambiguous', {
        locationIsRemote: anyRemote,
        locationIsUs: true,
        confidence: 0,
        candidates: ambiguousCandidates,
      });
    }
    const hqFallback = tryCompanyHq();
    if (hqFallback && !anyNonUs) return hqFallback;
    // "United States" / USA alone
    if (US_COUNTRY_RE.test(location) && !NON_US_COUNTRY_RE.test(location)) {
      return emptyResult('none', {
        locationIsUs: true,
        locationIsRemote: anyRemote,
        confidence: 0.5,
      });
    }
    return emptyResult(methods.includes('non_us') ? 'non_us' : 'none', {
      locationIsUs: !anyNonUs,
      locationIsRemote: anyRemote,
      candidates: ambiguousCandidates,
    });
  }

  // Pick primary method (strongest used)
  const methodRank: LocationResolveMethod[] = [
    'explicit_state',
    'zip',
    'unique_city',
    'population',
    'company_hq',
    'company_history',
  ];
  const method =
    methodRank.find((m) => methods.includes(m)) ||
    (methods[0] as LocationResolveMethod) ||
    'explicit_state';

  // Remote-only means no fixed site states. Hybrid "Remote · Austin, TX" keeps TX and is not remote-only.
  const locationIsRemote = states.length === 0 && anyRemote;

  return {
    frozenStates: states,
    frozenCities: cities,
    locationIsRemote,
    locationIsUs: true,
    method,
    confidence,
    rulesVersion: LOCATION_RULES_VERSION,
    candidates: ambiguousCandidates,
  };
}

/** Public entry used by enrichment. */
export function classifyJobLocation(input: LocationResolveInput): LocationResolveResult {
  return resolveFrozenLocation(input);
}

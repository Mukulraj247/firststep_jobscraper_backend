/**
 * Job-title → frozen industry hints.
 *
 * Used when the employer company map would mis-tag the *role*. Classic case:
 * McKesson is a healthcare distributor, so company_exact → Healthcare, but a
 * "Lead Salesforce Platform Architect" is a Software / SaaS job. Filtering
 * Healthcare must not surface every IT opening at a healthcare employer.
 *
 * Precedence in resolveFrozenIndustries:
 *   sectorIndustry selector > role title > company map > aggregator hints
 *
 * Keep patterns high-precision. Prefer missing over a wrong override.
 */
import type { FrozenIndustry } from './frozenIndustries';

type IndustryList = FrozenIndustry | [FrozenIndustry, FrozenIndustry];

export type RoleIndustryMethod = 'role_title';

export type RoleIndustryResult = {
  industries: FrozenIndustry[];
  method: RoleIndustryMethod | null;
};

const EMPTY: RoleIndustryResult = { industries: [], method: null };

function toList(value: IndustryList): FrozenIndustry[] {
  return Array.isArray(value) ? [...value] : [value];
}

/**
 * Ordered: first match wins. More specific patterns before broad ones.
 */
const ROLE_INDUSTRY_HINTS: Array<{ re: RegExp; industries: IndustryList }> = [
  // --- Clinical / care delivery (reinforce Healthcare even at retail pharmacies) ---
  {
    re: /\b(pharmacist|pharmacy\s*tech(?:nician)?|pharm(?:acy)?\s*tech(?:nician)?|physician|surgeon|nurse(?:\s+practitioner)?|\brn\b|\blpn\b|\bcna\b|medical\s+assistant|clinician|therapist|radiolog|oncolog|cardiolog|anesthesi|paramedic|emt\b|dental\s+hygien|optometrist|ambulatory\s+surgery|surgery\s+center)\b/i,
    industries: 'Healthcare',
  },
  {
    re: /\b(healthcare\s+sales|pharma(?:ceutical)?\s+sales|medical\s+device\s+sales|clinical\s+sales|hospital\s+sales)\b/i,
    industries: 'Healthcare',
  },

  // --- Explicit platform / SaaS engineering (overrides employer industry) ---
  {
    re: /\b(salesforce|servicenow|workday|snowflake|databricks|palantir)\b/i,
    industries: 'Software / SaaS',
  },
  {
    re: /\b(software|platform|devops|site\s+reliability|sre|full[\s-]?stack|back[\s-]?end|front[\s-]?end|cloud|data|machine\s+learning|ml|ai)\s+(engineer|developer|architect)\b/i,
    industries: 'Software / SaaS',
  },
  {
    re: /\b(engineer|developer|architect)\b.*\b(software|platform|devops|cloud|salesforce)\b/i,
    industries: 'Software / SaaS',
  },
  {
    re: /\b(enterprise|solutions?|cloud|software|platform|systems?|it|technical)\s+architect\b/i,
    industries: 'Software / SaaS',
  },
  {
    re: /\b(it\s+project\s+manager|technical\s+project\s+manager|chef\s+de\s+projet\s+informatique|scrum\s+master|product\s+owner)\b/i,
    industries: 'Software / SaaS',
  },
  {
    re: /\b(data\s+engineer|data\s+scientist|analytics\s+engineer|mlops|machine\s+learning\s+engineer)\b/i,
    industries: 'Software / SaaS',
  },
  {
    re: /\b(software\s+engineer|platform\s+engineer|devops\s+engineer|sre\b|site\s+reliability)\b/i,
    industries: 'Software / SaaS',
  },

  // --- Logistics / driving (CVS truck driver ≠ Healthcare filter) ---
  {
    re: /\b(truck\s+driver|cdl\b|class\s+a\s+driver|delivery\s+driver|courier\s+driver)\b/i,
    industries: 'Logistics / Supply Chain',
  },
  {
    re: /\b(warehouse|fulfillment|forklift|material\s+handler|picker|packer)\b/i,
    industries: 'Logistics / Supply Chain',
  },

  // --- Finance role at non-finance employers ---
  {
    re: /\b(investment\s+bank|equity\s+research|quantitative\s+trader|portfolio\s+manager)\b/i,
    industries: 'Financial Services',
  },
];

/**
 * Resolve industries from a job title. Returns empty when the title has no
 * clear industry signal — callers then fall through to the company map.
 */
export function resolveIndustryFromTitle(title: string): RoleIndustryResult {
  const t = String(title || '').trim();
  if (!t || t.length < 3) return EMPTY;

  for (const rule of ROLE_INDUSTRY_HINTS) {
    if (rule.re.test(t)) {
      return { industries: toList(rule.industries), method: 'role_title' };
    }
  }
  return EMPTY;
}

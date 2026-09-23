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
    re: /\b(software\s+engineer|platform\s+engineer|devops\s+engineer|sre\b|site\s+reliability|software\s+development\s+engineer|\bsde\b)\b/i,
    industries: 'Software / SaaS',
  },
  // Broader eng / security / PM titles common on Accel list rows
  {
    re: /\b(devsecops|secops|appsec|infosec|cyber\s*security|security\s+(?:engineer|researcher|architect|analyst)|network\s+defense)\b/i,
    industries: 'Cybersecurity',
  },
  {
    re: /\b(ml|ai|machine\s+learning|gen\s*ai|llm)\b.*\b(engineer|consultant|researcher|scientist|architect)\b|\b(engineer|consultant|researcher)\b.*\b(ml|ai|machine\s+learning)\b/i,
    industries: 'Software / SaaS',
  },
  {
    re: /\b(technical\s+program\s+manager|\btpm\b|program\s+manager|product\s+manager|engineering\s+manager)\b/i,
    industries: 'Software / SaaS',
  },
  {
    re: /\b(microservices|full[\s-]?stack|front[\s-]?end|back[\s-]?end)\s+(developer|engineer)\b|\b(developer|engineer)\b.*\bmicroservices\b/i,
    industries: 'Software / SaaS',
  },
  {
    re: /\b(systems?\s+engineer|it\s+support|support\s+specialist|bpm\s+engineer|systems?\s+analyst|systems?\s+administrator|help\s+desk|helpdesk|desktop\s+support|it\s+infrastructure)\b/i,
    industries: 'Software / SaaS',
  },
  {
    re: /\b(rust|golang|go|java|python|kotlin|scala)\s+(developer|engineer)\b|\b(developer|engineer)\b.*\b(rust|golang)\b/i,
    industries: 'Software / SaaS',
  },
  {
    re: /\b(gtm\s+engineer|founding\s+.*engineer|revenue\s+operations|sales\s+operations|revops|salesops)\b/i,
    industries: 'Software / SaaS',
  },
  {
    re: /\b(cloud\s+infrastructure|infrastructure\s+team\s+lead|team\s+lead,?\s+cloud)\b/i,
    industries: ['Cloud Infrastructure', 'Software / SaaS'],
  },
  {
    re: /\b(ciso|chief\s+information\s+security\s+officer)\b/i,
    industries: 'Cybersecurity',
  },
  {
    re: /\b(devops|platform\s+devops|escalations?\s+engineer|vision\s+controls?\s+engineer|geotechnical\s+engineer|ai\/?agentic\s+engineer|agentic\s+engineer)\b/i,
    industries: 'Software / SaaS',
  },
  {
    re: /\b(head\s+of\s+data|data\s+engineering|platform\s+engineering|technical\s+security)\b/i,
    industries: 'Software / SaaS',
  },
  {
    re: /\b(iam\s+engineer|security\s+operations|fedramp|robotics|forward\s+deployed|applications?\s+engineer|application\s+developer|product\s+engineer|research\s+engineer|hardware\s+engineer|design\s+engineer)\b/i,
    industries: 'Software / SaaS',
  },
  {
    re: /\b(ios|android|mobile|web|full[\s-]?stack|frontend|backend|site\s+support|staff\s+engineer)\b.*\b(engineer|developer|advisor)\b|\b(engineer|developer)\b.*\b(ios|android|mobile|web)\b/i,
    industries: 'Software / SaaS',
  },
  {
    re: /\b(software\s+engineering|application\s+development|ai\s*&\s*application|mgr,?\s*ai|manager,?\s*software)\b/i,
    industries: 'Software / SaaS',
  },
  {
    re: /\b(business\s+intelligence|\bbi\b|tableau|power\s*bi|data\s+operations|implementation\s+engineer|build\s+engineer|firmware|controls?\s+engineer|support\s+engineer|technical\s+support|customer\s+support\s+engineer|2nd\s+line\s+support|database\/?interfaces?\s+developer|azure\s+sql|azure\s+devops|node\.?js|typescript\s+engineer|payments?\s+engineer|sdet\b)\b/i,
    industries: 'Software / SaaS',
  },
  {
    re: /\b(programmer|syteline|cloudops|integration\s+architect|solutions?\s+architecture|technology\s+lead|electronic\s+trading)\b/i,
    industries: 'Software / SaaS',
  },
  {
    re: /\b(ai\s+application|analytics\s+software|sap\s+integration|computer\s+system)\b/i,
    industries: 'Software / SaaS',
  },
  {
    re: /\b(reinsurance|insurance\s+analyst)\b/i,
    industries: 'Insurance',
  },
  {
    re: /\b(restaurant\s+operations|restaurant\s+manager)\b/i,
    industries: 'Food & Beverage',
  },
  {
    re: /\b(water\s*&\s*wastewater|wastewater|mep\s+manager|construction\s+analyst)\b/i,
    industries: 'Construction & Engineering',
  },
  {
    re: /\b(electrical\s+engineer|stormwater\s+engineer|civil\s+engineer)\b/i,
    industries: 'Construction & Engineering',
  },
  {
    re: /\b(hotel|hospitality|front\s+desk|resort)\b/i,
    industries: 'Travel & Hospitality',
  },
  {
    re: /\b(yield\s+engineer|process\s+engineer|manufacturing\s+engineer|mechanical\s+engineer|mechanical\s+design|mechanical\s+architecture)\b/i,
    industries: 'Manufacturing',
  },
  {
    re: /\b(?:senior\s+|staff\s+)?accountant\b/i,
    industries: 'Financial Services',
  },
  {
    re: /\b(counsel|attorney|contracts?\s+&\s+distribution)\b/i,
    industries: 'Legal',
  },
  {
    re: /\b(clean\s+energy|energy\s+mechanical)\b/i,
    industries: 'Energy / Oil & Gas',
  },
  {
    re: /\b(network\s+(?:developer|engineer)|systems?\s+analysis|value\s+engineer|data\s+center|core\s+infrastructure|infrastructure\s+(?:engineer|sourcing))\b/i,
    industries: ['Cloud Infrastructure', 'Software / SaaS'],
  },
  {
    re: /\b(sfdc|salesforce)\b|\btechnical\s+architect\b|\bmodeling\s+architect\b/i,
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
  // --- Category QA residuals (title has clear industry signal) ---
  {
    re: /\b(uipath|rpa\s+developer|power\s+platform\s+developer)\b/i,
    industries: 'Software / SaaS',
  },
  {
    re: /\b(application\s+support|site\s+support|director\s+of\s+application\s+support|hbss\s+administrator|techops)\b/i,
    industries: 'Software / SaaS',
  },
  {
    re: /\b(sales\s+engineer|principal\s+sales\s+engineer|solutions?\s+engineer)\b/i,
    industries: 'Software / SaaS',
  },
  {
    re: /\b(data\s+analyst|senior\s+data\s+analyst|business\s+data\s+steward|risk\s+statistician|collections?\s+strategy\s+analyst)\b/i,
    industries: 'Software / SaaS',
  },
  {
    re: /\b(security\s+incident\s+response|identity\s+(?:&|and)\s+access\s+management|\biam\b\s+specialist)\b/i,
    industries: 'Cybersecurity',
  },
  {
    re: /\b(tax\s+manager|tax\s+expert|revenue\s+accountant)\b/i,
    industries: 'Financial Services',
  },
  {
    re: /\b(marketing\s+operations|lifecycle\s+marketing|digital\s+marketing)\b/i,
    industries: 'Marketing & Advertising',
  },
  {
    re: /\b(plant\s+manager|field\s+service\s+technician|i\/e\s+technician|materials?\s+management)\b/i,
    industries: 'Manufacturing',
  },
  {
    re: /\b(property\s+underwriter|underwriter)\b/i,
    industries: 'Insurance',
  },
  {
    re: /\b(staff\s+engineer|member\s+of\s+technical\s+staff|principal\s+engineer)\b/i,
    industries: 'Software / SaaS',
  },
  {
    re: /\b(engineering\s+project\s+manager|critical\s+facilities\s+project\s+manager)\b/i,
    industries: 'Construction & Engineering',
  },
  {
    re: /\b(radiology|surgery\s+database|clinical\s+nurse|nurse\s+manager)\b/i,
    industries: 'Healthcare',
  },
  {
    re: /\b(gis\s+analyst|data\s+quality|governance\s+analyst|pricing\s+analyst|performance\s+analyst|decision\s+intelligence)\b/i,
    industries: 'Software / SaaS',
  },
  {
    re: /\b(research\s+scientist|r&d\s+scientist|senior\s+research\s+scientist)\b/i,
    industries: 'Scientific Research',
  },
  {
    re: /\b(graduate\s+engineer|eit\b|project\s+engineer\s*[-–—]\s*mechanical|optomechanical|controls?\s+engineer|manufacturing\s+automation)\b/i,
    industries: 'Construction & Engineering',
  },
  {
    re: /\b(computer\s+systems?\s+technician|system\s+support\s+technician|field\s+services?\s+technician|resident\s+automation)\b/i,
    industries: 'Software / SaaS',
  },
  {
    re: /\b(quantitative\s+developer|ui\s+engineer|product\s+deployment\s+engineer|ai\s+network)\b/i,
    industries: 'Software / SaaS',
  },
  {
    re: /\b(technical\s+account\s+manager|enterprise\s+systems\s+manager)\b/i,
    industries: 'Software / SaaS',
  },
  {
    re: /\b(iot\s+engineer|it\s+developer|nav\s+i\/o|quality\s+engineer|test\s+engineer|firmware)\b/i,
    industries: 'Software / SaaS',
  },
  {
    re: /\b(imaging\s+analyst|clinical\s+informatics|care\s+operations)\b/i,
    industries: 'Healthcare',
  },
  {
    re: /\b(lab(?:oratory)?\s+scientist|lab(?:oratory)?\s+technician|translational\s+science|geochemistry)\b/i,
    industries: 'Scientific Research',
  },
  {
    re: /\b(insurance\s+product)\b/i,
    industries: 'Insurance',
  },
  {
    re: /\b(communications\s+manager|senior\s+communications)\b/i,
    industries: 'Marketing & Advertising',
  },
  {
    re: /\b(engineer\s+iii|supply\s+chain\s+and\s+test|pdm\s+technician|port\s+engineer)\b/i,
    industries: 'Manufacturing',
  },
  {
    re: /\b(wealth\s+advisor|mortgage|private\s+banking|investment\s+banking)\b/i,
    industries: 'Financial Services',
  },
  {
    re: /\b(pharmacist|pharmacy\s+tech|mri\s+tech|registered\s+nurse|\brn\b[- ]|patient\s+navigator)\b/i,
    industries: 'Healthcare',
  },
  {
    re: /\b(teller|banker|custodian)\b/i,
    industries: 'Banking',
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

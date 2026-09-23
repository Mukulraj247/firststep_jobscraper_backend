/**
 * Post-filter for frozen specialty (frozenCategories).
 *
 * Policy for cluster formation:
 *  - Never invent a chip the TITLE does not support (wrong chips poison clusters).
 *  - DO fill when the title clearly names a specialty (empty also hurts clusters).
 *
 * Applied in jobCategoryTagger.toResult so Category QA + enrichment stay aligned.
 */
import { FROZEN_JOB_CATEGORIES, canonicalFrozenCategory } from './frozenJobCategories';

export const SPECIALTY_OVERRIDE_VERSION = 'specialty-2026-09-16-coverage-v3';

const MAX_SPECIALTIES = 2;

/**
 * Titles outside frozen tech taxonomy — specialty stays empty.
 * (Industry can still tag Banking/Healthcare/etc.)
 */
const NON_TECH_TITLE_RE =
  /\b(teller|banker|custodian|janitor|landscape\s+tech|cashier|order\s+picker|material\s+handler|warehouse\s+(?:worker|associate)|delivery\s+(?:professional|driver)|truck\s+driver|chauffeur|emt\b|mri\s+tech|multimodality\s+tech|radiolog(?:y|ist)\s+tech|pharmacy\s+(?:tech|intern)|pharmacist(?!\s+intern)|wealth\s+advisor|mortgage\s+(?:loan\s+)?officer|home\s+equity|loan\s+processor|private\s+banking\s+officer|equipment\s+operator|forklift|picker|packer|area\s+manager|facilities\s+(?:service\s+)?manager|critical\s+facilities|data\s+center\s+(?:technician|facilities|commissioning|construction|operations|readiness|portfolio|delivery)|construction\s+manager|special\s+projects?\s+manager[\s-]*data\s+centers?)\b/i;

/**
 * Title evidence required to keep / force each specialty chip.
 * Broader than v15 so real tech titles fill for clustering, still title-grounded.
 */
export const SPECIALTY_TITLE_EVIDENCE: Record<string, RegExp> = {
  'Software Engineering':
    /\b(software\b[\w\s/,&().,-]{0,48}\b(engineer|developer|engineering)|applications?\s+development\s+engineer|application\s+developer|systems?\s+development\s+engineer|systems?\s+software|\bsw\s+(?:developer|engineer)|sde\b|swe\b|programmer|forward\s+deployed\s+engineer|tools?\s*(?:&|and)\s*automation\s+engineer|\bit\s+developer|quant\s+library\s+developer|esri\s+developer|syteline\s+developer|algorithm\s+engineer|distinguished\s+engineer)\b/i,
  'Frontend Development':
    /\b(frontend|front[\s-]?end|ui\s+engineer|react\s+(?:engineer|developer)|angular|vue\.?js)\b/i,
  'Backend Development':
    /\b(backend|back[\s-]?end|server[\s-]?side|server\s+software)\b/i,
  'Full Stack Development': /\b(full[\s-]?stack)\b/i,
  'Mobile Application Development':
    /\b(ios|android|mobile\s+(?:engineer|developer|app|application))\b/i,
  DevOps:
    /\b(devops|dev\s*ops|ci\/cd|ci\s+infrastructure|build\s+infrastructure|release\s+engineer|infrastructure\s+automation|core\s+infrastructure\s+engineer|infrastructure\s+architect)\b/i,
  'Site Reliability Engineering': /\b(site\s+reliability|\bsre\b)\b/i,
  'Cloud Engineering':
    /\b(cloud\s+(?:engineer|architect|infrastructure|platform|specialist|security)|aws\s+engineer|azure\s+engineer|gcp\s+engineer|oracle\s+cloud)\b/i,
  'Platform Engineering':
    /\b(platform\s+engineer|platform\s+engineering|platform\s+architect|platform\s+technical)\b/i,
  'Data Engineering':
    /\b(data\s+engineer|data\s+engineering|data\s+solution\s+engineer|analytics\s+engineer)\b/i,
  'Data Analyst':
    /\b(data\s+analyst|business\s+intelligence|\bbi\b|analytics\s+analyst|reporting\s+analyst|industrial\s+analytics|systems?\s+analyst|business\s+systems?\s+analyst)\b/i,
  'Data Science': /\b(data\s+scien(?:tist|ce)|data\s+science)\b/i,
  'Machine Learning Engineer':
    /\b(machine\s+learning|\bml\s+engineer|\bmlops\b|ml\s+product)\b/i,
  'AI Engineer':
    /\b(\bai\s+engineer|\bai\s+research|\bai\s+applications?|\bai\s+acceleration|\(ai\)|gen\s*ai|generative\s+ai|\bllm\b|quantization\s+engineer)\b/i,
  'QA / Testing':
    /\b(qa\b|quality\s+assurance|sdet\b|test\s+automation|test\s+engineer|software\s+test|quality\s+engineer|verification\s+engineer|validation\s+engineer|\bdv\s+engineer|design\s+verification)\b/i,
  Cybersecurity:
    /\b(cyber\s*security|cyber\s+exercise|security\s+(?:engineer|architect|platform|analyst|lead|specialist)|cloud\s+security|infosec|appsec|soc\s+analyst|ciso|threat\s+(?:intel|hunter)|iam\b|identity\s+(?:and|&)\s+access|product\s+security|application\s+security)\b/i,
  'Network Engineering':
    /\b(network\s+(?:engineer|admin|architect|systems|developer|specialist)|network\s*&\s*cloud)\b/i,
  'Product Management':
    /\b(product\s+manager|product\s+management|technical\s+product\s+manager)\b/i,
  'Project Management':
    /\b(project\s+manager|program\s+manager|\btpm\b|technical\s+program\s+manager|project\s+management\s+office|\bpmo\b|project\s+engineer)\b/i,
  'UI/UX Design':
    /\b(ui\/?ux|ux\s+design|ui\s+design|product\s+designer|user\s+experience|visual\s+design)\b/i,
  'Technical Support':
    /\b(technical\s+support|help\s*desk|desktop\s+support|it\s+support|support\s+(?:engineer|analyst|specialist)|service\s+desk)\b/i,
  SAP: /\b\bsap\b|\babap\b|\bbtp\b/i,
  Salesforce: /\b(salesforce|sfdc)\b/i,
  ERP: /\b(\berp\b|oracle\s+erp|netsuite|oracle\s+cloud\s+payroll|\bepm\b|\bedm\b)\b/i,
  'Blockchain / Web3': /\b(blockchain|web3|solidity)\b/i,
  'Embedded Systems':
    /\b(embedded(?:\s+systems?)?|firmware|\brtos\b|hypervisor|mcu\b|bare[\s-]?metal|\biot\b)\b/i,
  'Electrical Engineering':
    /\b(electrical\s+engineer|electrical\s+systems|power\s+electronics|vlsi|asic|fpga|soc\b|gpu\b|cpu\s+(?:design|integration|verification|software)|noc\s+interconnect|postsilicon|semiconductor|rf\s+hardware|hardware\s+(?:developer|engineer)|wireless\s+module)\b/i,
  'Game Development': /\b(game\s+(?:engineer|developer|design)|unity|unreal)\b/i,
  'System Administration':
    /\b(system(?:s)?\s+admin(?:istrator)?|sysadmin|windows\s+admin|linux\s+admin|system(?:s)?\s+engineer|linux\s+os)\b/i,
  'Solution Architecture':
    /\b(solutions?\s+architect|enterprise\s+architect|software\s+architect|technical\s+architect|it\s+architect|systems?\s+design\s+engineer|platform\s+architect|principal\s+architect|staff\s+architect|senior\s+architect|head\s+architect|infrastructure\s+architect)\b/i,
};

/**
 * Ordered force list — more specific before broad Software Engineering.
 */
const FORCE_FROM_TITLE: Array<{ re: RegExp; categories: string[] }> = [
  { re: SPECIALTY_TITLE_EVIDENCE['UI/UX Design'], categories: ['UI/UX Design'] },
  { re: SPECIALTY_TITLE_EVIDENCE['Embedded Systems'], categories: ['Embedded Systems'] },
  { re: SPECIALTY_TITLE_EVIDENCE['Electrical Engineering'], categories: ['Electrical Engineering'] },
  {
    re: SPECIALTY_TITLE_EVIDENCE['Site Reliability Engineering'],
    categories: ['Site Reliability Engineering'],
  },
  { re: SPECIALTY_TITLE_EVIDENCE.DevOps, categories: ['DevOps'] },
  {
    re: SPECIALTY_TITLE_EVIDENCE['Machine Learning Engineer'],
    categories: ['Machine Learning Engineer'],
  },
  { re: SPECIALTY_TITLE_EVIDENCE['AI Engineer'], categories: ['AI Engineer'] },
  { re: SPECIALTY_TITLE_EVIDENCE['Data Engineering'], categories: ['Data Engineering'] },
  { re: SPECIALTY_TITLE_EVIDENCE['Data Science'], categories: ['Data Science'] },
  { re: SPECIALTY_TITLE_EVIDENCE['Data Analyst'], categories: ['Data Analyst'] },
  { re: SPECIALTY_TITLE_EVIDENCE.Cybersecurity, categories: ['Cybersecurity'] },
  { re: SPECIALTY_TITLE_EVIDENCE['QA / Testing'], categories: ['QA / Testing'] },
  { re: SPECIALTY_TITLE_EVIDENCE['Product Management'], categories: ['Product Management'] },
  { re: SPECIALTY_TITLE_EVIDENCE['Project Management'], categories: ['Project Management'] },
  { re: SPECIALTY_TITLE_EVIDENCE['Solution Architecture'], categories: ['Solution Architecture'] },
  { re: SPECIALTY_TITLE_EVIDENCE.Salesforce, categories: ['Salesforce'] },
  { re: SPECIALTY_TITLE_EVIDENCE.SAP, categories: ['SAP'] },
  { re: SPECIALTY_TITLE_EVIDENCE.ERP, categories: ['ERP'] },
  { re: SPECIALTY_TITLE_EVIDENCE['Frontend Development'], categories: ['Frontend Development'] },
  { re: SPECIALTY_TITLE_EVIDENCE['Backend Development'], categories: ['Backend Development'] },
  { re: SPECIALTY_TITLE_EVIDENCE['Full Stack Development'], categories: ['Full Stack Development'] },
  {
    re: SPECIALTY_TITLE_EVIDENCE['Mobile Application Development'],
    categories: ['Mobile Application Development'],
  },
  { re: SPECIALTY_TITLE_EVIDENCE['Platform Engineering'], categories: ['Platform Engineering'] },
  { re: SPECIALTY_TITLE_EVIDENCE['Cloud Engineering'], categories: ['Cloud Engineering'] },
  { re: SPECIALTY_TITLE_EVIDENCE['System Administration'], categories: ['System Administration'] },
  { re: SPECIALTY_TITLE_EVIDENCE['Network Engineering'], categories: ['Network Engineering'] },
  { re: SPECIALTY_TITLE_EVIDENCE['Technical Support'], categories: ['Technical Support'] },
  { re: SPECIALTY_TITLE_EVIDENCE['Software Engineering'], categories: ['Software Engineering'] },
  { re: SPECIALTY_TITLE_EVIDENCE['Game Development'], categories: ['Game Development'] },
  { re: SPECIALTY_TITLE_EVIDENCE['Blockchain / Web3'], categories: ['Blockchain / Web3'] },
];

const FROZEN_SET = new Set<string>(FROZEN_JOB_CATEGORIES);

function uniqCap(cats: string[]): string[] {
  const out: string[] = [];
  for (const c of cats) {
    const canon = canonicalFrozenCategory(c) || (FROZEN_SET.has(c) ? c : null);
    if (!canon || out.includes(canon)) continue;
    out.push(canon);
    if (out.length >= MAX_SPECIALTIES) break;
  }
  return out;
}

/** True when title does not support keeping this specialty chip. */
export function specialtyLacksTitleEvidence(title: string, category: string): boolean {
  const re = SPECIALTY_TITLE_EVIDENCE[category];
  if (!re) return true;
  return !re.test(String(title || ''));
}

/**
 * Apply specialty overrides: title-evidence gate + non-tech clear + force-from-title.
 */
export function applySpecialtyTitleOverrides(
  title: string,
  categories: string[]
): { categories: string[]; signals: string[] } {
  const t = String(title || '').trim();
  const signals: string[] = [];
  let cats = Array.isArray(categories)
    ? categories.map((c) => String(c || '').trim()).filter(Boolean)
    : [];

  if (!t) {
    return { categories: [], signals: ['specialty:empty_title'] };
  }

  // 1) Non-tech / facilities / ops outside taxonomy → empty
  if (NON_TECH_TITLE_RE.test(t)) {
    signals.push('specialty:non_tech_clear');
    return { categories: [], signals };
  }

  // 2) Drop every chip without title evidence
  const before = cats.slice();
  cats = cats.filter((c) => {
    const canon = canonicalFrozenCategory(c) || c;
    return !specialtyLacksTitleEvidence(t, canon);
  });
  if (cats.length !== before.length) {
    signals.push('specialty:title_evidence_gate');
  }

  // 3) Force from title until cap — recovers misses when tagger returned empty
  if (cats.length < MAX_SPECIALTIES) {
    for (const rule of FORCE_FROM_TITLE) {
      if (!rule.re.test(t)) continue;
      const forced = uniqCap(rule.categories);
      if (!forced.length) continue;
      const merged = uniqCap([...cats, ...forced]);
      if (merged.length > cats.length) {
        signals.push(`specialty:force:${forced[0]}`);
      }
      cats = merged;
      if (cats.length >= MAX_SPECIALTIES) break;
    }
  }

  return { categories: uniqCap(cats), signals };
}

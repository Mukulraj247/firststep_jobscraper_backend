/**
 * Curated Scout-X automation tag catalog.
 * Tags are stored as `namespace:value` strings (max 5 per automation).
 */

export const MAX_AUTOMATION_TAGS = 5;

export type TagNamespace =
  | 'role'
  | 'industry'
  | 'company'
  | 'auth'
  | 'model'
  | 'region'
  | 'state'
  | 'city'
  | 'level'
  | 'type'
  | 'edu'
  | 'size'
  | 'comp'
  | 'perk'
  | 'function';

export interface TagNamespaceDef {
  namespace: TagNamespace;
  label: string;
  values: string[];
}

export const TAG_CATALOG: TagNamespaceDef[] = [
  {
    namespace: 'role',
    label: 'Job Title / Role',
    values: [
      'Software & Platform Engineering',
      'Software Engineer',
      'Frontend Engineer',
      'Backend Engineer',
      'Full Stack Engineer',
      'Mobile Engineer (iOS)',
      'Mobile Engineer (Android)',
      'Embedded Engineer',
      'Firmware Engineer',
      'DevOps Engineer',
      'Site Reliability Engineer (SRE)',
      'Platform Engineer',
      'Cloud Engineer',
      'Infrastructure Engineer',
      'Security Engineer',
      'QA / Test Engineer',
      'Automation Engineer',
      'Systems Engineer',
      'Network Engineer',
      'Database Administrator (DBA)',
      'Solutions Architect',
      'Software Architect',
      'Cloud Architect',
      'Engineering Manager',
      'Technical Program Manager (TPM)',
      'Data Engineer',
      'Analytics Engineer',
      'Data Scientist',
      'Data Analyst',
      'Business Analyst',
      'Business Intelligence (BI) Analyst',
      'Machine Learning Engineer',
      'MLOps Engineer',
      'AI Engineer',
      'Applied Scientist',
      'Research Scientist',
      'Computer Vision Engineer',
      'NLP Engineer',
      'Data Architect',
      'Electrical Engineer',
      'Hardware Engineer',
      'Semiconductor Engineer',
      'ASIC Design Engineer',
      'FPGA Engineer',
      'RTL Design Engineer',
      'Design Verification Engineer',
      'Physical Design Engineer',
      'Analog / Mixed-Signal Engineer',
      'RF Engineer',
      'Validation Engineer',
      'Mechanical Engineer',
      'Robotics Engineer',
      'Controls Engineer',
      'SAP Developer',
      'SAP Consultant',
      'Salesforce Developer',
      'Salesforce Administrator',
      'Workday Consultant',
      'ServiceNow Developer',
      'Oracle Developer',
      'Guidewire Developer',
      'Pega Developer',
      'SharePoint Developer',
      'Product Manager',
      'Product Owner',
      'Program Manager',
      'Project Manager',
      'Scrum Master',
      'Business Systems Analyst',
      'UX Designer',
      'UI Designer',
      'Product Designer',
      'UX Researcher',
      'Graphic Designer',
      'Cybersecurity Analyst',
      'IT Support / Help Desk',
      'Financial Analyst',
      'Accountant',
      'Supply Chain Analyst',
      'Operations Manager',
      'Marketing Manager',
      'Account Executive / Sales',
      'Recruiter / HR',
      'Management Consultant',
    ],
  },
  {
    namespace: 'industry',
    label: 'Industry',
    values: [
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
    ],
  },
  {
    namespace: 'company',
    label: 'Company Category',
    values: [
      'MAG 7 (Apple, Microsoft, Alphabet, Amazon, Nvidia, Meta, Tesla)',
      'FAANG',
      'Big Tech',
      'Fortune 50',
      'Fortune 100',
      'Fortune 500',
      'Startup',
      'Early-Stage / Seed',
      'Series A',
      'Series B',
      'Series C+',
      'Unicorn',
      'Scale-up',
      'Public Company',
      'Private Company',
      'Enterprise',
      'Mid-Market / SMB',
      'Big 4 (Deloitte, PwC, EY, KPMG)',
      'MBB (McKinsey, Bain, BCG)',
      'Consulting Firm',
      'Bulge Bracket Bank',
      'Defense Contractor',
      'Remote-First Company',
      'YC-Backed',
    ],
  },
  {
    namespace: 'auth',
    label: 'Work Authorization / Sponsorship',
    values: [
      'Sponsors H-1B',
      'No Sponsorship',
      'Green Card Sponsorship',
      'OPT / CPT Friendly',
      'STEM OPT Eligible',
      'Citizen / GC Required',
      'Security Clearance Required',
      'No Clearance Required',
      'E-Verify Employer',
      'EEO Employer',
    ],
  },
  {
    namespace: 'model',
    label: 'Work Model',
    values: ['Remote', 'Remote (US only)', 'Hybrid', 'On-site'],
  },
  {
    namespace: 'region',
    label: 'US Region',
    values: [
      'East Coast',
      'West Coast',
      'Midwest',
      'South',
      'Northeast',
      'Southeast',
      'Southwest',
      'Pacific Northwest',
      'Mountain West',
      'Tri-State Area',
      'Remote (US)',
    ],
  },
  {
    namespace: 'state',
    label: 'US State',
    values: [
      'Alabama',
      'Alaska',
      'Arizona',
      'Arkansas',
      'California',
      'Colorado',
      'Connecticut',
      'Delaware',
      'Florida',
      'Georgia',
      'Hawaii',
      'Idaho',
      'Illinois',
      'Indiana',
      'Iowa',
      'Kansas',
      'Kentucky',
      'Louisiana',
      'Maine',
      'Maryland',
      'Massachusetts',
      'Michigan',
      'Minnesota',
      'Mississippi',
      'Missouri',
      'Montana',
      'Nebraska',
      'Nevada',
      'New Hampshire',
      'New Jersey',
      'New Mexico',
      'New York',
      'North Carolina',
      'North Dakota',
      'Ohio',
      'Oklahoma',
      'Oregon',
      'Pennsylvania',
      'Rhode Island',
      'South Carolina',
      'South Dakota',
      'Tennessee',
      'Texas',
      'Utah',
      'Vermont',
      'Virginia',
      'Washington',
      'West Virginia',
      'Wisconsin',
      'Wyoming',
      'Washington D.C.',
    ],
  },
  {
    namespace: 'city',
    label: 'Major US City / Metro',
    values: [
      'New York City',
      'San Francisco / Bay Area',
      'Silicon Valley',
      'Seattle',
      'Los Angeles',
      'San Diego',
      'Boston',
      'Austin',
      'Dallas',
      'Houston',
      'Atlanta',
      'Charlotte',
      'Raleigh–Durham (Research Triangle)',
      'Chicago',
      'Denver',
      'Washington D.C.',
      'Philadelphia',
      'Miami',
      'Tampa',
      'Orlando',
      'Phoenix',
      'Portland',
      'Nashville',
      'Minneapolis',
      'Detroit',
      'Pittsburgh',
      'Columbus',
      'Salt Lake City',
      'Kansas City',
      'St. Louis',
    ],
  },
  {
    namespace: 'level',
    label: 'Seniority',
    values: [
      'Intern',
      'New Grad / Entry-Level',
      'Junior',
      'Mid-Level',
      'Senior',
      'Staff',
      'Principal',
      'Distinguished / Fellow',
      'Lead',
      'Manager',
      'Senior Manager',
      'Director',
      'VP',
      'Executive / C-Suite',
    ],
  },
  {
    namespace: 'type',
    label: 'Employment Type',
    values: [
      'Full-time',
      'Part-time',
      'Contract',
      'Contract-to-Hire',
      'Internship',
      'Co-op',
      'Temporary',
      'Seasonal',
      'Apprenticeship',
      'Freelance',
    ],
  },
  {
    namespace: 'edu',
    label: 'Degree Requirement',
    values: [
      'No Degree Required',
      "High School / GED",
      "Associate's",
      "Bachelor's",
      "Bachelor's (STEM)",
      "Master's",
      'MBA',
      'PhD',
      'Bootcamp-Friendly',
      'Certification-Based',
    ],
  },
  {
    namespace: 'size',
    label: 'Company Headcount',
    values: [
      '1–10',
      '11–50',
      '51–200',
      '201–500',
      '501–1,000',
      '1,001–5,000',
      '5,001–10,000',
      '10,001+',
    ],
  },
  {
    namespace: 'comp',
    label: 'Salary Band',
    values: [
      '<$60K',
      '$60–80K',
      '$80–100K',
      '$100–130K',
      '$130–160K',
      '$160–200K',
      '$200–250K',
      '$250–300K',
      '$300K+',
    ],
  },
  {
    namespace: 'perk',
    label: 'Perks / Benefits',
    values: [
      'Relocation Assistance',
      'Sign-on Bonus',
      'Equity / RSUs',
      'Stock Options',
      '401(k) Match',
      'Tuition Reimbursement',
      'Unlimited PTO',
      'Remote Stipend',
      'Visa Sponsorship',
      'Health/Dental/Vision',
    ],
  },
  {
    namespace: 'function',
    label: 'Job Function',
    values: [
      'Engineering',
      'Data & Analytics',
      'Product',
      'Design',
      'IT & Infrastructure',
      'Security',
      'Research',
      'Sales',
      'Marketing',
      'Business Development',
      'Finance & Accounting',
      'Operations',
      'Supply Chain',
      'HR / People',
      'Legal',
      'Customer Success / Support',
      'Consulting',
      'Program / Project Management',
    ],
  },
];

const ALLOWED = new Set<string>();
for (const ns of TAG_CATALOG) {
  for (const value of ns.values) {
    ALLOWED.add(`${ns.namespace}:${value}`);
  }
}

export function formatTag(namespace: string, value: string): string {
  return `${namespace}:${value}`;
}

export function parseTag(tag: string): { namespace: string; value: string } | null {
  const idx = tag.indexOf(':');
  if (idx <= 0) return null;
  return { namespace: tag.slice(0, idx), value: tag.slice(idx + 1) };
}

export function isAllowedTag(tag: string): boolean {
  return ALLOWED.has(tag);
}

export function sanitizeAutomationTags(
  raw: unknown
): { ok: true; tags: string[] } | { ok: false; error: string } {
  if (raw == null) return { ok: true, tags: [] };
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'tags must be an array of catalog strings (namespace:value)' };
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') {
      return { ok: false, error: 'each tag must be a string' };
    }
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (!isAllowedTag(trimmed)) {
      return { ok: false, error: `Unknown or disallowed tag: ${trimmed}` };
    }
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  if (out.length > MAX_AUTOMATION_TAGS) {
    return { ok: false, error: `At most ${MAX_AUTOMATION_TAGS} tags are allowed per automation` };
  }
  return { ok: true, tags: out };
}

export function getAllCatalogTagStrings(): string[] {
  return Array.from(ALLOWED);
}

/** Namespaces shown on the ops dashboard “Jobs by tag” grid. */
export const JOB_CATEGORY_TAG_NAMESPACES: TagNamespace[] = [
  'role',
  'function',
  'industry',
  'level',
  'type',
  'edu',
  'comp',
];

export type DashboardTagDefinition = {
  tag: string;
  label: string;
  namespace: TagNamespace;
  namespaceLabel: string;
};

/** Full job-category catalog for dashboard tag rollups (roles, industries, functions, etc.). */
export function getJobCategoryDashboardTags(): DashboardTagDefinition[] {
  return TAG_CATALOG.filter((ns) => JOB_CATEGORY_TAG_NAMESPACES.includes(ns.namespace)).flatMap(
    (ns) =>
      ns.values.map((value) => ({
        tag: formatTag(ns.namespace, value),
        label: value,
        namespace: ns.namespace,
        namespaceLabel: ns.label,
      })),
  );
}

/** Role-only catalog used by the ops dashboard “Jobs by tag” grid. */
export function getRoleDashboardTags(): DashboardTagDefinition[] {
  return getJobCategoryDashboardTags().filter((tag) => tag.namespace === 'role');
}

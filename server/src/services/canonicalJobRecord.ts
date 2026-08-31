import { reserveStructuredJobIdsForRows } from './jobIdGenerator';

/** Fixed value for every persisted extracted row (`data.job_creation_type`). */
export const CANONICAL_JOB_CREATION_TYPE = 'automation' as const;

/** Canonical keys stored under `ExtractedData.data`. */
export const CANONICAL_JOB_FIELD_ORDER = [
  'jobId',
  'jobUrl',
  'applyUrl',
  'jobTitle',
  'companyName',
  'jobDescription',
  'jobCategory',
  'date',
  'job_creation_type',
  'status',
  'isFlagged',
  'jobExperience',
  'sectorIndustry',
  'f500',
  'location',
  'salaryRange',
  'employmentType',
  'remoteType',
  'companyLogoUrl',
  'about',
  'skills',
  'responsibilities',
  'minimumQualifications',
  'preferredQualifications',
  'benefits',
  'certifications',
  'seniorityLevel',
  'roleType',
  'educationRequirement',
  'visaSponsorship',
  'companyEmployeeCount',
  'companyFoundedYear',
  'companyWebsite',
  'aggregatorPostingUrl',
] as const;

export type CanonicalJobData = Record<
  (typeof CANONICAL_JOB_FIELD_ORDER)[number],
  string | Date | boolean | number | string[]
>;

const str = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v).trim();
  return '';
};

/**
 * For each canonical field, fill from legacy keys when the canonical value is empty.
 * Does not remove original keys (so column overrides keyed by recording names still work).
 */
export const applyLegacyJobAliases = (data: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...data };

  const fill = (canonical: string, sources: string[]) => {
    if (str(out[canonical]) !== '') return;
    for (const key of sources) {
      const v = str(out[key]);
      if (v !== '') {
        out[canonical] = v;
        return;
      }
    }
  };

  fill('jobUrl', ['url', 'link', 'href', 'job_url']);
  fill('applyUrl', ['apply_url', 'application_url', 'applicationUrl']);
  fill('jobTitle', ['title', 'name', 'job_title']);
  fill('companyName', ['company', 'employer', 'company_name']);
  fill('jobDescription', ['description', 'summary', 'job_description']);
  fill('jobCategory', ['department', 'job_category']);
  fill('location', ['job_location', 'city', 'work_location']);
  fill('salaryRange', ['salary', 'salary_range', 'compensation', 'pay']);
  fill('employmentType', ['employment_type', 'job_type', 'jobType']);
  fill('remoteType', ['remote_type', 'workplace_type', 'work_arrangement']);

  return out;
};

const parseLooseDate = (value: unknown): Date | null => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const pickPostedDateFromRow = (
  data: Record<string, unknown>,
  fallback: Date,
  nowMs: number = Date.now(),
): Date => {
  const keys = ['datePosted', 'postedAt', 'posted_date', 'posted', 'date', 'listing_date', 'created'];
  for (const k of keys) {
    const parsed = parseLooseDate(data[k]);
    if (parsed && parsed.getTime() <= nowMs) return parsed;
  }
  return fallback;
};

export const buildCanonicalJobDataSync = (
  data: Record<string, unknown>,
  opts: { createdAt: Date; jobId: string; status?: string; insertDefaults?: boolean }
): Record<string, string | Date | boolean | number | string[]> => {
  const { createdAt, jobId, status = 'pending', insertDefaults } = opts;

  const jobUrl = str(data.jobUrl ?? data.job_url ?? data.url ?? data.link ?? data.href);
  const applyUrl = str(
    data.applyUrl ?? data.apply_url ?? data.application_url ?? data.applicationUrl
  );
  const jobTitle = str(data.jobTitle ?? data.title ?? data.name ?? data.job_title);
  const companyName = str(data.companyName ?? data.company ?? data.employer ?? data.company_name);
  const jobDescription = str(
    data.jobDescription ?? data.description ?? data.summary ?? data.job_description
  );
  const jobCategory = str(data.jobCategory ?? data.department ?? data.job_category);
  const sectorIndustry = str(data.sectorIndustry);
  const f500 = str(data.f500);
  const location = str(
    data.location ?? data.job_location ?? data.city ?? data.work_location
  );
  const salaryRange = str(
    data.salaryRange ?? data.salary ?? data.salary_range ?? data.compensation ?? data.pay
  );
  const employmentType = str(
    data.employmentType ?? data.employment_type ?? data.job_type ?? data.jobType
  );
  const remoteType = str(
    data.remoteType ?? data.remote_type ?? data.workplace_type ?? data.work_arrangement
  );

  const date = pickPostedDateFromRow(data, createdAt);

  let jobExperience = 0;
  const rawExp = data.jobExperience ?? data.job_experience;
  if (typeof rawExp === 'number' && Number.isFinite(rawExp)) {
    jobExperience = Math.max(0, Math.floor(rawExp));
  } else if (typeof rawExp === 'string' && rawExp.trim()) {
    const n = parseInt(rawExp.replace(/\D/g, ''), 10);
    if (!Number.isNaN(n)) jobExperience = Math.max(0, n);
  }

  let isFlagged = false;
  if (typeof data.isFlagged === 'boolean') isFlagged = data.isFlagged;
  else if (data.isFlagged === 'true' || data.isFlagged === 1) isFlagged = true;

  const outStatus = insertDefaults ? 'pending' : str(data.status) || status;

  const asList = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean) : [];

  const asPositiveInt = (v: unknown): number => {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.floor(v);
    if (typeof v === 'string' && v.trim()) {
      const n = parseInt(v.replace(/\D/g, ''), 10);
      if (!Number.isNaN(n) && n > 0) return n;
    }
    return 0;
  };

  const visaRaw = str(data.visaSponsorship).toLowerCase();
  const visaSponsorship = visaRaw === 'yes' || visaRaw === 'no' ? visaRaw : '';

  return {
    jobId,
    jobUrl,
    applyUrl,
    jobTitle,
    companyName,
    jobDescription,
    jobCategory,
    date,
    job_creation_type: CANONICAL_JOB_CREATION_TYPE,
    status: outStatus,
    isFlagged,
    jobExperience,
    sectorIndustry,
    f500,
    location,
    salaryRange,
    employmentType,
    remoteType,
    companyLogoUrl: str(data.companyLogoUrl),
    about: str(data.about),
    skills: asList(data.skills),
    responsibilities: asList(data.responsibilities),
    minimumQualifications: asList(data.minimumQualifications),
    preferredQualifications: asList(data.preferredQualifications),
    benefits: asList(data.benefits),
    certifications: asList(data.certifications),
    seniorityLevel: str(data.seniorityLevel),
    roleType: str(data.roleType),
    educationRequirement: str(data.educationRequirement),
    visaSponsorship,
    companyEmployeeCount: asPositiveInt(data.companyEmployeeCount),
    companyFoundedYear: asPositiveInt(data.companyFoundedYear),
    companyWebsite: str(data.companyWebsite),
    aggregatorPostingUrl: str(data.aggregatorPostingUrl),
  };
};

/** Rows already merged (overrides + row context + normalization). Assigns structured jobIds and canonical `data`. */
export const finalizeRowsWithCanonicalData = async (
  rows: { source: string; data: Record<string, any> }[],
  createdAt: Date
): Promise<{ source: string; data: Record<string, any> }[]> => {
  if (rows.length === 0) return [];
  const jobIds = await reserveStructuredJobIdsForRows(
    rows.map((r) => ({
      jobTitle: String(r.data?.jobTitle ?? ''),
      date: createdAt,
    }))
  );
  return rows.map((r, i) => ({
    source: r.source,
    data: buildCanonicalJobDataSync(r.data, { createdAt, jobId: jobIds[i]!, insertDefaults: true }),
  }));
};

/** Heuristic: document was written by the canonical persistence path. */
export const hasCanonicalExtractedShape = (data: Record<string, unknown> | null | undefined): boolean => {
  if (!data || typeof data !== 'object') return false;
  if (typeof data.jobId !== 'string' || !data.jobId.trim()) return false;
  if (typeof data.status !== 'string' || !data.status.trim()) return false;
  if (data.job_creation_type !== CANONICAL_JOB_CREATION_TYPE) return false;
  return true;
};

/**
 * For API reads of legacy documents: same canonical string defaults without allocating a new jobId.
 * Preserves existing `jobId` / `status` when present (e.g. n8n set `active`).
 */
export const buildCanonicalViewFromStoredData = (
  data: Record<string, unknown>,
  opts: { createdAt: Date; jobId?: string }
): Record<string, string | Date | boolean | number | string[]> => {
  const jobId = str(opts.jobId ?? data.jobId);
  const status = str(data.status) || 'pending';
  return buildCanonicalJobDataSync(data, { createdAt: opts.createdAt, jobId, status });
};

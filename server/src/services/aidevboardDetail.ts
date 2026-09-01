/**
 * AI Dev Board job id / URL helpers + row merge.
 */

import { isAidevboardJobPostingUrl, isAidevboardUrl } from './aggregatorIdentity';
import { sanitizeCompanyName, normalizeJobDescription, type ParsedJobFields } from './jobPageParser';

export type AidevboardStructuredFields = Partial<ParsedJobFields> & {
  aggregatorPostingUrl?: string;
  jobId?: string;
};

export function preferExternalApplyUrl(...candidates: unknown[]): string {
  for (const c of candidates) {
    const raw = String(c || '').trim();
    if (!raw || !/^https?:\/\//i.test(raw)) continue;
    if (isAidevboardUrl(raw)) continue;
    return raw.split('#')[0] || raw;
  }
  return '';
}

export function aidevboardJobIdFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    const m = path.match(/^\/job\/([a-f0-9-]{8,})/i);
    return m?.[1] || '';
  } catch {
    return '';
  }
}

export function pickAidevboardJobUrl(row: Record<string, unknown>): string {
  const candidates: string[] = [];
  for (const value of Object.values(row)) {
    if (typeof value !== 'string' || !/^https?:\/\//i.test(value.trim())) continue;
    candidates.push(value.trim().split('#')[0] || value.trim());
  }
  const explicit = String(row.aggregatorPostingUrl || '').trim();
  if (explicit && isAidevboardJobPostingUrl(explicit)) return explicit.split('#')[0] || explicit;
  for (const url of candidates) {
    if (isAidevboardJobPostingUrl(url)) return url;
  }
  // Build from bare UUID id field if present.
  const id = String(row.id || row.jobId || row.job_id || '').trim();
  if (/^[a-f0-9-]{36}$/i.test(id)) {
    return `https://aidevboard.com/job/${id}`;
  }
  return '';
}

export function mapAidevboardApiJob(job: Record<string, unknown>): AidevboardStructuredFields {
  const id = String(job.id || '').trim();
  const postingUrl =
    String(job.url || '').trim() || (id ? `https://aidevboard.com/job/${id}` : '');
  const salaryMin = Number(job.salary_min || 0);
  const salaryMax = Number(job.salary_max || 0);
  let salaryRange = '';
  if (salaryMin > 0 && salaryMax > 0) {
    salaryRange = `$${Math.round(salaryMin / 1000)}k-$${Math.round(salaryMax / 1000)}k`;
  } else if (salaryMin > 0) {
    salaryRange = `$${Math.round(salaryMin / 1000)}k+`;
  }

  const workplace = String(job.workplace || '').trim();
  let remoteType = '';
  if (/remote/i.test(workplace)) remoteType = 'Remote';
  else if (/hybrid/i.test(workplace)) remoteType = 'Hybrid';
  else if (/on[- ]?site/i.test(workplace)) remoteType = 'Onsite';

  return {
    jobTitle: String(job.title || '').trim(),
    companyName: sanitizeCompanyName(String(job.company_name || job.companyName || '').trim()),
    jobDescription: normalizeJobDescription(String(job.description || '')),
    location: String(job.location || '').trim(),
    salaryRange,
    employmentType: String(job.job_type || job.employmentType || '').trim(),
    remoteType,
    applyUrl: preferExternalApplyUrl(job.apply_url, job.applyUrl),
    companyLogoUrl: String(job.company_logo_url || '').trim(),
    date: String(job.published_at || job.created_at || '').trim(),
    source: 'api',
    aggregatorPostingUrl: postingUrl,
    jobId: id,
  };
}

export function mergeAidevboardDetailIntoRow(
  listRow: Record<string, unknown>,
  detail: AidevboardStructuredFields,
  postingUrl: string
): Record<string, unknown> {
  const next = { ...listRow };
  const existingTitle = String(next.jobTitle || next.title || '').trim();
  const existingCompany = String(next.companyName || next.company || '').trim();
  const existingDesc = String(next.jobDescription || next.description || '').trim();
  const portalCompany = /^(ai\s*dev\s*board|aidevboard)$/i.test(existingCompany);

  const detailTitle = String(detail.jobTitle || '').trim();
  const detailCompany = sanitizeCompanyName(String(detail.companyName || '').trim());
  const detailDesc = String(detail.jobDescription || '').trim();

  next.jobUrl = postingUrl;
  next.url = postingUrl;
  next.aggregatorPostingUrl = postingUrl;
  if (detail.jobId) next.jobId = detail.jobId;
  next.jobTitle = detailTitle || existingTitle;
  next.title = next.jobTitle;

  if (detailCompany && (!existingCompany || portalCompany)) {
    next.companyName = detailCompany;
    next.company = detailCompany;
  }

  if (detailDesc.length > existingDesc.length) {
    next.jobDescription = detailDesc;
    next.description = detailDesc;
  }

  if (detail.location) next.location = detail.location;
  if (detail.salaryRange) next.salaryRange = detail.salaryRange;
  if (detail.employmentType) next.employmentType = detail.employmentType;
  if (detail.remoteType) next.remoteType = detail.remoteType;
  if (detail.companyLogoUrl) next.companyLogoUrl = detail.companyLogoUrl;
  if (detail.date) next.date = detail.date;

  const externalApply = preferExternalApplyUrl(detail.applyUrl, next.applyUrl);
  if (externalApply) next.applyUrl = externalApply;
  else delete next.applyUrl;

  return next;
}

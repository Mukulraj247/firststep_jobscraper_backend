import { createHash } from 'crypto';
import JobBoardListing, {
  IJobBoardListSnapshot,
  IJobBoardListing,
} from '../models/JobBoardListing';
import { makeDescriptionSnippet, sanitizeCompanyName, decodeHtmlEntities, normalizeJobDescription, normalizeLocation, normalizeSalaryRange } from './jobPageParser';
import { jobUrlKey, normalizeJobUrl } from './jobUrlNormalize';
import { detectAts } from './atsAdapters';
import {
  isHiringCafeUrl,
  isAccelJobPostingUrl,
  isConsiderJobPostingUrl,
  isChoppingBlockJobPostingUrl,
  isAidevboardJobPostingUrl,
  isAggregatorHostUrl,
  isAggregatorJobPostingUrl,
  usesAggregatorHtmlOnlyEnrichment,
} from './aggregatorIdentity';
import { pickHiringCafeJobUrl, isHiringCafeJobPostingUrl } from './hiringCafeDetail';
import { pickAccelJobUrl } from './accelDetail';
import { pickConsiderJobUrl } from './sequoiaDetail';
import { pickChoppingBlockJobUrl } from './choppingblockDetail';
import { pickAidevboardJobUrl } from './aidevboardDetail';
import { normalizeOwnerIdForWrite } from '../utils/ownerId';
import { classifyJobCategories } from './jobCategoryTagger';
import logger from '../logger';

export const JOB_BOARD_STALE_DAYS = parseInt(process.env.JOB_BOARD_STALE_DAYS || '14', 10);
export const JOB_BOARD_MIN_DESC_CHARS = parseInt(process.env.JOB_BOARD_MIN_DESC_CHARS || '400', 10);

export interface EnrichmentEnqueueRow {
  source?: string;
  data: Record<string, any>;
}

export interface EnrichmentEnqueueStats {
  considered: number;
  skippedNoUrl: number;
  skippedDedup: number;
  skippedComplete: number;
  queued: number;
  readyFromList: number;
  expiredSkipped: number;
  /** Unique job URLs not already on the board (= queued + readyFromList). */
  uniqueNew: number;
}

function asText(v: unknown): string {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

function asExperience(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.floor(v));
  if (typeof v === 'string' && v.trim()) {
    const n = parseInt(v.replace(/\D/g, ''), 10);
    if (!Number.isNaN(n)) return Math.max(0, n);
  }
  return 0;
}

function parseDate(v: unknown): Date | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
  const s = asText(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((x) => String(x || '').trim()).filter(Boolean);
}

function isAggregatorPostingUrlValue(url: string): boolean {
  return isAggregatorJobPostingUrl(url);
}

export function buildListSnapshot(data: Record<string, any>): IJobBoardListSnapshot {
  const location = normalizeLocation(asText(data.location));
  const rawSalary = asText(data.salaryRange);
  // Preserve Hiring Cafe chip style ($33-$49/hr, $57k-$98k/yr).
  const salaryRange = /\/(?:hr|yr|mo|wk|day|biweekly)\b/i.test(rawSalary)
    ? rawSalary
    : normalizeSalaryRange(rawSalary, { location });
  return {
    jobTitle: decodeHtmlEntities(asText(data.jobTitle)),
    companyName: sanitizeCompanyName(asText(data.companyName)),
    jobDescription: normalizeJobDescription(asText(data.jobDescription)),
    jobCategory: decodeHtmlEntities(asText(data.jobCategory)),
    location,
    salaryRange,
    employmentType: decodeHtmlEntities(asText(data.employmentType)),
    remoteType: decodeHtmlEntities(asText(data.remoteType)),
    jobExperience: asExperience(data.jobExperience),
    sectorIndustry: decodeHtmlEntities(asText(data.sectorIndustry)),
    f500: asText(data.f500),
    date: parseDate(data.date),
    about: decodeHtmlEntities(asText(data.about)),
    companyLogoUrl: asText(data.companyLogoUrl),
    skills: asStringList(data.skills),
    responsibilities: asStringList(data.responsibilities),
    minimumQualifications: asStringList(data.minimumQualifications),
    preferredQualifications: asStringList(data.preferredQualifications),
    benefits: asStringList(data.benefits),
    certifications: asStringList(data.certifications),
    seniorityLevel: decodeHtmlEntities(asText(data.seniorityLevel)),
    roleType: decodeHtmlEntities(asText(data.roleType)),
    educationRequirement: decodeHtmlEntities(asText(data.educationRequirement)),
    visaSponsorship: asText(data.visaSponsorship).toLowerCase(),
    companyEmployeeCount: asExperience(data.companyEmployeeCount),
    companyFoundedYear: asExperience(data.companyFoundedYear),
    companyWebsite: asText(data.companyWebsite),
    aggregatorPostingUrl: (() => {
      const explicit = asText(data.aggregatorPostingUrl);
      if (explicit && isAggregatorPostingUrlValue(explicit)) return explicit;
      const jobUrl = asText(data.jobUrl);
      if (jobUrl && isAggregatorPostingUrlValue(jobUrl)) return jobUrl;
      return '';
    })(),
  };
}

export function isListRowComplete(
  snapshot: IJobBoardListSnapshot,
  opts?: { source?: string | null }
): boolean {
  const source = String(opts?.source || '').trim().toLowerCase();
  // Hiring Cafe list rows are stubs — detail enrichment must supply apply URL + real JD
  // before the row can be board-visible (`ready`). Never promote from list alone.
  if (source === 'hiring_cafe') return false;

  const descOk = (snapshot.jobDescription || '').length >= JOB_BOARD_MIN_DESC_CHARS;
  const hasCore = Boolean(snapshot.jobTitle && snapshot.companyName && descOk);
  if (!hasCore) return false;

  if (usesAggregatorHtmlOnlyEnrichment(source)) {
    return true;
  }
  return Boolean(snapshot.location);
}

function rowCandidateUrls(data: Record<string, any>): string[] {
  const raw = [
    data.jobUrl,
    data.job_url,
    data.applyUrl,
    data.apply_url,
    data.url,
    data.link,
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    const normalized = normalizeJobUrl(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function isAggregatorPostingUrl(url: string): boolean {
  return isAggregatorHostUrl(url);
}

/**
 * Prefer an ATS / company apply URL as the board identity.
 * Never key the board on an aggregator page (HC / Accel) when a real apply URL exists.
 * Dedup identity = normalized employer/ATS URL only.
 */
export function pickCanonicalJobUrl(data: Record<string, any>): {
  jobUrl: string | null;
  applyUrl: string | null;
} {
  const explicitApply = normalizeJobUrl(
    data.applyUrl || data.apply_url || data.applicationUrl || data.application_url
  );
  const companyApply =
    explicitApply && !isAggregatorPostingUrl(explicitApply) ? explicitApply : null;

  const urls = rowCandidateUrls(data);
  const companyUrls = urls.filter((url) => !isAggregatorPostingUrl(url));
  const atsUrl =
    (companyApply && detectAts(companyApply) ? companyApply : null) ||
    companyUrls.find((url) => Boolean(detectAts(url))) ||
    null;

  // Board identity must be the employer/ATS URL — never aggregator hosts.
  const jobUrl = atsUrl || companyApply || companyUrls[0] || null;
  const applyUrl = companyApply || atsUrl || companyUrls.find((url) => url !== jobUrl) || companyUrls[0] || null;

  return { jobUrl, applyUrl };
}

/**
 * Resolve board identity for enqueue.
 * Prefer employer/ATS URL. For complete aggregator list rows with no employer apply URL yet,
 * fall back to the aggregator posting URL so the listing can still appear as method=list.
 */
export function resolveBoardEnqueueIdentity(
  data: Record<string, any>,
  listingSource?: string | null
): { jobUrl: string; applyUrl: string; snapshot: IJobBoardListSnapshot } | null {
  const snapshot = buildListSnapshot(data);
  const picked = pickCanonicalJobUrl(data);
  const source = String(listingSource || '').trim().toLowerCase();

  if (picked.jobUrl && !isAggregatorPostingUrl(picked.jobUrl)) {
    const employerApply =
      (picked.applyUrl && !isAggregatorPostingUrl(picked.applyUrl) ? picked.applyUrl : '') ||
      picked.jobUrl;
    return { jobUrl: picked.jobUrl, applyUrl: employerApply, snapshot };
  }

  // Soft gate: HC /job/{slug} is enough to enqueue even when detail enrich failed
  // (no apply URL / short JD). Incomplete rows land as status=queued so the enrichment
  // worker can recover via HTTP→proxy→browser. Complete rows still become readyFromList.
  if (source === 'hiring_cafe') {
    const hcPosting = normalizeJobUrl(pickHiringCafeJobUrl(data) || '');
    if (hcPosting && isHiringCafeJobPostingUrl(hcPosting)) {
      return { jobUrl: hcPosting, applyUrl: '', snapshot };
    }
  }
  // Soft gate: complete Accel / Chopping Block / AI Dev Board rows without employer apply.
  if (source === 'accel' && isListRowComplete(snapshot, { source: 'accel' })) {
    const accelPosting = normalizeJobUrl(pickAccelJobUrl(data) || data.aggregatorPostingUrl || '');
    if (accelPosting && isAccelJobPostingUrl(accelPosting)) {
      return { jobUrl: accelPosting, applyUrl: '', snapshot };
    }
  }
  if (source === 'choppingblock' && isListRowComplete(snapshot, { source: 'choppingblock' })) {
    const cbPosting = normalizeJobUrl(
      pickChoppingBlockJobUrl(data) || data.aggregatorPostingUrl || ''
    );
    if (cbPosting && isChoppingBlockJobPostingUrl(cbPosting)) {
      return { jobUrl: cbPosting, applyUrl: '', snapshot };
    }
  }
  if (source === 'aidevboard' && isListRowComplete(snapshot, { source: 'aidevboard' })) {
    const adbPosting = normalizeJobUrl(
      pickAidevboardJobUrl(data) || data.aggregatorPostingUrl || ''
    );
    if (adbPosting && isAidevboardJobPostingUrl(adbPosting)) {
      return { jobUrl: adbPosting, applyUrl: '', snapshot };
    }
  }
  // Consider (Sequoia / CapitalG): title+company+posting is enough for ATS apply resolve.
  if (source === 'sequoia' || source === 'capitalg') {
    const considerPosting = normalizeJobUrl(
      pickConsiderJobUrl(data) || data.aggregatorPostingUrl || ''
    );
    if (
      considerPosting &&
      isConsiderJobPostingUrl(considerPosting) &&
      snapshot.jobTitle &&
      snapshot.companyName
    ) {
      return { jobUrl: considerPosting, applyUrl: '', snapshot };
    }
  }
  // startups.gallery: require employer/ATS URL (already handled above when picked).
  // Soft-gate only if somehow still on gallery host with title+company+external apply in data.
  if (source === 'startups_gallery' && snapshot.jobTitle && snapshot.companyName) {
    const external =
      normalizeJobUrl(data.applyUrl || data.apply_url || '') ||
      normalizeJobUrl(picked.applyUrl || '') ||
      '';
    if (external && !isAggregatorPostingUrl(external)) {
      return { jobUrl: external, applyUrl: external, snapshot };
    }
  }

  return null;
}

export type SoftGateRekeyResult =
  | { action: 'noop' }
  | { action: 'rekeyed'; employerUrl: string; jobUrlKey: string }
  | { action: 'merged_into'; winnerId: string; employerUrl: string; jobUrlKey: string };

function fillMissingListingFields(
  winner: Record<string, any>,
  donor: Record<string, any>
): Record<string, unknown> {
  const $set: Record<string, unknown> = {};
  const take = (field: string, preferLonger = false) => {
    const w = winner[field];
    const d = donor[field];
    if (preferLonger) {
      const ws = String(w || '');
      const ds = String(d || '');
      if (ds.length > ws.length) $set[field] = d;
      return;
    }
    const empty =
      w == null ||
      w === '' ||
      w === 0 ||
      (Array.isArray(w) && w.length === 0);
    if (empty && d != null && d !== '' && d !== 0 && !(Array.isArray(d) && d.length === 0)) {
      $set[field] = d;
    }
  };
  take('jobTitle');
  take('companyName');
  take('jobDescription', true);
  take('descriptionSnippet', true);
  take('location');
  take('salaryRange');
  take('employmentType');
  take('remoteType');
  take('jobCategory');
  take('jobExperience');
  take('companyLogoUrl');
  take('seniorityLevel');
  take('educationRequirement');
  take('visaSponsorship');
  take('roleType');
  take('sectorIndustry');
  take('about', true);
  take('skills');
  take('certifications');
  take('minimumQualifications');
  take('preferredQualifications');
  take('responsibilities');
  take('benefits');
  take('frozenCategories');
  take('companyWebsite');
  take('companyEmployeeCount');
  take('companyFoundedYear');
  // Prefer Hiring Cafe chip salaries ($Nk-$Mk/yr) over mangled "$142.8".
  const wSal = String(winner.salaryRange || '');
  const dSal = String(donor.salaryRange || '');
  if (/\/(?:hr|yr|mo)\b/i.test(dSal) && !/\/(?:hr|yr|mo)\b/i.test(wSal)) {
    $set.salaryRange = dSal;
  }
  return $set;
}

/**
 * Soft-gated aggregator rows are keyed on the aggregator posting URL until an
 * employer/ATS apply URL is known. Once apply resolves, move board identity onto
 * the employer URL — or merge into an existing row already keyed that way —
 * so the same job does not appear twice (HC slug + amazon.jobs, etc.).
 */
export async function rekeySoftGateListingToEmployer(opts: {
  doc: Pick<
    IJobBoardListing,
    | '_id'
    | 'jobUrl'
    | 'applyUrl'
    | 'jobUrlKey'
    | 'aggregatorPostingUrl'
    | 'listSnapshot'
    | 'robotMetaIds'
    | 'runIds'
  > &
    Record<string, any>;
  employerUrl: string;
  aggregatorPostingUrl?: string;
}): Promise<SoftGateRekeyResult> {
  const employerUrl = normalizeJobUrl(opts.employerUrl);
  if (!employerUrl || isAggregatorPostingUrl(employerUrl)) return { action: 'noop' };

  const currentUrl = normalizeJobUrl(opts.doc.jobUrl) || String(opts.doc.jobUrl || '').trim();
  const currentIsSoftGate = Boolean(currentUrl && isAggregatorJobPostingUrl(currentUrl));
  if (!currentIsSoftGate) return { action: 'noop' };

  const newKey = jobUrlKey(employerUrl);
  if (!newKey) return { action: 'noop' };

  const posting =
    normalizeJobUrl(opts.aggregatorPostingUrl) ||
    normalizeJobUrl(opts.doc.aggregatorPostingUrl) ||
    normalizeJobUrl((opts.doc.listSnapshot as any)?.aggregatorPostingUrl) ||
    (currentIsSoftGate ? currentUrl : '') ||
    '';

  const existing = await JobBoardListing.findOne({
    jobUrlKey: newKey,
    _id: { $ne: opts.doc._id },
  });

  if (existing) {
    const $set = fillMissingListingFields(existing as any, opts.doc as any);
    $set.applyUrl = normalizeJobUrl(existing.applyUrl) || employerUrl;
    $set.jobUrl = normalizeJobUrl(existing.jobUrl) || employerUrl;
    $set.jobUrlKey = newKey;
    if (posting) {
      $set.aggregatorPostingUrl = posting;
      $set['listSnapshot.aggregatorPostingUrl'] = posting;
    }
    $set.lastSeenAt = new Date();

    await JobBoardListing.updateOne(
      { _id: existing._id },
      {
        $set,
        $addToSet: {
          robotMetaIds: { $each: (opts.doc.robotMetaIds || []).map(String) },
          runIds: { $each: (opts.doc.runIds || []).map(String) },
        },
      }
    );
    await JobBoardListing.deleteOne({ _id: opts.doc._id });
    logger.log(
      'info',
      `soft-gate merge: deleted ${_idStr(opts.doc._id)} into ${_idStr(existing._id)} key=${newKey.slice(0, 12)}`
    );
    return {
      action: 'merged_into',
      winnerId: String(existing._id),
      employerUrl,
      jobUrlKey: newKey,
    };
  }

  await JobBoardListing.updateOne(
    { _id: opts.doc._id },
    {
      $set: {
        jobUrl: employerUrl,
        applyUrl: employerUrl,
        jobUrlKey: newKey,
        ...(posting
          ? {
              aggregatorPostingUrl: posting,
              'listSnapshot.aggregatorPostingUrl': posting,
            }
          : {}),
      },
    }
  );
  opts.doc.jobUrl = employerUrl;
  opts.doc.applyUrl = employerUrl;
  opts.doc.jobUrlKey = newKey;
  logger.log(
    'info',
    `soft-gate rekey: ${_idStr(opts.doc._id)} → ${employerUrl.slice(0, 80)} key=${newKey.slice(0, 12)}`
  );
  return { action: 'rekeyed', employerUrl, jobUrlKey: newKey };
}

function _idStr(id: unknown): string {
  return id != null ? String(id) : '';
}

/**
 * After enqueueing an employer-keyed row, drop soft-gate orphans still keyed on
 * the same aggregator posting URL (prevents HC slug + employer URL twin cards).
 */
export async function collapseSoftGateOrphansForEmployerBatch(
  items: Array<{ jobUrl: string; applyUrl: string; snapshot: IJobBoardListSnapshot }>
): Promise<number> {
  let deleted = 0;
  for (const item of items) {
    if (isAggregatorPostingUrl(item.jobUrl)) continue;
    const posting = normalizeJobUrl(item.snapshot.aggregatorPostingUrl || '');
    if (!posting || !isAggregatorJobPostingUrl(posting)) continue;
    const employerKey = jobUrlKey(item.jobUrl);
    const postingKey = jobUrlKey(posting);
    if (!employerKey || !postingKey || employerKey === postingKey) continue;

    const orphans = await JobBoardListing.find({
      jobUrlKey: postingKey,
    }).limit(5);
    if (!orphans.length) continue;

    const winner = await JobBoardListing.findOne({ jobUrlKey: employerKey });
    for (const orphan of orphans) {
      if (winner) {
        const $set = fillMissingListingFields(winner as any, orphan as any);
        if (posting) {
          $set.aggregatorPostingUrl = posting;
          $set['listSnapshot.aggregatorPostingUrl'] = posting;
        }
        await JobBoardListing.updateOne(
          { _id: winner._id },
          {
            $set,
            $addToSet: {
              robotMetaIds: { $each: (orphan.robotMetaIds || []).map(String) },
              runIds: { $each: (orphan.runIds || []).map(String) },
            },
          }
        );
      }
      await JobBoardListing.deleteOne({ _id: orphan._id });
      deleted += 1;
    }
  }
  return deleted;
}

export function contentHashFromFields(fields: {
  jobTitle?: string;
  companyName?: string;
  jobDescription?: string;
  location?: string;
  salaryRange?: string;
  employmentType?: string;
  remoteType?: string;
  applyUrl?: string;
}): string {
  const payload = [
    asText(fields.jobTitle),
    asText(fields.companyName),
    asText(fields.jobDescription),
    asText(fields.location),
    asText(fields.salaryRange),
    asText(fields.employmentType),
    asText(fields.remoteType),
    asText(fields.applyUrl),
  ].join('\n');
  return createHash('sha256').update(payload).digest('hex');
}

function applySnapshotToDoc(
  snapshot: IJobBoardListSnapshot,
  jobUrl: string,
  jobId: string,
  applyUrl?: string
): Partial<IJobBoardListing> {
  const desc = snapshot.jobDescription || '';
  const normalizedApply = normalizeJobUrl(applyUrl);
  const normalizedJob = normalizeJobUrl(jobUrl) || jobUrl;
  // Never store aggregator hosts as the Apply target when no employer URL was found.
  const apply =
    (normalizedApply && !isAggregatorPostingUrl(normalizedApply) ? normalizedApply : '') ||
    (normalizedJob && !isAggregatorPostingUrl(normalizedJob) ? normalizedJob : '') ||
    '';
  return {
    jobTitle: snapshot.jobTitle || '',
    companyName: snapshot.companyName || '',
    jobDescription: desc,
    descriptionSnippet: makeDescriptionSnippet(desc),
    jobCategory: snapshot.jobCategory || '',
    location: snapshot.location || '',
    salaryRange: snapshot.salaryRange || '',
    employmentType: snapshot.employmentType || '',
    remoteType: snapshot.remoteType || '',
    jobExperience: snapshot.jobExperience || 0,
    sectorIndustry: snapshot.sectorIndustry || '',
    f500: snapshot.f500 || '',
    date: snapshot.date ? new Date(snapshot.date) : null,
    applyUrl: apply,
    jobId: jobId || '',
    companyLogoUrl: snapshot.companyLogoUrl || '',
    about: snapshot.about || '',
    skills: snapshot.skills || [],
    responsibilities: snapshot.responsibilities || [],
    minimumQualifications: snapshot.minimumQualifications || [],
    preferredQualifications: snapshot.preferredQualifications || [],
    benefits: snapshot.benefits || [],
    certifications: snapshot.certifications || [],
    seniorityLevel: snapshot.seniorityLevel || '',
    roleType: snapshot.roleType || '',
    educationRequirement: snapshot.educationRequirement || '',
    visaSponsorship: snapshot.visaSponsorship || '',
    companyEmployeeCount: snapshot.companyEmployeeCount || 0,
    companyFoundedYear: snapshot.companyFoundedYear || 0,
    companyWebsite: snapshot.companyWebsite || '',
    aggregatorPostingUrl:
      (snapshot.aggregatorPostingUrl && isAggregatorPostingUrlValue(snapshot.aggregatorPostingUrl)
        ? snapshot.aggregatorPostingUrl
        : '') ||
      (isAggregatorPostingUrlValue(normalizedJob) ? normalizedJob : '') ||
      '',
    contentHash: contentHashFromFields({
      jobTitle: snapshot.jobTitle,
      companyName: snapshot.companyName,
      jobDescription: desc,
      location: snapshot.location,
      salaryRange: snapshot.salaryRange,
      employmentType: snapshot.employmentType,
      remoteType: snapshot.remoteType,
      applyUrl: apply,
    }),
  };
}

function keepExistingEnrichment(prev: any): boolean {
  if (!prev) return false;
  const method = String(prev?.enrichment?.method || '');
  // Ready listings with any real method (incl. list) — do not re-count as jobs added.
  if (prev.status === 'ready' && method && method !== 'none') return true;
  return false;
}

/** Thin / failed HC stubs should be re-queued for enrichment recovery. */
function shouldRequeueIncomplete(prev: any): boolean {
  if (!prev) return false;
  const status = String(prev.status || '');
  if (status === 'queued' || status === 'enriching') return false;
  if (status !== 'partial' && status !== 'failed') return false;
  const err = String(prev?.enrichment?.lastError || '');
  const method = String(prev?.enrichment?.method || '');
  // Exhausted rows stay on Failure Dashboard until manual requeue —
  // do not auto-revive on every aggregator list scrape (burns Scrape.do).
  if (/hiring_cafe_enrichment_exhausted/i.test(err)) return false;
  const attempts = Number(prev?.enrichment?.attempts || 0);
  const maxAttempts = parseInt(
    process.env.HIRING_CAFE_ENRICHMENT_MAX_ATTEMPTS ||
      process.env.JOB_ENRICHMENT_MAX_ATTEMPTS ||
      '10',
    10
  );
  if (attempts >= maxAttempts) return false;
  return (
    /hiring_cafe_html_only/i.test(err) ||
    /hiring_cafe_quality_retry/i.test(err) ||
    /cloudflare/i.test(err) ||
    /scrape_failed/i.test(err) ||
    err === '' ||
    method === 'list' ||
    method === 'none'
  );
}

/**
 * Upsert board stubs / ready rows from a scraper run. Dedupes by jobUrlKey and
 * skips scrape.do when the URL is already on the board or the list row is complete.
 */
export async function enqueueJobBoardEnrichments(opts: {
  ownerId: unknown;
  robotMetaId: string;
  runId: string;
  rows: EnrichmentEnqueueRow[];
  /** e.g. hiring_cafe — empty for company scrapers */
  source?: string | null;
}): Promise<EnrichmentEnqueueStats> {
  const stats: EnrichmentEnqueueStats = {
    considered: 0,
    skippedNoUrl: 0,
    skippedDedup: 0,
    skippedComplete: 0,
    queued: 0,
    readyFromList: 0,
    expiredSkipped: 0,
    uniqueNew: 0,
  };

  const ownerId = normalizeOwnerIdForWrite(opts.ownerId);
  if (!ownerId || !opts.robotMetaId || !opts.runId) {
    logger.log('warn', 'enqueueJobBoardEnrichments: missing ownerId/robotMetaId/runId');
    return stats;
  }

  const listingSource = String(opts.source || '').trim();

  // Dedupe within the batch by jobUrlKey (last row wins for snapshot richness).
  const byKey = new Map<
    string,
    { jobUrl: string; applyUrl: string; snapshot: IJobBoardListSnapshot; jobId: string }
  >();
  for (const row of opts.rows || []) {
    stats.considered += 1;
    const data = row?.data || {};
    const identity = resolveBoardEnqueueIdentity(data, listingSource);
    if (!identity) {
      stats.skippedNoUrl += 1;
      continue;
    }
    const key = jobUrlKey(identity.jobUrl);
    if (!key) {
      stats.skippedNoUrl += 1;
      continue;
    }
    byKey.set(key, {
      jobUrl: identity.jobUrl,
      applyUrl: identity.applyUrl,
      snapshot: identity.snapshot,
      jobId: asText(data.jobId),
    });
  }

  if (byKey.size === 0) return stats;

  const keys = Array.from(byKey.keys());
  const existing = await JobBoardListing.find({ jobUrlKey: { $in: keys } })
    .select('jobUrlKey status enrichment updatedAt')
    .lean();
  const existingByKey = new Map(existing.map((d: any) => [d.jobUrlKey, d]));
  const nowDate = new Date();
  const ops: any[] = [];

  const touchSeen = (key: string, extraSet?: Record<string, unknown>) => ({
    updateOne: {
      filter: { jobUrlKey: key },
      update: {
        $addToSet: { robotMetaIds: opts.robotMetaId, runIds: String(opts.runId) },
        $set: { lastSeenAt: nowDate, ownerId, ...(extraSet || {}) },
      },
    },
  });

  for (const [key, item] of byKey) {
    const prev = existingByKey.get(key);

    if (prev?.status === 'expired') {
      stats.expiredSkipped += 1;
      ops.push(touchSeen(key));
      continue;
    }

    const acceptList = isListRowComplete(item.snapshot, { source: listingSource });

    // Duplicate URL already on the board: never re-queue scrape.do — unless it is a
    // recoverable HC/partial failure that should be tried again by enrichment.
    if (prev && !acceptList && !shouldRequeueIncomplete(prev)) {
      stats.skippedDedup += 1;
      ops.push(
        touchSeen(
          key,
          prev.status === 'queued' || prev.status === 'enriching'
            ? { listSnapshot: item.snapshot, applyUrl: item.applyUrl }
            : undefined
        )
      );
      continue;
    }

    if (prev && keepExistingEnrichment(prev)) {
      stats.skippedDedup += 1;
      ops.push(touchSeen(key));
      continue;
    }

    const fields = applySnapshotToDoc(item.snapshot, item.jobUrl, item.jobId, item.applyUrl);
    const isNew = !prev;

    if (acceptList) {
      // Only count brand-new board docs as "jobs added" — retouching an existing
      // ready/list row must not inflate the dashboard Jobs Added metric.
      if (isNew) {
        stats.readyFromList += 1;
      } else {
        stats.skippedDedup += 1;
      }
      stats.skippedComplete += 1;

      // List-complete rows never hit the enrichment worker — tag here so Specialty
      // badges appear for every source (career scrapers, HC list-complete, etc.).
      const tagFields: Record<string, unknown> = {};
      try {
        const tagResult = await classifyJobCategories({
          title: String(fields.jobTitle || ''),
          description: String(fields.jobDescription || ''),
          contentHash: String(fields.contentHash || ''),
          existingClassification: (prev as any)?.categoryClassification || null,
        });
        if (!tagResult.skipUpdate) {
          tagFields.frozenCategories = tagResult.frozenCategories;
          if (tagResult.categoryClassification) {
            tagFields.categoryClassification = tagResult.categoryClassification;
          }
        }
      } catch (err: any) {
        logger.log(
          'warn',
          `enqueueJobBoardEnrichments tagger failed (fail-open) for ${item.jobUrl}: ${err?.message || err}`
        );
      }

      ops.push({
        updateOne: {
          filter: { jobUrlKey: key },
          update: {
            $setOnInsert: {
              jobUrlKey: key,
              jobUrl: item.jobUrl,
              createdAt: nowDate,
            },
            $addToSet: { robotMetaIds: opts.robotMetaId, runIds: String(opts.runId) },
            $set: {
              ...fields,
              ...tagFields,
              ownerId,
              status: 'ready',
              lastSeenAt: nowDate,
              listSnapshot: item.snapshot,
              ...(listingSource ? { source: listingSource } : {}),
              enrichment: {
                method: 'list',
                tier: 0,
                attempts: 0,
                creditsSpent: 0,
                lastError: '',
                lastEnrichedAt: nowDate,
                nextAttemptAt: null,
              },
              priority: 0,
              leaseUntil: null,
              claimedBy: null,
            },
          },
          upsert: true,
        },
      });
      continue;
    }

    if (isNew) {
      stats.queued += 1;
    } else {
      // Existing incomplete stub — refresh snapshot but do not double-count as added.
      stats.skippedDedup += 1;
    }
    ops.push({
      updateOne: {
        filter: { jobUrlKey: key },
        update: {
          $setOnInsert: {
            jobUrlKey: key,
            jobUrl: item.jobUrl,
            createdAt: nowDate,
          },
          $addToSet: { robotMetaIds: opts.robotMetaId, runIds: String(opts.runId) },
          $set: {
            ...fields,
            ownerId,
            status: 'queued',
            lastSeenAt: nowDate,
            listSnapshot: item.snapshot,
            ...(listingSource ? { source: listingSource } : {}),
            priority: listingSource === 'hiring_cafe' ? 10 : 0,
            leaseUntil: null,
            claimedBy: null,
            // Full object only — do not also set enrichment.* dotted paths (Mongo conflict).
            enrichment: {
              method: 'none',
              tier: 0,
              attempts: 0,
              creditsSpent: 0,
              lastError: '',
              lastEnrichedAt: null,
              nextAttemptAt: null,
            },
          },
        },
        upsert: true,
      },
    });
  }

  if (ops.length > 0) {
    const CHUNK = 200;
    for (let i = 0; i < ops.length; i += CHUNK) {
      await JobBoardListing.bulkWrite(ops.slice(i, i + CHUNK), { ordered: false });
    }
  }

  // Employer-keyed rows collapse soft-gate twins still keyed on aggregator posting URLs.
  try {
    const collapsed = await collapseSoftGateOrphansForEmployerBatch(Array.from(byKey.values()));
    if (collapsed > 0) {
      logger.log(
        'info',
        `job-board enqueue collapsed ${collapsed} soft-gate orphan(s) for robot=${opts.robotMetaId}`
      );
    }
  } catch (err: any) {
    logger.log(
      'warn',
      `job-board enqueue soft-gate collapse failed (fail-open): ${err?.message || err}`
    );
  }

  stats.uniqueNew = (Number(stats.queued) || 0) + (Number(stats.readyFromList) || 0);

  logger.log(
    'info',
    `job-board enqueue owner=${ownerId} robot=${opts.robotMetaId} considered=${stats.considered} queued=${stats.queued} readyFromList=${stats.readyFromList} uniqueNew=${stats.uniqueNew} dedup=${stats.skippedDedup} noUrl=${stats.skippedNoUrl}`
  );

  return stats;
}

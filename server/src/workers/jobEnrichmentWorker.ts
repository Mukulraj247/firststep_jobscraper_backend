import { createHash } from 'crypto';
import JobBoardListing, { IJobBoardListing } from '../models/JobBoardListing';
import EnrichmentCreditBudget from '../models/EnrichmentCreditBudget';
import { getLlmUsageToday, addLlmUsage } from '../models/LlmUsageBudget';
import { fetchAtsJob, detectAts, shouldNeverScrapeDoUrl, shouldSkipScrapeDoUrl } from '../services/atsAdapters';
import {
  isHiringCafeUrl,
  isConsiderBoardUrl,
  isConsiderJobPostingUrl,
  usesAggregatorHtmlOnlyEnrichment,
  usesConsiderApplyThenAtsEnrichment,
} from '../services/aggregatorIdentity';
import {
  fetchBrowserJobFallback,
  shouldTryBrowserJobFallback,
} from '../services/browserJobFallback';
import { scrapeJobPage } from '../services/scrapeDoClient';
import { jobUrlKey, normalizeJobUrl } from '../services/jobUrlNormalize';
import {
  descriptionQualityScore,
  decodeHtmlEntities,
  makeDescriptionSnippet,
  mergeParsedFields,
  ParsedJobFields,
  pickBestDescription,
  sanitizeCompanyName,
  normalizeJobDescription,
  normalizeSalaryRange,
  normalizeLocation,
  deriveFieldsFromDescription,
  isBoardQualityPass,
  preferJobUrlTitle,
  htmlToPlainText,
} from '../services/jobPageParser';
import { contentHashFromFields, isListRowComplete } from '../services/jobBoardEnrichment';
import {
  extractJobFieldsWithGemini,
  isGeminiConfigured,
  hashLlmInput,
  StructuredJobSections,
  LLM_DAILY_CALL_BUDGET,
  LLM_DAILY_TOKEN_BUDGET,
} from '../services/geminiJobExtractor';
import { classifyJobCategories } from '../services/jobCategoryTagger';
import logger from '../logger';

export const JOB_ENRICHMENT_CONCURRENCY = parseInt(process.env.JOB_ENRICHMENT_CONCURRENCY || '5', 10);
/** Keep modest — IBM Playwright enrichments are serialized and long-leased. */
export const JOB_ENRICHMENT_BATCH = parseInt(process.env.JOB_ENRICHMENT_BATCH || '8', 10);
export const JOB_ENRICHMENT_RATE_PER_MIN = parseInt(process.env.JOB_ENRICHMENT_RATE_PER_MIN || '12', 10);
export const JOB_ENRICHMENT_MAX_ATTEMPTS = parseInt(process.env.JOB_ENRICHMENT_MAX_ATTEMPTS || '4', 10);
export const SCRAPE_DO_DAILY_CREDIT_BUDGET = parseInt(
  process.env.SCRAPE_DO_DAILY_CREDIT_BUDGET || '15000',
  10
);
/** Long enough for serialized browser enrichments (e.g. IBM WAF) within a batch. */
const LEASE_MS = 15 * 60 * 1000;

export interface EnrichmentPassMetrics {
  claimed: number;
  ats_hit: number;
  llm_hit: number;
  llm_tokens: number;
  llm_budget_paused: boolean;
  tier1: number;
  tier2: number;
  tier3: number;
  credits_spent: number;
  ready: number;
  partial: number;
  failed: number;
  expired: number;
  rate_limited: number;
  budget_paused: boolean;
}

const emptyMetrics = (): EnrichmentPassMetrics => ({
  claimed: 0,
  ats_hit: 0,
  llm_hit: 0,
  llm_tokens: 0,
  llm_budget_paused: false,
  tier1: 0,
  tier2: 0,
  tier3: 0,
  credits_spent: 0,
  ready: 0,
  partial: 0,
  failed: 0,
  expired: 0,
  rate_limited: 0,
  budget_paused: false,
});

/** Simple token bucket shared by the enrichment process. */
class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly ratePerMin: number,
    private readonly capacity: number
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  private refill() {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    const add = (elapsed / 60_000) * this.ratePerMin;
    this.tokens = Math.min(this.capacity, this.tokens + add);
    this.lastRefill = now;
  }

  tryTake(): boolean {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }

  msUntilToken(): number {
    this.refill();
    if (this.tokens >= 1) return 0;
    const deficit = 1 - this.tokens;
    return Math.ceil((deficit / this.ratePerMin) * 60_000);
  }
}

class CircuitBreaker {
  private failures = 0;
  private windowStart = Date.now();
  private openUntil = 0;

  constructor(
    private readonly threshold = 8,
    private readonly windowMs = 60_000,
    private readonly coolDownMs = 60_000
  ) {}

  recordFailure() {
    const now = Date.now();
    if (now - this.windowStart > this.windowMs) {
      this.windowStart = now;
      this.failures = 0;
    }
    this.failures += 1;
    if (this.failures >= this.threshold) {
      this.openUntil = now + this.coolDownMs;
      this.failures = 0;
      this.windowStart = now;
    }
  }

  recordSuccess() {
    this.failures = Math.max(0, this.failures - 1);
  }

  isOpen(): boolean {
    return Date.now() < this.openUntil;
  }

  remainingMs(): number {
    return Math.max(0, this.openUntil - Date.now());
  }
}

const rateLimiter = new TokenBucket(JOB_ENRICHMENT_RATE_PER_MIN, JOB_ENRICHMENT_RATE_PER_MIN);
const circuitBreaker = new CircuitBreaker();
const WORKER_ID = `enrich-${process.pid}-${createHash('sha1').update(String(Date.now())).digest('hex').slice(0, 8)}`;

function budgetDayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export async function getCreditsSpentToday(): Promise<number> {
  const doc = await EnrichmentCreditBudget.findById(budgetDayKey()).lean();
  return doc?.creditsSpent || 0;
}

export async function addCreditsSpent(amount: number): Promise<number> {
  if (amount <= 0) return getCreditsSpentToday();
  const updated = await EnrichmentCreditBudget.findByIdAndUpdate(
    budgetDayKey(),
    { $inc: { creditsSpent: amount }, $setOnInsert: { _id: budgetDayKey() } },
    { upsert: true, new: true }
  ).lean();
  return updated?.creditsSpent || amount;
}

export async function recoverExpiredLeases(): Promise<number> {
  const res = await JobBoardListing.updateMany(
    { status: 'enriching', leaseUntil: { $lt: new Date() } },
    {
      $set: {
        status: 'queued',
        leaseUntil: null,
        claimedBy: null,
      },
    }
  );
  return res.modifiedCount || 0;
}

/**
 * Rows that failed when Phenom detail fetch did not exist. Re-queue a small
 * batch each pass so NVIDIA / Qualcomm listings can hit the free apply API.
 */
export async function recoverPhenomAtsSkipFailures(limit = 40): Promise<number> {
  const docs = await JobBoardListing.find({
    status: 'failed',
    'enrichment.lastError': 'career_host_skip_scrape_do',
    $or: [
      { jobUrl: /\/careers\/job\/\d+|[?&]pid=\d+/i },
      { applyUrl: /\/careers\/job\/\d+|[?&]pid=\d+/i },
    ],
  })
    .select('_id jobUrl applyUrl')
    .limit(limit)
    .lean();

  const ids = docs
    .filter((row) => {
      const urls = [row.jobUrl, row.applyUrl].filter(Boolean) as string[];
      return urls.some((url) => detectAts(url)?.provider === 'phenom');
    })
    .map((row) => row._id);
  if (!ids.length) return 0;

  const res = await JobBoardListing.updateMany(
    { _id: { $in: ids } },
    {
      $set: {
        status: 'queued',
        leaseUntil: null,
        claimedBy: null,
        'enrichment.nextAttemptAt': null,
        'enrichment.lastError': '',
      },
    }
  );
  return res.modifiedCount || 0;
}

async function claimBatch(limit: number): Promise<IJobBoardListing[]> {
  const claimed: IJobBoardListing[] = [];
  const now = new Date();
  const leaseUntil = new Date(Date.now() + LEASE_MS);

  // Prefer Hiring Cafe / aggregator stubs first — they are thin list rows that only
  // become visible on the Job Board after enrichment, and they were starving behind
  // large career-site queues.
  const claimFilters: Array<Record<string, unknown>> = [
    { source: 'hiring_cafe' },
    {
      source: {
        $in: ['accel', 'sequoia', 'capitalg', 'choppingblock', 'aidevboard', 'startups_gallery'],
      },
    },
    {}, // anything else queued
  ];

  for (const extra of claimFilters) {
    while (claimed.length < limit) {
      const doc = await JobBoardListing.findOneAndUpdate(
        {
          status: 'queued',
          ...extra,
          $or: [
            { 'enrichment.nextAttemptAt': null },
            { 'enrichment.nextAttemptAt': { $lte: now } },
            { 'enrichment.nextAttemptAt': { $exists: false } },
          ],
        },
        {
          $set: {
            status: 'enriching',
            leaseUntil,
            claimedBy: WORKER_ID,
          },
        },
        {
          sort: { priority: -1, createdAt: 1 },
          returnDocument: 'after',
        }
      );
      if (!doc) break;
      claimed.push(doc);
    }
    if (claimed.length >= limit) break;
  }
  return claimed;
}

function snapshotAsFields(doc: IJobBoardListing): ParsedJobFields {
  const s = doc.listSnapshot || {};
  return {
    jobTitle: decodeHtmlEntities(s.jobTitle || ''),
    companyName: sanitizeCompanyName(s.companyName || ''),
    jobDescription: decodeHtmlEntities(s.jobDescription || ''),
    location: decodeHtmlEntities(s.location || ''),
    salaryRange: decodeHtmlEntities(s.salaryRange || ''),
    employmentType: decodeHtmlEntities(s.employmentType || ''),
    remoteType: decodeHtmlEntities(s.remoteType || ''),
    date: s.date ? new Date(s.date).toISOString() : '',
    applyUrl: doc.jobUrl || '',
    companyLogoUrl: '',
    jobCategory: decodeHtmlEntities(s.jobCategory || ''),
    source: 'none',
  };
}

function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Keep the persisted status aligned with Job Board eligibility. Previously a
 * generic landing-page title with an empty description became `partial`, while
 * the API correctly hid it — causing confusing non-zero board badges.
 */
function boardListingStatus(fields: ParsedJobFields, jobUrl: string): 'ready' | 'failed' {
  return isBoardQualityPass({
    title: fields.jobTitle,
    description: fields.jobDescription,
    jobUrl,
  })
    ? 'ready'
    : 'failed';
}

async function persistResult(
  doc: IJobBoardListing,
  fields: ParsedJobFields,
  opts: {
    status: 'ready' | 'partial' | 'failed' | 'expired' | 'queued';
    method: 'ats' | 'scrape.do' | 'browser' | 'llm' | 'list' | 'none';
    tier: number;
    creditsSpent: number;
    error?: string;
    nextAttemptAt?: Date | null;
    incrementAttempts?: boolean;
    externalJobId?: string;
    structured?: StructuredJobSections;
    jobExperienceOverride?: number;
    llmModel?: string;
    llmInputHash?: string;
    llmTokens?: number;
  }
): Promise<void> {
  const list = doc.listSnapshot || {};
  const pick = (scraped: string, current: string, snapshot: string) =>
    decodeHtmlEntities(scraped || '') ||
    decodeHtmlEntities(current || '') ||
    decodeHtmlEntities(snapshot || '');

  const mergedTitleRaw = pick(fields.jobTitle, doc.jobTitle, list.jobTitle || '');
  const mergedTitle = preferJobUrlTitle(mergedTitleRaw, doc.jobUrl || doc.applyUrl || '');
  const mergedCompany =
    sanitizeCompanyName(fields.companyName) ||
    sanitizeCompanyName(doc.companyName) ||
    sanitizeCompanyName(list.companyName || '') ||
    '';
  const mergedDesc = normalizeJobDescription(
    pickBestDescription(
      fields.jobDescription || '',
      pickBestDescription(doc.jobDescription || '', list.jobDescription || '')
    )
  );
  const mergedLocation = normalizeLocation(
    pick(fields.location, doc.location, list.location || '')
  );
  const mergedSalary = normalizeSalaryRange(
    pick(fields.salaryRange, doc.salaryRange, list.salaryRange || ''),
    { location: mergedLocation }
  );
  const descScore = descriptionQualityScore(mergedDesc);
  const derived = descScore > 0 ? deriveFieldsFromDescription(mergedDesc) : {
    jobExperience: 0,
    employmentType: '',
    remoteType: '',
  };
  const mergedEmployment =
    pick(fields.employmentType, doc.employmentType, list.employmentType || '') ||
    derived.employmentType;
  // Never keep Remote stamped from junk chrome; prefer scraped/list only when present.
  const mergedRemote =
    pick(fields.remoteType, doc.remoteType, list.remoteType || '') ||
    (descScore > 0 ? derived.remoteType : '');
  const applyUrl = fields.applyUrl || doc.applyUrl || doc.jobUrl;
  const companyLogoUrl = fields.companyLogoUrl || (doc as any).companyLogoUrl || '';
  const jobCategory =
    decodeHtmlEntities(fields.jobCategory || '') ||
    decodeHtmlEntities(doc.jobCategory || list.jobCategory || '');
  const geminiExp =
    typeof opts.jobExperienceOverride === 'number' && opts.jobExperienceOverride > 0
      ? opts.jobExperienceOverride
      : typeof fields._jobExperience === 'number' && fields._jobExperience > 0
        ? fields._jobExperience
        : 0;
  const jobExperience =
    geminiExp ||
    (typeof doc.jobExperience === 'number' && doc.jobExperience > 0 ? doc.jobExperience : 0) ||
    (typeof list.jobExperience === 'number' && list.jobExperience > 0 ? list.jobExperience : 0) ||
    derived.jobExperience ||
    0;
  const jobId = opts.externalJobId || doc.jobId || '';
  const hash = contentHashFromFields({
    jobTitle: mergedTitle,
    companyName: mergedCompany,
    jobDescription: mergedDesc,
    location: mergedLocation,
    salaryRange: mergedSalary,
    employmentType: mergedEmployment,
    remoteType: mergedRemote,
    applyUrl,
  });

  // Skip field writes when nothing changed (still update status/lease).
  const skipContent = hash && hash === doc.contentHash && opts.status === 'ready' && !opts.structured;

  const attempts = (doc.enrichment?.attempts || 0) + (opts.incrementAttempts ? 1 : 0);
  const creditsSpent = (doc.enrichment?.creditsSpent || 0) + (opts.creditsSpent || 0);
  const date = fields.date ? new Date(fields.date) : doc.date || list.date || null;

  const enrichment: Record<string, any> = {
    method: opts.method,
    tier: opts.tier,
    attempts,
    creditsSpent,
    lastError: opts.error || '',
    lastEnrichedAt:
      opts.status === 'ready' || opts.status === 'partial' ? new Date() : doc.enrichment?.lastEnrichedAt || null,
    nextAttemptAt: opts.nextAttemptAt ?? null,
    llmModel: opts.llmModel || doc.enrichment?.llmModel || '',
    llmInputHash: opts.llmInputHash || doc.enrichment?.llmInputHash || '',
    llmTokens: opts.llmTokens ?? doc.enrichment?.llmTokens ?? 0,
  };

  const $set: Record<string, any> = {
    status: opts.status,
    leaseUntil: null,
    claimedBy: null,
    enrichment,
  };

  if (!skipContent) {
    Object.assign($set, {
      jobTitle: mergedTitle,
      companyName: mergedCompany,
      jobDescription: mergedDesc,
      descriptionSnippet: makeDescriptionSnippet(mergedDesc),
      location: mergedLocation,
      salaryRange: mergedSalary,
      employmentType: mergedEmployment,
      remoteType: mergedRemote,
      applyUrl,
      companyLogoUrl,
      jobId,
      contentHash: hash,
      date: date instanceof Date && !Number.isNaN(date.getTime()) ? date : doc.date,
      sectorIndustry: doc.sectorIndustry || list.sectorIndustry || '',
      f500: doc.f500 || list.f500 || '',
      jobCategory,
      jobExperience,
    });
  }

  // Structured sections: write only when non-empty (never blank existing good data).
  const structured = opts.structured;
  if (structured) {
    if (structured.about) $set.about = structured.about;
    if (structured.minimumQualifications?.length) {
      $set.minimumQualifications = structured.minimumQualifications;
    }
    if (structured.preferredQualifications?.length) {
      $set.preferredQualifications = structured.preferredQualifications;
    }
    if (structured.responsibilities?.length) {
      $set.responsibilities = structured.responsibilities;
    }
    if (structured.benefits?.length) $set.benefits = structured.benefits;
    if (structured.skills?.length) $set.skills = structured.skills;
  }

  if (opts.status === 'ready' || opts.status === 'partial') {
    try {
      const tagResult = await classifyJobCategories({
        id: doc._id?.toString?.(),
        title: mergedTitle,
        description: mergedDesc,
        contentHash: hash,
        existingClassification: (doc as any).categoryClassification || null,
      });
      if (!tagResult.skipUpdate) {
        $set.frozenCategories = tagResult.frozenCategories;
        if (tagResult.categoryClassification) {
          $set.categoryClassification = tagResult.categoryClassification;
        }
      }
    } catch (err: any) {
      logger.log(
        'warn',
        `[jobEnrichment] category tagger failed (fail-open) for ${doc._id?.toString?.()}: ${err?.message || err}`
      );
    }
  }

  await JobBoardListing.updateOne({ _id: doc._id }, { $set });
}

async function processOne(doc: IJobBoardListing, metrics: EnrichmentPassMetrics): Promise<void> {
  const listFields = snapshotAsFields(doc);
  const sourceKey = String(doc.source || '').toLowerCase();
  const isHiringCafeSource = sourceKey === 'hiring_cafe';
  const isAccelSource = sourceKey === 'accel';
  const isConsiderAtsSource = usesConsiderApplyThenAtsEnrichment(sourceKey);
  // HC / Accel / Chopping Block / AI Dev Board stay on aggregator payload only.
  const isAggregatorHtmlSource = usesAggregatorHtmlOnlyEnrichment(sourceKey);

  // Consider (Sequoia / CapitalG): if employer apply missing, light-fetch posting to resolve it.
  if (isConsiderAtsSource) {
    const list = doc.listSnapshot || {};
    const hasEmployerApply =
      Boolean(doc.applyUrl && !isConsiderBoardUrl(String(doc.applyUrl))) ||
      Boolean(doc.jobUrl && !isConsiderBoardUrl(String(doc.jobUrl)));
    if (!hasEmployerApply) {
      const considerPosting =
        String(doc.aggregatorPostingUrl || '').trim() ||
        String(list.aggregatorPostingUrl || '').trim() ||
        (isConsiderJobPostingUrl(doc.jobUrl || '') ? String(doc.jobUrl || '').trim() : '');
      if (considerPosting && isConsiderJobPostingUrl(considerPosting)) {
        try {
          const {
            fetchConsiderPostingHtml,
            enrichConsiderRowFromHtml,
            isConsiderHtmlJobPage,
          } = await import('../services/sequoiaHtmlLight');
          const light = await fetchConsiderPostingHtml(considerPosting);
          if (light.ok && light.html && isConsiderHtmlJobPage(light.html)) {
            const mergedRow = enrichConsiderRowFromHtml({}, light.html, considerPosting);
            const externalApply = String(mergedRow.applyUrl || '').trim();
            if (externalApply && !isConsiderBoardUrl(externalApply)) {
              const normalizedApply = normalizeJobUrl(externalApply) || externalApply;
              doc.applyUrl = normalizedApply;
              if (!doc.jobUrl || isConsiderBoardUrl(String(doc.jobUrl))) {
                doc.jobUrl = normalizedApply;
              }
              await JobBoardListing.updateOne(
                { _id: doc._id },
                {
                  $set: {
                    applyUrl: normalizedApply,
                    jobUrl: doc.jobUrl,
                    jobUrlKey: jobUrlKey(doc.jobUrl) || undefined,
                    aggregatorPostingUrl: considerPosting,
                    'listSnapshot.aggregatorPostingUrl': considerPosting,
                    ...(mergedRow.jobTitle ? { jobTitle: String(mergedRow.jobTitle) } : {}),
                    ...(mergedRow.companyName ? { companyName: String(mergedRow.companyName) } : {}),
                    ...(mergedRow.location ? { location: String(mergedRow.location) } : {}),
                  },
                }
              );
            }
          }
        } catch (err: any) {
          logger.log('warn', `Consider apply resolve failed: ${err?.message || err}`);
        }
      }
    }
  }

  // Aggregator HTML sources: never leave the posting URL for ATS / employer scrapes.
  // Light HTML path below handles incomplete rows.
  if (!isAggregatorHtmlSource) {
    // Tier 0: ATS direct — try jobUrl first, then applyUrl if they differ.
    // Consider + startups.gallery rows reach this branch.
    const atsCandidates = [doc.jobUrl, doc.applyUrl].filter(
      (url, index, all): url is string =>
        Boolean(url) && !isConsiderBoardUrl(url) && all.indexOf(url) === index
    );
    let ats: Awaited<ReturnType<typeof fetchAtsJob>> = null;
    for (const url of atsCandidates) {
      ats = await fetchAtsJob(url);
      await yieldEventLoop();
      if (ats?.fields && (ats.fields.jobTitle || ats.fields.jobDescription)) break;
      ats = null;
    }
    if (ats?.fields && (ats.fields.jobTitle || ats.fields.jobDescription)) {
      metrics.ats_hit += 1;
      const merged = mergeParsedFields(ats.fields, listFields);
      const status = boardListingStatus(merged, doc.jobUrl);
      await persistResult(doc, merged, {
        status,
        method: 'ats',
        tier: 0,
        creditsSpent: 0,
        incrementAttempts: true,
        externalJobId: ats.externalJobId,
      });
      if (status === 'ready') metrics.ready += 1;
      else metrics.failed += 1;
      circuitBreaker.recordSuccess();
      return;
    }
  }

  // CDN / social / aggregator hosts: never spend scrape.do.
  // HC / Accel sources use light HTML instead — do not expire those rows here.
  // Consider: if still stuck on board hosts after resolve, skip scrape.do.
  if (
    isConsiderAtsSource &&
    isConsiderBoardUrl(doc.jobUrl || '') &&
    (!doc.applyUrl || isConsiderBoardUrl(String(doc.applyUrl || '')))
  ) {
    const status = boardListingStatus(listFields, doc.jobUrl);
    await persistResult(doc, listFields, {
      status: status === 'ready' ? 'ready' : 'partial',
      method: 'list',
      tier: 0,
      creditsSpent: 0,
      error: 'consider_no_employer_apply_url',
      incrementAttempts: true,
    });
    if (status === 'ready') metrics.ready += 1;
    else metrics.failed += 1;
    circuitBreaker.recordSuccess();
    return;
  }

  if (
    !isAggregatorHtmlSource &&
    (shouldNeverScrapeDoUrl(doc.jobUrl || '') || shouldNeverScrapeDoUrl(doc.applyUrl || ''))
  ) {
    metrics.expired += 1;
    await persistResult(doc, listFields, {
      status: 'expired',
      method: 'none',
      tier: 0,
      creditsSpent: 0,
      error: 'non_job_host_skip_scrape_do',
      incrementAttempts: true,
    });
    return;
  }

  // HTML-only aggregators: light-fetch before list-complete short-circuit.
  // Chopping Block: light HTML of CB posting only.
  if (sourceKey === 'choppingblock') {
    const list = doc.listSnapshot || {};
    const { isChoppingBlockJobPostingUrl } = await import('../services/aggregatorIdentity');
    const cbPosting =
      String(doc.aggregatorPostingUrl || '').trim() ||
      String(list.aggregatorPostingUrl || '').trim() ||
      (isChoppingBlockJobPostingUrl(doc.jobUrl || '') ? String(doc.jobUrl || '').trim() : '');
    if (cbPosting && isChoppingBlockJobPostingUrl(cbPosting)) {
      try {
        const {
          fetchChoppingBlockPostingHtml,
          enrichChoppingBlockRowFromHtml,
          isChoppingBlockHtmlJobPage,
        } = await import('../services/choppingblockHtmlLight');
        const light = await fetchChoppingBlockPostingHtml(cbPosting);
        if (light.ok && light.html && isChoppingBlockHtmlJobPage(light.html)) {
          const mergedRow = enrichChoppingBlockRowFromHtml({}, light.html, cbPosting);
          const fields: ParsedJobFields = {
            jobTitle: String(mergedRow.jobTitle || ''),
            companyName: String(mergedRow.companyName || ''),
            jobDescription: String(mergedRow.jobDescription || ''),
            location: String(mergedRow.location || ''),
            salaryRange: String(mergedRow.salaryRange || ''),
            employmentType: String(mergedRow.employmentType || ''),
            remoteType: String(mergedRow.remoteType || ''),
            date: String(mergedRow.date || ''),
            applyUrl: String(mergedRow.applyUrl || ''),
            companyLogoUrl: '',
            jobCategory: '',
            source: 'html',
          };
          const merged = mergeParsedFields(fields, listFields);
          const status = boardListingStatus(merged, doc.jobUrl);
          await persistResult(doc, merged, {
            status,
            method: 'list',
            tier: 0,
            creditsSpent: 0,
            incrementAttempts: true,
          });
          if (status === 'ready') metrics.ready += 1;
          else metrics.failed += 1;
          circuitBreaker.recordSuccess();
          return;
        }
      } catch (err: any) {
        logger.log('warn', `Chopping Block light enrich failed: ${err?.message || err}`);
      }
    }
    const status = boardListingStatus(listFields, doc.jobUrl);
    await persistResult(doc, listFields, {
      status: status === 'ready' ? 'ready' : 'partial',
      method: 'list',
      tier: 0,
      creditsSpent: 0,
      error: 'choppingblock_html_only_no_employer_scrape',
      incrementAttempts: true,
    });
    if (status === 'ready') metrics.ready += 1;
    else metrics.failed += 1;
    circuitBreaker.recordSuccess();
    return;
  }

  // AI Dev Board: API/HTML of ADB posting only.
  if (sourceKey === 'aidevboard') {
    const list = doc.listSnapshot || {};
    const { isAidevboardJobPostingUrl } = await import('../services/aggregatorIdentity');
    const adbPosting =
      String(doc.aggregatorPostingUrl || '').trim() ||
      String(list.aggregatorPostingUrl || '').trim() ||
      (isAidevboardJobPostingUrl(doc.jobUrl || '') ? String(doc.jobUrl || '').trim() : '');
    if (adbPosting && isAidevboardJobPostingUrl(adbPosting)) {
      try {
        const { aidevboardJobIdFromUrl } = await import('../services/aidevboardDetail');
        const { fetchAidevboardJobById, enrichAidevboardRowFromFields } = await import(
          '../services/aidevboardApiLight'
        );
        const jobId = aidevboardJobIdFromUrl(adbPosting);
        const result = await fetchAidevboardJobById(jobId);
        if (result.ok && result.fields) {
          const mergedRow = enrichAidevboardRowFromFields({}, result.fields, adbPosting);
          const fields: ParsedJobFields = {
            jobTitle: String(mergedRow.jobTitle || ''),
            companyName: String(mergedRow.companyName || ''),
            jobDescription: String(mergedRow.jobDescription || ''),
            location: String(mergedRow.location || ''),
            salaryRange: String(mergedRow.salaryRange || ''),
            employmentType: String(mergedRow.employmentType || ''),
            remoteType: String(mergedRow.remoteType || ''),
            date: String(mergedRow.date || ''),
            applyUrl: String(mergedRow.applyUrl || ''),
            companyLogoUrl: String(mergedRow.companyLogoUrl || ''),
            jobCategory: '',
            source: 'html',
          };
          const merged = mergeParsedFields(fields, listFields);
          const status = boardListingStatus(merged, doc.jobUrl);
          await persistResult(doc, merged, {
            status,
            method: 'list',
            tier: 0,
            creditsSpent: 0,
            incrementAttempts: true,
          });
          if (status === 'ready') metrics.ready += 1;
          else metrics.failed += 1;
          circuitBreaker.recordSuccess();
          return;
        }
      } catch (err: any) {
        logger.log('warn', `AI Dev Board light enrich failed: ${err?.message || err}`);
      }
    }
    const status = boardListingStatus(listFields, doc.jobUrl);
    await persistResult(doc, listFields, {
      status: status === 'ready' ? 'ready' : 'partial',
      method: 'list',
      tier: 0,
      creditsSpent: 0,
      error: 'aidevboard_html_only_no_employer_scrape',
      incrementAttempts: true,
    });
    if (status === 'ready') metrics.ready += 1;
    else metrics.failed += 1;
    circuitBreaker.recordSuccess();
    return;
  }

  // Accel: light HTTP HTML of the Accel posting only — never scrape.do / employer pages.
  if (isAccelSource) {
    const list = doc.listSnapshot || {};
    const { isAccelJobPostingUrl } = await import('../services/aggregatorIdentity');
    const accelPosting =
      String(doc.aggregatorPostingUrl || '').trim() ||
      String(list.aggregatorPostingUrl || '').trim() ||
      (isAccelJobPostingUrl(doc.jobUrl || '') ? String(doc.jobUrl || '').trim() : '');

    if (accelPosting && isAccelJobPostingUrl(accelPosting)) {
      try {
        const {
          fetchAccelPostingHtml,
          enrichAccelRowFromHtml,
          isAccelHtmlJobPage,
        } = await import('../services/accelHtmlLight');
        const light = await fetchAccelPostingHtml(accelPosting);
        if (light.ok && light.html && isAccelHtmlJobPage(light.html)) {
          const mergedRow = enrichAccelRowFromHtml({}, light.html, accelPosting);
          const fields: ParsedJobFields = {
            jobTitle: String(mergedRow.jobTitle || ''),
            companyName: String(mergedRow.companyName || ''),
            jobDescription: String(mergedRow.jobDescription || ''),
            location: String(mergedRow.location || ''),
            salaryRange: String(mergedRow.salaryRange || ''),
            employmentType: String(mergedRow.employmentType || ''),
            remoteType: String(mergedRow.remoteType || ''),
            date: String(mergedRow.date || ''),
            applyUrl: String(mergedRow.applyUrl || ''),
            companyLogoUrl: String(mergedRow.companyLogoUrl || ''),
            jobCategory: String(mergedRow.jobCategory || ''),
            source: 'html',
          };
          const merged = mergeParsedFields(fields, listFields);
          const status = boardListingStatus(merged, doc.jobUrl);
          await persistResult(doc, merged, {
            status,
            method: 'list',
            tier: 0,
            creditsSpent: 0,
            incrementAttempts: true,
            structured: {
              about: String(mergedRow.about || ''),
              skills: [],
              responsibilities: [],
              minimumQualifications: [],
              preferredQualifications: [],
              benefits: [],
            },
          });
          await JobBoardListing.updateOne(
            { _id: doc._id },
            {
              $set: {
                aggregatorPostingUrl: accelPosting,
                'listSnapshot.aggregatorPostingUrl': accelPosting,
                ...(mergedRow.seniorityLevel
                  ? { seniorityLevel: String(mergedRow.seniorityLevel) }
                  : {}),
              },
            }
          );
          if (status === 'ready') metrics.ready += 1;
          else metrics.failed += 1;
          circuitBreaker.recordSuccess();
          return;
        }
      } catch (err: any) {
        logger.log('warn', `Accel light enrich failed: ${err?.message || err}`);
      }
    }

    const status = boardListingStatus(listFields, doc.jobUrl);
    await persistResult(doc, listFields, {
      status: status === 'ready' ? 'ready' : 'partial',
      method: 'list',
      tier: 0,
      creditsSpent: 0,
      error: 'accel_html_only_no_employer_scrape',
      incrementAttempts: true,
    });
    if (status === 'ready') metrics.ready += 1;
    else metrics.failed += 1;
    circuitBreaker.recordSuccess();
    return;
  }

  // Hiring Cafe: HTTP-only in enrichment (direct→proxy). Never Chromium here —
  // scoutx-enrichment shares CHROMIUM_MAX_SLOTS with scrapers and will hang.
  // Real CF clears belong in scoutx-aggregators detail scrape.
  if (isHiringCafeSource) {
    const list = doc.listSnapshot || {};
    const hcPosting =
      String(doc.aggregatorPostingUrl || '').trim() ||
      String(list.aggregatorPostingUrl || '').trim() ||
      (isHiringCafeUrl(doc.jobUrl || '') ? String(doc.jobUrl || '').trim() : '');

    const { isHiringCafeJobPostingUrl } = await import('../services/hiringCafeDetail');
    if (hcPosting && isHiringCafeJobPostingUrl(hcPosting)) {
      let mergedRow: Record<string, unknown> | null = null;
      let enrichMethod: 'list' | 'browser' = 'list';

      try {
        const { enrichHiringCafePostingStandalone } = await import(
          '../services/hiringCafeDetailScrape'
        );
        mergedRow = await enrichHiringCafePostingStandalone(hcPosting, {
          ...(list as Record<string, unknown>),
          jobUrl: hcPosting,
          aggregatorPostingUrl: hcPosting,
        });
        if (mergedRow) {
          enrichMethod = String(mergedRow._enrichMethod || '').includes('browser')
            ? 'browser'
            : 'list';
        }
      } catch (err: any) {
        logger.log('warn', `Hiring Cafe enrich failed: ${err?.message || err}`);
      }

      if (mergedRow) {
        const fields: ParsedJobFields = {
          jobTitle: String(mergedRow.jobTitle || ''),
          companyName: String(mergedRow.companyName || ''),
          jobDescription: String(mergedRow.jobDescription || ''),
          location: String(mergedRow.location || ''),
          salaryRange: String(mergedRow.salaryRange || ''),
          employmentType: String(mergedRow.employmentType || ''),
          remoteType: String(mergedRow.remoteType || ''),
          date: String(mergedRow.date || ''),
          applyUrl: String(mergedRow.applyUrl || ''),
          companyLogoUrl: String(mergedRow.companyLogoUrl || ''),
          jobCategory: String(mergedRow.jobCategory || ''),
          source: 'html',
        };
        const merged = mergeParsedFields(fields, listFields);
        const status = boardListingStatus(merged, doc.jobUrl);
        await persistResult(doc, merged, {
          status,
          method: enrichMethod === 'browser' ? 'browser' : 'list',
          tier: 0,
          creditsSpent: 0,
          incrementAttempts: true,
          structured: {
            about: String(mergedRow.about || ''),
            skills: Array.isArray(mergedRow.skills) ? (mergedRow.skills as string[]) : [],
            responsibilities: Array.isArray(mergedRow.responsibilities)
              ? (mergedRow.responsibilities as string[])
              : [],
            minimumQualifications: Array.isArray(mergedRow.minimumQualifications)
              ? (mergedRow.minimumQualifications as string[])
              : [],
            preferredQualifications: Array.isArray(mergedRow.preferredQualifications)
              ? (mergedRow.preferredQualifications as string[])
              : [],
            benefits: Array.isArray(mergedRow.benefits) ? (mergedRow.benefits as string[]) : [],
          },
        });
        await JobBoardListing.updateOne(
          { _id: doc._id },
          {
            $set: {
              companyWebsite: String(mergedRow.companyWebsite || ''),
              aggregatorPostingUrl: hcPosting,
              companyEmployeeCount: Number(mergedRow.companyEmployeeCount || 0) || 0,
              companyFoundedYear: Number(mergedRow.companyFoundedYear || 0) || 0,
              'listSnapshot.companyWebsite': String(mergedRow.companyWebsite || ''),
              'listSnapshot.aggregatorPostingUrl': hcPosting,
              ...(merged.applyUrl ? { applyUrl: String(merged.applyUrl) } : {}),
            },
          }
        );
        if (status === 'ready') metrics.ready += 1;
        else metrics.failed += 1;
        circuitBreaker.recordSuccess();
        return;
      }
    }

    // HTTP failed (CF). Requeue with backoff — do not burn Chromium from enrichment.
    const attempts = Number(doc.enrichment?.attempts || 0) + 1;
    if (attempts < JOB_ENRICHMENT_MAX_ATTEMPTS) {
      const backoffMs = Math.min(60 * 60_000, 5 * 60_000 * Math.pow(2, Math.max(0, attempts - 1)));
      await persistResult(doc, listFields, {
        status: 'queued',
        method: 'none',
        tier: 0,
        creditsSpent: 0,
        error: 'hiring_cafe_http_cf_retry',
        nextAttemptAt: new Date(Date.now() + backoffMs),
        incrementAttempts: true,
      });
      metrics.failed += 1;
      circuitBreaker.recordSuccess();
      return;
    }

    const status = boardListingStatus(listFields, doc.jobUrl);
    await persistResult(doc, listFields, {
      status: status === 'ready' ? 'ready' : 'partial',
      method: 'list',
      tier: 0,
      creditsSpent: 0,
      error: 'hiring_cafe_html_only_no_employer_scrape',
      incrementAttempts: true,
    });
    if (status === 'ready') metrics.ready += 1;
    else metrics.failed += 1;
    circuitBreaker.recordSuccess();
    return;
  }

  // List already complete: skip scrape.do for career listings (not ATS-first aggregators).
  const needsEmployerScrape =
    usesConsiderApplyThenAtsEnrichment(sourceKey) || sourceKey === 'startups_gallery';
  if (
    isListRowComplete(doc.listSnapshot || {}, { source: doc.source }) &&
    !needsEmployerScrape
  ) {
    const status = boardListingStatus(listFields, doc.jobUrl);
    await persistResult(doc, listFields, {
      status,
      method: 'list',
      tier: 0,
      creditsSpent: 0,
      incrementAttempts: true,
    });
    if (status === 'ready') metrics.ready += 1;
    else metrics.failed += 1;
    circuitBreaker.recordSuccess();
    return;
  }

  // Wait for rate limiter token
  while (!rateLimiter.tryTake()) {
    await new Promise((r) => setTimeout(r, Math.min(rateLimiter.msUntilToken(), 2000)));
  }

  const spentToday = await getCreditsSpentToday();
  if (spentToday >= SCRAPE_DO_DAILY_CREDIT_BUDGET) {
    metrics.budget_paused = true;
    // Put back to queued without burning an attempt
    await JobBoardListing.updateOne(
      { _id: doc._id },
      {
        $set: {
          status: 'queued',
          leaseUntil: null,
          claimedBy: null,
          'enrichment.nextAttemptAt': new Date(Date.now() + 30 * 60 * 1000),
          'enrichment.lastError': 'daily_credit_budget_exhausted',
        },
      }
    );
    return;
  }

  if (!process.env.SCRAPE_DO_TOKEN) {
    // ATS already missed. Without scrape.do, still publish list fields that pass the board gate.
    const status = boardListingStatus(listFields, doc.jobUrl);
    await persistResult(doc, listFields, {
      status: status === 'ready' ? 'ready' : 'failed',
      method: status === 'ready' ? 'list' : 'none',
      tier: 0,
      creditsSpent: 0,
      error: 'SCRAPE_DO_TOKEN_missing',
      incrementAttempts: true,
    });
    if (status === 'ready') metrics.ready += 1;
    else metrics.failed += 1;
    return;
  }

  const applyUrl = String(doc.applyUrl || '').trim();
  const jobUrl = String(doc.jobUrl || '').trim();
  const { isAccelUrl: isAccelHostUrl, isChoppingBlockUrl, isAidevboardUrl, isStartupsGalleryUrl } =
    await import('../services/aggregatorIdentity');
  const isBlockedAggHost = (url: string) =>
    isHiringCafeUrl(url) ||
    isAccelHostUrl(url) ||
    isConsiderBoardUrl(url) ||
    isChoppingBlockUrl(url) ||
    isAidevboardUrl(url) ||
    isStartupsGalleryUrl(url);
  const scrapeTargetUrl =
    applyUrl && !isBlockedAggHost(applyUrl)
      ? applyUrl
      : isBlockedAggHost(jobUrl)
        ? ''
        : jobUrl;

  if (!scrapeTargetUrl) {
    const status = boardListingStatus(listFields, doc.jobUrl);
    await persistResult(doc, listFields, {
      status: status === 'ready' ? 'ready' : 'partial',
      method: 'list',
      tier: 0,
      creditsSpent: 0,
      error: isBlockedAggHost(jobUrl) ? 'aggregator_skip_scrape_do' : 'no_scrape_target',
      incrementAttempts: true,
    });
    if (status === 'ready') metrics.ready += 1;
    else metrics.failed += 1;
    circuitBreaker.recordSuccess();
    return;
  }

  // Known career / ATS hosts: never spend scrape.do after free ATS miss.
  if (shouldSkipScrapeDoUrl(scrapeTargetUrl)) {
    const status = boardListingStatus(listFields, doc.jobUrl);
    await persistResult(doc, listFields, {
      status: status === 'ready' ? 'ready' : 'failed',
      method: status === 'ready' ? 'list' : 'none',
      tier: 0,
      creditsSpent: 0,
      error: 'career_host_skip_scrape_do',
      incrementAttempts: true,
    });
    if (status === 'ready') metrics.ready += 1;
    else metrics.failed += 1;
    circuitBreaker.recordSuccess();
    return;
  }

  const result = await scrapeJobPage(scrapeTargetUrl, {
    startTier: 1,
    maxTier: 2,
    useLearnedTier: false,
  });
  await yieldEventLoop();

  if (result.creditsSpent > 0) {
    metrics.credits_spent += result.creditsSpent;
    await addCreditsSpent(result.creditsSpent);
  }
  if (result.tier === 1) metrics.tier1 += 1;
  else if (result.tier === 2) metrics.tier2 += 1;
  else if (result.tier === 3) metrics.tier3 += 1;

  if (result.rateLimited) {
    metrics.rate_limited += 1;
    circuitBreaker.recordFailure();
    const backoff = new Date(Date.now() + 30_000 + Math.floor(Math.random() * 30_000));
    await JobBoardListing.updateOne(
      { _id: doc._id },
      {
        $set: {
          status: 'queued',
          leaseUntil: null,
          claimedBy: null,
          'enrichment.nextAttemptAt': backoff,
          'enrichment.lastError': 'rate_limited',
          'enrichment.creditsSpent': (doc.enrichment?.creditsSpent || 0) + result.creditsSpent,
        },
      }
    );
    return;
  }

  if (result.expired) {
    metrics.expired += 1;
    await persistResult(doc, listFields, {
      status: 'expired',
      method: 'scrape.do',
      tier: result.tier,
      creditsSpent: result.creditsSpent,
      error: result.error,
      incrementAttempts: true,
    });
    return;
  }

  if (!result.ok) {
    if (shouldTryBrowserJobFallback(result)) {
      const browser = await fetchBrowserJobFallback(doc.jobUrl);
      await yieldEventLoop();
      if (browser) {
        const merged = mergeParsedFields(browser.fields, listFields);
        const status = boardListingStatus(merged, doc.jobUrl);
        await persistResult(doc, merged, {
          status,
          method: 'browser',
          tier: 0,
          creditsSpent: result.creditsSpent,
          incrementAttempts: true,
        });
        if (status === 'ready') metrics.ready += 1;
        else metrics.failed += 1;
        circuitBreaker.recordSuccess();
        return;
      }
    }

    circuitBreaker.recordFailure();
    const attempts = (doc.enrichment?.attempts || 0) + 1;
    if (attempts >= JOB_ENRICHMENT_MAX_ATTEMPTS) {
      await persistResult(doc, mergeParsedFields(result.fields, listFields), {
        status: 'failed',
        method: 'scrape.do',
        tier: result.tier,
        creditsSpent: result.creditsSpent,
        error: result.error,
        incrementAttempts: true,
      });
      metrics.failed += 1;
      return;
    }
    const backoffMs = Math.min(60 * 60 * 1000, 2 ** attempts * 15_000) + Math.floor(Math.random() * 5000);
    await JobBoardListing.updateOne(
      { _id: doc._id },
      {
        $set: {
          status: 'queued',
          leaseUntil: null,
          claimedBy: null,
          'enrichment.attempts': attempts,
          'enrichment.nextAttemptAt': new Date(Date.now() + backoffMs),
          'enrichment.lastError': result.error || 'scrape_failed',
          'enrichment.creditsSpent': (doc.enrichment?.creditsSpent || 0) + result.creditsSpent,
          'enrichment.tier': result.tier,
          'enrichment.method': 'scrape.do',
        },
      }
    );
    return;
  }

  circuitBreaker.recordSuccess();
  let merged = mergeParsedFields(result.fields, listFields);
  merged.jobTitle = preferJobUrlTitle(merged.jobTitle, doc.jobUrl);

  let method: 'scrape.do' | 'llm' = 'scrape.do';
  let structured: StructuredJobSections | undefined;
  let llmModel = '';
  let llmInputHash = '';
  let llmTokens = 0;
  let jobExperienceOverride = 0;

  const cleaned = result.html ? htmlToPlainText(result.html) : '';
  const inputHash = cleaned ? hashLlmInput(cleaned) : '';

  // Content-hash cache: skip Gemini when page text unchanged and we already have LLM fields.
  const cachedHit =
    Boolean(inputHash) &&
    inputHash === (doc.enrichment?.llmInputHash || '') &&
    (doc.enrichment?.method === 'llm' ||
      Boolean(doc.about) ||
      (doc.minimumQualifications || []).length > 0 ||
      (doc.responsibilities || []).length > 0);

  if (cachedHit) {
    method = 'llm';
    llmInputHash = inputHash;
    llmModel = doc.enrichment?.llmModel || '';
    llmTokens = doc.enrichment?.llmTokens || 0;
    structured = {
      about: doc.about || '',
      minimumQualifications: doc.minimumQualifications || [],
      preferredQualifications: doc.preferredQualifications || [],
      responsibilities: doc.responsibilities || [],
      benefits: doc.benefits || [],
      skills: doc.skills || [],
    };
    metrics.llm_hit += 1;
  } else if (
    isGeminiConfigured() &&
    cleaned &&
    descriptionQualityScore(merged.jobDescription) <= 0
  ) {
    const usage = await getLlmUsageToday();
    if (usage.calls >= LLM_DAILY_CALL_BUDGET || usage.tokens >= LLM_DAILY_TOKEN_BUDGET) {
      metrics.llm_budget_paused = true;
      logger.log('warn', 'job-enrichment LLM daily budget exhausted; falling back to regex parse');
    } else {
      const gemini = await extractJobFieldsWithGemini(cleaned, doc.jobUrl);
      if (gemini.usage.calls > 0) {
        metrics.llm_tokens += gemini.usage.tokens;
        await addLlmUsage(gemini.usage.calls, gemini.usage.tokens);
      }
      if (gemini.ok) {
        method = 'llm';
        metrics.llm_hit += 1;
        merged = mergeParsedFields(gemini.fields, merged);
        merged.jobTitle = preferJobUrlTitle(merged.jobTitle, doc.jobUrl);
        structured = gemini.structured;
        llmModel = gemini.model;
        llmInputHash = gemini.inputHash;
        llmTokens = gemini.usage.tokens;
        jobExperienceOverride =
          typeof gemini.fields._jobExperience === 'number'
            ? gemini.fields._jobExperience
            : 0;
      } else if (gemini.error) {
        logger.log('info', `Gemini skipped for ${doc.jobUrl}: ${gemini.error}`);
      }
    }
  }

  const status = boardListingStatus(merged, doc.jobUrl);
  await persistResult(doc, merged, {
    status,
    method,
    tier: result.tier,
    creditsSpent: result.creditsSpent,
    incrementAttempts: true,
    structured,
    jobExperienceOverride,
    llmModel,
    llmInputHash,
    llmTokens,
  });
  if (status === 'ready') metrics.ready += 1;
  else metrics.failed += 1;
}

/**
 * One enrichment pass: recover leases, claim a batch, process with concurrency.
 */
export async function runEnrichmentPass(): Promise<EnrichmentPassMetrics> {
  const metrics = emptyMetrics();

  if (circuitBreaker.isOpen()) {
    metrics.budget_paused = true;
    logger.log('warn', `job-enrichment circuit open for ${circuitBreaker.remainingMs()}ms`);
    return metrics;
  }

  const spent = await getCreditsSpentToday();
  if (spent >= SCRAPE_DO_DAILY_CREDIT_BUDGET) {
    metrics.budget_paused = true;
    return metrics;
  }

  const recovered = await recoverExpiredLeases();
  if (recovered > 0) {
    logger.log('info', `job-enrichment recovered ${recovered} expired leases`);
  }

  const phenomRecovered = await recoverPhenomAtsSkipFailures();
  if (phenomRecovered > 0) {
    logger.log(
      'info',
      `job-enrichment requeued ${phenomRecovered} Phenom listings previously skipped for scrape.do`
    );
  }

  const batch = await claimBatch(JOB_ENRICHMENT_BATCH);
  metrics.claimed = batch.length;
  if (batch.length === 0) return metrics;

  let idx = 0;
  const workers = Array.from({ length: Math.min(JOB_ENRICHMENT_CONCURRENCY, batch.length) }, async () => {
    while (idx < batch.length) {
      const current = batch[idx++];
      try {
        await processOne(current, metrics);
      } catch (err: any) {
        circuitBreaker.recordFailure();
        logger.log('error', `job-enrichment process failed: ${err?.message || err}`);
        try {
          await JobBoardListing.updateOne(
            { _id: current._id },
            {
              $set: {
                status: 'queued',
                leaseUntil: null,
                claimedBy: null,
                'enrichment.lastError': err?.message || 'process_error',
                'enrichment.nextAttemptAt': new Date(Date.now() + 60_000),
              },
              $inc: { 'enrichment.attempts': 1 },
            }
          );
        } catch {
          // ignore
        }
      }
    }
  });

  await Promise.all(workers);
  return metrics;
}

let loopRunning = false;
let stopRequested = false;
let lastMetrics: EnrichmentPassMetrics = emptyMetrics();

export function getLastEnrichmentMetrics(): EnrichmentPassMetrics {
  return lastMetrics;
}

export async function startJobEnrichmentLoop(): Promise<void> {
  if (loopRunning) return;
  loopRunning = true;
  stopRequested = false;
  logger.log('info', `job-enrichment loop started workerId=${WORKER_ID}`);

  let idleSleepMs = 3000;

  while (!stopRequested) {
    try {
      const metrics = await runEnrichmentPass();
      lastMetrics = metrics;

      if (metrics.claimed === 0) {
        // Keep polling frequently — new backfills should not wait a full minute.
        idleSleepMs = metrics.budget_paused ? 60_000 : Math.min(15_000, Math.max(3000, idleSleepMs + 2000));
        await new Promise((r) => setTimeout(r, idleSleepMs));
      } else {
        idleSleepMs = 3000;
        logger.log(
          'info',
          `job-enrichment pass claimed=${metrics.claimed} ready=${metrics.ready} ats=${metrics.ats_hit} t1=${metrics.tier1} t2=${metrics.tier2} t3=${metrics.tier3} credits=${metrics.credits_spent} failed=${metrics.failed}`
        );
        // Brief pause between non-empty passes
        await new Promise((r) => setTimeout(r, 500));
      }

      if (circuitBreaker.isOpen()) {
        await new Promise((r) => setTimeout(r, circuitBreaker.remainingMs() || 1000));
      }
    } catch (err: any) {
      logger.log('error', `job-enrichment loop error: ${err?.message || err}`);
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }

  loopRunning = false;
  logger.log('info', 'job-enrichment loop stopped');
}

export function stopJobEnrichmentLoop(): void {
  stopRequested = true;
}

import { createHash } from 'crypto';
import JobBoardListing, {
  IJobBoardListSnapshot,
  IJobBoardListing,
} from '../models/JobBoardListing';
import { makeDescriptionSnippet, sanitizeCompanyName, decodeHtmlEntities, normalizeJobDescription, normalizeLocation, normalizeSalaryRange } from './jobPageParser';
import { jobUrlKey, normalizeJobUrl } from './jobUrlNormalize';
import { detectAts } from './atsAdapters';
import { normalizeOwnerIdForWrite } from '../utils/ownerId';
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

export function buildListSnapshot(data: Record<string, any>): IJobBoardListSnapshot {
  const location = normalizeLocation(asText(data.location));
  return {
    jobTitle: decodeHtmlEntities(asText(data.jobTitle)),
    companyName: sanitizeCompanyName(asText(data.companyName)),
    jobDescription: normalizeJobDescription(asText(data.jobDescription)),
    jobCategory: decodeHtmlEntities(asText(data.jobCategory)),
    location,
    salaryRange: normalizeSalaryRange(asText(data.salaryRange), { location }),
    employmentType: decodeHtmlEntities(asText(data.employmentType)),
    remoteType: decodeHtmlEntities(asText(data.remoteType)),
    jobExperience: asExperience(data.jobExperience),
    sectorIndustry: decodeHtmlEntities(asText(data.sectorIndustry)),
    f500: asText(data.f500),
    date: parseDate(data.date),
  };
}

export function isListRowComplete(snapshot: IJobBoardListSnapshot): boolean {
  return Boolean(
    snapshot.jobTitle &&
      snapshot.companyName &&
      snapshot.location &&
      (snapshot.jobDescription || '').length >= JOB_BOARD_MIN_DESC_CHARS
  );
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

/**
 * Prefer an ATS-detectable apply URL as the board identity so the same
 * requisition from an aggregator and from Greenhouse/Lever shares a key.
 */
export function pickCanonicalJobUrl(data: Record<string, any>): {
  jobUrl: string | null;
  applyUrl: string | null;
} {
  const urls = rowCandidateUrls(data);
  if (urls.length === 0) return { jobUrl: null, applyUrl: null };
  const atsUrl = urls.find((url) => Boolean(detectAts(url))) || null;
  const jobUrl = atsUrl || urls[0];
  const applyUrl =
    urls.find((url) => url !== jobUrl && Boolean(detectAts(url))) ||
    urls.find((url) => url !== jobUrl) ||
    jobUrl;
  return { jobUrl, applyUrl };
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
  const apply = normalizeJobUrl(applyUrl) || jobUrl;
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
  const method = String(prev?.enrichment?.method || '');
  return Boolean(
    prev &&
      (prev.status === 'ready' || prev.status === 'partial') &&
      method &&
      method !== 'none' &&
      method !== 'list'
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
}): Promise<EnrichmentEnqueueStats> {
  const stats: EnrichmentEnqueueStats = {
    considered: 0,
    skippedNoUrl: 0,
    skippedDedup: 0,
    skippedComplete: 0,
    queued: 0,
    readyFromList: 0,
    expiredSkipped: 0,
  };

  const ownerId = normalizeOwnerIdForWrite(opts.ownerId);
  if (!ownerId || !opts.robotMetaId || !opts.runId) {
    logger.log('warn', 'enqueueJobBoardEnrichments: missing ownerId/robotMetaId/runId');
    return stats;
  }

  // Dedupe within the batch by jobUrlKey (last row wins for snapshot richness).
  const byKey = new Map<
    string,
    { jobUrl: string; applyUrl: string; snapshot: IJobBoardListSnapshot; jobId: string }
  >();
  for (const row of opts.rows || []) {
    stats.considered += 1;
    const data = row?.data || {};
    const picked = pickCanonicalJobUrl(data);
    const key = jobUrlKey(picked.jobUrl);
    if (!picked.jobUrl || !key) {
      stats.skippedNoUrl += 1;
      continue;
    }
    byKey.set(key, {
      jobUrl: picked.jobUrl,
      applyUrl: picked.applyUrl || picked.jobUrl,
      snapshot: buildListSnapshot(data),
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

    const acceptList = isListRowComplete(item.snapshot);

    // Duplicate URL already on the board: never re-queue scrape.do.
    if (prev && !acceptList) {
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

    if (acceptList) {
      stats.readyFromList += 1;
      stats.skippedComplete += 1;
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
              status: 'ready',
              lastSeenAt: nowDate,
              listSnapshot: item.snapshot,
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

    stats.queued += 1;
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
            priority: 0,
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

  logger.log(
    'info',
    `job-board enqueue owner=${ownerId} robot=${opts.robotMetaId} considered=${stats.considered} queued=${stats.queued} readyFromList=${stats.readyFromList} dedup=${stats.skippedDedup} noUrl=${stats.skippedNoUrl}`
  );

  return stats;
}

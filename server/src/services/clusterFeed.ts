import JobBoardListing from '../models/JobBoardListing';
import type { ICluster, ClusterFilter } from '../models/Cluster';
import { boardMatch, mapListingToJob } from '../api/jobs';
import {
  applyFrozenClusterFilters,
  applyJobBoardListFilters,
  type JobBoardFrozenFilterInput,
} from './jobBoardQuery';
import {
  type ClusterWindow,
  windowCutoff,
} from './clusterEntitlements';
import { getPortalJobBoardOwnerId } from './portalOwner';
import { normalizeJobUrl } from './jobUrlNormalize';

export type ClusterFeedUserFilters = {
  q?: string;
  company?: string;
  location?: string;
  workMode?: string;
  experience?: string;
  frozenExperienceLevel?: string;
  frozenState?: string;
  h1bSponsorFriendly?: boolean;
  h1bFy2026Match?: boolean;
};

export type FeedJobDto = NonNullable<ReturnType<typeof mapListingToFeedJob>>;

export type ClusterFeedPage = {
  jobs: FeedJobDto[];
  total: number;
  page: number;
  limit: number;
  window: ClusterWindow;
  clusterId: string;
  clusterName: string;
};

const FEED_CACHE_TTL_MS = 30_000;
type FeedCacheEntry = { expiresAt: number; body: ClusterFeedPage };
const feedCache = new Map<string, FeedCacheEntry>();

/**
 * Newest-first for portal feed cards.
 * Must match the timestamp cards show (`postedAt` ← listing `date`).
 * Sorting by `lastSeenAt` (scrape freshness) puts recently re-scraped old postings
 * ahead of genuinely new roles — which is what broke "Newest first" UX.
 */
export const FEED_NEWEST_SORT = { date: -1, lastSeenAt: -1, createdAt: -1, _id: -1 } as const;

/**
 * Lean projection for feed cards — avoids shipping multi-KB enrichment blobs
 * when paging through large clusters. Keep fields `mapListingToFeedJob` needs.
 */
export const FEED_CARD_PROJECTION = {
  jobUrlKey: 1,
  jobUrl: 1,
  applyUrl: 1,
  jobId: 1,
  jobTitle: 1,
  companyName: 1,
  companyResolvedName: 1,
  jobDescription: 1,
  descriptionSnippet: 1,
  jobCategory: 1,
  frozenCategories: 1,
  frozenExperienceLevels: 1,
  location: 1,
  salaryRange: 1,
  employmentType: 1,
  remoteType: 1,
  jobExperience: 1,
  sectorIndustry: 1,
  date: 1,
  companyLogoUrl: 1,
  skills: 1,
  h1bEligible: 1,
  h1bFy2026Match: 1,
  source: 1,
  aggregatorPostingUrl: 1,
  robotMetaId: 1,
  robotMetaIds: 1,
  listSnapshot: 1,
  createdAt: 1,
  lastSeenAt: 1,
} as const;

export function clearClusterFeedCache(): void {
  feedCache.clear();
}

export function clusterFilterToFrozenInput(
  filter: ClusterFilter | null | undefined,
  sourceBinding?: ICluster['sourceBinding'] | null
): JobBoardFrozenFilterInput {
  const f = filter || ({} as ClusterFilter);
  const binding = sourceBinding || {
    mode: 'filter' as const,
    sources: [],
    companyNames: [],
    companyIds: [],
    robotMetaIds: [],
  };
  // Career-page URLs live in sourceBinding.sources for ops display only.
  // Job documents store aggregator slugs in `source` (hiring_cafe, accel, …),
  // so forwarding career URLs into the Mongo `source` clause matches nothing.
  // Membership for custom clusters is robotMetaIds (stamped at ingestion).
  const aggregatorSlugs =
    binding.mode === 'source'
      ? (binding.sources || []).filter((s) => {
          const v = String(s || '').trim();
          if (!v) return false;
          if (/^https?:\/\//i.test(v)) return false;
          if (v.includes('/') || v.includes('.')) return false;
          return true;
        })
      : [];
  return {
    frozenIndustries: f.frozenIndustries || [],
    frozenCategories: f.frozenCategories || [],
    frozenExperienceLevels: f.frozenExperienceLevels || [],
    frozenExperienceYears: f.frozenExperienceYears || [],
    frozenStates: f.frozenStates || [],
    locationIsRemote: f.locationIsRemote ?? null,
    excludeStudentEscape: f.excludeStudentEscape !== false,
    companyNames: [
      ...(f.companyNames || []),
      ...(binding.mode === 'source' ? binding.companyNames || [] : []),
    ],
    companyIds: [
      ...(f.companyIds || []),
      ...(binding.mode === 'source' ? binding.companyIds || [] : []),
    ],
    h1bSponsorFriendly: Boolean(f.h1bSponsorFriendly),
    robotMetaIds: binding.mode === 'source' ? binding.robotMetaIds || [] : [],
    sources: aggregatorSlugs,
  };
}

/** Build the Mongo match for a cluster definition (no time window). */
export function clusterToJobQuery(
  cluster: Pick<ICluster, 'filter' | 'sourceBinding'>,
  ownerId: string = getPortalJobBoardOwnerId()
): Record<string, any> {
  let match = boardMatch(ownerId);
  match = applyFrozenClusterFilters(match, clusterFilterToFrozenInput(cluster.filter, cluster.sourceBinding));
  return match;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Map portal Level dropdown labels → frozenExperienceLevels taxonomy. */
const EXPERIENCE_UI_TO_FROZEN: Record<string, string[]> = {
  Junior: ['Entry Level'],
  'Entry Level': ['Entry Level'],
  Mid: ['Mid-Senior Level'],
  'Mid-Level': ['Mid-Senior Level'],
  'Mid-Senior Level': ['Mid-Senior Level'],
  Senior: ['Senior Level', 'Mid-Senior Level'],
  'Senior Level': ['Senior Level'],
};

function applyUserFilters(
  match: Record<string, any>,
  filters: ClusterFeedUserFilters
): Record<string, any> {
  const locationRaw = String(filters.location || '').trim();
  const remoteLocation = /^remote$/i.test(locationRaw);
  // State codes (CA, NY, …) use frozenStates + location text; free-text uses location regex.
  const looksLikeState = /^[A-Za-z]{2}$/.test(locationRaw) && !remoteLocation;
  const locationForText =
    locationRaw && !looksLikeState && !remoteLocation ? locationRaw : undefined;

  let next = applyJobBoardListFilters(match, {
    location: locationForText,
    workMode: filters.workMode,
  });

  const and: Record<string, unknown>[] = [...(Array.isArray(next.$and) ? next.$and : [])];

  if (remoteLocation) {
    and.push({
      $or: [
        { locationIsRemote: true },
        { remoteType: /remote/i },
        { 'listSnapshot.remoteType': /remote/i },
        { location: /remote/i },
        { 'listSnapshot.location': /remote/i },
      ],
    });
  }

  const state = String(filters.frozenState || (looksLikeState ? locationRaw.toUpperCase() : '')).trim();
  if (state) {
    and.push({
      $or: [
        { frozenStates: { $in: [state] } },
        { location: new RegExp(`\\b${escapeRegex(state)}\\b`, 'i') },
        { 'listSnapshot.location': new RegExp(`\\b${escapeRegex(state)}\\b`, 'i') },
      ],
    });
  }

  const company = String(filters.company || '').trim();
  if (company) {
    const re = new RegExp(escapeRegex(company), 'i');
    and.push({
      $or: [
        { companyName: re },
        { 'listSnapshot.companyName': re },
        { companyResolvedName: re },
      ],
    });
  }

  const expRaw = String(filters.frozenExperienceLevel || filters.experience || '').trim();
  if (expRaw) {
    const levels = EXPERIENCE_UI_TO_FROZEN[expRaw] || [expRaw];
    and.push({ frozenExperienceLevels: { $in: levels } });
  }

  if (filters.h1bSponsorFriendly) {
    and.push({
      h1bEligible: true,
      h1bCompanyScore: 'high',
      h1bMappingStatus: { $in: ['auto', 'approved'] },
    });
  }

  if (filters.h1bFy2026Match) {
    and.push({ h1bEligible: true, h1bFy2026Match: true });
  }

  const q = String(filters.q || '').trim();
  if (q) {
    if (q.length >= 3) {
      next = { ...next, $text: { $search: q } };
    } else {
      const re = new RegExp(escapeRegex(q), 'i');
      and.push({
        $or: [
          { jobTitle: re },
          { companyName: re },
          { location: re },
          { 'listSnapshot.jobTitle': re },
          { 'listSnapshot.companyName': re },
        ],
      });
    }
  }

  if (and.length) next.$and = and;
  return next;
}

export function mapListingToFeedJob(
  row: any,
  opts: { clusterId: string; clusterName: string; saved?: boolean; assigned?: boolean }
) {
  const mapped = mapListingToJob(row, { fullDescription: false });
  if (!mapped) return null;
  const data = mapped.data as Record<string, any>;
  const workModeRaw = String(data.remoteType || '').toLowerCase();
  let workMode: 'Remote' | 'Hybrid' | 'Onsite' | undefined;
  if (workModeRaw.includes('remote')) workMode = 'Remote';
  else if (workModeRaw.includes('hybrid')) workMode = 'Hybrid';
  else if (workModeRaw.includes('onsite') || workModeRaw.includes('on-site') || workModeRaw.includes('office')) {
    workMode = 'Onsite';
  }

  const skillsRaw = Array.isArray(data.skills) ? data.skills : [];
  const skills = skillsRaw
    .map((s: unknown) => String(s || '').trim())
    .filter(Boolean);

  return {
    id: mapped.id,
    clusterId: opts.clusterId,
    clusterName: opts.clusterName,
    title: String(data.jobTitle || ''),
    company: String(data.companyResolvedName || data.companyName || ''),
    location: String(data.location || ''),
    jobType: data.employmentType ? String(data.employmentType) : undefined,
    workMode,
    experience:
      Array.isArray(data.frozenExperienceLevels) && data.frozenExperienceLevels[0]
        ? String(data.frozenExperienceLevels[0])
        : data.jobExperience
          ? `${data.jobExperience}+ years`
          : undefined,
    salary: data.salaryRange ? String(data.salaryRange) : undefined,
    postedAt: data.date
      ? new Date(data.date).toISOString()
      : mapped.createdAt
        ? new Date(mapped.createdAt).toISOString()
        : new Date().toISOString(),
    lastSeenAt: row.lastSeenAt
      ? new Date(row.lastSeenAt).toISOString()
      : mapped.createdAt
        ? new Date(mapped.createdAt).toISOString()
        : new Date().toISOString(),
    applyUrl: normalizeJobUrl(data.applyUrl || data.jobUrl) || String(data.applyUrl || data.jobUrl || ''),
    description: String(data.jobDescription || ''),
    logoUrl: data.companyLogoUrl ? String(data.companyLogoUrl) : undefined,
    sectorIndustry: data.sectorIndustry ? String(data.sectorIndustry) : undefined,
    jobCategory: data.jobCategory ? String(data.jobCategory).trim() || undefined : undefined,
    ...(skills.length ? { skills } : {}),
    h1bEligible: Boolean(data.h1bEligible),
    h1bFy2026Match: Boolean(data.h1bFy2026Match),
    saved: Boolean(opts.saved),
    assigned: Boolean(opts.assigned),
    jobUrlKey: String(row.jobUrlKey || ''),
  };
}

/** Build searchable text for cluster browse (company, role, location — not tech stack). */
export function clusterSearchHaystack(c: {
  name?: string;
  description?: string;
  filtersSummary?: string[];
  companyNamesPreview?: string[];
  filter?: {
    companyNames?: string[];
    frozenCategories?: string[];
    frozenStates?: string[];
    frozenIndustries?: string[];
  };
  sourceBinding?: { companyNames?: string[]; mode?: string };
}): string {
  const companies = [
    ...(c.companyNamesPreview || []),
    ...(c.filter?.companyNames || []),
    ...(c.sourceBinding?.mode === 'source' ? c.sourceBinding?.companyNames || [] : []),
  ];
  return [
    c.name || '',
    c.description || '',
    ...(c.filtersSummary || []),
    ...companies,
    ...(c.filter?.frozenCategories || []),
    ...(c.filter?.frozenStates || []),
    ...(c.filter?.frozenIndustries || []),
  ]
    .join(' ')
    .toLowerCase();
}

export async function countJobsForCluster(
  cluster: Pick<ICluster, 'filter' | 'sourceBinding'>,
  ownerId: string = getPortalJobBoardOwnerId()
): Promise<number> {
  const match = clusterToJobQuery(cluster, ownerId);
  return JobBoardListing.countDocuments(match);
}

export async function sampleJobsForCluster(
  cluster: Pick<ICluster, '_id' | 'name' | 'filter' | 'sourceBinding'> & { id?: string },
  limit = 8,
  ownerId: string = getPortalJobBoardOwnerId()
) {
  const match = clusterToJobQuery(cluster, ownerId);
  const rows = await JobBoardListing.find(match)
    .select(FEED_CARD_PROJECTION)
    .sort(FEED_NEWEST_SORT)
    .limit(Math.min(Math.max(limit * 2, 8), 40))
    .lean();

  const clusterId = String((cluster as any).id || cluster._id);
  const clusterName = String(cluster.name || '');
  const jobs: FeedJobDto[] = [];
  for (const row of rows) {
    const job = mapListingToFeedJob(row, { clusterId, clusterName });
    if (job) jobs.push(job);
    if (jobs.length >= limit) break;
  }
  return jobs;
}

export async function queryClusterFeed(opts: {
  cluster: Pick<ICluster, '_id' | 'name' | 'filter' | 'sourceBinding'> & { id?: string };
  window: ClusterWindow;
  filters?: ClusterFeedUserFilters;
  page?: number;
  limit?: number;
  /** Absolute max for `limit` (default 50). Use higher for analytics. */
  maxLimit?: number;
  /**
   * Override delivery-window cutoff with an absolute timestamp.
   * Used by home analytics so date-range filters are not capped by 1h/12h/24h delivery.
   */
  sinceMs?: number;
  savedJobUrlKeys?: Set<string>;
  assignedJobUrlKeys?: Set<string>;
  ownerId?: string;
  nowMs?: number;
  useCache?: boolean;
}): Promise<ClusterFeedPage> {
  const page = Math.max(1, opts.page || 1);
  const hardCap = Math.min(Math.max(opts.maxLimit || 50, 1), 500);
  const limit = Math.min(hardCap, Math.max(1, opts.limit || 20));
  const ownerId = opts.ownerId || getPortalJobBoardOwnerId();
  const clusterId = String((opts.cluster as any).id || opts.cluster._id);
  const filters = opts.filters || {};
  const cutoff =
    typeof opts.sinceMs === 'number' && Number.isFinite(opts.sinceMs)
      ? new Date(opts.sinceMs)
      : windowCutoff(opts.window, opts.nowMs);

  const cacheKey = JSON.stringify({
    clusterId,
    window: opts.window,
    sinceMs: opts.sinceMs ?? null,
    filters,
    page,
    limit,
    ownerId,
  });

  if (opts.useCache !== false) {
    const cached = feedCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      // Re-apply saved/assigned flags (user-specific) onto cached shared body.
      const saved = opts.savedJobUrlKeys;
      const assigned = opts.assignedJobUrlKeys;
      if ((!saved || saved.size === 0) && (!assigned || assigned.size === 0)) return cached.body;
      return {
        ...cached.body,
        jobs: cached.body.jobs.map((j) => ({
          ...j,
          saved: Boolean(j.jobUrlKey && saved?.has(j.jobUrlKey)),
          assigned: Boolean(j.jobUrlKey && assigned?.has(j.jobUrlKey)),
        })),
      };
    }
  }

  let match = clusterToJobQuery(opts.cluster, ownerId);
  match = applyJobBoardListFilters(match, { lastSeenSince: cutoff });
  match = applyUserFilters(match, filters);

  const skip = (page - 1) * limit;
  // Over-fetch slightly because mapListingToJob may drop quality fails.
  const fetchLimit = Math.min(Math.max(limit * 3, limit), hardCap * 3);

  const [total, rows] = await Promise.all([
    JobBoardListing.countDocuments(match),
    JobBoardListing.find(match)
      .select(FEED_CARD_PROJECTION)
      .sort(FEED_NEWEST_SORT)
      .skip(skip)
      .limit(fetchLimit)
      .lean(),
  ]);

  const clusterName = String(opts.cluster.name || '');
  const jobs: FeedJobDto[] = [];
  for (const row of rows) {
    const job = mapListingToFeedJob(row, {
      clusterId,
      clusterName,
      saved: Boolean(row.jobUrlKey && opts.savedJobUrlKeys?.has(String(row.jobUrlKey))),
      assigned: Boolean(row.jobUrlKey && opts.assignedJobUrlKeys?.has(String(row.jobUrlKey))),
    });
    if (job) jobs.push(job);
    if (jobs.length >= limit) break;
  }

  const body: ClusterFeedPage = {
    jobs,
    total,
    page,
    limit,
    window: opts.window,
    clusterId,
    clusterName,
  };

  if (opts.useCache !== false) {
    feedCache.set(cacheKey, { expiresAt: Date.now() + FEED_CACHE_TTL_MS, body });
    // Bound cache size
    if (feedCache.size > 500) {
      const firstKey = feedCache.keys().next().value;
      if (firstKey) feedCache.delete(firstKey);
    }
  }

  return body;
}

const COMPANY_PREVIEW_CAP = 40;

/**
 * Union of explicit companyNames on the cluster plus distinct employers
 * currently matching the cluster filter in JobBoardListing.
 */
export async function distinctCompaniesForCluster(
  cluster: Pick<ICluster, 'filter' | 'sourceBinding' | 'companyNamesPreview'> & {
    companyNamesPreview?: string[];
  },
  ownerId: string = getPortalJobBoardOwnerId(),
  cap = COMPANY_PREVIEW_CAP
): Promise<string[]> {
  const fromFilter = [
    ...(cluster.filter?.companyNames || []),
    ...(cluster.sourceBinding?.mode === 'source'
      ? cluster.sourceBinding.companyNames || []
      : []),
  ]
    .map((s) => String(s || '').trim())
    .filter(Boolean);

  let fromListings: string[] = [];
  try {
    const match = clusterToJobQuery(cluster, ownerId);
    const resolved = (await JobBoardListing.distinct('companyResolvedName', match))
      .map((s) => String(s || '').trim())
      .filter(Boolean);
    const scraped = (await JobBoardListing.distinct('companyName', match))
      .map((s) => String(s || '').trim())
      .filter(Boolean);
    fromListings = resolved.length ? resolved : scraped;
  } catch {
    /* best-effort */
  }

  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of [...fromFilter, ...fromListings]) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Merge jobs across subscribed clusters with no time-window cutoff.
 * Sorted newest-first by posting date (`date` → UI `postedAt`), then scrape freshness.
 * Real pagination via skip/limit — never loads the full cluster into memory.
 */
export async function queryMergedClusterFeed(opts: {
  clusters: Array<
    Pick<ICluster, '_id' | 'name' | 'filter' | 'sourceBinding'> & { id?: string }
  >;
  filters?: ClusterFeedUserFilters;
  page?: number;
  limit?: number;
  savedJobUrlKeys?: Set<string>;
  assignedJobUrlKeys?: Set<string>;
  ownerId?: string;
}): Promise<{ jobs: FeedJobDto[]; total: number; page: number; limit: number }> {
  const page = Math.max(1, opts.page || 1);
  const limit = Math.min(50, Math.max(1, opts.limit || 20));
  const ownerId = opts.ownerId || getPortalJobBoardOwnerId();
  const filters = opts.filters || {};

  if (!opts.clusters.length) {
    return { jobs: [], total: 0, page, limit };
  }

  const perCluster = opts.clusters.map((c) => clusterToJobQuery(c, ownerId));
  let match: Record<string, any> =
    perCluster.length === 1 ? perCluster[0] : { $or: perCluster };
  match = applyUserFilters(match, filters);

  const skip = (page - 1) * limit;
  // Over-fetch slightly because mapListingToJob may drop quality fails.
  const fetchLimit = Math.min(limit * 3, 100);

  const [total, rows] = await Promise.all([
    JobBoardListing.countDocuments(match),
    JobBoardListing.find(match)
      .select(FEED_CARD_PROJECTION)
      .sort(FEED_NEWEST_SORT)
      .skip(skip)
      .limit(fetchLimit)
      .lean(),
  ]);

  const jobs: FeedJobDto[] = [];
  for (const row of rows) {
    const rowCompany = String((row as any).companyName || '').toLowerCase();
    const rowRobot = String((row as any).robotMetaId || '');
    let clusterId = String((opts.clusters[0] as any).id || opts.clusters[0]._id);
    let clusterName = String(opts.clusters[0].name || '');

    for (const c of opts.clusters) {
      const cid = String((c as any).id || c._id);
      const cname = String(c.name || '');
      const boundRobots =
        c.sourceBinding?.mode === 'source' ? c.sourceBinding.robotMetaIds || [] : [];
      if (rowRobot && boundRobots.includes(rowRobot)) {
        clusterId = cid;
        clusterName = cname;
        break;
      }
      const companies = [
        ...(c.filter?.companyNames || []),
        ...(c.sourceBinding?.mode === 'source' ? c.sourceBinding.companyNames || [] : []),
      ].map((s) => s.toLowerCase());
      if (rowCompany && companies.some((n) => rowCompany.includes(n) || n.includes(rowCompany))) {
        clusterId = cid;
        clusterName = cname;
        break;
      }
    }

    const job = mapListingToFeedJob(row, {
      clusterId,
      clusterName,
      saved: Boolean(row.jobUrlKey && opts.savedJobUrlKeys?.has(String(row.jobUrlKey))),
      assigned: Boolean(row.jobUrlKey && opts.assignedJobUrlKeys?.has(String(row.jobUrlKey))),
    });
    if (job) jobs.push(job);
    if (jobs.length >= limit) break;
  }

  return { jobs, total, page, limit };
}

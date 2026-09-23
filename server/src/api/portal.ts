import { Router } from 'express';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
import { requirePortalUser, type PortalRequest } from '../middlewares/portalAuth';
import Cluster from '../models/Cluster';
import ClusterSubscription from '../models/ClusterSubscription';
import ClusterRequest from '../models/ClusterRequest';
import SavedJob from '../models/SavedJob';
import AssignedJob from '../models/AssignedJob';
import JobBoardListing from '../models/JobBoardListing';
import PortalUser from '../models/PortalUser';
import JobReport from '../models/JobReport';
import {
  getEntitlements,
  isAllowedWindow,
  parseClusterWindow,
  displayPlanType,
  resolveSubscribedSlots,
  CLUSTER_WINDOW_MS,
  type ClusterWindow,
} from '../services/clusterEntitlements';
import {
  fetchFirstStepAccountCached,
  fetchFirstStepPlanSnapshot,
  mergeFirstStepPlan,
  assignJobUrlToOdJobs,
} from '../services/firstStepSubscription';
import {
  queryClusterFeed,
  queryMergedClusterFeed,
  sampleJobsForCluster,
  distinctCompaniesForCluster,
  mapListingToFeedJob,
  clusterSearchHaystack,
} from '../services/clusterFeed';
import { mapListingToJob, boardMatch } from './jobs';
import { getPortalJobBoardOwnerId } from '../services/portalOwner';
import {
  getClusterAnalyticsSlice,
  mergeCompanyCategoryCounts,
} from '../services/clusterAnalytics';
import logger from '../logger';

const router = Router();

const portalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.PORTAL_RATE_LIMIT_MAX || 120),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many portal requests', code: 'portal.rate_limited' },
});

router.use('/portal', portalLimiter, requirePortalUser);

type FeedInsightBucket = { label: string; count: number };

function topNCounts(
  values: Iterable<string>,
  n: number
): FeedInsightBucket[] {
  const map = new Map<string, number>();
  for (const raw of values) {
    const label = String(raw || '').trim();
    if (!label) continue;
    map.set(label, (map.get(label) || 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([label, count]) => ({ label, count }));
}

function buildFeedInsights(
  jobs: Array<{
    company?: string;
    jobCategory?: string;
    sectorIndustry?: string;
    skills?: string[];
  }>
) {
  const companies: string[] = [];
  const categories: string[] = [];
  const skills: string[] = [];
  for (const j of jobs) {
    if (j.company) companies.push(j.company);
    const cat = String(j.jobCategory || j.sectorIndustry || '').trim();
    if (cat) categories.push(cat);
    if (Array.isArray(j.skills)) {
      for (const s of j.skills) {
        const skill = String(s || '').trim();
        if (skill) skills.push(skill);
      }
    }
  }
  return {
    asOf: new Date().toISOString(),
    sampleSize: jobs.length,
    companies: topNCounts(companies, 5),
    categories: topNCounts(categories, 5),
    skills: topNCounts(skills, 5),
  };
}

/** Home analytics range keys (query `range`). */
const HOME_ANALYTICS_RANGES = new Set(['24h', '3d', '7d', '14d', '30d', 'plan']);

type HomeAnalyticsRange = '24h' | '3d' | '7d' | '14d' | '30d' | 'plan';

function parseHomeAnalyticsRange(raw: unknown): HomeAnalyticsRange {
  const v = String(raw || '7d').trim().toLowerCase();
  return (HOME_ANALYTICS_RANGES.has(v) ? v : '7d') as HomeAnalyticsRange;
}

function resolveRangeWindow(
  range: HomeAnalyticsRange,
  planStartAt: Date | string | null | undefined,
  nowMs = Date.now()
): { startMs: number; endMs: number; granularity: 'hour' | 'day' | 'week' } {
  const endMs = nowMs;
  if (range === 'plan') {
    const start = planStartAt ? Date.parse(String(planStartAt)) : NaN;
    const startMs = Number.isFinite(start) ? start : endMs - 7 * 24 * 60 * 60 * 1000;
    const spanDays = Math.max(1, (endMs - startMs) / (24 * 60 * 60 * 1000));
    return {
      startMs,
      endMs,
      granularity: spanDays > 14 ? 'week' : spanDays > 3 ? 'day' : 'hour',
    };
  }
  const hours: Record<Exclude<HomeAnalyticsRange, 'plan'>, number> = {
    '24h': 24,
    '3d': 72,
    '7d': 168,
    '14d': 336,
    '30d': 720,
  };
  const startMs = endMs - hours[range] * 60 * 60 * 1000;
  const granularity: 'hour' | 'day' | 'week' =
    range === '24h' || range === '3d' ? 'hour' : range === '30d' ? 'week' : 'day';
  return { startMs, endMs, granularity };
}

function utcDayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function utcHourKey(ms: number): string {
  const d = new Date(ms);
  return `${utcDayKey(ms)}T${String(d.getUTCHours()).padStart(2, '0')}`;
}

/** Monday-start ISO week key (UTC). */
function utcWeekKey(ms: number): string {
  const d = new Date(ms);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  d.setUTCHours(0, 0, 0, 0);
  return utcDayKey(d.getTime());
}

function buildBucketKeys(
  startMs: number,
  endMs: number,
  granularity: 'hour' | 'day' | 'week'
): string[] {
  const keys: string[] = [];
  if (granularity === 'week') {
    let cursor = new Date(startMs);
    const day = cursor.getUTCDay() || 7;
    cursor.setUTCDate(cursor.getUTCDate() - day + 1);
    cursor.setUTCHours(0, 0, 0, 0);
    while (cursor.getTime() <= endMs) {
      keys.push(utcWeekKey(cursor.getTime()));
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
    return keys;
  }
  if (granularity === 'hour') {
    let cursor = new Date(startMs);
    cursor.setUTCMinutes(0, 0, 0);
    while (cursor.getTime() <= endMs) {
      keys.push(utcHourKey(cursor.getTime()));
      cursor = new Date(cursor.getTime() + 60 * 60 * 1000);
    }
    return keys;
  }
  let cursor = new Date(
    Date.UTC(
      new Date(startMs).getUTCFullYear(),
      new Date(startMs).getUTCMonth(),
      new Date(startMs).getUTCDate()
    )
  );
  const endDay = new Date(
    Date.UTC(
      new Date(endMs).getUTCFullYear(),
      new Date(endMs).getUTCMonth(),
      new Date(endMs).getUTCDate()
    )
  );
  while (cursor.getTime() <= endDay.getTime()) {
    keys.push(utcDayKey(cursor.getTime()));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}

function shortClusterLabel(name: string, max = 22): string {
  const cleaned = String(name || 'Cluster').replace(/\s+/g, ' ').trim();
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

function buildJobSeriesFromBuckets(opts: {
  slices: Array<{
    subscriptionId: string;
    name: string;
    buckets: Record<string, number>;
  }>;
  startMs: number;
  endMs: number;
  granularity: 'hour' | 'day' | 'week';
}): {
  dates: string[];
  total: number[];
  byCluster: Array<{ subscriptionId: string; name: string; values: number[] }>;
  granularity: 'hour' | 'day' | 'week';
} {
  const dates = buildBucketKeys(opts.startMs, opts.endMs, opts.granularity);
  const byCluster = opts.slices.slice(0, 3).map((s) => ({
    subscriptionId: s.subscriptionId,
    name: shortClusterLabel(s.name),
    values: dates.map((d) => s.buckets[d] || 0),
  }));
  const total = dates.map((_, i) => {
    // Sum all slices (not only first 3) for accurate total line.
    return opts.slices.reduce((sum, s) => sum + (s.buckets[dates[i]] || 0), 0);
  });
  return { dates, total, byCluster, granularity: opts.granularity };
}

function slugify(input: string): string {
  return String(input || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function nextRefreshIso(window: ClusterWindow, fromMs = Date.now()): string {
  return new Date(fromMs + CLUSTER_WINDOW_MS[window]).toISOString();
}

/** Host + path label for career-page chips (full URL kept for tooltip). */
export function careerPageLabel(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const u = new URL(withProto);
    const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '');
    const search = u.search && u.search.length <= 40 ? u.search : '';
    return `${u.host}${path}${search}` || u.host;
  } catch {
    return trimmed.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  }
}

export function serializeCluster(doc: any) {
  const json = typeof doc.toJSON === 'function' ? doc.toJSON() : doc;
  const includedCompanies: string[] = Array.isArray(json.companyNamesPreview)
    ? json.companyNamesPreview
    : [
        ...(json.filter?.companyNames || []),
        ...(json.sourceBinding?.mode === 'source'
          ? json.sourceBinding?.companyNames || []
          : []),
      ].filter(Boolean);
  const rawSources: string[] = Array.isArray(json.sourceBinding?.sources)
    ? json.sourceBinding.sources
    : [];
  const careerPageUrls = [
    ...new Set(
      rawSources
        .map((s: string) => String(s || '').trim())
        .filter(Boolean),
    ),
  ];
  return {
    id: String(json.id || json._id),
    slug: json.slug,
    name: json.name,
    description: json.description || '',
    kind: json.kind,
    status: json.status,
    coverImage: json.coverImage || undefined,
    companyLogos: json.companyLogos || [],
    includedCompanies: [...new Set(includedCompanies.map((s: string) => String(s).trim()).filter(Boolean))],
    careerPageUrls,
    filtersSummary: json.filtersSummary || [],
    jobCountPreview: json.jobCountPreview || 0,
    filter: json.filter || {},
    sourceBinding: json.sourceBinding || { mode: 'filter' },
    // Plans are entitlement-driven now; keep empty array for UI back-compat.
    plans: [],
  };
}

function serializeSubscription(doc: any, clusterName?: string) {
  const json = typeof doc.toJSON === 'function' ? doc.toJSON() : doc;
  const window = (json.window || '24h') as ClusterWindow;
  const createdMs = json.createdAt ? new Date(json.createdAt).getTime() : Date.now();
  return {
    id: String(json.id || json._id),
    clusterId: String(json.clusterId),
    clusterName: clusterName || json.clusterName || '',
    planId: 'entitlement',
    frequency: window,
    status: json.status,
    source: json.source || 'self_serve',
    subscribedAt: json.createdAt
      ? new Date(json.createdAt).toISOString()
      : new Date().toISOString(),
    // Feed is a live pull; show the end of the current window as the next refresh cue.
    nextRefreshAt: nextRefreshIso(window, createdMs > Date.now() - CLUSTER_WINDOW_MS[window] ? createdMs : Date.now()),
  };
}

/** Count all active cluster subscriptions (one pool). */
async function countActiveSlots(auth0Sub: string): Promise<number> {
  return ClusterSubscription.countDocuments({ auth0Sub, status: 'active' });
}

/**
 * If ops never set adminClusterLimit but the user already holds more active
 * clusters than plan-included (e.g. legacy 3/50 Premium Plus), persist the
 * active count so they are not stranded over the new plan default of 2.
 */
async function backfillOverCapAllotment(
  auth0Sub: string,
  user: {
    _id?: unknown;
    adminClusterLimit?: number | null;
    firstStepPlan?: any;
    clusterServiceOptOut?: boolean | null;
    clusterServiceStartedAt?: Date | null;
  },
  activeCount: number
): Promise<number | null | undefined> {
  if (typeof user.adminClusterLimit === 'number' && Number.isFinite(user.adminClusterLimit)) {
    return user.adminClusterLimit;
  }
  const planIncluded = getEntitlements(user.firstStepPlan).maxActiveClusters;
  if (activeCount <= planIncluded) return user.adminClusterLimit;

  const next = Math.min(50, Math.max(0, activeCount));
  try {
    await PortalUser.updateOne(
      { auth0Sub, $or: [{ adminClusterLimit: null }, { adminClusterLimit: { $exists: false } }] },
      { $set: { adminClusterLimit: next } }
    );
    user.adminClusterLimit = next;
  } catch (err: any) {
    logger.log('warn', `portal backfill allotment ${auth0Sub}: ${err?.message || err}`);
  }
  return next;
}

async function buildEntitlementPayload(
  auth0Sub: string,
  user: {
    clusterServiceStartedAt?: Date | null;
    clusterServiceOptOut?: boolean | null;
    adminClusterLimit?: number | null;
    firstStepPlan?: any;
  }
) {
  const entitlements = getEntitlements(user.firstStepPlan);
  const activeClusterCount = await countActiveSlots(auth0Sub);
  const adminLimit = await backfillOverCapAllotment(auth0Sub, user, activeClusterCount);

  const slots = resolveSubscribedSlots({
    plan: user.firstStepPlan,
    adminClusterLimit: adminLimit,
    clusterServiceOptOut: user.clusterServiceOptOut,
    clusterServiceStartedAt: user.clusterServiceStartedAt,
  });

  const availableSlots = slots.subscriptionOn
    ? Math.max(0, slots.subscribedSlots - activeClusterCount)
    : 0;

  return {
    ...entitlements,
    /** Effective allotment for gates (plan or ops). */
    maxActiveClusters: slots.subscribedSlots,
    allowedWindows: slots.allowedWindows,
    subscriptionTypeDisplay: displayPlanType(entitlements.subscriptionType),
    /** Computed subscription-on (Premium Plus defaults on; no Start click needed). */
    clusterServiceStarted: slots.subscriptionOn,
    clusterServiceStartedAt: user.clusterServiceStartedAt
      ? new Date(user.clusterServiceStartedAt).toISOString()
      : null,
    clusterServiceOptOut: Boolean(user.clusterServiceOptOut),
    /** Plan-included slots (Premium Plus = 2). */
    includedSlots: slots.planIncludedSlots,
    planIncludedSlots: slots.planIncludedSlots,
    /** Ops allotment or plan default — denominator shown in UI. */
    subscribedSlots: slots.subscribedSlots,
    /** @deprecated Use activeClusterCount; kept for older clients. */
    includedActiveCount: activeClusterCount,
    extraActiveCount: 0,
    activeClusterCount,
    availableSlots,
    planError: user.firstStepPlan?.error || null,
    planFetchedAt: user.firstStepPlan?.fetchedAt
      ? new Date(user.firstStepPlan.fetchedAt).toISOString()
      : null,
  };
}

function serializeRequest(doc: any) {
  const json = typeof doc.toJSON === 'function' ? doc.toJSON() : doc;
  return {
    id: String(json.id || json._id),
    type: json.type,
    title: json.title,
    industries: json.industries || [],
    locations: json.locations || [],
    roles: json.roles || [],
    experienceLevels: json.experienceLevels || [],
    experienceMin: json.experienceMin ?? undefined,
    experienceMax: json.experienceMax ?? undefined,
    companies: json.companies || [],
    urls: json.urls || [],
    notes: json.notes || undefined,
    status: json.status,
    submittedAt: json.submittedAt
      ? new Date(json.submittedAt).toISOString()
      : new Date().toISOString(),
    resultClusterId: json.resultClusterId ? String(json.resultClusterId) : undefined,
  };
}

function parseUrlList(raw: unknown): string[] {
  const tokens: string[] = [];
  if (Array.isArray(raw)) {
    for (const u of raw) tokens.push(String(u || '').trim());
  } else if (typeof raw === 'string') {
    for (const u of raw.split(/[\n,]+/)) tokens.push(u.trim());
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    if (!token) continue;
    let value = token.replace(/^["'<\[]+|["'>\]]+$/g, '').trim();
    if (!value) continue;
    if (!/^https?:\/\//i.test(value)) {
      value = `https://${value}`;
    }
    try {
      const u = new URL(value);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
      if (!u.hostname || !u.hostname.includes('.')) continue;
      const normalized = u.toString();
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(normalized);
    } catch {
      /* skip invalid */
    }
    if (out.length >= 10) break;
  }
  return out;
}

function companiesFromUrls(urls: string[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    try {
      const host = new URL(url).hostname.replace(/^www\./i, '');
      const base = host.split('.').slice(0, -1).join('.') || host;
      const label = base || host;
      const key = label.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        names.push(label);
      }
    } catch {
      /* ignore */
    }
  }
  return names;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// ─── Entitlements ───────────────────────────────────────────────────────────

async function ensurePlanFresh(user: NonNullable<PortalRequest['portalUser']>, auth0Sub: string, force = false) {
  const cached = user.firstStepPlan;
  const type = String(cached?.subscriptionType || '').toLowerCase();
  const staleMs = Date.now() - new Date(cached?.fetchedAt || 0).getTime();
  // All plans re-check First Step within 5 minutes so upgrades/downgrades land
  // without waiting for the next login. Soft/unknown refresh immediately.
  const soft =
    !cached ||
    type === 'unknown' ||
    type === 'pending' ||
    Boolean(cached?.error);
  const ttlMs = soft ? 0 : 5 * 60 * 1000;
  const shouldRefresh =
    force ||
    soft ||
    Number.isNaN(staleMs) ||
    staleMs > ttlMs;

  if (shouldRefresh) {
    const { plan } = await fetchFirstStepAccountCached(auth0Sub, user.email);
    user.firstStepPlan = mergeFirstStepPlan(cached, plan);
    await user.save();
  }
}

router.get('/portal/entitlements', async (req: PortalRequest, res) => {
  try {
    const user = req.portalUser;
    if (!user) {
      return res.status(404).json({ error: 'Portal profile not found', code: 'portal.user_not_found' });
    }

    const forceRefresh = String(req.query.refresh || '') === '1';
    await ensurePlanFresh(user, req.auth0Sub!, forceRefresh);

    return res.json(await buildEntitlementPayload(req.auth0Sub!, user));
  } catch (err: any) {
    logger.log('error', `portal entitlements: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to load entitlements' });
  }
});

/** One round-trip for TopBar + Home shell data. */
router.get('/portal/bootstrap', async (req: PortalRequest, res) => {
  try {
    const user = req.portalUser;
    if (!user) {
      return res.status(404).json({ error: 'Portal profile not found', code: 'portal.user_not_found' });
    }

    // Refresh plan only when missing/stale — do not force on every bootstrap.
    await ensurePlanFresh(user, req.auth0Sub!, false);

    const auth0Sub = req.auth0Sub!;
    const [entitlements, subs, clusters, savedRows, requestRows] = await Promise.all([
      buildEntitlementPayload(auth0Sub, user),
      ClusterSubscription.find({ auth0Sub }).sort({ createdAt: -1 }).lean(),
      Cluster.find({ status: 'published' }).sort({ name: 1 }).lean(),
      SavedJob.find({ auth0Sub }).select('jobUrlKey').lean(),
      ClusterRequest.find({ auth0Sub }).sort({ submittedAt: -1 }).lean(),
    ]);

    const nameById = new Map(clusters.map((c) => [String(c._id), c.name]));
    // Names for any sub whose cluster is no longer published
    const missingIds = subs
      .map((s) => String(s.clusterId))
      .filter((id) => !nameById.has(id));
    if (missingIds.length) {
      const extras = await Cluster.find({ _id: { $in: missingIds } }).select('name').lean();
      for (const c of extras) nameById.set(String(c._id), c.name);
    }

    const subscriptions = subs.map((s) =>
      serializeSubscription({ ...s, id: s._id }, nameById.get(String(s.clusterId)))
    );

    const activeSubs = subs.filter((s) => s.status === 'active');
    const publishedById = new Map(clusters.map((c) => [String(c._id), c]));
    const savedKeys = new Set(savedRows.map((s) => s.jobUrlKey));
    const savedCount = savedRows.length;

    const previewLimit = 4;
    const insightsPerCluster = 40;
    const insightsGlobalCap = 100;
    const pageResults = await Promise.all(
      activeSubs.map(async (sub) => {
        const cluster = publishedById.get(String(sub.clusterId));
        if (!cluster) return [] as any[];
        // Single pass: over-fetch once for preview + insights (reuses 30s feed cache).
        const pageResult = await queryClusterFeed({
          cluster,
          window: sub.window as ClusterWindow,
          filters: {},
          page: 1,
          limit: insightsPerCluster,
          savedJobUrlKeys: savedKeys,
        });
        return pageResult.jobs;
      })
    );
    const seen = new Set<string>();
    const deduped = pageResults
      .flat()
      .sort(
        (a, b) =>
          Date.parse(b.lastSeenAt || b.postedAt) - Date.parse(a.lastSeenAt || a.postedAt)
      )
      .filter((j) => {
        if (seen.has(j.id)) return false;
        seen.add(j.id);
        return true;
      });

    const insightSample = deduped.slice(0, insightsGlobalCap);
    const feedInsights =
      activeSubs.length === 0
        ? {
            asOf: new Date().toISOString(),
            sampleSize: 0,
            companies: [] as FeedInsightBucket[],
            categories: [] as FeedInsightBucket[],
            skills: [] as FeedInsightBucket[],
          }
        : buildFeedInsights(insightSample);

    const requests = requestRows.map((r) => serializeRequest({ ...r, id: r._id }));
    const openRequestCount = requests.filter(
      (r) => r.status !== 'published' && r.status !== 'rejected'
    ).length;

    return res.json({
      entitlements,
      subscriptions,
      clusters: clusters.map((c) => serializeCluster({ ...c, id: c._id })),
      savedCount,
      openRequestCount,
      requests,
      feedPreview: {
        jobs: deduped.slice(0, previewLimit),
        total: deduped.length,
        frequency: (activeSubs[0]?.window as ClusterWindow) || '24h',
      },
      feedInsights,
    });
  } catch (err: any) {
    logger.log('error', `portal bootstrap: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to load portal bootstrap' });
  }
});

/** Range-aware feed insights + jobs-over-time series for Home. */
router.get('/portal/home-analytics', async (req: PortalRequest, res) => {
  try {
    const user = req.portalUser;
    if (!user) {
      return res.status(404).json({ error: 'Portal profile not found', code: 'portal.user_not_found' });
    }

    const range = parseHomeAnalyticsRange(req.query.range);
    const auth0Sub = req.auth0Sub!;
    const [subs, clusters] = await Promise.all([
      ClusterSubscription.find({ auth0Sub, status: 'active' }).sort({ createdAt: -1 }).lean(),
      Cluster.find({ status: 'published' }).lean(),
    ]);

    const publishedById = new Map(clusters.map((c) => [String(c._id), c]));
    const nameById = new Map(clusters.map((c) => [String(c._id), c.name]));
    const missingIds = subs
      .map((s) => String(s.clusterId))
      .filter((id) => !nameById.has(id));
    if (missingIds.length) {
      const extras = await Cluster.find({ _id: { $in: missingIds } }).select('name').lean();
      for (const c of extras) nameById.set(String(c._id), c.name);
    }

    const planStart =
      user.clusterServiceStartedAt ||
      (user as any).firstStepPlan?.fetchedAt ||
      null;
    const { startMs, endMs, granularity } = resolveRangeWindow(range, planStart);

    // Cluster-scoped aggregations + shared TTL cache (not per-user job hydration).
    const slices = await Promise.all(
      subs.map(async (sub) => {
        const cluster = publishedById.get(String(sub.clusterId));
        const subscriptionId = String(sub._id);
        const name = nameById.get(String(sub.clusterId)) || 'Cluster';
        if (!cluster) {
          return {
            subscriptionId,
            name,
            buckets: {} as Record<string, number>,
            companies: [] as { label: string; count: number }[],
            categories: [] as { label: string; count: number }[],
            sampleSize: 0,
            clusterId: String(sub.clusterId),
          };
        }
        const slice = await getClusterAnalyticsSlice({
          cluster,
          startMs,
          endMs,
          granularity,
        });
        return {
          subscriptionId,
          name,
          buckets: slice.buckets,
          companies: slice.companies,
          categories: slice.categories,
          sampleSize: slice.sampleSize,
          clusterId: slice.clusterId,
        };
      })
    );

    const merged = mergeCompanyCategoryCounts(slices, 5);
    const feedInsights = {
      asOf: new Date().toISOString(),
      sampleSize: merged.sampleSize,
      companies: merged.companies,
      categories: merged.categories,
      skills: [] as FeedInsightBucket[],
    };

    const jobSeries = buildJobSeriesFromBuckets({
      slices: slices.map((s) => ({
        subscriptionId: s.subscriptionId,
        name: s.name,
        buckets: s.buckets,
      })),
      startMs,
      endMs,
      granularity,
    });

    return res.json({
      range,
      rangeStart: new Date(startMs).toISOString(),
      rangeEnd: new Date(endMs).toISOString(),
      feedInsights,
      jobSeries,
    });
  } catch (err: any) {
    logger.log('error', `portal home-analytics: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to load home analytics' });
  }
});

// ─── Cluster service start (ScoutX gate; not First Step billing) ─────────────

router.post('/portal/cluster-service/start', async (req: PortalRequest, res) => {
  try {
    const user = req.portalUser;
    if (!user) {
      return res.status(404).json({ error: 'Portal profile not found', code: 'portal.user_not_found' });
    }

    // Re-sync plan before start so PremiumPlus is not stuck as "unknown".
    const plan = await fetchFirstStepPlanSnapshot(req.auth0Sub, user.email);
    user.firstStepPlan = mergeFirstStepPlan(user.firstStepPlan, plan);

    const slots = resolveSubscribedSlots({
      plan: user.firstStepPlan,
      adminClusterLimit: user.adminClusterLimit,
      clusterServiceOptOut: user.clusterServiceOptOut,
      clusterServiceStartedAt: user.clusterServiceStartedAt || new Date(),
    });

    // Allow start when ops already allotted slots, even if plan-included is 0.
    if (!slots.subscriptionOn && slots.subscribedSlots <= 0 && getEntitlements(plan).maxActiveClusters <= 0) {
      // Still allow explicit start if admin already set a limit > 0 after clearing opt-out.
      const afterStart = resolveSubscribedSlots({
        plan: user.firstStepPlan,
        adminClusterLimit: user.adminClusterLimit,
        clusterServiceOptOut: false,
        clusterServiceStartedAt: new Date(),
      });
      if (afterStart.subscribedSlots <= 0) {
        return res.status(403).json({
          error:
            getEntitlements(plan).source === 'unknown'
              ? 'Could not load your First Step plan. Ensure First Step is running, then try again.'
              : 'Your plan does not include cluster slots. Ask ops to enable subscription and set an allotment.',
          code:
            getEntitlements(plan).source === 'unknown' ? 'portal.plan_unknown' : 'portal.no_entitlement',
          planError: plan.error || null,
        });
      }
    }

    user.clusterServiceOptOut = false;
    if (!user.clusterServiceStartedAt) {
      user.clusterServiceStartedAt = new Date();
    }
    await user.save();

    return res.json(await buildEntitlementPayload(req.auth0Sub!, user));
  } catch (err: any) {
    logger.log('error', `portal cluster-service start: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to start cluster service' });
  }
});

// ─── Clusters (browse) ──────────────────────────────────────────────────────

router.get('/portal/clusters', async (req: PortalRequest, res) => {
  try {
    const q = String(req.query.q || '').trim().toLowerCase();
    const industry = String(req.query.industry || '').trim();
    const kind = String(req.query.kind || '').trim();

    const filter: Record<string, any> = { status: 'published' };
    if (kind === 'curated' || kind === 'custom') filter.kind = kind;
    if (industry) filter['filter.frozenIndustries'] = industry;

    let clusters = await Cluster.find(filter).sort({ name: 1 }).lean();

    // Best-effort: refresh company preview when empty so browse search works.
    await Promise.all(
      clusters.slice(0, 30).map(async (c) => {
        if ((c.companyNamesPreview || []).length > 0) return;
        try {
          const names = await distinctCompaniesForCluster(c);
          if (names.length) {
            await Cluster.updateOne({ _id: c._id }, { $set: { companyNamesPreview: names } });
            (c as any).companyNamesPreview = names;
          }
        } catch {
          /* ignore */
        }
      })
    );

    if (q) {
      clusters = clusters.filter((c) => clusterSearchHaystack(c).includes(q));
    }

    const industries = [
      ...new Set(
        clusters.flatMap((c) => c.filter?.frozenIndustries || []).filter(Boolean)
      ),
    ].sort();

    return res.json({
      clusters: clusters.map((c) => serializeCluster({ ...c, id: c._id })),
      facets: { industries },
    });
  } catch (err: any) {
    logger.log('error', `portal clusters list: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to list clusters' });
  }
});

router.get('/portal/clusters/:slug', async (req: PortalRequest, res) => {
  try {
    const slug = String(req.params.slug || '').trim();
    const cluster = await Cluster.findOne({ slug, status: 'published' }).lean();
    if (!cluster) return res.status(404).json({ error: 'Cluster not found' });
    return res.json(serializeCluster(cluster));
  } catch (err: any) {
    logger.log('error', `portal cluster get: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to load cluster' });
  }
});

router.get('/portal/clusters/:slug/sample-jobs', async (req: PortalRequest, res) => {
  try {
    const slug = String(req.params.slug || '').trim();
    const cluster = await Cluster.findOne({ slug, status: 'published' }).lean();
    if (!cluster) return res.status(404).json({ error: 'Cluster not found' });
    const limit = Math.min(20, Math.max(1, Number(req.query.limit) || 8));
    const jobs = await sampleJobsForCluster(cluster, limit);
    return res.json({ jobs, clusterId: String(cluster._id), clusterName: cluster.name });
  } catch (err: any) {
    logger.log('error', `portal sample jobs: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to load sample jobs' });
  }
});

/** Full company list for cluster detail (not capped at preview size). */
router.get('/portal/clusters/:slug/companies', async (req: PortalRequest, res) => {
  try {
    const slug = String(req.params.slug || '').trim();
    const cluster = await Cluster.findOne({ slug, status: 'published' }).lean();
    if (!cluster) return res.status(404).json({ error: 'Cluster not found' });
    const cap = Math.min(5000, Math.max(1, Number(req.query.limit) || 2000));
    const companies = await distinctCompaniesForCluster(cluster, getPortalJobBoardOwnerId(), cap);
    return res.json({
      companies,
      count: companies.length,
      clusterId: String(cluster._id),
      clusterName: cluster.name,
    });
  } catch (err: any) {
    logger.log('error', `portal cluster companies: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to load companies' });
  }
});

// ─── Subscriptions ──────────────────────────────────────────────────────────

router.get('/portal/subscriptions', async (req: PortalRequest, res) => {
  try {
    const subs = await ClusterSubscription.find({ auth0Sub: req.auth0Sub })
      .sort({ createdAt: -1 })
      .lean();
    const clusterIds = subs.map((s) => s.clusterId);
    const clusters = await Cluster.find({ _id: { $in: clusterIds } }).lean();
    const nameById = new Map(clusters.map((c) => [String(c._id), c.name]));
    return res.json({
      subscriptions: subs.map((s) =>
        serializeSubscription({ ...s, id: s._id }, nameById.get(String(s.clusterId)))
      ),
    });
  } catch (err: any) {
    logger.log('error', `portal subscriptions list: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to list subscriptions' });
  }
});

router.post('/portal/subscriptions', async (req: PortalRequest, res) => {
  try {
    const clusterId = String(req.body?.clusterId || '').trim();
    const window = parseClusterWindow(req.body?.window || req.body?.frequency);
    if (!mongoose.isValidObjectId(clusterId)) {
      return res.status(400).json({ error: 'Invalid clusterId' });
    }

    const cluster = await Cluster.findOne({ _id: clusterId, status: 'published' });
    if (!cluster) return res.status(404).json({ error: 'Cluster not found' });

    const portalUser = req.portalUser;
    if (!portalUser) {
      return res.status(404).json({ error: 'Portal profile not found', code: 'portal.user_not_found' });
    }

    const activeCount = await countActiveSlots(req.auth0Sub!);
    const adminLimit = await backfillOverCapAllotment(req.auth0Sub!, portalUser, activeCount);
    const slots = resolveSubscribedSlots({
      plan: portalUser.firstStepPlan,
      adminClusterLimit: adminLimit,
      clusterServiceOptOut: portalUser.clusterServiceOptOut,
      clusterServiceStartedAt: portalUser.clusterServiceStartedAt,
    });

    if (!slots.subscriptionOn) {
      return res.status(403).json({
        error: 'Cluster subscription is not enabled for your account',
        code: 'portal.subscription_off',
      });
    }
    if (!isAllowedWindow(slots, window)) {
      return res.status(403).json({
        error: `Window ${window} is not allowed`,
        code: 'portal.window_not_allowed',
        allowedWindows: slots.allowedWindows,
      });
    }

    const existing = await ClusterSubscription.findOne({
      auth0Sub: req.auth0Sub,
      clusterId,
    });
    if (existing) {
      if (existing.status === 'paused') {
        if (activeCount >= slots.subscribedSlots) {
          return res.status(403).json({
            error: `You can hold ${slots.subscribedSlots} cluster${slots.subscribedSlots === 1 ? '' : 's'}. Pause one, or ask ops to increase your allotment.`,
            code: 'portal.slot_full',
          });
        }
        existing.status = 'active';
        existing.window = window;
        if (!existing.source) existing.source = 'self_serve';
        await existing.save();
        return res.json(serializeSubscription(existing, cluster.name));
      }
      existing.window = window;
      await existing.save();
      return res.json(serializeSubscription(existing, cluster.name));
    }

    if (activeCount >= slots.subscribedSlots) {
      return res.status(403).json({
        error: `You can hold ${slots.subscribedSlots} cluster${slots.subscribedSlots === 1 ? '' : 's'}. Ask ops to increase your allotment after payment.`,
        code: 'portal.slot_full',
        maxActiveClusters: slots.subscribedSlots,
        subscribedSlots: slots.subscribedSlots,
        activeClusterCount: activeCount,
      });
    }

    const sub = await ClusterSubscription.create({
      auth0Sub: req.auth0Sub,
      clusterId,
      window,
      status: 'active',
      source: 'self_serve',
    });
    return res.status(201).json(serializeSubscription(sub, cluster.name));
  } catch (err: any) {
    if (err?.code === 11000) {
      return res.status(409).json({ error: 'Already subscribed to this cluster' });
    }
    logger.log('error', `portal subscribe: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to subscribe' });
  }
});

router.patch('/portal/subscriptions/:id', async (req: PortalRequest, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid subscription id' });
    }
    const sub = await ClusterSubscription.findOne({ _id: id, auth0Sub: req.auth0Sub });
    if (!sub) return res.status(404).json({ error: 'Subscription not found' });

    const portalUser = req.portalUser;
    if (!portalUser) {
      return res.status(404).json({ error: 'Portal profile not found', code: 'portal.user_not_found' });
    }

    const activeCount = await countActiveSlots(req.auth0Sub!);
    const adminLimit = await backfillOverCapAllotment(req.auth0Sub!, portalUser, activeCount);
    const slots = resolveSubscribedSlots({
      plan: portalUser.firstStepPlan,
      adminClusterLimit: adminLimit,
      clusterServiceOptOut: portalUser.clusterServiceOptOut,
      clusterServiceStartedAt: portalUser.clusterServiceStartedAt,
    });

    const nextStatus = req.body?.status;
    const nextWindow = req.body?.window ?? req.body?.frequency;

    if (nextWindow != null) {
      const window = parseClusterWindow(nextWindow);
      if (!isAllowedWindow(slots, window)) {
        return res.status(403).json({
          error: `Window ${window} is not allowed`,
          code: 'portal.window_not_allowed',
        });
      }
      sub.window = window;
    }

    if (nextStatus === 'paused' || nextStatus === 'active') {
      if (nextStatus === 'active' && sub.status !== 'active') {
        if (!slots.subscriptionOn) {
          return res.status(403).json({
            error: 'Cluster subscription is not enabled for your account',
            code: 'portal.subscription_off',
          });
        }
        if (activeCount >= slots.subscribedSlots) {
          return res.status(403).json({
            error: `You can hold ${slots.subscribedSlots} cluster${slots.subscribedSlots === 1 ? '' : 's'}. Pause one, or ask ops to increase your allotment.`,
            code: 'portal.slot_full',
          });
        }
      }
      sub.status = nextStatus;
    }

    await sub.save();
    const cluster = await Cluster.findById(sub.clusterId).lean();
    return res.json(serializeSubscription(sub, cluster?.name));
  } catch (err: any) {
    logger.log('error', `portal subscription patch: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to update subscription' });
  }
});

router.delete('/portal/subscriptions/:id', async (req: PortalRequest, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid subscription id' });
    }
    const result = await ClusterSubscription.deleteOne({ _id: id, auth0Sub: req.auth0Sub });
    if (!result.deletedCount) return res.status(404).json({ error: 'Subscription not found' });
    return res.status(204).send();
  } catch (err: any) {
    logger.log('error', `portal subscription delete: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to cancel subscription' });
  }
});

// ─── Feed ───────────────────────────────────────────────────────────────────

router.get('/portal/feed', async (req: PortalRequest, res) => {
  try {
    const subscriptionId = String(req.query.subscriptionId || 'all').trim();
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const filters = {
      q: String(req.query.q || '').trim() || undefined,
      company: String(req.query.company || '').trim() || undefined,
      location: String(req.query.location || '').trim() || undefined,
      workMode: String(req.query.workMode || '').trim() || undefined,
      experience: String(req.query.experience || '').trim() || undefined,
      frozenExperienceLevel: String(req.query.frozenExperienceLevel || '').trim() || undefined,
      frozenState: String(req.query.frozenState || '').trim() || undefined,
      h1bSponsorFriendly:
        String(req.query.h1bSponsorFriendly || '').trim() === 'true' ||
        String(req.query.h1bSponsorFriendly || '').trim() === '1',
      h1bFy2026Match:
        String(req.query.h1bFy2026Match || '').trim() === 'true' ||
        String(req.query.h1bFy2026Match || '').trim() === '1',
    };

    const subFilter: Record<string, any> = { auth0Sub: req.auth0Sub, status: 'active' };
    if (subscriptionId !== 'all') {
      if (!mongoose.isValidObjectId(subscriptionId)) {
        return res.status(400).json({ error: 'Invalid subscriptionId' });
      }
      subFilter._id = subscriptionId;
    }

    const subs = await ClusterSubscription.find(subFilter).lean();
    if (!subs.length) {
      return res.json({ jobs: [], total: 0, frequency: '24h', page, limit });
    }

    const clusters = await Cluster.find({
      _id: { $in: subs.map((s) => s.clusterId) },
      status: 'published',
    }).lean();
    const clusterById = new Map(clusters.map((c) => [String(c._id), c]));

    const savedRows = await SavedJob.find({ auth0Sub: req.auth0Sub }).select('jobUrlKey').lean();
    const savedKeys = new Set(savedRows.map((s) => s.jobUrlKey));
    const assignedRows = await AssignedJob.find({ auth0Sub: req.auth0Sub })
      .select('jobUrlKey')
      .lean();
    const assignedKeys = new Set(assignedRows.map((s) => s.jobUrlKey));

    // Frequency is delivery cadence metadata — not a feed visibility window.
    const frequency: ClusterWindow =
      (subs[0]?.window as ClusterWindow) || '24h';

    const feedClusters = subs
      .map((s) => clusterById.get(String(s.clusterId)))
      .filter(Boolean)
      .map((c) => ({ ...c!, id: String(c!._id) }));

    const pageResult = await queryMergedClusterFeed({
      clusters: feedClusters,
      filters,
      page,
      limit,
      savedJobUrlKeys: savedKeys,
      assignedJobUrlKeys: assignedKeys,
    });

    return res.json({
      jobs: pageResult.jobs,
      total: pageResult.total,
      frequency,
      page: pageResult.page,
      limit: pageResult.limit,
    });
  } catch (err: any) {
    logger.log('error', `portal feed: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to load feed' });
  }
});

router.get('/portal/jobs/:id', async (req: PortalRequest, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid job id' });
    }
    const ownerId = getPortalJobBoardOwnerId();
    const row = await JobBoardListing.findOne({ _id: id, ...boardMatch(ownerId) }).lean();
    if (!row) return res.status(404).json({ error: 'Job not found' });

    const mapped = mapListingToJob(row, { fullDescription: true });
    if (!mapped) return res.status(404).json({ error: 'Job not found' });

    const saved = await SavedJob.exists({
      auth0Sub: req.auth0Sub,
      jobUrlKey: String(row.jobUrlKey || ''),
    });
    const assigned = await AssignedJob.exists({
      auth0Sub: req.auth0Sub,
      jobUrlKey: String(row.jobUrlKey || ''),
    });

    const feedJob = mapListingToFeedJob(row, {
      clusterId: '',
      clusterName: '',
      saved: Boolean(saved),
      assigned: Boolean(assigned),
    });
    if (!feedJob) return res.status(404).json({ error: 'Job not found' });

    // Prefer full description from mapListingToJob
    feedJob.description = String((mapped.data as any).jobDescription || feedJob.description);

    return res.json(feedJob);
  } catch (err: any) {
    logger.log('error', `portal job get: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to load job' });
  }
});

/** Assign a portal feed job into First Step Application Incharge OD Jobs (JB path). */
router.post('/portal/jobs/:id/assign', async (req: PortalRequest, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid job id' });
    }
    const ownerId = getPortalJobBoardOwnerId();
    const row = await JobBoardListing.findOne({ _id: id, ...boardMatch(ownerId) }).lean();
    if (!row) return res.status(404).json({ error: 'Job not found' });

    const mapped = mapListingToJob(row, { fullDescription: true, allowIncomplete: true });
    const data = (mapped?.data || {}) as Record<string, any>;
    const jobUrl = String(data.applyUrl || data.jobUrl || row.applyUrl || row.jobUrl || '').trim();
    const jobTitle = String(data.jobTitle || row.jobTitle || '').trim();
    const companyName = String(
      data.companyResolvedName || data.companyName || row.companyName || '',
    ).trim();
    const email = String(req.portalUser?.email || '').trim();

    const result = await assignJobUrlToOdJobs({
      email,
      jobUrl,
      jobTitle,
      companyName,
      jobDescription: String(data.jobDescription || row.jobDescription || '').trim(),
      jobCategory: data.jobCategory || row.jobCategory || null,
      frozenCategories: Array.isArray(row.frozenCategories) ? row.frozenCategories : null,
      companyLogo: String(data.companyLogoUrl || row.companyLogoUrl || '').trim(),
      location: String(data.location || row.location || '').trim(),
      jobExperience: data.jobExperience ?? row.jobExperience ?? null,
      frozenExperienceYears: Array.isArray(row.frozenExperienceYears)
        ? row.frozenExperienceYears
        : null,
      jobEmploymentType: String(data.employmentType || row.employmentType || '').trim(),
      jobSalary: String(data.salaryRange || row.salaryRange || '').trim(),
      jobWorkPlaceType: String(data.remoteType || row.remoteType || '').trim(),
      jobSeniorityLevel: String(data.seniorityLevel || row.seniorityLevel || '').trim(),
      companyUrl: String(data.companyWebsite || row.companyWebsite || '').trim(),
      h1bEligible: Boolean(data.h1bEligible || row.h1bEligible),
    });

    if (!result.ok) {
      const code =
        result.status === 'no_firststep_account'
          ? 'portal.no_firststep_account'
          : result.status === 'no_application_incharge'
            ? 'portal.no_application_incharge'
            : result.status === 'invalid_url'
              ? 'portal.invalid_job_url'
              : 'portal.assign_failed';
      const http =
        result.status === 'no_firststep_account' ||
        result.status === 'no_application_incharge' ||
        result.status === 'invalid_url'
          ? 400
          : 502;
      return res.status(http).json({ error: result.message, code, status: result.status });
    }

    const jobUrlKey = String(row.jobUrlKey || '').trim();
    if (jobUrlKey && req.auth0Sub) {
      await AssignedJob.findOneAndUpdate(
        { auth0Sub: req.auth0Sub, jobUrlKey },
        {
          $set: { assignedAt: new Date(), jobId: id },
          $setOnInsert: { auth0Sub: req.auth0Sub, jobUrlKey },
        },
        { upsert: true },
      );
    }

    return res.json({
      status: result.status,
      newJobs: result.newJobs,
      urlDuplicates: result.status === 'already_assigned' ? result.urlDuplicates : 0,
      jobId: id,
      jobUrl,
      title: jobTitle,
      company: companyName,
      jobCategory: result.jobCategory,
      assigned: true,
      message:
        result.status === 'already_assigned'
          ? 'This job is already in your Application Incharge ScoutX Jobs queue'
          : 'Assigned to Application Incharge ScoutX Jobs — Edit & Activate there, then apply from Apply Jobs',
    });
  } catch (err: any) {
    logger.log('error', `portal job assign: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to assign job' });
  }
});

const REPORT_REASONS = new Set([
  'incorrect_company',
  'incorrect_category',
  'old_job',
  'other',
]);

/** Report a feed job for ops review. */
router.post('/portal/jobs/:id/report', async (req: PortalRequest, res) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid job id' });
    }
    const reason = String(req.body?.reason || '').trim();
    const note = String(req.body?.note || '').trim();
    if (!REPORT_REASONS.has(reason)) {
      return res.status(400).json({ error: 'Invalid report reason' });
    }
    if (reason === 'other' && !note) {
      return res.status(400).json({ error: 'Please describe the issue for Other' });
    }

    const ownerId = getPortalJobBoardOwnerId();
    const row = await JobBoardListing.findOne({ _id: id, ...boardMatch(ownerId) })
      .select('jobUrlKey jobUrl applyUrl title company')
      .lean();
    if (!row) return res.status(404).json({ error: 'Job not found' });

    const doc = await JobReport.create({
      auth0Sub: req.auth0Sub,
      reporterEmail: req.portalUser?.email || null,
      reporterName: req.portalUser?.name || null,
      jobId: id,
      jobUrlKey: String(row.jobUrlKey || ''),
      jobUrl: String(row.applyUrl || row.jobUrl || ''),
      title: String(row.title || ''),
      company: String(row.company || ''),
      reason,
      note: note || null,
      status: 'open',
    });

    return res.status(201).json({
      id: String(doc._id),
      status: doc.status,
      reason: doc.reason,
      message: 'Report submitted — ops will review it',
    });
  } catch (err: any) {
    logger.log('error', `portal job report: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to submit report' });
  }
});

// ─── Saved jobs ─────────────────────────────────────────────────────────────

const SAVED_PAGE_DEFAULT = 24;
const SAVED_PAGE_MAX = 48;

router.get('/portal/saved', async (req: PortalRequest, res) => {
  try {
    const pageRaw = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limitRaw = parseInt(String(req.query.limit || String(SAVED_PAGE_DEFAULT)), 10) || SAVED_PAGE_DEFAULT;
    const limit = Math.min(SAVED_PAGE_MAX, Math.max(1, limitRaw));
    const q = String(req.query.q || '')
      .trim()
      .toLowerCase();
    const companyFilter = String(req.query.company || '').trim();

    const saved = await SavedJob.find({ auth0Sub: req.auth0Sub }).sort({ savedAt: -1 }).lean();
    if (!saved.length) {
      return res.json({ jobs: [], total: 0, page: pageRaw, limit, companies: [] });
    }

    const keys = saved.map((s) => s.jobUrlKey);
    const ownerId = getPortalJobBoardOwnerId();
    const [rows, assignedRows] = await Promise.all([
      JobBoardListing.find({
        ownerId,
        jobUrlKey: { $in: keys },
        status: 'ready',
      }).lean(),
      AssignedJob.find({ auth0Sub: req.auth0Sub, jobUrlKey: { $in: keys } })
        .select('jobUrlKey')
        .lean(),
    ]);
    const byKey = new Map(rows.map((r) => [String(r.jobUrlKey), r]));
    const assignedKeys = new Set(assignedRows.map((s) => s.jobUrlKey));

    const jobs = [];
    for (const s of saved) {
      const row = byKey.get(s.jobUrlKey);
      if (!row) continue;
      const job = mapListingToFeedJob(row, {
        clusterId: '',
        clusterName: '',
        saved: true,
        assigned: assignedKeys.has(s.jobUrlKey),
      });
      if (job) jobs.push(job);
    }

    const companies = Array.from(new Set(jobs.map((j) => j.company).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b)
    );

    let filtered = jobs;
    if (companyFilter) {
      filtered = filtered.filter((j) => j.company === companyFilter);
    }
    if (q) {
      filtered = filtered.filter((j) => {
        const hay = `${j.title} ${j.company} ${j.location || ''} ${j.jobCategory || ''}`.toLowerCase();
        return hay.includes(q);
      });
    }

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const page = Math.min(pageRaw, totalPages);
    const start = (page - 1) * limit;
    const pageJobs = filtered.slice(start, start + limit);

    return res.json({
      jobs: pageJobs,
      total,
      page,
      limit,
      totalPages,
      companies,
    });
  } catch (err: any) {
    logger.log('error', `portal saved list: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to list saved jobs' });
  }
});

router.post('/portal/saved', async (req: PortalRequest, res) => {
  try {
    const jobId = String(req.body?.jobId || req.body?.id || '').trim();
    let jobUrlKey = String(req.body?.jobUrlKey || '').trim();

    if (!jobUrlKey && mongoose.isValidObjectId(jobId)) {
      const row = await JobBoardListing.findById(jobId).select('jobUrlKey').lean();
      if (!row?.jobUrlKey) return res.status(404).json({ error: 'Job not found' });
      jobUrlKey = String(row.jobUrlKey);
    }
    if (!jobUrlKey) return res.status(400).json({ error: 'jobId or jobUrlKey required' });

    await SavedJob.findOneAndUpdate(
      { auth0Sub: req.auth0Sub, jobUrlKey },
      {
        $set: { savedAt: new Date(), jobId: jobId || null },
        $setOnInsert: { auth0Sub: req.auth0Sub, jobUrlKey },
      },
      { upsert: true, new: true }
    );

    const ownerId = getPortalJobBoardOwnerId();
    const row = await JobBoardListing.findOne({ ownerId, jobUrlKey }).lean();
    if (!row) {
      return res.json({ id: jobId, saved: true, jobUrlKey });
    }
    const job = mapListingToFeedJob(row, { clusterId: '', clusterName: '', saved: true });
    return res.status(201).json(job);
  } catch (err: any) {
    logger.log('error', `portal save: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to save job' });
  }
});

router.delete('/portal/saved/:jobId', async (req: PortalRequest, res) => {
  try {
    const jobId = String(req.params.jobId || '').trim();
    let jobUrlKey = '';

    if (mongoose.isValidObjectId(jobId)) {
      const row = await JobBoardListing.findById(jobId).select('jobUrlKey').lean();
      jobUrlKey = String(row?.jobUrlKey || '');
    }
    if (!jobUrlKey) jobUrlKey = jobId;

    await SavedJob.deleteOne({
      auth0Sub: req.auth0Sub,
      $or: [{ jobUrlKey }, ...(mongoose.isValidObjectId(jobId) ? [{ jobId }] : [])],
    });

    if (mongoose.isValidObjectId(jobId)) {
      const ownerId = getPortalJobBoardOwnerId();
      const row = await JobBoardListing.findOne({
        _id: jobId,
        ownerId,
      }).lean();
      if (row) {
        const job = mapListingToFeedJob(row, { clusterId: '', clusterName: '', saved: false });
        return res.json(job);
      }
    }
    return res.json({ id: jobId, saved: false });
  } catch (err: any) {
    logger.log('error', `portal unsave: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to unsave job' });
  }
});

// ─── Cluster requests ───────────────────────────────────────────────────────

router.get('/portal/requests', async (req: PortalRequest, res) => {
  try {
    const rows = await ClusterRequest.find({ auth0Sub: req.auth0Sub })
      .sort({ submittedAt: -1 })
      .lean();
    return res.json({ requests: rows.map((r) => serializeRequest({ ...r, id: r._id })) });
  } catch (err: any) {
    logger.log('error', `portal requests list: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to list requests' });
  }
});

router.post('/portal/requests', async (req: PortalRequest, res) => {
  try {
    const body = req.body || {};
    const type = body.type === 'custom_urls' ? 'custom_urls' : 'predefined';
    const title = String(body.title || '').trim();
    if (!title) return res.status(400).json({ error: 'title is required' });

    const industries = Array.isArray(body.industries)
      ? body.industries.map((x: unknown) => String(x).trim()).filter(Boolean)
      : [];
    const locations = Array.isArray(body.locations)
      ? body.locations.map((x: unknown) => String(x).trim()).filter(Boolean)
      : [];
    const roles = Array.isArray(body.roles)
      ? body.roles.map((x: unknown) => String(x).trim()).filter(Boolean)
      : [];
    const experienceLevels = Array.isArray(body.experienceLevels)
      ? body.experienceLevels.map((x: unknown) => String(x).trim()).filter(Boolean)
      : [];
    // Legacy: predefined requests sometimes encoded levels as "Level: …" inside roles
    for (const role of roles) {
      const m = /^Level:\s*(.+)$/i.exec(role);
      if (m?.[1] && !experienceLevels.includes(m[1].trim())) {
        experienceLevels.push(m[1].trim());
      }
    }
    const rolesClean = roles.filter((r: string) => !/^Level:\s*/i.test(r));
    let companies = Array.isArray(body.companies)
      ? body.companies.map((x: unknown) => String(x).trim()).filter(Boolean)
      : [];
    const urls = parseUrlList(body.urls);

    if (type === 'custom_urls') {
      if (!urls.length) {
        return res.status(400).json({ error: 'At least one company career URL is required' });
      }
      if (urls.length > 10) {
        return res.status(400).json({ error: 'Maximum 10 company career URLs' });
      }
      const invalid = urls.filter((u) => !isValidHttpUrl(u));
      if (invalid.length) {
        return res.status(400).json({
          error: 'Invalid URL(s)',
          invalid,
          hint: 'Provide full company career page URLs (https://...)',
        });
      }
      if (!rolesClean.length) {
        return res.status(400).json({ error: 'Select at least one job title / role' });
      }
      if (!companies.length) {
        companies = companiesFromUrls(urls);
      }
    }

    const doc = await ClusterRequest.create({
      auth0Sub: req.auth0Sub,
      type,
      title,
      industries,
      locations,
      roles: rolesClean,
      experienceLevels,
      experienceMin:
        body.experienceMin != null && body.experienceMin !== ''
          ? Number(body.experienceMin)
          : null,
      experienceMax:
        body.experienceMax != null && body.experienceMax !== ''
          ? Number(body.experienceMax)
          : null,
      companies,
      urls,
      notes: body.notes ? String(body.notes).trim() : null,
      status: 'submitted',
      submittedAt: new Date(),
    });

    return res.status(201).json(serializeRequest(doc));
  } catch (err: any) {
    logger.log('error', `portal request create: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to submit request' });
  }
});

export { slugify };
export default router;

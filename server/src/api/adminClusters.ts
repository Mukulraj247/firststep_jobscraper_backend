import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { requireSignInOrApiKey } from '../middlewares/auth';
import Cluster from '../models/Cluster';
import ClusterActivity, { type ClusterActivityAction } from '../models/ClusterActivity';
import ClusterRequest from '../models/ClusterRequest';
import ClusterSubscription from '../models/ClusterSubscription';
import SavedJob from '../models/SavedJob';
import PortalUser from '../models/PortalUser';
import JobReport from '../models/JobReport';
import Robot from '../models/Robot';
import { serializeCluster, slugify } from './portal';
import { countJobsForCluster, sampleJobsForCluster } from '../services/clusterFeed';
import {
  buildFiltersSummary,
  curatedHasFilters,
  customHasSources,
  normalizeFilter,
  requestToClusterFilter,
  resolveSourceMode,
} from '../services/clusterStudioHelpers';
import {
  ADMIN_MAX_ASSIGNABLE_CLUSTERS,
  CLUSTER_WINDOWS,
  getEntitlements,
  parseClusterWindow,
  displayPlanType,
  resolveSubscribedSlots,
  type ClusterWindow,
} from '../services/clusterEntitlements';
import { staffRoleDisplayOverride, isFirstStepStaffRole } from '../services/firstStepRoles';
import { fetchFirstStepAccount } from '../services/firstStepSubscription';
import { getScoutXOpsUserId } from '../services/scoutxAuth0';
import { normalizeOwnerIdForWrite, ownerIdFilter } from '../utils/ownerId';
import {
  careerBoardUrlForStorage,
  careerHostKey,
  careerReuseMessage,
  hasCareerSiteFilters,
  normalizeAutomationUrl,
  pickBestCareerRobot,
  type CareerRobotMatchKind,
} from '../utils/automationUrl';
import { boardMatch } from './jobs';
import JobBoardListing from '../models/JobBoardListing';
import Run from '../models/Run';
import { getPortalJobBoardOwnerId } from '../services/portalOwner';
import { applyFrozenClusterFilters } from '../services/jobBoardQuery';
import logger from '../logger';

const router = Router();
router.use('/cluster-studio', requireSignInOrApiKey);

type CareerRobotLookup = {
  robot: any;
  matchKind: CareerRobotMatchKind;
  requestedHadSiteFilters: boolean;
  robotUrl: string;
  reuseNote: string | null;
};

async function findRobotsForCareerHost(hostKey: string): Promise<any[]> {
  const escaped = hostKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match http(s)://host or http(s)://www.host …
  const re = new RegExp(`^https?:\\/\\/(www\\.)?${escaped}([\\/:?#]|$)`, 'i');
  const opsOwner = getScoutXOpsUserId();
  const ownerFilter = ownerIdFilter(opsOwner);
  const owned = await Robot.find({
    ...ownerFilter,
    'recording_meta.url': re,
  })
    .select('recording_meta')
    .limit(40)
    .lean();
  if (owned.length) return owned;
  return Robot.find({ 'recording_meta.url': re }).select('recording_meta').limit(40).lean();
}

/**
 * Resolve an existing automation for a pasted career URL.
 * 1) Exact normalized URL
 * 2) Same path without query (root)
 * 3) Same company host — prefer broader unfiltered board
 */
async function findRobotByCareerUrl(url: string): Promise<CareerRobotLookup | null> {
  let normalized = '';
  try {
    normalized = normalizeAutomationUrl(url);
  } catch {
    normalized = String(url || '').trim();
  }
  if (!normalized) return null;

  const requestedHadSiteFilters = hasCareerSiteFilters(normalized);
  const hostKey = careerHostKey(normalized);
  const candidates = hostKey ? await findRobotsForCareerHost(hostKey) : [];

  const mapped = candidates.map((r) => ({
    doc: r,
    metaId: String(r?.recording_meta?.id || ''),
    url: String(r?.recording_meta?.url || ''),
    name: String(r?.recording_meta?.name || ''),
  }));

  // Also try exact doc lookup in case host regex missed an odd URL shape
  const opsOwner = getScoutXOpsUserId();
  const ownerFilter = ownerIdFilter(opsOwner);
  const exactOwned = await Robot.findOne({
    ...ownerFilter,
    'recording_meta.url': normalized,
  })
    .select('recording_meta')
    .lean();
  const exactAny =
    exactOwned ||
    (await Robot.findOne({ 'recording_meta.url': normalized }).select('recording_meta').lean());
  if (exactAny) {
    const metaId = String((exactAny as any).recording_meta?.id || '');
    if (metaId && !mapped.some((m) => m.metaId === metaId)) {
      mapped.unshift({
        doc: exactAny,
        metaId,
        url: String((exactAny as any).recording_meta?.url || ''),
        name: String((exactAny as any).recording_meta?.name || ''),
      });
    }
  }

  const best = pickBestCareerRobot(normalized, mapped);
  if (!best) return null;

  const robotUrl = best.robot.url;
  return {
    robot: best.robot.doc,
    matchKind: best.matchKind,
    requestedHadSiteFilters,
    robotUrl,
    reuseNote: careerReuseMessage({
      matchKind: best.matchKind,
      requestedHadSiteFilters,
      robotUrl,
    }),
  };
}

function normalizeOverrideUrlKey(url: string): string {
  try {
    return normalizeAutomationUrl(url);
  } catch {
    return String(url || '').trim().toLowerCase();
  }
}

function findOverrideMetaId(
  url: string,
  overrides: Array<{ url?: string; robotMetaId?: string }> | null | undefined
): string | null {
  if (!Array.isArray(overrides) || !overrides.length) return null;
  const key = normalizeOverrideUrlKey(url);
  const raw = String(url || '').trim();
  for (const row of overrides) {
    const oUrl = String(row?.url || '').trim();
    const metaId = String(row?.robotMetaId || '').trim();
    if (!oUrl || !metaId) continue;
    if (oUrl === raw || normalizeOverrideUrlKey(oUrl) === key) return metaId;
  }
  return null;
}

async function findRobotByMetaId(metaId: string): Promise<any | null> {
  const id = String(metaId || '').trim();
  if (!id) return null;
  const opsOwner = getScoutXOpsUserId();
  const ownerFilter = ownerIdFilter(opsOwner);
  const owned = await Robot.findOne({
    ...ownerFilter,
    'recording_meta.id': id,
  })
    .select('recording_meta')
    .lean();
  if (owned) return owned;
  return Robot.findOne({ 'recording_meta.id': id }).select('recording_meta').lean();
}

async function resolveCareerRobotForRequestUrl(
  url: string,
  overrides?: Array<{ url?: string; robotMetaId?: string }> | null
): Promise<CareerRobotLookup | null> {
  const overrideMetaId = findOverrideMetaId(url, overrides);
  if (overrideMetaId) {
    const robot = await findRobotByMetaId(overrideMetaId);
    if (robot) {
      const robotUrl = String((robot as any).recording_meta?.url || '');
      let normalized = url;
      try {
        normalized = normalizeAutomationUrl(url);
      } catch {
        /* keep */
      }
      return {
        robot,
        matchKind: 'manual',
        requestedHadSiteFilters: hasCareerSiteFilters(normalized),
        robotUrl,
        reuseNote: careerReuseMessage({
          matchKind: 'manual',
          requestedHadSiteFilters: hasCareerSiteFilters(normalized),
          robotUrl,
        }),
      };
    }
  }
  return findRobotByCareerUrl(url);
}

/** Build lean search tokens from free text or a pasted career URL. */
function robotSearchTokens(raw: string): string[] {
  const q = String(raw || '').trim();
  if (!q) return [];
  const tokens = new Set<string>();
  tokens.add(q);
  try {
    const u = new URL(q.includes('://') ? q : `https://${q}`);
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    if (host) {
      tokens.add(host);
      const brand = host.split('.')[0];
      if (brand && brand.length >= 2 && brand !== 'www') tokens.add(brand);
    }
  } catch {
    /* not a URL */
  }
  for (const t of [...tokens]) {
    const brand = t.split('.')[0]?.toLowerCase();
    if (
      brand &&
      brand.length >= 3 &&
      !['www', 'wd1', 'wd2', 'myworkdayjobs', 'workdayjobs'].includes(brand)
    ) {
      tokens.add(brand);
    }
  }
  return [...tokens].filter((t) => t.length >= 2).slice(0, 6);
}

async function searchRobotsByQuery(
  q: string,
  limit = 20
): Promise<Array<{ metaId: string; name: string; url: string }>> {
  const tokens = robotSearchTokens(q);
  if (!tokens.length) return [];
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const orClauses = tokens.flatMap((token) => {
    const re = new RegExp(escape(token), 'i');
    return [{ 'recording_meta.name': re }, { 'recording_meta.url': re }];
  });

  const opsOwner = getScoutXOpsUserId();
  const ownerFilter = ownerIdFilter(opsOwner);
  const projection = { recording_meta: 1 };
  const capped = Math.min(40, Math.max(1, limit));

  let rows = await Robot.find({ ...ownerFilter, $or: orClauses })
    .select(projection)
    .limit(capped)
    .lean();
  if (!rows.length) {
    rows = await Robot.find({ $or: orClauses }).select(projection).limit(capped).lean();
  }

  const seen = new Set<string>();
  const out: Array<{ metaId: string; name: string; url: string }> = [];
  for (const r of rows) {
    const metaId = String((r as any)?.recording_meta?.id || '').trim();
    if (!metaId || seen.has(metaId)) continue;
    seen.add(metaId);
    out.push({
      metaId,
      name: String((r as any)?.recording_meta?.name || ''),
      url: String((r as any)?.recording_meta?.url || ''),
    });
    if (out.length >= limit) break;
  }
  return out;
}

function serializeClusterOps(doc: any) {
  const base = serializeCluster(doc);
  const json = typeof doc.toJSON === 'function' ? doc.toJSON() : doc;
  return {
    ...base,
    requestId: json.requestId ? String(json.requestId) : null,
    createdBy: json.createdBy || null,
    publishedAt: json.publishedAt ? new Date(json.publishedAt).toISOString() : null,
    createdAt: json.createdAt ? new Date(json.createdAt).toISOString() : null,
    updatedAt: json.updatedAt ? new Date(json.updatedAt).toISOString() : null,
  };
}

function actorFromReq(req: Request): string {
  const u = (req as any).user;
  if (u?.email) return String(u.email);
  if (u?.id) return String(u.id);
  return 'ops';
}

async function recordActivity(
  clusterId: mongoose.Types.ObjectId | string,
  action: ClusterActivityAction,
  actor: string,
  detail?: string | null
) {
  try {
    await ClusterActivity.create({
      clusterId,
      action,
      actor,
      detail: detail || null,
      at: new Date(),
    });
  } catch (err: any) {
    logger.log('warn', `cluster activity write failed: ${err?.message || err}`);
  }
}

function serializeRequestRow(r: any) {
  return {
    id: String(r._id || r.id),
    auth0Sub: r.auth0Sub,
    type: r.type,
    title: r.title,
    industries: r.industries || [],
    locations: r.locations || [],
    roles: r.roles || [],
    experienceLevels: r.experienceLevels || [],
    experienceMin: r.experienceMin,
    experienceMax: r.experienceMax,
    companies: r.companies || [],
    urls: r.urls || [],
    notes: r.notes,
    status: r.status,
    submittedAt: r.submittedAt,
    resultClusterId: r.resultClusterId ? String(r.resultClusterId) : null,
    adminNotes: r.adminNotes,
    urlRobotOverrides: Array.isArray(r.urlRobotOverrides)
      ? r.urlRobotOverrides.map((o: any) => ({
          url: String(o.url || ''),
          robotMetaId: String(o.robotMetaId || ''),
        }))
      : [],
  };
}

/** Ops overview for the user-dashboard / cluster product (no subscription billing). */
router.get('/cluster-studio/overview', async (_req: Request, res: Response) => {
  try {
    const [
      portalUsers,
      publishedClusters,
      draftClusters,
      requestOpen,
      requestPublished,
      requestRejected,
      activeSubs,
      pausedSubs,
      savedJobs,
      recentRequests,
    ] = await Promise.all([
      PortalUser.countDocuments({}),
      Cluster.countDocuments({ status: 'published' }),
      Cluster.countDocuments({ status: 'draft' }),
      ClusterRequest.countDocuments({ status: { $in: ['submitted', 'in_review'] } }),
      ClusterRequest.countDocuments({ status: 'published' }),
      ClusterRequest.countDocuments({ status: 'rejected' }),
      ClusterSubscription.countDocuments({ status: 'active' }),
      ClusterSubscription.countDocuments({ status: 'paused' }),
      SavedJob.countDocuments({}),
      ClusterRequest.find({})
        .sort({ submittedAt: -1 })
        .limit(5)
        .select('title status type submittedAt auth0Sub')
        .lean(),
    ]);

    return res.json({
      generatedAt: new Date().toISOString(),
      totals: {
        portalUsers,
        publishedClusters,
        draftClusters,
        openRequests: requestOpen,
        publishedRequests: requestPublished,
        rejectedRequests: requestRejected,
        activeSubscriptions: activeSubs,
        pausedSubscriptions: pausedSubs,
        savedJobs,
      },
      recentRequests: recentRequests.map((r) => ({
        id: String(r._id),
        title: r.title,
        status: r.status,
        type: r.type,
        submittedAt: r.submittedAt,
        auth0Sub: r.auth0Sub,
      })),
    });
  } catch (err: any) {
    logger.log('error', `cluster-studio overview: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to load cluster studio overview' });
  }
});

router.get('/cluster-studio/requests', async (req: Request, res: Response) => {
  try {
    const status = String(req.query.status || '').trim();
    const filter: Record<string, any> = {};
    if (status) filter.status = status;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const [total, rows] = await Promise.all([
      ClusterRequest.countDocuments(filter),
      ClusterRequest.find(filter).sort({ submittedAt: -1 }).skip(skip).limit(limit).lean(),
    ]);

    return res.json({
      total,
      page,
      limit,
      requests: rows.map(serializeRequestRow),
    });
  } catch (err: any) {
    logger.log('error', `cluster-studio requests list: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to list cluster requests' });
  }
});

router.patch('/cluster-studio/requests/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'Invalid id' });

    const doc = await ClusterRequest.findById(id);
    if (!doc) return res.status(404).json({ error: 'Request not found' });

    const status = req.body?.status;
    if (status && ['submitted', 'in_review', 'published', 'rejected'].includes(status)) {
      doc.status = status;
    }
    if (req.body?.adminNotes != null) doc.adminNotes = String(req.body.adminNotes);
    if (req.body?.resultClusterId) {
      if (!mongoose.isValidObjectId(req.body.resultClusterId)) {
        return res.status(400).json({ error: 'Invalid resultClusterId' });
      }
      doc.resultClusterId = req.body.resultClusterId;
    }
    await doc.save();
    return res.json({ id: String(doc._id), status: doc.status, adminNotes: doc.adminNotes });
  } catch (err: any) {
    logger.log('error', `cluster-studio request patch: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to update request' });
  }
});

/** Create a draft cluster from a portal request (preferred fulfill path). */
router.post('/cluster-studio/requests/:id/create-draft', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'Invalid id' });
    const request = await ClusterRequest.findById(id);
    if (!request) return res.status(404).json({ error: 'Request not found' });

    if (request.resultClusterId) {
      const existing = await Cluster.findById(request.resultClusterId);
      if (existing) {
        return res.json({
          cluster: serializeClusterOps(existing),
          request: serializeRequestRow(request),
          reused: true,
        });
      }
    }

    const kind = request.type === 'custom_urls' ? 'custom' : 'curated';
    const filter = requestToClusterFilter(request);

    let slug = slugify(request.title);
    if (!slug) slug = `request-${Date.now().toString(36)}`;
    if (await Cluster.findOne({ slug }).lean()) slug = `${slug}-${Date.now().toString(36)}`;

    const cluster = await Cluster.create({
      slug,
      name: request.title,
      description: request.notes || `From request ${id}`,
      kind,
      status: 'draft',
      filtersSummary: buildFiltersSummary({ filter, kind }),
      filter,
      sourceBinding:
        kind === 'custom'
          ? { mode: 'source', sources: request.urls || [], companyNames: request.companies || [], companyIds: [], robotMetaIds: [] }
          : { mode: 'filter', sources: [], companyNames: [], companyIds: [], robotMetaIds: [] },
      createdBy: actorFromReq(req),
      requestId: request._id,
      jobCountPreview: 0,
    });

    try {
      cluster.jobCountPreview = await countJobsForCluster(cluster);
      await cluster.save();
    } catch {
      /* best-effort */
    }

    request.status = 'in_review';
    request.resultClusterId = cluster._id as any;
    await request.save();

    await recordActivity(
      cluster._id,
      'fulfilled_from_request',
      actorFromReq(req),
      `Draft from request ${id}`
    );
    await recordActivity(cluster._id, 'created', actorFromReq(req), 'Created from portal request');

    return res.status(201).json({
      cluster: serializeClusterOps(cluster),
      request: serializeRequestRow(request),
      reused: false,
    });
  } catch (err: any) {
    logger.log('error', `cluster-studio create-draft: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to create draft from request' });
  }
});

/** Server-side automation search for triage manual link (ops owner first, capped). */
router.get('/cluster-studio/robots/search', async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) {
      return res.json({ robots: [], q, hint: 'Type at least 2 characters' });
    }
    const limit = Math.min(25, Math.max(1, Number(req.query.limit) || 15));
    const robots = await searchRobotsByQuery(q, limit);
    return res.json({ robots, q, limit });
  } catch (err: any) {
    logger.log('error', `cluster-studio robots search: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to search automations' });
  }
});

/**
 * Manually link a request career URL to an existing automation when host auto-match fails
 * (e.g. truist.wd1.myworkdayjobs.com → careers.truist.com).
 */
router.post('/cluster-studio/requests/:id/link-robot', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'Invalid id' });
    const request = await ClusterRequest.findById(id);
    if (!request) return res.status(404).json({ error: 'Request not found' });

    const url = String(req.body?.url || '').trim();
    const robotMetaId = String(req.body?.robotMetaId || '').trim();
    if (!url || !robotMetaId) {
      return res.status(400).json({ error: 'url and robotMetaId are required' });
    }
    if (!request.urls?.some((u: string) => String(u).trim() === url)) {
      return res.status(400).json({ error: 'url is not on this request' });
    }

    const robot = await findRobotByMetaId(robotMetaId);
    if (!robot) return res.status(404).json({ error: 'Automation not found' });

    const overrides = Array.isArray((request as any).urlRobotOverrides)
      ? [...(request as any).urlRobotOverrides]
      : [];
    const key = normalizeOverrideUrlKey(url);
    const next = overrides.filter(
      (o: any) => normalizeOverrideUrlKey(String(o?.url || '')) !== key
    );
    next.push({ url, robotMetaId });
    (request as any).urlRobotOverrides = next;
    if (request.status === 'submitted') request.status = 'in_review';
    await request.save();

    // Ensure draft cluster exists and bind the robot metaId
    let cluster =
      request.resultClusterId ? await Cluster.findById(request.resultClusterId) : null;
    if (!cluster) {
      const filter = requestToClusterFilter(request);
      let slug = slugify(request.title) || `request-${Date.now().toString(36)}`;
      if (await Cluster.findOne({ slug }).lean()) slug = `${slug}-${Date.now().toString(36)}`;
      cluster = await Cluster.create({
        slug,
        name: request.title,
        description: request.notes || `From request ${id}`,
        kind: 'custom',
        status: 'draft',
        filtersSummary: buildFiltersSummary({ filter, kind: 'custom' }),
        filter,
        sourceBinding: {
          mode: 'source',
          sources: request.urls || [],
          companyNames: request.companies || [],
          robotMetaIds: [robotMetaId],
        },
        createdBy: actorFromReq(req),
        requestId: request._id,
        jobCountPreview: 0,
      });
      request.resultClusterId = cluster._id as any;
      await request.save();
    } else {
      const metaIds = [...(cluster.sourceBinding?.robotMetaIds || [])];
      if (!metaIds.includes(robotMetaId)) metaIds.push(robotMetaId);
      const sources = [...new Set([...(cluster.sourceBinding?.sources || []), ...((request.urls as string[]) || [])])];
      cluster.kind = 'custom';
      cluster.sourceBinding = {
        mode: 'source',
        sources,
        companyNames: [...(cluster.sourceBinding?.companyNames || []), ...(request.companies || [])],
        robotMetaIds: [...new Set(metaIds)],
      } as any;
      cluster.filtersSummary = buildFiltersSummary(cluster);
      await cluster.save();
    }

    await recordActivity(
      cluster._id,
      'sources_bound',
      actorFromReq(req),
      `Manual link ${url} → ${robotMetaId}`
    );

    return res.json({
      request: serializeRequestRow(request),
      cluster: serializeClusterOps(cluster),
      linked: {
        url,
        robotMetaId,
        name: String((robot as any).recording_meta?.name || ''),
        robotUrl: String((robot as any).recording_meta?.url || ''),
      },
    });
  } catch (err: any) {
    logger.log('error', `cluster-studio link-robot: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to link automation' });
  }
});

router.get('/cluster-studio/requests/:id/coverage', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'Invalid id' });
    const request = await ClusterRequest.findById(id).lean();
    if (!request) return res.status(404).json({ error: 'Request not found' });

    const filter = requestToClusterFilter(request);
    const urls = Array.isArray(request.urls) ? request.urls.map((u: string) => String(u).trim()).filter(Boolean) : [];
    const ownerId = getPortalJobBoardOwnerId();
    const baseMatch = boardMatch(ownerId);

    const urlRows = [];
    for (const url of urls) {
      let normalizedUrl = url;
      try {
        normalizedUrl = normalizeAutomationUrl(url);
      } catch {
        /* keep raw */
      }
      const lookup = await resolveCareerRobotForRequestUrl(
        url,
        (request as any).urlRobotOverrides
      );
      const robot = lookup?.robot || null;
      const metaId = robot ? String((robot as any).recording_meta?.id || '') : '';
      let lastRunAt: string | null = null;
      let lastRunStatus: string | null = null;
      let jobsTotal = 0;
      let jobsMatching = 0;
      let status: 'missing_automation' | 'never_run' | 'no_matching_jobs' | 'ready' =
        'missing_automation';

      if (robot && metaId) {
        const lastRun = await Run.findOne({ robotMetaId: metaId })
          .sort({ sortAt: -1, startedAt: -1 })
          .select('status finishedAt startedAt sortAt')
          .lean();
        if (lastRun) {
          lastRunAt = lastRun.finishedAt || lastRun.startedAt || null;
          lastRunStatus = String(lastRun.status || '');
        }

        jobsTotal = await JobBoardListing.countDocuments({
          ...baseMatch,
          robotMetaIds: metaId,
        });

        const matchingMatch = applyFrozenClusterFilters(
          { ...baseMatch, robotMetaIds: metaId },
          {
            frozenIndustries: filter.frozenIndustries,
            frozenCategories: filter.frozenCategories,
            frozenExperienceLevels: filter.frozenExperienceLevels,
            frozenExperienceYears: filter.frozenExperienceYears,
            frozenStates: filter.frozenStates,
            locationIsRemote: filter.locationIsRemote,
            excludeStudentEscape: filter.excludeStudentEscape,
            companyNames: [],
            h1bSponsorFriendly: filter.h1bSponsorFriendly,
            robotMetaIds: [metaId],
          }
        );
        jobsMatching = await JobBoardListing.countDocuments(matchingMatch);

        if (!lastRun) status = 'never_run';
        else if (jobsMatching <= 0) status = 'no_matching_jobs';
        else status = 'ready';
      }

      urlRows.push({
        url,
        normalizedUrl,
        requestedHadSiteFilters: lookup?.requestedHadSiteFilters ?? hasCareerSiteFilters(normalizedUrl),
        matchKind: lookup?.matchKind ?? null,
        reuseNote: lookup?.reuseNote ?? null,
        robot: robot
          ? {
              metaId,
              name: String((robot as any).recording_meta?.name || ''),
              url: String((robot as any).recording_meta?.url || lookup?.robotUrl || ''),
              reused: true,
              matchKind: lookup?.matchKind ?? 'exact',
            }
          : null,
        lastRunAt,
        lastRunStatus,
        jobsTotal,
        jobsMatching,
        status,
      });
    }

    const readyCount = urlRows.filter((r) => r.status === 'ready').length;
    const allReady = urls.length > 0 && readyCount === urls.length;
    const hostReuseCount = urlRows.filter(
      (r) => r.matchKind === 'host' || r.matchKind === 'root'
    ).length;

    return res.json({
      request: serializeRequestRow(request),
      filter,
      urls: urlRows,
      summary: {
        totalUrls: urls.length,
        readyCount,
        missingAutomation: urlRows.filter((r) => r.status === 'missing_automation').length,
        neverRun: urlRows.filter((r) => r.status === 'never_run').length,
        noMatchingJobs: urlRows.filter((r) => r.status === 'no_matching_jobs').length,
        allReady,
        jobsMatchingTotal: urlRows.reduce((sum, r) => sum + r.jobsMatching, 0),
        hostReuseCount,
      },
    });
  } catch (err: any) {
    logger.log('error', `cluster-studio request coverage: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to compute request coverage' });
  }
});

/**
 * One-click fulfill: ensure draft, bind/reuse robots for every URL, publish when ready.
 * Body: { allowEmpty?: boolean, requireAllReady?: boolean }
 */
router.post('/cluster-studio/requests/:id/make-cluster', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'Invalid id' });
    const request = await ClusterRequest.findById(id);
    if (!request) return res.status(404).json({ error: 'Request not found' });

    const allowEmpty = Boolean(req.body?.allowEmpty);
    const requireAllReady = req.body?.requireAllReady !== false;

    // Ensure draft exists
    let cluster =
      request.resultClusterId ? await Cluster.findById(request.resultClusterId) : null;
    if (!cluster) {
      const filter = requestToClusterFilter(request);
      const kind = request.type === 'custom_urls' ? 'custom' : 'curated';
      let slug = slugify(request.title) || `request-${Date.now().toString(36)}`;
      if (await Cluster.findOne({ slug }).lean()) slug = `${slug}-${Date.now().toString(36)}`;
      cluster = await Cluster.create({
        slug,
        name: request.title,
        description: request.notes || `From request ${id}`,
        kind,
        status: 'draft',
        filtersSummary: buildFiltersSummary({ filter, kind }),
        filter,
        sourceBinding:
          kind === 'custom'
            ? {
                mode: 'source',
                sources: request.urls || [],
                companyNames: request.companies || [],
                robotMetaIds: [],
              }
            : { mode: 'filter', sources: [], companyNames: [], companyIds: [], robotMetaIds: [] },
        createdBy: actorFromReq(req),
        requestId: request._id,
        jobCountPreview: 0,
      });
      request.status = 'in_review';
      request.resultClusterId = cluster._id as any;
      await request.save();
    } else {
      // Refresh filter mapping from latest request fields
      cluster.filter = requestToClusterFilter(request) as any;
      cluster.filtersSummary = buildFiltersSummary(cluster);
    }

    const urls = (request.urls || []).map((u: string) => String(u).trim()).filter(Boolean);
    const robotMetaIds: string[] = [...(cluster.sourceBinding?.robotMetaIds || [])];
    const companyNames: string[] = [
      ...(cluster.sourceBinding?.companyNames || []),
      ...(request.companies || []),
    ];
    const createdRobots: { metaId: string; url: string; name: string; reused: boolean }[] = [];
    const missing: string[] = [];

    if (request.type === 'custom_urls') {
      const ownerId = normalizeOwnerIdForWrite(getScoutXOpsUserId());
      const overrides = (request as any).urlRobotOverrides || [];
      for (const url of urls) {
        const lookup = await resolveCareerRobotForRequestUrl(url, overrides);
        if (lookup?.robot) {
          const metaId = String((lookup.robot as any).recording_meta?.id || '');
          if (metaId && !robotMetaIds.includes(metaId)) robotMetaIds.push(metaId);
          createdRobots.push({
            metaId,
            url: lookup.robotUrl || url,
            name: String((lookup.robot as any).recording_meta?.name || ''),
            reused: true,
          });
          continue;
        }
        missing.push(url);
        let hostname = 'company';
        try {
          hostname = new URL(url).hostname.replace(/^www\./, '');
        } catch {
          continue;
        }
        let normalized = url;
        try {
          // Strip career-page query filters when creating a new board robot —
          // cluster tags do the narrowing; avoids duplicate filtered scrapes.
          normalized = careerBoardUrlForStorage(url);
        } catch {
          /* keep */
        }
        // Re-check after stripping filters (another robot may match the root)
        const afterStrip = await findRobotByCareerUrl(normalized);
        if (afterStrip?.robot) {
          const metaId = String((afterStrip.robot as any).recording_meta?.id || '');
          if (metaId && !robotMetaIds.includes(metaId)) robotMetaIds.push(metaId);
          createdRobots.push({
            metaId,
            url: afterStrip.robotUrl || normalized,
            name: String((afterStrip.robot as any).recording_meta?.name || ''),
            reused: true,
          });
          continue;
        }
        const metaId = uuidv4();
        const name = `Cluster: ${cluster.name} — ${hostname}`;
        try {
          await Robot.create({
            userId: ownerId,
            recording_meta: {
              id: metaId,
              name,
              url: normalized,
              createdAt: new Date().toLocaleString(),
              pairs: 0,
              params: [],
              type: 'saas',
              saasConfig: {
                listExtraction: {
                  enabled: true,
                  maxPages: 10,
                },
              },
            },
            recording: { workflow: [] },
          });
          robotMetaIds.push(metaId);
          createdRobots.push({ metaId, url: normalized, name, reused: false });
          if (!companyNames.includes(hostname)) companyNames.push(hostname);
        } catch (err: any) {
          logger.log('warn', `make-cluster robot create failed for ${url}: ${err?.message || err}`);
        }
      }

      cluster.kind = 'custom';
      cluster.sourceBinding = {
        mode: 'source',
        sources: [...new Set(urls)],
        companyNames: [...new Set(companyNames)],
        robotMetaIds: [...new Set(robotMetaIds)],
      } as any;
    }

    try {
      cluster.jobCountPreview = await countJobsForCluster(cluster);
    } catch {
      /* ignore */
    }
    await cluster.save();

    if (requireAllReady && request.type === 'custom_urls') {
      // Recompute readiness: each URL must have a robot with matching jobs
      const ownerBoard = getPortalJobBoardOwnerId();
      const base = boardMatch(ownerBoard);
      const notReady: string[] = [];
      for (const row of createdRobots) {
        if (!row.metaId) {
          notReady.push(row.url);
          continue;
        }
        const matchingMatch = applyFrozenClusterFilters(
          { ...base },
          {
            ...requestToClusterFilter(request),
            companyNames: [],
            robotMetaIds: [row.metaId],
          }
        );
        const count = await JobBoardListing.countDocuments(matchingMatch);
        if (count <= 0) notReady.push(row.url);
      }
      if (notReady.length && !allowEmpty) {
        return res.status(409).json({
          error:
            'Not all URLs are ready — some automations are missing, have never run, or have no matching jobs yet',
          code: 'cluster.coverage_incomplete',
          notReady,
          missingCreated: missing,
          cluster: serializeClusterOps(cluster),
          request: serializeRequestRow(request),
          createdRobots,
          jobCountPreview: cluster.jobCountPreview,
        });
      }
    }

    if (cluster.kind === 'custom' && !customHasSources(cluster.sourceBinding as any)) {
      return res.status(400).json({
        error: 'Custom clusters need at least one bound automation before publish',
        code: 'cluster.empty_sources',
        cluster: serializeClusterOps(cluster),
      });
    }

    if (!allowEmpty && (cluster.jobCountPreview || 0) <= 0) {
      return res.status(409).json({
        error: 'Cluster would publish with 0 matching jobs. Confirm to force, or wait for runs/tagging.',
        code: 'cluster.empty_preview',
        cluster: serializeClusterOps(cluster),
        request: serializeRequestRow(request),
        createdRobots,
        jobCountPreview: 0,
      });
    }

    cluster.status = 'published';
    cluster.publishedAt = cluster.publishedAt || new Date();
    await cluster.save();
    await fulfillLinkedRequest(cluster);
    await recordActivity(cluster._id, 'published', actorFromReq(req), `Make cluster from request ${id}`);

    const refreshed = await ClusterRequest.findById(id);
    return res.json({
      cluster: serializeClusterOps(cluster),
      request: serializeRequestRow(refreshed || request),
      createdRobots,
      jobCountPreview: cluster.jobCountPreview,
    });
  } catch (err: any) {
    logger.log('error', `cluster-studio make-cluster: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to make cluster from request' });
  }
});

router.get('/cluster-studio/clusters', async (req: Request, res: Response) => {
  try {
    const status = String(req.query.status || '').trim();
    const filter: Record<string, any> = {};
    if (status) filter.status = status;
    const rows = await Cluster.find(filter).sort({ updatedAt: -1 }).lean();
    return res.json({
      clusters: rows.map((c) => serializeClusterOps({ ...c, id: c._id })),
    });
  } catch (err: any) {
    logger.log('error', `cluster-studio clusters list: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to list clusters' });
  }
});

router.post('/cluster-studio/clusters', async (req: Request, res: Response) => {
  try {
    const body = req.body || {};
    const name = String(body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'name is required' });

    let slug = slugify(body.slug || name);
    if (!slug) slug = `cluster-${Date.now()}`;
    const existing = await Cluster.findOne({ slug }).lean();
    if (existing) slug = `${slug}-${Date.now().toString(36)}`;

    const filter = normalizeFilter(body.filter);
    const kind = body.kind === 'custom' ? 'custom' : 'curated';
    const sourceBinding = {
      mode: body.sourceBinding?.mode === 'source' ? 'source' : 'filter',
      sources: Array.isArray(body.sourceBinding?.sources)
        ? body.sourceBinding.sources.map((s: unknown) => String(s).trim()).filter(Boolean)
        : [],
      companyNames: Array.isArray(body.sourceBinding?.companyNames)
        ? body.sourceBinding.companyNames.map((s: unknown) => String(s).trim()).filter(Boolean)
        : [],
      robotMetaIds: Array.isArray(body.sourceBinding?.robotMetaIds)
        ? body.sourceBinding.robotMetaIds.map((s: unknown) => String(s).trim()).filter(Boolean)
        : [],
    };

    if (body.status === 'published' && kind === 'curated' && !curatedHasFilters(filter)) {
      return res.status(400).json({
        error: 'Curated clusters need at least one filter before publish',
        code: 'cluster.empty_filters',
      });
    }

    const cluster = await Cluster.create({
      slug,
      name,
      description: String(body.description || '').trim(),
      kind,
      status: body.status === 'published' ? 'published' : 'draft',
      coverImage: body.coverImage || null,
      companyLogos: Array.isArray(body.companyLogos)
        ? body.companyLogos.map((x: unknown) => String(x).trim()).filter(Boolean)
        : [],
      filtersSummary:
        Array.isArray(body.filtersSummary) && body.filtersSummary.length
          ? body.filtersSummary
          : buildFiltersSummary({ filter, kind }),
      filter,
      sourceBinding,
      createdBy: actorFromReq(req),
      requestId: body.requestId && mongoose.isValidObjectId(body.requestId) ? body.requestId : null,
      publishedAt: body.status === 'published' ? new Date() : null,
      jobCountPreview: 0,
    });

    try {
      cluster.jobCountPreview = await countJobsForCluster(cluster);
      await cluster.save();
    } catch {
      /* preview count is best-effort */
    }

    await recordActivity(cluster._id, 'created', actorFromReq(req), `Created ${kind} cluster`);

    return res.status(201).json(serializeClusterOps(cluster));
  } catch (err: any) {
    logger.log('error', `cluster-studio cluster create: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to create cluster' });
  }
});

router.get('/cluster-studio/clusters/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'Invalid id' });
    const cluster = await Cluster.findById(id);
    if (!cluster) return res.status(404).json({ error: 'Cluster not found' });

    let request: ReturnType<typeof serializeRequestRow> | null = null;
    if (cluster.requestId) {
      const reqDoc = await ClusterRequest.findById(cluster.requestId).lean();
      if (reqDoc) request = serializeRequestRow(reqDoc);
    }

    const robotMetaIds = cluster.sourceBinding?.robotMetaIds || [];
    let robots: Array<{ metaId: string; name: string; url: string }> = [];
    if (robotMetaIds.length) {
      const rows = await Robot.find({ 'recording_meta.id': { $in: robotMetaIds } })
        .select('recording_meta')
        .lean();
      robots = rows.map((r: any) => ({
        metaId: String(r.recording_meta?.id || ''),
        name: String(r.recording_meta?.name || ''),
        url: String(r.recording_meta?.url || ''),
      }));
    }

    const activeSubscriptions = await ClusterSubscription.countDocuments({
      clusterId: cluster._id,
      status: 'active',
    });

    return res.json({
      cluster: serializeClusterOps(cluster),
      request,
      robots,
      activeSubscriptions,
    });
  } catch (err: any) {
    logger.log('error', `cluster-studio cluster get: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to load cluster' });
  }
});

router.get('/cluster-studio/clusters/:id/sample-jobs', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'Invalid id' });
    const cluster = await Cluster.findById(id);
    if (!cluster) return res.status(404).json({ error: 'Cluster not found' });
    const limit = Math.min(24, Math.max(1, Number(req.query.limit) || 8));
    const jobs = await sampleJobsForCluster(cluster, limit);
    return res.json({ jobs, limit });
  } catch (err: any) {
    logger.log('error', `cluster-studio sample-jobs: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to sample jobs' });
  }
});

router.get('/cluster-studio/clusters/:id/activity', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'Invalid id' });
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40));
    const rows = await ClusterActivity.find({ clusterId: id }).sort({ at: -1 }).limit(limit).lean();
    return res.json({
      activity: rows.map((r) => ({
        id: String(r._id),
        clusterId: String(r.clusterId),
        at: r.at,
        actor: r.actor,
        action: r.action,
        detail: r.detail,
      })),
    });
  } catch (err: any) {
    logger.log('error', `cluster-studio activity: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to load activity' });
  }
});

router.post('/cluster-studio/clusters/:id/preview-count', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'Invalid id' });
    const cluster = await Cluster.findById(id);
    if (!cluster) return res.status(404).json({ error: 'Cluster not found' });

    const includeSamples = req.body?.includeSamples !== false;
    const limit = Math.min(24, Math.max(1, Number(req.body?.limit) || 8));
    const count = await countJobsForCluster(cluster);
    cluster.jobCountPreview = count;
    await cluster.save();

    let jobs: unknown[] = [];
    if (includeSamples) {
      jobs = await sampleJobsForCluster(cluster, limit);
    }

    await recordActivity(cluster._id, 'preview_refreshed', actorFromReq(req), `Count ${count}`);

    return res.json({
      jobCountPreview: count,
      jobs,
      cluster: serializeClusterOps(cluster),
    });
  } catch (err: any) {
    logger.log('error', `cluster-studio preview-count: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to refresh preview count' });
  }
});

router.patch('/cluster-studio/clusters/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'Invalid id' });
    const cluster = await Cluster.findById(id);
    if (!cluster) return res.status(404).json({ error: 'Cluster not found' });

    const body = req.body || {};
    if (body.name != null) cluster.name = String(body.name).trim();
    if (body.description != null) cluster.description = String(body.description).trim();
    if (body.coverImage !== undefined) cluster.coverImage = body.coverImage || null;
    if (body.slug != null) {
      const nextSlug = slugify(body.slug);
      if (nextSlug && nextSlug !== cluster.slug) {
        const clash = await Cluster.findOne({ slug: nextSlug, _id: { $ne: cluster._id } });
        if (clash) return res.status(409).json({ error: 'Slug already in use' });
        cluster.slug = nextSlug;
      }
    }
    if (body.kind === 'curated' || body.kind === 'custom') cluster.kind = body.kind;
    if (body.filter) cluster.filter = normalizeFilter(body.filter) as any;
    if (body.sourceBinding) {
      cluster.sourceBinding = {
        mode:
          body.sourceBinding.mode === 'source' || body.sourceBinding.mode === 'filter'
            ? body.sourceBinding.mode
            : resolveSourceMode(cluster.kind),
        sources: Array.isArray(body.sourceBinding.sources) ? body.sourceBinding.sources : [],
        companyNames: Array.isArray(body.sourceBinding.companyNames)
          ? body.sourceBinding.companyNames
          : [],
        robotMetaIds: Array.isArray(body.sourceBinding.robotMetaIds)
          ? body.sourceBinding.robotMetaIds
          : [],
      } as any;
    } else if (body.kind === 'curated' || body.kind === 'custom') {
      if (!cluster.sourceBinding) cluster.sourceBinding = {} as any;
      (cluster.sourceBinding as any).mode = resolveSourceMode(cluster.kind);
    }
    if (Array.isArray(body.companyLogos)) cluster.companyLogos = body.companyLogos;

    // Always rebuild chips from current filter (ignore client filtersSummary).
    cluster.filtersSummary = buildFiltersSummary(cluster);

    const nextStatus =
      body.status && ['draft', 'published', 'archived'].includes(body.status)
        ? body.status
        : cluster.status;
    if (nextStatus === 'published') {
      const filter = normalizeFilter(cluster.filter);
      if (cluster.kind === 'curated' && !curatedHasFilters(filter)) {
        return res.status(400).json({
          error: 'Curated clusters need at least one filter before publish',
          code: 'cluster.empty_filters',
        });
      }
      if (cluster.kind === 'custom' && !customHasSources(cluster.sourceBinding as any)) {
        return res.status(400).json({
          error: 'Custom clusters need at least one bound automation (robot) before publish',
          code: 'cluster.empty_sources',
        });
      }
    }
    if (body.status && ['draft', 'published', 'archived'].includes(body.status)) {
      cluster.status = body.status;
      if (body.status === 'published' && !cluster.publishedAt) cluster.publishedAt = new Date();
    }

    const shouldRefresh = body.refreshCount !== false;
    if (shouldRefresh) {
      try {
        cluster.jobCountPreview = await countJobsForCluster(cluster);
      } catch {
        /* ignore */
      }
    }

    await cluster.save();
    await recordActivity(cluster._id, 'updated', actorFromReq(req), 'Cluster fields updated');
    return res.json(serializeClusterOps(cluster));
  } catch (err: any) {
    logger.log('error', `cluster-studio cluster patch: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to update cluster' });
  }
});

async function fulfillLinkedRequest(cluster: any) {
  if (!cluster.requestId) return;
  const request = await ClusterRequest.findById(cluster.requestId);
  if (!request) return;
  request.status = 'published';
  request.resultClusterId = cluster._id as any;
  await request.save();

  const portalUser = await PortalUser.findOne({ auth0Sub: request.auth0Sub }).lean();
  const slots = portalUser
    ? resolveSubscribedSlots({
        plan: portalUser.firstStepPlan,
        adminClusterLimit: portalUser.adminClusterLimit,
        clusterServiceOptOut: (portalUser as any).clusterServiceOptOut,
        clusterServiceStartedAt: portalUser.clusterServiceStartedAt,
      })
    : null;
  if (!slots?.subscriptionOn) {
    // Publish without activating — subscription must be on first.
    return;
  }

  const existing = await ClusterSubscription.findOne({
    auth0Sub: request.auth0Sub,
    clusterId: cluster._id,
  });
  if (!existing) {
    await ClusterSubscription.create({
      auth0Sub: request.auth0Sub,
      clusterId: cluster._id,
      window: '24h',
      status: 'active',
      source: 'request_fulfillment',
    });
  } else if (existing.status !== 'active') {
    existing.status = 'active';
    existing.source = existing.source || 'request_fulfillment';
    await existing.save();
  } else if (!existing.source || existing.source === 'self_serve') {
    // Legacy rows from request publish — mark as purchased/assigned extra.
    existing.source = 'request_fulfillment';
    await existing.save();
  }
}

router.post('/cluster-studio/clusters/:id/publish', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'Invalid id' });
    const cluster = await Cluster.findById(id);
    if (!cluster) return res.status(404).json({ error: 'Cluster not found' });

    const filter = normalizeFilter(cluster.filter);
    if (cluster.kind === 'curated' && !curatedHasFilters(filter)) {
      return res.status(400).json({
        error: 'Curated clusters need at least one filter before publish',
        code: 'cluster.empty_filters',
      });
    }
    if (cluster.kind === 'custom' && !customHasSources(cluster.sourceBinding as any)) {
      return res.status(400).json({
        error: 'Custom clusters need at least one bound automation (robot) before publish',
        code: 'cluster.empty_sources',
      });
    }
    if (cluster.sourceBinding) {
      (cluster.sourceBinding as any).mode = resolveSourceMode(cluster.kind);
    }

    cluster.status = 'published';
    cluster.publishedAt = new Date();
    try {
      cluster.jobCountPreview = await countJobsForCluster(cluster);
    } catch {
      /* ignore */
    }
    await cluster.save();

    await fulfillLinkedRequest(cluster);

    const requestId = req.body?.requestId;
    if (requestId && mongoose.isValidObjectId(requestId) && !cluster.requestId) {
      cluster.requestId = requestId;
      await cluster.save();
      await fulfillLinkedRequest(cluster);
    }

    await recordActivity(cluster._id, 'published', actorFromReq(req), 'Published to portal browse');
    return res.json(serializeClusterOps(cluster));
  } catch (err: any) {
    logger.log('error', `cluster-studio publish: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to publish cluster' });
  }
});

router.post('/cluster-studio/clusters/:id/unpublish', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'Invalid id' });
    const cluster = await Cluster.findById(id);
    if (!cluster) return res.status(404).json({ error: 'Cluster not found' });
    cluster.status = 'draft';
    await cluster.save();
    await recordActivity(cluster._id, 'unpublished', actorFromReq(req), 'Unpublished to draft');
    return res.json(serializeClusterOps(cluster));
  } catch (err: any) {
    logger.log('error', `cluster-studio unpublish: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to unpublish cluster' });
  }
});

router.post('/cluster-studio/clusters/:id/archive', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'Invalid id' });
    const cluster = await Cluster.findById(id);
    if (!cluster) return res.status(404).json({ error: 'Cluster not found' });
    cluster.status = 'archived';
    await cluster.save();
    await recordActivity(cluster._id, 'archived', actorFromReq(req));
    return res.json(serializeClusterOps(cluster));
  } catch (err: any) {
    logger.log('error', `cluster-studio archive: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to archive cluster' });
  }
});

router.post('/cluster-studio/clusters/:id/restore', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'Invalid id' });
    const cluster = await Cluster.findById(id);
    if (!cluster) return res.status(404).json({ error: 'Cluster not found' });
    cluster.status = 'draft';
    await cluster.save();
    await recordActivity(cluster._id, 'restored', actorFromReq(req), 'Restored to draft');
    return res.json(serializeClusterOps(cluster));
  } catch (err: any) {
    logger.log('error', `cluster-studio restore: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to restore cluster' });
  }
});

router.post('/cluster-studio/clusters/:id/duplicate', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'Invalid id' });
    const source = await Cluster.findById(id);
    if (!source) return res.status(404).json({ error: 'Cluster not found' });

    let slug = `${source.slug}-copy`;
    if (await Cluster.findOne({ slug }).lean()) slug = `${slug}-${Date.now().toString(36)}`;

    const cluster = await Cluster.create({
      slug,
      name: `${source.name} (copy)`,
      description: source.description,
      kind: source.kind,
      status: 'draft',
      coverImage: source.coverImage,
      companyLogos: [...(source.companyLogos || [])],
      filtersSummary: [...(source.filtersSummary || [])],
      filter: source.filter,
      sourceBinding: {
        mode: source.sourceBinding?.mode || 'filter',
        sources: [...(source.sourceBinding?.sources || [])],
        companyNames: [...(source.sourceBinding?.companyNames || [])],
        robotMetaIds: [...(source.sourceBinding?.robotMetaIds || [])],
      },
      createdBy: actorFromReq(req),
      requestId: null,
      publishedAt: null,
      jobCountPreview: source.jobCountPreview || 0,
    });

    try {
      cluster.jobCountPreview = await countJobsForCluster(cluster);
      await cluster.save();
    } catch {
      /* ignore */
    }

    await recordActivity(cluster._id, 'duplicated', actorFromReq(req), `Copied from ${source.slug}`);
    await recordActivity(cluster._id, 'created', actorFromReq(req), 'Created via duplicate');

    return res.status(201).json(serializeClusterOps(cluster));
  } catch (err: any) {
    logger.log('error', `cluster-studio duplicate: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to duplicate cluster' });
  }
});

router.delete('/cluster-studio/clusters/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'Invalid id' });
    const cluster = await Cluster.findById(id);
    if (!cluster) return res.status(404).json({ error: 'Cluster not found' });

    if (!['draft', 'archived'].includes(cluster.status)) {
      return res.status(409).json({
        error: 'Only draft or archived clusters can be deleted. Unpublish or archive first.',
        code: 'cluster.delete_not_allowed',
      });
    }

    const activeSubs = await ClusterSubscription.countDocuments({
      clusterId: cluster._id,
      status: 'active',
    });
    if (activeSubs > 0) {
      return res.status(409).json({
        error: `Cannot delete: ${activeSubs} active subscription(s)`,
        code: 'cluster.has_active_subscriptions',
      });
    }

    await recordActivity(cluster._id, 'deleted', actorFromReq(req), cluster.slug);
    await Cluster.deleteOne({ _id: cluster._id });
    return res.status(204).send();
  } catch (err: any) {
    logger.log('error', `cluster-studio delete: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to delete cluster' });
  }
});

router.post('/cluster-studio/clusters/:id/bind-sources', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.isValidObjectId(id)) return res.status(400).json({ error: 'Invalid id' });
    const cluster = await Cluster.findById(id);
    if (!cluster) return res.status(404).json({ error: 'Cluster not found' });

    const body = req.body || {};
    const robotMetaIds = Array.isArray(body.robotMetaIds)
      ? body.robotMetaIds.map((x: unknown) => String(x).trim()).filter(Boolean)
      : [...(cluster.sourceBinding?.robotMetaIds || [])];
    const companyNames = Array.isArray(body.companyNames)
      ? body.companyNames.map((x: unknown) => String(x).trim()).filter(Boolean)
      : [...(cluster.sourceBinding?.companyNames || [])];
    const urls = Array.isArray(body.urls)
      ? body.urls.map((x: unknown) => String(x).trim()).filter(Boolean).slice(0, 10)
      : [];

    const createdRobots: {
      metaId: string;
      url: string;
      name: string;
      reused?: boolean;
      matchKind?: CareerRobotMatchKind;
      reuseNote?: string | null;
    }[] = [];
    const forceFilteredRobot = Boolean(body.forceFilteredRobot);
    if (body.createRobots && urls.length) {
      const ownerId = normalizeOwnerIdForWrite(getScoutXOpsUserId());
      for (const url of urls) {
        const lookup = await findRobotByCareerUrl(url);
        if (lookup?.robot && !(forceFilteredRobot && hasCareerSiteFilters(url))) {
          const metaId = String((lookup.robot as any).recording_meta?.id || '');
          if (metaId && !robotMetaIds.includes(metaId)) robotMetaIds.push(metaId);
          createdRobots.push({
            metaId,
            url: lookup.robotUrl || url,
            name: String((lookup.robot as any).recording_meta?.name || ''),
            reused: true,
            matchKind: lookup.matchKind,
            reuseNote: lookup.reuseNote,
          });
          continue;
        }
        let hostname = 'company';
        try {
          hostname = new URL(url).hostname.replace(/^www\./, '');
        } catch {
          continue;
        }
        let normalized = url;
        try {
          normalized = careerBoardUrlForStorage(url, { keepSiteFilters: forceFilteredRobot });
        } catch {
          /* keep */
        }
        if (!forceFilteredRobot) {
          const afterStrip = await findRobotByCareerUrl(normalized);
          if (afterStrip?.robot) {
            const metaId = String((afterStrip.robot as any).recording_meta?.id || '');
            if (metaId && !robotMetaIds.includes(metaId)) robotMetaIds.push(metaId);
            createdRobots.push({
              metaId,
              url: afterStrip.robotUrl || normalized,
              name: String((afterStrip.robot as any).recording_meta?.name || ''),
              reused: true,
              matchKind: afterStrip.matchKind,
              reuseNote: afterStrip.reuseNote,
            });
            continue;
          }
        }
        const metaId = uuidv4();
        const name = `Cluster: ${cluster.name} — ${hostname}`;
        try {
          await Robot.create({
            userId: ownerId,
            recording_meta: {
              id: metaId,
              name,
              url: normalized,
              createdAt: new Date().toLocaleString(),
              pairs: 0,
              params: [],
              type: 'saas',
              saasConfig: {
                listExtraction: {
                  enabled: true,
                  maxPages: 10,
                },
              },
            },
            recording: { workflow: [] },
          });
          robotMetaIds.push(metaId);
          createdRobots.push({ metaId, url: normalized, name, reused: false });
          if (!companyNames.includes(hostname)) companyNames.push(hostname);
        } catch (err: any) {
          logger.log('warn', `bind-sources robot create failed for ${url}: ${err?.message || err}`);
        }
      }
    }

    const sources = Array.isArray(body.sources)
      ? body.sources.map((s: unknown) => String(s).trim()).filter(Boolean)
      : [...(cluster.sourceBinding?.sources || []), ...urls];

    cluster.kind = 'custom';
    cluster.sourceBinding = {
      mode: 'source',
      sources: [...new Set(sources)],
      companyNames,
      robotMetaIds: [...new Set(robotMetaIds)],
    } as any;
    if (companyNames.length && !(cluster.filter?.companyNames || []).length) {
      cluster.filter = {
        ...(cluster.filter as any),
        companyNames,
      };
    }
    cluster.filtersSummary = buildFiltersSummary(cluster);
    await cluster.save();

    await recordActivity(
      cluster._id,
      'sources_bound',
      actorFromReq(req),
      `${createdRobots.length} robots created, ${sources.length} sources`
    );

    return res.json({
      cluster: serializeClusterOps(cluster),
      createdRobots,
    });
  } catch (err: any) {
    logger.log('error', `cluster-studio bind-sources: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to bind sources' });
  }
});

// ─── Portal users (plan + cluster assignments) ───────────────────────────────

/**
 * Resolve subscribed slot allotment for a portal user.
 * Null adminClusterLimit → plan default (PP=2, else 0), NOT 50.
 */
function resolveSubscribedSlotsForUser(user: {
  firstStepPlan?: any;
  adminClusterLimit?: number | null;
  clusterServiceOptOut?: boolean | null;
  clusterServiceStartedAt?: Date | string | null;
}) {
  return resolveSubscribedSlots({
    plan: user.firstStepPlan,
    adminClusterLimit: user.adminClusterLimit,
    clusterServiceOptOut: user.clusterServiceOptOut,
    clusterServiceStartedAt: user.clusterServiceStartedAt,
  });
}

/**
 * If adminClusterLimit is unset and active > planIncluded, persist activeCount
 * so legacy over-cap users are not stranded (e.g. 3 active on PP default 2).
 */
async function ensureAllotmentBackfill(
  user: any,
  activeCount: number
): Promise<number | null> {
  if (typeof user.adminClusterLimit === 'number' && Number.isFinite(user.adminClusterLimit)) {
    return user.adminClusterLimit;
  }
  const planIncluded = getEntitlements(user.firstStepPlan).maxActiveClusters;
  if (activeCount <= planIncluded) return user.adminClusterLimit ?? null;

  const next = Math.min(ADMIN_MAX_ASSIGNABLE_CLUSTERS, Math.max(0, activeCount));
  try {
    await PortalUser.updateOne(
      {
        _id: user._id,
        $or: [{ adminClusterLimit: null }, { adminClusterLimit: { $exists: false } }],
      },
      { $set: { adminClusterLimit: next } }
    );
    user.adminClusterLimit = next;
  } catch (err: any) {
    logger.log('warn', `portal-users allotment backfill: ${err?.message || err}`);
  }
  return next;
}

function serializePortalUserRow(
  user: any,
  subs: Array<{
    id: string;
    clusterId: string;
    clusterName: string;
    clusterSlug?: string;
    window: string;
    status: string;
    source?: string;
  }>
) {
  const firstStepRole = user.firstStepRole || null;
  const staff = isFirstStepStaffRole(firstStepRole);
  const entitlements = staff
    ? {
        maxActiveClusters: 0,
        allowedWindows: [] as string[],
        source: 'inactive' as const,
        isActive: false,
      }
    : getEntitlements(user.firstStepPlan);
  const active = subs.filter((s) => s.status === 'active');
  const roleOverride = staffRoleDisplayOverride(
    user.firstStepPlan?.subscriptionType,
    firstStepRole
  );
  const subscriptionTypeDisplay =
    roleOverride ||
    displayPlanType(user.firstStepPlan?.subscriptionType) ||
    (firstStepRole ? null : 'Standard');

  const slots = staff
    ? {
        subscriptionOn: false,
        planIncludedSlots: 0,
        subscribedSlots: 0,
        allowedWindows: [] as const,
      }
    : resolveSubscribedSlotsForUser({
        firstStepPlan: user.firstStepPlan,
        adminClusterLimit: user.adminClusterLimit,
        clusterServiceOptOut: user.clusterServiceOptOut,
        clusterServiceStartedAt: user.clusterServiceStartedAt,
      });

  return {
    id: String(user._id || user.id),
    auth0Sub: user.auth0Sub,
    email: user.email,
    name: user.name || null,
    firstStepRole,
    firstStepPlan: user.firstStepPlan
      ? {
          subscriptionType: user.firstStepPlan.subscriptionType ?? null,
          subscriptionTypeDisplay,
          isActive: user.firstStepPlan.isActive ?? null,
          status: user.firstStepPlan.status ?? null,
          fetchedAt: user.firstStepPlan.fetchedAt
            ? new Date(user.firstStepPlan.fetchedAt).toISOString()
            : null,
        }
      : {
          subscriptionType: null,
          subscriptionTypeDisplay: subscriptionTypeDisplay || 'Standard',
          isActive: null,
          status: null,
          fetchedAt: null,
        },
    clusterServiceStarted: slots.subscriptionOn,
    clusterServiceStartedAt: user.clusterServiceStartedAt
      ? new Date(user.clusterServiceStartedAt).toISOString()
      : null,
    clusterServiceOptOut: Boolean(user.clusterServiceOptOut),
    entitlements: {
      maxActiveClusters: entitlements.maxActiveClusters,
      allowedWindows: entitlements.allowedWindows,
      source: entitlements.source,
      isActive: entitlements.isActive,
    },
    activeClusterCount: active.length,
    planIncludedSlots: slots.planIncludedSlots,
    /** Denominator for UI: ops allotment or plan default (never hard-cap 50). */
    subscribedSlots: slots.subscribedSlots,
    /** @deprecated Prefer subscribedSlots; kept for older admin UI. */
    adminMaxAssignableClusters: slots.subscribedSlots,
    adminClusterLimit:
      typeof user.adminClusterLimit === 'number' ? user.adminClusterLimit : null,
    subscriptions: subs,
  };
}

/** Backfill First Step role/plan when Portal users would otherwise show Unknown. */
async function enrichPortalUsersFromFirstStep(users: any[]): Promise<any[]> {
  const needs = users.filter((u) => {
    const planType = String(u.firstStepPlan?.subscriptionType || '').toLowerCase();
    const staff = isFirstStepStaffRole(u.firstStepRole);
    if (staff) return false;
    return !u.firstStepRole || !planType || planType === 'unknown';
  });
  if (!needs.length) return users;

  const byId = new Map(users.map((u) => [String(u._id), u]));
  const concurrency = 5;
  for (let i = 0; i < needs.length; i += concurrency) {
    const batch = needs.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (u) => {
        try {
          const account = await fetchFirstStepAccount(u.auth0Sub, u.email);
          const updates: Record<string, unknown> = {};
          if (account.role) updates.firstStepRole = account.role;
          if (account.plan) updates.firstStepPlan = account.plan;
          if (!Object.keys(updates).length) return;
          await PortalUser.updateOne({ _id: u._id }, { $set: updates });
          byId.set(String(u._id), { ...u, ...updates });
        } catch (err: any) {
          logger.log(
            'warn',
            `portal-users First Step enrich ${u.email}: ${err?.message || err}`
          );
        }
      })
    );
  }
  return users.map((u) => byId.get(String(u._id)) || u);
}

router.get('/cluster-studio/portal-users', async (_req: Request, res: Response) => {
  try {
    const rawUsers = await PortalUser.find({}).sort({ email: 1 }).lean();
    const users = await enrichPortalUsersFromFirstStep(rawUsers);
    const auth0Subs = users.map((u) => u.auth0Sub);
    const allSubs = await ClusterSubscription.find({ auth0Sub: { $in: auth0Subs } }).lean();
    const clusterIds = [...new Set(allSubs.map((s) => String(s.clusterId)))];
    const clusters = await Cluster.find({ _id: { $in: clusterIds } }).lean();
    const clusterById = new Map(
      clusters.map((c) => [String(c._id), { name: c.name, slug: c.slug }])
    );

    const subsByUser = new Map<string, any[]>();
    for (const s of allSubs) {
      const list = subsByUser.get(s.auth0Sub) || [];
      const meta = clusterById.get(String(s.clusterId));
      list.push({
        id: String(s._id),
        clusterId: String(s.clusterId),
        clusterName: meta?.name || 'Unknown cluster',
        clusterSlug: meta?.slug,
        window: s.window,
        status: s.status,
        source: (s as any).source || 'self_serve',
      });
      subsByUser.set(s.auth0Sub, list);
    }

    const rows = [];
    for (const u of users) {
      const userSubs = subsByUser.get(u.auth0Sub) || [];
      const activeCount = userSubs.filter((s) => s.status === 'active').length;
      await ensureAllotmentBackfill(u, activeCount);
      rows.push(serializePortalUserRow(u, userSubs));
    }

    return res.json({ users: rows });
  } catch (err: any) {
    logger.log('error', `cluster-studio portal-users list: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to list portal users' });
  }
});

router.get('/cluster-studio/portal-users/:auth0Sub', async (req: Request, res: Response) => {
  try {
    const auth0Sub = decodeURIComponent(String(req.params.auth0Sub || '').trim());
    if (!auth0Sub) return res.status(400).json({ error: 'Missing auth0Sub' });
    const user = await PortalUser.findOne({ auth0Sub }).lean();
    if (!user) return res.status(404).json({ error: 'Portal user not found' });

    const allSubs = await ClusterSubscription.find({ auth0Sub }).lean();
    const clusterIds = allSubs.map((s) => s.clusterId);
    const clusters = await Cluster.find({ _id: { $in: clusterIds } }).lean();
    const clusterById = new Map(
      clusters.map((c) => [String(c._id), { name: c.name, slug: c.slug }])
    );
    const subs = allSubs.map((s) => {
      const meta = clusterById.get(String(s.clusterId));
      return {
        id: String(s._id),
        clusterId: String(s.clusterId),
        clusterName: meta?.name || 'Unknown cluster',
        clusterSlug: meta?.slug,
        window: s.window,
        status: s.status,
        source: (s as any).source || 'self_serve',
      };
    });

    return res.json(serializePortalUserRow(user, subs));
  } catch (err: any) {
    logger.log('error', `cluster-studio portal-user get: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to load portal user' });
  }
});

/** Ops edit: subscription start flag + per-user cluster limit. */
router.patch('/cluster-studio/portal-users/:auth0Sub', async (req: Request, res: Response) => {
  try {
    const auth0Sub = decodeURIComponent(String(req.params.auth0Sub || '').trim());
    if (!auth0Sub) return res.status(400).json({ error: 'Missing auth0Sub' });

    const user = await PortalUser.findOne({ auth0Sub });
    if (!user) return res.status(404).json({ error: 'Portal user not found' });

    if (typeof req.body?.clusterServiceStarted === 'boolean') {
      if (req.body.clusterServiceStarted) {
        user.clusterServiceOptOut = false;
        if (!user.clusterServiceStartedAt) {
          user.clusterServiceStartedAt = new Date();
        }
      } else {
        user.clusterServiceOptOut = true;
        user.clusterServiceStartedAt = null;
      }
    }

    if (req.body?.adminClusterLimit !== undefined) {
      if (req.body.adminClusterLimit === null || req.body.adminClusterLimit === '') {
        user.adminClusterLimit = null;
      } else {
        const n = Number(req.body.adminClusterLimit);
        if (!Number.isFinite(n) || n < 0 || n > ADMIN_MAX_ASSIGNABLE_CLUSTERS) {
          return res.status(400).json({
            error: `adminClusterLimit must be 0–${ADMIN_MAX_ASSIGNABLE_CLUSTERS}`,
            code: 'portal.invalid_cluster_limit',
          });
        }
        user.adminClusterLimit = Math.floor(n);
      }
    }

    await user.save();

    const allSubs = await ClusterSubscription.find({ auth0Sub }).lean();
    const ids = allSubs.map((s) => s.clusterId);
    const clusters = await Cluster.find({ _id: { $in: ids } }).lean();
    const clusterById = new Map(
      clusters.map((c) => [String(c._id), { name: c.name, slug: c.slug }])
    );
    const subs = allSubs.map((s) => {
      const meta = clusterById.get(String(s.clusterId));
      return {
        id: String(s._id),
        clusterId: String(s.clusterId),
        clusterName: meta?.name || 'Unknown cluster',
        clusterSlug: meta?.slug,
        window: s.window,
        status: s.status,
        source: (s as any).source || 'self_serve',
      };
    });

    return res.json(serializePortalUserRow(user.toObject(), subs));
  } catch (err: any) {
    logger.log('error', `cluster-studio portal-user patch: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to update portal user' });
  }
});

router.post(
  '/cluster-studio/portal-users/:auth0Sub/subscriptions',
  async (req: Request, res: Response) => {
    try {
      const auth0Sub = decodeURIComponent(String(req.params.auth0Sub || '').trim());
      const clusterId = String(req.body?.clusterId || '').trim();
      const window = parseClusterWindow(req.body?.window || req.body?.frequency);

      if (!auth0Sub) return res.status(400).json({ error: 'Missing auth0Sub' });
      if (!mongoose.isValidObjectId(clusterId)) {
        return res.status(400).json({ error: 'Invalid clusterId' });
      }

      const user = await PortalUser.findOne({ auth0Sub });
      if (!user) return res.status(404).json({ error: 'Portal user not found' });

      const cluster = await Cluster.findOne({ _id: clusterId, status: 'published' });
      if (!cluster) return res.status(404).json({ error: 'Published cluster not found' });

      if (!(CLUSTER_WINDOWS as readonly string[]).includes(window)) {
        return res.status(400).json({
          error: `Window ${window} is not valid`,
          code: 'portal.window_invalid',
          allowedWindows: CLUSTER_WINDOWS,
        });
      }

      const slots = resolveSubscribedSlotsForUser(user);
      if (!slots.subscriptionOn) {
        return res.status(403).json({
          error: 'Turn on subscription before assigning clusters',
          code: 'portal.subscription_off',
        });
      }

      const existing = await ClusterSubscription.findOne({ auth0Sub, clusterId });
      const activeCount = await ClusterSubscription.countDocuments({
        auth0Sub,
        status: 'active',
      });
      await ensureAllotmentBackfill(user, activeCount);
      const allotment = resolveSubscribedSlotsForUser(user).subscribedSlots;
      const wouldAddNewActive = !existing || existing.status !== 'active';
      if (wouldAddNewActive && activeCount >= allotment) {
        return res.status(403).json({
          error: `User can hold at most ${allotment} active cluster${allotment === 1 ? '' : 's'}`,
          code: 'portal.admin_max_clusters',
          maxActiveClusters: allotment,
          subscribedSlots: allotment,
        });
      }

      if (existing) {
        existing.status = 'active';
        existing.window = window as ClusterWindow;
        existing.source = 'admin_assigned';
        await existing.save();
      } else {
        await ClusterSubscription.create({
          auth0Sub,
          clusterId,
          window,
          status: 'active',
          source: 'admin_assigned',
        });
      }

      const allSubs = await ClusterSubscription.find({ auth0Sub }).lean();
      const ids = allSubs.map((s) => s.clusterId);
      const clusters = await Cluster.find({ _id: { $in: ids } }).lean();
      const clusterById = new Map(
        clusters.map((c) => [String(c._id), { name: c.name, slug: c.slug }])
      );
      const subs = allSubs.map((s) => {
        const meta = clusterById.get(String(s.clusterId));
        return {
          id: String(s._id),
          clusterId: String(s.clusterId),
          clusterName: meta?.name || 'Unknown cluster',
          clusterSlug: meta?.slug,
          window: s.window,
          status: s.status,
          source: (s as any).source || 'self_serve',
        };
      });

      return res.status(201).json(serializePortalUserRow(user.toObject(), subs));
    } catch (err: any) {
      if (err?.code === 11000) {
        return res.status(409).json({ error: 'Already subscribed to this cluster' });
      }
      logger.log('error', `cluster-studio portal-user assign: ${err?.message || err}`);
      return res.status(500).json({ error: 'Failed to assign cluster' });
    }
  }
);

router.delete(
  '/cluster-studio/portal-users/:auth0Sub/subscriptions/:id',
  async (req: Request, res: Response) => {
    try {
      const auth0Sub = decodeURIComponent(String(req.params.auth0Sub || '').trim());
      const id = String(req.params.id || '').trim();
      const soft = String(req.query.soft || '') === '1' || req.body?.soft === true;

      if (!auth0Sub || !mongoose.isValidObjectId(id)) {
        return res.status(400).json({ error: 'Invalid auth0Sub or subscription id' });
      }

      const sub = await ClusterSubscription.findOne({ _id: id, auth0Sub });
      if (!sub) return res.status(404).json({ error: 'Subscription not found' });

      if (soft) {
        sub.status = 'paused';
        await sub.save();
      } else {
        await ClusterSubscription.deleteOne({ _id: id, auth0Sub });
      }

      return res.status(204).send();
    } catch (err: any) {
      logger.log('error', `cluster-studio portal-user unassign: ${err?.message || err}`);
      return res.status(500).json({ error: 'Failed to remove subscription' });
    }
  }
);

function serializeJobReport(doc: any) {
  const json = typeof doc.toJSON === 'function' ? doc.toJSON() : doc;
  return {
    id: String(json.id || json._id),
    auth0Sub: json.auth0Sub,
    reporterEmail: json.reporterEmail || null,
    reporterName: json.reporterName || null,
    jobId: json.jobId || null,
    jobUrlKey: json.jobUrlKey,
    jobUrl: json.jobUrl || null,
    title: json.title || '',
    company: json.company || '',
    reason: json.reason,
    note: json.note || null,
    status: json.status,
    reviewedAt: json.reviewedAt ? new Date(json.reviewedAt).toISOString() : null,
    reviewedBy: json.reviewedBy || null,
    createdAt: json.createdAt ? new Date(json.createdAt).toISOString() : null,
  };
}

router.get('/cluster-studio/job-reports', async (req: Request, res: Response) => {
  try {
    const status = String(req.query.status || 'open').trim();
    const filter: Record<string, unknown> = {};
    if (status === 'open' || status === 'reviewed') filter.status = status;
    const rows = await JobReport.find(filter).sort({ createdAt: -1 }).limit(200).lean();
    return res.json({ reports: rows.map((r) => serializeJobReport(r)) });
  } catch (err: any) {
    logger.log('error', `cluster-studio job-reports list: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to list job reports' });
  }
});

router.patch('/cluster-studio/job-reports/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid report id' });
    }
    const nextStatus = String(req.body?.status || '').trim();
    if (nextStatus !== 'open' && nextStatus !== 'reviewed') {
      return res.status(400).json({ error: 'status must be open or reviewed' });
    }
    const reviewer =
      String((req as any).user?.email || (req as any).user?.id || req.body?.reviewedBy || 'ops').trim();
    const update: Record<string, unknown> = { status: nextStatus };
    if (nextStatus === 'reviewed') {
      update.reviewedAt = new Date();
      update.reviewedBy = reviewer;
    } else {
      update.reviewedAt = null;
      update.reviewedBy = null;
    }
    const doc = await JobReport.findByIdAndUpdate(id, { $set: update }, { new: true }).lean();
    if (!doc) return res.status(404).json({ error: 'Report not found' });
    return res.json(serializeJobReport(doc));
  } catch (err: any) {
    logger.log('error', `cluster-studio job-reports patch: ${err?.message || err}`);
    return res.status(500).json({ error: 'Failed to update report' });
  }
});

export default router;

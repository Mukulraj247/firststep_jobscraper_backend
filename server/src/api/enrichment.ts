import { Router } from 'express';
import { requireSignInOrApiKey } from '../middlewares/auth';
import JobBoardListing from '../models/JobBoardListing';
import EnrichmentCreditBudget from '../models/EnrichmentCreditBudget';
import { normalizeOwnerIdForWrite } from '../utils/ownerId';
import {
  getCreditsSpentToday,
  getLastEnrichmentMetrics,
  SCRAPE_DO_DAILY_CREDIT_BUDGET,
} from '../workers/jobEnrichmentWorker';

const router = Router();
router.use(requireSignInOrApiKey);

type CacheEntry = { expiresAt: number; body: unknown };
let metricsCache: CacheEntry | null = null;
const METRICS_TTL_MS = 20_000;

function sourceClassExpr() {
  return {
    $switch: {
      branches: [
        {
          case: {
            $in: [{ $toLower: { $ifNull: ['$source', ''] } }, ['hiring_cafe', 'hiringcafe']],
          },
          then: 'hiring_cafe',
        },
        {
          case: {
            $gt: [{ $strLenCP: { $ifNull: ['$source', ''] } }, 0],
          },
          then: 'other',
        },
      ],
      default: 'career',
    },
  };
}

function emptyClass() {
  return { queued: 0, enriching: 0, ready6h: 0 };
}

router.get('/enrichment/metrics', async (req: any, res: any) => {
  try {
    const now = Date.now();
    if (metricsCache && metricsCache.expiresAt > now) {
      return res.status(200).json(metricsCache.body);
    }

    const ownerId = normalizeOwnerIdForWrite(String(req.user?.id || req.user?._id || ''));
    const ownerFilter = ownerId ? { ownerId } : {};
    const asOf = new Date();
    const h1 = new Date(now - 60 * 60 * 1000);
    const h6 = new Date(now - 6 * 60 * 60 * 1000);

    const [
      queued,
      enriching,
      dueNow,
      futureBackoff,
      leaseStuck,
      ready1h,
      ready6h,
      created6h,
      queuedCreated6h,
      statusByClass,
      ready6hByClass,
      methodRows,
      errorRows,
      hostRows,
      spentToday,
    ] = await Promise.all([
      JobBoardListing.countDocuments({ ...ownerFilter, status: 'queued' }),
      JobBoardListing.countDocuments({ ...ownerFilter, status: 'enriching' }),
      JobBoardListing.countDocuments({
        ...ownerFilter,
        status: 'queued',
        $or: [
          { 'enrichment.nextAttemptAt': null },
          { 'enrichment.nextAttemptAt': { $exists: false } },
          { 'enrichment.nextAttemptAt': { $lte: asOf } },
        ],
      }),
      JobBoardListing.countDocuments({
        ...ownerFilter,
        status: 'queued',
        'enrichment.nextAttemptAt': { $gt: asOf },
      }),
      JobBoardListing.countDocuments({
        ...ownerFilter,
        status: 'enriching',
        leaseUntil: { $lt: asOf },
      }),
      JobBoardListing.countDocuments({
        ...ownerFilter,
        status: 'ready',
        createdAt: { $gte: h1 },
      }),
      JobBoardListing.countDocuments({
        ...ownerFilter,
        status: 'ready',
        createdAt: { $gte: h6 },
      }),
      JobBoardListing.countDocuments({ ...ownerFilter, createdAt: { $gte: h6 } }),
      JobBoardListing.countDocuments({
        ...ownerFilter,
        status: 'queued',
        createdAt: { $gte: h6 },
      }),
      JobBoardListing.aggregate([
        { $match: ownerFilter },
        {
          $group: {
            _id: { class: sourceClassExpr(), status: '$status' },
            n: { $sum: 1 },
          },
        },
      ]),
      JobBoardListing.aggregate([
        {
          $match: {
            ...ownerFilter,
            status: 'ready',
            createdAt: { $gte: h6 },
          },
        },
        { $group: { _id: sourceClassExpr(), n: { $sum: 1 } } },
      ]),
      JobBoardListing.aggregate([
        {
          $match: {
            ...ownerFilter,
            createdAt: { $gte: h6 },
            status: { $in: ['ready', 'partial', 'failed', 'queued'] },
          },
        },
        {
          $group: {
            _id: { $ifNull: ['$enrichment.method', 'none'] },
            n: { $sum: 1 },
          },
        },
        { $sort: { n: -1 } },
      ]),
      JobBoardListing.aggregate([
        {
          $match: {
            ...ownerFilter,
            status: { $in: ['queued', 'failed', 'partial'] },
            'enrichment.lastError': { $nin: [null, ''] },
          },
        },
        { $group: { _id: '$enrichment.lastError', n: { $sum: 1 } } },
        { $sort: { n: -1 } },
        { $limit: 12 },
      ]),
      JobBoardListing.aggregate([
        { $match: { ...ownerFilter, status: 'queued' } },
        {
          $addFields: {
            _hostUrl: { $ifNull: ['$applyUrl', '$jobUrl'] },
          },
        },
        {
          $addFields: {
            host: {
              $let: {
                vars: {
                  withoutProto: {
                    $arrayElemAt: [{ $split: [{ $ifNull: ['$_hostUrl', ''] }, '//'] }, 1],
                  },
                },
                in: {
                  $arrayElemAt: [{ $split: [{ $ifNull: ['$$withoutProto', ''] }, '/'] }, 0],
                },
              },
            },
          },
        },
        { $group: { _id: '$host', n: { $sum: 1 } } },
        { $sort: { n: -1 } },
        { $limit: 15 },
      ]),
      getCreditsSpentToday(),
    ]);

    const bySourceClass = {
      career: emptyClass(),
      hiring_cafe: emptyClass(),
      other: emptyClass(),
    };
    for (const row of statusByClass as any[]) {
      const cls = String(row?._id?.class || 'career') as keyof typeof bySourceClass;
      const status = String(row?._id?.status || '');
      const bucket = bySourceClass[cls] || bySourceClass.other;
      const n = Number(row.n) || 0;
      if (status === 'queued') bucket.queued += n;
      if (status === 'enriching') bucket.enriching += n;
    }
    for (const row of ready6hByClass as any[]) {
      const cls = String(row?._id || 'career') as keyof typeof bySourceClass;
      const bucket = bySourceClass[cls] || bySourceClass.other;
      bucket.ready6h += Number(row.n) || 0;
    }

    const byMethod6h: Record<string, number> = {};
    for (const row of methodRows as any[]) {
      byMethod6h[String(row._id || 'none')] = Number(row.n) || 0;
    }

    const dayKey = asOf.toISOString().slice(0, 10);
    const budgetDoc = await EnrichmentCreditBudget.findById(dayKey).lean().catch(() => null);
    const lastPass = getLastEnrichmentMetrics();

    const body = {
      asOf: asOf.toISOString(),
      queue: {
        queued,
        dueNow,
        enriching,
        futureBackoff,
        leaseStuck,
      },
      windows: {
        ready1h,
        ready6h,
        created6h,
        queuedCreated6h,
      },
      bySourceClass,
      byMethod6h,
      credits: {
        spentToday: typeof spentToday === 'number' ? spentToday : Number((budgetDoc as any)?.creditsSpent) || 0,
        budget: SCRAPE_DO_DAILY_CREDIT_BUDGET,
        pausedForScrapeDo:
          (typeof spentToday === 'number' ? spentToday : 0) >= SCRAPE_DO_DAILY_CREDIT_BUDGET,
      },
      topErrors: (errorRows as any[]).map((r) => ({
        error: String(r._id || ''),
        n: Number(r.n) || 0,
      })),
      topQueuedHosts: (hostRows as any[])
        .filter((r) => r._id)
        .map((r) => ({ host: String(r._id), n: Number(r.n) || 0 })),
      lastPass: {
        claimed: lastPass.claimed,
        ready: lastPass.ready,
        ats_hit: lastPass.ats_hit,
        failed: lastPass.failed,
        credits_spent: lastPass.credits_spent,
        budget_paused: lastPass.budget_paused,
      },
    };

    metricsCache = { expiresAt: now + METRICS_TTL_MS, body };
    return res.status(200).json(body);
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'enrichment_metrics_failed' });
  }
});

export default router;

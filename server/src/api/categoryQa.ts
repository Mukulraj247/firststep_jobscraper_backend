import { Router } from 'express';
import { requireSignInOrApiKey } from '../middlewares/auth';
import JobBoardListing from '../models/JobBoardListing';
import { normalizeOwnerIdForWrite } from '../utils/ownerId';
import {
  CATEGORY_QA_UI_BATCH_ID,
  runRandomCategoryQaSample,
} from '../services/categoryQaSample';
import logger from '../logger';

const router = Router();
router.use(requireSignInOrApiKey);

const DEFAULT_BATCH_ID = CATEGORY_QA_UI_BATCH_ID;

type PhaseFilter = 'all' | 'cleared' | 'backfilled' | 'student_review';

function parsePhase(raw: unknown): PhaseFilter {
  const v = String(raw || 'all').toLowerCase();
  if (v === 'cleared' || v === 'backfilled' || v === 'student_review') return v;
  return 'all';
}

function parsePositiveInt(raw: unknown, fallback: number, max: number): number {
  const n = parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, max);
}

router.get('/category-qa/summary', async (req: any, res: any) => {
  try {
    const batchId = String(req.query.batchId || DEFAULT_BATCH_ID).trim() || DEFAULT_BATCH_ID;
    const ownerId = normalizeOwnerIdForWrite(String(req.user?.id || req.user?._id || ''));
    const match: Record<string, unknown> = { categoryQaBatchId: batchId };
    if (ownerId) match.ownerId = ownerId;

    const [phaseRows, completeness] = await Promise.all([
      JobBoardListing.aggregate([
        { $match: match },
        { $group: { _id: '$categoryQaPhase', n: { $sum: 1 } } },
      ]),
      JobBoardListing.aggregate([
        {
          $match: {
            ...match,
            categoryQaPhase: { $in: ['backfilled', 'student_review'] },
            studentEscape: { $ne: true },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            missingSpecialty: {
              $sum: {
                $cond: [{ $eq: [{ $size: { $ifNull: ['$frozenCategories', []] } }, 0] }, 1, 0],
              },
            },
            missingIndustry: {
              $sum: {
                $cond: [{ $eq: [{ $size: { $ifNull: ['$frozenIndustries', []] } }, 0] }, 1, 0],
              },
            },
            missingExperience: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: [{ $size: { $ifNull: ['$frozenExperienceLevels', []] } }, 0] },
                      { $eq: [{ $size: { $ifNull: ['$frozenExperienceYears', []] } }, 0] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            missingLocation: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: [{ $size: { $ifNull: ['$frozenStates', []] } }, 0] },
                      { $ne: ['$locationIsRemote', true] },
                      { $ne: ['$locationIsUs', false] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            missingH1bStamp: {
              $sum: {
                $cond: [
                  {
                    $or: [
                      { $eq: [{ $ifNull: ['$h1bCompanyScore', 'unknown'] }, 'unknown'] },
                      { $eq: [{ $ifNull: ['$h1bMappingStatus', 'none'] }, 'none'] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),
    ]);

    const byPhase: Record<string, number> = {
      cleared: 0,
      backfilled: 0,
      student_review: 0,
      '': 0,
    };
    let total = 0;
    for (const row of phaseRows) {
      const key = String(row._id ?? '');
      byPhase[key] = row.n;
      total += row.n;
    }

    const c = completeness[0] || {
      total: 0,
      missingSpecialty: 0,
      missingIndustry: 0,
      missingExperience: 0,
      missingLocation: 0,
      missingH1bStamp: 0,
    };
    const reviewed = Number(c.total) || 0;
    const pct = (n: number) => (reviewed > 0 ? Math.round((n / reviewed) * 1000) / 10 : 0);

    return res.status(200).json({
      batchId,
      total,
      byPhase: {
        cleared: byPhase.cleared || 0,
        backfilled: byPhase.backfilled || 0,
        student_review: byPhase.student_review || 0,
      },
      completeness: {
        reviewed,
        missingSpecialty: c.missingSpecialty,
        missingIndustry: c.missingIndustry,
        missingExperience: c.missingExperience,
        missingLocation: c.missingLocation,
        missingH1bStamp: c.missingH1bStamp,
        pctMissingSpecialty: pct(c.missingSpecialty),
        pctMissingIndustry: pct(c.missingIndustry),
        pctMissingExperience: pct(c.missingExperience),
        pctMissingLocation: pct(c.missingLocation),
        pctMissingH1bStamp: pct(c.missingH1bStamp),
      },
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'category-qa summary failed' });
  }
});

router.get('/category-qa', async (req: any, res: any) => {
  try {
    const batchId = String(req.query.batchId || DEFAULT_BATCH_ID).trim() || DEFAULT_BATCH_ID;
    const phase = parsePhase(req.query.phase);
    const page = parsePositiveInt(req.query.page, 1, 10_000);
    const limit = parsePositiveInt(req.query.limit, 50, 200);
    const skip = (page - 1) * limit;

    const ownerId = normalizeOwnerIdForWrite(String(req.user?.id || req.user?._id || ''));
    const filter: Record<string, unknown> = { categoryQaBatchId: batchId };
    if (ownerId) filter.ownerId = ownerId;

    if (phase === 'cleared') {
      filter.categoryQaPhase = 'cleared';
    } else if (phase === 'backfilled') {
      filter.categoryQaPhase = 'backfilled';
    } else if (phase === 'student_review') {
      filter.$or = [{ categoryQaPhase: 'student_review' }, { studentEscape: true }];
    }

    const [total, items] = await Promise.all([
      JobBoardListing.countDocuments(filter),
      JobBoardListing.find(filter)
        .select(
          'jobTitle companyName jobUrl status categoryQaPhase studentEscape frozenCategories frozenIndustries frozenExperienceLevels frozenExperienceYears frozenStates frozenCities locationIsRemote locationIsUs location h1bEligible h1bCompanyScore h1bMappingStatus h1bFy2026Match createdAt updatedAt'
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    return res.status(200).json({
      batchId,
      phase,
      page,
      limit,
      total,
      items: items.map((doc: any) => ({
        id: String(doc._id),
        jobTitle: doc.jobTitle || '',
        companyName: doc.companyName || '',
        jobUrl: doc.jobUrl || '',
        status: doc.status,
        categoryQaPhase: doc.categoryQaPhase || '',
        studentEscape: Boolean(doc.studentEscape),
        frozenCategories: doc.frozenCategories || [],
        frozenIndustries: doc.frozenIndustries || [],
        frozenExperienceLevels: doc.frozenExperienceLevels || [],
        frozenExperienceYears: doc.frozenExperienceYears || [],
        frozenStates: doc.frozenStates || [],
        frozenCities: doc.frozenCities || [],
        locationIsRemote: Boolean(doc.locationIsRemote),
        locationIsUs: doc.locationIsUs !== false,
        location: doc.location || '',
        h1bEligible: Boolean(doc.h1bEligible),
        h1bCompanyScore: doc.h1bCompanyScore || 'unknown',
        h1bMappingStatus: doc.h1bMappingStatus || 'none',
        h1bFy2026Match: Boolean(doc.h1bFy2026Match),
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      })),
    });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message || 'category-qa list failed' });
  }
});

/**
 * UI one-click local test:
 * randomly pick N board jobs → clear categories/H-1B → backfill → mark batch for /category-qa.
 */
router.post('/category-qa/run-sample', async (req: any, res: any) => {
  try {
    const count = Math.min(
      Math.max(parseInt(String(req.body?.count ?? '1000'), 10) || 1000, 1),
      1000
    );
    const ownerId = normalizeOwnerIdForWrite(String(req.user?.id || req.user?._id || ''));
    const result = await runRandomCategoryQaSample({
      count,
      batchId: CATEGORY_QA_UI_BATCH_ID,
      // Sample across the board (ops QA); do not scope to owner — matches job board pool.
      ownerId: undefined,
    });
    logger.log(
      'info',
      `[categoryQa] run-sample user=${ownerId || 'anon'} selected=${result.selected} backfilled=${result.backfilled} students=${result.students} ms=${result.elapsedMs}`
    );
    return res.status(200).json(result);
  } catch (err: any) {
    const status = err?.status === 409 ? 409 : 500;
    return res.status(status).json({ error: err?.message || 'category-qa run-sample failed' });
  }
});

export default router;

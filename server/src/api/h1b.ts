import { Router } from 'express';
import { requireSignInOrApiKey } from '../middlewares/auth';
import GovEmployer from '../models/GovEmployer';
import EmployerBrandMapping from '../models/EmployerBrandMapping';
import MappingRejection from '../models/MappingRejection';
import SponsorshipProfile from '../models/SponsorshipProfile';
import CompanyBrand from '../models/CompanyBrand';
import JobBoardListing from '../models/JobBoardListing';
import { normalizeOwnerIdForWrite } from '../utils/ownerId';
import { buildSponsorshipProfiles } from '../services/h1b/buildSponsorshipProfiles';
import { employerNameNormalize } from '../services/h1b/employerNameNormalize';

const router = Router();
router.use(requireSignInOrApiKey);

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Summary KPIs for the H-1B ops page. */
router.get('/h1b/stats', async (_req: any, res: any) => {
  try {
    const [govEmployers, brands, autoApproved, pendingReview, approved, profiles] =
      await Promise.all([
        GovEmployer.estimatedDocumentCount(),
        CompanyBrand.estimatedDocumentCount(),
        EmployerBrandMapping.countDocuments({ status: 'auto_approved' }),
        EmployerBrandMapping.countDocuments({ status: 'pending_review' }),
        EmployerBrandMapping.countDocuments({ status: 'approved' }),
        SponsorshipProfile.estimatedDocumentCount(),
      ]);
    return res.json({
      govEmployers,
      brands,
      autoApproved,
      pendingReview,
      approved,
      profiles,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to load H-1B stats' });
  }
});

/** Company explorer — search lean gov employers. */
router.get('/h1b/employers', async (req: any, res: any) => {
  try {
    const q = String(req.query.q || '').trim();
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
    const match: Record<string, any> = {};
    if (q) {
      const re = new RegExp(escapeRegex(q), 'i');
      match.$or = [{ employerNameDisplay: re }, { employerNameNormalized: re }, { employerNameKey: re }];
    }

    const [total, rows] = await Promise.all([
      GovEmployer.countDocuments(match),
      GovEmployer.find(match)
        .sort({ certifiedCount: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    const keys = rows.map((r) => r.employerNameKey);
    const mappings = await EmployerBrandMapping.find({
      govEmployerKey: { $in: keys },
    }).lean();
    const byGov = new Map(mappings.map((m) => [m.govEmployerKey, m]));

    return res.json({
      pagination: { page, limit, total, totalPages: total === 0 ? 1 : Math.ceil(total / limit) },
      employers: rows.map((r) => {
        const m = byGov.get(r.employerNameKey);
        return {
          id: String(r._id),
          employerNameKey: r.employerNameKey,
          employerNameDisplay: r.employerNameDisplay,
          certifiedCount: r.certifiedCount,
          totalFilings: r.totalFilings,
          firstFilingYear: r.firstFilingYear,
          lastFilingYear: r.lastFilingYear,
          yearsActive: r.yearsActive,
          topJobTitles: r.topJobTitles,
          topSocCodes: r.topSocCodes,
          topStates: r.topStates,
          dataAsOf: r.dataAsOf,
          mapping: m
            ? {
                brandName: m.brandName,
                confidence: m.confidence,
                status: m.status,
                matchMethod: m.matchMethod,
                id: String(m._id),
              }
            : null,
        };
      }),
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to search employers' });
  }
});

/** Exception queue — pending_review only (auto-approved never appear here). */
router.get('/h1b/mappings/pending', async (req: any, res: any) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '25'), 10) || 25));
    const match = { status: 'pending_review' };
    const [total, rows] = await Promise.all([
      EmployerBrandMapping.countDocuments(match),
      EmployerBrandMapping.find(match)
        .sort({ confidence: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    const govKeys = rows.map((r) => r.govEmployerKey);
    const govs = await GovEmployer.find({ employerNameKey: { $in: govKeys } }).lean();
    const govByKey = new Map(govs.map((g) => [g.employerNameKey, g]));

    return res.json({
      pagination: { page, limit, total, totalPages: total === 0 ? 1 : Math.ceil(total / limit) },
      mappings: rows.map((m) => {
        const g = govByKey.get(m.govEmployerKey);
        return {
          id: String(m._id),
          govEmployerKey: m.govEmployerKey,
          govDisplay: g?.employerNameDisplay || m.govEmployerKey,
          certifiedCount: g?.certifiedCount || 0,
          brandName: m.brandName,
          brandId: String(m.brandId),
          confidence: m.confidence,
          matchMethod: m.matchMethod,
          status: m.status,
        };
      }),
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Failed to load pending mappings' });
  }
});

router.post('/h1b/mappings/:id/approve', async (req: any, res: any) => {
  try {
    const id = String(req.params.id || '').trim();
    const userId = String(req.user?.id || req.user?._id || '');
    const mapping = await EmployerBrandMapping.findById(id);
    if (!mapping) return res.status(404).json({ error: 'Mapping not found' });

    mapping.status = 'approved';
    mapping.reviewedBy = userId;
    mapping.reviewedAt = new Date();
    await mapping.save();

    const brand = await CompanyBrand.findById(mapping.brandId);
    if (brand) {
      const alias = mapping.govEmployerKey;
      const gov = await GovEmployer.findOne({ employerNameKey: mapping.govEmployerKey }).lean();
      const display = gov?.employerNameDisplay || alias;
      await CompanyBrand.updateOne(
        { _id: brand._id },
        {
          $addToSet: {
            aliases: display,
            aliasKeys: employerNameNormalize(display).key || alias,
          },
        }
      );
    }

    await buildSponsorshipProfiles();
    return res.json({ ok: true, status: 'approved' });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Approve failed' });
  }
});

router.post('/h1b/mappings/:id/reject', async (req: any, res: any) => {
  try {
    const id = String(req.params.id || '').trim();
    const userId = String(req.user?.id || req.user?._id || '');
    const reason = String(req.body?.reason || '').trim();
    const mapping = await EmployerBrandMapping.findById(id);
    if (!mapping) return res.status(404).json({ error: 'Mapping not found' });

    mapping.status = 'rejected';
    mapping.reviewedBy = userId;
    mapping.reviewedAt = new Date();
    await mapping.save();

    await MappingRejection.findOneAndUpdate(
      { govEmployerKey: mapping.govEmployerKey },
      {
        $set: {
          govEmployerKey: mapping.govEmployerKey,
          brandId: mapping.brandId,
          brandName: mapping.brandName,
          reason,
          rejectedBy: userId,
        },
      },
      { upsert: true }
    );

    return res.json({ ok: true, status: 'rejected' });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Reject failed' });
  }
});

/** Count open board jobs for a brand/company name (CTA from explorer). */
router.get('/h1b/brand-jobs-count', async (req: any, res: any) => {
  try {
    const company = String(req.query.company || '').trim();
    if (!company) return res.json({ count: 0 });
    const ownerId = normalizeOwnerIdForWrite(String(req.user?.id || req.user?._id || ''));
    const re = new RegExp(`^${escapeRegex(company)}$`, 'i');
    const count = await JobBoardListing.countDocuments({
      ...(ownerId ? { ownerId } : {}),
      status: 'ready',
      companyName: re,
    });
    return res.json({ count });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Count failed' });
  }
});

export default router;

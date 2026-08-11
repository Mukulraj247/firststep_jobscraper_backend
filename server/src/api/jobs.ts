import { Router } from 'express';
import mongoose from 'mongoose';
import { requireSignInOrApiKey } from '../middlewares/auth';
import JobBoardListing from '../models/JobBoardListing';
import logger from '../logger';
import { normalizeOwnerIdForWrite } from '../utils/ownerId';
import {
  decodeHtmlEntities,
  pickBestDescription,
  sanitizeCompanyName,
  normalizeJobDescription,
  normalizeSalaryRange,
  normalizeLocation,
  deriveFieldsFromDescription,
  descriptionQualityScore,
  isBoardQualityPass,
  isGenericJobTitle,
  preferJobUrlTitle,
  titleFromJobUrl,
} from '../services/jobPageParser';

const router = Router();

router.use(requireSignInOrApiKey);

type FacetCacheEntry = {
  expiresAt: number;
  companies: string[];
  categories: string[];
};

type CountCacheEntry = {
  expiresAt: number;
  total: number;
};

const FACET_TTL_MS = 5 * 60 * 1000;
const COUNT_TTL_MS = 30 * 1000;
const MIN_DETAIL_DESC_CHARS = 60;
const facetCache = new Map<string, FacetCacheEntry>();
const countCache = new Map<string, CountCacheEntry>();

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Expand short brands so "JPMC" still matches enriched "JPMorgan Chase". */
function companyNameMatchers(company: string): RegExp[] {
  const raw = company.trim();
  if (!raw) return [];
  const key = raw.toLowerCase();
  const aliasMap: Record<string, string[]> = {
    jpmc: ['JPMC', 'JPMorgan Chase', 'JPMorgan', 'J\\.P\\. Morgan', 'Chase'],
    'jpmorgan chase': ['JPMC', 'JPMorgan Chase', 'JPMorgan', 'J\\.P\\. Morgan', 'Chase'],
    jpmorgan: ['JPMC', 'JPMorgan Chase', 'JPMorgan', 'J\\.P\\. Morgan'],
    chase: ['Chase', 'JPMC', 'JPMorgan Chase'],
    oraclecloud: ['JPMorgan Chase', 'JPMC', 'JPMorgan'],
  };
  const names = aliasMap[key] || [escapeRegex(raw)];
  return names.map((n) => new RegExp(`^${n}$`, 'i'));
}

function companyFilterClause(company: string): Record<string, any> | null {
  const matchers = companyNameMatchers(company);
  if (matchers.length === 0) return null;
  return {
    $or: matchers.flatMap((re) => [
      { companyName: re },
      { 'listSnapshot.companyName': re },
    ]),
  };
}

/** Prefer detail enrichment, but list-complete rows are allowed when description is usable. */
function boardMatch(ownerId: string): Record<string, any> {
  return {
    ownerId,
    status: { $in: ['ready', 'partial'] },
    'enrichment.method': { $in: ['ats', 'scrape.do', 'list', 'llm'] },
    $or: [
      {
        jobDescription: { $exists: true, $type: 'string', $ne: '' },
        $expr: {
          $gte: [{ $strLenCP: { $ifNull: ['$jobDescription', ''] } }, MIN_DETAIL_DESC_CHARS],
        },
      },
      {
        'listSnapshot.jobDescription': { $exists: true, $type: 'string', $ne: '' },
        $expr: {
          $gte: [
            { $strLenCP: { $ifNull: ['$listSnapshot.jobDescription', ''] } },
            MIN_DETAIL_DESC_CHARS,
          ],
        },
      },
    ],
  };
}

function mapListingToJob(row: any, opts?: { fullDescription?: boolean }) {
  const list = row.listSnapshot || {};
  let title = decodeHtmlEntities(row.jobTitle || list.jobTitle || '');
  const jobUrl = row.jobUrl || '';
  title = preferJobUrlTitle(title, jobUrl || row.applyUrl || '');
  const company =
    sanitizeCompanyName(row.companyName || '') ||
    sanitizeCompanyName(list.companyName || '') ||
    '';
  const description = normalizeJobDescription(
    pickBestDescription(row.jobDescription || '', list.jobDescription || '')
  );
  if (
    !isBoardQualityPass({
      title,
      description,
      jobUrl: jobUrl || row.applyUrl || '',
    })
  ) {
    return null;
  }
  // List cards need structured preview (keep newlines) so UI can extract quals/benefits.
  // Full JD still loads on detail GET.
  const CARD_PREVIEW_CHARS = 6500;
  const snippet = opts?.fullDescription
    ? description
    : description.length <= CARD_PREVIEW_CHARS
      ? description
      : `${description.slice(0, CARD_PREVIEW_CHARS).trim()}…`;
  const location = normalizeLocation(
    decodeHtmlEntities(row.location || list.location || '')
  );
  const category = decodeHtmlEntities(row.jobCategory || list.jobCategory || '');
  const salary = normalizeSalaryRange(
    decodeHtmlEntities(row.salaryRange || list.salaryRange || ''),
    { location }
  );
  const employment = decodeHtmlEntities(row.employmentType || list.employmentType || '');
  const remote = decodeHtmlEntities(row.remoteType || list.remoteType || '');
  const industry = decodeHtmlEntities(row.sectorIndustry || list.sectorIndustry || '');
  const jobId = String(row.jobId || '').trim();
  const applyUrl = row.applyUrl || jobUrl;
  const date = row.date || list.date || row.createdAt;
  const logo = String(row.companyLogoUrl || '').trim();
  const descScore = descriptionQualityScore(description);
  const derived =
    descScore > 0
      ? deriveFieldsFromDescription(description)
      : { jobExperience: 0, employmentType: '', remoteType: '' };
  const jobExperience =
    (typeof row.jobExperience === 'number' && row.jobExperience > 0 ? row.jobExperience : 0) ||
    (typeof list.jobExperience === 'number' && list.jobExperience > 0 ? list.jobExperience : 0) ||
    derived.jobExperience ||
    0;
  const employmentFinal = employment || derived.employmentType;
  const remoteFinal = remote || (descScore > 0 ? derived.remoteType : '');

  const asStringList = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x || '').trim()).filter(Boolean) : [];

  const about = decodeHtmlEntities(String(row.about || '').trim());
  const minimumQualifications = asStringList(row.minimumQualifications);
  const preferredQualifications = asStringList(row.preferredQualifications);
  const responsibilities = asStringList(row.responsibilities);
  const benefits = asStringList(row.benefits);
  const skills = asStringList(row.skills);

  return {
    id: row._id?.toString?.() || String(row.id),
    createdAt: row.createdAt || row.lastSeenAt,
    data: {
      jobId,
      jobUrl,
      applyUrl,
      jobTitle: title,
      companyName: company,
      jobDescription: snippet,
      jobCategory: category,
      date,
      location,
      salaryRange: salary,
      employmentType: employmentFinal,
      remoteType: remoteFinal,
      jobExperience,
      sectorIndustry: industry,
      f500: row.f500 || list.f500 || '',
      companyLogoUrl: logo,
      status: row.status,
      enrichmentMethod: row.enrichment?.method || '',
      lastEnrichedAt: row.enrichment?.lastEnrichedAt || null,
      ...(about ? { about } : {}),
      ...(minimumQualifications.length ? { minimumQualifications } : {}),
      ...(preferredQualifications.length ? { preferredQualifications } : {}),
      ...(responsibilities.length ? { responsibilities } : {}),
      ...(benefits.length ? { benefits } : {}),
      ...(skills.length ? { skills } : {}),
    },
  };
}

async function getFacets(ownerId: string): Promise<{ companies: string[]; categories: string[] }> {
  const cached = facetCache.get(ownerId);
  if (cached && cached.expiresAt > Date.now()) {
    return { companies: cached.companies, categories: cached.categories };
  }

  const match = boardMatch(ownerId);

  const [companyFacets, categoryFacets] = await Promise.all([
    JobBoardListing.aggregate([
      { $match: match },
      {
        $project: {
          companyName: {
            $cond: [
              { $and: [{ $ne: ['$companyName', null] }, { $ne: ['$companyName', ''] }] },
              '$companyName',
              { $ifNull: ['$listSnapshot.companyName', ''] },
            ],
          },
        },
      },
      { $group: { _id: '$companyName', count: { $sum: 1 } } },
      { $match: { _id: { $nin: [null, ''] } } },
      { $sort: { count: -1 } },
      { $limit: 40 },
    ]),
    JobBoardListing.aggregate([
      { $match: match },
      {
        $project: {
          jobCategory: {
            $cond: [
              { $and: [{ $ne: ['$jobCategory', null] }, { $ne: ['$jobCategory', ''] }] },
              '$jobCategory',
              { $ifNull: ['$listSnapshot.jobCategory', ''] },
            ],
          },
        },
      },
      { $group: { _id: '$jobCategory', count: { $sum: 1 } } },
      { $match: { _id: { $nin: [null, ''] } } },
      { $sort: { count: -1 } },
      { $limit: 40 },
    ]),
  ]);

  const companies = [
    ...new Set(
      companyFacets
        .map((f: any) => sanitizeCompanyName(String(f._id || '')))
        .filter(Boolean)
    ),
  ];
  const categories = categoryFacets
    .map((f: any) => decodeHtmlEntities(String(f._id || '')))
    .filter(Boolean);
  facetCache.set(ownerId, { expiresAt: Date.now() + FACET_TTL_MS, companies, categories });
  return { companies, categories };
}

async function getCachedCount(cacheKey: string, match: Record<string, any>): Promise<number> {
  const cached = countCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.total;
  const total = await JobBoardListing.countDocuments(match);
  countCache.set(cacheKey, { expiresAt: Date.now() + COUNT_TTL_MS, total });
  return total;
}

router.get('/jobs', async (req: any, res: any) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
    const offset = (page - 1) * limit;
    const q = String(req.query.q || '').trim();
    const company = String(req.query.company || '').trim();
    const category = String(req.query.category || '').trim();
    const ownerId = normalizeOwnerIdForWrite(req.user.id);

    const match: Record<string, any> = boardMatch(ownerId);

    if (company) {
      const clause = companyFilterClause(company);
      if (clause) {
        match.$and = [...(match.$and || []), clause];
      }
    }
    if (category) {
      match.$and = [
        ...(match.$and || []),
        {
          $or: [
            { jobCategory: new RegExp(`^${escapeRegex(category)}$`, 'i') },
            { 'listSnapshot.jobCategory': new RegExp(`^${escapeRegex(category)}$`, 'i') },
          ],
        },
      ];
    }

    if (q) {
      if (q.length >= 3) {
        match.$text = { $search: q };
      } else {
        const re = new RegExp(escapeRegex(q), 'i');
        match.$and = [
          ...(match.$and || []),
          {
            $or: [
              { jobTitle: re },
              { companyName: re },
              { location: re },
              { 'listSnapshot.jobTitle': re },
            ],
          },
        ];
      }
    }

    const countKey = JSON.stringify({ ownerId, company, category, q, v: 7 });
    const useText = q.length >= 3;
    const projection: Record<string, any> = {
      jobUrl: 1,
      applyUrl: 1,
      jobId: 1,
      jobTitle: 1,
      companyName: 1,
      jobDescription: 1,
      descriptionSnippet: 1,
      jobCategory: 1,
      location: 1,
      salaryRange: 1,
      employmentType: 1,
      remoteType: 1,
      jobExperience: 1,
      sectorIndustry: 1,
      f500: 1,
      date: 1,
      status: 1,
      enrichment: 1,
      companyLogoUrl: 1,
      listSnapshot: 1,
      createdAt: 1,
      lastSeenAt: 1,
    };
    if (useText) projection.score = { $meta: 'textScore' };

    let query = JobBoardListing.find(match).select(projection);
    if (useText) {
      query = query.sort({ score: { $meta: 'textScore' }, date: -1 });
    } else {
      query = query.sort({ date: -1, createdAt: -1 });
    }

    const [total, rows, facets] = await Promise.all([
      getCachedCount(countKey, match),
      query.skip(offset).limit(limit).lean(),
      getFacets(ownerId),
    ]);

    return res.json({
      pagination: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 1 : Math.ceil(total / limit),
      },
      jobs: rows
        .map((row) => mapListingToJob(row, { fullDescription: false }))
        .filter(Boolean),
      filters: {
        companies: facets.companies,
        categories: facets.categories,
      },
    });
  } catch (error: any) {
    logger.log('error', `Failed to fetch jobs: ${error.message}`);
    return res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

router.get('/jobs/:id', async (req: any, res: any) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const ownerId = normalizeOwnerIdForWrite(req.user.id);
    const row: any = await JobBoardListing.findOne({
      _id: id,
      ownerId,
      status: { $in: ['ready', 'partial'] },
    })
      .select(
        'jobUrl applyUrl jobId jobTitle companyName jobDescription descriptionSnippet jobCategory location salaryRange employmentType remoteType jobExperience sectorIndustry f500 date status enrichment companyLogoUrl listSnapshot createdAt lastSeenAt'
      )
      .lean();

    if (!row) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const job = mapListingToJob(row, { fullDescription: true });
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    return res.json({ job });
  } catch (error: any) {
    logger.log('error', `Failed to fetch job ${req.params.id}: ${error.message}`);
    return res.status(500).json({ error: 'Failed to fetch job' });
  }
});

export default router;

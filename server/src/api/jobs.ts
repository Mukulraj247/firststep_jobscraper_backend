import { Router } from 'express';
import mongoose from 'mongoose';
import { requireSignInOrApiKey } from '../middlewares/auth';
import JobBoardListing from '../models/JobBoardListing';
import logger from '../logger';
import { normalizeOwnerIdForWrite } from '../utils/ownerId';
import { applyJobBoardListFilters, addedSinceFromPreset } from '../services/jobBoardQuery';
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
  locations: string[];
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
    // `partial` rows are incomplete enrichment results and are never
    // board-eligible. Excluding them keeps pagination totals and badges aligned
    // with the cards that pass the final in-process quality gate.
    status: 'ready',
    'enrichment.method': { $in: ['ats', 'scrape.do', 'browser', 'list', 'llm'] },
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

function mapListingToJob(row: any, opts?: { fullDescription?: boolean; allowIncomplete?: boolean }) {
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
    !opts?.allowIncomplete &&
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
  const locationRaw = decodeHtmlEntities(row.location || list.location || '');
  const location = /United States|India|Kingdom|Canada|Australia|, [A-Z]{2}\b/.test(locationRaw)
    ? locationRaw.replace(/\s+/g, ' ').trim()
    : normalizeLocation(locationRaw);
  const category = decodeHtmlEntities(row.jobCategory || list.jobCategory || '');
  const salaryRaw = decodeHtmlEntities(row.salaryRange || list.salaryRange || '');
  const salary = /\/(?:hr|yr|mo|wk|day)\b/i.test(salaryRaw)
    ? salaryRaw
    : normalizeSalaryRange(salaryRaw, { location });
  const employment = decodeHtmlEntities(row.employmentType || list.employmentType || '');
  const remote = decodeHtmlEntities(row.remoteType || list.remoteType || '');
  const industry = decodeHtmlEntities(row.sectorIndustry || list.sectorIndustry || '');
  const jobId = String(row.jobId || '').trim();
  const rawApply = String(row.applyUrl || '').trim();
  let applyUrl = rawApply;
  try {
    const host = rawApply ? new URL(rawApply).hostname.toLowerCase().replace(/^www\./, '') : '';
    const isHc =
      host === 'hiring.cafe' || host === 'hiringcafe.com' || host.endsWith('.hiring.cafe');
    if (!rawApply || isHc) applyUrl = '';
  } catch {
    applyUrl = rawApply;
  }
  const dateRaw = row.date || list.date;
  const createdAt = row.createdAt || row.lastSeenAt;
  const postedMs = dateRaw ? new Date(dateRaw).getTime() : NaN;
  const date =
    Number.isFinite(postedMs) && postedMs <= Date.now() ? dateRaw : createdAt;
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

  const about = decodeHtmlEntities(String(row.about || list.about || '').trim());
  const minimumQualifications = asStringList(row.minimumQualifications || list.minimumQualifications);
  const preferredQualifications = asStringList(
    row.preferredQualifications || list.preferredQualifications
  );
  const responsibilities = asStringList(row.responsibilities || list.responsibilities);
  const benefits = asStringList(row.benefits || list.benefits);
  const skills = asStringList(row.skills || list.skills);
  const logo = String(row.companyLogoUrl || list.companyLogoUrl || '').trim();
  const f500 = String(row.f500 || list.f500 || '').trim();

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
      f500,
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

async function getFacets(
  ownerId: string,
): Promise<{ companies: string[]; categories: string[]; locations: string[] }> {
  const cached = facetCache.get(ownerId);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      companies: cached.companies,
      categories: cached.categories,
      locations: cached.locations || [],
    };
  }

  const match = boardMatch(ownerId);

  const [companyFacets, categoryFacets, locationFacets] = await Promise.all([
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
    JobBoardListing.aggregate([
      { $match: match },
      {
        $project: {
          location: {
            $cond: [
              { $and: [{ $ne: ['$location', null] }, { $ne: ['$location', ''] }] },
              '$location',
              { $ifNull: ['$listSnapshot.location', ''] },
            ],
          },
        },
      },
      { $group: { _id: '$location', count: { $sum: 1 } } },
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
  const locations = locationFacets
    .map((f: any) => normalizeLocation(decodeHtmlEntities(String(f._id || ''))))
    .filter(Boolean);
  const uniqueLocations = [...new Set(locations)];
  facetCache.set(ownerId, {
    expiresAt: Date.now() + FACET_TTL_MS,
    companies,
    categories,
    locations: uniqueLocations,
  });
  return { companies, categories, locations: uniqueLocations };
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
    const location = String(req.query.location || '').trim();
    const workMode = String(req.query.workMode || '').trim();
    const jobType = String(req.query.jobType || '').trim();
    const added = String(req.query.added || 'all').trim();
    const runId = String(req.query.runId || '').trim();
    const ownerId = normalizeOwnerIdForWrite(req.user.id);

    // When filtering by run, include listings this run touched (may still be queued/enriching).
    let match: Record<string, any> = runId
      ? { ownerId, runIds: runId }
      : boardMatch(ownerId);

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
              { 'listSnapshot.companyName': re },
            ],
          },
        ];
      }
    }

    match = applyJobBoardListFilters(match, {
      addedSince: addedSinceFromPreset(added),
      location,
      workMode,
      jobType,
      source: req.query.source != null ? String(req.query.source).trim() : '',
    });

    const countKey = JSON.stringify({
      ownerId,
      company,
      category,
      q,
      runId,
      location,
      workMode,
      jobType,
      added,
      source: req.query.source != null ? String(req.query.source).trim() : '',
      v: 11,
    });
    const useText = !runId && q.length >= 3;
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
      runIds: 1,
    };
    if (useText) projection.score = { $meta: 'textScore' };

    let query = JobBoardListing.find(match).select(projection);
    if (useText) {
      query = query.sort({ score: { $meta: 'textScore' }, createdAt: -1 });
    } else if (added !== 'all') {
      query = query.sort({ createdAt: -1 });
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
        .map((row) =>
          mapListingToJob(row, { fullDescription: false, allowIncomplete: !!runId })
        )
        .filter(Boolean),
      filters: {
        categories: facets.categories,
        locations: facets.locations,
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

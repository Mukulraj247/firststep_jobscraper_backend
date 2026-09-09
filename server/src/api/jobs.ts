import { Router } from 'express';
import mongoose from 'mongoose';
import { requireSignInOrApiKey } from '../middlewares/auth';
import JobBoardListing from '../models/JobBoardListing';
import logger from '../logger';
import { normalizeOwnerIdForWrite } from '../utils/ownerId';
import { applyJobBoardListFilters, addedSinceFromPreset } from '../services/jobBoardQuery';
import {
  FROZEN_JOB_CATEGORIES,
  normalizeFrozenCategoryFilter,
} from '../../../src/shared/frozenJobCategories';
import {
  FROZEN_INDUSTRIES,
  normalizeFrozenIndustryFilter,
} from '../../../src/shared/frozenIndustries';
import {
  FROZEN_EXPERIENCE_LEVELS,
  FROZEN_EXPERIENCE_YEARS,
  normalizeExperienceLevelFilter,
  normalizeExperienceYearFilter,
} from '../../../src/shared/frozenExperience';
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
import { isAggregatorApplyHost } from '../services/aggregatorIdentity';
import { deriveChoppingBlockCompany } from '../services/choppingblockDetail';
import {
  HIRING_CAFE_ENRICHMENT_EXHAUSTED,
  HIRING_CAFE_ENRICHMENT_MAX_ATTEMPTS,
  isHiringCafeBoardReady,
  isSkillsDumpDescription,
} from '../services/hiringCafeEnrichmentPolicy';

const router = Router();

router.use(requireSignInOrApiKey);

type FacetCacheEntry = {
  expiresAt: number;
  companies: string[];
  categories: string[];
  frozenCategories: string[];
  frozenIndustries: string[];
  frozenExperienceLevels: string[];
  frozenExperienceYears: string[];
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
export function boardMatch(ownerId: string): Record<string, any> {
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

export function mapListingToJob(row: any, opts?: { fullDescription?: boolean; allowIncomplete?: boolean }) {
  const list = row.listSnapshot || {};
  let title = decodeHtmlEntities(row.jobTitle || list.jobTitle || '');
  const jobUrl = row.jobUrl || '';
  title = preferJobUrlTitle(title, jobUrl || row.applyUrl || '');
  const description = normalizeJobDescription(
    pickBestDescription(row.jobDescription || '', list.jobDescription || '')
  );
  const companyRaw =
    sanitizeCompanyName(row.companyName || '') ||
    sanitizeCompanyName(list.companyName || '') ||
    '';
  const company =
    String(row.source || '').toLowerCase() === 'choppingblock'
      ? deriveChoppingBlockCompany(
          String(row.aggregatorPostingUrl || list.aggregatorPostingUrl || jobUrl || ''),
          description,
          companyRaw
        ) || companyRaw
      : companyRaw;
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
  if (
    !opts?.allowIncomplete &&
    String(row.source || '').toLowerCase() === 'hiring_cafe' &&
    !isHiringCafeBoardReady({
      title,
      companyName: company,
      description,
      applyUrl: row.applyUrl || '',
      jobUrl: jobUrl || row.applyUrl || '',
    })
  ) {
    return null;
  }
  if (!opts?.allowIncomplete && isSkillsDumpDescription(description)) {
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
    if (!rawApply || isAggregatorApplyHost(host)) {
      applyUrl = '';
    }
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
  const certifications = asStringList(row.certifications || list.certifications);
  const logo = String(row.companyLogoUrl || list.companyLogoUrl || '').trim();
  const f500 = String(row.f500 || list.f500 || '').trim();
  const seniorityLevel = decodeHtmlEntities(
    String(row.seniorityLevel || list.seniorityLevel || '').trim()
  );
  const roleType = decodeHtmlEntities(String(row.roleType || list.roleType || '').trim());
  const educationRequirement = decodeHtmlEntities(
    String(row.educationRequirement || list.educationRequirement || '').trim()
  );
  const visaSponsorship = String(row.visaSponsorship || list.visaSponsorship || '')
    .trim()
    .toLowerCase();
  const companyEmployeeCount =
    (typeof row.companyEmployeeCount === 'number' && row.companyEmployeeCount > 0
      ? row.companyEmployeeCount
      : 0) ||
    (typeof list.companyEmployeeCount === 'number' && list.companyEmployeeCount > 0
      ? list.companyEmployeeCount
      : 0);
  const companyFoundedYear =
    (typeof row.companyFoundedYear === 'number' && row.companyFoundedYear > 0
      ? row.companyFoundedYear
      : 0) ||
    (typeof list.companyFoundedYear === 'number' && list.companyFoundedYear > 0
      ? list.companyFoundedYear
      : 0);
  const companyWebsite = String(row.companyWebsite || list.companyWebsite || '').trim();
  const aggregatorPostingUrl = String(
    row.aggregatorPostingUrl || list.aggregatorPostingUrl || ''
  ).trim();
  const frozenCategories = Array.isArray(row.frozenCategories)
    ? row.frozenCategories.map((x: unknown) => String(x || '').trim()).filter(Boolean)
    : [];
  const frozenIndustries = Array.isArray(row.frozenIndustries)
    ? row.frozenIndustries.map((x: unknown) => String(x || '').trim()).filter(Boolean)
    : [];
  const frozenExperienceLevels = Array.isArray(row.frozenExperienceLevels)
    ? row.frozenExperienceLevels.map((x: unknown) => String(x || '').trim()).filter(Boolean)
    : [];
  const frozenExperienceYears = Array.isArray(row.frozenExperienceYears)
    ? row.frozenExperienceYears.map((x: unknown) => String(x || '').trim()).filter(Boolean)
    : [];
  const h1bEligible = Boolean(row.h1bEligible);
  const h1bCompanyScore = String(row.h1bCompanyScore || 'unknown');
  const h1bRoleScore = String(row.h1bRoleScore || 'unknown');
  const h1bCompanyConfidence =
    typeof row.h1bCompanyConfidence === 'number' ? row.h1bCompanyConfidence : 0;
  const h1bRoleConfidence = typeof row.h1bRoleConfidence === 'number' ? row.h1bRoleConfidence : 0;
  const h1bFilingCount = typeof row.h1bFilingCount === 'number' ? row.h1bFilingCount : 0;
  const h1bLastFilingYear = typeof row.h1bLastFilingYear === 'number' ? row.h1bLastFilingYear : 0;
  const h1bMatchedGovEmployer = String(row.h1bMatchedGovEmployer || '').trim();
  const h1bCapExempt = Boolean(row.h1bCapExempt);
  const h1bDataAsOf = row.h1bDataAsOf || null;
  const h1bMappingStatus = String(row.h1bMappingStatus || 'none');
  const h1bFy2026Match = Boolean(row.h1bFy2026Match);
  const h1bFy2026TitleConfidence =
    typeof row.h1bFy2026TitleConfidence === 'number' ? row.h1bFy2026TitleConfidence : 0;
  const h1bFy2026MatchedTitle = String(row.h1bFy2026MatchedTitle || '').trim();
  const h1bFy2026CertifiedCount =
    typeof row.h1bFy2026CertifiedCount === 'number' ? row.h1bFy2026CertifiedCount : 0;
  const h1bFy2026DataAsOf = row.h1bFy2026DataAsOf || null;

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
      ...(certifications.length ? { certifications } : {}),
      ...(seniorityLevel ? { seniorityLevel } : {}),
      ...(roleType ? { roleType } : {}),
      ...(educationRequirement ? { educationRequirement } : {}),
      ...(visaSponsorship === 'yes' || visaSponsorship === 'no'
        ? { visaSponsorship }
        : {}),
      ...(companyEmployeeCount > 0 ? { companyEmployeeCount } : {}),
      ...(companyFoundedYear > 0 ? { companyFoundedYear } : {}),
      ...(companyWebsite ? { companyWebsite } : {}),
      ...(aggregatorPostingUrl ? { aggregatorPostingUrl } : {}),
      ...(frozenCategories.length ? { frozenCategories } : {}),
      ...(frozenIndustries.length ? { frozenIndustries } : {}),
      ...(frozenExperienceLevels.length ? { frozenExperienceLevels } : {}),
      ...(frozenExperienceYears.length ? { frozenExperienceYears } : {}),
      ...(h1bEligible
        ? {
            h1bEligible,
            h1bCompanyScore,
            h1bRoleScore,
            h1bCompanyConfidence,
            h1bRoleConfidence,
            h1bFilingCount,
            h1bLastFilingYear,
            ...(h1bMatchedGovEmployer ? { h1bMatchedGovEmployer } : {}),
            h1bCapExempt,
            ...(h1bDataAsOf ? { h1bDataAsOf } : {}),
            h1bMappingStatus,
          }
        : {}),
      ...(h1bFy2026Match
        ? {
            h1bFy2026Match: true,
            h1bFy2026TitleConfidence,
            ...(h1bFy2026MatchedTitle ? { h1bFy2026MatchedTitle } : {}),
            h1bFy2026CertifiedCount,
            ...(h1bFy2026DataAsOf ? { h1bFy2026DataAsOf } : {}),
          }
        : {}),
    },
  };
}

async function getFacets(
  ownerId: string,
): Promise<{
  companies: string[];
  categories: string[];
  frozenCategories: string[];
  frozenIndustries: string[];
  frozenExperienceLevels: string[];
  frozenExperienceYears: string[];
  locations: string[];
}> {
  const cached = facetCache.get(ownerId);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      companies: cached.companies,
      categories: cached.categories,
      frozenCategories: cached.frozenCategories || [],
      frozenIndustries: cached.frozenIndustries || [],
      frozenExperienceLevels: cached.frozenExperienceLevels || [],
      frozenExperienceYears: cached.frozenExperienceYears || [],
      locations: cached.locations || [],
    };
  }

  const match = boardMatch(ownerId);

  const [
    companyFacets,
    categoryFacets,
    frozenCategoryFacets,
    frozenIndustryFacets,
    frozenExperienceLevelFacets,
    frozenExperienceYearFacets,
    locationFacets,
  ] =
    await Promise.all([
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
    // Frozen taxonomy facet: only offer categories that actually have jobs.
    JobBoardListing.aggregate([
      { $match: { ...match, frozenCategories: { $nin: [null, []] } } },
      { $project: { frozenCategories: 1 } },
      { $unwind: '$frozenCategories' },
      { $group: { _id: '$frozenCategories', count: { $sum: 1 } } },
      { $match: { _id: { $nin: [null, ''] } } },
      { $sort: { count: -1 } },
      { $limit: FROZEN_JOB_CATEGORIES.length },
    ]),
    JobBoardListing.aggregate([
      { $match: { ...match, frozenIndustries: { $nin: [null, []] } } },
      { $project: { frozenIndustries: 1 } },
      { $unwind: '$frozenIndustries' },
      { $group: { _id: '$frozenIndustries', count: { $sum: 1 } } },
      { $match: { _id: { $nin: [null, ''] } } },
      { $sort: { count: -1 } },
      { $limit: FROZEN_INDUSTRIES.length },
    ]),
    JobBoardListing.aggregate([
      { $match: { ...match, frozenExperienceLevels: { $nin: [null, []] } } },
      { $project: { frozenExperienceLevels: 1 } },
      { $unwind: '$frozenExperienceLevels' },
      { $group: { _id: '$frozenExperienceLevels', count: { $sum: 1 } } },
      { $match: { _id: { $nin: [null, ''] } } },
      { $sort: { count: -1 } },
      { $limit: FROZEN_EXPERIENCE_LEVELS.length },
    ]),
    JobBoardListing.aggregate([
      { $match: { ...match, frozenExperienceYears: { $nin: [null, []] } } },
      { $project: { frozenExperienceYears: 1 } },
      { $unwind: '$frozenExperienceYears' },
      { $group: { _id: '$frozenExperienceYears', count: { $sum: 1 } } },
      { $match: { _id: { $nin: [null, ''] } } },
      { $sort: { count: -1 } },
      { $limit: FROZEN_EXPERIENCE_YEARS.length },
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
  // Taxonomy order (not count order) so the filter list stays put between reloads.
  const presentFrozen = new Set(
    frozenCategoryFacets.map((f: any) => String(f._id || '').trim()).filter(Boolean)
  );
  const frozenCategories = FROZEN_JOB_CATEGORIES.filter((name) => presentFrozen.has(name));
  const presentIndustry = new Set(
    frozenIndustryFacets.map((f: any) => String(f._id || '').trim()).filter(Boolean)
  );
  const frozenIndustries = FROZEN_INDUSTRIES.filter((name) => presentIndustry.has(name));
  const presentExpLevels = new Set(
    frozenExperienceLevelFacets.map((f: any) => String(f._id || '').trim()).filter(Boolean)
  );
  const frozenExperienceLevels = FROZEN_EXPERIENCE_LEVELS.filter((name) =>
    presentExpLevels.has(name)
  );
  const presentExpYears = new Set(
    frozenExperienceYearFacets.map((f: any) => String(f._id || '').trim()).filter(Boolean)
  );
  const frozenExperienceYears = FROZEN_EXPERIENCE_YEARS.filter((name) => presentExpYears.has(name));
  const locations = locationFacets
    .map((f: any) => normalizeLocation(decodeHtmlEntities(String(f._id || ''))))
    .filter(Boolean);
  const uniqueLocations = [...new Set(locations)];
  facetCache.set(ownerId, {
    expiresAt: Date.now() + FACET_TTL_MS,
    companies,
    categories,
    frozenCategories,
    frozenIndustries,
    frozenExperienceLevels,
    frozenExperienceYears,
    locations: uniqueLocations,
  });
  return {
    companies,
    categories,
    frozenCategories,
    frozenIndustries,
    frozenExperienceLevels,
    frozenExperienceYears,
    locations: uniqueLocations,
  };
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
    const frozenCategories = normalizeFrozenCategoryFilter(req.query.frozenCategory);
    const frozenIndustries = normalizeFrozenIndustryFilter(req.query.frozenIndustry);
    const frozenExperienceLevels = normalizeExperienceLevelFilter(req.query.frozenExperienceLevel);
    const frozenExperienceYears = normalizeExperienceYearFilter(req.query.frozenExperienceYear);
    const location = String(req.query.location || '').trim();
    const workMode = String(req.query.workMode || '').trim();
    const jobType = String(req.query.jobType || '').trim();
    const added = String(req.query.added || 'all').trim();
    const runId = String(req.query.runId || '').trim();
    const h1bSponsorFriendly =
      String(req.query.h1bSponsorFriendly || '').trim().toLowerCase() === 'true' ||
      String(req.query.h1bSponsorFriendly || '').trim() === '1';
    const h1bFy2026Match =
      String(req.query.h1bFy2026Match || '').trim().toLowerCase() === 'true' ||
      String(req.query.h1bFy2026Match || '').trim() === '1';
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
    // Frozen categories are a controlled taxonomy stored exactly as tagged, so an
    // indexed `$in` (match any selected category) is enough — no regex needed.
    if (frozenCategories.length) {
      match.$and = [...(match.$and || []), { frozenCategories: { $in: frozenCategories } }];
    }
    if (frozenIndustries.length) {
      match.$and = [...(match.$and || []), { frozenIndustries: { $in: frozenIndustries } }];
    }
    if (frozenExperienceLevels.length) {
      match.$and = [
        ...(match.$and || []),
        { frozenExperienceLevels: { $in: frozenExperienceLevels } },
      ];
    }
    if (frozenExperienceYears.length) {
      match.$and = [
        ...(match.$and || []),
        { frozenExperienceYears: { $in: frozenExperienceYears } },
      ];
    }
    if (h1bSponsorFriendly) {
      match.$and = [
        ...(match.$and || []),
        {
          h1bEligible: true,
          h1bCompanyScore: 'high',
          h1bMappingStatus: { $in: ['auto', 'approved'] },
        },
      ];
    }
    if (h1bFy2026Match) {
      match.$and = [
        ...(match.$and || []),
        {
          h1bEligible: true,
          h1bFy2026Match: true,
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
      frozenCategories,
      frozenIndustries,
      frozenExperienceLevels,
      frozenExperienceYears,
      q,
      runId,
      location,
      workMode,
      jobType,
      added,
      source: req.query.source != null ? String(req.query.source).trim() : '',
      h1bSponsorFriendly,
      h1bFy2026Match,
      v: 22,
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
      frozenCategories: 1,
      frozenIndustries: 1,
      frozenExperienceLevels: 1,
      frozenExperienceYears: 1,
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
      about: 1,
      minimumQualifications: 1,
      preferredQualifications: 1,
      responsibilities: 1,
      benefits: 1,
      skills: 1,
      certifications: 1,
      seniorityLevel: 1,
      roleType: 1,
      educationRequirement: 1,
      visaSponsorship: 1,
      h1bEligible: 1,
      h1bCompanyScore: 1,
      h1bRoleScore: 1,
      h1bCompanyConfidence: 1,
      h1bRoleConfidence: 1,
      h1bFilingCount: 1,
      h1bLastFilingYear: 1,
      h1bMatchedGovEmployer: 1,
      h1bCapExempt: 1,
      h1bDataAsOf: 1,
      h1bMappingStatus: 1,
      h1bFy2026Match: 1,
      h1bFy2026TitleConfidence: 1,
      h1bFy2026MatchedTitle: 1,
      h1bFy2026CertifiedCount: 1,
      h1bFy2026DataAsOf: 1,
      companyEmployeeCount: 1,
      companyFoundedYear: 1,
      companyWebsite: 1,
      aggregatorPostingUrl: 1,
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
        frozenCategories: facets.frozenCategories,
        frozenIndustries: facets.frozenIndustries,
        frozenExperienceLevels: facets.frozenExperienceLevels,
        frozenExperienceYears: facets.frozenExperienceYears,
        locations: facets.locations,
      },
    });
  } catch (error: any) {
    logger.log('error', `Failed to fetch jobs: ${error.message}`);
    return res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

/** Exhausted Hiring Cafe enrichments (hidden from board) for Failure Dashboard. */
router.get('/jobs/enrichment-failures', async (req: any, res: any) => {
  try {
    const ownerId = normalizeOwnerIdForWrite(req.user.id);
    const page = Math.max(0, parseInt(String(req.query.page || '0'), 10) || 0);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '25'), 10) || 25));
    const q = String(req.query.q || '').trim();

    const match: Record<string, any> = {
      ownerId,
      source: 'hiring_cafe',
      status: { $in: ['partial', 'failed'] },
      $or: [
        { 'enrichment.attempts': { $gte: HIRING_CAFE_ENRICHMENT_MAX_ATTEMPTS } },
        { 'enrichment.lastError': HIRING_CAFE_ENRICHMENT_EXHAUSTED },
      ],
    };
    if (q) {
      const re = new RegExp(escapeRegex(q), 'i');
      match.$and = [
        {
          $or: [
            { jobTitle: re },
            { companyName: re },
            { jobUrl: re },
            { aggregatorPostingUrl: re },
            { 'enrichment.lastError': re },
          ],
        },
      ];
    }

    const [total, rows] = await Promise.all([
      JobBoardListing.countDocuments(match),
      JobBoardListing.find(match)
        .sort({ 'enrichment.lastEnrichedAt': -1, updatedAt: -1 })
        .skip(page * limit)
        .limit(limit)
        .select(
          'jobTitle companyName jobUrl applyUrl aggregatorPostingUrl status enrichment updatedAt createdAt listSnapshot'
        )
        .lean(),
    ]);

    return res.json({
      total,
      page,
      limit,
      items: rows.map((row: any) => {
        const list = row.listSnapshot || {};
        return {
          id: String(row._id),
          title: row.jobTitle || list.jobTitle || '',
          company: row.companyName || list.companyName || '',
          jobUrl: row.jobUrl || '',
          aggregatorPostingUrl: row.aggregatorPostingUrl || list.aggregatorPostingUrl || '',
          applyUrl: row.applyUrl || '',
          status: row.status,
          attempts: Number(row.enrichment?.attempts || 0),
          lastError: String(row.enrichment?.lastError || ''),
          lastEnrichedAt: row.enrichment?.lastEnrichedAt || null,
          updatedAt: row.updatedAt || null,
        };
      }),
    });
  } catch (error: any) {
    logger.log('error', `Failed to fetch enrichment failures: ${error.message}`);
    return res.status(500).json({ error: 'Failed to fetch enrichment failures' });
  }
});

/** Manual requeue — resets attempts so enrichment can try a fresh 10. */
router.post('/jobs/enrichment-failures/:id/requeue', async (req: any, res: any) => {
  try {
    const id = String(req.params.id || '').trim();
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ error: 'Listing not found' });
    }
    const ownerId = normalizeOwnerIdForWrite(req.user.id);
    const result = await JobBoardListing.updateOne(
      {
        _id: id,
        ownerId,
        source: 'hiring_cafe',
        status: { $in: ['partial', 'failed', 'queued'] },
      },
      {
        $set: {
          status: 'queued',
          priority: 10,
          leaseUntil: null,
          claimedBy: null,
          'enrichment.attempts': 0,
          'enrichment.method': 'none',
          'enrichment.lastError': 'manual_requeue_from_failure_dashboard',
          'enrichment.nextAttemptAt': null,
        },
      }
    );
    if (!result.matchedCount) {
      return res.status(404).json({ error: 'Listing not found' });
    }
    return res.json({ ok: true, requeued: true });
  } catch (error: any) {
    logger.log('error', `Failed to requeue enrichment failure: ${error.message}`);
    return res.status(500).json({ error: 'Failed to requeue' });
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
      status: 'ready',
    })
      .select(
        'jobUrl applyUrl jobId jobTitle companyName jobDescription descriptionSnippet jobCategory frozenCategories frozenIndustries frozenExperienceLevels frozenExperienceYears location salaryRange employmentType remoteType jobExperience sectorIndustry f500 date status enrichment companyLogoUrl about minimumQualifications preferredQualifications responsibilities benefits skills certifications seniorityLevel roleType educationRequirement visaSponsorship h1bEligible h1bCompanyScore h1bRoleScore h1bCompanyConfidence h1bRoleConfidence h1bFilingCount h1bLastFilingYear h1bMatchedGovEmployer h1bCapExempt h1bDataAsOf h1bMappingStatus h1bFy2026Match h1bFy2026TitleConfidence h1bFy2026MatchedTitle h1bFy2026CertifiedCount h1bFy2026DataAsOf companyEmployeeCount companyFoundedYear companyWebsite aggregatorPostingUrl listSnapshot createdAt lastSeenAt'
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

/**
 * Shared Category QA clear + classify helpers (script + UI sample run).
 */
import { createHash } from 'crypto';
import JobBoardListing from '../models/JobBoardListing';
import { isAggregatorListingSource } from './aggregatorIdentity';
import { classifyJobCategories } from './jobCategoryTagger';
import { loadCompanyHistoricalStates } from './companyHistoricalStates';
import { resolveH1bSponsorship } from './h1b/resolveH1bSponsorship';
import { resolveFy2026JobMatch } from './h1b/matchFy2026Role';
import { sanitizeCompanyName } from './jobPageParser';
import {
  INDUSTRY_RULES_VERSION,
  resolveFrozenIndustries,
} from '../../../src/shared/frozenIndustries';
import {
  EXPERIENCE_RULES_VERSION,
  experienceContentHashParts,
  resolveFrozenExperience,
} from '../../../src/shared/frozenExperience';
import {
  LOCATION_RULES_VERSION,
  classifyJobLocation,
} from '../../../src/shared/frozenLocations';
import { detectStudentEscape } from '../../../src/shared/studentEscape';
import logger from '../logger';

export const CATEGORY_QA_UI_BATCH_ID = 'cat-qa-ui-sample';

export function clearedCategoryFields(batchId: string, studentEscape: boolean) {
  return {
    frozenCategories: [] as string[],
    categoryClassification: {
      method: 'rules' as const,
      rulesVersion: '',
      classifierVersion: '',
      classifiedAt: null as Date | null,
      contentHash: '',
    },
    frozenIndustries: [] as string[],
    industryClassification: {
      method: 'none' as const,
      rulesVersion: '',
      classifiedAt: null as Date | null,
      contentHash: '',
    },
    frozenExperienceLevels: [] as string[],
    frozenExperienceYears: [] as string[],
    experienceClassification: {
      method: 'none' as const,
      rulesVersion: '',
      classifiedAt: null as Date | null,
      contentHash: '',
      matchedSignals: [] as string[],
    },
    frozenStates: [] as string[],
    frozenCities: [] as Array<{ name: string; state: string }>,
    locationIsRemote: false,
    locationIsUs: true,
    locationClassification: {
      method: 'none' as const,
      confidence: 0,
      rulesVersion: '',
      classifiedAt: null as Date | null,
      contentHash: '',
    },
    h1bEligible: false,
    h1bCompanyScore: 'unknown' as const,
    h1bRoleScore: 'unknown' as const,
    h1bCompanyConfidence: 0,
    h1bRoleConfidence: 0,
    h1bFilingCount: 0,
    h1bLastFilingYear: 0,
    h1bMatchedGovEmployer: '',
    h1bCapExempt: false,
    h1bDataAsOf: null as Date | null,
    h1bMappingStatus: 'none' as const,
    h1bFy2026Match: false,
    h1bFy2026TitleConfidence: 0,
    h1bFy2026MatchedTitle: '',
    h1bFy2026CertifiedCount: 0,
    h1bFy2026DataAsOf: null as Date | null,
    categoryQaBatchId: batchId,
    categoryQaPhase: studentEscape ? ('student_review' as const) : ('cleared' as const),
    studentEscape,
  };
}

export async function classifyCategoryQaDoc(doc: any): Promise<Record<string, unknown>> {
  const list = doc.listSnapshot || {};
  const title = String(doc.jobTitle || list.jobTitle || '');
  const description = String(doc.jobDescription || list.jobDescription || '');
  const companyName = sanitizeCompanyName(String(doc.companyName || list.companyName || ''));
  const contentHash = String(doc.contentHash || '');
  const source = String(doc.source || '').trim();
  const nowDate = new Date();
  const $set: Record<string, unknown> = {};
  const rawCompany = String(doc.companyName || list.companyName || '').trim();
  // Always persist sanitized employer from ATS/snapshot so industry/H-1B see it
  // even when the listing row companyName was previously cleared.
  if (companyName) {
    $set.companyName = companyName;
  } else if (rawCompany) {
    // Clear Paradox / portal furniture left on the listing
    $set.companyName = '';
  }

  try {
    const tagResult = await classifyJobCategories({
      title,
      description,
      contentHash,
      existingClassification: null,
    });
    if (!tagResult.skipUpdate) {
      $set.frozenCategories = tagResult.frozenCategories;
      if (tagResult.categoryClassification) {
        $set.categoryClassification = tagResult.categoryClassification;
      }
    }
  } catch (err: any) {
    logger.log('warn', `[categoryQa] tagger failed for ${doc._id}: ${err?.message || err}`);
  }

  try {
    const sectorIndustry = String(doc.sectorIndustry || list.sectorIndustry || '').trim();
    const industryResult = resolveFrozenIndustries({
      sectorIndustry,
      title,
      companyName,
      source,
      isAggregator: isAggregatorListingSource(source),
    });
    $set.frozenIndustries = industryResult.frozenIndustries;
    $set.industryClassification = {
      method: industryResult.method,
      rulesVersion: industryResult.rulesVersion || INDUSTRY_RULES_VERSION,
      classifiedAt: nowDate,
      contentHash,
    };
  } catch (err: any) {
    logger.log('warn', `[categoryQa] industry failed for ${doc._id}: ${err?.message || err}`);
  }

  try {
    const quals = [
      ...(doc.minimumQualifications || list.minimumQualifications || []),
      ...(doc.preferredQualifications || list.preferredQualifications || []),
    ]
      .map((x: unknown) => String(x || '').trim())
      .filter(Boolean);
    const maxYoe = Number(list.jobExperienceMax) || 0;
    const expInput = {
      title,
      description,
      qualifications: quals,
      seniorityLevel: String(doc.seniorityLevel || list.seniorityLevel || ''),
      minYoe: null as number | null,
      maxYoe: maxYoe > 0 ? maxYoe : null,
      isAggregator: isAggregatorListingSource(source),
    };
    const expResult = resolveFrozenExperience(expInput);
    const expHash = createHash('sha1')
      .update(experienceContentHashParts(expInput))
      .digest('hex')
      .slice(0, 16);
    $set.frozenExperienceLevels = expResult.frozenExperienceLevels;
    $set.frozenExperienceYears = expResult.frozenExperienceYears;
    $set.experienceClassification = {
      method: expResult.method,
      rulesVersion: EXPERIENCE_RULES_VERSION,
      classifiedAt: nowDate,
      contentHash: expHash,
      matchedSignals: expResult.matchedSignals.slice(0, 40),
    };
    $set.jobExperience = expResult.jobExperience;
  } catch (err: any) {
    logger.log('warn', `[categoryQa] experience failed for ${doc._id}: ${err?.message || err}`);
  }

  try {
    const location = String(doc.location || list.location || '').trim();
    const remoteType = String(doc.remoteType || list.remoteType || '').trim();
    const companyHistoricalStates = await loadCompanyHistoricalStates(companyName);
    const locResult = classifyJobLocation({
      location,
      remoteType,
      companyName,
      companyHistoricalStates,
    });
    $set.frozenStates = locResult.frozenStates;
    $set.frozenCities = locResult.frozenCities;
    $set.locationIsRemote = locResult.locationIsRemote;
    $set.locationIsUs = locResult.locationIsUs;
    $set.locationClassification = {
      method: locResult.method,
      confidence: locResult.confidence,
      rulesVersion: LOCATION_RULES_VERSION,
      classifiedAt: nowDate,
      contentHash,
      ...(locResult.candidates?.length ? { candidates: locResult.candidates.slice(0, 12) } : {}),
    };
  } catch (err: any) {
    logger.log('warn', `[categoryQa] location failed for ${doc._id}: ${err?.message || err}`);
  }

  try {
    const h1bInput = {
      companyName,
      jobTitle: title,
      location: String(doc.location || list.location || ''),
      remoteType: String(doc.remoteType || list.remoteType || ''),
      visaSponsorship: String(doc.visaSponsorship || list.visaSponsorship || ''),
      jobDescription: description,
      locationIsUs: $set.locationIsUs as boolean | undefined,
    };
    const h1b = await resolveH1bSponsorship(h1bInput);
    Object.assign($set, h1b);
    const fy2026 = await resolveFy2026JobMatch(h1bInput);
    Object.assign($set, fy2026);
  } catch (err: any) {
    logger.log('warn', `[categoryQa] h1b failed for ${doc._id}: ${err?.message || err}`);
  }

  const student = detectStudentEscape({
    title,
    description,
    seniorityLevel: String(doc.seniorityLevel || list.seniorityLevel || ''),
  });
  $set.studentEscape = student.studentEscape;
  $set.categoryQaPhase = student.studentEscape ? 'student_review' : 'backfilled';
  $set.categoryQaBatchId = String(doc.categoryQaBatchId || CATEGORY_QA_UI_BATCH_ID);

  return $set;
}

export type RunRandomSampleResult = {
  batchId: string;
  selected: number;
  cleared: number;
  backfilled: number;
  students: number;
  elapsedMs: number;
};

let sampleRunInFlight = false;

/**
 * Pick N random board jobs, clear category/H-1B fields, backfill classifiers,
 * and mark them for the Category QA UI batch (replacing any prior UI sample).
 */
export async function runRandomCategoryQaSample(opts?: {
  count?: number;
  batchId?: string;
  ownerId?: string;
}): Promise<RunRandomSampleResult> {
  if (sampleRunInFlight) {
    throw Object.assign(new Error('A Category QA sample run is already in progress'), {
      status: 409,
    });
  }
  sampleRunInFlight = true;
  const started = Date.now();
  const count = Math.min(Math.max(opts?.count || 1000, 1), 1000);
  const batchId = String(opts?.batchId || CATEGORY_QA_UI_BATCH_ID).trim() || CATEGORY_QA_UI_BATCH_ID;

  try {
    // Drop previous UI sample markers so All shows only this run.
    await JobBoardListing.updateMany(
      { categoryQaBatchId: batchId },
      { $set: { categoryQaBatchId: '', categoryQaPhase: '' } }
    );

    const match: Record<string, unknown> = {
      status: { $in: ['ready', 'partial'] },
      jobTitle: { $nin: ['', null] },
    };
    if (opts?.ownerId) match.ownerId = opts.ownerId;

    const sampled = await JobBoardListing.aggregate([
      { $match: match },
      { $sample: { size: count } },
      {
        $project: {
          jobTitle: 1,
          jobDescription: 1,
          companyName: 1,
          contentHash: 1,
          sectorIndustry: 1,
          source: 1,
          location: 1,
          remoteType: 1,
          visaSponsorship: 1,
          seniorityLevel: 1,
          jobExperience: 1,
          minimumQualifications: 1,
          preferredQualifications: 1,
          listSnapshot: 1,
        },
      },
    ]);

    if (!sampled.length) {
      return {
        batchId,
        selected: 0,
        cleared: 0,
        backfilled: 0,
        students: 0,
        elapsedMs: Date.now() - started,
      };
    }

    const clearOps = sampled.map((doc: any) => {
      const list = doc.listSnapshot || {};
      const student = detectStudentEscape({
        title: String(doc.jobTitle || list.jobTitle || ''),
        description: String(doc.jobDescription || list.jobDescription || ''),
        seniorityLevel: String(doc.seniorityLevel || list.seniorityLevel || ''),
      });
      return {
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: clearedCategoryFields(batchId, student.studentEscape) },
        },
      };
    });
    await JobBoardListing.bulkWrite(clearOps, { ordered: false });

    let students = 0;
    let backfilled = 0;
    const writeOps: any[] = [];
    for (const doc of sampled) {
      const $set = await classifyCategoryQaDoc({ ...doc, categoryQaBatchId: batchId });
      $set.categoryQaBatchId = batchId;
      if ($set.studentEscape) students += 1;
      writeOps.push({
        updateOne: {
          filter: { _id: (doc as any)._id },
          update: { $set },
        },
      });
      backfilled += 1;
      if (writeOps.length >= 25) {
        await JobBoardListing.bulkWrite(writeOps, { ordered: false });
        writeOps.length = 0;
      }
    }
    if (writeOps.length) {
      await JobBoardListing.bulkWrite(writeOps, { ordered: false });
    }

    return {
      batchId,
      selected: sampled.length,
      cleared: sampled.length,
      backfilled,
      students,
      elapsedMs: Date.now() - started,
    };
  } finally {
    sampleRunInFlight = false;
  }
}

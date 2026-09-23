/**
 * Category QA cohort orchestrator.
 *
 * Selects the most recent N ready/partial listings, clears category fields,
 * then backfills classifiers on the older half for manual review on /category-qa.
 *
 * Usage (from repo root, on droplet — stop scrapers if CPU is pegged):
 *
 *   npx ts-node --project server/tsconfig.json \
 *     server/src/scripts/categoryQaCohort.ts --dry-run --phase all
 *
 *   npx ts-node --project server/tsconfig.json \
 *     server/src/scripts/categoryQaCohort.ts --phase clear
 *
 *   npx ts-node --project server/tsconfig.json \
 *     server/src/scripts/categoryQaCohort.ts --phase backfill
 *
 * Options:
 *   --phase clear|backfill|all   (default all)
 *   --dry-run
 *   --limit N                    Safety cap on docs touched per phase (default unlimited within cohort sizes)
 *   --cohort-size N              Default 4000
 *   --backfill-size N            Default 2000 (older half of cohort)
 *   --batch-id STRING            Default cat-qa-2026-09
 *   --batch N                    Mongo flush size (default 25)
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { createHash } from 'crypto';
import mongoose from 'mongoose';
import JobBoardListing from '../models/JobBoardListing';
import { isAggregatorListingSource } from '../services/aggregatorIdentity';
import { classifyJobCategories } from '../services/jobCategoryTagger';
import { loadCompanyHistoricalStates } from '../services/companyHistoricalStates';
import { resolveH1bSponsorship } from '../services/h1b/resolveH1bSponsorship';
import { resolveFy2026JobMatch } from '../services/h1b/matchFy2026Role';
import { sanitizeCompanyName } from '../services/jobPageParser';
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

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

if (!process.env.JOB_TAGGER_COOLDOWN) {
  process.env.JOB_TAGGER_COOLDOWN = 'false';
}
if (!process.env.JOB_TAGGER_USE_ML) {
  process.env.JOB_TAGGER_USE_ML = 'false';
}

const DEFAULT_BATCH = 25;
const DEFAULT_COHORT = 4000;
const DEFAULT_BACKFILL = 2000;
const DEFAULT_BATCH_ID = 'cat-qa-2026-09';

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = parseInt(raw || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function clearedCategoryFields(batchId: string, studentEscape: boolean) {
  return {
    frozenCategories: [] as string[],
    categoryClassification: {
      method: 'rules' as const,
      rulesVersion: '',
      classifierVersion: '',
      classifiedAt: null,
      contentHash: '',
    },
    frozenIndustries: [] as string[],
    industryClassification: {
      method: 'none' as const,
      rulesVersion: '',
      classifiedAt: null,
      contentHash: '',
    },
    frozenExperienceLevels: [] as string[],
    frozenExperienceYears: [] as string[],
    experienceClassification: {
      method: 'none' as const,
      rulesVersion: '',
      classifiedAt: null,
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
      classifiedAt: null,
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

async function classifyOneDoc(doc: any): Promise<Record<string, unknown>> {
  const list = doc.listSnapshot || {};
  const title = String(doc.jobTitle || list.jobTitle || '');
  const description = String(doc.jobDescription || list.jobDescription || '');
  const companyName = sanitizeCompanyName(
    String(doc.companyName || list.companyName || '')
  );
  const contentHash = String(doc.contentHash || '');
  const source = String(doc.source || '').trim();
  const nowDate = new Date();
  const $set: Record<string, unknown> = {};
  const rawCompany = String(doc.companyName || list.companyName || '').trim();
  // Always persist sanitized employer from ATS/snapshot (same as categoryQaSample).
  if (companyName) {
    $set.companyName = companyName;
  } else if (rawCompany) {
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
    console.warn(`tagger failed for ${doc._id}: ${err?.message || err}`);
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
    console.warn(`industry failed for ${doc._id}: ${err?.message || err}`);
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
    console.warn(`experience failed for ${doc._id}: ${err?.message || err}`);
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
    console.warn(`location failed for ${doc._id}: ${err?.message || err}`);
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
    console.warn(`h1b failed for ${doc._id}: ${err?.message || err}`);
  }

  const student = detectStudentEscape({
    title,
    description,
    seniorityLevel: String(doc.seniorityLevel || list.seniorityLevel || ''),
  });
  $set.studentEscape = student.studentEscape;
  $set.categoryQaPhase = student.studentEscape ? 'student_review' : 'backfilled';

  return $set;
}

async function phaseClear(opts: {
  cohortSize: number;
  limit: number;
  batchId: string;
  batchSize: number;
  dryRun: boolean;
}) {
  const { cohortSize, limit, batchId, batchSize, dryRun } = opts;
  const take = Math.min(cohortSize, limit || cohortSize);

  console.log(`phase=clear select latest ${take} (cohort=${cohortSize}) batchId=${batchId} dryRun=${dryRun}`);

  const docs = await JobBoardListing.find({
    status: { $in: ['ready', 'partial'] },
    jobTitle: { $nin: ['', null] },
  })
    .select('_id jobTitle jobDescription seniorityLevel listSnapshot createdAt')
    .sort({ createdAt: -1 })
    .limit(take)
    .allowDiskUse(true)
    .lean();

  console.log(`selected=${docs.length}`);

  let ops: any[] = [];
  let studentCount = 0;
  let written = 0;

  const flush = async () => {
    if (!ops.length) return;
    if (!dryRun) await JobBoardListing.bulkWrite(ops, { ordered: false });
    written += ops.length;
    ops = [];
  };

  for (const doc of docs) {
    const list = (doc as any).listSnapshot || {};
    const student = detectStudentEscape({
      title: String((doc as any).jobTitle || list.jobTitle || ''),
      description: String((doc as any).jobDescription || list.jobDescription || ''),
      seniorityLevel: String((doc as any).seniorityLevel || list.seniorityLevel || ''),
    });
    if (student.studentEscape) studentCount += 1;

    ops.push({
      updateOne: {
        filter: { _id: (doc as any)._id },
        update: { $set: clearedCategoryFields(batchId, student.studentEscape) },
      },
    });
    if (ops.length >= batchSize) await flush();
  }
  await flush();

  console.log(
    `clear done selected=${docs.length} written=${written} students=${studentCount} dryRun=${dryRun}`
  );
}

async function phaseBackfill(opts: {
  backfillSize: number;
  limit: number;
  batchId: string;
  batchSize: number;
  dryRun: boolean;
  cohortSize: number;
}) {
  const { backfillSize, limit, batchId, batchSize, dryRun, cohortSize } = opts;
  const take = Math.min(backfillSize, limit || backfillSize);

  console.log(
    `phase=backfill older ${take} cleared in batchId=${batchId} dryRun=${dryRun}`
  );

  // Older half of the cohort: among cleared (or student_review still empty of specialty),
  // sort createdAt asc and take backfillSize. --force reclassifies already-backfilled rows.
  const force = process.argv.includes('--force');
  const phaseFilter = force
    ? { $in: ['cleared', 'student_review', 'backfilled'] }
    : { $in: ['cleared', 'student_review'] };
  const filter: Record<string, unknown> = {
    categoryQaBatchId: batchId,
    categoryQaPhase: phaseFilter,
  };
  if (!force) {
    filter.$or = [{ frozenCategories: { $size: 0 } }, { frozenCategories: { $exists: false } }];
  }

  let docs = await JobBoardListing.find(filter)
    .select(
      'jobTitle jobDescription companyName contentHash sectorIndustry source location remoteType visaSponsorship seniorityLevel jobExperience minimumQualifications preferredQualifications listSnapshot frozenCategories createdAt'
    )
    .sort({ createdAt: 1 })
    .limit(take)
    .allowDiskUse(true)
    .lean();

  // Dry-run before a real clear: preview older half of the latest cohort.
  if (!docs.length && dryRun) {
    const latest = await JobBoardListing.find({
      status: { $in: ['ready', 'partial'] },
      jobTitle: { $nin: ['', null] },
    })
      .select(
        'jobTitle jobDescription companyName contentHash sectorIndustry source location remoteType visaSponsorship seniorityLevel jobExperience minimumQualifications preferredQualifications listSnapshot frozenCategories createdAt'
      )
      .sort({ createdAt: -1 })
      .limit(Math.min(cohortSize, limit || cohortSize))
      .allowDiskUse(true)
      .lean();
    docs = [...latest].sort(
      (a: any, b: any) =>
        new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
    ).slice(0, take);
    console.log(`dry-run fallback: previewing older ${docs.length} of latest ${latest.length}`);
  }

  console.log(`backfill candidates=${docs.length}`);

  let ops: any[] = [];
  let processed = 0;
  let studentCount = 0;

  const flush = async () => {
    if (!ops.length) return;
    if (!dryRun) await JobBoardListing.bulkWrite(ops, { ordered: false });
    ops = [];
  };

  for (const doc of docs) {
    processed += 1;
    if (dryRun) {
      const list = (doc as any).listSnapshot || {};
      const student = detectStudentEscape({
        title: String((doc as any).jobTitle || list.jobTitle || ''),
        description: String((doc as any).jobDescription || list.jobDescription || ''),
        seniorityLevel: String((doc as any).seniorityLevel || list.seniorityLevel || ''),
      });
      if (student.studentEscape) studentCount += 1;
      continue;
    }

    const $set = await classifyOneDoc(doc);
    if ($set.studentEscape) studentCount += 1;
    $set.categoryQaBatchId = batchId;

    ops.push({
      updateOne: {
        filter: { _id: (doc as any)._id },
        update: { $set },
      },
    });

    if (ops.length >= batchSize) await flush();
    if (processed % 50 === 0) {
      console.log(`backfill progress processed=${processed}/${docs.length} students=${studentCount}`);
    }
  }
  await flush();

  console.log(
    `backfill done processed=${processed} students=${studentCount} dryRun=${dryRun}`
  );
}

async function main() {
  const phaseRaw = String(argValue('--phase') || 'all').toLowerCase();
  const phase = phaseRaw === 'clear' || phaseRaw === 'backfill' || phaseRaw === 'all' ? phaseRaw : 'all';
  const dryRun = process.argv.includes('--dry-run');
  const cohortSize = parsePositiveInt(argValue('--cohort-size'), DEFAULT_COHORT);
  const backfillSize = parsePositiveInt(argValue('--backfill-size'), DEFAULT_BACKFILL);
  const batchSize = parsePositiveInt(argValue('--batch'), DEFAULT_BATCH);
  const batchId = String(argValue('--batch-id') || DEFAULT_BATCH_ID).trim() || DEFAULT_BATCH_ID;
  const limitArg = argValue('--limit');
  const limit = limitArg ? parsePositiveInt(limitArg, Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URL;
  if (!uri) throw new Error('MONGODB_URI missing');

  await mongoose.connect(
    uri,
    process.env.MONGODB_DATABASE ? { dbName: process.env.MONGODB_DATABASE } : undefined
  );

  console.log(
    `categoryQaCohort start phase=${phase} cohort=${cohortSize} backfill=${backfillSize} batchId=${batchId} dryRun=${dryRun} limit=${limit === Number.MAX_SAFE_INTEGER ? 'none' : limit}`
  );

  if (phase === 'clear' || phase === 'all') {
    await phaseClear({ cohortSize, limit, batchId, batchSize, dryRun });
  }
  if (phase === 'backfill' || phase === 'all') {
    await phaseBackfill({ backfillSize, limit, batchId, batchSize, dryRun, cohortSize });
  }

  await mongoose.disconnect();
  console.log('categoryQaCohort done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

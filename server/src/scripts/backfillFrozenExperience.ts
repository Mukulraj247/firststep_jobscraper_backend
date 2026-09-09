/**
 * Backfill frozenExperienceLevels + frozenExperienceYears on job board listings.
 *
 * Recommended: run auditFrozenExperience.ts first and review the CSV.
 *
 *   npx ts-node --project server/tsconfig.json \
 *     server/src/scripts/backfillFrozenExperience.ts --limit 500 --only-untagged
 *
 * Options:
 *   --limit N
 *   --only-untagged
 *   --batch N          Mongo flush size (default 50)
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import { createHash } from 'crypto';
import mongoose from 'mongoose';
import JobBoardListing from '../models/JobBoardListing';
import { isAggregatorListingSource } from '../services/aggregatorIdentity';
import {
  EXPERIENCE_RULES_VERSION,
  experienceContentHashParts,
  resolveFrozenExperience,
} from '../../../src/shared/frozenExperience';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const DEFAULT_BATCH = 50;

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = parseInt(raw || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function main() {
  const limit = parsePositiveInt(argValue('--limit'), 1000);
  const batchSize = parsePositiveInt(argValue('--batch'), DEFAULT_BATCH);
  const onlyUntagged = process.argv.includes('--only-untagged');

  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URL;
  if (!uri) throw new Error('MONGODB_URI missing');

  await mongoose.connect(
    uri,
    process.env.MONGODB_DATABASE ? { dbName: process.env.MONGODB_DATABASE } : undefined
  );

  const filter: Record<string, unknown> = {
    status: { $in: ['ready', 'partial'] },
  };
  if (onlyUntagged) {
    filter.$or = [
      { frozenExperienceLevels: { $size: 0 } },
      { frozenExperienceLevels: { $exists: false } },
      { frozenExperienceYears: { $size: 0 } },
      { frozenExperienceYears: { $exists: false } },
      { 'experienceClassification.rulesVersion': { $ne: EXPERIENCE_RULES_VERSION } },
    ];
  }

  console.log(
    `backfillFrozenExperience start limit=${limit} batch=${batchSize} onlyUntagged=${onlyUntagged} rules=${EXPERIENCE_RULES_VERSION}`
  );

  // No sort on large runs — Atlas rejects in-memory sorts over ~32MB.
  // Walk by _id for stable, disk-friendly pagination.
  const cursor = JobBoardListing.find(filter)
    .select(
      'jobTitle jobDescription seniorityLevel jobExperience minimumQualifications preferredQualifications source listSnapshot frozenExperienceLevels frozenExperienceYears contentHash'
    )
    .sort({ _id: 1 })
    .limit(limit)
    .allowDiskUse(true)
    .lean()
    .cursor();

  let processed = 0;
  let updated = 0;
  let ops: any[] = [];

  const flush = async () => {
    if (!ops.length) return;
    await JobBoardListing.bulkWrite(ops, { ordered: false });
    ops = [];
  };

  for await (const doc of cursor) {
    processed += 1;
    const list = (doc as any).listSnapshot || {};
    const quals = [
      ...((doc as any).minimumQualifications || list.minimumQualifications || []),
      ...((doc as any).preferredQualifications || list.preferredQualifications || []),
    ]
      .map((x: unknown) => String(x || '').trim())
      .filter(Boolean);
    // Never feed stored jobExperience back as minYoe — that field is often polluted
    // by prior false extracts ("18 years of age", company history) and would
    // re-poison every run. Only structured HC max (listSnapshot.jobExperienceMax)
    // is trusted as a YOE input; text extraction supplies the rest.
    const maxYoe = Number(list.jobExperienceMax) || 0;
    const expInput = {
      title: String((doc as any).jobTitle || list.jobTitle || ''),
      description: String((doc as any).jobDescription || list.jobDescription || ''),
      qualifications: quals,
      seniorityLevel: String((doc as any).seniorityLevel || list.seniorityLevel || ''),
      minYoe: null as number | null,
      maxYoe: maxYoe > 0 ? maxYoe : null,
      isAggregator: isAggregatorListingSource(String((doc as any).source || '').trim()),
    };
    const result = resolveFrozenExperience(expInput);
    const expHash = createHash('sha1')
      .update(experienceContentHashParts(expInput))
      .digest('hex')
      .slice(0, 16);

    const prevLevels = Array.isArray((doc as any).frozenExperienceLevels)
      ? (doc as any).frozenExperienceLevels.map(String)
      : [];
    const prevYears = Array.isArray((doc as any).frozenExperienceYears)
      ? (doc as any).frozenExperienceYears.map(String)
      : [];
    const prevVersion = String((doc as any).experienceClassification?.rulesVersion || '');
    const sameLevels =
      prevLevels.length === result.frozenExperienceLevels.length &&
      prevLevels.every((v: string, i: number) => v === result.frozenExperienceLevels[i]);
    const sameYears =
      prevYears.length === result.frozenExperienceYears.length &&
      prevYears.every((v: string, i: number) => v === result.frozenExperienceYears[i]);
    // Always write when rulesVersion is missing/outdated — empty→empty still needs a stamp.
    if (sameLevels && sameYears && prevVersion === EXPERIENCE_RULES_VERSION) continue;

    updated += 1;
    const $set: Record<string, unknown> = {
      frozenExperienceLevels: result.frozenExperienceLevels,
      frozenExperienceYears: result.frozenExperienceYears,
      experienceClassification: {
        method: result.method,
        rulesVersion: result.rulesVersion,
        classifiedAt: new Date(),
        contentHash: expHash,
        matchedSignals: result.matchedSignals.slice(0, 40),
      },
      // Always write — including 0 — so polluted values (age / company history) clear.
      jobExperience: result.jobExperience,
    };

    ops.push({
      updateOne: {
        filter: { _id: (doc as any)._id },
        update: { $set },
      },
    });

    if (ops.length >= batchSize) await flush();
    if (processed % 100 === 0) {
      console.log(`progress processed=${processed} updated=${updated}`);
    }
  }

  await flush();
  console.log(`done processed=${processed} updated=${updated}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Backfill frozenIndustries from sectorIndustry (+ aggregator hints).
 *
 *   npx ts-node --project server/tsconfig.json \
 *     server/src/scripts/backfillFrozenIndustries.ts --limit 500 --only-untagged
 *
 * Options:
 *   --limit N
 *   --only-untagged
 *   --batch N          Mongo flush size (default 200)
 *   --dry-run          Classify and report method distribution without writing
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import mongoose from 'mongoose';
import JobBoardListing from '../models/JobBoardListing';
import { isAggregatorListingSource } from '../services/aggregatorIdentity';
import {
  INDUSTRY_RULES_VERSION,
  resolveFrozenIndustries,
} from '../../../src/shared/frozenIndustries';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const DEFAULT_BATCH = 200;

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
  const dryRun = process.argv.includes('--dry-run');

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
      { frozenIndustries: { $size: 0 } },
      { frozenIndustries: { $exists: false } },
      { 'industryClassification.rulesVersion': { $ne: INDUSTRY_RULES_VERSION } },
    ];
  }

  console.log(
    `backfillFrozenIndustries start limit=${limit} batch=${batchSize} onlyUntagged=${onlyUntagged} dryRun=${dryRun} rules=${INDUSTRY_RULES_VERSION}`
  );

  // Walk by _id: Atlas rejects in-memory sorts over ~32MB and updatedAt is unindexed.
  const cursor = JobBoardListing.find(filter)
    .select(
      'jobTitle companyName sectorIndustry source listSnapshot frozenIndustries industryClassification contentHash'
    )
    .sort({ _id: 1 })
    .limit(limit)
    .allowDiskUse(true)
    .lean()
    .cursor();

  let processed = 0;
  let updated = 0;
  const methodCounts: Record<string, number> = {};
  let ops: any[] = [];

  const flush = async () => {
    if (!ops.length) return;
    if (!dryRun) await JobBoardListing.bulkWrite(ops, { ordered: false });
    ops = [];
  };

  for await (const doc of cursor) {
    processed += 1;
    const list = (doc as any).listSnapshot || {};
    const sectorIndustry = String(
      (doc as any).sectorIndustry || list.sectorIndustry || ''
    ).trim();
    const source = String((doc as any).source || '').trim();
    const result = resolveFrozenIndustries({
      sectorIndustry,
      title: String((doc as any).jobTitle || list.jobTitle || ''),
      companyName: String((doc as any).companyName || list.companyName || ''),
      source,
      isAggregator: isAggregatorListingSource(source),
    });

    methodCounts[result.method] = (methodCounts[result.method] || 0) + 1;

    const prev = Array.isArray((doc as any).frozenIndustries)
      ? (doc as any).frozenIndustries.map(String)
      : [];
    const prevVersion = String((doc as any).industryClassification?.rulesVersion || '');
    const same =
      prev.length === result.frozenIndustries.length &&
      prev.every((v: string, i: number) => v === result.frozenIndustries[i]);
    // Always write when rulesVersion is missing/outdated — empty→empty still needs a stamp,
    // otherwise "no industry found" is indistinguishable from "never classified".
    if (same && prevVersion === INDUSTRY_RULES_VERSION) continue;

    updated += 1;
    ops.push({
      updateOne: {
        filter: { _id: (doc as any)._id },
        update: {
          $set: {
            frozenIndustries: result.frozenIndustries,
            industryClassification: {
              method: result.method,
              rulesVersion: result.rulesVersion,
              classifiedAt: new Date(),
              contentHash: String((doc as any).contentHash || ''),
            },
          },
        },
      },
    });

    if (ops.length >= batchSize) await flush();
    if (processed % 500 === 0) {
      console.log(`progress processed=${processed} updated=${updated}`);
    }
  }

  await flush();
  console.log(
    `done processed=${processed} updated=${updated} dryRun=${dryRun} methods=${JSON.stringify(
      methodCounts
    )}`
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

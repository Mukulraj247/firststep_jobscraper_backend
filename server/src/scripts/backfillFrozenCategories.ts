/**
 * Backfill frozenCategories via job-tagger (fast sequential classify-one).
 *
 * Recommended on droplet (stop scrapers first if CPU is pegged):
 *
 *   pm2 stop scoutx-scraper scoutx-aggregators
 *   JOB_TAGGER_USE_ML=false JOB_TAGGER_COOLDOWN=false \
 *     npx ts-node --project server/tsconfig.json \
 *     server/src/scripts/backfillFrozenCategories.ts --limit 200 --only-untagged
 *   pm2 start scoutx-scraper scoutx-aggregators
 *
 * Options:
 *   --limit N
 *   --only-untagged
 *   --batch N          Mongo flush size (default 25)
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import mongoose from 'mongoose';
import JobBoardListing from '../models/JobBoardListing';
import { classifyJobCategoriesParallel } from '../services/jobCategoryTagger';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Backfill must not trip enrichment-style cooldowns.
if (!process.env.JOB_TAGGER_COOLDOWN) {
  process.env.JOB_TAGGER_COOLDOWN = 'false';
}
if (!process.env.JOB_TAGGER_USE_ML) {
  // Caller can still override; default fast rules-only for this script.
  process.env.JOB_TAGGER_USE_ML = 'false';
}

const DEFAULT_BATCH = 25;
const MAX_DESC = 2500;

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
  // Always 1 — uvicorn is single-worker; parallel just causes timeouts.
  const concurrency = 1;
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
    jobTitle: { $nin: ['', null] },
  };
  if (onlyUntagged) {
    filter.$or = [{ frozenCategories: { $size: 0 } }, { frozenCategories: { $exists: false } }];
  }

  console.log(
    `backfill start limit=${limit} concurrency=${concurrency} batch=${batchSize} onlyUntagged=${onlyUntagged} useMl=${process.env.JOB_TAGGER_USE_ML}`
  );

  const cursor = JobBoardListing.find(filter)
    .select('jobTitle jobDescription contentHash categoryClassification frozenCategories')
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean()
    .cursor();

  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let batch: Array<{
    docId: string;
    title: string;
    description: string;
    contentHash: string;
    existing: { contentHash?: string; rulesVersion?: string } | null;
  }> = [];

  const started = Date.now();

  const flush = async () => {
    if (batch.length === 0) return;
    const t0 = Date.now();
    const results = await classifyJobCategoriesParallel(
      batch.map((b) => ({
        id: b.docId,
        title: b.title,
        description: b.description,
        contentHash: b.contentHash,
        existingClassification: b.existing,
      })),
      concurrency
    );

    const ops: any[] = [];
    for (let i = 0; i < batch.length; i++) {
      const item = batch[i];
      const result = results[i];
      if (!result || result.skipUpdate) {
        // Distinguish transport fail vs already-classified: empty meta = fail/skip.
        if (!result?.categoryClassification) failed += 1;
        else skipped += 1;
        continue;
      }
      ops.push({
        updateOne: {
          filter: { _id: item.docId },
          update: {
            $set: {
              frozenCategories: result.frozenCategories,
              ...(result.categoryClassification
                ? { categoryClassification: result.categoryClassification }
                : {}),
            },
          },
        },
      });
    }

    if (ops.length > 0) {
      await JobBoardListing.bulkWrite(ops, { ordered: false });
      updated += ops.length;
    }

    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    const rate = scanned > 0 ? (scanned / ((Date.now() - started) / 1000)).toFixed(1) : '0';
    console.log(
      `progress scanned=${scanned} updated=${updated} failed=${failed} batch=${elapsed}s rate=${rate}/s`
    );
    batch = [];
  };

  for await (const doc of cursor) {
    scanned += 1;
    const desc = String((doc as any).jobDescription || '');
    batch.push({
      docId: String((doc as any)._id),
      title: String((doc as any).jobTitle || ''),
      description: desc.length > MAX_DESC ? desc.slice(0, MAX_DESC) : desc,
      contentHash: String((doc as any).contentHash || ''),
      existing: (doc as any).categoryClassification || null,
    });
    if (batch.length >= batchSize) {
      await flush();
    }
  }

  await flush();
  const totalSec = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `done scanned=${scanned} updated=${updated} failed=${failed} skipped=${skipped} total=${totalSec}s`
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

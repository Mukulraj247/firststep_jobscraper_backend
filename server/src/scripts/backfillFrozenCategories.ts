/**
 * Backfill frozenCategories on ready job board listings via job-tagger sidecar.
 *
 *   npx tsx server/src/scripts/backfillFrozenCategories.ts
 *   npx tsx server/src/scripts/backfillFrozenCategories.ts --limit 500
 *   npx tsx server/src/scripts/backfillFrozenCategories.ts --only-untagged
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import mongoose from 'mongoose';
import JobBoardListing from '../models/JobBoardListing';
import { classifyJobCategoriesBatch } from '../services/jobCategoryTagger';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const BATCH = 25;

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

interface PendingItem {
  docId: string;
  title: string;
  description: string;
  contentHash: string;
  existing: { contentHash?: string; rulesVersion?: string } | null;
}

async function main() {
  const parsedLimit = parseInt(argValue('--limit') || '1000', 10);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 1000;
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

  const cursor = JobBoardListing.find(filter)
    // Only the fields the tagger needs — descriptions are large.
    .select('jobTitle jobDescription contentHash categoryClassification')
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean()
    .cursor();

  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let batch: PendingItem[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    const results = await classifyJobCategoriesBatch(
      batch.map((b) => ({
        id: b.docId,
        title: b.title,
        description: b.description,
        contentHash: b.contentHash,
        existingClassification: b.existing,
      }))
    );

    const ops: any[] = [];
    for (let i = 0; i < batch.length; i++) {
      const item = batch[i];
      const result = results[i];
      // skipUpdate covers up-to-date rows and sidecar failures — never clobber.
      if (!result || result.skipUpdate) {
        skipped += 1;
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
    batch = [];
  };

  for await (const doc of cursor) {
    scanned += 1;
    batch.push({
      docId: String((doc as any)._id),
      title: String((doc as any).jobTitle || ''),
      description: String((doc as any).jobDescription || ''),
      contentHash: String((doc as any).contentHash || ''),
      existing: (doc as any).categoryClassification || null,
    });
    if (batch.length >= BATCH) {
      await flush();
      console.log(`progress scanned=${scanned} updated=${updated} skipped=${skipped}`);
    }
  }

  await flush();
  console.log(`done scanned=${scanned} updated=${updated} skipped=${skipped}`);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

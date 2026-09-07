/**
 * Backfill h1b_* + FY2026 match fields on ready/partial job listings.
 *
 * Usage:
 *   npx ts-node --project server/tsconfig.json server/src/scripts/backfillH1bOnJobs.ts
 *
 * Env:
 *   H1B_BACKFILL_LIMIT — max docs (default unlimited)
 *   H1B_BACKFILL_BATCH — batch size (default 100)
 */
import dotenv from 'dotenv';
import path from 'path';
import mongoose from 'mongoose';
import JobBoardListing from '../models/JobBoardListing';
import { resolveH1bSponsorship } from '../services/h1b/resolveH1bSponsorship';
import { resolveFy2026JobMatch } from '../services/h1b/matchFy2026Role';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  const uri = process.env.DB_URL || process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('DB_URL / MONGODB_URI required');
  await mongoose.connect(uri);

  const limit = parseInt(process.env.H1B_BACKFILL_LIMIT || '0', 10) || Number.POSITIVE_INFINITY;
  const batchSize = parseInt(process.env.H1B_BACKFILL_BATCH || '100', 10) || 100;

  const cursor = JobBoardListing.find({
    status: { $in: ['ready', 'partial'] },
  })
    .select(
      'companyName jobTitle location remoteType visaSponsorship jobDescription listSnapshot h1bEligible'
    )
    .cursor();

  let processed = 0;
  let updated = 0;
  let fyMatched = 0;
  const ops: any[] = [];

  for await (const doc of cursor) {
    if (processed >= limit) break;
    processed += 1;

    const list = (doc as any).listSnapshot || {};
    const input = {
      companyName: doc.companyName || list.companyName || '',
      jobTitle: doc.jobTitle || list.jobTitle || '',
      location: doc.location || list.location || '',
      remoteType: doc.remoteType || list.remoteType || '',
      visaSponsorship: (doc as any).visaSponsorship || list.visaSponsorship || '',
      jobDescription: doc.jobDescription || list.jobDescription || '',
    };
    const result = await resolveH1bSponsorship(input);
    const fy2026 = await resolveFy2026JobMatch(input);
    if (fy2026.h1bFy2026Match) fyMatched += 1;

    ops.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { ...result, ...fy2026 } },
      },
    });
    updated += 1;

    if (ops.length >= batchSize) {
      await JobBoardListing.bulkWrite(ops, { ordered: false });
      ops.length = 0;
      console.log(
        `[h1b] backfill progress processed=${processed} updated=${updated} fy2026Match=${fyMatched}`
      );
    }
  }

  if (ops.length) await JobBoardListing.bulkWrite(ops, { ordered: false });
  console.log(
    `[h1b] backfill done processed=${processed} updated=${updated} fy2026Match=${fyMatched}`
  );
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * Backfill H-1B + FY2026 only for jobs that never got h1bCompanyScore.
 *
 *   npx ts-node --project server/tsconfig.json \
 *     server/src/scripts/backfillH1bMissing.ts --limit 999999 --batch 100
 */
import * as dotenv from 'dotenv';
import * as path from 'path';
import mongoose from 'mongoose';
import JobBoardListing from '../models/JobBoardListing';
import { resolveH1bSponsorship } from '../services/h1b/resolveH1bSponsorship';
import { resolveFy2026JobMatch } from '../services/h1b/matchFy2026Role';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

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
  const limit = parsePositiveInt(argValue('--limit'), 5000);
  const batchSize = parsePositiveInt(argValue('--batch'), 100);
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DB_URL;
  if (!uri) throw new Error('MONGODB_URI missing');
  await mongoose.connect(
    uri,
    process.env.MONGODB_DATABASE ? { dbName: process.env.MONGODB_DATABASE } : undefined
  );

  const filter = {
    status: { $in: ['ready', 'partial'] },
    $or: [
      { h1bCompanyScore: { $exists: false } },
      { h1bCompanyScore: null },
      { h1bCompanyScore: '' },
    ],
  };

  console.log(`backfillH1bMissing start limit=${limit} batch=${batchSize}`);
  const cursor = JobBoardListing.find(filter)
    .select(
      'companyName jobTitle location remoteType visaSponsorship jobDescription listSnapshot'
    )
    .sort({ _id: 1 })
    .limit(limit)
    .allowDiskUse(true)
    .lean()
    .cursor();

  let processed = 0;
  let updated = 0;
  let fyMatched = 0;
  let ops: any[] = [];

  const flush = async () => {
    if (!ops.length) return;
    await JobBoardListing.bulkWrite(ops, { ordered: false });
    ops = [];
  };

  for await (const doc of cursor) {
    processed += 1;
    const list = (doc as any).listSnapshot || {};
    const input = {
      companyName: String((doc as any).companyName || list.companyName || ''),
      jobTitle: String((doc as any).jobTitle || list.jobTitle || ''),
      location: String((doc as any).location || list.location || ''),
      remoteType: String((doc as any).remoteType || list.remoteType || ''),
      visaSponsorship: String((doc as any).visaSponsorship || list.visaSponsorship || ''),
      jobDescription: String((doc as any).jobDescription || list.jobDescription || ''),
    };
    const result = await resolveH1bSponsorship(input);
    const fy2026 = await resolveFy2026JobMatch(input);
    if (fy2026.h1bFy2026Match) fyMatched += 1;
    updated += 1;
    ops.push({
      updateOne: {
        filter: { _id: (doc as any)._id },
        update: { $set: { ...result, ...fy2026 } },
      },
    });
    if (ops.length >= batchSize) {
      await flush();
      console.log(
        `progress processed=${processed} updated=${updated} fy2026Match=${fyMatched}`
      );
    }
  }

  await flush();
  console.log(
    `done processed=${processed} updated=${updated} fy2026Match=${fyMatched}`
  );
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

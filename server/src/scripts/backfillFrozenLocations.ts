/**
 * Backfill frozenStates / location classification from free-text location.
 *
 *   npx ts-node --project server/tsconfig.json \
 *     server/src/scripts/backfillFrozenLocations.ts --limit 500 --only-untagged
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
import { loadCompanyHistoricalStates } from '../services/companyHistoricalStates';
import {
  LOCATION_RULES_VERSION,
  classifyJobLocation,
} from '../../../src/shared/frozenLocations';

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
      { frozenStates: { $size: 0 }, locationIsRemote: { $ne: true }, locationIsUs: { $ne: false } },
      { frozenStates: { $exists: false } },
      { 'locationClassification.rulesVersion': { $ne: LOCATION_RULES_VERSION } },
      { locationClassification: { $exists: false } },
    ];
  }

  console.log(
    `backfillFrozenLocations start limit=${limit} batch=${batchSize} onlyUntagged=${onlyUntagged} dryRun=${dryRun} rules=${LOCATION_RULES_VERSION}`
  );

  const cursor = JobBoardListing.find(filter)
    .select(
      'location remoteType companyName listSnapshot frozenStates locationIsRemote locationIsUs locationClassification contentHash'
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
  const historyCache = new Map<string, string[]>();

  const flush = async () => {
    if (!ops.length) return;
    if (!dryRun) await JobBoardListing.bulkWrite(ops, { ordered: false });
    ops = [];
  };

  for await (const doc of cursor) {
    processed += 1;
    const list = (doc as any).listSnapshot || {};
    const location = String((doc as any).location || list.location || '').trim();
    const remoteType = String((doc as any).remoteType || list.remoteType || '').trim();
    const companyName = String((doc as any).companyName || list.companyName || '').trim();

    let companyHistoricalStates = historyCache.get(companyName);
    if (!companyHistoricalStates) {
      companyHistoricalStates = await loadCompanyHistoricalStates(companyName);
      if (companyName) historyCache.set(companyName, companyHistoricalStates);
    }

    const result = classifyJobLocation({
      location,
      remoteType,
      companyName,
      companyHistoricalStates,
    });

    methodCounts[result.method] = (methodCounts[result.method] || 0) + 1;

    const prevStates = Array.isArray((doc as any).frozenStates)
      ? (doc as any).frozenStates.map(String)
      : [];
    const prevVersion = String((doc as any).locationClassification?.rulesVersion || '');
    const sameStates =
      prevStates.length === result.frozenStates.length &&
      prevStates.every((v: string, i: number) => v === result.frozenStates[i]);
    const sameRemote = Boolean((doc as any).locationIsRemote) === result.locationIsRemote;
    const sameUs = ((doc as any).locationIsUs !== false) === result.locationIsUs;
    if (sameStates && sameRemote && sameUs && prevVersion === LOCATION_RULES_VERSION) continue;

    updated += 1;
    ops.push({
      updateOne: {
        filter: { _id: (doc as any)._id },
        update: {
          $set: {
            frozenStates: result.frozenStates,
            frozenCities: result.frozenCities,
            locationIsRemote: result.locationIsRemote,
            locationIsUs: result.locationIsUs,
            locationClassification: {
              method: result.method,
              confidence: result.confidence,
              rulesVersion: result.rulesVersion,
              classifiedAt: new Date(),
              contentHash: String((doc as any).contentHash || ''),
              ...(result.candidates?.length
                ? { candidates: result.candidates.slice(0, 12) }
                : {}),
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

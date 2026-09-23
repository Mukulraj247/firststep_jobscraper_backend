/**
 * Backfill companyId / companyKey / companyResolvedName on job board rows
 * and recording_meta on robots. Upserts into scoutx_companies.
 *
 * Usage:
 *   npx ts-node --project server/tsconfig.json server/src/scripts/backfillCompanyIds.ts
 *   npx ts-node --project server/tsconfig.json server/src/scripts/backfillCompanyIds.ts --limit 2000 --dry-run
 *
 * Options:
 *   --limit N     max board rows to process (default: all)
 *   --dry-run     resolve only; do not write
 *   --robots-only skip board, only stamp robots
 *   --board-only  skip robots, only stamp board
 */
import dotenv from 'dotenv';
import path from 'path';
import mongoose from 'mongoose';
import JobBoardListing from '../models/JobBoardListing';
import Robot from '../models/Robot';
import {
  resolveAndUpsertCompany,
  type CompanyStamp,
} from '../services/companyRegistry';
import {
  pickEmployerUrlForCompanyResolution,
  resolveCompanyKey,
} from '../services/companyIdentity';
import { isAggregatorListingSource } from '../services/aggregatorIdentity';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function parsePositiveInt(raw: string | undefined, fallback: number | null): number | null {
  if (raw == null) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function main() {
  const uri = process.env.DB_URL || process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    console.error('Missing MONGODB_URI / DB_URL');
    process.exit(1);
  }

  const dryRun = hasFlag('--dry-run');
  const robotsOnly = hasFlag('--robots-only');
  const boardOnly = hasFlag('--board-only');
  const limit = parsePositiveInt(argValue('--limit'), null);

  await mongoose.connect(
    uri,
    process.env.MONGODB_DATABASE ? { dbName: process.env.MONGODB_DATABASE } : undefined
  );

  const stats = {
    boardScanned: 0,
    boardStamped: 0,
    boardSkipped: 0,
    boardUnresolved: 0,
    robotsScanned: 0,
    robotsStamped: 0,
    robotsSkipped: 0,
    robotsUnresolved: 0,
    dryRun,
  };

  if (!robotsOnly) {
    console.log(`backfillCompanyIds board start limit=${limit ?? 'all'} dryRun=${dryRun}`);
    let query = JobBoardListing.find({
      $or: [
        { companyId: { $in: [null, ''] } },
        { companyId: { $exists: false } },
        { companyKey: { $in: [null, ''] } },
        { companyKey: { $exists: false } },
      ],
    })
      .select('jobUrl applyUrl companyName source listSnapshot companyId companyKey')
      .sort({ _id: -1 });
    if (limit) query = query.limit(limit);
    const cursor = query.lean().cursor();

    for await (const doc of cursor) {
      stats.boardScanned += 1;
      if ((doc as any).companyId && (doc as any).companyKey) {
        stats.boardSkipped += 1;
        continue;
      }

      const list = (doc as any).listSnapshot || {};
      const jobUrl = String((doc as any).jobUrl || list.jobUrl || '').trim();
      const applyUrl = String((doc as any).applyUrl || list.applyUrl || '').trim();
      const companyName = String((doc as any).companyName || list.companyName || '').trim();
      const source = String((doc as any).source || '').trim();

      let stamp: CompanyStamp | null = null;
      try {
        if (dryRun) {
          const employerUrl = pickEmployerUrlForCompanyResolution({ jobUrl, applyUrl });
          const resolution = employerUrl ? resolveCompanyKey(employerUrl) : null;
          if (resolution) {
            stamp = {
              companyId: '(dry-run)',
              companyKey: resolution.companyKey,
              companyResolvedName: companyName || resolution.nameHint || resolution.companyKey,
            };
          }
        } else {
          const resolved = await resolveAndUpsertCompany({
            jobUrl,
            applyUrl,
            displayName: companyName,
            listingSource: source,
            nameSource: isAggregatorListingSource(source) ? 'aggregator' : undefined,
            touchJob: true,
          });
          stamp = resolved?.stamp || null;
        }
      } catch (err: any) {
        console.warn(`board resolve failed ${_idStr((doc as any)._id)}: ${err?.message || err}`);
      }

      if (!stamp) {
        stats.boardUnresolved += 1;
        continue;
      }

      if (!dryRun) {
        await JobBoardListing.updateOne(
          { _id: (doc as any)._id },
          {
            $set: {
              companyId: stamp.companyId,
              companyKey: stamp.companyKey,
              companyResolvedName: stamp.companyResolvedName,
            },
          }
        );
      }
      stats.boardStamped += 1;

      if (stats.boardScanned % 200 === 0) {
        console.log(
          `board progress scanned=${stats.boardScanned} stamped=${stats.boardStamped} unresolved=${stats.boardUnresolved}`
        );
      }
    }
  }

  if (!boardOnly) {
    console.log(`backfillCompanyIds robots start dryRun=${dryRun}`);
    const robots = await Robot.find({}).select('recording_meta').cursor();

    for await (const robot of robots) {
      stats.robotsScanned += 1;
      const meta = robot.recording_meta || {};
      if (meta.companyId && meta.companyKey) {
        stats.robotsSkipped += 1;
        continue;
      }

      const startUrl = String(meta.url || '').trim();
      const companyName = String(
        meta.companyName || meta.saasConfig?.companyName || ''
      ).trim();

      if (!startUrl) {
        stats.robotsUnresolved += 1;
        continue;
      }

      let stamp: CompanyStamp | null = null;
      try {
        if (dryRun) {
          const resolution = resolveCompanyKey(startUrl);
          if (resolution) {
            stamp = {
              companyId: '(dry-run)',
              companyKey: resolution.companyKey,
              companyResolvedName: companyName || resolution.nameHint || resolution.companyKey,
            };
          }
        } else {
          const resolved = await resolveAndUpsertCompany({
            jobUrl: startUrl,
            applyUrl: startUrl,
            displayName: companyName,
            nameSource: 'automation',
            touchJob: false,
          });
          stamp = resolved?.stamp || null;
        }
      } catch (err: any) {
        console.warn(`robot resolve failed ${meta.id || robot.id}: ${err?.message || err}`);
      }

      if (!stamp) {
        stats.robotsUnresolved += 1;
        continue;
      }

      if (!dryRun) {
        meta.companyId = stamp.companyId;
        meta.companyKey = stamp.companyKey;
        meta.companyResolvedName = stamp.companyResolvedName;
        if (meta.saasConfig && typeof meta.saasConfig === 'object') {
          meta.saasConfig.companyId = stamp.companyId;
          meta.saasConfig.companyKey = stamp.companyKey;
        }
        robot.recording_meta = meta;
        robot.markModified('recording_meta');
        await robot.save();
      }
      stats.robotsStamped += 1;
    }
  }

  console.log(JSON.stringify(stats, null, 2));
  await mongoose.disconnect();
}

function _idStr(id: unknown): string {
  return id != null ? String(id) : '';
}

main().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});

/**
 * Repair legacy toLocaleString() finishedAt values that Mongo misreads as MDY
 * (e.g. "11/8/2026, 7:40:02 pm" → Nov 8 future → always inside failure windows).
 *
 * Usage:
 *   npx ts-node --project server/tsconfig.json server/src/scripts/repairLocaleFinishedAt.ts --dry-run
 *   npx ts-node --project server/tsconfig.json server/src/scripts/repairLocaleFinishedAt.ts
 */
import dotenv from 'dotenv';
import path from 'path';
import mongoose from 'mongoose';
import {
  computeRunDurationMs,
  isCanonicalRunTimestamp,
  MAX_SANE_RUN_DURATION_MS,
  parseRunTimestampCandidates,
} from '../services/automation';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export function resolveRepairedFinishedAt(run: {
  startedAt?: string | null;
  finishedAt?: string | null;
  duration?: number | null;
}): string | null {
  const startedMs = isCanonicalRunTimestamp(run.startedAt)
    ? Date.parse(String(run.startedAt))
    : null;
  const stored =
    typeof run.duration === 'number'
    && run.duration > 0
    && run.duration <= MAX_SANE_RUN_DURATION_MS
      ? run.duration
      : null;

  if (startedMs != null && !Number.isNaN(startedMs) && stored != null) {
    return new Date(startedMs + stored).toISOString();
  }

  const fromPair = computeRunDurationMs(
    run.startedAt || undefined,
    run.finishedAt || undefined,
  );
  if (startedMs != null && !Number.isNaN(startedMs) && fromPair != null) {
    return new Date(startedMs + fromPair).toISOString();
  }

  const ends = parseRunTimestampCandidates(run.finishedAt);
  if (startedMs != null && !Number.isNaN(startedMs) && ends.length) {
    let best: number | null = null;
    for (const end of ends) {
      if (end < startedMs) continue;
      const ms = end - startedMs;
      if (ms > MAX_SANE_RUN_DURATION_MS) continue;
      if (best == null || ms < best - startedMs) best = end;
    }
    if (best != null) return new Date(best).toISOString();
  }

  if (startedMs != null && !Number.isNaN(startedMs)) {
    return new Date(startedMs).toISOString();
  }
  return null;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const uri = process.env.DB_URL || process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('Missing MONGODB_URI / DB_URL');

  await mongoose.connect(uri);
  const col = mongoose.connection.collection('maxun_runs');
  const cursor = col.find({
    finishedAt: { $type: 'string', $not: ISO_RE },
  });

  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  const samples: Array<Record<string, unknown>> = [];

  while (await cursor.hasNext()) {
    const run = await cursor.next();
    if (!run) break;
    scanned += 1;
    const finishedIso = resolveRepairedFinishedAt(run as any);
    if (!finishedIso) {
      skipped += 1;
      continue;
    }
    const sortAt = new Date(finishedIso);
    if (samples.length < 8) {
      samples.push({
        runId: run.runId,
        name: run.name,
        from: run.finishedAt,
        to: finishedIso,
      });
    }
    if (!dryRun) {
      await col.updateOne(
        { _id: run._id },
        { $set: { finishedAt: finishedIso, sortAt } },
      );
    }
    updated += 1;
  }

  console.log(JSON.stringify({ dryRun, scanned, updated, skipped, samples }, null, 2));
  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

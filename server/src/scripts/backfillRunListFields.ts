/**
 * Resumable Run list-field backfill.
 *
 * Usage:
 *   npx ts-node --project server/tsconfig.json server/src/scripts/backfillRunListFields.ts --dry-run
 *   npx ts-node --project server/tsconfig.json server/src/scripts/backfillRunListFields.ts --batch-size=250
 *
 * The checkpoint is intentionally local and may be deleted to restart. Dry
 * runs never write it or update MongoDB.
 */
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import mongoose from 'mongoose';
import Run from '../models/Run';
import { normalizeFailureReason } from '../utils/failureReason';
import { ensureRunListIndexes } from '../services/dashboardQueries';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

export type RunListBackfillPlan = {
  set: Record<string, unknown>;
  malformed: string[];
  oldReason: string;
  newReason: string;
};

const validDate = (value: unknown): Date | null => {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

export function buildRunListFieldBackfill(run: any): RunListBackfillPlan {
  const set: Record<string, unknown> = {};
  const malformed: string[] = [];
  const runId = typeof run?.runId === 'string' && run.runId.trim() ? run.runId : null;
  if (!runId) malformed.push('missing runId');

  if (!run?.ownerId && run?.runByUserId != null && String(run.runByUserId).trim()) {
    set.ownerId = String(run.runByUserId);
  } else if (!run?.ownerId && run?.runByUserId != null) {
    malformed.push('invalid runByUserId');
  }

  const sortAt = validDate(run?.finishedAt) || validDate(run?.startedAt);
  if (!run?.sortAt && sortAt) set.sortAt = sortAt;
  if (!run?.sortAt && !sortAt) malformed.push('missing sortable timestamp');

  const normalized = normalizeFailureReason(run);
  const oldReason = typeof run?.normalizedFailureReason === 'string'
    ? run.normalizedFailureReason
    : 'unknown';
  const newReason = normalized || 'unknown';
  if (normalized && run?.normalizedFailureReason !== normalized) {
    set.normalizedFailureReason = normalized;
  }

  if (runId) {
    if (!run?.originalRunId) set.originalRunId = run.retryRootRunId || run.retryOfRunId || runId;
    if (run?.retrySequence == null) {
      set.retrySequence = run.retryOfRunId
        ? Math.max(1, Number(run.retryParentSequence || 0) + 1)
        : 0;
    }
  }

  return { set, malformed, oldReason, newReason };
}

const addCount = (counts: Record<string, number>, reason: string) => {
  counts[reason] = (counts[reason] || 0) + 1;
};

const argumentValue = (name: string) =>
  process.argv.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);

async function main() {
  const uri = process.env.DB_URL || process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) throw new Error('Missing MONGODB_URI / DB_URL');

  const dryRun = process.argv.includes('--dry-run');
  const requestedBatchSize = Number(argumentValue('--batch-size') || 250);
  const batchSize = Number.isFinite(requestedBatchSize)
    ? Math.max(1, Math.min(1_000, requestedBatchSize))
    : 250;
  const checkpointPath = path.resolve(
    argumentValue('--checkpoint') || path.resolve(__dirname, '../../../.run-list-backfill.checkpoint.json')
  );
  let checkpoint: { lastId?: string } = {};
  try {
    checkpoint = JSON.parse(await fs.readFile(checkpointPath, 'utf8'));
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
  }

  await mongoose.connect(uri);
  const stats = {
    dryRun,
    checkpointPath,
    scanned: 0,
    wouldUpdate: 0,
    updated: 0,
    malformed: [] as Array<{ runId: string | null; issues: string[] }>,
    oldReasonCounts: {} as Record<string, number>,
    newReasonCounts: {} as Record<string, number>,
    indexesEnsured: [] as string[],
  };

  let lastId = checkpoint.lastId;
  try {
    while (true) {
      const query = lastId ? { _id: { $gt: lastId } } : {};
      const batch = await Run.find(query).sort({ _id: 1 }).limit(batchSize).lean();
      if (!batch.length) break;
      const parentIds = batch
        .map((run: any) => run.retryOfRunId)
        .filter((runId: unknown): runId is string => typeof runId === 'string' && !!runId);
      const parents = parentIds.length
        ? await Run.find({ runId: { $in: parentIds } })
            .select('runId originalRunId retrySequence')
            .lean()
        : [];
      const parentByRunId = new Map(parents.map((parent: any) => [parent.runId, parent]));

      for (const run of batch) {
        const parent: any = run.retryOfRunId ? parentByRunId.get(run.retryOfRunId) : null;
        const plan = buildRunListFieldBackfill({
          ...run,
          retryRootRunId: parent?.originalRunId || parent?.runId,
          retryParentSequence: parent?.retrySequence,
        });
        stats.scanned += 1;
        addCount(stats.oldReasonCounts, plan.oldReason);
        addCount(stats.newReasonCounts, plan.newReason);
        if (plan.malformed.length) {
          stats.malformed.push({ runId: typeof run.runId === 'string' ? run.runId : null, issues: plan.malformed });
        }
        if (Object.keys(plan.set).length) {
          stats.wouldUpdate += 1;
          if (!dryRun) {
            await Run.updateOne({ _id: run._id }, { $set: plan.set });
            stats.updated += 1;
          }
        }
        parentByRunId.set(String(run.runId), { ...run, ...plan.set });
      }

      lastId = String(batch[batch.length - 1]._id);
      if (!dryRun) {
        await fs.writeFile(checkpointPath, JSON.stringify({ lastId, updatedAt: new Date().toISOString() }, null, 2));
      }
    }
    if (!dryRun) {
      await fs.rm(checkpointPath, { force: true });
      stats.indexesEnsured = await ensureRunListIndexes(Run);
    }
    console.log(JSON.stringify(stats, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
